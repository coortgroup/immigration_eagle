#!/usr/bin/env node
// Exercise the real client review panel with synthetic accounts and private PDF handles.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
const source = ts.transpileModule(fs.readFileSync('src/components/MyReviewSubmissions.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const submission = (extra = {}) => ({ id: randomUUID(), requestId: randomUUID(), formId: 'AR-11', environment: 'production', caseId: null, status: 'approved', submittedAt: '2026-10-11T16:00:00.000Z', reviewedAt: '2026-10-11T17:00:00Z', reviewNote: '', sha256: 'a'.repeat(64), ...extra });
function pdf() { const result = { uri: 'blob:synthetic', downloads: 0, prints: 0, disposed: 0 }; result.download = async () => { result.downloads++; }; result.print = async () => { result.prints++; }; result.dispose = () => { result.disposed++; }; return result; }
function nodes(node, predicate, result = []) {
  if (Array.isArray(node)) { node.forEach(child => nodes(child, predicate, result)); return result; }
  if (!node || typeof node !== 'object') return result;
  if (predicate(node)) result.push(node);
  nodes(node.props?.children, predicate, result); return result;
}
function text(node) { if (Array.isArray(node)) return node.map(text).join(' '); return typeof node === 'string' ? node : node && typeof node === 'object' ? text(node.props?.children) : ''; }
function host(rows = [], options = {}) {
  let index = 0, changed = false, effects = [], updates = 0, timer = 0;
  const slots = [], calls = [], edits = [], handlers = {}, timers = new Map(), listeners = new Set();
  const owner = { user: options.guest ? null : { id: randomUUID() } };
  const props = { isActive: options.active !== false, editableCases: options.editableCases || [], onEdit: id => edits.push(id) };
  const doc = pdf();
  const renderTranslation = (value, params = {}) => `${options.russian ? 'ru:' : ''}${value.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? `{${key}}`)}`;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const at = index++; if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial;
      return [slots[at], next => { updates++; const value = typeof next === 'function' ? next(slots[at]) : next; if (!Object.is(slots[at], value)) { slots[at] = value; changed = true; } }]; },
    useRef(initial) { const at = index++; return slots[at] ?? (slots[at] = { current: initial }); },
    useEffect(callback, dependencies) { const at = index++, previous = slots[at]; if (previous && dependencies?.every((value, i) => Object.is(value, previous.dependencies?.[i]))) return;
      effects.push(() => { previous?.cleanup?.(); slots[at] = { dependencies, cleanup: callback() }; }); },
  };
  const api = {
    listMyReviews: (...args) => { calls.push({ method: 'list', args, owner: owner.user?.id }); return handlers.list ? handlers.list(...args) : Promise.resolve(rows); },
    downloadReviewDocument: (...args) => { calls.push({ method: 'download', args, owner: owner.user?.id }); return handlers.download ? handlers.download(...args) : Promise.resolve(doc); },
  };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, Error, setInterval: callback => { timers.set(++timer, callback); return timer; }, clearInterval: id => timers.delete(id), require(name) {
    if (name === 'react') return { ...React, default: React, __esModule: true };
    if (name === 'react-native') return { Text: 'Text', View: 'View', StyleSheet: { create: value => value }, AppState: { currentState: 'active', addEventListener: (_, callback) => { listeners.add(callback); return { remove: () => listeners.delete(callback) }; } } };
    if (name === '../cloudClient') return { useCloudSession: () => owner };
    if (name === '../formReview') return api;
    if (name === '../i18n') return { localeFor: () => options.russian ? 'ru-RU' : 'en-US' };
    if (name === '../LanguageContext') return { useLanguage: () => ({ language: options.russian ? 'ru' : 'en', t: (value, params) => { assert.notEqual(value, options.noteMustRemainLiteral, 'A reviewer note must never be translated or interpolated'); return renderTranslation(value, params); } }) };
    if (name === './UI') return { Button: 'Button', Card: 'Card', Notice: 'Notice' };
    if (name === './DocumentDelivery') return { DocumentDelivery: 'DocumentDelivery' };
    if (name === '../theme') return { colors: {} };
    throw Error(name);
  } });
  const app = {
    props, calls, edits, doc,
    render() { let tree, tries = 0; do { assert.ok(++tries < 10); index = 0; changed = false; tree = module.exports.MyReviewSubmissions(props); const pending = effects; effects = []; pending.forEach(run => run()); } while (changed); return tree; },
    buttons(label) { return nodes(app.render(), node => node.type === 'Button' && node.props?.title === renderTranslation(label)).map(node => node.props); },
    button(label) { const button = app.buttons(label)[0]; assert.ok(button, `Missing button: ${label}`); return button; },
    press(label) { const button = app.button(label); assert.ok(!button.disabled, `Disabled button: ${label}`); button.onPress(); },
    deliveries() { return nodes(app.render(), node => node.type === 'DocumentDelivery').map(node => node.props); },
    text() { return text(app.render()); },
    handle(method, callback) { handlers[method] = callback; },
    active(value) { props.isActive = value; app.render(); },
    owner(value) { owner.user = value ? { id: value } : null; app.render(); },
    poll() { timers.forEach(callback => callback()); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    get updates() { return updates; },
  };
  return app;
}

