#!/usr/bin/env node
// Exercise real review-screen handlers with synthetic documents and isolated hooks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
const source = ts.transpileModule(fs.readFileSync('src/screens/FormReviewInboxScreen.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText + '\nmodule.exports.ReviewDetail = ReviewDetail;';
const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const submission = (extra = {}) => ({ id: randomUUID(), requestId: randomUUID(), formId: 'AR-11', environment: 'production', caseId: null, status: 'pending', submittedAt: '2026-10-11T16:00:00.000Z', reviewedAt: null, reviewNote: '', sha256: 'a'.repeat(64), email: 'client@example.test', userId: randomUUID(), ...extra });
function document() { return { uri: 'blob:synthetic', opened: 0, saved: 0, disposed: 0, async print() { this.opened++; }, async download() { this.saved++; }, dispose() { this.disposed++; } }; }
function nodes(node, predicate, result = []) {
  if (Array.isArray(node)) { node.forEach(child => nodes(child, predicate, result)); return result; }
  if (!node || typeof node !== 'object') return result;
  if (predicate(node)) result.push(node);
  nodes(node.props?.children, predicate, result); return result;
}
function text(node) { if (Array.isArray(node)) return node.map(text).join(' '); return typeof node === 'string' ? node : node && typeof node === 'object' ? text(node.props?.children) : ''; }
function host(kind = 'detail', input = submission()) {
  let index = 0, changed = false, effects = [], updates = 0;
  const slots = [], calls = [], decisions = [], handlers = {}, timers = new Map(); let timer = 0;
  const doc = document();
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const at = index++; if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial;
      return [slots[at], next => { updates++; const value = typeof next === 'function' ? next(slots[at]) : next; if (!Object.is(slots[at], value)) { slots[at] = value; changed = true; } }]; },
    useRef(initial) { const at = index++; return slots[at] ?? (slots[at] = { current: initial }); },
    useEffect(callback, dependencies) { const at = index++, previous = slots[at]; if (previous && dependencies?.every((value, i) => Object.is(value, previous.dependencies?.[i]))) return;
      effects.push(() => { previous?.cleanup?.(); slots[at] = { dependencies, cleanup: callback() }; }); },
  };
  const props = { submission: input, isActive: true, onBack: () => {}, onClose: () => {}, onChanged: next => { decisions.push(next); props.submission = next; } };
  const api = {
    downloadReviewDocument: (...args) => { calls.push({ method: 'download', args }); return handlers.download ? handlers.download(...args) : Promise.resolve(doc); },
    decideReview: (...args) => { calls.push({ method: 'decide', args }); return handlers.decide ? handlers.decide(...args) : Promise.resolve({ ...props.submission, status: args[1], reviewNote: args[2], reviewedAt: '2026-10-11T17:00:00Z' }); },
    listReviewInbox: (...args) => { calls.push({ method: 'list', args }); return handlers.list ? handlers.list(...args) : Promise.resolve({ submissions: [input], hasMore: false, nextBefore: null }); },
  };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, Error, setInterval: callback => { timers.set(++timer, callback); return timer; }, clearInterval: id => timers.delete(id), require(name) {
    if (name === 'react') return { ...React, default: React, __esModule: true };
    if (name === 'react-native') return { ...Object.fromEntries(['Pressable', 'ScrollView', 'Text', 'TextInput', 'View'].map(name => [name, name])), Platform: { OS: 'web' }, StyleSheet: { create: value => value }, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } };
    if (name === '../LanguageContext') return { useLanguage: () => ({ language: 'en', t: (value, params = {}) => value.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? `{${key}}`) }) };
    if (name === '../formReview') return api;
    throw Error(name);
  } });
  const component = kind === 'detail' ? module.exports.ReviewDetail : module.exports.FormReviewInboxScreen;
  const app = {
    props, calls, decisions, doc,
    render() { let tree, tries = 0; do { assert.ok(++tries < 10); index = 0; changed = false; tree = component(props); const pending = effects; effects = []; pending.forEach(run => run()); } while (changed); return tree; },
    button(label) { const button = nodes(app.render(), node => node.props?.title === label)[0]; assert.ok(button, `Missing button: ${label}`); return button.props; },
    hasButton(label) { return !!nodes(app.render(), node => node.props?.title === label)[0]; },
    press(label) { const button = app.button(label); assert.ok(!button.disabled, `Disabled button: ${label}`); button.onPress(); },
    note(value) { nodes(app.render(), node => node.type === 'TextInput')[0].props.onChangeText(value); },
    errors() { return nodes(app.render(), node => node.props?.accessibilityRole === 'alert').map(text).join(' '); },
    text() { return text(app.render()); },
    handle(method, callback) { handlers[method] = callback; },
    active(value) { props.isActive = value; app.render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    get updates() { return updates; },
  };
  return app;
}

