#!/usr/bin/env node
// Real I-90 screen handlers and validation, with isolated hooks and synthetic data.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
const { translate } = require('./language-test-helper.cjs');
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
function load(file, dependency) {
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, Date, Error, require: dependency, window: { addEventListener() {}, removeEventListener() {} } });
  return module.exports;
}
const questionnaire = load('src/uscisQuestionnaire.ts', name => require(path.resolve(root, 'src', name)));
const schema = load('src/guidedFormSchema.ts', name => require(path.resolve(root, 'src', name)));
const freePdf = load('src/freePdfEngine.ts', require);
const guided = load('src/guidedPreparation.ts', name => {
  if (name === './uscisQuestionnaire') return questionnaire;
  if (name === './guidedFormSchema') return schema;
  if (name === './freePdfEngine') return freePdf;
  return require(path.resolve(root, 'src', name));
});
const progress = load('src/fullPreparationDraft.ts', () => guided);
const question = id => questionnaire.i90Questionnaire.questions.find(item => item.id === id);
for (const item of questionnaire.i90Questionnaire.questions) {
  for (const text of [item.title, item.help, ...item.fields.flatMap(field => [field.label, ...(field.options || []).map(option => option.label)])]) {
    if (!/^[A-Z]{2}$|^\d+$/.test(text)) assert.notEqual(translate('ru', text), text, `Missing Russian questionnaire translation: ${text}`);
  }
}
assert.equal(translate('ru', 'The official form allows 25 characters here. Use Part 8 if your answer needs more space.'),
  'В официальной форме это поле вмещает 25 символов. Если нужно больше места, используйте часть 8.');
assert.equal(translate('ru', 'Add a detailed explanation for Part 3, Item 4 in Part 8.'),
  'Добавьте в части 8 подробное объяснение к части 3, пункту 4.');
