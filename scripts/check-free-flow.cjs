#!/usr/bin/env node
// Exercise the actual FormsFlow handlers without a browser or a native runtime.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');

const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const source = compile('src/screens/FormsFlow.tsx');
const qualificationModule = { exports: {} };
vm.runInNewContext(compile('src/qualification.ts'), { module: qualificationModule, exports: qualificationModule.exports, Date });
const qualification = qualificationModule.exports;
const readData = name => JSON.parse(fs.readFileSync(path.join('data', name), 'utf8'));
const catalog = readData('forms-catalog.json').forms;
const schemas = [...readData('eligibility-main.json').forms, ...readData('eligibility-other.json').forms];
// G-639 has an explicit official online route. Exercise it separately from
// the local preparation qualification matrix.
const localPreparationSchemas = schemas.filter(schema => schema.id !== 'G-639');
const passableForms = catalog.filter(form => form.id !== 'G-639' && schemas.find(schema => schema.id === form.id).questions.every(question => question.yes === 'next' || question.no === 'next'));
const paymentModule = { exports: {} };
vm.runInNewContext(compile('src/payments.ts'), {
  module: paymentModule, exports: paymentModule.exports, process: { env: {} },
  require(name) {
    if (name === '@react-native-async-storage/async-storage') return {};
    if (name === 'react-native') return { NativeModules: {}, Platform: { OS: 'android' } };
    if (name === './cloudClient') return {};
    if (name === '../data/form-pricing.json') return readData('form-pricing.json');
    throw new Error(`Unexpected payment dependency: ${name}`);
  },
});
const payments = paymentModule.exports;
const aiContinueTitle = formId => payments.getAiPaymentKind(formId) === 'free' ? 'Continue to guided preparation' : 'Continue to payment';

function findAll(node, predicate, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (Array.isArray(node)) { node.forEach(child => findAll(child, predicate, result)); return result; }
  if (predicate(node)) result.push(node);
  findAll(node.props?.children, predicate, result);
  return result;
}
const ofType = (tree, type) => findAll(tree, node => node.type === type);
const action = (tree, title) => {
  const found = ofType(tree, 'Button').find(node => node.props.title === title);
  assert.ok(found, `Expected action: ${title}`);
  return found.props;
};
const hasAction = (tree, title) => ofType(tree, 'Button').some(node => node.props.title === title);
const editor = tree => ofType(tree, 'FreeFormPreparationScreen')[0];
const paymentGate = tree => ofType(tree, 'AiPaymentGate')[0];

