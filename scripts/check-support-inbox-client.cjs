const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');

const calls = [];
let respond = async () => { throw Error('Unexpected network call'); };
function load(path, requires, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{
    compilerOptions: { module: ts.ModuleKind.CommonJS,target: ts.ScriptTarget.ES2022,jsx: ts.JsxEmit.React,esModuleInterop: true },
  }).outputText,{ module,exports: module.exports,Error,...globals,require: name => {
    if (Object.hasOwn(requires,name)) return requires[name];
    throw Error(`Unexpected require ${name}`);
  } });
  return module.exports;
}
const cloud = { invokeCloudFunction: async (name,body) => { calls.push({ name,body }); return respond(name,body); } };
const chat = load('src/supportChat.ts',{ 'expo-crypto': { randomUUID },'./cloudClient': cloud });
const inbox = load('src/supportInbox.ts',{ 'expo-crypto': { randomUUID },'./cloudClient': cloud,'./supportChat': chat });
const deferred = () => { let resolve,reject; const promise = new Promise((yes,no) => { resolve = yes; reject = no; }); return { promise,resolve,reject }; };
const message = (props = {}) => ({ id: randomUUID(),sender: 'customer',clientMessageId: randomUUID(),body: 'Synthetic client message',createdAt: '2026-10-11T12:00:00.123456Z',...props });
const client = (props = {}) => ({ userId: randomUUID(),email: 'client@example.test',preview: 'Question',lastCreatedAt: '2026-10-11T12:00:00.123456Z',needsReply: true,...props });
const empty = { messages: [],hasMore: false,nextBefore: null };
const emptyInbox = { conversations: [],hasMore: false,nextBefore: null };
const plain = value => JSON.parse(JSON.stringify(value));
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

function assistantView(session, access) {
  let index = 0;
  const slots = [],effects = [],pending = [],timers = new Map();
  let timerId = 0;
  const React = {
    createElement: (type,props,...children) => ({ type,props: { ...props,children } }),
    useState(initial) { const at = index++; if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial;
      return [slots[at],value => { slots[at] = typeof value === 'function' ? value(slots[at]) : value; }]; },
    useEffect(effect,deps) { const at = index++; if (!effects[at] || deps.some((value,i) => value !== effects[at].deps[i])) {
      pending.push(() => { effects[at]?.cleanup?.(); effects[at] = { deps,cleanup: effect() }; });
    } },
  };
  const component = load('src/screens/AssistantScreen.tsx',{
    react: { ...React,default: React,__esModule: true },
    'react-native': { ...Object.fromEntries(['KeyboardAvoidingView','Pressable','Text','View'].map(value => [value,value])),StyleSheet: { create: value => value },Platform: { OS: 'web' },AppState: { currentState: 'active' } },
    '../components/LiveAssistant': { SupportChat: 'CustomerChat' },'../cloudClient': { useCloudSession: () => session },
    '../LanguageContext': { useLanguage: () => ({ t: value => value }) },'../supportInbox': { supportOperatorAccess: access },
    './SupportInboxScreen': { SupportInboxScreen: 'OperatorInbox' },
    './FormReviewInboxScreen': { FormReviewInboxScreen: 'FormReviewInbox' },
  },{ setInterval: fn => { timers.set(++timerId,fn); return timerId; },clearInterval: id => timers.delete(id) }).AssistantScreen;
  function nodes(node,type,result = []) {
    if (!node || typeof node !== 'object') return result;
    if (Array.isArray(node)) { node.forEach(item => nodes(item,type,result)); return result; }
    if (node.type === type) result.push(node);
    nodes(node.props?.children,type,result); return result;
  }
  function render(props = {}) { index = 0; const tree = component({ isActive: true,...props }); while (pending.length) pending.shift()(); return tree; }
  return { render,nodes,poll: async () => { timers.forEach(fn => fn()); await settle(); },dispose: () => effects.forEach(effect => effect?.cleanup?.()) };
}

