import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Public boundary checks only: no account signup, user token, user data,
// accepted database write or provider call. Passing does not prove delivery works.
const args = process.argv.slice(2);
const checkDataApi = args.length === 3 && args[2] === '--check-anon-data-api';
if ((!checkDataApi && args.length !== 2) || args[0] !== '--url') {
  console.error('Usage: node scripts/check-cloud-hosted.mjs --url https://PROJECT_REF.supabase.co [--check-anon-data-api]');
  process.exit(2);
}

let project;
try {
  project = new URL(args[1]);
  assert.equal(project.protocol, 'https:');
  assert.match(project.hostname, /^[a-z0-9]{20}\.supabase\.co$/);
  assert.equal(project.pathname, '/');
  assert.ok(!project.username && !project.password && !project.port && !project.search && !project.hash);
} catch {
  console.error('Use the HTTPS root URL of a Supabase project, without credentials, path, port, query, or fragment.');
  process.exit(2);
}

let publishableKey;
if (checkDataApi) {
  try {
    // This explicit opt-in reads this one public-only file, never credential stores.
    const lines = (await readFile(new URL('../.env.staging.local', import.meta.url), 'utf8')).split(/\r?\n/);
    const config = {};
    for (const line of lines.map(value => value.trim()).filter(value => value && !value.startsWith('#'))) {
      const match = line.match(/^(EXPO_PUBLIC_SUPABASE_URL|EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY|EXPO_PUBLIC_ENABLE_LIVE_AI)=(.*)$/);
      if (!match) throw new Error('Unexpected configuration field');
      const value = match[2].trim();
      config[match[1]] = /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value;
    }
    if (new URL(config.EXPO_PUBLIC_SUPABASE_URL).origin !== project.origin) throw new Error('Project mismatch');
    publishableKey = config.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey || '')) throw new Error('Expected a publishable key');
  } catch {
    console.error('The optional Data API checks require matching public URL and publishable key in .env.staging.local. Configuration values are not logged.');
    process.exit(2);
  }
}

async function responseText(response) {
  const reader = response.body?.getReader();
  const chunks = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        assert.ok(size <= 8192, 'Unexpectedly large public response');
        chunks.push(value);
      }
    } finally { reader.cancel().catch(() => {}); }
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
const cases = [
  {
    label: 'allowed preflight', method: 'OPTIONS', status: 204,
    headers: { Origin: 'https://fillout.net', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, apikey, content-type' },
    check(response, text) {
      assert.equal(text, '');
      assert.equal(response.headers.get('access-control-allow-origin'), 'https://fillout.net');
      assert.match(response.headers.get('access-control-allow-methods') || '', /\bPOST\b/);
      assert.match(response.headers.get('access-control-allow-headers') || '', /authorization/i);
    },
  },
  {
    label: 'missing authentication', method: 'POST', status: 401, code: 'auth_required',
    headers: { Origin: 'https://fillout.net', 'Content-Type': 'application/json' }, body: '{}',
    check(response) { assert.equal(response.headers.get('access-control-allow-origin'), 'https://fillout.net'); },
  },
  {
    label: 'invalid authentication', method: 'POST', status: 401, code: 'auth_required',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer invalid-smoke-test-token-not-a-real-session' }, body: '{}',
    check(response) { assert.equal(response.headers.get('access-control-allow-origin'), null); },
  },
  {
    label: 'unrelated origin rejected', method: 'POST', status: 403, code: 'origin_not_allowed',
    headers: { Origin: 'https://unrelated-origin.example', 'Content-Type': 'application/json' }, body: '{}',
    check(response) { assert.equal(response.headers.get('access-control-allow-origin'), null); },
  },
];

async function checkFunction(name) {
  for (const test of cases) {
    try {
      const response = await fetch(new URL(`/functions/v1/${name}`, project), {
        method: test.method, headers: test.headers, body: test.body,
        redirect: 'error', signal: AbortSignal.timeout(15_000),
      });
      // Public error/preflight responses are small. Bound the read as well.
      const text = await responseText(response);
      assert.equal(response.status, test.status, `Expected HTTP ${test.status}; received ${response.status}`);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      if (test.code) assert.equal(JSON.parse(text)?.error?.code, test.code, 'Expected application authentication/CORS error');
      test.check(response, text);
      console.log(`PASS ${name}: ${test.label} (HTTP ${response.status})`);
    } catch (error) {
      // Never print response bodies or request authorization headers.
      throw new Error(`${name}: ${test.label} failed: ${error instanceof Error ? error.message : 'unexpected error'}`);
    }
  }
}

async function checkAnonymousDataApi() {
  const tests = [
    { label: 'anonymous request reads denied', path: '/rest/v1/requests?select=id&limit=1', status: [401, 403], code: '42501' },
    // Null user IDs fail database verification even if a grant is accidentally
    // broadened. These checks cannot create a request or consume an AI slot.
    { label: 'anonymous intake RPC denied', path: '/rest/v1/rpc/fillout_submit_request', method: 'POST', payload: { p_user_id: null, p_request_id: null, p_payload: null }, status: [401, 403], code: '42501' },
    { label: 'anonymous AI quota RPC denied', path: '/rest/v1/rpc/fillout_consume_ai_quota', method: 'POST', payload: { p_user_id: null }, status: [401, 403], code: '42501' },
    { label: 'private schema not exposed', path: '/rest/v1/notification_outbox?select=request_id&limit=1', headers: { 'Accept-Profile': 'private' }, status: [406], code: 'PGRST106' },
  ];
  for (const test of tests) {
    try {
      const response = await fetch(new URL(test.path, project), {
        method: test.method || 'GET',
        headers: { apikey: publishableKey, 'Content-Type': 'application/json', ...test.headers },
        ...(test.payload ? { body: JSON.stringify(test.payload) } : {}),
        redirect: 'error', signal: AbortSignal.timeout(15_000),
      });
      assert.ok(test.status.includes(response.status), `Unexpected HTTP ${response.status}`);
      const result = JSON.parse(await responseText(response));
      // On unexpected exposure never print response rows or key material.
      assert.ok(result?.code === test.code, 'Expected database permission/schema rejection');
      console.log(`PASS Data API: ${test.label} (HTTP ${response.status})`);
    } catch (error) {
      throw new Error(`Data API: ${test.label} failed: ${error instanceof Error ? error.message : 'unexpected error'}`);
    }
  }
}

const results = await Promise.allSettled([
  ...['submit-request', 'ai-assistant'].map(checkFunction),
  ...(checkDataApi ? [checkAnonymousDataApi()] : []),
]);
const failures = results.filter(result => result.status === 'rejected');
if (failures.length) {
  for (const failure of failures) console.error(failure.reason.message);
  process.exitCode = 1;
} else {
  console.log('Hosted boundary checks passed. Verified-user persistence, OTP delivery, owner isolation and live AI still require separate acceptance checks.');
}
