#!/usr/bin/env node
// Verify saved guided-draft progress, including stage boundaries and invalid counts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const language = require('./language-test-helper.cjs');

const source = ts.transpileModule(fs.readFileSync('src/screens/ApplicationScreen.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const React = {
  createElement(type, props, ...children) {
    const next = { ...props, children };
    return typeof type === 'function' ? type(next) : { type, props: next };
  },
  useState: initial => [initial, () => {}],
};
const moduleRef = { exports: {} };
vm.runInNewContext(source, {
  module: moduleRef, exports: moduleRef.exports,
  require(name) {
    if (name.endsWith('/LanguageContext') || name.endsWith('/i18n')) return language;
    if (name === 'react') return { ...React, default: React, __esModule: true };
    if (name === 'react-native') return {
      Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
      StyleSheet: { create: value => value },
    };
    if (name.includes('Ionicons')) return { default: 'Ionicons', __esModule: true };
    if (name.endsWith('forms-catalog.json')) return { forms: [] };
    throw new Error(`Unexpected dependency: ${name}`);
  },
});
function render(overrides = {}) {
  return moduleRef.exports.ApplicationScreen({
    drafts: [{ formId: 'I-90', title: 'Replace a green card', mode: 'ai', stage: 'fullPreparation',
      answered: 3, total: 10, updatedAt: '2026-10-11T12:00:00.000Z', ...overrides }],
    onSelectForm() {}, onRetry() {}, onResume() {}, async onRemove() {},
  });
}
function findAll(node, predicate, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (Array.isArray(node)) { node.forEach(child => findAll(child, predicate, result)); return result; }
  if (predicate(node)) result.push(node);
  findAll(node.props?.children, predicate, result);
  return result;
}
const content = node => typeof node === 'string' || typeof node === 'number' ? String(node)
  : Array.isArray(node) ? node.map(content).join(' ') : content(node?.props?.children || []);
const bars = tree => findAll(tree, node => node.props?.accessibilityRole === 'progressbar');
function checkProgress(overrides, percent, remainingText, answeredText) {
  const tree = render(overrides);
  assert.equal(bars(tree).length, 1, 'A guided draft has one visible, accessible progress bar');
  const bar = bars(tree)[0];
  assert.equal(bar.props.accessibilityValue.now, percent);
  assert.equal(bar.props.accessibilityValue.min, 0);
  assert.equal(bar.props.accessibilityValue.max, 100);
  assert.equal(bar.props.accessibilityValue.text, `${percent}% complete`);
  assert.equal(bar.props.children[0].props.style[1].width, `${percent}%`);
  assert.ok(content(tree).includes(remainingText), remainingText);
  assert.ok(content(tree).includes(answeredText), answeredText);
  return tree;
}

const partial = checkProgress({}, 30, '7 questions remaining', '3 of 10 questions answered');
assert.match(content(partial), /FillOut preparation/);
assert.equal(bars(partial)[0].props.accessibilityLabel, 'I-90: FillOut preparation progress');
checkProgress({ answered: 0 }, 0, '10 questions remaining', '0 of 10 questions answered');
checkProgress({ answered: 9 }, 90, '1 question remaining', '9 of 10 questions answered');
checkProgress({ answered: 10 }, 100, 'No questions remaining', '10 of 10 questions answered');
checkProgress({ answered: 999, total: 1000 }, 99, '1 question remaining', '999 of 1000 questions answered');
checkProgress({ answered: -2 }, 0, '10 questions remaining', '0 of 10 questions answered');
checkProgress({ answered: 12 }, 100, 'No questions remaining', '10 of 10 questions answered');

const checking = checkProgress({ stage: 'check', answered: 2, total: 4 }, 50, '2 questions remaining', '2 of 4 questions answered');
assert.equal(bars(checking)[0].props.accessibilityLabel, 'I-90: Preliminary check progress');
assert.ok(!content(checking).includes('FillOut preparation'), 'Check counts must not be presented as form-completion progress');
const checked = checkProgress({ stage: 'check', answered: 4, total: 4 }, 100, 'No questions remaining', '4 of 4 questions answered');
assert.match(content(checked), /Preliminary check/);

for (const invalid of [{ total: 0 }, { total: -1 }, { total: NaN }, { total: Infinity }, { total: 2.5 }, { answered: NaN }, { answered: Infinity }]) {
  const tree = render(invalid);
  assert.equal(bars(tree).length, 0, 'Unknown counts must not invent a percentage');
  assert.match(content(tree), /Progress unavailable/);
  assert.doesNotMatch(content(tree), /NaN|Infinity|\d+% complete/);
}
for (const stage of ['interview', 'fullPreparation']) {
  assert.equal(bars(render({ mode: undefined, stage })).length, 1, 'Legacy guided stages retain visible progress');
}
assert.equal(bars(render({ mode: 'self', stage: 'freePreparation' })).length, 0, 'PDF fields must not be described as guided questions');
assert.equal(bars(render({ mode: 'attorney', stage: 'attorney' })).length, 0, 'Attorney drafts retain their status tracker');

console.log('Saved guided progress: real counts, stage labels, percentage, remaining questions, accessibility, clamping and invalid counts passed.');
