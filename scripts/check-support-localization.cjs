#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { languageMock } = require('./language-test-helper.cjs');
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
function findAll(node, predicate, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (Array.isArray(node)) { node.forEach(child => findAll(child, predicate, result)); return result; }
  if (predicate(node)) result.push(node);
  findAll(node.props?.children, predicate, result);
  return result;
}
function words(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(words).join(' ');
  return node && typeof node === 'object' ? words(node.props?.children) : '';
}
function host(file, exportName, props = {}, options = {}) {
  let language = 'ru';
  let index = 0;
  const slots = [];
  const React = {
    createElement: (type, attrs, ...children) => ({ type, props: { ...attrs, children } }),
    useState(initial) {
      const position = index++;
      if (!(position in slots)) slots[position] = typeof initial === 'function' ? initial() : initial;
      return [slots[position], value => { slots[position] = typeof value === 'function' ? value(slots[position]) : value; }];
    },
    useRef(initial) { const position = index++; return slots[position] ?? (slots[position] = { current: initial }); },
    useEffect() {},
  };
  const moduleRef = { exports: {} };
  vm.runInNewContext(compile(file), {
    module: moduleRef, exports: moduleRef.exports, process: { env: {} }, Error,
    require(name) {
      if (name === 'react') return { ...React, default: React, __esModule: true };
      if (name.endsWith('/LanguageContext')) return { useLanguage: () => languageMock(language) };
      if (name.endsWith('/AccountContext')) return { useAccount: () => ({ signOut: options.signOut || (async () => {}) }) };
      if (name === 'react-native') return {
        ...Object.fromEntries(['Text', 'View', 'Image', 'Pressable', 'ScrollView', 'TextInput', 'KeyboardAvoidingView'].map(type => [type, type])),
        StyleSheet: { create: value => value }, Platform: { OS: 'web' }, Keyboard: { dismiss() {} },
        AccessibilityInfo: { announceForAccessibility() {} }, BackHandler: { addEventListener: () => ({ remove() {} }) },
      };
      if (name.includes('Ionicons')) return { default: 'Ionicons', __esModule: true };
      if (name.endsWith('/cloudClient')) return {
        cloudRequested: !!options.cloud,
        useCloudSession: () => options.session || ({ configured: true, user: null, loading: false, error: 'Please verify your email again to continue.' }),
        requestEmailCode: async () => {}, verifyEmailCode: async () => {},
        signOutCloud: async () => { throw new Error('EmailAccess must not bypass the account save/lock wrapper'); },
      };
      if (name.endsWith('/requestDelivery')) return {
        useRequestDelivery: () => ({ cloud: false, available: false, canSubmit: false }),
        useRequestIdentity: () => ({ reset() {}, getId: () => 'TEST' }),
      };
      if (name.endsWith('/documentDelivery')) {
        const result = { exports: {} };
        vm.runInNewContext(compile('src/documentDelivery.ts'), { module: result, exports: result.exports });
        return result.exports;
      }
      if (name.endsWith('/theme')) return { colors: {}, radius: {} };
      if (name.endsWith('/UI')) return { Button: 'Button', Card: 'Card', Notice: 'Notice', Field: 'Field' };
      if (name.endsWith('/LiveAssistant')) return { SupportChat: 'SupportChat' };
      if (name.endsWith('/supportChat')) return { createSupportConversation: () => ({ refresh() {}, send() {}, dispose() {} }), rememberSupportLoginDraft() {}, takeSupportLoginDraft: () => '' };
      if (name.endsWith('/AssistantWelcome')) return { AssistantWelcome: 'AssistantWelcome' };
      if (name.endsWith('/EmailAccess')) return { EmailAccess: 'EmailAccess' };
      if (name.endsWith('.png')) return 'image';
      throw new Error(name);
    },
  });
  function resolve(node) {
    if (Array.isArray(node)) return node.map(resolve);
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return resolve(node.type(node.props));
    return { ...node, props: { ...node.props, children: resolve(node.props?.children) } };
  }
  function render() { index = 0; return resolve(moduleRef.exports[exportName](props)); }
  function press(title) {
    const button = findAll(render(), node => typeof node.props?.onPress === 'function' && (node.props.title === title || node.props.accessibilityLabel === title || words(node).trim() === title))[0];
    assert.ok(button, `Missing action: ${title}`);
    button.props.onPress();
  }
  return { render, press, language: value => { language = value; }, input(label) {
    const input = findAll(render(), node => node.type === 'TextInput' && node.props.accessibilityLabel === label)[0];
    assert.ok(input, `Missing input: ${label}`); return input.props;
  } };
}

