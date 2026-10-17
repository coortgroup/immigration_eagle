#!/usr/bin/env node
// Full official-field mapping and editable PDF round trips; synthetic data only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { PDFDocument } = require('pdf-lib');
const manifest = require('../data/uscis-print-templates.json');
const cache = new Map();
function load(file) {
  const full = path.resolve(file);
  if (cache.has(full)) return cache.get(full);
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, console, Uint8Array, ArrayBuffer, Date, Error, require(name) {
    if (!name.startsWith('.')) return require(name);
    const next = path.resolve(path.dirname(full), name);
    return name.endsWith('.json') ? require(next) : load(`${next}.ts`);
  } }, { filename: full });
  cache.set(full, module.exports);
  return module.exports;
}
const engine = load('src/guidedPreparation.ts');
const schemas = load('src/guidedFormSchema.ts');
const free = load('src/freePdfEngine.ts');
const progress = load('src/fullPreparationDraft.ts');
const i90 = load('src/uscisQuestionnaire.ts');
const clone = value => JSON.parse(JSON.stringify(value));
const qaDirectory = process.env.GUIDED_PDF_QA_DIR ? path.resolve(process.env.GUIDED_PDF_QA_DIR) : undefined;
const conditionReferences = condition => !condition ? [] : condition.all ? condition.all.flatMap(conditionReferences) : [condition.field];