(async () => {
  const guest = host([], { guest: true }); assert.equal(guest.render(), null); await tick(); assert.equal(guest.calls.length, 0); guest.unmount();
  const pending = host([submission({ status: 'pending', reviewedAt: null })]); pending.render(); await tick();
  assert.equal(pending.buttons('Open reviewed PDF').length, 0); assert.equal(pending.deliveries().length, 0);
  assert.equal(pending.calls.filter(call => call.method === 'download').length, 0, 'Pending PDFs cannot be requested from the client UI'); pending.unmount();

  const note = 'Client correction {name}: Keep this EXACT text.';
  const change = host([submission({ status: 'changes_requested', reviewNote: note })], { russian: true, noteMustRemainLiteral: note, editableCases: [{formId:'AR-11',caseId:null}] });
  change.render(); await tick(); assert.ok(change.text().includes(note)); assert.equal(change.deliveries().length, 0);
  change.press('Edit saved answers'); assert.deepEqual(change.edits, ['AR-11']); change.unmount();

  const currentCase = randomUUID(), otherCase = randomUUID();
  const exactDraft = host([submission({formId:'I-90',caseId:currentCase}),submission({formId:'I-90',caseId:otherCase,environment:'sandbox'})], {editableCases:[{formId:'I-90',caseId:currentCase}]});
  exactDraft.render(); await tick(); assert.equal(exactDraft.buttons('Edit saved answers').length,1,'Editing is bound to the exact local case, never another environment/case for the same form'); exactDraft.unmount();

  const sample = submission({ environment: 'sandbox' }), samplePanel = host([sample]); samplePanel.render(); await tick();
  assert.match(samplePanel.text(), /Sample information only/);
  assert.match(samplePanel.text(), /Test review approved/);
  assert.equal(samplePanel.buttons('Open reviewed PDF').length, 0);
  samplePanel.press('Open test PDF'); await tick();
  assert.equal(samplePanel.calls.at(-1).args[0].environment, 'sandbox');
  samplePanel.handle('list', async () => [{ ...sample, environment: 'production' }]); samplePanel.press('Refresh review status'); await tick();
  assert.equal(samplePanel.deliveries().length, 0, 'Changed environment invalidates an open document even if its ID/hash remain the same');
  assert.equal(samplePanel.doc.disposed, 1); samplePanel.unmount();

  const approved = submission(), panel = host([approved]); panel.render(); await tick();
  panel.press('Open reviewed PDF'); await tick();
  assert.equal(panel.calls.at(-1).args[0], approved, 'Fetch is tied to the exact approved server submission');
  const delivery = panel.deliveries()[0]; assert.ok(delivery); assert.equal(delivery.documentRevision, approved.id);
  assert.equal(delivery.onDownloadPdf, panel.doc.download); assert.equal(delivery.onPrintPdf, panel.doc.print);
  await delivery.onDownloadPdf(); await delivery.onPrintPdf(); assert.equal(panel.doc.downloads, 1); assert.equal(panel.doc.prints, 1);
  const replacement = submission({ status: 'pending', reviewedAt: null });
  panel.handle('list', async () => [replacement]); panel.press('Refresh review status'); await tick();
  assert.equal(panel.doc.disposed, 1, 'A superseded approved copy closes immediately on refresh'); assert.equal(panel.deliveries().length, 0); panel.unmount();

  for (const transition of ['inactive', 'owner', 'unmount']) {
    const panel = host([approved]), held = deferred(), file = pdf(); panel.render(); await tick();
    panel.handle('download', () => held.promise); panel.press('Open reviewed PDF');
    if (transition === 'inactive') panel.active(false);
    if (transition === 'owner') { panel.handle('list', async () => []); panel.owner(randomUUID()); }
    if (transition === 'unmount') panel.unmount();
    const count = panel.updates; held.resolve(file); await tick();
    assert.equal(file.disposed, 1, `${transition}: late file must be disposed`);
    if (transition === 'unmount') assert.equal(panel.updates, count, 'An unmounted account receives no late updates');
    else { assert.equal(panel.deliveries().length, 0); panel.unmount(); }
  }

  const ownerList = host(), listing = deferred(); ownerList.handle('list', () => listing.promise); ownerList.render();
  ownerList.handle('list', async () => []); ownerList.owner(randomUUID()); await tick();
  listing.resolve([approved]); await tick(); assert.equal(ownerList.buttons('Open reviewed PDF').length, 0, 'Old-account list responses stay hidden'); ownerList.unmount();

  // Polling may finish while the user-requested file transfer is still in flight.
  // A later stale file must not restore actions or leave an obsolete private copy cached.
  for (const refreshResult of ['replacement', 'failure']) {
    const panel = host([approved]), held = deferred(), file = pdf(); panel.render(); await tick();
    panel.handle('download', () => held.promise); panel.press('Open reviewed PDF');
    panel.handle('list', async () => { if (refreshResult === 'failure') throw Error('Status unavailable'); return [replacement]; });
    panel.poll(); await tick(); held.resolve(file); await tick();
    assert.equal(panel.deliveries().length, 0, `${refreshResult}: a late file cannot restore delivery after status changed`);
    assert.equal(file.disposed, 1, `${refreshResult}: a late obsolete/unverified file must be disposed`); panel.unmount();
  }
  console.log('My review submissions passed: pending download gate, exact approved artifact delivery, literal review notes, edit routing, superseded closure, account/inactive/unmount disposal and concurrent refresh races.');
})().catch(error => { console.error(error); process.exitCode = 1; });
