// Exercise the compiled client contracts without contacting an auth/AI service.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
function compile(file) {
  return ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const cloudJs = compile('src/cloudClient.ts');
const deliveryJs = compile('src/requestDelivery.ts');
const validEnv = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://exampleproject.supabase.co',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example0123456789',
};
const verifiedSession = {
  access_token: 'test-token',
  user: { id: 'test-account', email: 'sample@example.com', email_confirmed_at: '2026-10-10', is_anonymous: false },
};

function createCloud(env = {}) {
  let session = null, options = null, authError = null;
  let shortTimeouts = false;
  let fetchReply = async () => new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } });
  let reply = { data: { answer: 'Example' }, error: null };
  const calls = [], fetches = [], timeouts = [];
  class FunctionsHttpError extends Error {
    constructor(body) { super('upstream'); this.context = { json: async () => body }; }
  }
  const api = {
    auth: {
      onAuthStateChange: () => ({}),
      getSession: async () => ({ data: { session }, error: null }),
      signInWithOtp: async args => { calls.push(['otp', args]); return { error: authError }; },
      verifyOtp: async args => { calls.push(['verify', args]); return { data: { user: session?.user, session }, error: authError }; },
      signOut: async args => { calls.push(['signout', args]); session = null; return { error: null }; },
    },
    functions: { invoke: async (name, input) => { calls.push(['invoke', name, input]); return reply; } },
  };
  const exports = {};
  vm.runInNewContext(cloudJs, {
    exports,
    require: id => {
      if (id === 'react') return { useSyncExternalStore: (_, snapshot) => snapshot() };
      if (id === 'react-native') return { Platform: { OS: 'web' } };
      if (id === '@supabase/supabase-js') return {
        createClient: (_url, _key, config) => { options = config; return api; }, FunctionsHttpError,
      };
      throw Error(`Unexpected import: ${id}`);
    },
    process: { env }, URL, AbortController, Response,
    fetch: async (url, init) => { fetches.push({ url, init }); return fetchReply(url, init); },
    setTimeout: (callback, delay) => { timeouts.push(delay); return setTimeout(callback, shortTimeouts ? 5 : delay); },
    clearTimeout,
  });
  return {
    exports, calls, options, fetches, timeouts, FunctionsHttpError,
    setSession: value => { session = value; }, setReply: value => { reply = value; },
    setAuthError: value => { authError = value; },
    setFetch: value => { fetchReply = value; }, useShortTimeouts: () => { shortTimeouts = true; },
  };
}