(async () => {
  for (const allowed of [true,false]) {
    respond = async () => ({ allowed });
    assert.equal(await inbox.supportOperatorAccess(),allowed);
    assert.deepEqual(plain(calls.at(-1)),{ name: 'support-inbox',body: { action: 'access' } });
  }
  for (const invalid of [null,{}, { allowed: 'true' },{ allowed: 1 }]) {
    respond = async () => invalid;
    await assert.rejects(inbox.supportOperatorAccess,/could not be loaded/);
  }
  respond = async () => emptyInbox;
  assert.deepEqual(plain(await inbox.listClientConversations()),emptyInbox);
  const c = client(), cursor = { userId: c.userId,createdAt: c.lastCreatedAt };
  respond = async () => ({ conversations: [c],hasMore: true,nextBefore: cursor });
  await inbox.listClientConversations(cursor);
  assert.deepEqual(plain(calls.at(-1).body),{ action: 'inbox',before: cursor });
  for (const invalid of [
    null,{}, { ...emptyInbox,conversations: [null] },{ ...emptyInbox,conversations: [client({ userId: 'bad' })] },
    { ...emptyInbox,conversations: [client({ email: 'x'.repeat(321) })] },
    { ...emptyInbox,conversations: [client({ lastCreatedAt: 'bad' })] },
    { ...emptyInbox,conversations: [client({ needsReply: 'true' })] },{ ...emptyInbox,conversations: [c,c] },
    { ...emptyInbox,conversations: Array.from({ length: 21 },() => client()) },
    { ...emptyInbox,hasMore: true,nextBefore: cursor },{ conversations: [c],hasMore: true,nextBefore: null },
    { conversations: [c],hasMore: true,nextBefore: { ...cursor,userId: randomUUID() } },
    { conversations: [c],hasMore: true,nextBefore: { ...cursor,createdAt: '2026-10-10T12:00:00Z' } },
    { ...emptyInbox,nextBefore: cursor },
  ]) {
    respond = async () => invalid;
    await assert.rejects(inbox.listClientConversations,/could not be loaded/);
  }

  assert.throws(() => inbox.createOperatorConversation('bad',() => {}),/Select a client/);
  const customerId = randomUUID();
  const history = [];
  const controller = inbox.createOperatorConversation(customerId,state => history.push(state));
  respond = async () => empty;
  await controller.refresh();
  assert.deepEqual(plain(calls.at(-1).body),{ action: 'list',userId: customerId });
  const row = message();
  for (const invalid of [
    null,{}, { ...empty,messages: [null] },{ ...empty,messages: [message({ id: 'bad' })] },
    { ...empty,messages: [message({ sender: 'admin' })] },{ ...empty,messages: [message({ body: '  ' })] },
    { ...empty,messages: [message({ sender: 'customer',clientMessageId: null })] },
    { ...empty,messages: [row,row] },{ ...empty,messages: Array.from({ length: 11 },() => message()) },
    { ...empty,hasMore: true,nextBefore: { id: row.id,createdAt: row.createdAt } },
    { ...empty,messages: [row],hasMore: true,nextBefore: { id: randomUUID(),createdAt: row.createdAt } },
    { ...empty,messages: [row],hasMore: true,nextBefore: { id: row.id,createdAt: '2026-10-10T12:00:00Z' } },
  ]) {
    respond = async () => invalid;
    await controller.refresh();
    assert.match(history.at(-1).error,/could not be loaded/);
    assert.equal(history.at(-1).messages.length,0,'Invalid history never appears as a delivered message');
  }

  const sends = [];
  let rejectReceipt = 'sender';
  respond = async (_,body) => {
    assert.equal(body.userId,customerId);
    assert.equal(body.action,'reply');
    sends.push(body);
    const receipt = message({ sender: 'team',clientMessageId: body.clientMessageId,body: body.body });
    if (rejectReceipt === 'sender') receipt.sender = 'customer';
    if (rejectReceipt === 'identity') receipt.clientMessageId = randomUUID();
    if (rejectReceipt === 'body') receipt.body = 'Different text';
    if (rejectReceipt === 'uuid') receipt.id = 'bad';
    return { message: receipt };
  };
  for (const invalid of ['sender','identity','body','uuid']) {
    rejectReceipt = invalid;
    assert.equal(await controller.send(' Reply '),false);
    assert.match(history.at(-1).error,/not confirmed/);
    assert.equal(history.at(-1).messages.length,0);
  }
  assert.equal(new Set(sends.map(send => send.clientMessageId)).size,1,'Uncertain receipts reuse the same idempotency key');
  rejectReceipt = '';
  assert.equal(await controller.send('Reply'),true);
  assert.equal(sends.at(-1).clientMessageId,sends[0].clientMessageId);
  assert.equal(history.at(-1).messages.length,1);
  assert.equal(history.at(-1).messages[0].sender,'team');
  assert.equal(await controller.send('Edited reply'),true);
  assert.notEqual(sends.at(-1).clientMessageId,sends[0].clientMessageId);
  const priorCalls = calls.length;
  assert.equal(await controller.send(''),false);
  assert.equal(await controller.send('x'.repeat(2001)),false);
  assert.equal(calls.length,priorCalls);
  controller.dispose();

  // Customer identity is captured by a controller, and pending callbacks cannot leak across screens/accounts.
  const listRequest = deferred(), replyRequest = deferred(), oldHistory = [];
  respond = (_,body) => body.action === 'list' ? listRequest.promise : replyRequest.promise;
  const old = inbox.createOperatorConversation(customerId,state => oldHistory.push(state));
  const listing = old.refresh(), sending = old.send('Pending reply');
  const inFlightReply = calls.at(-1).body;
  assert.equal(await old.send('Double tap'),false);
  old.dispose();
  const oldCount = oldHistory.length;
  const newCustomer = randomUUID(), newHistory = [];
  respond = async (_,body) => {
    assert.equal(body.userId,newCustomer);
    return { ...empty,messages: [message({ body: 'New customer only' })] };
  };
  const next = inbox.createOperatorConversation(newCustomer,state => newHistory.push(state));
  await next.refresh();
  listRequest.resolve({ ...empty,messages: [message({ body: 'Old customer' })] });
  replyRequest.resolve({ message: message({ sender: 'team',clientMessageId: inFlightReply.clientMessageId,body: inFlightReply.body }) });
  await listing;
  assert.equal(await sending,false);
  assert.equal(oldHistory.length,oldCount);
  assert.equal(newHistory.at(-1).messages[0].body,'New customer only');
  assert.equal(await old.send('After unmount'),false);
  next.dispose();

  // Refresh recovers replies between polling intervals without skipping the unseen middle page.
  const known = message(), middle = message(), newest = message(), oldest = message();
  const pages = [];
  let reads = 0;
  respond = async (_,body) => {
    assert.equal(body.action,'list'); reads++;
    if (reads === 1) return { messages: [known],hasMore: true,nextBefore: { id: known.id,createdAt: known.createdAt } };
    if (!body.before) return { messages: [newest],hasMore: true,nextBefore: { id: newest.id,createdAt: newest.createdAt } };
    if (body.before.id === newest.id) return { messages: [known,middle],hasMore: true,nextBefore: { id: known.id,createdAt: known.createdAt } };
    return { ...empty,messages: [oldest] };
  };
  const paging = inbox.createOperatorConversation(customerId,state => pages.push(state));
  await paging.refresh(); await paging.refresh();
  assert.equal(pages.at(-1).messages.length,3);
  assert.equal(reads,3);
  await paging.refresh(true);
  assert.equal(pages.at(-1).messages.length,4);
  assert.equal(pages.at(-1).older,null);
  paging.dispose();

  const session = { configured: true,user: { id: customerId } };
  const firstRole = deferred(), secondRole = deferred();
  let roleResponse = firstRole.promise, checks = 0;
  const view = assistantView(session,() => { checks++; return roleResponse; });
  assert.equal(view.nodes(view.render(),'Pressable').length,0);
  session.user = { id: newCustomer }; roleResponse = secondRole.promise;
  view.render();
  firstRole.resolve(true); await settle();
  assert.equal(view.nodes(view.render(),'Pressable').length,0,'A late operator result from the old account never exposes inbox for the new account');
  secondRole.resolve(false); await settle();
  assert.equal(view.nodes(view.render(),'Pressable').length,0);
  roleResponse = Promise.resolve(true);
  await view.poll();
  const open = view.nodes(view.render(),'Pressable')[0];
  assert.ok(open,'An authorized account can open its inbox');
  open.props.onPress();
  assert.equal(view.nodes(view.render(),'OperatorInbox')[0].props.key,newCustomer);
  roleResponse = Promise.resolve(false);
  await view.poll();
  assert.equal(view.nodes(view.render(),'OperatorInbox').length,0,'Revoked operator role closes inbox');
  roleResponse = Promise.resolve(true); await view.poll();
  view.nodes(view.render(),'Pressable')[1].props.onPress();
  assert.equal(view.nodes(view.render(),'FormReviewInbox')[0].props.key,newCustomer,'Review inbox is scoped to the authorized operator account');
  roleResponse = Promise.resolve(false); await view.poll();
  assert.equal(view.nodes(view.render(),'FormReviewInbox').length,0,'Revoked operator role closes review inbox');
  session.user = null;
  const previousChecks = checks;
  view.render(); await view.poll();
  assert.equal(checks,previousChecks,'Guests cannot request operator access');
  view.dispose();
  console.log('Operator inbox client passed: role receipts, malformed pages/cursors, target isolation, confirmed team replies, idempotent retry, account-change disposal, multi-page catch-up, stale role responses and revoked-role UI.');
})().catch(error => { console.error(error); process.exitCode = 1; });
