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
  let accountReply = null, authListener, authHook = async () => {};
  const storage = { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} };
  let shortTimeouts = false;
  let fetchReply = async () => new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } });
  let reply = { data: { answer: 'Example' }, error: null };
  const calls = [], fetches = [], timeouts = [];
  class FunctionsHttpError extends Error {
    constructor(body) { super('upstream'); this.context = { json: async () => body }; }
  }
  async function accountCall(method, args) {
    calls.push([method, args]);
    const result = accountReply || { data: { user: session?.user || null, session }, error: authError };
    return await authHook(method, args) || result;
  }
  const api = {
    auth: {
      onAuthStateChange: listener => { authListener = listener; return {}; },
      getSession: async () => ({ data: { session }, error: null }),
      signInWithOtp: async args => { calls.push(['otp', args]); return { error: authError }; },
      verifyOtp: async args => { calls.push(['verify', args]); return { data: { user: session?.user, session }, error: authError }; },
      signUp: args => accountCall('signup', args),
      signInWithPassword: args => accountCall('password', args),
      updateUser: args => accountCall('update', args),
      getUser: () => accountCall('user'),
      refreshSession: () => accountCall('refresh'),
      signOut: async args => { calls.push(['signout', args]); if (!authError) session = null; return { error: authError }; },
    },
    functions: { invoke: async (name, input) => { calls.push(['invoke', name, input]); return reply; } },
  };
  const exports = {};
  vm.runInNewContext(cloudJs, {
    exports,
    require: id => {
      if (id === 'react') return { useSyncExternalStore: (_, snapshot) => snapshot() };
      if (id === 'react-native') return { Platform: { OS: 'web' } };
      if (id === './accountStorage') return { accountStorage: storage };
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
    exports, calls, options, fetches, timeouts, FunctionsHttpError, storage,
    setSession: value => { session = value; }, setReply: value => { reply = value; },
    setAuthError: value => { authError = value; },
    setAccountReply: value => { accountReply = value; }, setAuthHook: value => { authHook = value; },
    emitSession: value => { session = value; authListener?.('SIGNED_IN', session); },
    setFetch: value => { fetchReply = value; }, useShortTimeouts: () => { shortTimeouts = true; },
  };
}

// Exercise actual SDK persistence and auth events; the transport below never
// contacts a server, sends an email or creates a real account.
async function checkPersistentProfileRefresh() {
  const supabase = require('@supabase/supabase-js');
  const values = new Map();
  const storage = {
    getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
    removeItem: async key => { values.delete(key); },
  };
  let email = 'before@example.com', name = 'Original profile';
  let requests = 0;
  const clients = [];
  const user = () => ({
    ...verifiedSession.user, email, user_metadata: { full_name: name },
    aud: 'authenticated', app_metadata: { provider: 'email' }, created_at: '2026-10-10',
  });
  const session = () => ({
    access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', token_type: 'bearer',
    expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: user(),
  });
  function instance() {
    const exports = {};
    let sdk;
    vm.runInNewContext(cloudJs, {
      exports, require(id) {
        if (id === 'react') return { useSyncExternalStore: (_, snapshot) => snapshot() };
        if (id === 'react-native') return { Platform: { OS: 'web' } };
        if (id === './accountStorage') return { accountStorage: storage };
        if (id === '@supabase/supabase-js') return { ...supabase, createClient(...args) {
          sdk = supabase.createClient(...args); clients.push(sdk); return sdk;
        } };
        throw new Error(`Unexpected SDK-test import: ${id}`);
      },
      process: { env: validEnv }, URL, AbortController, Response, setTimeout, clearTimeout,
      fetch: async input => {
        requests++;
        const url = new URL(String(input));
        assert.equal(url.origin, validEnv.EXPO_PUBLIC_SUPABASE_URL);
        if (url.pathname === '/auth/v1/token') return Response.json(session());
        if (url.pathname === '/auth/v1/user') return Response.json(user());
        throw new Error(`Unexpected offline SDK-test endpoint: ${url.pathname}`);
      },
    });
    return { exports, sdk };
  }
  try {
    const original = instance();
    await original.sdk.auth.getSession();
    await original.exports.signInWithPassword(email, 'Synthetic-password-123');
    email = 'after@example.com'; name = 'Confirmed updated profile';
    await original.exports.refreshCloudUser();
    assert.equal(original.exports.useCloudSession().user.email, email);
    assert.equal((await original.sdk.auth.getSession()).data.session.user.email, email, 'Refresh profile must persist the newly confirmed email, not only update React state');
    await original.sdk.auth.stopAutoRefresh();
    const requestCount = requests;
    const reopened = instance();
    await reopened.sdk.auth.getSession();
    await new Promise(setImmediate);
    assert.equal(reopened.exports.useCloudSession().user.email, email, 'The new email survives a cold start before token expiry');
    assert.equal(reopened.exports.useCloudSession().user.user_metadata.full_name, name);
    assert.equal(requests, requestCount, 'The restart must prove saved session recovery without another network refresh');
  } finally {
    await Promise.all(clients.map(client => client.auth.stopAutoRefresh()));
  }
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
  assert.equal(client.options.auth.persistSession, true);
  assert.equal(client.options.auth.storage, client.storage, 'Persistent auth must use the account storage adapter');
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
  assert.equal((await client.options.global.fetch('https://exampleproject.supabase.co/functions/v1/form-review')).status, 200, 'Only the authenticated PDF endpoint gets a larger response bound');
  await assert.rejects(() => client.options.global.fetch('https://exampleproject.supabase.co/functions/v1/support-chat'), /too large/);
  await assert.rejects(() => client.options.global.fetch('https://exampleproject.supabase.co/functions/v1/form-review-other'), /too large/);
  client.setFetch(async () => new Response('oversized', { headers: { 'Content-Length': String(12 * 1024 * 1024 + 1) } }));
  await assert.rejects(() => client.options.global.fetch('https://exampleproject.supabase.co/functions/v1/form-review'), /too large/);
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
  assert.equal(client.calls.at(-1)[1].options.shouldCreateUser, true, 'Existing verification flow retains explicit account creation');
  client.setAuthError({ status: 429 });
  await assert.rejects(() => client.exports.requestEmailCode('sample@example.com'), /wait before requesting/);
  client.setAuthError(null);
  const callsBeforeInvalidCodes = client.calls.length;
  for (const invalidCode of ['123', '123456', '1234567', '123456789', '1234567a']) {
    await assert.rejects(() => client.exports.verifyEmailCode('sample@example.com', invalidCode), /eight-digit/);
  }
  assert.equal(client.calls.length, callsBeforeInvalidCodes, 'Malformed verification codes never reach Auth.');
  await client.exports.verifyEmailCode('sample@example.com', ' 12345678 ');
  assert.equal(client.calls.at(-1)[1].type, 'email');
  assert.equal(client.calls.at(-1)[1].token, '12345678', 'All eight OTP digits must be forwarded unchanged.');
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

  const account = createCloud(validEnv);
  const profile = { name: ' Sample Person ', email: ' SAMPLE@EXAMPLE.COM ', phone: ' +1 (555) 555-0123 ' };
  const password = 'Synthetic-password-123';
  const json = value => JSON.parse(JSON.stringify(value));
  await new Promise(setImmediate);
  const noCalls = account.calls.length;
  for (const invalid of [
    { ...profile, email: '' }, { ...profile, email: 'invalid' }, { ...profile, name: 'X'.repeat(121) },
    { ...profile, phone: '' }, { ...profile, phone: '   ' }, { ...profile, phone: '123' }, { ...profile, phone: 'phone' },
  ]) await assert.rejects(account.exports.signUpWithPassword(invalid, password));
  await assert.rejects(account.exports.signUpWithPassword(profile, ''), /Enter your password/);
  await assert.rejects(account.exports.changeCloudPassword(''), /Enter your password/);
  await assert.rejects(account.exports.signInWithPassword('invalid', password), /valid email/);
  await assert.rejects(account.exports.signInWithPassword(profile.email, ''), /Enter your password/);
  await assert.rejects(account.exports.saveCloudProfile(profile), /sign in again/);
  await assert.rejects(account.exports.changeCloudPassword(password), /sign in again/);
  await assert.rejects(account.exports.requestCloudEmailChange('new@example.com', password), /sign in again/);
  await assert.rejects(account.exports.refreshCloudUser(), /sign in again/);
  assert.equal(account.calls.length, noCalls, 'Invalid/local-only account actions must never reach Auth');

  account.setAccountReply({ data: { user: { ...verifiedSession.user, email_confirmed_at: undefined }, session: null }, error: null });
  assert.deepEqual(json(await account.exports.signUpWithPassword(profile, password)), { email: 'sample@example.com', confirmationRequired: true, passwordSetupRequired: true });
  assert.deepEqual(json(account.calls.at(-1)), ['signup', { email: 'sample@example.com', password, options: { data: { full_name: 'Sample Person', phone: '+1 (555) 555-0123', fillout_password_account: true } } }]);
  assert.equal(account.exports.useCloudSession().user, null, 'Pending email confirmation must not sign in');
  for (const candidate of ['a', 'abcdef', '123456', 'X'.repeat(129), 'пароль🙂']) {
    await account.exports.signUpWithPassword({ email: profile.email, phone: profile.phone }, candidate);
    assert.deepEqual(json(account.calls.at(-1)), ['signup', { email: 'sample@example.com', password: candidate, options: { data: { phone: '+1 (555) 555-0123', fillout_password_account: true } } }], 'The client forwards passwords unchanged and does not invent a name; Auth enforces provider limits');
  }
  account.setAccountReply({ data: { user: { ...verifiedSession.user, email_confirmed_at: undefined, user_metadata: { fillout_password_account: true } }, session: null }, error: null });
  assert.equal((await account.exports.signUpWithPassword(profile, password)).passwordSetupRequired, false, 'A new password signup keeps the server-confirmed password marker');
  account.setAccountReply({ data: { user: { ...verifiedSession.user, email_confirmed_at: undefined, user_metadata: { full_name: 'Legacy OTP account' } }, session: null }, error: null });
  assert.equal((await account.exports.signUpWithPassword(profile, password)).passwordSetupRequired, true, 'An existing OTP account must not assume the submitted password was saved');
  account.setAccountReply(null);
  account.setAuthError({ status: 422, code: 'weak_password', message: 'Password should be at least 6 characters.' });
  await assert.rejects(account.exports.signUpWithPassword(profile, 'a'), /sign-in service requires at least 6 characters/);
  account.setAuthError({ status: 422, code: 'weak_password', message: 'Private backend diagnostic' });
  await assert.rejects(account.exports.signUpWithPassword(profile, 'a'), /sign-in service did not accept this password/);
  account.setAuthError({ status: 400, code: 'validation_failed', message: 'Password cannot be longer than 72 characters' });
  await assert.rejects(account.exports.signUpWithPassword(profile, 'X'.repeat(129)), /too long for the sign-in service/);
  account.setAuthError({ status: 400, code: 'validation_failed', message: 'Private backend diagnostic' });
  await assert.rejects(account.exports.signUpWithPassword(profile, password), /account could not be created/);
  account.setAuthError({ status: 429 });
  await assert.rejects(account.exports.signUpWithPassword(profile, password), /wait before trying again/);
  account.setAuthError({ status: 500, message: 'Private backend diagnostic' });
  await assert.rejects(account.exports.signUpWithPassword(profile, password), /account could not be created/);
  await assert.rejects(account.exports.signInWithPassword(profile.email, password), /Could not sign in/);
  account.setAuthError(null);
  for (const invalidSession of [null, { ...verifiedSession, user: { ...verifiedSession.user, email_confirmed_at: undefined } }, { ...verifiedSession, user: { ...verifiedSession.user, is_anonymous: true } }]) {
    account.setSession(invalidSession);
    await assert.rejects(account.exports.signInWithPassword(profile.email, password), /Could not sign in/);
  }
  account.setSession(verifiedSession);
  assert.equal((await account.exports.signUpWithPassword(profile, password)).confirmationRequired, false);
  assert.equal(account.exports.useCloudSession().user.id, verifiedSession.user.id);
  await account.exports.signInWithPassword(profile.email, password);
  assert.deepEqual(json(account.calls.at(-1)), ['password', { email: 'sample@example.com', password }]);

  await account.exports.requestSignInCode(' SAMPLE@EXAMPLE.COM ');
  assert.deepEqual(json(account.calls.at(-1)), ['otp', { email: 'sample@example.com', options: { shouldCreateUser: false } }]);
  account.setAuthError({ status: 429 });
  await assert.rejects(account.exports.requestSignInCode(profile.email), /wait before requesting/);
  account.setAuthError({ status: 500 });
  await assert.rejects(account.exports.requestSignInCode(profile.email), /verification email could not be sent/);
  account.setAuthError(null);

  await account.exports.saveCloudProfile(profile);
  assert.deepEqual(json(account.calls.at(-1)), ['update', { data: { full_name: 'Sample Person', phone: '+1 (555) 555-0123' } }]);
  await account.exports.saveCloudProfile({ phone: profile.phone });
  assert.deepEqual(json(account.calls.at(-1)), ['update', { data: { phone: '+1 (555) 555-0123' } }], 'Saving contact details preserves the existing account name by omitting it');
  const beforeEmptyPhone = account.calls.length;
  await assert.rejects(account.exports.saveCloudProfile({ phone: ' ' }), /Enter your phone number/);
  assert.equal(account.calls.length, beforeEmptyPhone);
  await account.exports.changeCloudPassword(password);
  assert.deepEqual(json(account.calls.at(-1)), ['update', { password, data: { fillout_password_account: true } }]);
  for (const candidate of ['abcdef', 'X'.repeat(129)]) {
    await account.exports.changeCloudPassword(candidate);
    assert.equal(account.calls.at(-1)[1].password, candidate);
    await account.exports.signInWithPassword(profile.email, candidate);
    assert.equal(account.calls.at(-1)[1].password, candidate);
  }
  account.setAuthError({ status: 422, code: 'weak_password', message: 'Password should be at least 6 characters.' });
  await assert.rejects(account.exports.changeCloudPassword('a'), /sign-in service requires at least 6 characters/);
  account.setAuthError(null);
  for (const data of [{ user: null }, { user: { ...verifiedSession.user, id: 'other-account' } }]) {
    account.setAccountReply({ data, error: null });
    await assert.rejects(account.exports.saveCloudProfile(profile), /profile could not be saved/);
    await assert.rejects(account.exports.changeCloudPassword(password), /password could not be updated/);
    assert.equal(account.exports.useCloudSession().user.id, verifiedSession.user.id);
  }
  account.setAccountReply(null);
  account.setAuthError({ status: 500 });
  await assert.rejects(account.exports.saveCloudProfile(profile), /profile could not be saved/);
  await assert.rejects(account.exports.changeCloudPassword(password), /password could not be updated/);
  const beforeBadPassword = account.calls.length;
  await assert.rejects(account.exports.requestCloudEmailChange('new@example.com', password), /Could not sign in/);
  assert.equal(account.calls.length, beforeBadPassword + 1, 'Failed reauthentication must not request an email change');
  account.setAuthError(null);
  assert.equal(await account.exports.requestCloudEmailChange(' NEW@EXAMPLE.COM ', password), true, 'Keep the old email until backend confirmation');
  assert.deepEqual(json(account.calls.slice(-2)), [['password', { email: 'sample@example.com', password }], ['update', { email: 'new@example.com' }]]);
  account.setAuthHook(async method => method === 'update' ? { data: { user: { ...verifiedSession.user, email: 'new@example.com' } }, error: null } : undefined);
  assert.equal(await account.exports.requestCloudEmailChange('new@example.com', password), false);
  assert.equal(account.exports.useCloudSession().user.email, 'new@example.com');
  account.setAuthHook(async () => {});
  account.emitSession(verifiedSession);
  account.setAuthHook(async method => method === 'update' ? { data: { user: null }, error: { status: 500 } } : undefined);
  await assert.rejects(account.exports.requestCloudEmailChange('new@example.com', password), /email could not be updated/);
  account.setAuthHook(async () => {});

  account.setAuthError({ status: 500 });
  await assert.rejects(account.exports.refreshCloudUser(), /Could not check your sign-in/);
  await assert.rejects(account.exports.signOutCloud(), /Could not sign out/);
  assert.equal(account.exports.useCloudSession().user.id, verifiedSession.user.id, 'Failed sign-out must retain the visible account');
  account.setAuthError(null);
  await account.exports.refreshCloudUser();
  assert.equal(account.calls.at(-1)[0], 'refresh');
  for (const data of [
    { user: verifiedSession.user, session: null },
    { user: { ...verifiedSession.user, email_confirmed_at: undefined }, session: verifiedSession },
    { user: { ...verifiedSession.user, id: 'wrong-account' }, session: verifiedSession },
  ]) {
    account.setAccountReply({ data, error: null });
    await assert.rejects(account.exports.refreshCloudUser(), /Could not check your sign-in/);
    assert.equal(account.exports.useCloudSession().user.id, verifiedSession.user.id);
  }
  account.setAccountReply(null);
  // A result from an earlier account must not overwrite a subsequent auth event.
  for (const method of ['saveCloudProfile', 'changeCloudPassword', 'refreshCloudUser']) {
    account.emitSession(verifiedSession);
    let release;
    account.setAuthHook(() => new Promise(resolve => { release = resolve; }));
    const pending = account.exports[method](method === 'saveCloudProfile' ? profile : password);
    const result = method === 'refreshCloudUser' ? pending : assert.rejects(pending, /could not be saved|could not be updated/);
    account.emitSession({ ...verifiedSession, user: { ...verifiedSession.user, id: 'new-account' } });
    release(); await result;
    assert.equal(account.exports.useCloudSession().user.id, 'new-account', `${method}: a late result cannot overwrite the current account`);
  }
  account.setAuthHook(async () => {});
  await account.exports.signOutCloud();
  assert.equal(account.exports.useCloudSession().user, null);
  await checkPersistentProfileRefresh();

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
  {
    const app = createCloud(validEnv); await new Promise(setImmediate);
    app.emitSession(verifiedSession);
    const deletionToken = 'a'.repeat(64);
    app.setFetch(async () => Response.json({ deleted: true }));
    await app.exports.deleteCloudAccount(deletionToken, verifiedSession.user.id);
    assert.equal(app.fetches.at(-1).init.headers.Authorization, 'Bearer test-token');
    assert.deepEqual(JSON.parse(app.fetches.at(-1).init.body), { confirmation: 'DELETE', deletionToken });
    assert.equal(app.fetches.at(-1).url, validEnv.EXPO_PUBLIC_SUPABASE_URL + '/functions/v1/delete-account');
    app.emitSession(null);
    await app.exports.deleteCloudAccount(deletionToken, verifiedSession.user.id);
    assert.equal(app.fetches.at(-1).init.headers.Authorization, undefined, 'Lost-response retry works after Auth removes the session');
    app.setFetch(async () => Response.json({ deleted: false }));
    await assert.rejects(app.exports.deleteCloudAccount(deletionToken, verifiedSession.user.id), /not been confirmed/);
    app.setFetch(async () => Response.json({ error: { message: 'Verify your email again before deleting your account.' } }, { status: 401 }));
    await assert.rejects(app.exports.deleteCloudAccount(deletionToken, verifiedSession.user.id), /Verify your email again/);
    app.emitSession({ ...verifiedSession, user: { ...verifiedSession.user, id: 'another-account' } });
    const calls = app.fetches.length;
    await assert.rejects(app.exports.deleteCloudAccount(deletionToken, verifiedSession.user.id), /account changed/);
    assert.equal(app.fetches.length, calls, 'A replacement identity cannot authorize deleting the retained account');
  }
  console.log('Cloud client passed: persistent storage adapter, registration/password/OTP/profile/email/recovery contracts, account race protection, configuration boundaries, bounded requests and delivery receipts.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
