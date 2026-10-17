import { HttpError, UUID, readConfig, readJson, requireVerifiedUser, serviceRpc,
  boundedFetchJson, jsonResponse, errorResponse } from '../_shared/http.mjs';

const unavailable = () => new HttpError(503, 'deletion_unconfirmed', 'Account deletion has not been confirmed. Keep this screen open and try again.');
const freshSignIn = () => new HttpError(401, 'recent_sign_in_required', 'Verify your email again before deleting your account.');

export function createDeleteAccountHandler({ env, fetchImpl = fetch, now = () => Date.now() }) {
  return async request => {
    let config;
    try {
      config = readConfig(env);
      const origin = request.headers.get('origin');
      if (origin && !config.allowedOrigins.has(origin)) throw new HttpError(403, 'origin_not_allowed', 'This origin is not allowed.');
      if (request.method === 'OPTIONS') {
        if (request.headers.get('access-control-request-method') !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Use POST.');
        const headers = (request.headers.get('access-control-request-headers') || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
        if (headers.some(value => !['authorization', 'apikey', 'content-type', 'x-client-info'].includes(value))) throw new HttpError(403, 'headers_not_allowed', 'These request headers are not allowed.');
        return jsonResponse(request, config, 204, null);
      }
      if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Use POST.');
      const input = await readJson(request, 1024);
      if (Object.keys(input).length !== 2 || input.confirmation !== 'DELETE' || !/^[0-9a-f]{64}$/.test(input.deletionToken || '')) {
        throw new HttpError(422, 'invalid_deletion_request', 'Confirm account deletion and try again.');
      }
      const hashBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.deletionToken));
      const tokenHash = Array.from(new Uint8Array(hashBytes), byte => byte.toString(16).padStart(2, '0')).join('');
      const status = () => serviceRpc(config, 'fillout_account_deletion_status', { p_token_hash: tokenHash }, fetchImpl);
      let receipt = await status();
      if (receipt?.state === 'unknown') {
        const user = await requireVerifiedUser(request, config, fetchImpl);
        // Auth /user has already verified this exact Bearer token. Inspect its
        // authenticated AMR timestamp, not iat (which token refresh advances) or
        // the user's last_sign_in_at (which another device can advance).
        let claims;
        try {
          const encoded = (request.headers.get('authorization') || '').slice(7).split('.')[1];
          claims = JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')));
        } catch { throw freshSignIn(); }
        if (claims.sub !== user.id || !Array.isArray(claims.amr) || !claims.amr.some(method =>
          ['otp', 'password', 'email/signup', 'recovery'].includes(method.method)
          && Number.isFinite(method.timestamp) && method.timestamp * 1000 <= now() + 60_000
          && now() - method.timestamp * 1000 <= 10 * 60_000)) throw freshSignIn();
        receipt = await serviceRpc(config, 'fillout_account_deletion_begin', { p_user_id: user.id, p_token_hash: tokenHash }, fetchImpl);
      }
      if (receipt?.state === 'pending' && UUID.test(receipt.userId || '')) {
        // Hard-delete through Auth's Admin API. The id originates only from the
        // verified initiating user, retained in the service-only deletion receipt.
        const { response } = await boundedFetchJson(`${config.supabaseUrl}/auth/v1/admin/users/${receipt.userId}`, {
          method: 'DELETE', headers: { apikey: config.serviceKey, 'Content-Type': 'application/json',
            ...(!config.serviceKey.startsWith('sb_secret_') ? { Authorization: `Bearer ${config.serviceKey}` } : {}) },
          body: JSON.stringify({ should_soft_delete: false }),
        }, fetchImpl);
        if (!response.ok && response.status !== 404) throw unavailable();
        receipt = await status();
      }
      if (receipt?.state !== 'deleted' || receipt.userId !== null) throw unavailable();
      return jsonResponse(request, config, 200, { deleted: true });
    } catch (error) { return errorResponse(request, config, error); }
  };
}
