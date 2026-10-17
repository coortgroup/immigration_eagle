import { HttpError, readConfig, jsonResponse, errorResponse, serviceRpc, UUID } from '../_shared/http.mjs';
import { acceptsPurchaseEnvironment, readPaymentConfig, reconcilePaymentUser } from '../_shared/payments.mjs';

const unauthorized = () => new HttpError(401,'invalid_webhook','Webhook authentication failed.');
const encoder = new TextEncoder();
function equalSecret(a,b) {
  const aa = encoder.encode(a),bb = encoder.encode(b);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < Math.max(aa.length,bb.length); i++) diff |= (aa[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}
async function rawBody(request) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') || '')
    || (request.headers.get('content-encoding') && request.headers.get('content-encoding') !== 'identity')) throw new HttpError(415,'invalid_webhook','Send uncompressed JSON.');
  const reader = request.body?.getReader();
  if (!reader) throw unauthorized();
  const chunks = []; let size = 0,timer;
  const deadline = new Promise((_,reject) => { timer = setTimeout(() => reject(new HttpError(408,'request_timeout','Request timed out.')),10000); });
  try {
    while (true) {
      const { value,done } = await Promise.race([reader.read(),deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > 65536) throw new HttpError(413,'request_too_large','Request too large.');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
    return bytes;
  } finally { clearTimeout(timer); reader.cancel().catch(() => {}); }
}

export async function verifyWebhookSignature(bytes,header,secret,now = Date.now()) {
  // HTTP list separators may include optional whitespace; the signed timestamp
  // and original body stay exact. Duplicate/unknown signature fields fail closed.
  const match = /^t=(\d{10,11})[ \t]*,[ \t]*v1=([0-9a-f]{64})$/.exec((header || '').trim());
  if (!match || Math.abs(now / 1000 - Number(match[1])) > 300) throw unauthorized();
  const prefix = encoder.encode(`${match[1]}.`);
  const signed = new Uint8Array(prefix.length + bytes.length); signed.set(prefix); signed.set(bytes,prefix.length);
  const key = await crypto.subtle.importKey('raw',encoder.encode(secret),{ name:'HMAC',hash:'SHA-256' },false,['verify']);
  const signature = Uint8Array.from(match[2].match(/../g),byte => parseInt(byte,16));
  if (!await crypto.subtle.verify('HMAC',key,signature,signed)) throw unauthorized();
}

export function createRevenueCatWebhookHandler({ env,fetchImpl = fetch,now = Date.now }) {
  return async request => {
    let config;
    try {
      config = readConfig(env);
      if (request.method !== 'POST') throw new HttpError(405,'method_not_allowed','Use POST.');
      const authorization = env('REVENUECAT_WEBHOOK_AUTHORIZATION'),secret = env('REVENUECAT_WEBHOOK_SIGNING_SECRET');
      if (!authorization || authorization.length < 32 || !secret || secret.length < 32) throw new HttpError(503,'payments_unavailable','Webhook is not configured.');
      if (!equalSecret(request.headers.get('authorization') || '',authorization)) throw unauthorized();
      const bytes = await rawBody(request);
      await verifyWebhookSignature(bytes,request.headers.get('x-revenuecat-webhook-signature'),secret,now());
      let event;
      try { event = JSON.parse(new TextDecoder('utf-8',{ fatal:true }).decode(bytes)).event; } catch { throw new HttpError(400,'invalid_webhook','Invalid webhook.'); }
      if (!event || typeof event.id !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(event.id) || typeof event.type !== 'string') throw new HttpError(400,'invalid_webhook','Invalid webhook.');
      // Verify dashboard delivery before checkout/migrations are activated. A TEST
      // never reads purchases, writes a receipt, or grants access, even with UUIDs.
      if (event.type === 'TEST') return jsonResponse(request,config,200,{ received:true,test:true });
      const payment = readPaymentConfig(env);
      if (!payment) throw new HttpError(503,'payments_unavailable','Payment processing is not enabled.');
      // Transfers may omit store environment. They only trigger a fresh project-scoped
      // read; all purchases are still filtered by app/product/environment/owner there.
      const eventProducts = event.type === 'TRANSFER' && !event.app_id
        ? payment.products : payment.products.filter(p => p.appId === event.app_id);
      if ((event.environment && (typeof event.environment !== 'string'
          || !eventProducts.some(p => acceptsPurchaseEnvironment(payment,event.environment.toLowerCase(),p.store))))
        || (!event.environment && event.type !== 'TRANSFER')
        || (event.app_id && !payment.products.some(p => p.appId === event.app_id))
        || (!event.app_id && event.type !== 'TRANSFER'))
        return jsonResponse(request,config,200,{ received:true });
      const identities = [event.app_user_id,event.original_app_user_id,...(Array.isArray(event.transferred_from) ? event.transferred_from : []),...(Array.isArray(event.transferred_to) ? event.transferred_to : [])];
      const userIds = [...new Set(identities.filter(id => typeof id === 'string' && UUID.test(id)).map(id => id.toLowerCase()))].sort();
      if (userIds.length > 20) throw new HttpError(400,'invalid_webhook','Invalid webhook.');
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte => byte.toString(16).padStart(2,'0')).join('');
      const args = { p_event_id:event.id,p_payload_hash:hash,p_user_ids:userIds };
      // Persist minimal metadata before processing. Failures return non-200 for provider retry.
      const queued = await serviceRpc(config,'fillout_payment_webhook',{ ...args,p_complete:false },fetchImpl);
      if (typeof queued?.processed !== 'boolean' || !Array.isArray(queued.userIds) || queued.userIds.some(id => !userIds.includes(id))) throw Error('Invalid event receipt');
      if (!queued.processed) {
        for (const userId of queued.userIds) await reconcilePaymentUser({ config,payment,userId,fetchImpl });
        const completed = await serviceRpc(config,'fillout_payment_webhook',{ ...args,p_complete:true },fetchImpl);
        if (completed?.processed !== true) throw Error('Invalid completion receipt');
      }
      return jsonResponse(request,config,200,{ received:true });
    } catch (error) { return errorResponse(request,config,error); }
  };
}
