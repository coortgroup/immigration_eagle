import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';

// Explicitly destructive-to-test-data acceptance, confined to this staging project.
// Admin createUser/generateLink do not send email. Never call signup/signInWithOtp
// here: only self-owned synthetic accounts and messages may be created or deleted.
const STAGING_REF = 'ceoliqoctkgwkphbmkiv';
const CLI = '/Users/didarich/.npm/_npx/8dbd97dcbd19b90f/node_modules/supabase/bin/supabase';
const REPORT = new URL('../tmp/release-0.6.0/hosted-acceptance.json', import.meta.url);
if (process.argv.length !== 4 || process.argv[2] !== '--staging-project'
  || process.argv[3] !== STAGING_REF) {
  console.error(`Usage: node scripts/check-support-chat-hosted.mjs --staging-project ${STAGING_REF}`);
  process.exit(2);
}

const report = {
  project: STAGING_REF,
  startedAt: new Date().toISOString(),
  syntheticOnly: true,
  emailSent: false,
  checks: [],
  cleanup: { attempted: 0, removed: 0, verifiedAbsent: 0, messagesRemaining: null },
  passed: false,
};
const runTag = randomUUID();
const accounts = [];
const clients = [];
let admin;
let publicKey;
let projectUrl;
let step = 'configuration';
let failure;

class CheckFailure extends Error {
  constructor(label) { super(label); this.name = 'CheckFailure'; }
}
function ensure(value, label) { if (!value) throw new CheckFailure(label); }
function ok(label) { report.checks.push({ name: label, passed: true }); }
function safeData(result, label) {
  ensure(!result.error, label);
  return result.data;
}
function password() { return `Aa9!${randomBytes(32).toString('base64url')}`; }
function client(key = publicKey) {
  const value = createClient(projectUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20_000) }) },
  });
  clients.push(value);
  return value;
}
async function createSynthetic(label, confirmed) {
  const account = {
    id: randomUUID(), email: `${randomUUID()}@example.test`, password: password(), label,
    client: client(),
  };
  // Register the chosen ID before the request so a lost response still gets cleanup.
  accounts.push(account);
  const data = safeData(await admin.auth.admin.createUser({
    id: account.id, email: account.email, password: account.password, email_confirm: confirmed,
    app_metadata: { fillout_acceptance_run: runTag, fillout_synthetic: true },
    user_metadata: { full_name: 'Synthetic acceptance account', fillout_password_account: true },
  }), 'synthetic_create_failed');
  ensure(data.user?.id === account.id, 'synthetic_created_id_mismatch');
  return account;
}
async function signIn(account, value = account.password, into = account.client) {
  const data = safeData(await into.auth.signInWithPassword({ email: account.email, password: value }), 'password_sign_in_failed');
  ensure(data.user?.id === account.id && data.user.email_confirmed_at && data.session?.access_token, 'verified_session_missing');
  return data.session;
}
async function generatedOtp(account, type) {
  const data = safeData(await admin.auth.admin.generateLink({
    type, email: account.email, ...(type === 'signup' ? { password: account.password } : {}),
  }), 'synthetic_generate_link_failed');
  ensure(data.user?.id === account.id, 'generated_link_id_mismatch');
  ensure(/^\d{8}$/.test(data.properties?.email_otp || ''), 'hosted_otp_must_be_eight_digits');
  return data.properties.email_otp;
}
async function verifyOtp(account, token, type = 'email') {
  const data = safeData(await account.client.auth.verifyOtp({ email: account.email, token, type }), 'otp_verification_failed');
  ensure(data.user?.id === account.id && data.user.email_confirmed_at && data.session?.access_token, 'otp_verified_session_missing');
  return data.session;
}
async function authToken(account) {
  const data = safeData(await account.client.auth.getSession(), 'session_read_failed');
  ensure(data.session?.user.id === account.id, 'session_account_mismatch');
  return data.session.access_token;
}
async function request(account, body, extras = {}) {
  const response = await fetch(`${projectUrl}/functions/v1/support-chat`, {
    method: extras.method || 'POST',
    headers: {
      apikey: publicKey, 'Content-Type': 'application/json',
      ...(account ? { Authorization: `Bearer ${await authToken(account)}` } : {}),
      ...extras.headers,
    },
    ...(extras.method === 'OPTIONS' ? {} : { body: JSON.stringify(body) }),
    redirect: 'error', signal: AbortSignal.timeout(20_000),
  });
  const raw = await response.text();
  ensure(raw.length <= 65_536, 'response_too_large');
  let data = null;
  if (raw) { try { data = JSON.parse(raw); } catch { throw new CheckFailure('response_not_json'); } }
  return { status: response.status, headers: response.headers, data };
}
async function denied(query, label) {
  const result = await query;
  ensure(result.error && ['401', '403'].includes(String(result.status)) && result.error.code === '42501', label);
}

