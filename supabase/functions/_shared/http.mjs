// Standard Web APIs only: the same security boundary runs in Deno and Node tests.
export class HttpError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const unavailable = () => new HttpError(503, 'service_unavailable', 'This service is temporarily unavailable. Please try again.');
const authRequired = () => new HttpError(401, 'auth_required', 'Sign in again to continue.');

function namedKey(env, singular, plural) {
  const single = env(singular);
  if (single) return single;
  try { return JSON.parse(env(plural) || '{}').default || ''; } catch { return ''; }
}

export function readConfig(env) {
  const development = env('ALLOW_LOCAL_DEVELOPMENT') === 'true';
  const supabaseUrl = (env('SUPABASE_URL') || '').replace(/\/$/, '');
  const publicKey = namedKey(env, 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_PUBLISHABLE_KEYS') || env('SUPABASE_ANON_KEY');
  const serviceKey = namedKey(env, 'SUPABASE_SECRET_KEY', 'SUPABASE_SECRET_KEYS') || env('SUPABASE_SERVICE_ROLE_KEY');
  let url;
  try { url = new URL(supabaseUrl); } catch { throw unavailable(); }
  const localHost = ['localhost', '127.0.0.1', '[::1]', 'kong'].includes(url.hostname);
  if (!['http:', 'https:'].includes(url.protocol)) throw unavailable();
  if ((!development || !localHost) && (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname))) throw unavailable();
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || !publicKey || !serviceKey) throw unavailable();
  const allowedOrigins = new Set(['https://fillout.net', 'https://www.fillout.net']);
  for (const origin of (env('CORS_ALLOWED_ORIGINS') || '').split(',').map(value => value.trim()).filter(Boolean)) {
    let parsed;
    try { parsed = new URL(origin); } catch { throw unavailable(); }
    // No arbitrary production origins or wildcards. Local opt-in is for a separate development project.
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (parsed.origin !== origin || !(allowedOrigins.has(origin) || (development && local && ['http:', 'https:'].includes(parsed.protocol)))) throw unavailable();
    allowedOrigins.add(origin);
  }
  return { supabaseUrl, publicKey, serviceKey, allowedOrigins };
}

function headersFor(request, config) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    Vary: 'Origin',
  };
  const origin = request.headers.get('origin');
  if (origin && config?.allowedOrigins.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info';
    headers['Access-Control-Expose-Headers'] = 'Retry-After';
  }
  return headers;
}

export function jsonResponse(request, config, status, body, extraHeaders = {}) {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { ...headersFor(request, config), ...extraHeaders } });
}

export function errorResponse(request, config, error) {
  const safe = error instanceof HttpError ? error : unavailable();
  return jsonResponse(request, config, safe.status, {
    error: { code: safe.code, message: safe.message, ...(safe.fields ? { fields: safe.fields } : {}) },
  }, safe.status === 429 ? { 'Retry-After': '3600' } : {});
}

export async function readJson(request, maxBytes = 16_384) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') || '')) {
    throw new HttpError(415, 'unsupported_media_type', 'Send an application/json request.');
  }
  if (request.headers.get('content-encoding') && request.headers.get('content-encoding') !== 'identity') {
    throw new HttpError(415, 'unsupported_media_type', 'Compressed requests are not supported.');
  }
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new HttpError(413, 'request_too_large', 'The request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'invalid_json', 'Provide a JSON object.');
  const chunks = [];
  let size = 0;
  let timeout;
  const deadline = new Promise((_, reject) => { timeout = setTimeout(() => reject(new HttpError(408, 'request_timeout', 'The request timed out.')), 10_000); });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new HttpError(413, 'request_too_large', 'The request is too large.');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let data;
    try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new HttpError(400, 'invalid_json', 'Provide valid JSON.'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'invalid_json', 'Provide a JSON object.');
    return data;
  } finally {
    clearTimeout(timeout);
    // Do not wait on a malicious client's unfinished stream during cancellation.
    reader.cancel().catch(() => {});
  }
}

export async function boundedFetchJson(url, init, fetchImpl, maxBytes = 65_536) {
  try {
    const response = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(10_000) });
    // Trusted services are still bounded; never echo an upstream error or user record.
    const reader = response.body?.getReader();
    if (!reader) throw unavailable();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw unavailable();
        chunks.push(value);
      }
    } finally { reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let body;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw unavailable(); }
    return { response, body };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw unavailable();
  }
}