function createDelivery(flags, server) {
  let uuid = 0;
  const exports = {};
  vm.runInNewContext(deliveryJs, {
    exports,
    require: id => {
      if (id === 'react') return { useCallback: fn => fn, useRef: value => ({ current: value }) };
      if (id === 'expo-crypto') return { randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}` };
      if (id === './cloudClient') return {
        ...flags, useCloudSession: () => ({ user: flags.user || null, loading: Boolean(flags.loading) }),
        invokeCloudFunction: async (name, body) => { server.cloudCalls.push({ name, body }); return server.reply; },
      };
      if (id === './localRequests') return {
        useLocalDelivery: () => ({ available: true, checking: false }),
        submitLocalRequest: async payload => { server.localCalls.push(payload); return { id: 'local-id' }; },
      };
      throw Error(`Unexpected import: ${id}`);
    },
  });
  return exports;
}

async function main() {
  const unconfigured = createCloud();
  assert.equal(unconfigured.exports.cloudRequested, false);
  assert.equal(unconfigured.options, null);
  await assert.rejects(() => unconfigured.exports.invokeCloudFunction('submit-request', {}), /not connected/);
  for (const url of [
    '', 'http://exampleproject.supabase.co', 'https://supabase.co', 'https://exampleproject.supabase.co.evil.test',
    'https://exampleproject.supabase.co/path', 'https://exampleproject.supabase.co?leak=1',
    'https://user@exampleproject.supabase.co', 'https://exampleproject.supabase.co:8080',
  ]) {
    const client = createCloud({ ...validEnv, EXPO_PUBLIC_SUPABASE_URL: url });
    assert.equal(client.exports.cloudConfigured, false, url);
    assert(client.exports.cloudConfigurationError);
    assert.equal(client.options, null, 'Invalid configuration must not construct a network client.');
  }
  for (const key of ['', 'sb_secret_example', 'eyJhbGciOiJIUzI1NiJ9.example.jwt']) {
    assert.equal(createCloud({ ...validEnv, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key }).exports.cloudConfigured, false);
  }
  const client = createCloud(validEnv);
  assert.equal(client.exports.cloudConfigured, true);
  assert.equal(client.options.auth.persistSession, false);
  assert.equal(client.options.auth.detectSessionInUrl, false);
  assert.equal(client.options.auth.autoRefreshToken, true);
  await client.options.global.fetch('https://exampleproject.supabase.co/auth/v1/otp');
  await client.options.global.fetch('https://exampleproject.supabase.co/functions/v1/ai-assistant');
  assert.deepEqual(client.timeouts, [25_000, 55_000]);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(() => client.options.global.fetch('https://exampleproject.supabase.co/auth/v1/otp', { signal: cancelled.signal }), /cancelled/);
  assert.equal(client.fetches.at(-1).init.signal.aborted, true);
  client.setFetch(async () => new Response('{"error":{"message":"Try later"}}', { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '60' } }));
  const bufferedError = await client.options.global.fetch('https://exampleproject.supabase.co/functions/v1/submit-request');
  assert.equal(bufferedError.status, 429); assert.equal(bufferedError.headers.get('retry-after'), '60');
  assert.equal((await bufferedError.json()).error.message, 'Try later');
  client.setFetch(async () => new Response(new Uint8Array(1_048_577)));
  await assert.rejects(() => client.options.global.fetch('https://exampleproject.supabase.co/auth/v1/otp'), /too large/);
  let streamCancelled = false;
  client.setFetch(async () => new Response(new ReadableStream({ cancel() { streamCancelled = true; } })));
  client.useShortTimeouts();
  await assert.rejects(() => client.options.global.fetch('https://exampleproject.supabase.co/functions/v1/ai-assistant'), /timed out/);
  assert.equal(streamCancelled, true, 'The timeout must cover the response body and cancel its stream after headers arrive.');

  await assert.rejects(() => client.exports.invokeCloudFunction('ai-assistant', {}), /Verify your email/);
  client.setSession({ ...verifiedSession, user: { ...verifiedSession.user, email_confirmed_at: undefined } });
  await assert.rejects(() => client.exports.invokeCloudFunction('ai-assistant', {}), /Verify your email/);
  client.setSession({ ...verifiedSession, user: { ...verifiedSession.user, is_anonymous: true } });
  await assert.rejects(() => client.exports.invokeCloudFunction('ai-assistant', {}), /Verify your email/);
  client.setSession(verifiedSession);
  assert.equal((await client.exports.invokeCloudFunction('ai-assistant', { consent: true })).answer, 'Example');
  const invocation = client.calls.at(-1);
  assert.equal(invocation[1], 'ai-assistant');
  assert.equal(invocation[2].headers.Authorization, 'Bearer test-token');
  assert.equal(invocation[2].body.consent, true);

  await assert.rejects(() => client.exports.requestEmailCode('invalid'), /valid email/);
  await client.exports.requestEmailCode(' SAMPLE@EXAMPLE.COM ');
  assert.equal(client.calls.at(-1)[1].email, 'sample@example.com');
  client.setAuthError({ status: 429 });
  await assert.rejects(() => client.exports.requestEmailCode('sample@example.com'), /wait before requesting/);
  client.setAuthError(null);
  await assert.rejects(() => client.exports.verifyEmailCode('sample@example.com', '123'), /six-digit/);
  await client.exports.verifyEmailCode('sample@example.com', '123456');
  assert.equal(client.calls.at(-1)[1].type, 'email');
  assert.equal(client.exports.useCloudSession().user.id, 'test-account');
  client.setSession({ ...verifiedSession, user: { ...verifiedSession.user, id: 'different-account' } });
  const callsBeforeSwitch = client.calls.length;
  await assert.rejects(() => client.exports.invokeCloudFunction('submit-request', {}), /account changed/);
  assert.equal(client.calls.length, callsBeforeSwitch, 'No data is sent when the active account changes during session lookup.');
  client.setSession(verifiedSession);
  client.setReply({ data: null, error: new client.FunctionsHttpError({ error: { code: 'LIMIT', message: 'Try again later.' } }) });
  await assert.rejects(() => client.exports.invokeCloudFunction('ai-assistant', {}), /Try again later/);
  client.setReply({ data: null, error: new Error('internal implementation detail') });
  await assert.rejects(() => client.exports.invokeCloudFunction('ai-assistant', {}), /Could not reach the online service/);
  client.setReply({ data: null, error: null });
  await assert.rejects(() => client.exports.invokeCloudFunction('ai-assistant', {}), /did not confirm the result/);
  await client.exports.signOutCloud();
  assert.equal(client.exports.useCloudSession().user, null);
  assert.equal(client.calls.at(-1)[1].scope, 'local');

  const server = { localCalls: [], cloudCalls: [], reply: null };
  const delivery = createDelivery({ cloudRequested: true, cloudConfigured: true }, server);
  assert.equal(delivery.useRequestDelivery().canSubmit, false);
  assert.equal(createDelivery({ cloudRequested: true, cloudConfigured: true, user: verifiedSession.user }, server).useRequestDelivery().canSubmit, true);
  assert.equal(createDelivery({ cloudRequested: true, cloudConfigured: true, user: verifiedSession.user, loading: true }, server).useRequestDelivery().canSubmit, false);
  const payload = { type: 'contact', name: 'Sample', email: 'sample@example.com', question: 'Test' };
  const identity = delivery.useRequestIdentity();
  const first = identity.getId(payload, 'one');
  assert.equal(identity.getId(payload, 'one'), first, 'Retry reuses the request identity.');
  assert.notEqual(identity.getId(payload, 'two'), first, 'A different account gets a different identity.');
  assert.notEqual(identity.getId({ ...payload, question: 'Edited' }, 'one'), first);
  identity.reset(); assert.notEqual(identity.getId(payload, 'one'), first, 'Editing and restoring a value still starts a new request.');

  const rowId = '12345678-1234-4234-8234-123456789012';
  const receipt = { id: rowId, requestId: first, delivery: 'team-inbox', externalNotification: false };
  server.reply = receipt;
  assert.equal((await delivery.submitRequest(payload, first)).id, rowId);
  assert.equal(server.cloudCalls.at(-1).body.requestId, first);
  assert.equal(server.localCalls.length, 0);
  // A receipt cannot be accepted for another request, an external notification, or an unknown storage target.
  for (const bad of [
    { ...receipt, requestId: 'different' }, { ...receipt, requestId: undefined }, { ...receipt, id: 'invalid' },
    { ...receipt, delivery: 'other-inbox' }, { ...receipt, externalNotification: true }, null,
  ]) {
    server.reply = bad;
    await assert.rejects(() => delivery.submitRequest(payload, first), /did not confirm delivery/);
  }
  assert.equal(server.cloudCalls.at(-1).body.requestId, first, 'Failed receipts do not silently create another identity.');
  assert.equal(server.localCalls.length, 0, 'A failed cloud call cannot fall back to the local inbox.');
  const misconfigured = createDelivery({ cloudRequested: true, cloudConfigured: false, cloudConfigurationError: 'Misconfigured' }, server);
  assert.equal(misconfigured.useRequestDelivery().available, false);
  await assert.rejects(() => misconfigured.submitRequest(payload, first), /Misconfigured/);
  assert.equal(server.localCalls.length, 0);
  const local = createDelivery({ cloudRequested: false, cloudConfigured: false }, server);
  assert.equal((await local.submitRequest(payload, first)).delivery, 'local-inbox');
  assert.equal(server.localCalls.length, 1);
  console.log('Cloud client: configuration boundaries, memory-only authentication, email verification, bounded requests, backend errors, delivery receipts, and retry identity passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