async function run() {
  const config = {};
  for (const line of (await readFile(new URL('../.env.staging.local', import.meta.url), 'utf8')).split(/\r?\n/)) {
    const match = line.trim().match(/^(EXPO_PUBLIC_SUPABASE_URL|EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY)=(.*)$/);
    if (!match) continue;
    const value = match[2].trim();
    config[match[1]] = /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value;
  }
  projectUrl = config.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
  publicKey = config.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  ensure(projectUrl === `https://${STAGING_REF}.supabase.co`, 'staging_url_mismatch');
  ensure(/^sb_publishable_[A-Za-z0-9_-]+$/.test(publicKey || ''), 'public_key_missing');
  // CLI credentials and output remain only in this process memory; never inherit stdout/stderr.
  const { stdout } = await promisify(execFile)(CLI, ['projects', 'api-keys', '--project-ref', STAGING_REF, '--output', 'json'], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
  });
  const keys = JSON.parse(stdout);
  ensure(Array.isArray(keys), 'admin_key_shape_unrecognized');
  const serviceKey = keys.find(item => item.name === 'service_role')?.api_key;
  ensure(typeof serviceKey === 'string' && serviceKey.split('.').length === 3, 'legacy_service_role_key_missing');
  admin = client(serviceKey);
  ok('staging_only_guard');

  step = 'synthetic_accounts';
  const first = await createSynthetic('first', true);
  const second = await createSynthetic('second', true);
  const signup = await createSynthetic('signup', false);
  ok('three_synthetic_accounts_created_without_email');

  step = 'auth_signup_otp';
  await verifyOtp(signup, await generatedOtp(signup, 'signup'));
  ok('signup_eight_digit_otp_verified_as_email');

  step = 'auth_password';
  await signIn(first);
  await signIn(second);
  await signIn(signup);
  ok('password_sign_in_verified_accounts');

  step = 'auth_login_otp';
  await verifyOtp(second, await generatedOtp(second, 'magiclink'));
  ok('login_eight_digit_otp_verified_as_email');

  step = 'auth_recovery';
  await verifyOtp(signup, await generatedOtp(signup, 'recovery'), 'recovery');
  const replacementPassword = password();
  const changed = safeData(await signup.client.auth.updateUser({ password: replacementPassword }), 'password_recovery_update_failed');
  ensure(changed.user?.id === signup.id, 'password_recovery_account_mismatch');
  const invalidOld = await client().auth.signInWithPassword({ email: signup.email, password: signup.password });
  ensure(invalidOld.error && !invalidOld.data.session, 'old_password_still_valid');
  await signIn(signup, replacementPassword);
  signup.password = replacementPassword;
  ok('recovery_otp_changes_password_old_password_rejected');

  step = 'auth_restore_refresh';
  const original = safeData(await first.client.auth.getSession(), 'original_session_read_failed').session;
  const restoredClient = client();
  const restored = safeData(await restoredClient.auth.setSession({
    access_token: original.access_token, refresh_token: original.refresh_token,
  }), 'session_restore_failed');
  ensure(restored.session?.user.id === first.id, 'restored_account_mismatch');
  const refreshed = safeData(await restoredClient.auth.refreshSession(), 'session_refresh_failed');
  ensure(refreshed.session?.user.id === first.id && refreshed.session?.refresh_token, 'refreshed_session_missing');
  const verified = safeData(await restoredClient.auth.getUser(), 'restored_server_verification_failed');
  ensure(verified.user?.id === first.id, 'restored_server_account_mismatch');
  first.client = restoredClient;
  ok('session_restore_refresh_server_verified');

  step = 'support_delivery';
  const clientMessageId = randomUUID();
  const body = 'Synthetic hosted acceptance: customer message.';
  const sent = await request(first, { action: 'send', clientMessageId, body });
  ensure(sent.status === 201 && sent.data?.message?.sender === 'customer'
    && sent.data.message.clientMessageId === clientMessageId && sent.data.message.body === body,
  'support_message_receipt_missing');
  const receiptId = sent.data.message.id;
  ensure(typeof receiptId === 'string', 'support_receipt_id_missing');
  const repeated = await request(first, { action: 'send', clientMessageId, body });
  ensure(repeated.status === 201 && repeated.data?.message?.id === receiptId, 'support_idempotent_retry_failed');
  const conflict = await request(first, { action: 'send', clientMessageId, body: `${body} Changed.` });
  ensure(conflict.status === 409 && conflict.data?.error?.code === 'request_conflict', 'support_idempotent_conflict_missing');
  const stored = safeData(await admin.from('support_messages').select('id,user_id,sender,body')
    .eq('user_id', first.id).eq('client_message_id', clientMessageId), 'support_storage_read_failed');
  ensure(stored.length === 1 && stored[0].id === receiptId && stored[0].sender === 'customer'
    && stored[0].body === body, 'support_delivery_not_persisted_once');
  ok('customer_message_real_receipt_and_persistence');
  ok('retry_idempotent_and_conflicting_body_rejected');

  step = 'support_team_reply';
  const teamBody = 'Synthetic hosted acceptance: human team reply.';
  const team = safeData(await admin.from('support_messages').insert({
    user_id: first.id, sender: 'team', body: teamBody,
  }).select('id').single(), 'team_reply_insert_failed');
  const conversation = await request(first, { action: 'list' });
  ensure(conversation.status === 200 && conversation.data?.messages?.length === 2
    && conversation.data.messages.some(message => message.id === receiptId)
    && conversation.data.messages.some(message => message.id === team.id && message.sender === 'team' && message.body === teamBody),
  'team_reply_not_visible_to_owner');
  ok('authorized_team_reply_visible_to_customer');

  step = 'support_isolation';
  const emptyOther = await request(second, { action: 'list' });
  ensure(emptyOther.status === 200 && emptyOther.data?.messages?.length === 0, 'cross_account_chat_leak');
  const secondSent = await request(second, { action: 'send', clientMessageId, body: 'Synthetic hosted acceptance: second account.' });
  ensure(secondSent.status === 201 && secondSent.data?.message?.id !== receiptId, 'cross_account_idempotency_collision');
  const onlyOwn = await request(second, { action: 'list' });
  ensure(onlyOwn.status === 200 && onlyOwn.data?.messages?.length === 1
    && onlyOwn.data.messages[0].id === secondSent.data.message.id, 'second_account_chat_isolation_failed');
  const deniedOther = safeData(await second.client.from('support_messages').select('id').eq('user_id', first.id), 'rls_cross_owner_read_failed');
  ensure(deniedOther.length === 0, 'rls_cross_owner_data_visible');
  const ownRows = safeData(await first.client.from('support_messages').select('id,user_id').eq('user_id', first.id), 'rls_own_read_failed');
  ensure(ownRows.length === 2 && ownRows.every(row => row.user_id === first.id), 'rls_own_data_missing');
  const forge = await request(second, { action: 'send', clientMessageId: randomUUID(), body, user_id: first.id, sender: 'team' });
  ensure(forge.status === 422, 'edge_identity_override_not_rejected');
  ok('edge_and_rls_per_account_isolation');

  step = 'support_write_permissions';
  await denied(first.client.from('support_messages').insert({ user_id: first.id, sender: 'team', body: 'Synthetic forbidden team impersonation.' }), 'direct_team_write_allowed');
  await denied(first.client.from('support_messages').insert({ user_id: first.id, sender: 'customer', client_message_id: randomUUID(), body: 'Synthetic forbidden direct write.' }), 'direct_customer_write_allowed');
  await denied(first.client.from('support_messages').update({ body: 'Synthetic forbidden edit.' }).eq('id', receiptId), 'delivered_edit_allowed');
  await denied(first.client.from('support_messages').delete().eq('id', receiptId), 'delivered_delete_allowed');
  await denied(first.client.rpc('fillout_support_send', { p_user_id: second.id, p_client_message_id: randomUUID(), p_body: 'Synthetic forbidden RPC.' }), 'direct_rpc_write_allowed');
  ok('direct_writes_impersonation_and_mutation_denied');

  step = 'support_boundary';
  const invalid = await request(null, { action: 'list' }, { headers: { Authorization: 'Bearer invalid-acceptance-token-not-a-real-session' } });
  ensure(invalid.status === 401 && invalid.data?.error?.code === 'auth_required', 'invalid_session_not_rejected');
  const cors = await request(first, { action: 'list' }, { headers: { Origin: 'https://unrelated-origin.example' } });
  ensure(cors.status === 403 && cors.data?.error?.code === 'origin_not_allowed'
    && !cors.headers.has('access-control-allow-origin'), 'unrelated_origin_not_rejected');
  const preflight = await request(null, null, {
    method: 'OPTIONS', headers: { Origin: 'https://fillout.net', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, apikey, content-type' },
  });
  ensure(preflight.status === 204 && preflight.headers.get('access-control-allow-origin') === 'https://fillout.net', 'allowed_preflight_failed');
  ok('invalid_token_and_cors_boundaries');
}

