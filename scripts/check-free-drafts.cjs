#!/usr/bin/env node
// Exercise real draft bridge helpers and PDF-screen save/close handlers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { translate } = require('./language-test-helper.cjs');

const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const bridgeRef = { exports: {} };
vm.runInNewContext(compile('src/pdfEditorBridge.ts'), { module: bridgeRef, exports: bridgeRef.exports });
const bridge = bridgeRef.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const fields = [
  { name: 'first', value: '', kind: 'text', options: [], widgets: [{ page: 1 }] },
  { name: 'late', value: '', kind: 'text', options: [], widgets: [{ page: 3 }] },
  { name: 'next', value: '', kind: 'text', options: [], widgets: [{ page: 3 }] },
  { name: 'check', value: false, kind: 'checkbox', options: [], widgets: [{ page: 3 }] },
  { name: 'choice', value: '', kind: 'choice', options: ['A', 'B'], widgets: [{ page: 3 }] },
];
const restored = bridge.restorePdfDraft(fields, { first: 'ONE', late: 'LATE', check: true, choice: 'INVALID', removed: 'OLD' }, 3, 5);
assert.deepEqual(plain(restored), { values: { first: 'ONE', late: 'LATE', next: '', check: true, choice: '' }, page: 3, focusField: 'next' });
assert.deepEqual(plain(bridge.pdfDraftProgress(restored.values)), { answered: 3, total: 5 });
assert.equal(bridge.restorePdfDraft(fields, { first: true, check: 'true' }, 99, 5).page, 1, 'Resume wraps to earlier unanswered fields');
assert.equal(bridge.restorePdfDraft(fields, { first: true, check: 'true' }, 0, 5).values.check, false);
const sequentialFields = [
  { name: 'first', value: '', kind: 'text', options: [], widgets: [{ page: 1 }] },
  { name: 'second', value: '', kind: 'text', options: [], widgets: [{ page: 2 }] },
  { name: 'third', value: '', kind: 'text', options: [], widgets: [{ page: 3 }] },
];
const nextPage = bridge.restorePdfDraft(sequentialFields, { first: 'DONE' }, 1, 3);
assert.equal(nextPage.page, 2, 'A completed saved page must advance to the next unanswered page');
assert.equal(nextPage.focusField, 'second');
const forwardBeforeGap = bridge.restorePdfDraft(sequentialFields, { second: 'DONE' }, 2, 3);
assert.equal(forwardBeforeGap.page, 3, 'Continue forwards before returning to an earlier gap');
assert.equal(bridge.restorePdfDraft(sequentialFields, { second: 'DONE', third: 'DONE' }, 2, 3).page, 1);
const complete = bridge.restorePdfDraft(sequentialFields, { first: 'DONE', second: 'DONE', third: 'DONE' }, 2, 3);
assert.equal(complete.page, 2, 'Completed forms retain the saved page');
assert.equal(complete.focusField, undefined);

function findAll(node, predicate, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (Array.isArray(node)) { node.forEach(child => findAll(child, predicate, result)); return result; }
  if (predicate(node)) result.push(node);
  findAll(node.props?.children, predicate, result);
  return result;
}

