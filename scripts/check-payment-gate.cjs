#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { languageMock } = require('./language-test-helper.cjs');
const source = ts.transpileModule(fs.readFileSync('src/components/AiPaymentGate.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const user = 'c659cc08-1b60-40e7-bad0-0b7d11517401';
const caseId = 'c659cc08-1b60-40e7-bad0-0b7d11517402';
const product = { identifier: 'net.fillout.ai.i90.case.v1', priceString: '€149,99' };
const response = access => ({ caseId, formId: 'I-90', access, productId: access === 'payment_required' ? product.identifier : null });
function host({ signedIn = true, language = 'en', testBuild = false } = {}) {
  let index = 0, effects = [], account = signedIn ? user : undefined;
  const slots = [], calls = [], statuses = [], appEvents = [], recoveries = [];
  let purchase = async () => response('granted');
  let restores = 0, backs = 0, returns = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const i = index++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = index++; return slots[i] || (slots[i] = { current: initial }); },
    useEffect(fn, deps) { const i = index++, before = slots[i]; if (before && deps?.every((x, j) => Object.is(x, before.deps[j]))) return; effects.push(() => { before?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require(name) {
    if (name === 'react') return { ...React, default: React, __esModule: true };
    if (name === 'react-native') return { ScrollView: 'ScrollView', Text: 'Text', View: 'View', Platform: { OS: 'ios' }, AppState: { addEventListener: (name, callback) => { appEvents.push(callback); return { remove() {} }; } }, StyleSheet: { create: value => value }, BackHandler: { addEventListener: () => ({ remove() {} }) } };
    if (name.includes('Ionicons')) return { default: 'Icon', __esModule: true };
    if (name.endsWith('/LanguageContext')) return { useLanguage: () => languageMock(language) };
    if (name.endsWith('/cloudClient')) return { useCloudSession: () => ({ user: account ? { id: account } : null }) };
    if (name.endsWith('/theme')) return { colors: {} };
    if (name === './UI') return Object.fromEntries(['Badge', 'BrandMark', 'Button', 'Card', 'Notice', 'SectionTitle'].map(name => [name, name]));
    if (name.endsWith('/payments')) return {
      isPaymentTestBuild: testBuild,
      reconcilePayment: async input => { calls.push(input); return statuses.length ? await statuses.shift() : response('payment_required'); },
      loadPaymentProduct: async () => product,
      purchaseAiPreparation: async input => purchase(input),
      restoreAiPurchases: async () => { restores++; return response('granted'); },
    };
    throw Error(`Unexpected dependency: ${name}`);
  } });
  const props = { formId: 'I-90', caseId, isActive: true, onBack: () => backs++, onContact() {}, onAccount() {}, onRecoverCase: async id => { recoveries.push(id); }, onReturnToApplications: () => returns++, children: { type: 'PaidQuestionnaire' } };
  return { props, calls, statuses, appEvents, recoveries, setUser: value => { account = value; }, setPurchase: value => { purchase = value; }, get restores() { return restores; }, get returns() { return returns; },
    render() { index = 0; effects = []; const tree = module.exports.AiPaymentGate(props); effects.forEach(run => run()); return tree; },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
function nodes(tree) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(nodes); return [tree, ...nodes(tree.props?.children)]; }
const button = (tree, title) => nodes(tree).find(node => node.type === 'Button' && node.props.title === title)?.props;
const unlocked = tree => nodes(tree).some(node => node.type === 'PaidQuestionnaire');
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  const guest = host({ signedIn: false });
  assert.ok(button(guest.render(), 'Sign in to continue'));
  await flush(); assert.equal(guest.calls.length, 0); assert.equal(unlocked(guest.render()), false);
  const testGuest = host({ signedIn: false, testBuild: true });
  assert.ok(nodes(testGuest.render()).some(node => node.type === 'Notice' && node.props.title === 'Test payment environment'));
  assert.equal(nodes(guest.render()).some(node => node.type === 'Notice' && node.props.title === 'Test payment environment'), false);

  const paid = host();
  assert.equal(unlocked(paid.render()), false, 'Initial render never unlocks');
  await flush();
  let tree = paid.render();
  assert.ok(button(tree, 'Pay €149,99 and start'), 'Use exact store localized price');
  assert.equal(unlocked(tree), false);
  await button(tree, 'Pay €149,99 and start').onPress(); await flush();
  assert.equal(unlocked(paid.render()), true, 'Only server grant renders paid children');
  paid.setUser('c659cc08-1b60-40e7-bad0-0b7d11517403');
  assert.equal(unlocked(paid.render()), false, 'Account switch immediately hides prior purchase');
  await flush();

  const appReview = host();
  appReview.statuses.push({ ...response('granted'), environment: 'sandbox' });
  appReview.render(); await flush();
  const appReviewTree = appReview.render();
  assert.equal(unlocked(appReviewTree), true);
  assert.ok(nodes(appReviewTree).some(node => node.type === 'Notice' && node.props.title === 'Test payment environment'), 'A sandbox grant remains labelled inside the release questionnaire');
  appReview.setUser(undefined); assert.equal(unlocked(appReview.render()), false);

  const pending = host(); pending.render(); await flush();
  pending.setPurchase(async () => ({ ...response('payment_required'), purchaseState: 'pending' }));
  button(pending.render(), 'Pay €149,99 and start').onPress(); await flush();
  tree = pending.render(); assert.equal(unlocked(tree), false); assert.equal(button(tree, 'Pay €149,99 and start'), undefined);
  pending.statuses.push({ ...response('payment_required'), purchaseState: 'pending' });
  button(tree, 'Check payment').onPress(); await flush();
  assert.equal(button(pending.render(), 'Pay €149,99 and start'), undefined, 'Polling pending purchase cannot invite another charge');
  pending.statuses.push(response('granted')); button(pending.render(), 'Check payment').onPress(); await flush();
  assert.equal(unlocked(pending.render()), true);

  const cancelled = host(); cancelled.render(); await flush();
  cancelled.setPurchase(async () => ({ ...response('payment_required'), purchaseState: 'cancelled' }));
  button(cancelled.render(), 'Pay €149,99 and start').onPress(); await flush();
  assert.equal(unlocked(cancelled.render()), false); assert.ok(button(cancelled.render(), 'Pay €149,99 and start'));
  button(cancelled.render(), 'Restore purchases').onPress(); await flush();
  assert.equal(cancelled.restores, 1); assert.equal(unlocked(cancelled.render()), true);

  const delayed = host(); let resolve;
  delayed.statuses.push(new Promise(done => { resolve = done; })); delayed.render();
  delayed.setUser(undefined); delayed.render(); resolve(response('granted')); await flush();
  assert.equal(unlocked(delayed.render()), false, 'Late response cannot open a signed-out account');

  const denied = host(); denied.statuses.push(Promise.reject(new Error('Connection unavailable'))); denied.render(); await flush();
  assert.equal(unlocked(denied.render()), false); assert.equal(button(denied.render(), 'Pay €149,99 and start'), undefined);
  denied.props.applicationReturnRequest = 1; denied.render(); assert.equal(denied.returns, 1, 'Locked screen honors application tab return');
  const recovery = host();
  const oldCase = 'c659cc08-1b60-40e7-bad0-0b7d11517404';
  recovery.statuses.push({ ...response('unavailable'), recoverCaseId: oldCase }); recovery.render(); await flush();
  assert.equal(button(recovery.render(), 'Pay €149,99 and start'), undefined);
  button(recovery.render(), 'Continue my paid application').onPress(); await flush();
  assert.deepEqual(recovery.recoveries, [oldCase], 'Restore the existing case before any new checkout');
  const foreground = host(); foreground.statuses.push(response('granted')); foreground.render(); await flush();
  assert.equal(unlocked(foreground.render()), true);
  foreground.statuses.push(response('payment_required')); foreground.appEvents.at(-1)('active'); await flush();
  assert.equal(unlocked(foreground.render()), false, 'Foreground reconciliation revokes refunded access');
  const ru = host({ signedIn: false, language: 'ru' }); assert.ok(button(ru.render(), 'Войти и продолжить'));
  console.log('Payment gate: guest, real price, grant-only access, pending/cancel/restore, stale account, errors, return and Russian UI passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