export async function requireVerifiedUser(request, config, fetchImpl = fetch) {
  const authorization = request.headers.get('authorization') || '';
  if (!/^Bearer [^\s]{16,8192}$/.test(authorization)) throw authRequired();
  const { response, body } = await boundedFetchJson(`${config.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: config.publicKey, Authorization: authorization },
  }, fetchImpl);
  if ([401, 403].includes(response.status)) throw authRequired();
  if (!response.ok) throw unavailable();
  if (!UUID.test(body?.id || '') || body?.role !== 'authenticated') throw authRequired();
  if (body.is_anonymous !== false || typeof body.email !== 'string' || !body.email || !body.email_confirmed_at) {
    throw new HttpError(403, 'email_verification_required', 'Verify your email before continuing.');
  }
  return { id: body.id, lastSignInAt: body.last_sign_in_at };
}

export async function serviceRpc(config, name, args, fetchImpl = fetch) {
  // RPC names are constants in server code, never supplied by the caller.
  if (!['fillout_submit_request', 'fillout_consume_ai_quota', 'fillout_support_list', 'fillout_support_send',
    'fillout_account_deletion_status', 'fillout_account_deletion_begin',
    'fillout_support_operator_access', 'fillout_support_inbox', 'fillout_support_reply', 'fillout_support_operator_list',
    'fillout_payment_sync_begin', 'fillout_payment_sync_finish', 'fillout_payment_case', 'fillout_payment_case_access', 'fillout_payment_webhook',
    'fillout_form_review_submit', 'fillout_form_review_list', 'fillout_form_review_inbox', 'fillout_form_review_file', 'fillout_form_review_decide', 'fillout_form_review_decision_context'].includes(name)) throw unavailable();
  const { response, body } = await boundedFetchJson(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: config.serviceKey,
      // Opaque secret keys belong only in apikey. Legacy service-role keys are JWTs.
      ...(!config.serviceKey.startsWith('sb_secret_') ? { Authorization: `Bearer ${config.serviceKey}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  }, fetchImpl, name === 'fillout_form_review_file' ? 12 * 1024 * 1024
    : ['fillout_form_review_list','fillout_form_review_inbox'].includes(name) ? 256 * 1024 : 65_536);
  if (response.ok) return body;
  if (body?.code === 'PT402') throw new HttpError(402, 'payment_required', 'Complete payment for this application before continuing.');
  if (body?.code === 'PT409' && body.message === 'purchase_already_pending') throw new HttpError(409, 'purchase_pending', 'A purchase is awaiting confirmation. Check payment before trying again.');
  if (body?.code === 'PT409') throw new HttpError(409, 'request_conflict', 'This request has already been used. Start a new request to change its details.');
  if (body?.code === 'PT429') throw new HttpError(429, 'rate_limited', 'The request limit has been reached. Please try again later.');
  if (body?.code === 'PT403') throw new HttpError(403, name.startsWith('fillout_form_review_') ? 'review_access_required' : 'email_verification_required', name.startsWith('fillout_form_review_') ? 'This form is not available to this account.' : 'Verify your email before continuing.');
  if (body?.code === 'PT422') throw new HttpError(422, 'invalid_request', 'Check your request and try again.');
  throw unavailable();
}

export async function consumeAiQuota(config, userId, fetchImpl = fetch) {
  const result = await serviceRpc(config, 'fillout_consume_ai_quota', { p_user_id: userId }, fetchImpl);
  if (result?.allowed !== true) throw unavailable();
}

export function createAuthenticatedEndpoint({ env, fetchImpl = fetch, maxBodyBytes = 16_384, action }) {
  return async request => {
    let config;
    try {
      config = readConfig(env);
      const origin = request.headers.get('origin');
      // Native clients have no Origin; authentication is always required for POST.
      if (origin && !config.allowedOrigins.has(origin)) throw new HttpError(403, 'origin_not_allowed', 'This origin is not allowed.');
      if (request.method === 'OPTIONS') {
        if (request.headers.get('access-control-request-method') !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Use POST.');
        const requested = (request.headers.get('access-control-request-headers') || '').toLowerCase().split(',').map(item => item.trim()).filter(Boolean);
        if (requested.some(item => !['authorization', 'apikey', 'content-type', 'x-client-info'].includes(item))) throw new HttpError(403, 'headers_not_allowed', 'These request headers are not allowed.');
        return jsonResponse(request, config, 204, null);
      }
      if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Use POST.');
      const user = await requireVerifiedUser(request, config, fetchImpl);
      const input = await readJson(request, maxBodyBytes);
      const result = await action({ input, user, config, fetchImpl });
      return jsonResponse(request, config, result.status || 200, result.body);
    } catch (error) {
      // Deliberately no raw exceptions, tokens, questions, or contact information in logs.
      return errorResponse(request, config, error);
    }
  };
}