function host(formId, options = {}) {
  const slots = [];
  const savedDrafts = options.savedDrafts || new Map();
  const writes = [];
  const writeOwners = [];
  const paymentChecks = [];
  let index = 0;
  let pendingEffects = [];
  const backHandlers = new Set();
  const activeSessions = [];
  const externalLinks = [];
  let contacts = 0;
  let applicationReturns = 0;
  const props = {
    initialFormId: formId, isActive: true, draftOwner: options.draftOwner,
    applicationReturnRequest: 0,
    onContact: () => { contacts++; },
    onExitToApplications: () => { applicationReturns++; },
    onFullSessionActiveChange: active => activeSessions.push(active),
  };
  const React = {
    createElement: (type, elementProps, ...children) => ({ type, props: { ...elementProps, children } }),
    useState(initial) {
      const position = index++;
      if (!(position in slots)) slots[position] = typeof initial === 'function' ? initial() : initial;
      return [slots[position], value => { slots[position] = typeof value === 'function' ? value(slots[position]) : value; }];
    },
    useRef(initial) { const position = index++; return slots[position] ?? (slots[position] = { current: initial }); },
    useMemo(compute) { index++; return compute(); },
    useEffect(callback, dependencies) {
      const position = index++;
      const previous = slots[position];
      if (previous && dependencies && dependencies.every((value, item) => Object.is(value, previous.dependencies?.[item]))) return;
      pendingEffects.push(() => {
        previous?.cleanup?.();
        slots[position] = { dependencies, cleanup: callback() };
      });
    },
  };
  const moduleRef = { exports: {} };
  vm.runInNewContext(source, {
    module: moduleRef, exports: moduleRef.exports, Error,
    require(name) {
      if (name.endsWith('/LanguageContext')) return { useLanguage: () => require('./language-test-helper.cjs').languageMock(options.languageRef?.current || 'en') };
      if (name.endsWith('/i18n')) return require('./language-test-helper.cjs');
      if (name.endsWith('/LanguageSwitcher')) return { LanguageSwitcher: 'LanguageSwitcher' };
      if (name === 'react') return { ...React, default: React, __esModule: true };
      if (name === 'expo-crypto') return { randomUUID };
      if (name === 'react-native') return {
        ...Object.fromEntries(['Image', 'ImageBackground', 'KeyboardAvoidingView', 'Modal', 'Pressable', 'ScrollView', 'Text', 'View'].map(key => [key, key])),
        Platform: { OS: 'android' }, StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width: 600 }),
        AccessibilityInfo: { announceForAccessibility() {} }, Alert: { alert() {} },
        Linking: { async openURL(url) { externalLinks.push(url); } },
        BackHandler: { addEventListener(name, callback) { assert.equal(name, 'hardwareBackPress'); backHandlers.add(callback); return { remove: () => backHandlers.delete(callback) }; } },
      };
      if (name.includes('Ionicons')) return { default: 'Ionicons', __esModule: true };
      if (name === '../components/UI') return Object.fromEntries(['Badge', 'BrandMark', 'Button', 'Card', 'Field', 'Notice', 'RowLink', 'SectionTitle'].map(key => [key, key]));
      if (name === '../theme') return { colors: {}, radius: {} };
      if (name === '../qualification') return options.evaluate ? { ...qualification, evaluateQualification: options.evaluate } : qualification;
      if (name === '../draftStorage') return options.draftStorage || { loadDraft: options.loadDraft || (async id => savedDrafts.get(id || formId) || null), saveDraft: async (draft, owner) => { writes.push(draft); writeOwners.push(owner); savedDrafts.set(draft.formId, structuredClone(draft)); await options.save?.(draft, owner); } };
      if (name === '../components/EmailAccess') return { EmailAccess: 'EmailAccess' };
      if (name === '../components/AiPaymentGate') return { AiPaymentGate: 'AiPaymentGate' };
      if (name === '../cloudClient') return { getCloudUserId: () => options.userId || null };
      if (name === '../payments') return { ...payments,
        getPaymentStatus: async input => {
          paymentChecks.push(structuredClone(input));
          return options.paymentStatus ? options.paymentStatus(input) : { access: 'payment_required' };
        },
      };
      if (name === '../requestDelivery') return {
        useRequestDelivery: () => ({}), useRequestIdentity: () => ({ reset() {} }),
        submitRequest: () => { throw new Error('No request should be submitted by a form check'); },
      };
      if (name === './FullFormPreparationScreen') return { FullFormPreparationScreen: 'FullFormPreparationScreen' };
      if (name === './FreeFormPreparationScreen') return { FreeFormPreparationScreen: 'FreeFormPreparationScreen' };
      if (name.endsWith('.json')) {
        const data = readData(path.basename(name));
        if (options.emptyQuestions && name.includes('eligibility-')) data.forms.forEach(form => { if (form.id === formId) form.questions = []; });
        return data;
      }
      if (/\.(png|jpg)$/.test(name)) return 1;
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return {
    props, activeSessions, externalLinks, backHandlers, savedDrafts, writes, writeOwners, paymentChecks,
    get contacts() { return contacts; },
    get applicationReturns() { return applicationReturns; },
    render() {
      index = 0; pendingEffects = [];
      const tree = moduleRef.exports.FormsFlow(props);
      pendingEffects.forEach(effect => effect());
      return tree;
    },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

async function passCheck(harness, mode = 'self') {
  let tree = harness.render();
  await action(tree, { self: 'Start free form check', ai: 'Check & prepare with FillOut' }[mode]).onPress();
  tree = harness.render();
  const schema = schemas.find(item => item.id === harness.props.initialFormId);
  for (const question of schema.questions) {
    assert.ok(!editor(tree), 'The editor must stay closed while checks are unanswered');
    assert.equal(action(tree, 'Yes').variant, question.yes === 'next' ? 'primary' : 'secondary', `${schema.id}/${question.id}: Yes color must match outcome`);
    assert.equal(action(tree, 'No').variant, question.no === 'next' ? 'primary' : 'secondary', `${schema.id}/${question.id}: No color must match outcome`);
    const answer = question.yes === 'next' ? 'Yes' : question.no === 'next' ? 'No' : null;
    assert.ok(answer, `${schema.id}: expected a passable test path`);
    action(tree, answer).onPress();
    tree = harness.render();
  }
  return tree;
}

(async () => {
const homeBrowser = host();
const selections = [];
homeBrowser.props.onOpenApplicationForm = id => selections.push(id);
const homeTree = homeBrowser.render();
ofType(homeTree, 'Button').find(node => node.props.accessibilityLabel === 'Start filling out form N-400').props.onPress();
assert.deepEqual(selections, ['N-400'], 'Home sends form selection to the application flow');
assert.ok(!hasAction(homeBrowser.render(), 'Start free form check'), 'Home must stay a browser and never own a preparation draft');
assert.equal(homeBrowser.writes.length, 0);
homeBrowser.dispose();

const recordsRequest = host('G-639');
const recordsTree = recordsRequest.render();
assert.ok(!editor(recordsTree) && !paymentGate(recordsTree));
assert.ok(!hasAction(recordsTree, 'Start free form check'), 'G-639 directs records requests to the official online service');
assert.ok(!hasAction(recordsTree, 'Check & prepare with FillOut'), 'The official online records route must not offer local paid preparation');
assert.ok(hasAction(recordsTree, 'Request attorney contact'), 'The independent attorney-contact path remains available');
assert.equal(recordsRequest.externalLinks.length, 0, 'Do not open the external service without a user action');
await action(recordsTree, 'Open USCIS online records request').onPress();
assert.deepEqual(recordsRequest.externalLinks, ['https://www.uscis.gov/records/request-records-through-the-freedom-of-information-act-or-privacy-act']);
assert.equal(recordsRequest.writes.length, 0, 'Opening official guidance must not create a local preparation draft');
assert.ok(!editor(recordsRequest.render()) && !paymentGate(recordsRequest.render()));
recordsRequest.dispose();

for (const form of passableForms) {
  const draftOwner = form.id === 'I-90' ? null : 'account-A';
  const harness = host(form.id, { draftOwner });
  let tree = await passCheck(harness);
  assert.ok(editor(tree), `${form.id}: the final passing free answer must open the PDF automatically`);
  assert.ok(!paymentGate(tree), `${form.id}: self-preparation must never require payment`);
  assert.equal(editor(tree).props.formId, form.id);
  assert.equal(editor(tree).props.officialUrl, form.officialUrl);
  assert.equal(editor(tree).props.onExitToApplications, harness.props.onExitToApplications, 'PDF screens must receive the explicit application-list destination');
  harness.props.applicationReturnRequest++;
  tree = harness.render();
  assert.equal(editor(tree).props.applicationReturnRequest, 1, 'The PDF receives bottom-tab return requests');
  assert.equal(harness.applicationReturns, 0, 'FormsFlow must let the PDF flush its own changes before returning');
  assert.equal(editor(tree).props.draftOwner, draftOwner, 'PDF screens must keep the mounted draft owner, including guest null');
  assert.ok(harness.writeOwners.length > 0 && harness.writeOwners.every(owner => owner === draftOwner), 'Qualification saves must use the same mounted owner');
  assert.equal(harness.activeSessions.at(-1), true, 'The free form must be protected from saved-draft replacement');
  assert.equal(harness.backHandlers.size, 0, 'The PDF screen must own its hardware back/discard behavior');
  assert.equal(harness.externalLinks.length, 0, 'Starting the editor must not unexpectedly launch an external browser');

  harness.props.isActive = false;
  tree = harness.render();
  assert.equal(editor(tree).props.isActive, false, 'Tab visibility must reach the editor');
  assert.equal(harness.activeSessions.at(-1), true, 'A hidden tab must retain session protection');
  harness.props.isActive = true;
  tree = harness.render();
  editor(tree).props.onExit();
  await new Promise(resolve => setImmediate(resolve));
  tree = harness.render();
  assert.ok(hasAction(tree, 'Open PDF form'), 'Leaving the editor must allow reopening it');
  assert.equal(harness.activeSessions.at(-1), false);
  action(tree, 'Open PDF form').onPress();
  tree = harness.render();
  assert.ok(editor(tree));

  editor(tree).props.onExit();
  await new Promise(resolve => setImmediate(resolve));
  tree = harness.render();
  const back = ofType(tree, 'Pressable').find(node => node.props.accessibilityLabel === 'Change last answer');
  assert.ok(back);
  back.props.onPress();
  tree = harness.render();
  assert.ok(hasAction(tree, 'Yes'), 'Back must reopen the final qualification question');
  action(tree, 'I’m not sure — request review').onPress();
  tree = harness.render();
  assert.ok(!editor(tree));
  assert.ok(!hasAction(tree, 'Open PDF form'), 'Changing a passing answer to unsure must remove PDF access');
  harness.dispose();
}

let blockedBranches = 0;
for (const schema of localPreparationSchemas) {
  for (let questionIndex = 0; questionIndex < schema.questions.length; questionIndex++) {
    if (schema.questions.slice(0, questionIndex).some(question => question.yes !== 'next' && question.no !== 'next')) break;
    const question = schema.questions[questionIndex];
    for (const answer of ['yes', 'no', 'unsure']) {
      if (answer !== 'unsure' && question[answer] === 'next') continue;
      const harness = host(schema.id);
      let tree = harness.render();
      action(tree, 'Start free form check').onPress();
      tree = harness.render();
      for (const earlier of schema.questions.slice(0, questionIndex)) {
        action(tree, earlier.yes === 'next' ? 'Yes' : 'No').onPress();
        tree = harness.render();
      }
      action(tree, answer === 'yes' ? 'Yes' : answer === 'no' ? 'No' : 'I’m not sure — request review').onPress();
      tree = harness.render();
      assert.ok(!editor(tree), `${schema.id}/${question.id}/${answer}: review and stop must not open a PDF`);
      assert.ok(!hasAction(tree, 'Open PDF form'));
      assert.ok(hasAction(tree, 'Chat with our team'));
      assert.equal(harness.activeSessions.at(-1), false);
      harness.dispose();
      blockedBranches++;
    }
  }
}

for (const { id: formId } of passableForms) {
  const destination = 'FullFormPreparationScreen';
  const harness = host(formId, { draftOwner: 'account-A' });
  let tree = await passCheck(harness, 'ai');
  assert.ok(!editor(tree), 'Paid/guided choices must retain their separate result step');
  assert.ok(!paymentGate(tree), 'Payment follows the completed result step');
  await action(tree, aiContinueTitle(formId)).onPress();
  tree = harness.render();
  assert.ok(ofType(tree, destination).length);
  const free = payments.getAiPaymentKind(formId) === 'free';
  assert.equal(!!paymentGate(tree), !free, `${formId}: every chargeable AI route must be guarded, including included/add-on/unavailable products`);
  if (!free) {
    assert.equal(tree.type, 'AiPaymentGate', `${formId}: the gate must wrap the editor so it cannot mount early`);
    assert.equal(paymentGate(tree).props.caseId, harness.savedDrafts.get(formId).paymentCaseId);
    assert.match(paymentGate(tree).props.caseId, /^[0-9a-f-]{36}$/i);
    assert.equal(paymentGate(tree).props.formId, formId);
    assert.equal(paymentGate(tree).props.onContact, harness.props.onContact);
    harness.props.isActive = false;
    assert.equal(paymentGate(harness.render()).props.isActive, false, 'Visibility must reach the payment guard');
    harness.props.applicationReturnRequest++;
    assert.equal(paymentGate(harness.render()).props.applicationReturnRequest, 1, 'The guard receives bottom-tab return requests');
  }
  assert.equal(harness.activeSessions.at(-1), true, `${formId} must retain full-session protection`);
  assert.equal(ofType(tree, destination)[0].props.draftOwner, 'account-A', 'Full preparation must receive the mounted owner');
  assert.equal(ofType(tree, destination)[0].props.formId, formId, 'Full preparation must use the selected official form');
  assert.equal(harness.contacts,0);
  harness.dispose();
}

for (const formId of ['I-90', 'G-639']) {
  const attorney = host(formId);
  await action(attorney.render(), 'Request attorney contact').onPress();
  const tree = attorney.render();
  assert.ok(hasAction(tree, 'Preview my request'), `${formId}: attorney contact opens intake directly`);
  assert.ok(!hasAction(tree, 'Yes') && !hasAction(tree, 'No'), 'Attorney contact does not require qualification answers');
  assert.ok(!editor(tree) && !paymentGate(tree), 'Attorney intake must stay outside preparation and payment');
  assert.equal(attorney.savedDrafts.get(formId).mode, 'attorney');
  assert.equal(attorney.savedDrafts.get(formId).stage, 'attorney');
  ofType(tree, 'Field').find(node => node.props.label === 'Your full name').props.onChangeText('Sample Contact');
  assert.equal(attorney.savedDrafts.get(formId).attorneyDetails.name, 'Sample Contact', 'Typing contact details must autosave the attorney draft');
  const restored = host(formId, { savedDrafts: attorney.savedDrafts });
  restored.props.resumeFormId = formId; restored.props.resumeRequest = 1;
  restored.render(); await new Promise(setImmediate);
  const resumed = restored.render();
  assert.ok(hasAction(resumed, 'Preview my request'), 'Resume must return directly to attorney intake');
  assert.equal(ofType(resumed, 'Field').find(node => node.props.label === 'Your full name').props.value, 'Sample Contact');
  assert.ok(!editor(resumed) && !paymentGate(resumed));
  attorney.dispose(); restored.dispose();
}

for (const formId of ['I-821','I-821D']) {
  const schema = schemas.find(item => item.id === formId);
  for (let stop = 0; stop < schema.questions.length; stop++) for (const answer of ['yes','no','unsure']) {
    const harness = host(formId);
    await action(harness.render(),'Check & prepare with FillOut').onPress();
    for (let i = 0; i < stop; i++) action(harness.render(),schema.questions[i].yes === 'next' ? 'Yes' : 'No').onPress();
    action(harness.render(),answer === 'yes' ? 'Yes' : answer === 'no' ? 'No' : 'I’m not sure — request review').onPress();
    const tree = harness.render();
    const canDraft = stop === schema.questions.length-1 && answer === 'no';
    assert.equal(hasAction(tree,'Prepare a draft for review'),canDraft,`${formId}/${stop}/${answer}: only the known policy-review path enables a review draft`);
    assert.equal(hasAction(tree,'Continue to guided preparation'),false,'Review must not be represented as a passed result');
    assert.equal(hasAction(tree,'Continue to payment'),false,'A review result must not request a passed-check purchase');
    if (canDraft) {
      await action(tree,'Prepare a draft for review').onPress();
      const full = ofType(harness.render(),'FullFormPreparationScreen')[0];
      assert.ok(!paymentGate(harness.render()), 'Policy-review drafts are outside the passed-check payment flow');
      assert.equal(full.props.formId,formId);
      assert.equal(full.props.reviewRequired,true);
      const stored = { ...harness.savedDrafts.get(formId),stage:'fullPreparation',fullAnswers:{},completedQuestionIds:[] };
      harness.savedDrafts.set(formId,stored);
      const resumed = host(formId,{ savedDrafts:harness.savedDrafts });
      resumed.props.resumeFormId = formId; resumed.props.resumeRequest = 1; resumed.render(); await new Promise(setImmediate);
      assert.equal(ofType(resumed.render(),'FullFormPreparationScreen')[0].props.reviewRequired,true,'Resume keeps the review restriction');
      resumed.dispose();
    }
    harness.dispose();
  }
}

// A missing check currently requires review. If a future schema explicitly
// permits starting without questions, only a passed result may open the PDF.
const noCheck = host('I-90', { emptyQuestions: true });
action(noCheck.render(), 'Start free form check').onPress();
assert.ok(!editor(noCheck.render()));
noCheck.dispose();
const explicitlyPassed = host('I-90', { emptyQuestions: true, evaluate: schema => schema?.questions.length ? qualification.evaluateQualification(schema, {}) : ({ status: 'passed', index: 0 }) });
action(explicitlyPassed.render(), 'Start free form check').onPress();
assert.ok(editor(explicitlyPassed.render()), 'An explicitly passed no-question check must use the same free route');
explicitlyPassed.dispose();

console.log(`Form routing passed: ${passableForms.length} free and guided openings, ${blockedBranches} blocked/uncertain branches across ${localPreparationSchemas.length} local forms, official G-639 online route, session guards and attorney gates.`);

const passedChecks = formId => Object.fromEntries(schemas.find(item => item.id === formId).questions.map(q => [q.id, q.yes === 'next' ? 'yes' : 'no']));
const savedAiDraft = (formId, overrides = {}) => ({
  version: 1, formId, title: formId, mode: 'ai', stage: 'fullPreparation', checks: passedChecks(formId),
  answers: {}, completedFieldIds: [], answered: 0, total: 1, updatedAt: new Date().toISOString(), ...overrides,
});
async function restoreForTest(harness, formId) {
  harness.props.resumeFormId = formId; harness.props.resumeRequest = 1;
  harness.render(); await new Promise(setImmediate);
  return harness.render();
}

// Old drafts must acquire a stable case and still pass through the server gate,
// whether they resume the current editor, legacy intake, or legacy review.
for (const state of ['fullPreparation', 'check', 'interview', 'interviewReview', 'legacyMode']) {
  const fields = readData('preparation-fields.json').forms.find(item => item.id === 'N-400').fields;
  const complete = Object.fromEntries(fields.map(field => [field.id, field.type === 'email' ? 'sample@example.com' : field.type === 'date' ? '04/23/1990' : 'Sample answer']));
  const draft = savedAiDraft('N-400', {
    stage: state === 'interviewReview' ? 'interview' : state === 'legacyMode' ? 'fullPreparation' : state,
    ...(state === 'legacyMode' ? { mode: undefined } : {}),
    ...(state === 'interviewReview' ? { answers: complete } : {}),
    paid: true, paymentStatus: 'paid', // Client flags cannot grant access.
  });
  const harness = host('N-400', { savedDrafts: new Map([['N-400', draft]]) });
  const resumed = await restoreForTest(harness, 'N-400');
  assert.equal(resumed.type, 'AiPaymentGate', `${state}: resuming an older paid-form draft must remain behind payment verification`);
  const gate = paymentGate(resumed);
  assert.ok(gate.props.caseId, `${state}: old drafts receive a payment case before the gate is shown`);
  assert.equal(gate.props.caseId, harness.savedDrafts.get('N-400').paymentCaseId, 'The case must be durable before payment');
  if (state === 'interview') {
    const overviewBack = ofType(resumed, 'Pressable').find(node => node.props.accessibilityLabel === 'Overview');
    overviewBack.props.onPress();
    assert.equal(harness.render().type, 'AiPaymentGate', 'Legacy intro must remain inside the payment gate');
    assert.ok(hasAction(harness.render(), 'Start the questions'));
  }
  if (state === 'interviewReview') assert.ok(ofType(resumed, 'SectionTitle').some(node => node.props.title === 'Your draft is ready to revisit'));
  gate.props.onBack();
  assert.ok(!paymentGate(harness.render()), 'Back returns to the completed check without exposing the questionnaire');
  assert.ok(hasAction(harness.render(), 'Continue to payment'));
  harness.dispose();
}

for (const mode of ['self', 'attorney', 'ai']) {
  const formId = mode === 'ai' ? passableForms.find(form => payments.getAiPaymentKind(form.id) === 'free').id : 'I-90';
  const harness = host(formId, { savedDrafts: new Map([[formId, savedAiDraft(formId, { mode })]]) });
  const resumed = await restoreForTest(harness, formId);
  assert.ok(!paymentGate(resumed), `${mode}/${formId}: restoring a free or attorney draft must stay outside the AI gate`);
  harness.dispose();
}

const bundleCases = { 'I-130': randomUUID(), 'I-485': randomUUID() };
const bundleCandidates = () => new Map(Object.entries(bundleCases).map(([id, paymentCaseId]) => [id, savedAiDraft(id, { paymentCaseId })]));
// Local drafts never choose a package. Omitted parents let the server infer a
// verified purchase, including after reinstall or when another draft appears.
for (const userId of [undefined, randomUUID()]) {
  for (const candidates of [new Map(), bundleCandidates()]) {
    const harness = host('I-130A', { userId, savedDrafts: candidates,
      paymentStatus: async () => { throw new Error('Parent selection belongs to the server'); },
    });
    await action(await passCheck(harness, 'ai'), 'Continue to payment').onPress();
    assert.equal(harness.paymentChecks.length, 0, 'The flow must not query candidate parent purchases');
    assert.equal(paymentGate(harness.render()).props.parentCaseId, undefined, 'An omitted parent delegates package inference to the server');
    assert.equal(harness.savedDrafts.get('I-130A').paymentParentCaseId, undefined, 'Related local drafts must not create a binding');
    const restored = await restoreForTest(harness, 'I-130A');
    assert.equal(paymentGate(restored).props.parentCaseId, undefined, 'Resume still delegates an absent parent to the server');
    assert.equal(harness.paymentChecks.length, 0);
    harness.dispose();
  }
}

const freeBundle = host('G-1145', { userId: randomUUID(), savedDrafts: bundleCandidates(),
  paymentStatus: async () => { throw new Error('Free preparation must not contact the payment provider'); },
});
await action(await passCheck(freeBundle, 'ai'), 'Continue to guided preparation').onPress();
assert.equal(freeBundle.paymentChecks.length, 0, 'Free forms remain available without checking paid packages');
assert.ok(ofType(freeBundle.render(), 'FullFormPreparationScreen').length);
assert.ok(!paymentGate(freeBundle.render()));
freeBundle.dispose();

const boundCaseId = randomUUID();
const boundBundle = host('I-130A', { userId: randomUUID(), savedDrafts: new Map([
  ...bundleCandidates(), ['I-130A', savedAiDraft('I-130A', { paymentParentCaseId: boundCaseId })],
]), paymentStatus: async () => { throw new Error('A bound package must not be replaced'); } });
const restoredBundle = await restoreForTest(boundBundle, 'I-130A');
assert.equal(paymentGate(restoredBundle).props.parentCaseId, boundCaseId, 'Existing explicit package bindings remain unchanged');
assert.equal(boundBundle.paymentChecks.length, 0);
boundBundle.dispose();

const sameApplication = host('I-90');
await action(await passCheck(sameApplication, 'ai'), 'Continue to payment').onPress();
const firstCaseId = paymentGate(sameApplication.render()).props.caseId;
paymentGate(sameApplication.render()).props.onBack();
action(sameApplication.render(), 'Back to preparation options').onPress();
await action(await passCheck(sameApplication, 'ai'), 'Continue to payment').onPress();
assert.equal(paymentGate(sameApplication.render()).props.caseId, firstCaseId, 'Rechecking the same saved application must not create another charge scope');
sameApplication.dispose();

for (const fails of [false, true]) {
  let hold = false, release;
  const harness = host('I-90', { save: async () => { if (hold) { await new Promise(resolve => { release = resolve; }); if (fails) throw new Error('Test checkout save failure'); } } });
  const result = await passCheck(harness, 'ai');
  await new Promise(setImmediate);
  hold = true;
  const continuing = action(result, 'Continue to payment').onPress();
  await new Promise(setImmediate);
  assert.ok(!paymentGate(harness.render()), 'Payment must not open before its application case is saved');
  release(); await continuing;
  assert.equal(!!paymentGate(harness.render()), !fails, 'A failed case save must keep checkout closed');
  if (fails) assert.ok(hasAction(harness.render(), 'Retry saving draft'));
  harness.dispose();
}

console.log('Payment routing passed: all paid forms, free/attorney exclusions, legacy/resume guards, server-owned package inference, stable restart case and save-before-checkout.');

async function resumeLegacyIntake(harness) {
  const formId = harness.props.initialFormId;
  const checks = Object.fromEntries(schemas.find(item => item.id === formId).questions.map(q => [q.id,q.yes === 'next' ? 'yes' : 'no']));
  harness.savedDrafts.set(formId,{ version:1,formId,title:formId,mode:'ai',stage:'interview',checks,answers:{},completedFieldIds:[],answered:0,total:1,updatedAt:new Date().toISOString() });
  harness.props.resumeFormId = formId; harness.props.resumeRequest = 1;
  harness.render(); await new Promise(setImmediate); harness.render();
}

// The bottom-tab return request must wait for writes and retain failed answers.
for (const stage of ['check', 'interview']) {
  let hold = false, fail = false, release;
  const navigation = host('N-400', { save: async () => {
    if (hold) await new Promise(resolve => { release = resolve; });
    if (fail) throw new Error('Test save failure');
  } });
  if (stage === 'check') action(navigation.render(), 'Start free form check').onPress();
  else {
    await resumeLegacyIntake(navigation);
  }
  await new Promise(setImmediate);
  hold = true;
  const update = () => stage === 'check'
    ? action(navigation.render(), 'No').onPress()
    : ofType(navigation.render(), 'Field')[0].props.onChangeText('SAMPLE APPLICANT');
  update();
  assert.ok(!hasAction(navigation.render(), 'My Application'), 'The duplicate return button is removed');
  navigation.props.applicationReturnRequest++; navigation.render();
  await new Promise(setImmediate);
  assert.equal(navigation.applicationReturns, 0, `${stage}: return must await the latest save`);
  hold = false; release(); await new Promise(setImmediate);
  assert.equal(navigation.applicationReturns, 1);
  fail = true; update(); await new Promise(setImmediate);
  navigation.props.applicationReturnRequest++; navigation.render(); await new Promise(setImmediate);
  assert.equal(navigation.applicationReturns, 1, `${stage}: failed saving must keep the form open`);
  assert.ok(hasAction(navigation.render(), 'Retry saving draft'));
  fail = false;
  action(navigation.render(), 'Retry saving draft').onPress(); await new Promise(setImmediate);
  navigation.props.applicationReturnRequest++; navigation.render(); await new Promise(setImmediate);
  assert.equal(navigation.applicationReturns, 2, `${stage}: successful retry permits return`);
  navigation.dispose();
}

// A single check answer is enough to save and resume in the original mode.
for (const mode of ['self', 'ai']) {
  const current = host('N-400');
  let first = current.render();
  await action(first, { self: 'Start free form check', ai: 'Check & prepare with FillOut' }[mode]).onPress();
  first = current.render();
  const schema = schemas.find(item => item.id === 'N-400');
  const answer = schema.questions[0].yes === 'next' ? 'Yes' : 'No';
  action(first, answer).onPress();
  assert.equal(current.savedDrafts.get('N-400').answered, 1);
  assert.equal(current.savedDrafts.get('N-400').mode, mode);
  const restored = host('N-400', { savedDrafts: current.savedDrafts });
  restored.props.resumeFormId = 'N-400'; restored.props.resumeRequest = 1;
  restored.render(); await new Promise(resolve => setImmediate(resolve));
  const resumed = restored.render();
  assert.ok(ofType(resumed, 'Text').some(node => node.props.children.join('') === 'Question 2 of ' + schema.questions.length), 'Resume must immediately show the first unanswered check');
  current.dispose(); restored.dispose();
}

const intake = host('N-400');
await resumeLegacyIntake(intake);
let intakeTree = intake.render();
ofType(intakeTree, 'Field')[0].props.onChangeText('Sample Applicant');
const saved = intake.savedDrafts.get('N-400');
assert.equal(saved.stage, 'interview');
assert.equal(saved.answered, 1, 'Typing alone must persist an introductory answer');
const resumedIntake = host('N-400', { savedDrafts: intake.savedDrafts });
resumedIntake.props.resumeFormId = 'N-400'; resumedIntake.props.resumeRequest = 1;
resumedIntake.render(); await new Promise(resolve => setImmediate(resolve));
const resumedTree = resumedIntake.render();
const n400Fields = readData('preparation-fields.json').forms.find(item => item.id === 'N-400').fields;
assert.ok(ofType(resumedTree, 'SectionTitle').some(node => node.props.title === n400Fields[1].label), 'Continue must go directly to the next unanswered interview question');
assert.ok(!hasAction(resumedTree, 'Start the questions'));
intake.dispose(); resumedIntake.dispose();

// A failed restore must not remount the active editor from its older initialDraft.
for (const mode of ['self', 'ai']) {
  let rejectLoad;
  let resolveLoad;
  let deferLoad = false;
  const current = host('I-90', { loadDraft: () => deferLoad ? new Promise((resolve,reject) => { resolveLoad=resolve; rejectLoad=reject; }) : Promise.resolve(null) });
  let activeTree = await passCheck(current, mode);
  if (mode === 'ai') {
    await action(activeTree, aiContinueTitle('I-90')).onPress();
    activeTree = current.render();
  }
  const component = mode === 'self' ? 'FreeFormPreparationScreen' : 'FullFormPreparationScreen';
  const activeEditor = ofType(activeTree, component)[0];
  assert.ok(activeEditor);
  deferLoad = true;
  current.props.resumeFormId = 'I-90'; current.props.resumeRequest = 1;
  current.render();
  let pending = ofType(current.render(), component)[0];
  assert.ok(pending, `${mode}: the live editor must stay mounted while loading a saved draft`);
  assert.equal(pending.props.key, activeEditor.props.key);
  assert.equal(pending.props.initialDraft, activeEditor.props.initialDraft);
  rejectLoad(new Error('Storage temporarily unavailable'));
  await new Promise(setImmediate);
  const afterFailure = ofType(current.render(), component)[0];
  assert.ok(afterFailure, `${mode}: a failed restore must preserve the active editor`);
  assert.equal(afterFailure.props.key, activeEditor.props.key, 'A failed load cannot reset child answers by changing its key');
  assert.equal(afterFailure.props.initialDraft, activeEditor.props.initialDraft, 'A failed load cannot inject an older saved snapshot');

  current.props.resumeRequest = 2;
  current.render();
  const replacement = {...current.savedDrafts.get('I-90'),stage:mode === 'self' ? 'freePreparation' : 'fullPreparation',
    ...(mode === 'self' ? {pdfValues:{name:'Latest saved answer'},pdfPage:2} : {fullAnswers:{family_name:'Latest saved answer'}})};
  resolveLoad(replacement);
  await new Promise(setImmediate);
  const afterSuccess = ofType(current.render(), component)[0];
  assert.ok(afterSuccess);
  assert.notEqual(afterSuccess.props.key, activeEditor.props.key, 'Successful restore must remount even when resuming the same form');
  assert.equal(JSON.stringify(afterSuccess.props.initialDraft), JSON.stringify(replacement), 'The remounted child must receive the newly restored snapshot, including its existing payment case');
  current.dispose();
}

// Use the real storage queue: a save that fails after Continue was pressed must
// not let either child remount from the older stored answers.
for (const mode of ['self', 'ai']) {
  const stored = new Map();
  let writeGate;
  const storageModule = {exports:{}};
  vm.runInNewContext(compile('src/draftStorage.ts'), {
    module:storageModule,exports:storageModule.exports,
    require(name) {
      if (name !== '@react-native-async-storage/async-storage') throw new Error(name);
      return {
        getItem:async key=>stored.get(key)||null,
        async setItem(key,value) {
          if (writeGate) {const gate=writeGate;writeGate=undefined;await gate;}
          stored.set(key,value);
        },
      };
    },
  });
  const storageApi = storageModule.exports;
  const current = host('I-90',{draftStorage:storageApi});
  let activeTree = await passCheck(current,mode);
  if (mode === 'ai') { await action(activeTree,aiContinueTitle('I-90')).onPress(); current.render(); }
  const baseline = {...await storageApi.loadDraft('I-90'),stage:mode==='self'?'freePreparation':'fullPreparation',
    ...(mode==='self'?{pdfValues:{name:'Previously saved'},pdfPage:1}:{fullAnswers:{family_name:'Previously saved'}})};
  await storageApi.saveDraft(baseline);
  current.props.resumeFormId='I-90';current.props.resumeRequest=1;
  current.render();await new Promise(setImmediate);
  const component=mode==='self'?'FreeFormPreparationScreen':'FullFormPreparationScreen';
  const initialEditor=ofType(current.render(),component)[0];
  assert.ok(initialEditor);

  let rejectWrite;
  writeGate=new Promise((resolve,reject)=>{rejectWrite=reject;});
  const latest={...baseline,...(mode==='self'?{pdfValues:{name:'Latest unsaved answer'}}:{fullAnswers:{family_name:'Latest unsaved answer'}})};
  const saving=storageApi.saveDraft(latest);
  const failedSave=assert.rejects(saving,/Deferred save failure/);
  current.props.resumeRequest=2;current.render();
  assert.equal(ofType(current.render(),component)[0].props.key,initialEditor.props.key);
  rejectWrite(new Error('Deferred save failure'));
  await failedSave;await new Promise(setImmediate);
  const failedTree=current.render();
  const preserved=ofType(failedTree,component)[0];
  assert.equal(preserved.props.key,initialEditor.props.key,`${mode}: a failed pending save must preserve the live child's unsaved state`);
  assert.equal(preserved.props.initialDraft,initialEditor.props.initialDraft,'Do not replace live answers with the older stored snapshot');
  assert.ok(hasAction(failedTree,'Retry opening saved draft'),'Explain the failed restore without silently resetting the editor');

  await storageApi.saveDraft(latest);
  action(failedTree,'Retry opening saved draft').onPress();
  current.render();await new Promise(setImmediate);
  const recovered=ofType(current.render(),component)[0];
  assert.notEqual(recovered.props.key,initialEditor.props.key,'Successful save recovery must permit the requested restore');
  assert.equal(mode==='self'?recovered.props.initialDraft.pdfValues.name:recovered.props.initialDraft.fullAnswers.family_name,'Latest unsaved answer');
  current.dispose();
}

const optionalFields = [{ id: 'name', type: 'text', required: true }, { id: 'note', type: 'text' }, { id: 'email', type: 'email', required: true }];
assert.equal(qualification.draftProgress(optionalFields, { name: 'Sample' }).firstUnanswered, 1, 'Do not skip an untouched optional question');
assert.equal(qualification.draftProgress(optionalFields, { name: 'Sample' }, ['note']).firstUnanswered, 2, 'A deliberately skipped optional question stays completed');
const languageRef = { current: 'en' };
const bilingual = host('N-400', { languageRef });
await action(bilingual.render(), 'Check & prepare with FillOut').onPress();
action(bilingual.render(), 'No').onPress();
const storedChecks = JSON.stringify(bilingual.savedDrafts.get('N-400').checks);
languageRef.current = 'ru';
let russianTree = bilingual.render();
assert.ok(ofType(russianTree, 'Text').some(node => node.props.children.join('') === 'Вопрос 2 из 6'));
assert.equal(JSON.stringify(bilingual.savedDrafts.get('N-400').checks), storedChecks, 'Changing language must preserve qualification answers and machine values');
assert.ok(hasAction(russianTree, 'Да')); assert.ok(hasAction(russianTree, 'Нет'));
languageRef.current = 'en';
assert.ok(hasAction(bilingual.render(), 'Yes'), 'Switching back restores English labels without restarting');
bilingual.dispose();
const russianSearch = host(undefined, { languageRef: { current: 'ru' } });
let searchTree = russianSearch.render();
assert.equal(ofType(searchTree, 'LanguageSwitcher').length, 1, 'Homepage has a language switcher');
action(searchTree, 'Поиск по номеру или названию формы').onPress();
searchTree = russianSearch.render();
ofType(searchTree, 'Field').find(node => node.props.label === 'Поиск форм').props.onChangeText('гражданство');
searchTree = russianSearch.render();
assert.ok(ofType(searchTree, 'Text').some(node => node.props.children.includes('N-400')), 'Russian catalog queries must match localized labels');
assert.ok(!ofType(searchTree, 'Text').some(node => node.props.children.includes('I-90')), 'Russian words must filter results rather than normalize to an empty search');
russianSearch.dispose();
console.log('Draft flow checks passed: outcome-based colors, first-answer self/AI autosave, direct attorney intake autosave, direct resume, failed-restore preservation, same-form remount, and optional question progress.');
})().catch(error => { console.error(error); process.exitCode = 1; });