let accountOpened = 0;
const assistant = host('src/components/LiveAssistant.tsx', 'SupportChat', { isActive: true, contactRequest: 0, onAccount: () => accountOpened++, accountLabel: 'Login' });
assert.ok(words(assistant.render()).includes('Команда FillOut'));
assert.equal(words(assistant.render()).includes('Демо'), false);
assistant.input('Напишите команде FillOut').onChangeText('Review request');
assistant.press('Войти и отправить');
assert.equal(accountOpened, 1, 'Guest composition opens login; it does not fake a sent message');
assert.equal(assistant.input('Напишите команде FillOut').value, 'Review request');
assistant.language('en');
assert.ok(words(assistant.render()).includes('FillOut team'));
assert.equal(assistant.input('Message the FillOut team').value, 'Review request', 'Switching language preserves free-form message content');

const welcome = host('src/components/AssistantWelcome.tsx', 'AssistantWelcome');
assert.ok(/[А-Яа-я]/.test(words(welcome.render())));
const email = host('src/components/EmailAccess.tsx', 'EmailAccess', {}, { cloud: true });
assert.ok(words(email.render()).includes('Подтвердите почту'));
assert.ok(words(email.render()).includes('Чтобы продолжить, подтвердите почту ещё раз.'));
assert.ok(findAll(email.render(), node => node.type === 'Field').some(node => node.props.label === 'Почта для подтверждения'));
const document = host('src/components/DocumentDelivery.tsx', 'DocumentDelivery', { formId: 'I-90', pdfReady: true, onDownloadPdf() {} });
assert.ok(words(document.render()).includes('I-90 · Ваша заполненная официальная форма'));
assert.ok(!words(document.render()).includes('Отправить через FILLOUT'), 'Unconfigured mailing is hidden');
const mailingDocument = host('src/components/DocumentDelivery.tsx', 'DocumentDelivery', { formId:'I-90', pdfReady:true, mailing:{requestAvailable:true}, onRequestMailing() {} });
mailingDocument.press('Отправить через FILLOUT Стоимость отправки уточняется');
assert.ok(words(mailingDocument.render()).includes('Адрес доставки уточняется'));
assert.ok(findAll(mailingDocument.render(), node => node.type === 'Button').some(node => node.props.title === 'Запросить отправку почтой'));

(async () => {
  const session = { configured: true, user: { id: 'account-a', email: 'sample@example.test' }, loading: false, error: null };
  let attempts = 0, rejectSave, resolveSignOut;
  const signedEmail = host('src/components/EmailAccess.tsx', 'EmailAccess', {}, { cloud: true, session,
    signOut: () => {
      attempts++;
      return new Promise((resolve, reject) => { rejectSave = reject; resolveSignOut = () => { session.user = null; resolve(); }; });
    },
  });
  signedEmail.language('en');
  const logout = findAll(signedEmail.render(), node => node.type === 'Button' && node.props.title === 'Sign out')[0].props;
  logout.onPress(); logout.onPress();
  assert.equal(attempts, 1, 'Repeated logout clicks must not start duplicate save/sign-out operations');
  const pendingButton = findAll(signedEmail.render(), node => node.type === 'Button' && node.props.title === 'Signing out…')[0];
  assert.equal(pendingButton.props.disabled, true);
  rejectSave(new Error('Draft saving failed. Keep this form open.'));
  await new Promise(setImmediate);
  assert.ok(words(signedEmail.render()).includes('Draft saving failed. Keep this form open.'));
  assert.ok(words(signedEmail.render()).includes('sample@example.test'), 'Failed draft saving keeps the current account visible');
  signedEmail.press('Sign out');
  assert.equal(attempts, 2);
  resolveSignOut(); await new Promise(setImmediate);
  assert.ok(words(signedEmail.render()).includes('Verify your email'));
  assert.equal(findAll(signedEmail.render(), node => node.type === 'Button' && node.props.title === 'Sign out').length, 0);
  console.log('Support localization passed: human Chat, guest login, EN message preservation, auth errors, mailing UI, and guarded logout save failure/retry.');
})().catch(error => { console.error(error); process.exitCode = 1; });
