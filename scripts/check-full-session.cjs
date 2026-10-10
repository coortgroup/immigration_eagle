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

const moduleValue = { exports: {} };
vm.runInNewContext(source, {
  module: moduleValue,
  exports: moduleValue.exports,
  window: { location: { search: '' } },
  URLSearchParams,
  require(name) {
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
    if (name === './src/screens/AssistantScreen') return { AssistantScreen: 'AssistantScreen' };
    if (name === './src/draftStorage') return {
      deleteDraft: () => new Promise(resolve => { releaseDelete = resolve; }),
      listDrafts: async () => [],
    };
    if (name === './src/theme') return { colors: {} };
    if (name === './src/components/UI') return { Button: 'Button', Card: 'Card', SectionTitle: 'SectionTitle' };
    if (name.endsWith('.png')) return 1;
    throw new Error(`Unexpected dependency: ${name}`);
  },
});

const EagleApp = moduleValue.exports.default().props.children[0].type;
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
const homeFlow = tree => ofType(tree, 'FormsFlow')[0].props;
const applications = tree => ofType(tree, 'ApplicationScreen')[0].props;
const button = (tree, title) => {
  const found = ofType(tree, 'Button').find(node => node.props.title === title);
  assert.ok(found, `Expected the ${title} action`);
  return found.props;
};

(async () => {
  let tree = render();
  homeFlow(tree).onFullSessionActiveChange(true);
  const removal = applications(tree).onRemove('N-400');
  releaseDelete();
  await removal;
  tree = render();
  assert.equal(homeFlow(tree).key, 0, 'Deleting an old draft must not unmount the current full-form session');

  applications(tree).onResume('N-400');
  tree = render();
  assert.equal(homeFlow(tree).resumeRequest, 0, 'A saved draft cannot replace the full session before discard confirmation');
  assert.equal(ofType(tree, 'Modal')[0].props.visible, true);

  assert.equal(ofType(tree, 'SectionTitle')[0].props.title, 'Keep your current form?', 'The guard must describe free PDF sessions as well as I-90 preparation');
  button(tree, 'Keep working on my form').onPress();
  tree = render();
  assert.equal(ofType(tree, 'Modal')[0].props.visible, false);
  assert.equal(homeFlow(tree).key, 0, 'Keep working must preserve the mounted form and its answers');

  applications(tree).onResume('N-400');
  tree = render();
  // Native hardware back/dismiss must have the same non-destructive behavior.
  ofType(tree, 'Modal')[0].props.onRequestClose();
  tree = render();
  assert.equal(ofType(tree, 'Modal')[0].props.visible, false);
  assert.equal(homeFlow(tree).key, 0);
  assert.equal(homeFlow(tree).resumeRequest, 0);

  applications(tree).onResume('N-400');
  tree = render();
  button(tree, 'Clear form and open saved draft').onPress();
  tree = render();
  assert.equal(homeFlow(tree).key, 1, 'Only explicit discard may unmount the full-form session');
  assert.equal(homeFlow(tree).resumeFormId, 'N-400');
  assert.equal(homeFlow(tree).resumeRequest, 1);

  homeFlow(tree).onFullSessionActiveChange(false);
  const normalRemoval = applications(tree).onRemove('N-400');
  releaseDelete();
  await normalRemoval;
  tree = render();
  assert.equal(homeFlow(tree).key, 2, 'Deleting an old draft still clears its editor when no full session is active');

  // The deletion callback started while inactive, but the user enters a full
  // session before storage finishes. The decision must read fresh state.
  const racingRemoval = applications(tree).onRemove('N-400');
  homeFlow(tree).onFullSessionActiveChange(true);
  releaseDelete();
  await racingRemoval;
  tree = render();
  assert.equal(homeFlow(tree).key, 2, 'A full session started during pending deletion must survive');

  homeFlow(tree).onFullSessionActiveChange(false);
  applications(tree).onResume('I-765');
  tree = render();
  assert.equal(ofType(tree, 'Modal')[0].props.visible, false, 'Normal resume needs no full-session discard dialog');
  assert.equal(homeFlow(tree).resumeFormId, 'I-765');
  assert.equal(homeFlow(tree).resumeRequest, 1);
  console.log('Full-session lifecycle passed: actual App handlers preserve answers on delete/race, require explicit discard on resume, respect keep/dismiss, and retain normal draft behavior.');
})().catch(error => { console.error(error); process.exitCode = 1; });
