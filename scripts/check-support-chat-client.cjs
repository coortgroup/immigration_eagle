const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
const compiled = ts.transpileModule(fs.readFileSync('src/supportChat.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
let response;
const calls = [];
const moduleRef = { exports: {} };
vm.runInNewContext(compiled, {
  exports: moduleRef.exports, module: moduleRef,
  require(name) {
    if (name === 'expo-crypto') return { randomUUID };
    if (name === './cloudClient') return { invokeCloudFunction: async (name, body) => { calls.push({ name, body }); return response; } };
    throw Error(name);
  },
});
const { listSupportMessages, sendSupportMessage, createSupportConversation, rememberSupportLoginDraft, takeSupportLoginDraft } = moduleRef.exports;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const row = (id = randomUUID(), body = 'Synthetic text', sender = 'customer') => ({ id, clientMessageId: sender === 'customer' ? randomUUID() : null, body, sender, createdAt: '2026-10-11T12:00:00.000Z' });
const empty = { messages: [], hasMore: false, nextBefore: null };
// Hook harness exercises account remounts without a network or a React Native runtime.
function chatView(session, initialProps = {}) {
  let index = 0;
  const slots = [], effects = [], pending = [];
  const props = { isActive: true, contactRequest: 0, onAccount() {}, accountLabel: 'Login', ...initialProps };
  const React = {
    createElement: (type, attrs, ...children) => ({ type, props: { ...attrs, children } }),
    useState(initial) { const position = index++; if (!(position in slots)) slots[position] = typeof initial === 'function' ? initial() : initial;
      return [slots[position], next => { slots[position] = typeof next === 'function' ? next(slots[position]) : next; }]; },
    useRef(initial) { const position = index++; return slots[position] ?? (slots[position] = { current: initial }); },
    useEffect(effect, dependencies) { const position = index++; if (!effects[position] || dependencies.some((value, i) => value !== effects[position].dependencies[i])) {
      pending.push(() => { effects[position]?.cleanup?.(); effects[position] = { dependencies, cleanup: effect() }; });
    } },
  };
  const value = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/LiveAssistant.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, {
    exports: value.exports, module: value, setInterval: () => 1, clearInterval() {},
    require(name) {
      if (name === 'react') return { ...React, default: React, __esModule: true };
      if (name === 'react-native') return { ...Object.fromEntries(['Pressable','ScrollView','Text','TextInput','View'].map(name => [name,name])),
        StyleSheet: { create: value => value }, Keyboard: { dismiss() {} }, AccessibilityInfo: { announceForAccessibility() {} },
        AppState: { currentState: 'background', addEventListener: () => ({ remove() {} }) } };
      if (name.includes('Ionicons')) return { default: 'Icon', __esModule: true };
      if (name.endsWith('/cloudClient')) return { useCloudSession: () => session };
      if (name.endsWith('/LanguageContext')) return { useLanguage: () => ({ language: 'en', t: value => value }) };
      if (name.endsWith('/supportChat')) return moduleRef.exports;
      if (name.endsWith('/AssistantWelcome')) return { AssistantWelcome: 'Welcome' };
      throw Error(name);
    },
  });
  function nodes(node, type, result = []) { if (!node || typeof node !== 'object') return result;
    if (Array.isArray(node)) { node.forEach(child => nodes(child, type, result)); return result; }
    if (node.type === type) result.push(node);
    nodes(node.props?.children, type, result); return result;
  }
  function render() { index = 0; const tree = value.exports.SupportChat(props); while (pending.length) pending.shift()(); return tree; }
  return { render, props, input: () => nodes(render(), 'TextInput')[0].props,
    login: () => nodes(render(), 'Pressable').find(node => node.props.accessibilityLabel === 'Login to send').props.onPress(),
    dispose: () => effects.forEach(effect => effect?.cleanup?.()),
  };
}
(async () => {
  rememberSupportLoginDraft('Unsent guest message');
  assert.equal(takeSupportLoginDraft(), 'Unsent guest message', 'Guest composer survives the login remount without sending');
  assert.equal(takeSupportLoginDraft(), '', 'The handoff is consumed once and cannot leak into another account');
  const session = { user: null, configured: true, loading: false, error: null };
  const guest = chatView(session);
  guest.render(); guest.input().onChangeText('Latest guest message'); guest.login();
  guest.props.isActive = false; guest.render();
  session.user = { id: 'new-verified-account' }; guest.render();
  const signedIn = chatView(session);
  signedIn.render();
  assert.equal(signedIn.input().value, 'Latest guest message', 'Old guest instance must not consume the draft before the account-scope remount');
  assert.equal(takeSupportLoginDraft(), '');
  guest.dispose(); signedIn.dispose();
  session.user = null;
  const cancelled = chatView(session);
  cancelled.render(); cancelled.input().onChangeText('Cancelled login draft'); cancelled.login();
  cancelled.props.isActive = false; cancelled.render();
  cancelled.props.isActive = true; cancelled.render();
  assert.equal(takeSupportLoginDraft(), '', 'Returning as a guest clears the handoff without deleting the composer');
  assert.equal(cancelled.input().value, 'Cancelled login draft');
  cancelled.dispose();
  response = empty;
  assert.equal((await listSupportMessages()).messages.length, 0);
  assert.equal(calls[0].name, 'support-chat');
  for (const invalid of [null, {}, { ...empty, messages: [row('invalid')] }, { ...empty, hasMore: true }, { ...empty, messages: [row(), row()] , nextBefore: {} }]) {
    response = invalid;
    await assert.rejects(listSupportMessages, /could not be loaded/);
  }
  const clientId = randomUUID();
  response = { message: { ...row(), clientMessageId: clientId } };
  assert.equal((await sendSupportMessage(' Synthetic text ', clientId)).clientMessageId, clientId);
  for (const changed of [ { sender: 'team' }, { body: 'Different' }, { clientMessageId: randomUUID() }, { id: 'bad' } ]) {
    response = { message: { ...row(), clientMessageId: clientId, ...changed } };
    await assert.rejects(() => sendSupportMessage('Synthetic text', clientId), /not confirmed/);
  }
  await assert.rejects(() => sendSupportMessage('a'.repeat(2001), clientId), /2,000/);

  const updates = [], sends = [];
  let failure = true;
  const chat = createSupportConversation(state => updates.push(state), {
    uuid: randomUUID, list: async () => empty,
    send: async (body, id) => { sends.push({ body, id }); if (failure) throw Error('Uncertain connection'); return { ...row(), clientMessageId: id, body }; },
  });
  assert.equal(await chat.send(' Hello '), false);
  assert.equal(updates.at(-1).messages.length, 0, 'Unconfirmed sends do not become sent bubbles');
  assert.equal(await chat.send('Hello'), false);
  assert.equal(sends[0].id, sends[1].id, 'Identical retries reuse an idempotency key');
  assert.equal(await chat.send('Changed'), false);
  assert.notEqual(sends[1].id, sends[2].id, 'Editing creates a new message identity');
  failure = false;
  assert.equal(await chat.send('Changed'), true);
  assert.equal(sends[2].id, sends[3].id);
  assert.equal(updates.at(-1).messages.length, 1);
  assert.equal(updates.at(-1).messages[0].body, 'Changed');

  const pendingSend = deferred(), pendingList = deferred(), oldUpdates = [];
  const oldAccount = createSupportConversation(state => oldUpdates.push(state), {
    uuid: randomUUID, list: () => pendingList.promise, send: () => pendingSend.promise,
  });
  const sendWork = oldAccount.send('Previous account message');
  assert.equal(await oldAccount.send('Double tap'), false, 'Only one send may be in flight');
  const listWork = oldAccount.refresh();
  oldAccount.dispose(); // Account changed, logged out, or screen unmounted.
  const countAtDispose = oldUpdates.length;
  pendingSend.resolve(row()); pendingList.resolve({ ...empty, messages: [row()] });
  assert.equal(await sendWork, false);
  await listWork;
  assert.equal(oldUpdates.length, countAtDispose, 'Neither old request can publish into a new account');
  assert.equal(await oldAccount.send('No later sends'), false);

  const seen = row(), newest = row(), between = row(), older = row();
  const cursor = { createdAt: newest.createdAt, id: newest.id };
  let pageCalls = 0;
  const history = [];
  const paged = createSupportConversation(state => history.push(state), {
    uuid: randomUUID, send: async () => row(), list: async before => {
      pageCalls++;
      if (pageCalls === 1) return { messages: [seen], hasMore: true, nextBefore: { createdAt: seen.createdAt, id: seen.id } };
      if (!before) return { messages: [newest], hasMore: true, nextBefore: cursor };
      if (before.id === newest.id) return { messages: [seen, between], hasMore: true, nextBefore: { createdAt: seen.createdAt, id: seen.id } };
      return { messages: [older], hasMore: false, nextBefore: null };
    },
  });
  await paged.refresh();
  await paged.refresh();
  assert.equal(history.at(-1).messages.length, 3, 'Refresh catches up across more than one new page');
  assert.equal(pageCalls, 3);
  await paged.refresh(true);
  assert.equal(history.at(-1).messages.length, 4);
  assert.equal(history.at(-1).older, null);
  chat.dispose(); paged.dispose();
  console.log('Human Chat client passed: response validation, real-receipt status, idempotent retry/edit, concurrent send protection, account-change disposal and history catch-up.');
})().catch(error => { console.error(error); process.exitCode = 1; });
