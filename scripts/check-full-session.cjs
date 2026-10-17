#!/usr/bin/env node
// Exercise the real App handlers with a small hook host. No network or user data.
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');

const source = ts.transpileModule(fs.readFileSync('App.tsx', 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.React,
    esModuleInterop: true,
  },
}).outputText;

const slots = [];
let index = 0;
let releaseDelete;
let savedDrafts = [];
const React = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  useState(initial) {
    const position = index++;
    if (!(position in slots)) slots[position] = typeof initial === 'function' ? initial() : initial;
    return [slots[position], value => {
      slots[position] = typeof value === 'function' ? value(slots[position]) : value;
    }];
  },
  useRef(initial) {
    const position = index++;
    return slots[position] ?? (slots[position] = { current: initial });
  },
  useCallback(callback) { index++; return callback; },
  // App's startup draft refresh does not participate in these user-event tests.
  useEffect() { index++; },
};

const location = { search: '' };
const moduleValue = { exports: {} };
vm.runInNewContext(source, {
  module: moduleValue,
  exports: moduleValue.exports,
  window: { location },
  URLSearchParams,
  require(name) {
      if (name.endsWith('/LanguageContext')) return require('./language-test-helper.cjs');
      if (name.endsWith('/i18n')) return require('./language-test-helper.cjs');
      if (name.endsWith('/LanguageSwitcher')) return { LanguageSwitcher: 'LanguageSwitcher' };
    if (name === 'react') return { ...React, default: React, __esModule: true };
    if (name === 'react-native') return {
      Image: 'Image', Modal: 'Modal', Platform: { OS: 'web' }, Pressable: 'Pressable',
      StyleSheet: { create: value => value }, Text: 'Text', View: 'View',
    };
    if (name === 'react-native-safe-area-context') return { SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView' };
    if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
    if (name.includes('Ionicons')) return { default: 'Ionicons', __esModule: true };
    if (name === './src/screens/FormsFlow') return { default: 'FormsFlow', __esModule: true };
    if (name === './src/screens/ApplicationScreen') return { ApplicationScreen: 'ApplicationScreen' };
    if (name === './src/components/MyReviewSubmissions') return { MyReviewSubmissions: 'MyReviewSubmissions' };
    if (name === './src/AccountContext') return { AccountProvider: 'AccountProvider', useAccount: () => ({ user: null, ready: true, locked: false, scope: 'guest', error: '' }) };
    if (name === './src/screens/AccountScreen') return { AccountScreen: 'AccountScreen' };
    if (name === './src/screens/AssistantScreen') return { AssistantScreen: 'AssistantScreen' };
    if (name === './src/draftStorage') return {
      deleteDraft: () => new Promise(resolve => { releaseDelete = resolve; }),
      listDrafts: async () => savedDrafts,
    };
    if (name === './src/theme') return { colors: {} };
    if (name === './src/components/UI') return { Button: 'Button', Card: 'Card', SectionTitle: 'SectionTitle' };
    if (name.endsWith('.png')) return 1;
    throw new Error(`Unexpected dependency: ${name}`);
  },
});

const AccountShell = moduleValue.exports.default().props.children[0].props.children[0].props.children[0].type;
const EagleApp = AccountShell().props.children[0].props.children[0].type;
slots.length = 0;
function render() { index = 0; return EagleApp(); }
function findAll(node, predicate, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (Array.isArray(node)) {
    node.forEach(child => findAll(child, predicate, result));
    return result;
  }
  if (predicate(node)) result.push(node);
  findAll(node.props?.children, predicate, result);
  return result;
}
const ofType = (tree, type) => findAll(tree, node => node.type === type);
const homeFlow = tree => ofType(tree, 'FormsFlow').find(node => node.props.onOpenApplicationForm).props;
const applicationFlow = tree => ofType(tree, 'FormsFlow').find(node => node.props.onExitToApplications)?.props;
const applications = tree => ofType(tree, 'ApplicationScreen')[0].props;
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : text(node?.props?.children || []);
const tab = (tree, title) => {
  const found = ofType(tree, 'Pressable').find(node => node.props.accessibilityRole === 'tab' && text(node) === title);
  assert.ok(found, `Expected the ${title} tab`);
  return found.props;
};
const panel = (tree, component) => ofType(tree, 'View').find(node => node.props.children?.some(child => child?.type === component)).props;

(async () => {
  let tree = render();
  assert.equal(ofType(tree, 'FormsFlow').length, 1, 'Only the Home browser is needed before choosing a form');
  assert.equal(homeFlow(tree).isActive, true);
  assert.equal(homeFlow(tree).onSaveErrorChange, undefined, 'The Home browser must not clear an application save error');
  tab(tree, 'My Application').onPress();
  tree = render();
  assert.equal(homeFlow(tree).isActive, false);
  assert.equal(panel(tree, 'ApplicationScreen').accessibilityElementsHidden, false);

  tab(tree, 'Home').onPress();
  tree = render();
  homeFlow(tree).onOpenApplicationForm('N-400');
  tree = render();
  assert.equal(applicationFlow(tree).initialFormId, 'N-400');
  assert.equal(applicationFlow(tree).isActive, true);
  assert.equal(homeFlow(tree).isActive, false, 'Only the application flow can own editable preparation');
  assert.equal(tab(tree, 'My Application').accessibilityState.selected, true, 'Starting from Home must immediately select My Application');
  assert.equal(panel(tree, 'ApplicationScreen').accessibilityElementsHidden, true, 'Preparation replaces the application list');
  let selectedKey = applicationFlow(tree).key;

  tab(tree, 'My Application').onPress();
  tree = render();
  assert.equal(applicationFlow(tree).applicationReturnRequest, 1, 'Pressing the already selected tab requests a guarded return');
  assert.equal(applicationFlow(tree).isActive, true, 'Keep the editor visible until its latest save succeeds');
  assert.equal(panel(tree, 'ApplicationScreen').accessibilityElementsHidden, true);
  applicationFlow(tree).onExitToApplications();
  tree = render();
  assert.equal(applicationFlow(tree).isActive, false);
  assert.equal(applicationFlow(tree).key, selectedKey, 'Returning to the list must preserve the mounted editor');
  assert.equal(panel(tree, 'ApplicationScreen').accessibilityElementsHidden, false);

  const removal = applications(tree).onRemove('N-400');
  releaseDelete();
  await removal;
  tree = render();
  assert.equal(applicationFlow(tree).key, selectedKey, 'Deleting a draft must not unmount the retained preparation session');

  applications(tree).onResume('N-400');
  tree = render();
  applicationFlow(tree).onExitToApplications();
  tree = render();
  assert.equal(applicationFlow(tree).resumeRequest, 1);
  assert.equal(applicationFlow(tree).resumeFormId, 'N-400');
  assert.equal(applicationFlow(tree).isActive, true);
  assert.equal(tab(tree, 'My Application').accessibilityState.selected, true, 'Resumed preparation belongs to My Application');
  assert.equal(ofType(tree, 'Modal').length, 0, 'Autosaved drafts resume without a discard dialog');
  assert.equal(applicationFlow(tree).key, selectedKey, 'Resume is delivered to the existing preparation flow');

  tab(tree, 'Home').onPress();
  tree = render();
  assert.equal(homeFlow(tree).isActive, true, 'Home shows the form browser while the editor stays mounted');
  assert.equal(applicationFlow(tree).isActive, false);
  assert.equal(applicationFlow(tree).key, selectedKey);
  tab(tree, 'Chat').onPress();
  tree = render();
  assert.equal(applicationFlow(tree).key, selectedKey, 'Chat must not reset the current editor');
  tab(tree, 'My Application').onPress();
  tree = render();
  assert.equal(applicationFlow(tree).applicationReturnRequest, 3);
  applicationFlow(tree).onExitToApplications();
  tree = render();
  assert.equal(panel(tree, 'ApplicationScreen').accessibilityElementsHidden, false, 'The bottom tab always targets the application list');
  applications(tree).onResume('N-400');
  tree = render();
  applicationFlow(tree).onExitToApplications();
  tree = render();
  assert.equal(applicationFlow(tree).resumeRequest, 2, 'Repeated resume of the same form must trigger a fresh restore');

  applications(tree).onSelectForm('I-765');
  tree = render();
  assert.equal(applicationFlow(tree).key, selectedKey, 'Changing forms waits for the retained editor to finish saving');
  applicationFlow(tree).onExitToApplications();
  tree = render();
  assert.equal(applicationFlow(tree).initialFormId, 'I-765', 'All forms opens preparation within My Application');
  assert.equal(applicationFlow(tree).isActive, true);
  assert.equal(applicationFlow(tree).key, selectedKey + 1);
  assert.equal(applicationFlow(tree).resumeFormId, undefined);
  assert.equal(applicationFlow(tree).resumeRequest, 0);

  const racingRemoval = applications(tree).onRemove('N-400');
  applications(tree).onSelectForm('I-90');
  tree = render();
  applicationFlow(tree).onExitToApplications();
  tree = render();
  selectedKey = applicationFlow(tree).key;
  releaseDelete();
  await racingRemoval;
  tree = render();
  assert.equal(applicationFlow(tree).key, selectedKey, 'Finishing an old removal must not reset a newly opened form');
  assert.equal(applicationFlow(tree).initialFormId, 'I-90');

  applicationFlow(tree).onSaveErrorChange(true);
  tab(tree, 'Home').onPress();
  tree = render();
  homeFlow(tree).onOpenApplicationForm('AR-11');
  tree = render();
  assert.equal(tab(tree, 'My Application').accessibilityState.selected, true, 'An unsaved draft returns to its application screen');
  assert.equal(applicationFlow(tree).isActive, true);
  assert.equal(applicationFlow(tree).key, selectedKey, 'A new form must not replace an unsaved editor');
  assert.equal(applicationFlow(tree).initialFormId, 'I-90');
  applicationFlow(tree).onSaveErrorChange(false);

  savedDrafts = [{formId:'I-90',title:'Sample',answered:1,total:10,updatedAt:'2026-10-09T12:00:00.000Z'}];
  applicationFlow(tree).onDraftSaved();
  await new Promise(setImmediate);
  tree = render();
  assert.equal(applications(tree).drafts.length, 1);
  assert.equal(applications(tree).drafts[0].answered, 1, 'Autosave immediately refreshes the saved draft list');

  tab(tree, 'My Application').onPress();
  tree = render();
  applicationFlow(tree).onExitToApplications();
  tree = render();
  assert.equal(panel(tree, 'ApplicationScreen').accessibilityElementsHidden, false);
  assert.equal(applicationFlow(tree).key, selectedKey);
  assert.equal(ofType(tree, 'FormsFlow').filter(node => node.props.onExitToApplications).length, 1, 'Only one preparation flow owns current answers');

  // Starting a different form from Home cannot abandon a write that has not
  // finished yet, even before onSaveErrorChange reports its eventual failure.
  tab(tree, 'Home').onPress();
  tree = render();
  homeFlow(tree).onOpenApplicationForm('AR-11');
  tree = render();
  const pendingExit = applicationFlow(tree).onExitToApplications;
  assert.equal(applicationFlow(tree).key, selectedKey, 'Home selection keeps the pending editor mounted');
  assert.equal(applicationFlow(tree).initialFormId, 'I-90');
  assert.equal(applicationFlow(tree).isActive, true, 'The old editor is visible for save-error recovery');
  applicationFlow(tree).onSaveErrorChange(true);
  tree = render();
  assert.equal(applicationFlow(tree).key, selectedKey, 'A late failed write preserves the old form and its answers');
  applicationFlow(tree).onSaveErrorChange(false);
  pendingExit(); // The editor invokes its captured callback only after retry succeeds.
  tree = render();
  assert.equal(applicationFlow(tree).initialFormId, 'AR-11');
  assert.equal(applicationFlow(tree).key, selectedKey + 1, 'Successful retry finally opens the requested form');
  selectedKey = applicationFlow(tree).key;

  tab(tree, 'Home').onPress();
  tree = render();
  homeFlow(tree).onOpenApplicationForm('N-400');
  tree = render();
  const supersededExit = applicationFlow(tree).onExitToApplications;
  tab(tree, 'My Application').onPress();
  tree = render();
  supersededExit(); // This callback predates the user cancelling the new form.
  tree = render();
  assert.equal(panel(tree, 'ApplicationScreen').accessibilityElementsHidden, false, 'Bottom My Application cancels a pending form selection');
  assert.equal(applicationFlow(tree).initialFormId, 'AR-11', 'A stale completion must not open the cancelled form');
  assert.equal(applicationFlow(tree).key, selectedKey);

  applications(tree).onSelectForm('I-765');
  tree = render();
  assert.equal(applicationFlow(tree).key, selectedKey, 'A retained flow is guarded even after returning to the list');
  applicationFlow(tree).onExitToApplications();
  tree = render();
  assert.equal(applicationFlow(tree).initialFormId, 'I-765');
  assert.equal(applicationFlow(tree).isActive, true);

  slots.length = 0; location.search = '?form=AR-11';
  tree = render();
  assert.equal(tab(tree, 'My Application').accessibilityState.selected, true, 'Form deep links open within My Application');
  assert.equal(applicationFlow(tree).initialFormId, 'AR-11');
  assert.equal(applicationFlow(tree).isActive, true);
  console.log('Application lifecycle passed: Home-to-application preparation, retained editor, guarded bottom-tab list return, direct/repeated resume, deep links, save-error recovery, guarded form replacement, cancelled navigation, autosave refresh, and deletion race protection.');
})().catch(error => { console.error(error); process.exitCode = 1; });