async function cleanup() {
  for (const account of accounts) {
    report.cleanup.attempted += 1;
    try {
      const found = await admin.auth.admin.getUserById(account.id);
      if (found.error?.status === 404) { report.cleanup.verifiedAbsent += 1; continue; }
      const user = safeData(found, 'cleanup_read_failed').user;
      // Never delete if the ID or immutable admin-controlled ownership tag differs.
      ensure(user?.id === account.id && user.email === account.email && user.email.endsWith('@example.test')
        && user.app_metadata?.fillout_acceptance_run === runTag && user.app_metadata?.fillout_synthetic === true,
      'cleanup_ownership_unverified');
      safeData(await admin.auth.admin.deleteUser(account.id), 'cleanup_delete_failed');
      report.cleanup.removed += 1;
      const absent = await admin.auth.admin.getUserById(account.id);
      ensure(absent.error?.status === 404 && !absent.data?.user, 'cleanup_user_still_present');
      report.cleanup.verifiedAbsent += 1;
    } catch {
      failure ||= { step: 'cleanup', reason: 'synthetic_account_cleanup_incomplete' };
    }
  }
  if (admin && accounts.length) {
    try {
      const result = await admin.from('support_messages').select('id', { count: 'exact', head: true }).in('user_id', accounts.map(account => account.id));
      ensure(!result.error && result.count === 0, 'cleanup_messages_remain');
      report.cleanup.messagesRemaining = result.count;
    } catch { failure ||= { step: 'cleanup', reason: 'synthetic_message_cleanup_unconfirmed' }; }
  }
  for (const value of clients) value.auth.stopAutoRefresh();
}

try { await run(); } catch (error) {
  // Do not emit raw SDK/CLI/network exceptions, request bodies, or credentials.
  failure = { step, reason: error instanceof CheckFailure ? error.message : 'operation_failed_without_secret_details' };
} finally {
  await cleanup();
  if (failure) report.failure = failure;
  report.passed = !failure && accounts.length === 3 && report.cleanup.verifiedAbsent === 3 && report.cleanup.messagesRemaining === 0;
  report.completedAt = new Date().toISOString();
  await mkdir(new URL('.', REPORT), { recursive: true });
  await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`${report.passed ? 'PASS' : 'FAIL'} hosted acceptance: ${report.checks.length} checks; synthetic cleanup ${report.cleanup.verifiedAbsent}/${accounts.length}.`);
  if (failure) console.log(`Failure: ${failure.step} / ${failure.reason}`);
  console.log('Sanitized report: tmp/release-0.6.0/hosted-acceptance.json');
  if (!report.passed) process.exitCode = 1;
}
