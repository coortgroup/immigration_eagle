import { boundedFetchJson, HttpError, serviceRpc } from './http.mjs';

export const FREE_AI_FORMS = ['AR-11', 'G-1145'];
export const PAID_AI_FORMS = ['I-90','I-129F','I-130','I-131','I-131A','I-134','I-485','I-751','I-765','I-864','I-864A','N-400','N-565','N-600'];
export const PAYMENT_FORM_IDS = [...FREE_AI_FORMS,...PAID_AI_FORMS,'I-130A','I-765WS','I-821D','I-821','G-639'];
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,255}$/.test(value);
const unavailable = () => new HttpError(503,'payments_unavailable','Payment verification is temporarily unavailable. Please try again.');

export function readPaymentConfig(env) {
  if (env('AI_PAYMENTS_ENABLED') !== 'true') return null;
  const projectId = env('REVENUECAT_PROJECT_ID');
  const apiKey = env('REVENUECAT_SECRET_API_KEY');
  const environment = env('REVENUECAT_ENVIRONMENT');
  const sandboxSetting = env('REVENUECAT_ACCEPT_APP_STORE_SANDBOX');
  // App Review receipts can authorize only a labelled sandbox case/queue. They
  // never become production credit, even when both environments share a user.
  const acceptAppStoreSandbox = sandboxSetting === 'true';
  if (!identifier(projectId) || !apiKey?.startsWith('sk_') || !['production','sandbox'].includes(environment)
    || (environment === 'sandbox' && env('PAYMENTS_STAGING') !== 'true')
    || (environment === 'production' && env('PAYMENTS_STAGING') === 'true')
    || (sandboxSetting && !['true','false'].includes(sandboxSetting))
    || (acceptAppStoreSandbox && environment !== 'production')
    || (env('REVENUECAT_WEBHOOK_AUTHORIZATION') || '').length < 32
    || (env('REVENUECAT_WEBHOOK_SIGNING_SECRET') || '').length < 32) throw unavailable();
  let products;
  try { products = JSON.parse(env('REVENUECAT_PRODUCTS_JSON') || ''); } catch { throw unavailable(); }
  if (!Array.isArray(products) || products.length < 1 || products.length > 28
    || products.some(p => !p || !PAID_AI_FORMS.includes(p.formId) || !['app_store','play_store'].includes(p.store)
      || !identifier(p.productId) || !identifier(p.revenueCatProductId) || !identifier(p.appId))
    || new Set(products.map(p => p.revenueCatProductId)).size !== products.length
    || new Set(products.map(p => `${p.formId}:${p.store}`)).size !== products.length) throw unavailable();
  return { projectId,apiKey,environment,acceptAppStoreSandbox,products };
}

export function acceptsPurchaseEnvironment(payment,environment,store) {
  return environment === payment.environment
    || payment.environment === 'production' && payment.acceptAppStoreSandbox && environment === 'sandbox' && store === 'app_store';
}

async function providerGet(payment, path, fetchImpl, allowMissing = false) {
  const { response,body } = await boundedFetchJson(`https://api.revenuecat.com/v2/projects/${encodeURIComponent(payment.projectId)}/${path}`, {
    headers: { Authorization: `Bearer ${payment.apiKey}`,Accept: 'application/json' },
  },fetchImpl,512 * 1024);
  if (response.status === 404 && allowMissing) return null;
  if (!response.ok) throw unavailable();
  return body;
}

export async function verifyPaymentProduct(payment, product, fetchImpl) {
  const body = await providerGet(payment,`products/${encodeURIComponent(product.revenueCatProductId)}`,fetchImpl);
  if (body?.object !== 'product' || body.state !== 'active' || body.id !== product.revenueCatProductId
    || body.app_id !== product.appId || body.store_identifier !== product.productId
    || !['one_time','consumable'].includes(body.type) || body.one_time?.is_consumable !== true) throw unavailable();
  return product;
}

export async function reconcilePaymentUser({ config,payment,userId,fetchImpl }) {
  if (!payment) throw unavailable();
  const begun = await serviceRpc(config,'fillout_payment_sync_begin',{ p_user_id:userId },fetchImpl);
  if (!Number.isSafeInteger(begun?.version) || begun.version < 1) throw unavailable();
  const path = `customers/${encodeURIComponent(userId)}/purchases`;
  let cursor = '',purchases = [],complete = false;
  for (let page = 0; page < 10; page++) {
    const body = await providerGet(payment,`${path}?limit=100${cursor ? `&starting_after=${encodeURIComponent(cursor)}` : ''}`,fetchImpl,page === 0);
    if (body === null) { complete = true; break; }
    if (body?.object !== 'list' || !Array.isArray(body.items) || body.items.length > 100) throw unavailable();
    purchases.push(...body.items);
    if (!body.next_page) { complete = true; break; }
    // Derive pagination from the last ID, never follow a provider-supplied URL with our secret.
    const last = body.items.at(-1)?.id;
    if (!identifier(last) || cursor === last) throw unavailable();
    cursor = last;
  }
  if (!complete) throw unavailable();
  const accepted = [];
  const verifiedProducts = new Set();
  for (const item of purchases) {
    const product = payment.products.find(p => p.revenueCatProductId === item?.product_id);
    if (!product || !acceptsPurchaseEnvironment(payment,item.environment,product.store)) continue;
    if (item.object !== 'purchase' || !identifier(item.id) || !identifier(item.store_purchase_identifier)
      || !Number.isSafeInteger(item.purchased_at) || item.purchased_at <= 0 || item.purchased_at > Date.now() + 300000
      || item.store !== product.store || item.quantity !== 1) throw unavailable();
    // Aliased/transferred/family purchases never become a second account's credit.
    if (item.customer_id !== userId || item.original_customer_id !== userId || item.ownership !== 'purchased') continue;
    const active = item.status === 'owned';
    if (!verifiedProducts.has(product.revenueCatProductId)) {
      await verifyPaymentProduct(payment,product,fetchImpl);
      verifiedProducts.add(product.revenueCatProductId);
    }
    accepted.push({ purchaseId:item.id,storeTransactionId:String(item.store_purchase_identifier),productId:product.productId,
      formId:product.formId,store:product.store,environment:item.environment,purchasedAt:new Date(item.purchased_at).toISOString(),active });
  }
  if (new Set(accepted.map(p => p.purchaseId)).size !== accepted.length) throw unavailable();
  const result = await serviceRpc(config,'fillout_payment_sync_finish',{ p_user_id:userId,p_version:begun.version,
    p_project_id:payment.projectId,p_environment:payment.environment,p_purchases:accepted,p_accept_app_store_sandbox:payment.acceptAppStoreSandbox },fetchImpl);
  if (result?.synced !== true) throw unavailable();
}

export async function requirePaidCase({ config,env,userId,caseId,formId,fetchImpl }) {
  if (FREE_AI_FORMS.includes(formId)) return 'production';
  if (!caseId) throw new HttpError(402,'payment_required','Update to the latest app version and complete payment for this application before submitting it for review.');
  await reconcilePaymentUser({ config,payment:readPaymentConfig(env),userId,fetchImpl });
  const result = await serviceRpc(config,'fillout_payment_case_access',{ p_user_id:userId,p_case_id:caseId,p_form_id:formId },fetchImpl);
  if (result?.allowed !== true) throw new HttpError(402,'payment_required','Complete payment for this application before continuing.');
  if (!['production','sandbox'].includes(result.environment)) throw unavailable();
  return result.environment;
}