// Engine errors are surfaced verbatim by preparation/delivery screens; they
// must be translated too, including uncommon font and template failures.
for (const file of ['src/pdfEngine.ts', 'src/freePdfTemplates.ts', 'src/officialPdfDocument.ts']) {
  const tree = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
  function checkErrors(node) {
    const isFail = ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fail';
    const isError = ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Error';
    const message = isFail ? node.arguments[1] : isError ? node.arguments?.[0] : undefined;
    if (message && ts.isStringLiteral(message)) assert.notEqual(translate('ru', message.text), message.text, `Missing Russian error translation: ${message.text}`);
    ts.forEachChild(node, checkErrors);
  }
  checkErrors(tree);
}
function findAll(node, predicate, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (Array.isArray(node)) { node.forEach(child => findAll(child, predicate, result)); return result; }
  if (predicate(node)) result.push(node);
  findAll(node.props?.children, predicate, result);
  return result;
}
const nodes = (tree, type) => findAll(tree, node => node.type === type);
function host(initialDraft, initialLanguage = 'en', draftOwner, formId = 'I-90', reviewRequired = false, reviewOptions = {}) {
  const slots = [], writes = [], writeOwners = [], notifications = [], saveErrors = [], effects = [];
  const onSaveErrorChange = failed => saveErrors.push(failed);
  let index = 0, exits = 0, applicationReturns = 0, applicationReturnRequest = 0, fail = false, hold = false;
  let language = initialLanguage, isActive = true;
  let cloudUser = reviewOptions.userId ? { id: reviewOptions.userId } : null;
  let reviews = reviewOptions.reviews || [], reviewFails = false, submitFailures = 0, generated = 0, accountOpens = 0;
  let holdDownload = false, resolveDownload;
  const submissions = [], downloads = [], documents = [];
  const reviewApi = {
    listMyReviews: async () => { if (reviewFails) throw new Error('Offline'); return clone(reviews); },
    submitFormReview: async input => {
      submissions.push(input);
      if (submitFailures > 0) { submitFailures--; throw new Error('Lost response'); }
      const result = { id: `submission-${submissions.length}`, requestId: input.requestId, formId: input.formId, caseId: input.caseId || null, environment: 'production', status: 'pending', submittedAt: '2026-10-11T12:00:00.000Z', reviewedAt: null, reviewNote: '', sha256: 'synthetic' };
      reviews = [result]; return clone(result);
    },
    downloadReviewDocument: async submission => {
      downloads.push(clone(submission));
      const document = { submissionId: submission.id, disposed: false, dispose() { this.disposed = true; }, download() {}, print() {}, share() {} };
      documents.push(document);
      if (holdDownload) await new Promise(resolve => { resolveDownload = resolve; });
      return document;
    },
  };
  let uuidSequence = 0;
  const t = (text, params) => translate(language, text, params);
  const deferred = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const position = index++;
      if (!(position in slots)) slots[position] = typeof initial === 'function' ? initial() : initial;
      return [slots[position], value => { slots[position] = typeof value === 'function' ? value(slots[position]) : value; }];
    },
    useRef(initial) { const position = index++; return slots[position] ?? (slots[position] = { current: initial }); },
    useMemo(compute) { index++; return compute(); },
    useEffect(callback, deps) {
      const position = index++;
      const previous = slots[position];
      if (!previous || !deps.every((value, at) => value === previous.deps[at])) effects.push(() => {
        previous?.cleanup?.(); slots[position] = { deps, cleanup: callback() };
      });
    },
  };
  const screen = load('src/screens/FullFormPreparationScreen.tsx', name => {
    if (name === 'expo-crypto') return { randomUUID: () => `request-${++uuidSequence}` };
    if (name === '../cloudClient') return { useCloudSession: () => ({ configured: true, user: cloudUser, loading: false, error: null }) };
    if (name === '../formReview') return reviewApi;
    if (name.endsWith('i-90.pdf')) return 'template';
    if (name === '../LanguageContext') return { useLanguage: () => ({ language, t }) };
    if (name === 'react') return { ...React, default: React, __esModule: true };
    if (name === 'react-native') return {
      BackHandler: { addEventListener: () => ({ remove() {} }) }, Linking: {}, Platform: { OS: 'web' },
      KeyboardAvoidingView: 'KeyboardAvoidingView', Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView',
      StyleSheet: { create: value => value }, Text: 'Text', View: 'View',
    };
    if (name.includes('Ionicons')) return { default: 'Ionicons', __esModule: true };
    if (name === '../components/UI') return Object.fromEntries(['Badge', 'BrandMark', 'Button', 'Card', 'Field', 'Notice', 'RowLink', 'SectionTitle'].map(key => [key, key]));
    if (name === '../components/DocumentDelivery') return { DocumentDelivery: 'DocumentDelivery' };
    if (name === '../theme') return { colors: {}, radius: {} };
    if (name === '../uscisQuestionnaire') return questionnaire;
    if (name === '../guidedPreparation') return { ...guided, fillGuidedPreparationPdf: async () => new Uint8Array([1, 2, ++generated]) };
    if (name === '../freePdfEngine') return freePdf;
    if (name === '../freePdfTemplates') return { loadFreePdfTemplate: async () => new Uint8Array([0]) };
    if (name === '../fullPreparationDraft') return progress;
    if (name === '../pdfEngine') return { fillOfficialPrintPdf: async () => new Uint8Array([1, 2, ++generated]), PrintValidationError: class extends Error {} };
    if (name === '../officialPdfDocument') return { loadPrintTemplate: async () => new Uint8Array([0]), createPrintableDocument: () => { throw new Error('Unreviewed local PDF must never become printable'); } };
    if (name === '../draftStorage') return { saveDraft: (draft, owner) => {
      writes.push(clone(draft));
      writeOwners.push(owner);
      if (hold) return new Promise((resolve, reject) => deferred.push({ resolve, reject }));
      return fail ? Promise.reject(new Error('Storage unavailable')) : Promise.resolve();
    } };
    throw new Error(`Unexpected dependency ${name}`);
  }).FullFormPreparationScreen;
  const api = {
    writes, writeOwners, notifications, saveErrors,
    render() {
      index = 0;
      const tree = screen({ formId, reviewRequired, isActive, initialDraft, draftOwner, applicationReturnRequest, checks: { reviewed: 'yes' }, onDraftSaved: draft => notifications.push(draft), onSaveErrorChange, onAccount: () => { accountOpens++; }, onExit: () => { exits++; }, onExitToApplications: () => { applicationReturns++; } });
      while (effects.length) effects.shift()();
      return tree;
    },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    returnToApplications() { applicationReturnRequest++; api.render(); },
    setLanguage(value) { language = value; },
    button(title) { const item = nodes(api.render(), 'Button').find(item => item.props.title === t(title)); assert.ok(item, `Missing button ${title}`); return item.props; },
    field(id) {
      const field = guided.getPreparationDefinition(formId).questions.flatMap(item => item.fields).find(item => item.id === id);
      const item = nodes(api.render(), 'Field').find(item => item.props.label.startsWith(t(field.label)));
      assert.ok(item, `Missing field ${id}`); return item.props;
    },
    radio(id, value) {
      const field = guided.getPreparationDefinition(formId).questions.flatMap(item => item.fields).find(item => item.id === id);
      const label = field.options.find(item => item.value === value).label;
      const item = nodes(api.render(), 'Pressable').find(item => item.props.accessibilityLabel === t(label) && item.props.accessibilityRole === 'radio');
      assert.ok(item, `Missing option ${id}=${value}`); item.props.onPress();
    },
    expectQuestion(id) { assert.equal(nodes(api.render(), 'SectionTitle')[0].props.title, t(guided.getPreparationDefinition(formId).questions.find(item => item.id === id).title)); },
    edit(id) {
      api.button('Review progress').onPress();
      nodes(api.render(), 'RowLink').find(item => item.props.title === t('Part {part} · {title}', { part: question(id).part, title: t(question(id).title) })).props.onPress();
    },
    get lastDraft() { return clone(writes.at(-1)); },
    get exits() { return exits; },
    get accountOpens() { return accountOpens; },
    get generated() { return generated; }, submissions, downloads, documents,
    setReviews(value) { reviews = value; }, failReview(value) { reviewFails = value; }, failSubmissions(count) { submitFailures = count; },
    setUser(id) { cloudUser = id ? { id } : null; },
    setActive(value) { isActive = value; },
    holdDownload(value) { holdDownload = value; }, releaseDownload() { resolveDownload(); },
    consent() { nodes(api.render(), 'Pressable').find(item => item.props.accessibilityRole === 'checkbox').props.onPress(); },
    get applicationReturns() { return applicationReturns; },
    get leaving() { return nodes(api.render(), 'Modal').at(-1).props.visible; },
    fail(value) { fail = value; }, hold(value) { hold = value; }, release() { deferred.shift().resolve(); },
  };
  return api;
}
const settle = () => new Promise(resolve => setImmediate(resolve));
function draft(fullAnswers, completedQuestionIds = []) {
  const state = progress.fullPreparationProgress(fullAnswers, completedQuestionIds);
  return { version: 1, formId: 'I-90', title: questionnaire.i90Questionnaire.title, answers: {}, checks: { reviewed: 'yes' },
    mode: 'ai', stage: 'fullPreparation', fullAnswers, completedQuestionIds, answered: state.answered, total: state.questions.length, updatedAt: new Date().toISOString() };
}
function completeAnswers() {
  const answers = {
    name_changed: 'no', physical_different: 'no', resident_status: 'lpr', reason_a: '2f',
    immigrant_visa_entry: 'no', removal_history: 'no', abandonment_history: 'no',
    accommodation: 'no', applicant_statement: 'english', preparer_used: 'no', admission_class: 'IR2',
    birth_date: '01/02/1990', admission_date: '03/04/2010',
  };
  for (const q of questionnaire.activeQuestions(answers)) for (const f of q.fields) {
    if (answers[f.id] !== undefined || !questionnaire.isFieldRequired(f, answers)) continue;
    answers[f.id] = f.id.endsWith('_unit_type') ? 'none' : f.type === 'multiselect' ? [f.options[0].value]
      : f.options ? f.options[0].value : f.validation === 'a-number' ? '123456789' : f.validation === 'weight' ? '175'
      : f.validation === 'phone' ? '2025550100' : f.id.endsWith('_country') ? 'Canada' : 'SAMPLE';
  }
  return answers;
}

