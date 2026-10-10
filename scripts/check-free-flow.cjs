#!/usr/bin/env node
// Exercise the actual FormsFlow handlers without a browser or a native runtime.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

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
const passableForms = catalog.filter(form => schemas.find(schema => schema.id === form.id).questions.every(question => question.yes === 'next' || question.no === 'next'));

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

function host(formId, options = {}) {
  const slots = [];
  let index = 0;
  let pendingEffects = [];
  const backHandlers = new Set();
  const activeSessions = [];
  const externalLinks = [];
  let contacts = 0;
  const props = {
    initialFormId: formId, isActive: true,
    onContact: () => { contacts++; },
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
    module: moduleRef, exports: moduleRef.exports,
    require(name) {
      if (name === 'react') return { ...React, default: React, __esModule: true };
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
      if (name === '../draftStorage') return { loadDraft: async () => null, saveDraft: async () => {} };
      if (name === '../components/EmailAccess') return { EmailAccess: 'EmailAccess' };
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
    props, activeSessions, externalLinks, backHandlers,
    get contacts() { return contacts; },
    render() {
      index = 0; pendingEffects = [];
      const tree = moduleRef.exports.FormsFlow(props);
      pendingEffects.forEach(effect => effect());
      return tree;
    },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

function passCheck(harness, mode = 'self') {
  let tree = harness.render();
  action(tree, { self: 'Start free form check', ai: 'Check & prepare with AI', attorney: 'Check & request attorney help' }[mode]).onPress();
  tree = harness.render();
  const schema = schemas.find(item => item.id === harness.props.initialFormId);
  for (const question of schema.questions) {
    assert.ok(!editor(tree), 'The editor must stay closed while checks are unanswered');
    const answer = question.yes === 'next' ? 'Yes' : question.no === 'next' ? 'No' : null;
    assert.ok(answer, `${schema.id}: expected a passable test path`);
    action(tree, answer).onPress();
    tree = harness.render();
  }
  return tree;
}

for (const form of passableForms) {
  const harness = host(form.id);
  let tree = passCheck(harness);
  assert.ok(editor(tree), `${form.id}: the final passing free answer must open the PDF automatically`);
  assert.equal(editor(tree).props.formId, form.id);
  assert.equal(editor(tree).props.officialUrl, form.officialUrl);
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
  tree = harness.render();
  assert.ok(hasAction(tree, 'Open PDF form'), 'Leaving the editor must allow reopening it');
  assert.equal(harness.activeSessions.at(-1), false);
  action(tree, 'Open PDF form').onPress();
  tree = harness.render();
  assert.ok(editor(tree));

  editor(tree).props.onExit();
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
for (const schema of schemas) {
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
      assert.ok(hasAction(tree, 'Contact our team'));
      assert.equal(harness.activeSessions.at(-1), false);
      harness.dispose();
      blockedBranches++;
    }
  }
}

for (const [formId, destination] of [['I-90', 'FullFormPreparationScreen'], ['N-400', 'SectionTitle']]) {
  const harness = host(formId);
  let tree = passCheck(harness, 'ai');
  assert.ok(!editor(tree), 'Paid/guided choices must retain their separate result step');
  action(tree, 'Continue to guided preparation').onPress();
  tree = harness.render();
  assert.ok(ofType(tree, destination).length);
  if (formId === 'I-90') assert.equal(harness.activeSessions.at(-1), true, 'I-90 must retain full-session protection');
  else assert.ok(hasAction(tree, 'Start the questions'));
  harness.dispose();
}

const attorney = host('I-90');
let tree = passCheck(attorney, 'attorney');
assert.ok(!editor(tree));
action(tree, 'Continue to attorney intake').onPress();
tree = attorney.render();
assert.ok(hasAction(tree, 'Preview my request'));
attorney.dispose();

const unavailable = host('G-639');
tree = passCheck(unavailable, 'ai');
action(tree, 'Ask our team about preparation').onPress();
assert.equal(unavailable.contacts, 1, 'Unavailable AI preparation must still contact the team');
assert.ok(!editor(unavailable.render()));
unavailable.dispose();

const related = host('I-130A');
tree = passCheck(related, 'ai');
action(tree, 'View I-130 package').onPress();
tree = related.render();
assert.ok(hasAction(tree, 'Check & prepare with AI'), 'Related-document AI preparation must open its parent package');
assert.ok(!editor(tree));
related.dispose();

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

console.log(`Free PDF routing passed: ${passableForms.length} automatic openings/reopen/back paths, ${blockedBranches} blocked/uncertain branches across all ${catalog.length} forms, session guards, and unchanged AI/attorney/package gates.`);
