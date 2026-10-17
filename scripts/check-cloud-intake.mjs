import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createSubmitRequestHandler, validateRequest } from '../supabase/functions/submit-request/handler.mjs';
import { FORM_IDS } from '../supabase/functions/_shared/form-ids.mjs';
import { readConfig, consumeAiQuota } from '../supabase/functions/_shared/http.mjs';

const catalog = JSON.parse(await readFile(new URL('../data/forms-catalog.json', import.meta.url), 'utf8'));
assert.deepEqual([...FORM_IDS].sort(), catalog.forms.map(form => form.id).sort());
const userId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const pendingId = '33333333-3333-4333-8333-333333333333';
const anonymousId = '44444444-4444-4444-8444-444444444444';
const attorneyId = '55555555-5555-4555-8555-555555555555';
const legacyId = '66666666-6666-4666-8666-666666666666';
const attorneyConsent = 'share-contact-and-question-v1';
const settings = {
  SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example', SUPABASE_SECRET_KEY: 'sb_secret_example',
};
const env = name => settings[name];
const token = 'example-user-access-token';
const valid = () => ({ requestId: randomUUID(), type: 'contact', name: ' Example Person ', email: ' person@example.test ', question: ' Please contact me. ' });
let user = { id: userId, role: 'authenticated', email: 'account@example.test', email_confirmed_at: '2026-10-10T00:00:00Z', is_anonymous: false };
let calls = [];
let upstreamMode = 'normal';
let rpc;
const fakeFetch = async (url, options) => {
  calls.push({ url, options });
  if (upstreamMode === 'offline') throw new Error('sensitive diagnostic');
  if (url.endsWith('/auth/v1/user')) {
    assert.equal(options.headers.apikey, settings.SUPABASE_PUBLISHABLE_KEY);
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    if (upstreamMode === 'rejected') return Response.json({ message: 'private details' }, { status: 401 });
    if (upstreamMode === 'oversized') return new Response('x'.repeat(70_000));
    return Response.json(user);
  }
  assert.ok(url.includes('/rest/v1/rpc/'));
  assert.equal(options.headers.apikey, settings.SUPABASE_SECRET_KEY);
  assert.equal(options.headers.Authorization, undefined, 'Opaque secret is never sent as a Bearer JWT');
  assert.equal(options.redirect, 'error');
  return rpc(url.split('/').at(-1), JSON.parse(options.body));
};
const handler = createSubmitRequestHandler({ env, fetchImpl: fakeFetch });
async function call(input = valid(), { origin = 'https://fillout.net', auth = true, method = 'POST', headers = {}, raw } = {}) {
  const result = await handler(new Request('https://example.supabase.co/functions/v1/submit-request', {
    method,
    headers: { ...(origin === null ? {} : { Origin: origin }), ...(auth ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...headers },
    ...(['GET', 'HEAD', 'OPTIONS'].includes(method) ? {} : { body: raw ?? JSON.stringify(input) }),
  }));
  return { result, body: result.status === 204 ? null : await result.json() };
}
function checkError(output, status, code) {
  assert.equal(output.result.status, status);
  assert.equal(output.body.error.code, code);
  assert.ok(!JSON.stringify(output.body).includes('sensitive diagnostic'));
}

// Real PostgreSQL engine, actual migration and grants. Only the minimal Supabase
// Auth schema/roles are fixtures. Hosted auth/gateway behavior remains a deployment check.
const db = new PGlite();
try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, is_anonymous boolean not null default false);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `);
  const migration = await readFile(new URL('../supabase/migrations/20261010000100_cloud_intake.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  for (const [id, confirmed, anonymous] of [[userId, true, false], [otherId, true, false], [pendingId, false, false], [anonymousId, true, true], [attorneyId, true, false], [legacyId, true, false]]) {
    await db.query('insert into auth.users values($1, $2, $3, $4)', [id, `${id}@example.test`, confirmed ? new Date().toISOString() : null, anonymous]);
  }
  // Create a genuine pre-migration record. An old request must remain history,
  // never become evidence that the user agreed to attorney disclosure.
  const legacyRequestId = randomUUID();
  const legacyPayload = { type: 'attorney', name: 'Legacy Example', email: 'legacy@example.test', phone: null, question: 'Please contact me.', formId: 'N-400' };
  await db.query('select public.fillout_submit_request($1,$2,$3)', [legacyId, legacyRequestId, legacyPayload]);
  const legacyBefore = (await db.query('select * from public.requests where request_id = $1', [legacyRequestId])).rows[0];
  const consentMigration = await readFile(new URL('../supabase/migrations/20261017000200_attorney_referral_consent.sql', import.meta.url), 'utf8');
  await db.exec(consentMigration);
  assert.deepEqual((await db.query('select * from public.requests where request_id = $1', [legacyRequestId])).rows[0], legacyBefore, 'Migration preserves legacy records without inventing consent');
  assert.equal(Object.hasOwn(legacyBefore.payload, 'attorneyConsent'), false);
  rpc = async (name, args) => {
    await db.exec('set role service_role');
    try {
      const query = name === 'fillout_submit_request'
        ? await db.query('select public.fillout_submit_request($1,$2,$3) as result', [args.p_user_id, args.p_request_id, args.p_payload])
        : await db.query('select public.fillout_consume_ai_quota($1) as result', [args.p_user_id]);
      return Response.json(query.rows[0].result);
    } catch (error) {
      return Response.json({ code: error.code, message: 'Database diagnostic must not escape' }, { status: 400 });
    } finally { await db.exec('reset role'); }
  };

  calls = [];
  checkError(await call(valid(), { auth: false }), 401, 'auth_required');
  assert.equal(calls.length, 0, 'Unauthenticated requests never reach Auth or database');
  checkError(await call(valid(), { origin: 'https://attacker.example' }), 403, 'origin_not_allowed');
  checkError(await call(valid(), { origin: 'null' }), 403, 'origin_not_allowed');
  checkError(await call(valid(), { origin: 'http://localhost:4175' }), 403, 'origin_not_allowed');
  assert.equal(calls.length, 0, 'Disallowed origins are rejected before remote work');
  checkError(await call(valid(), { method: 'GET' }), 405, 'method_not_allowed');
  assert.equal((await call(valid(), { method: 'OPTIONS', auth: false, headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type, apikey' } })).result.status, 204);
  checkError(await call(valid(), { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'cookie' } }), 403, 'headers_not_allowed');

  user = { ...user, email_confirmed_at: null };
  checkError(await call(), 403, 'email_verification_required');
  user = { ...user, email_confirmed_at: new Date().toISOString(), is_anonymous: true };
  checkError(await call(), 403, 'email_verification_required');
  user = { ...user, is_anonymous: false };
  upstreamMode = 'rejected'; checkError(await call(), 401, 'auth_required');
  upstreamMode = 'offline'; checkError(await call(), 503, 'service_unavailable');
  upstreamMode = 'oversized'; checkError(await call(), 503, 'service_unavailable');
  upstreamMode = 'normal';
  checkError(await call(valid(), { headers: { 'Content-Type': 'text/plain' } }), 415, 'unsupported_media_type');
  checkError(await call(valid(), { headers: { 'Content-Encoding': 'gzip' } }), 415, 'unsupported_media_type');
  checkError(await call(valid(), { raw: '{not-json' }), 400, 'invalid_json');
  checkError(await call([], { raw: '[]' }), 400, 'invalid_json');
  checkError(await call(valid(), { raw: new Uint8Array([0xff]) }), 400, 'invalid_json');
  checkError(await call(valid(), { raw: 'x'.repeat(17_000) }), 413, 'request_too_large');
  checkError(await call({ ...valid(), user_id: otherId }), 422, 'validation_failed');
  checkError(await call({ ...valid(), requestId: 'not-a-uuid' }), 422, 'validation_failed');
  checkError(await call({ ...valid(), formId: 'I-999' }), 422, 'validation_failed');
  checkError(await call({ ...valid(), type: 'attorney' }), 422, 'validation_failed');
  for (const consent of [undefined, '', 'yes', 'share-contact-and-question-v0', null, true, { version: attorneyConsent }]) {
    const rejected = await call({ ...valid(), type: 'attorney', formId: 'N-400', attorneyConsent: consent });
    checkError(rejected, 422, 'validation_failed');
    assert.ok(rejected.body.error.fields.attorneyConsent, 'Missing or invalid consent identifies the field to correct');
  }
  for (const consent of [attorneyConsent, '', null]) {
    checkError(await call({ ...valid(), attorneyConsent: consent }), 422, 'validation_failed');
  }
  checkError(await call({ ...valid(), name: 'Name\nInjected' }), 422, 'validation_failed');
  checkError(await call({ ...valid(), email: 'bad-email' }), 422, 'validation_failed');
  checkError(await call({ ...valid(), email: '', phone: '+1 (123)' }), 422, 'validation_failed');
  checkError(await call({ ...valid(), question: 'q'.repeat(3001) }), 422, 'validation_failed');
  checkError(await call({ ...valid(), name: { toString: 'name' } }), 422, 'validation_failed');

  const original = { ...valid(), phone: '(555) 123.4567' };
  const created = await call(original, { origin: null });
  assert.equal(created.result.status, 201, JSON.stringify(created.body));
  assert.deepEqual(Object.keys(created.body).sort(), ['createdAt', 'delivery', 'externalNotification', 'id', 'requestId']);
  assert.equal(created.body.requestId, original.requestId);
  assert.equal(created.body.delivery, 'team-inbox');
  assert.equal(created.body.externalNotification, false);
  assert.equal(created.result.headers.get('access-control-allow-origin'), null, 'Native response never enables wildcard CORS');
  const replay = await call(original);
  assert.deepEqual(replay.body, created.body, 'Idempotent retry returns the original receipt');
  assert.equal(replay.result.headers.get('access-control-allow-origin'), 'https://fillout.net');
  assert.equal(replay.result.headers.get('cache-control'), 'no-store');
  checkError(await call({ ...original, question: 'Changed' }), 409, 'request_conflict');
  assert.equal((await db.query('select count(*)::int as count from public.requests where user_id = $1', [userId])).rows[0].count, 1);
  assert.equal((await db.query('select count(*)::int as count from private.notification_outbox o join public.requests r on r.id = o.request_id where r.user_id = $1', [userId])).rows[0].count, 1);
  const saved = (await db.query('select * from public.requests where user_id = $1', [userId])).rows[0];
  assert.equal(saved.user_id, userId, 'User ID comes from authenticated Auth response');
  assert.equal(saved.payload.name, 'Example Person');
  assert.deepEqual((await db.query('select * from private.notification_outbox where request_id = $1', [saved.id])).rows[0], { request_id: saved.id, event_type: 'request_created', created_at: saved.created_at, state: 'pending', attempts: 0 });

  // Table privileges and RLS: neither API role can write or call service RPCs.
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [otherId]);
  assert.equal((await db.query('select * from public.requests')).rows.length, 0, 'Another authenticated user cannot read the request');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  assert.equal((await db.query('select * from public.requests')).rows.length, 1, 'Owner can read own request');
  await assert.rejects(db.query('insert into public.requests(user_id,request_id,payload) values($1,$2,$3)', [userId, randomUUID(), {}]), error => error.code === '42501');
  await assert.rejects(db.query('update public.requests set status = $1', ['closed']), error => error.code === '42501');
  await assert.rejects(db.query('delete from public.requests'), error => error.code === '42501');
  await assert.rejects(db.query('select public.fillout_submit_request($1,$2,$3)', [userId, randomUUID(), {}]), error => error.code === '42501');
  await assert.rejects(db.query('select public.fillout_consume_ai_quota($1)', [userId]), error => error.code === '42501');
  await assert.rejects(db.query('select * from private.notification_outbox'), error => error.code === '42501');
  await db.exec('reset role; set role anon');
  await assert.rejects(db.query('select * from public.requests'), error => error.code === '42501');
  await assert.rejects(db.query('select public.fillout_submit_request($1,$2,$3)', [userId, randomUUID(), {}]), error => error.code === '42501');
  await assert.rejects(db.query('select public.fillout_consume_ai_quota($1)', [userId]), error => error.code === '42501');
  await db.exec('reset role');

  // A failed outbox write must roll back the request and never produce a receipt.
  await db.exec(`
    create function private.test_reject_outbox() returns trigger language plpgsql as $$ begin raise exception 'private failure details'; end; $$;
    create trigger test_reject_outbox before insert on private.notification_outbox for each row execute function private.test_reject_outbox();
  `);
  user = { ...user, id: otherId };
  const failedSave = await call();
  checkError(failedSave, 503, 'service_unavailable');
  assert.ok(!JSON.stringify(failedSave.body).includes('private failure details'));
  assert.equal((await db.query('select count(*)::int as count from public.requests where user_id = $1', [otherId])).rows[0].count, 0, 'Outbox failure rolls back the request');
  await db.exec('drop trigger test_reject_outbox on private.notification_outbox; drop function private.test_reject_outbox()');
  user = { ...user, id: userId };

  const normalized = validateRequest(valid()).payload;
  for (const id of [pendingId, anonymousId]) {
    assert.equal((await (await rpc('fillout_submit_request', { p_user_id: id, p_request_id: randomUUID(), p_payload: normalized })).json()).code, 'PT403');
    assert.equal((await (await rpc('fillout_consume_ai_quota', { p_user_id: id })).json()).code, 'PT403');
  }
  assert.equal((await (await rpc('fillout_submit_request', { p_user_id: userId, p_request_id: randomUUID(), p_payload: { ...normalized, extra: true } })).json()).code, 'PT422');
  assert.equal((await (await rpc('fillout_submit_request', { p_user_id: userId, p_request_id: randomUUID(), p_payload: { ...normalized, formId: 'I-999' } })).json()).code, 'PT422');
  for (let i = 0; i < 4; i++) assert.equal((await call()).result.status, 201);
  checkError(await call(), 429, 'rate_limited');
  assert.deepEqual((await call(original)).body, created.body, 'Replay still succeeds at the limit');
  await db.query("update public.requests set created_at = now() - interval '61 minutes' where request_id <> $1 and user_id = $2", [original.requestId, userId]);
  assert.equal((await call()).result.status, 201, 'The rolling hour expires');

  // Service-RPC validation still applies if a caller bypasses the HTTP handler.
  const attorneyPayload = { ...legacyPayload, attorneyConsent };
  for (const consent of [undefined, '', 'yes', 'share-contact-and-question-v0', null, true, { version: attorneyConsent }]) {
    const payload = { ...legacyPayload, ...(consent === undefined ? {} : { attorneyConsent: consent }) };
    const rejected = await rpc('fillout_submit_request', { p_user_id: attorneyId, p_request_id: randomUUID(), p_payload: payload });
    assert.equal((await rejected.json()).code, 'PT422', 'Database independently rejects missing or invalid attorney consent');
  }
  for (const consent of [attorneyConsent, '', null]) {
    const rejected = await rpc('fillout_submit_request', { p_user_id: attorneyId, p_request_id: randomUUID(), p_payload: { ...normalized, attorneyConsent: consent } });
    assert.equal((await rejected.json()).code, 'PT422', 'Database rejects attorney consent attached to contact requests');
  }
  assert.equal((await db.query('select count(*)::int as count from public.requests where user_id = $1', [attorneyId])).rows[0].count, 0, 'Invalid consent produces no stored request');

  user = { ...user, id: attorneyId };
  const attorneyRequest = { ...valid(), type: 'attorney', formId: 'N-400', attorneyConsent };
  const attorneyCreated = await call(attorneyRequest);
  assert.equal(attorneyCreated.result.status, 201);
  assert.equal(attorneyCreated.body.externalNotification, false, 'Saving consent never claims an external referral was sent');
  assert.deepEqual((await call(attorneyRequest)).body, attorneyCreated.body, 'Attorney retry returns the original receipt');
  const storedAttorney = (await db.query('select * from public.requests where user_id = $1', [attorneyId])).rows;
  assert.equal(storedAttorney.length, 1, 'Attorney retry does not create another request');
  assert.equal(storedAttorney[0].payload.attorneyConsent, attorneyConsent, 'Stored request retains the exact disclosure consent version');
  const directReplay = await rpc('fillout_submit_request', { p_user_id: attorneyId, p_request_id: attorneyRequest.requestId, p_payload: validateRequest(attorneyRequest).payload });
  assert.equal((await directReplay.json()).id, attorneyCreated.body.id, 'Direct service retry remains idempotent');
  assert.equal((await db.query('select count(*)::int as count from private.notification_outbox where request_id = $1', [attorneyCreated.body.id])).rows[0].count, 1, 'Consent retries cannot duplicate the outbox event');
  checkError(await call({ ...attorneyRequest, question: 'A changed question requires a new request.' }), 409, 'request_conflict');

  user = { ...user, id: legacyId };
  checkError(await call({ requestId: legacyRequestId, ...legacyPayload, phone: '' }), 422, 'validation_failed');
  const legacyReplay = await rpc('fillout_submit_request', { p_user_id: legacyId, p_request_id: legacyRequestId, p_payload: legacyPayload });
  assert.equal((await legacyReplay.json()).code, 'PT422', 'Replaying an old request cannot bypass the new consent requirement');
  const rewrittenLegacy = await rpc('fillout_submit_request', { p_user_id: legacyId, p_request_id: legacyRequestId, p_payload: attorneyPayload });
  assert.equal((await rewrittenLegacy.json()).code, 'PT409', 'Consent cannot be retroactively attached to an existing request ID');
  assert.deepEqual((await db.query('select * from public.requests where request_id = $1', [legacyRequestId])).rows[0], legacyBefore, 'Legacy history remains unchanged after rejected retries');
  assert.equal((await db.query("select count(*)::int as count from public.requests where user_id = $1 and payload->>'attorneyConsent' = $2", [legacyId, attorneyConsent])).rows[0].count, 0, 'Legacy history is not permission to share with attorneys');
  user = { ...user, id: userId };

  const config = readConfig(env);
  for (let i = 0; i < 20; i++) await consumeAiQuota(config, userId, fakeFetch);
  await assert.rejects(consumeAiQuota(config, userId, fakeFetch), error => error.status === 429);
  assert.equal((await db.query('select count(*)::int as count from private.ai_usage_events')).rows[0].count, 20, 'Rejected AI calls do not add events');
  await db.query("update private.ai_usage_events set created_at = now() - interval '25 hours'");
  await consumeAiQuota(config, userId, fakeFetch);
  assert.equal((await db.query('select count(*)::int as count from private.ai_usage_events')).rows[0].count, 1, 'Old cost metadata expires');
  for (let i = 0; i < 199; i++) await db.query('insert into private.ai_usage_events(user_id) values($1)', [otherId]);
  await assert.rejects(consumeAiQuota(config, userId, fakeFetch), error => error.status === 429);
  assert.equal((await db.query('select count(*)::int as count from private.ai_usage_events')).rows[0].count, 200, 'Global AI limit is enforced');

  settings.CORS_ALLOWED_ORIGINS = 'http://localhost:4175';
  assert.throws(() => readConfig(env), error => error.status === 503, 'Production cannot accidentally allow localhost');
  settings.ALLOW_LOCAL_DEVELOPMENT = 'true';
  assert.ok(readConfig(env).allowedOrigins.has('http://localhost:4175'));
  settings.CORS_ALLOWED_ORIGINS = 'https://attacker.example';
  assert.throws(() => readConfig(env), error => error.status === 503);
  settings.CORS_ALLOWED_ORIGINS = 'https://fillout.net';
  settings.SUPABASE_URL = 'https://attacker.example';
  assert.throws(() => readConfig(env), error => error.status === 503, 'Server configuration cannot redirect secrets to an arbitrary host');
  console.log('Cloud intake checks passed: verified Auth, CORS, explicit attorney consent and legacy preservation, idempotency, real PostgreSQL migrations/RLS/grants, direct SQL bypass rejection, rolling intake and AI quotas. Hosted gateway and multi-session concurrency require staging verification.');
} finally { await db.close(); }