(async () => {
  for (const draftOwner of ['account-A', null]) {
    const owned = host(draft({}), 'en', draftOwner);
    owned.field('alien_number').onChangeText('123456789');
    await settle();
    assert.deepEqual(owned.writeOwners, [draftOwner], 'Full preparation saves must use the mounted account or explicit guest owner');
    owned.unmount();
  }
  let app = host();
  app.button('Start I-90 questions').onPress();
  app.field('alien_number').onChangeText('1');
  assert.equal(app.writes.length, 1, 'The first input must save immediately, without Next or a debounce');
  assert.equal(app.lastDraft.fullAnswers.alien_number, '1');
  assert.equal(app.lastDraft.answered, 0, 'Partial invalid input is saved but not counted complete');
  app.button('Next question').onPress();
  app.expectQuestion('alien-number');
  assert.ok(app.field('alien_number').error);
  await settle();
  assert.equal(app.notifications.length, 1);

  app = host(app.lastDraft);
  app.expectQuestion('alien-number');
  assert.equal(app.field('alien_number').value, '1');
  app.hold(true);
  app.field('alien_number').onChangeText('123456789');
  app.button('Leave this form').onPress();
  await settle();
  assert.equal(app.exits, 0, 'Leaving waits for the pending write');
  app.release(); await settle();
  assert.equal(app.exits, 1);
  assert.equal(app.leaving, false, 'Successfully saved answers need no discard confirmation');

  app = host(app.lastDraft);
  app.expectQuestion('account-number');
  app.button('Next question').onPress();
  assert.ok(app.lastDraft.completedQuestionIds.includes('account-number'), 'Next records an intentionally blank optional answer');
  app.expectQuestion('legal-name');
  app.field('family_name').onChangeText('EXAMPLE');
  await settle();
  const writesBeforeLanguage = app.writes.length;
  app.setLanguage('ru');
  app.expectQuestion('legal-name');
  assert.equal(nodes(app.render(), 'SectionTitle')[0].props.title, 'Каково ваше полное официальное имя?');
  assert.equal(app.field('family_name').value, 'EXAMPLE', 'Changing language must not translate or clear entered answers');
  assert.equal(app.writes.length, writesBeforeLanguage, 'Language switches must not create altered draft snapshots');
  assert.equal(app.button('Next question').title, 'Следующий вопрос');
  app.setLanguage('en');
  app = host(app.lastDraft);
  app.expectQuestion('legal-name');
  assert.equal(app.field('family_name').value, 'EXAMPLE');
  // Changes from the same rendered step must compose even before another render.
  const given = app.field('given_name'), middle = app.field('middle_name');
  given.onChangeText('SAMPLE'); middle.onChangeText('N/A');
  assert.equal(app.lastDraft.fullAnswers.given_name, 'SAMPLE');
  await settle();
  app = host(app.lastDraft);
  app.expectQuestion('name-changed');
  app.setLanguage('ru');
  app.radio('name_changed', 'yes');
  assert.equal(app.lastDraft.fullAnswers.name_changed, 'yes', 'Translated choices must keep machine answer values unchanged');
  app.button('Next question').onPress();
  app.expectQuestion('previous-card-name');
  app.field('card_family_name').onChangeText('EXAMPLE');
  await settle();
  app = host(app.lastDraft);
  app.expectQuestion('previous-card-name');
  app.edit('name-changed');
  app.radio('name_changed', 'no');
  app.button('Update answer').onPress();
  await settle();
  app = host(app.lastDraft);
  app.expectQuestion('mail-address');
  // A newly required conditional field invalidates a previously skipped step.
  const complete = completeAnswers();
  const completed = questionnaire.activeQuestions(complete).map(q => q.id);
  assert.equal(Object.keys(questionnaire.validateI90Answers(complete)).length, 0);
  app = host(draft(complete, completed));
  assert.equal(nodes(app.render(), 'SectionTitle')[0].props.title, 'Review your I-90');
  nodes(app.render(), 'RowLink').find(item => item.props.title === `Part ${question('reason-a').part} · ${question('reason-a').title}`).props.onPress();
  app.radio('reason_a', '2h1');
  await settle();
  assert.ok(!app.lastDraft.completedQuestionIds.includes('commuter-port'));
  app = host(app.lastDraft);
  app.expectQuestion('commuter-port');

  app.fail(true);
  app.field('commuter_port').onChangeText('SAMPLE PORT');
  await settle();
  assert.ok(nodes(app.render(), 'Notice').some(item => item.props.title === 'Draft not saved'));
  assert.equal(app.saveErrors.at(-1), true, 'A failed save is reported to the parent so replacing this draft can be guarded');
  app.button('Leave this form').onPress(); await settle();
  assert.equal(app.exits, 0);
  assert.equal(app.leaving, true, 'Failed writes must keep answers mounted for retry');
  app.fail(false);
  app.button('Retry save and leave').onPress(); await settle();
  assert.equal(app.exits, 1);
  assert.equal(app.lastDraft.fullAnswers.commuter_port, 'SAMPLE PORT');
  app.render();
  assert.equal(app.saveErrors.at(-1), false, 'A successful retry clears the parent guard');
  app.fail(true);
  app.field('commuter_port').onChangeText('ANOTHER PORT'); await settle();
  app.render();
  assert.equal(app.saveErrors.at(-1), true);
  app.unmount();
  assert.equal(app.saveErrors.at(-1), false, 'Unmounting releases the parent guard');

  const qualificationOnly = draft({}); delete qualificationOnly.fullAnswers;
  host(qualificationOnly).expectQuestion('alien-number');
  const newCheck = host({ ...qualificationOnly, stage: 'check' });
  assert.ok(nodes(newCheck.render(),'Button').some(item => item.props.title === 'Start I-90 questions'), 'Completing a preliminary check does not skip the full questionnaire introduction');
  newCheck.unmount();
  const navigation = host(draft({}));
  navigation.hold(true);
  navigation.field('alien_number').onChangeText('123456789');
  assert.ok(!nodes(navigation.render(), 'Button').some(item => item.props.title === 'My Application'), 'The duplicate return button is removed');
  navigation.returnToApplications(); await settle();
  assert.equal(navigation.applicationReturns, 0, 'My Application must wait for the full-form save');
  navigation.release(); navigation.hold(false); await settle();
  assert.equal(navigation.applicationReturns, 1);
  assert.equal(navigation.exits, 0, 'Return directly to applications rather than preparation options');
  navigation.fail(true);
  navigation.field('alien_number').onChangeText('987654321'); await settle();
  navigation.returnToApplications(); await settle();
  assert.equal(navigation.applicationReturns, 1);
  assert.equal(navigation.leaving, true);
  navigation.fail(false);
  navigation.button('Retry save and leave').onPress(); await settle();
  assert.equal(navigation.applicationReturns, 2, 'Retry must retain the chosen My Application destination');
  assert.equal(navigation.exits, 0);
  assert.equal(navigation.lastDraft.fullAnswers.alien_number, '987654321');
  const russian = host(draft({ alien_number: '123456789' }), 'ru');
  russian.expectQuestion('account-number');
  assert.equal(nodes(russian.render(), 'SectionTitle')[0].props.title, 'Какой у вас номер онлайн-аккаунта USCIS, если он есть?');
  for (const formId of ['AR-11', 'N-400']) {
    const definition = guided.getPreparationDefinition(formId);
    const question = definition.questions.find(item => item.fields.some(field => field.type === 'text'));
    const field = question.fields.find(field => field.type === 'text');
    const app = host(undefined, 'en', 'account-guided', formId);
    app.button(`Start ${formId} questions`).onPress();
    app.button('Review progress').onPress();
    const review = app.render();
    assert.equal(nodes(review, 'SectionTitle')[0].props.title, `Review your ${formId}`);
    assert.equal(nodes(review, 'RowLink').length, guided.activePreparationQuestions(formId, {}).length, 'Review exposes the complete official questionnaire');
    nodes(review, 'RowLink').find(item => item.props.title === `Page ${question.source.formPages[0]} · ${question.title}`).props.onPress();
    app.field(field.id).onChangeText('A');
    await settle();
    assert.equal(app.lastDraft.formId, formId);
    assert.equal(app.lastDraft.title, definition.title);
    assert.equal(app.lastDraft.fullAnswers[field.id], 'A');
    assert.equal(app.writeOwners.at(-1), 'account-guided');
    assert.equal(app.lastDraft.total, guided.activePreparationQuestions(formId, app.lastDraft.fullAnswers).length);
    app.button('Update answer').onPress();
    await settle();
    assert.ok(app.lastDraft.completedQuestionIds.includes(question.id), 'Explicit Next remembers blank applicable companions');
    const resumed = host(app.lastDraft, 'en', 'account-guided', formId);
    resumed.render();
    assert.equal(resumed.writes.length, 0, 'Restoring a generic form does not replace its stored answers');
    resumed.returnToApplications(); await settle();
    assert.equal(resumed.applicationReturns, 1);
    app.fail(true);
    nodes(app.render(), 'RowLink').find(item => item.props.title === `Page ${question.source.formPages[0]} · ${question.title}`).props.onPress();
    app.field(field.id).onChangeText('B'); await settle();
    app.returnToApplications(); await settle();
    assert.equal(app.applicationReturns, 0);
    assert.equal(app.leaving, true, 'Generic forms preserve unsaved answers during bottom-tab returns');
    app.fail(false);
    app.button('Retry save and leave').onPress(); await settle();
    assert.equal(app.applicationReturns, 1);
    assert.equal(app.lastDraft.fullAnswers[field.id], 'B');
    const unrelated = host(app.lastDraft, 'en', 'account-guided', 'I-90');
    assert.ok(nodes(unrelated.render(), 'Button').some(item => item.props.title === 'Start I-90 questions'), 'A draft from another form cannot populate this questionnaire');
    app.unmount(); resumed.unmount(); unrelated.unmount();
  }
  const policyDraft = host(undefined, 'en', null, 'I-821', true);
  const reviewNotice = tree => nodes(tree, 'Notice').some(node => node.props.tone === 'warning' && node.props.children.includes('This form still needs individual review. You can fill out a draft, but this check has not confirmed a filing path. Review the current official guidance before filing.'));
  assert.equal(reviewNotice(policyDraft.render()), true, 'A draft preparation path preserves the review status at entry');
  policyDraft.button('Start I-821 questions').onPress();
  assert.equal(reviewNotice(policyDraft.render()), false, 'Question screens keep space for the answers');
  policyDraft.button('Review progress').onPress();
  assert.equal(reviewNotice(policyDraft.render()), true, 'Review status is shown again before PDF generation');
  policyDraft.unmount();
  // The customer cannot obtain an unreviewed guided PDF, including after a
  // retry, a local edit, an account change, or a lost status response.
  const ready = draft(complete, completed);
  const guestReview = host(ready);
  guestReview.render();
  assert.equal(nodes(guestReview.render(), 'DocumentDelivery').length, 0);
  assert.equal(nodes(guestReview.render(), 'Button').some(item => /Create filled/.test(item.props.title)), false);
  guestReview.hold(true);
  guestReview.button('Sign in to send for review').onPress(); await settle();
  assert.equal(guestReview.accountOpens, 0, 'Guest sign-in must wait for its draft to save');
  guestReview.release(); await settle();
  assert.equal(guestReview.accountOpens, 1);
  assert.deepEqual(guestReview.lastDraft.fullAnswers, complete, 'Account handoff preserves all guest answers');
  guestReview.unmount();

  const signed = host(ready, 'en', 'review-customer', 'I-90', false, { userId: 'review-customer' });
  signed.render(); await settle();
  assert.equal(signed.button('Send for review').disabled, true, 'Sending requires explicit upload consent');
  signed.consent();
  assert.equal(signed.button('Send for review').disabled, false);
  signed.failSubmissions(1);
  signed.button('Send for review').onPress(); await settle();
  assert.equal(signed.generated, 1);
  assert.equal(signed.submissions.length, 1);
  assert.equal(nodes(signed.render(), 'DocumentDelivery').length, 0, 'Uncertain upload never exposes the generated file');
  signed.button('Send for review').onPress(); await settle();
  assert.equal(signed.submissions.length, 2);
  assert.equal(signed.generated, 1, 'Retry reuses the generated PDF bytes');
  assert.equal(signed.submissions[0].requestId, signed.submissions[1].requestId, 'Retry reuses the idempotency key');
  assert.equal(signed.submissions[0].pdfBytes, signed.submissions[1].pdfBytes);
  assert.equal(nodes(signed.render(), 'DocumentDelivery').length, 0, 'Pending review offers no download or print');
  assert.equal(signed.downloads.length, 0);
  const pending = { id: 'submission-2', requestId: signed.submissions[1].requestId, formId: 'I-90', caseId: null, environment: 'production', status: 'pending', submittedAt: '2026-10-11T12:00:00.000Z', reviewedAt: null, reviewNote: '', sha256: 'synthetic' };
  const approved = { ...pending, status: 'approved', reviewedAt: '2026-10-11T13:00:00.000Z' };
  signed.setReviews([{ ...pending, status: 'changes_requested', reviewedAt: approved.reviewedAt, reviewNote: 'Correct the spelling of your name.' }]);
  signed.button('Refresh review status').onPress(); await settle();
  assert.ok(nodes(signed.render(), 'Notice').some(item => item.props.title === 'Team feedback' && item.props.children.includes('Correct the spelling of your name.')));
  assert.equal(nodes(signed.render(), 'Button').some(item => item.props.title === 'Open approved PDF'), false);
  signed.button('Edit my answers').onPress();
  nodes(signed.render(), 'RowLink').find(item => item.props.title === `Part ${question('legal-name').part} · ${question('legal-name').title}`).props.onPress();
  signed.field('family_name').onChangeText('CHANGED'); signed.button('Update answer').onPress(); await settle();
  signed.setReviews([approved]); signed.button('Refresh review status').onPress(); await settle();
  signed.button('Open approved PDF').onPress(); await settle();
  assert.equal(signed.generated, 1, 'Opening an approval must not regenerate the edited local draft');
  assert.equal(signed.downloads[0].id, approved.id);
  assert.equal(nodes(signed.render(), 'DocumentDelivery').length, 1, 'Only server approval unlocks delivery');
  signed.button('Edit my answers').onPress();
  signed.consent(); signed.button('Send a new version for review').onPress(); await settle();
  assert.equal(signed.generated, 2, 'Edited answers require a new PDF and review');
  assert.notEqual(signed.submissions[2].requestId, signed.submissions[1].requestId);
  assert.equal(signed.submissions[2].answers.family_name, 'CHANGED');
  assert.equal(nodes(signed.render(), 'DocumentDelivery').length, 0, 'A new revision never inherits the old approval');
  assert.equal(signed.documents[0].disposed, true);
  signed.unmount();

  const exactCase = 'a5b63bbb-923d-4ad9-aeb0-7d8464439aac';
  const exactSandbox = {...approved, id:'sandbox-review', caseId:exactCase, environment:'sandbox'};
  const anotherProduction = {...approved, id:'production-review', caseId:'971e4938-fc45-4f3e-a9a1-d35390515173', submittedAt:'2026-10-12T15:00:00Z'};
  const mixedReview = host({...ready,paymentCaseId:exactCase}, 'en','review-customer','I-90',false,{userId:'review-customer',reviews:[anotherProduction,exactSandbox]});
  mixedReview.render(); await settle();
  assert.equal(nodes(mixedReview.render(),'Button').some(item=>item.props.title==='Open approved PDF'),false,'A different production case cannot supply approval for a sandbox draft');
  mixedReview.button('Open test PDF').onPress(); await settle();
  assert.equal(mixedReview.downloads[0].id,'sandbox-review');
  assert.equal(nodes(mixedReview.render(),'DocumentDelivery')[0].props.testDocument,true,'Sandbox delivery remains visibly test-only');
  mixedReview.unmount();

  const incompleteReview = host(draft(complete), 'en', 'review-customer', 'I-90', false, { userId: 'review-customer' });
  incompleteReview.render(); await settle();
  incompleteReview.button('Review progress').onPress(); incompleteReview.consent();
  assert.equal(incompleteReview.button('Send for review').disabled, true, 'Unvisited optional steps also need completion');
  incompleteReview.button('Send for review').onPress(); await settle();
  assert.equal(incompleteReview.submissions.length, 0, 'The handler itself enforces completion');
  assert.equal(incompleteReview.generated, 0);
  incompleteReview.unmount();

  const deniedStatus = host(ready, 'en', 'review-customer', 'I-90', false, { userId: 'review-customer', reviews: [approved] });
  deniedStatus.render(); await settle();
  deniedStatus.failReview(true); deniedStatus.button('Refresh review status').onPress(); await settle();
  assert.equal(nodes(deniedStatus.render(), 'Button').some(item => item.props.title === 'Open approved PDF'), false, 'A failed status check hides stale approval');
  deniedStatus.consent();
  assert.equal(deniedStatus.button('Send a new version for review').disabled, true);
  deniedStatus.failReview(false); deniedStatus.button('Refresh review status').onPress(); await settle();
  deniedStatus.holdDownload(true); deniedStatus.button('Open approved PDF').onPress(); await settle();
  deniedStatus.setUser('another-customer'); deniedStatus.render(); deniedStatus.releaseDownload(); await settle();
  assert.equal(nodes(deniedStatus.render(), 'DocumentDelivery').length, 0, 'A completed fetch cannot leak into another account');
  assert.equal(deniedStatus.documents[0].disposed, true);
  deniedStatus.unmount();
  const supersededRace = host(ready, 'en', 'review-customer', 'I-90', false, { userId: 'review-customer', reviews: [approved] });
  supersededRace.render(); await settle();
  supersededRace.holdDownload(true); supersededRace.button('Open approved PDF').onPress(); await settle();
  supersededRace.setActive(false); supersededRace.render();
  supersededRace.setReviews([{ ...pending, id: 'new-revision', requestId: 'new-request' }]);
  supersededRace.setActive(true); supersededRace.render(); await settle();
  supersededRace.releaseDownload(); await settle();
  assert.equal(supersededRace.documents[0].disposed, true, 'A late download is invalidated when the screen leaves and refreshes');
  assert.equal(nodes(supersededRace.render(), 'DocumentDelivery').length, 0, 'A stale approved file cannot replace the newer pending revision');
  assert.equal(nodes(supersededRace.render(), 'Button').some(item => item.props.title === 'Open approved PDF'), false);
  supersededRace.unmount();

  for (const formId of ['AR-11', 'N-400']) {
    const questions = guided.activePreparationQuestions(formId, {});
    const ready = { ...draft({}), formId, fullAnswers: {}, completedQuestionIds: questions.map(item => item.id) };
    const generic = host(ready, 'en', 'review-customer', formId, false, { userId: 'review-customer' });
    generic.render(); await settle(); generic.consent();
    assert.equal(generic.button('Send for review').disabled, false);
    generic.button('Send for review').onPress(); await settle();
    assert.equal(generic.submissions[0].formId, formId, 'Every guided form uses the same mandatory review path');
    assert.equal(generic.generated, 1);
    assert.equal(generic.downloads.length, 0);
    assert.equal(nodes(generic.render(), 'DocumentDelivery').length, 0);
    generic.unmount();
  }
  console.log('Customer review gate passed: saved guest handoff, consent, complete steps, immutable retry, no delivery while pending, requested changes, exact approved artifact, edited revisions, failed status and account-change isolation.');
  console.log('Full I-90 drafts passed: first-input autosave, invalid/partial answers, optional blanks, conditional resume, completed review, pending exit and failed-save retry.');
  console.log('AR-11 and N-400 screen checks passed: full review, per-form autosave, explicit completion, resume, account owner isolation, guarded return, and wrong-form draft protection.');
})().catch(error => { console.error(error); process.exitCode = 1; });
