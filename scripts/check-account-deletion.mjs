#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto, randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createDeleteAccountHandler } from '../supabase/functions/delete-account/handler.mjs';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const settings = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SECRET_KEY: 'sb_secret_test' };
const db = new PGlite();
const now = Date.now();
let authAge = 0;
const accessToken = () => `header.${Buffer.from(JSON.stringify({ sub: A, amr: [{ method: 'otp', timestamp: Math.floor(now / 1000) - authAge }] })).toString('base64url')}.signature`;
let verified = { id: A, role: 'authenticated', email: 'a@example.test', is_anonymous: false, email_confirmed_at: new Date(now).toISOString(), last_sign_in_at: new Date(now).toISOString() };
let authCalls = 0, deleteCalls = 0, loseDeleteResponse = false;
async function fakeFetch(url, options) {
  if (url.endsWith('/auth/v1/user')) {
    authCalls++;
    assert.equal(options.headers.apikey, settings.SUPABASE_PUBLISHABLE_KEY);
    if (!verified || options.headers.Authorization !== `Bearer ${accessToken()}`) return Response.json({ error: 'private' }, { status: 401 });
    return Response.json(verified);
  }
  assert.equal(options.headers.apikey, settings.SUPABASE_SECRET_KEY);
  assert.equal(options.headers.Authorization, undefined);
  if (url.includes('/auth/v1/admin/users/')) {
    deleteCalls++;
    assert.equal(options.method, 'DELETE');
    assert.deepEqual(JSON.parse(options.body), { should_soft_delete: false });
    assert.equal(url.split('/').at(-1), A, 'Only the authenticated initiating owner can be removed');
    try { await db.query('delete from auth.users where id = $1', [url.split('/').at(-1)]); }
    catch { return Response.json({ error: 'private database failure' }, { status: 500 }); }
    if (loseDeleteResponse) throw new Error('Lost response after successful deletion');
    return Response.json({ id: A });
  }
  const name = url.split('/').at(-1);
  assert.ok(['fillout_account_deletion_status', 'fillout_account_deletion_begin'].includes(name));
  const input = JSON.parse(options.body);
  await db.exec('set role service_role');
  try {
    const result = name.endsWith('_status')
      ? await db.query('select public.fillout_account_deletion_status($1) as result', [input.p_token_hash])
      : await db.query('select public.fillout_account_deletion_begin($1,$2) as result', [input.p_user_id, input.p_token_hash]);
    return Response.json(result.rows[0].result);
  } catch (error) { return Response.json({ code: error.code, message: 'private' }, { status: 400 }); }
  finally { await db.exec('reset role'); }
}
const handler = createDeleteAccountHandler({ env: key => settings[key], fetchImpl: fakeFetch, now: () => now });
const secret = () => randomBytes(32).toString('hex');
async function call(body = { confirmation: 'DELETE', deletionToken: secret() }, { auth = true, origin = 'https://fillout.net' } = {}) {
  const response = await handler(new Request('https://example.supabase.co/functions/v1/delete-account', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${accessToken()}` } : {}), Origin: origin }, body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}
const count = async table => Number((await db.query(`select count(*) from ${table}`)).rows[0].count);
try {
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, is_anonymous boolean not null default false);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
  for (const file of ['20261010000100_cloud_intake.sql', '20261011000100_support_chat.sql', '20261011000200_account_deletion.sql']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
  for (const id of [A, B]) {
    await db.query('insert into auth.users values ($1,$2,now(),false)', [id, `${id}@example.test`]);
    await db.query("insert into public.requests(user_id, request_id, payload) values($1, gen_random_uuid(), '{\"type\":\"contact\"}'),($1, gen_random_uuid(), '{\"type\":\"attorney\"}')", [id]);
    await db.query('insert into private.notification_outbox(request_id) select id from public.requests where user_id=$1', [id]);
    await db.query('insert into private.ai_usage_events(user_id) values($1)', [id]);
    await db.query("insert into public.support_messages(user_id, client_message_id, sender, body) values($1,gen_random_uuid(),'customer','Private customer text'),($1,null,'team','Private reply')", [id]);
  }
  const denied = await call({ confirmation: 'DELETE', deletionToken: secret() }, { auth: false });
  assert.equal(denied.status, 401); assert.equal(deleteCalls, 0);
  assert.equal((await call(undefined, { origin: 'https://attacker.test' })).status, 403);
  assert.equal((await call({ confirmation: 'DELETE', deletionToken: secret(), userId: B })).status, 422, 'Caller-supplied identity is rejected');
  assert.equal((await call({ confirmation: 'DELETE', deletionToken: 'a' })).status, 422);
  const current = verified;
  authAge = 601; // The user's latest sign-in on another device must not refresh this token's authentication age.
  assert.equal((await call()).body.error.code, 'recent_sign_in_required');
  authAge = 0; verified = { ...current, email_confirmed_at: null };
  assert.equal((await call()).status, 403);
  verified = current;
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select public.fillout_account_deletion_begin($1,$2)', [B, secret()]), /permission denied/);
    await assert.rejects(db.query('select public.fillout_account_deletion_status($1)', [secret()]), /permission denied/);
    await db.exec('reset role');
  }
  await db.exec(`create function public.fail_delete() returns trigger language plpgsql as $$ begin raise exception 'Simulated cascade failure'; end $$;
    create trigger fail_delete before delete on public.support_messages for each row execute function public.fail_delete();`);
  const request = { confirmation: 'DELETE', deletionToken: secret() };
  let result = await call(request);
  assert.equal(result.status, 503, 'Failed cascade cannot be reported as successful deletion');
  assert.equal(await count('auth.users'), 2);
  assert.equal(await count('public.requests'), 4, 'The complete Auth deletion transaction rolls back');
  assert.equal(await count('private.notification_outbox'), 4);
  assert.equal((await db.query('select user_id from private.account_deletion_receipts')).rows[0].user_id, A);
  await db.exec('drop trigger fail_delete on public.support_messages');
  const authenticatedCalls = authCalls;
  verified = null; loseDeleteResponse = true;
  result = await call(request, { auth: false });
  assert.equal(result.status, 503, 'An ambiguous lost HTTP response does not become a false success');
  assert.equal(authCalls, authenticatedCalls, 'A persisted random capability resumes only its originally authorized deletion');
  assert.equal(await count('auth.users'), 1);
  loseDeleteResponse = false;
  const deletions = deleteCalls;
  result = await call(request, { auth: false });
  assert.equal(result.status, 200); assert.deepEqual(result.body, { deleted: true });
  assert.equal(deleteCalls, deletions, 'Lost-response retry checks the committed anonymous receipt instead of deleting twice');
  for (const [table, expected] of [['public.requests', 2], ['private.notification_outbox', 2], ['public.support_messages', 2], ['private.ai_usage_events', 1]]) {
    assert.equal(await count(table), expected, `A's data is removed from ${table} while B is untouched`);
  }
  const receipt = (await db.query('select * from private.account_deletion_receipts')).rows[0];
  assert.equal(receipt.user_id, null);
  assert.notEqual(receipt.token_hash, request.deletionToken, 'No retry secret or account id remains in the completed receipt');
  assert.equal((await call({ ...request, deletionToken: secret() }, { auth: false })).status, 401, 'An unknown capability cannot remove any account');
  console.log('Account deletion server passed: verified/recent identity, caller-id rejection, service-only grants, atomic cascading erasure, other-account isolation, failure rollback and lost-response retries.');
} finally { await db.close(); }