(async () => {
  if (qaDirectory) fs.mkdirSync(qaDirectory, { recursive: true });
  assert.equal(Object.keys(schemas.guidedFormDefinitions).length, 21);
  assert.equal(engine.getPreparationDefinition('I-90'), i90.i90Questionnaire, 'Preserve the reviewed I-90 questionnaire');
  assert.deepEqual(clone(engine.activePreparationQuestions('I-90', {})), clone(i90.activeQuestions({})));
  let mappedCount = 0;
  for (const [formId, schema] of Object.entries(schemas.guidedFormDefinitions)) {
    const definition = engine.getPreparationDefinition(formId);
    assert.ok(definition.questions.length > 0, `${formId}: complete questionnaire is present`);
    if (formId === 'I-90') continue;
    assert.equal(schema.templateSha256, manifest.templates[formId].sha256);
    const allFields = schema.sections.flatMap(section => section.fields);
    const preceding = new Set();
    for (const field of allFields) {
      for (const reference of conditionReferences(field.when)) assert.ok(preceding.has(reference), `${formId}: conditional controller must appear before ${field.id}`);
      preceding.add(field.id);
    }
    const questionFields = definition.questions.flatMap(question => question.fields);
    assert.equal(questionFields.length, allFields.length, `${formId}: every official input is shown`);
    assert.equal(new Set(questionFields.map(field => field.id)).size, allFields.length);
    const names = allFields.flatMap(field => field.pdfFields.map(mapping => mapping.name));
    assert.equal(new Set(names).size, names.length, `${formId}: unique output mapping`);
    for (const excluded of schema.excluded) assert.ok(!names.includes(excluded.name), `${formId}: protected ${excluded.name} is excluded`);
    const template = fs.readFileSync(path.join('assets/uscis-print', manifest.templates[formId].filename));
    const prepared = await free.prepareFreePdf(template, formId);
    const descriptors = new Map(prepared.fields.map(field => [field.name, field]));
    assert.equal(names.length, prepared.fields.length, `${formId}: guided steps cover every editable official field`);
    names.forEach(name => assert.ok(descriptors.has(name), `${formId}: mapped field is editable`));
    const answers = {};
    for (const field of allFields) {
      if (field.kind === 'checkbox') answers[field.id] = [field.options?.[0]?.value || 'checked'];
      else if (field.kind === 'multiselect') answers[field.id] = field.options.slice(0, 2).map(option => option.value);
      else if (field.options?.length) answers[field.id] = field.options[0].value;
      else if (field.pdfFields.every(mapping => descriptors.get(mapping.name).widgets.every(widget => widget.width >= 12 && widget.height >= 12))) answers[field.id] = '1';
    }
    assert.deepEqual(clone(engine.validatePreparationAnswers(formId, answers)), {});
    const values = engine.mapGuidedPreparationAnswers(formId, answers);
    const bytes = await engine.fillGuidedPreparationPdf(formId, template, answers);
    if (qaDirectory) fs.writeFileSync(path.join(qaDirectory, `${formId}-synthetic.pdf`), bytes);
    const reopened = await free.prepareFreePdf(bytes, formId);
    const current = new Map(reopened.fields.map(field => [field.name, field.value]));
    assert.equal(reopened.pages.length, schema.pageCount);
    for (const [name, value] of Object.entries(values)) assert.equal(current.get(name), value, `${formId}: official PDF round trip ${name}`);
    const original = await PDFDocument.load(template);
    const result = await PDFDocument.load(bytes);
    assert.equal(result.getForm().getFields().length, original.getForm().getFields().length, `${formId}: PDF stays editable`);
    for (const excluded of schema.excluded) {
      const before = original.getForm().getFieldMaybe(excluded.name);
      const after = result.getForm().getFieldMaybe(excluded.name);
      if (before) assert.equal(after.acroField.dict.toString(), before.acroField.dict.toString(), `${formId}: signature/official-use field remains untouched`);
    }
    const activeFields = engine.activePreparationQuestions(formId, answers).flatMap(question => question.fields);
    const activeFieldIds = new Set(activeFields.map(field => field.id));
    const choice = activeFields.find(field => field.options?.length);
    if (choice) {
      const invalid = { ...answers, [choice.id]: choice.type === 'multiselect' ? ['not-an-official-option'] : 'not-an-official-option' };
      assert.ok(engine.validatePreparationAnswers(formId, invalid)[choice.id]);
      assert.throws(() => engine.mapGuidedPreparationAnswers(formId, invalid), error => !!error.errors?.[choice.id]);
    }
    const limited = activeFields.find(field => field.maxLength && !field.options);
    if (limited) assert.ok(engine.validatePreparationAnswers(formId, { ...answers, [limited.id]: 'A'.repeat(limited.maxLength + 1) })[limited.id], `${formId}: never truncate long input`);
    const spaced = allFields.find(field => activeFieldIds.has(field.id) && !['radio', 'multiselect'].includes(field.kind) && field.options?.some(option => option.value && option.value !== option.value.trim()));
    if (spaced) {
      const value = spaced.options.find(option => option.value && option.value !== option.value.trim()).value;
      const exact = { ...answers, [spaced.id]: value };
      assert.equal(engine.validatePreparationAnswers(formId, exact)[spaced.id], undefined, `${formId}: accept exact official dropdown exports`);
      assert.equal(engine.mapGuidedPreparationAnswers(formId, exact)[spaced.pdfFields[0].name], value, `${formId}: preserve meaningful spaces in native options`);
    }
    if (formId === 'AR-11') {
      const entry = allFields.find(field => field.kind === 'text' && field.maxLength > 2);
      await assert.rejects(() => engine.fillGuidedPreparationPdf(formId, template, { ...answers, [entry.id]: '\u2603' }), error => error.code === 'characters', 'Unsupported PDF font characters must never disappear silently');
      const wide = allFields.find(field => field.kind === 'text' && !field.maxLength);
      await assert.rejects(() => engine.fillGuidedPreparationPdf(formId, template, { ...answers, [wide.id]: 'W'.repeat(1000) }), error => error.code === 'overflow', 'Long answers must never clip in the PDF');
    }
    const textQuestion = definition.questions.find(question => question.fields.length > 1 && question.fields.every(field => field.type === 'text'));
    if (textQuestion) {
      const partial = { [textQuestion.fields[0].id]: '1' };
      assert.equal(progress.fullPreparationProgress(partial, [], formId).answered, 0, `${formId}: partial groups do not skip unanswered inputs`);
      const state = progress.fullPreparationProgress(partial, [textQuestion.id], formId);
      assert.equal(state.answered, 1, `${formId}: explicitly skipped blanks remain complete`);
    }
    const stale = { ...answers, not_a_field: 'MUST NOT APPEAR' };
    assert.deepEqual(clone(engine.mapGuidedPreparationAnswers(formId, stale)), clone(values), `${formId}: unknown/stale keys never enter the official form`);
    const baseline = Object.fromEntries(allFields.filter(field => field.required).map(field => [field.id, field.options?.[0]?.value || '1']));
    const hidden = allFields.find(field => field.when && !Object.prototype.hasOwnProperty.call(engine.activePreparationAnswers(formId, { ...baseline, [field.id]: 'STALE' }), field.id));
    if (hidden) {
      const blank = engine.mapGuidedPreparationAnswers(formId, baseline);
      const hiddenValue = hidden.options?.length ? hidden.kind === 'multiselect' ? [hidden.options[0].value] : hidden.options[0].value : 'STALE';
      assert.deepEqual(clone(engine.mapGuidedPreparationAnswers(formId, { ...baseline, [hidden.id]: hiddenValue })), clone(blank), `${formId}: values from hidden branches are cleared`);
      assert.ok(!progress.validCompletedQuestions({ ...baseline, [hidden.id]: hiddenValue }, definition.questions.map(question => question.id), formId).some(id => definition.questions.find(question => question.id === id).fields.some(field => field.id === hidden.id)), `${formId}: hidden completion markers are removed`);
    }
    mappedCount += names.length;
    console.log(`${formId}: ${definition.questions.length} steps, ${allFields.length} inputs, ${names.length} official PDF fields round-tripped.`);
  }
  // A known conditional path still excludes old values after the controlling answer changes.
  const before = { name_changed: 'yes', card_family_name: 'OLD', resident_status: 'lpr' };
  assert.equal(engine.activePreparationAnswers('I-90', before).card_family_name, 'OLD');
  assert.equal(engine.activePreparationAnswers('I-90', { ...before, name_changed: 'no' }).card_family_name, undefined);
  console.log(`Guided preparation passed: 21 form definitions; ${mappedCount} editable fields on 20 added forms; exact coverage, options, limits, progress, stale-answer exclusion and preserved signatures.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