function host(options = {}) {
  const slots = [];
  let index = 0;
  let effects = [];
  let exits = 0;
  let applicationReturns = 0;
  const saves = [];
  const summaries = [];
  const replies = [];
  let language = options.language || 'en';
  const viewerHandle = { reply: message => replies.push(plain(message)) };
  const props = {
    formId: 'I-90', officialUrl: 'https://www.uscis.gov/i-90', isActive: true,
    checks: { eligible: 'yes' }, initialDraft: options.draft, draftOwner: options.draftOwner,
    onExit: () => { exits++; }, onDraftSaved: draft => summaries.push(draft),
    onExitToApplications: () => { applicationReturns++; },
  };
  const React = {
    createElement: (type, elementProps, ...children) => ({ type, props: { ...elementProps, children } }),
    useState(initial) {
      const position = index++;
      if (!(position in slots)) slots[position] = typeof initial === 'function' ? initial() : initial;
      return [slots[position], value => { slots[position] = typeof value === 'function' ? value(slots[position]) : value; }];
    },
    useRef(initial) { const position = index++; return slots[position] ?? (slots[position] = { current: initial }); },
    useCallback(callback) { index++; return callback; },
    useEffect(callback, dependencies) {
      const position = index++;
      const previous = slots[position];
      if (previous && dependencies && dependencies.every((value, item) => Object.is(value, previous.dependencies?.[item]))) return;
      effects.push(() => {
        previous?.cleanup?.();
        slots[position] = { dependencies, cleanup: callback() };
      });
    },
  };
  const moduleRef = { exports: {} };
  vm.runInNewContext(compile('src/screens/FreeFormPreparationScreen.tsx'), {
    module: moduleRef, exports: moduleRef.exports, Date,
    require(name) {
      if (name === '../LanguageContext') return { useLanguage: () => ({ language, t: (text, params) => translate(language, text, params) }) };
      if (name.endsWith('/LanguageContext')) return require('./language-test-helper.cjs');
      if (name.endsWith('/i18n')) return require('./language-test-helper.cjs');
      if (name.endsWith('/LanguageSwitcher')) return { LanguageSwitcher: 'LanguageSwitcher' };
      if (name === 'react') return { ...React, default: React, __esModule: true };
      if (name === 'react-native') return {
        ...Object.fromEntries(['ActivityIndicator', 'Pressable', 'Text', 'View'].map(key => [key, key])),
        Platform: { OS: 'android' }, StyleSheet: { create: value => value },
        Linking: { async openURL() {} }, BackHandler: { addEventListener: () => ({ remove() {} }) },
      };
      if (name === 'expo-asset') return { Asset: { fromModule: () => ({ localUri: 'test', async downloadAsync() {} }) } };
      if (name === 'expo-file-system') return { File: class { async text() { return '__FILLOUT_PDF_CONFIG__'; } } };
      if (name === '../components/UI') return { Button: 'Button' };
      if (name === '../components/FreePdfViewer') return { FreePdfViewer: 'FreePdfViewer' };
      if (name === '../officialPdfDocument') return { createPrintableDocument() { throw new Error('Drafts must not export PDFs'); } };
      if (name === '../freePdfTemplates') return { async loadFreePdfTemplate() { return new Uint8Array([37, 80, 68, 70, 45]); } };
      if (name === '../pdfEditorBridge') return bridge;
      if (name === '../draftStorage') return { async saveDraft(draft, owner) { saves.push(plain(draft)); await options.save?.(draft, owner); } };
      if (name === '../theme') return { colors: {} };
      if (name === '../../data/forms-catalog.json') return { forms: [{ id: 'I-90', title: 'Replace a green card' }] };
      if (name === '../../assets/pdf-editor.html') return 'editor';
      throw new Error(name);
    },
  });
  function render() {
    index = 0;
    const tree = moduleRef.exports.FreeFormPreparationScreen(props);
    const viewer = findAll(tree, node => node.type === 'FreePdfViewer')[0];
    if (viewer) viewer.props.ref.current = viewerHandle;
    const run = effects; effects = []; run.forEach(effect => effect());
    return tree;
  }
  const button = title => {
    const found = findAll(render(), node => node.type === 'Button' && node.props.title === translate(language, title))[0];
    assert.ok(found, `Expected action: ${title}`);
    return found.props;
  };
  const editor = () => findAll(render(), node => node.type === 'FreePdfViewer')[0]?.props;
  return { props, render, button, editor, saves, summaries, replies, setLanguage: value => { language = value; }, exits: () => exits, applicationReturns: () => applicationReturns };
}