(async () => {
  const review = host(); review.render();
  assert.equal(review.button('Approve this version').disabled, true);
  assert.equal(review.button('Request changes').disabled, true);
  await tick();
  assert.equal(review.calls.filter(call => call.method === 'download').length, 1);
  assert.equal(review.button('Approve this version').disabled, true, 'Loading a PDF does not claim it was reviewed');
  review.doc.print = async () => { throw Error('Viewer blocked'); };
  review.press('Open submitted PDF'); await tick();
  assert.match(review.errors(), /Viewer blocked/);
  assert.equal(review.button('Approve this version').disabled, true, 'A failed open never enables approval');
  review.doc.print = async () => { review.doc.opened++; };
  review.press('Open submitted PDF'); await tick();
  review.press('Approve this version');
  assert.equal(review.calls.filter(call => call.method === 'decide').length, 0, 'Approval intent must show the concrete confirmation first');
  assert.match(review.text(), /I have reviewed AR-11/);
  assert.match(review.text(), new RegExp(review.props.submission.id));
  const approval = deferred(); review.handle('decide', () => approval.promise);
  const confirm = review.button('Confirm and approve'); confirm.onPress(); confirm.onPress();
  assert.equal(review.calls.filter(call => call.method === 'decide').length, 1, 'Double tap submits only one decision');
  assert.deepEqual(review.calls.at(-1).args, [review.props.submission.id, 'approved', '', 'production']);
  review.active(false);
  assert.equal(review.doc.disposed, 1, 'Temporary PDF is disposed when leaving the screen');
  approval.resolve({ ...review.props.submission, status: 'approved', reviewedAt: '2026-10-11T17:00:00Z' }); await tick();
  assert.equal(review.decisions.length, 1, 'An explicit in-flight decision can complete while the same account is inactive');
  assert.equal(review.hasButton('Approve this version'), false);
  review.unmount();

  const changes = host(); changes.render(); await tick();
  changes.note('   '); assert.equal(changes.button('Request changes').disabled, true);
  changes.note('  Please correct the street number.  '); changes.press('Request changes');
  assert.equal(changes.calls.filter(call => call.method === 'decide').length, 0);
  changes.press('Send change request'); await tick();
  assert.deepEqual(changes.calls.at(-1).args, [changes.props.submission.id, 'changes_requested', 'Please correct the street number.', 'production']);
  assert.equal(changes.props.submission.status, 'changes_requested');
  assert.equal(changes.hasButton('Approve this version'), false);
  changes.unmount();

  const failed = host(); failed.render(); await tick();
  failed.press('Download for review'); await tick();
  failed.press('Approve this version');
  failed.handle('decide', async () => { throw Error('A newer submission replaced this version.'); });
  failed.press('Confirm and approve'); await tick();
  assert.match(failed.errors(), /newer submission/);
  assert.equal(failed.decisions.length, 0, 'A rejected/stale version never appears as approved');
  failed.active(false); failed.active(true); await tick();
  assert.equal(failed.button('Approve this version').disabled, true, 'Re-entering requires opening the refreshed document');
  failed.unmount();

  const late = host(), load = deferred(), lateDoc = document();
  late.handle('download', () => load.promise); late.render(); late.unmount(); const before = late.updates;
  load.resolve(lateDoc); await tick();
  assert.equal(lateDoc.disposed, 1, 'A PDF delivered after account unmount is immediately discarded');
  assert.equal(late.updates, before, 'Late document callbacks do not update an unmounted account');

  const lateDecision = host(), hold = deferred(); lateDecision.render(); await tick();
  lateDecision.press('Download for review'); await tick(); lateDecision.press('Approve this version');
  lateDecision.handle('decide', () => hold.promise); lateDecision.press('Confirm and approve'); lateDecision.unmount(); const writes = lateDecision.updates;
  hold.resolve({ ...lateDecision.props.submission, status: 'approved' }); await tick();
  assert.equal(lateDecision.decisions.length, 0); assert.equal(lateDecision.updates, writes);

  const a = submission({ formId: 'AR-11' }), b = submission({ formId: 'I-90', submittedAt: '2026-10-10T12:00:00Z' });
  const inbox = host('inbox', a); let reads = 0;
  inbox.handle('list', async before => ++reads === 1 ? { submissions: [a], hasMore: true, nextBefore: { id: a.id, submittedAt: a.submittedAt } } : { submissions: [a, b], hasMore: false, nextBefore: null });
  inbox.render(); await tick();
  assert.match(inbox.text(), /AR-11/); inbox.press('More submissions'); await tick();
  assert.equal(inbox.calls.at(-1).args[0].id, a.id);
  assert.equal(nodes(inbox.render(), node => node.type === 'Pressable').length, 2, 'Paged results deduplicate version IDs');
  assert.match(inbox.text(), /I-90/); inbox.unmount();

  const sample = submission({ environment: 'sandbox' }), testReview = host('detail', sample);
  testReview.render(); await tick();
  assert.match(testReview.text(), /Sample information only/);
  testReview.press('Download for review'); await tick();
  testReview.press('Approve this version');
  assert.match(testReview.text(), /Confirm test approval/);
  testReview.press('Confirm and approve'); await tick();
  assert.deepEqual(testReview.calls.at(-1).args, [sample.id, 'approved', '', 'sandbox']);
  testReview.unmount();

  const switching = host('inbox'), oldPage = deferred(), newPage = deferred();
  switching.handle('list', (_before, environment) => environment === 'production' ? oldPage.promise : newPage.promise);
  switching.render();
  assert.equal(switching.calls.at(-1).args[1], 'production');
  switching.press('Test reviews'); switching.render();
  assert.equal(switching.calls.at(-1).args[0], undefined, 'Switching queues resets the pagination cursor');
  assert.equal(switching.calls.at(-1).args[1], 'sandbox');
  oldPage.resolve({ submissions: [a], hasMore: true, nextBefore: { id: a.id, submittedAt: a.submittedAt } }); await tick();
  assert.doesNotMatch(switching.text(), /AR-11/, 'An old production response cannot enter the sandbox queue');
  assert.equal(switching.button('Refresh').disabled, true, 'Old requests cannot clear the new queue loading lock');
  newPage.resolve({ submissions: [sample], hasMore: false, nextBefore: null }); await tick();
  assert.match(switching.text(), /Test submission/);
  assert.equal(switching.hasButton('More submissions'), false);
  switching.handle('list', async () => ({ submissions: [], hasMore: false, nextBefore: null }));
  switching.press('Production reviews'); switching.render(); await tick();
  assert.doesNotMatch(switching.text(), /Test submission/);
  assert.equal(switching.calls.at(-1).args[1], 'production');
  switching.unmount();
  console.log('Form review operator passed: exact-version confirmation, open/download gating, required correction notes, duplicate taps, stale rejection, inactive completion, account disposal and pagination.');
})().catch(error => { console.error(error); process.exitCode = 1; });