(async () => {
  const basic = host();
  basic.render(); await tick();
  basic.editor().onMessage({ type: 'ready', values: { first: '', last: '' }, page: 1 });
  await tick();
  basic.editor().onMessage({ type: 'change', values: { first: 'ONE', last: '' }, page: 1 });
  await tick();
  assert.equal(basic.saves.at(-1).answered, 1, 'One PDF field must create a saved draft');
  assert.equal(basic.saves.at(-1).total, 2);
  assert.equal(basic.saves.at(-1).stage, 'freePreparation');
  assert.deepEqual(basic.saves.at(-1).pdfValues, { first: 'ONE', last: '' });
  assert.equal('base64' in basic.saves.at(-1), false, 'Draft writes contain values, never PDF bytes');
  const originalHtml = basic.editor().html;
  const writesBeforeLanguage = basic.saves.length;
  basic.setLanguage('ru'); basic.render();
  assert.equal(basic.editor().html, originalHtml, 'Changing language must not reload the editor document');
  assert.deepEqual(basic.replies.at(-1), { type: 'set-language', language: 'ru' });
  assert.equal(basic.saves.length, writesBeforeLanguage, 'Language switches preserve original answers');
  assert.equal(basic.button('Close').title, 'Закрыть');
  basic.setLanguage('en'); basic.render();
  assert.deepEqual(basic.replies.at(-1), { type: 'set-language', language: 'en' });
  basic.button('Close').onPress(); await tick();
  assert.equal(basic.exits(), 1);
  const russian = host({ language: 'ru' });
  russian.render(); await tick();
  assert.equal(JSON.parse(russian.editor().html).language, 'ru', 'The PDF shell receives the selected language before opening');

  const gates = [];
  const storageValues = new Map();
  let delayWrites = true;
  const storageRef = { exports: {} };
  vm.runInNewContext(compile('src/draftStorage.ts'), {
    module: storageRef, exports: storageRef.exports,
    require(name) {
      assert.equal(name, '@react-native-async-storage/async-storage');
      return {
        async getItem(key) { return storageValues.get(key) ?? null; },
        async setItem(key, value) {
          if (delayWrites) await new Promise(resolve => gates.push(resolve));
          storageValues.set(key, value);
        },
      };
    },
  });
  const storage = storageRef.exports;
  const delayed = host({ save: draft => storage.saveDraft(draft) });
  delayed.render(); await tick();
  const change = text => delayed.editor().onMessage({ type: 'change', values: { first: text, last: '' }, page: 3 });
  change('A'); change('AB'); change('ABC');
  assert.equal(delayed.saves.length, 3, 'Every edit must enter the shared storage queue immediately');
  let resumed;
  const loading = storage.loadDraft('I-90').then(draft => { resumed = draft; });
  delayed.button('Close').onPress();
  assert.equal(delayed.exits(), 0, 'Close must await the current write');
  await tick();
  gates.shift()(); await tick();
  assert.equal(resumed, undefined, 'Concurrent Continue must not read an older completed write');
  assert.equal(delayed.saves[2].pdfValues.first, 'ABC', 'Rapid edits must save the newest snapshot');
  assert.equal(delayed.saves[2].pdfPage, 3);
  assert.equal(delayed.exits(), 0, 'Close must also await newer edits queued during a write');
  gates.shift()(); await tick();
  assert.equal(resumed, undefined);
  gates.shift()(); await tick();
  await loading;
  assert.equal(delayed.exits(), 1);
  assert.equal(resumed.pdfValues.first, 'ABC');
  delayWrites = false;
  const reopened = host({ draft: resumed, save: draft => storage.saveDraft(draft) });
  reopened.render(); await tick();
  const reopenedConfig = JSON.parse(reopened.editor().html);
  assert.equal(reopenedConfig.values.first, 'ABC');
  reopened.editor().onMessage({ type: 'ready', values: reopenedConfig.values, page: reopenedConfig.page });
  await tick();
  assert.equal((await storage.loadDraft('I-90')).pdfValues.first, 'ABC', 'Restored ready must not overwrite the latest entry');

  for (const draftOwner of ['account-A', null]) {
    await storage.setDraftOwner(draftOwner);
    const retained = host({ draftOwner, save: (draft, owner) => storage.saveDraft(draft, owner) });
    retained.render(); await tick();
    const oldMessage = retained.editor().onMessage;
    retained.props.isActive = false; retained.render();
    await storage.setDraftOwner('account-B');
    await storage.saveDraft({ ...basic.saves.at(-1), pdfValues: { first: 'B ANSWER' } });
    oldMessage({ type: 'change', values: { first: 'LATE OLD ANSWER' }, page: 2 });
    await tick();
    assert.equal((await storage.loadDraft('I-90')).pdfValues.first, 'B ANSWER', 'A retained PDF callback must not save into the newly signed-in account');
    await storage.setDraftOwner(draftOwner);
    assert.equal((await storage.loadDraft('I-90')).pdfValues.first, 'LATE OLD ANSWER', 'Late PDF changes remain with the editor account or guest owner');
  }

  let failing = true;
  const failure = host({ save: async () => { if (failing) throw new Error('Unavailable'); } });
  failure.render(); await tick();
  failure.editor().onMessage({ type: 'change', values: { first: 'KEEP' }, page: 2 });
  await tick();
  failure.button('Close').onPress(); await tick();
  assert.equal(failure.exits(), 0, 'Failed saves must keep the editor open');
  assert.ok(failure.editor());
  failing = false;
  failure.button('Retry saving draft').onPress(); await tick();
  assert.equal(failure.saves.at(-1).pdfValues.first, 'KEEP', 'Retry must retain the last unsaved entry');
  failure.button('Close').onPress(); await tick();
  assert.equal(failure.exits(), 1);

  const resume = host({ draft: { ...basic.saves.at(-1), pdfPage: 3, answers: { earlier: 'KEEP' } } });
  resume.render(); await tick();
  const config = JSON.parse(resume.editor().html);
  assert.equal(config.page, 3);
  assert.equal(config.resume, true);
  assert.deepEqual(config.values, { first: 'ONE', last: '' });
  resume.editor().onMessage({ type: 'ready', values: config.values, page: config.page });
  await tick();
  assert.equal(resume.saves.at(-1).answers.earlier, 'KEEP');
  let releaseReturn, returnFails = false;
  const navigation = host({ save: () => returnFails ? Promise.reject(new Error('Storage unavailable')) : new Promise(resolve => { releaseReturn = resolve; }) });
  navigation.render(); await tick();
  navigation.editor().onMessage({ type: 'change', values: { first: 'KEEP THIS' }, page: 2 });
  assert.equal(findAll(navigation.render(), node => node.type === 'Button' && node.props.title === 'My Application').length, 0, 'The bottom tab replaces the duplicate return button');
  navigation.props.applicationReturnRequest = 1; navigation.render(); await tick();
  assert.equal(navigation.applicationReturns(), 0, 'My Application must wait for PDF field saving');
  releaseReturn(); await tick();
  assert.equal(navigation.applicationReturns(), 1);
  assert.equal(navigation.exits(), 0, 'My Application returns directly to the list, not preparation results');
  returnFails = true;
  navigation.editor().onMessage({ type: 'change', values: { first: 'LATEST ENTRY' }, page: 2 }); await tick();
  navigation.props.applicationReturnRequest = 2; navigation.render(); await tick();
  assert.equal(navigation.applicationReturns(), 1, 'Failed PDF saving must keep the editor mounted');
  assert.equal(navigation.saves.at(-1).pdfValues.first, 'LATEST ENTRY');
  returnFails = false;
  navigation.button('Retry saving draft').onPress(); await tick(); releaseReturn(); await tick();
  navigation.props.applicationReturnRequest = 3; navigation.render(); await tick();
  assert.equal(navigation.applicationReturns(), 2, 'The retained editor can return again after saving recovers');
  const exporting = host();
  exporting.render(); await tick();
  exporting.editor().onMessage({ type: 'busy', value: true });
  exporting.props.applicationReturnRequest = 1; exporting.render(); await tick();
  assert.equal(exporting.applicationReturns(), 0, 'The bottom tab must wait while the PDF is exporting');
  exporting.editor().onMessage({ type: 'busy', value: false }); exporting.render(); await tick();
  assert.equal(exporting.applicationReturns(), 1, 'The requested return must complete after export finishes');
  console.log('Free PDF drafts passed: single-field autosave, rapid edits, close waits, failure retention/retry, restored values/page, and first-empty-field selection.');
})().catch(error => { console.error(error); process.exitCode = 1; });
