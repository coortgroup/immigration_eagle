const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/uscisQuestionnaire.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
const moduleRef = { exports: {} };
vm.runInNewContext(compiled, {
  module: moduleRef, exports: moduleRef.exports, Date,
  require(name) {
    if (name.startsWith('../data/') && name.endsWith('.json')) return JSON.parse(fs.readFileSync(path.resolve(root, 'src', name), 'utf8'));
    throw new Error(`Unexpected runtime dependency: ${name}`);
  },
});
const api = moduleRef.exports;
const schema = api.i90Questionnaire;
const question = id => schema.questions.find(item => item.id === id);
const field = id => schema.questions.flatMap(item => item.fields).find(item => item.id === id);
const mappedName = id => field(id).pdfFields[0].name;

// Synthetic data only, deliberately unrelated to any person. These values exercise
// the actual map and provide an integration fixture for the official-PDF engine.
function fixture(overrides = {}) {
  const answers = {
    name_changed: 'no', physical_different: 'no', resident_status: 'lpr', reason_a: '2f',
    immigrant_visa_entry: 'no', removal_history: 'no', abandonment_history: 'no',
    accommodation: 'no', applicant_statement: 'english', preparer_used: 'no',
    family_name: 'EXAMPLE', given_name: 'SAMPLE', middle_name: 'N/A', admission_class: 'IR2',
    birth_date: '01/02/1990', admission_date: '03/04/2010',
    ...overrides,
  };
  for (let iteration = 0; iteration < 3; iteration++) {
    for (const q of api.activeQuestions(answers)) {
      for (const f of q.fields) {
        if (answers[f.id] !== undefined) continue;
        if (!api.isFieldRequired(f, answers)) continue;
        if (f.id.endsWith('_unit_type')) answers[f.id] = 'none';
        else if (f.type === 'multiselect') answers[f.id] = [f.options[0].value];
        else if (f.options) answers[f.id] = f.options[0].value;
        else if (f.validation === 'date') answers[f.id] = '01/02/1990';
        else if (f.validation === 'a-number') answers[f.id] = '123456789';
        else if (f.validation === 'weight') answers[f.id] = '175';
        else if (f.validation === 'phone') answers[f.id] = '2025550100';
        else if (f.id.endsWith('_country')) answers[f.id] = 'United States';
        else if (f.id.endsWith('_street')) answers[f.id] = '123 SAMPLE ST';
        else if (f.id.endsWith('_city')) answers[f.id] = 'SAMPLE CITY';
        else answers[f.id] = 'SAMPLE';
      }
      for (const f of q.fields) {
        if (f.id.endsWith('_country') && answers[f.id] === 'United States') {
          const prefix = f.id.slice(0, -'_country'.length);
          answers[`${prefix}_state`] = 'NY';
          answers[`${prefix}_zip`] = '10001';
        }
      }
    }
  }
  return answers;
}

const inventory = JSON.parse(fs.readFileSync(path.join(root, 'data/uscis-form-inventory.json'), 'utf8')).forms['I-90'];
assert.equal(schema.coverage.officialWidgets, 195);
assert.equal(new Set(schema.printFields.map(item => item.name)).size, 195);
assert.equal(schema.printFields.length, inventory.fields.length);
assert.equal(schema.originalSha256, inventory.originalSha256);
assert.equal(schema.questions.length, 51);
const expectedWidgets = new Map(inventory.fields.map(item => [item.name, item]));
const actualMappings = schema.questions.flatMap(q => q.fields.flatMap(f => f.pdfFields));
for (const mapping of actualMappings) {
  assert.ok(expectedWidgets.has(mapping.name), mapping.name);
  if (mapping.option !== undefined) assert.ok(expectedWidgets.get(mapping.name).exportStates.includes(mapping.exportValue), mapping.name);
}
const baseline = fixture();
assert.equal(Object.keys(api.validateI90Answers(baseline)).length, 0);
const filled = api.mapI90Answers(baseline);
assert.equal(filled.answers[mappedName('family_name')], 'EXAMPLE');
assert.equal(filled.answers[mappedName('weight')], '1', 'Three-digit weight must map to separate official boxes');
assert.equal(filled.answers[field('weight').pdfFields[1].name], '7');
assert.equal(filled.answers[field('weight').pdfFields[2].name], '5');
assert.equal(filled.answers[field('reason_a').pdfFields.find(item => item.option === '2f').name], true);
assert.equal(filled.answers[field('reason_a').pdfFields.find(item => item.option === '2e').name], false);
assert.equal(api.applicableSigning(baseline).length, 1);
for (const item of [...schema.excluded.map(item => item.name), ...schema.signing.flatMap(item => item.blankPdfFields)]) {
  assert.equal(filled.answers[item], undefined, 'Barcodes, signatures and signing dates must stay blank');
}
for (const item of schema.derived.filter(item => !item.when)) assert.equal(filled.answers[item.name], baseline[item.fromField]);

const conditional = fixture({ resident_status: 'conditional', reason_b: '3a' });
const conditionalMap = api.mapI90Answers(conditional);
assert.equal(conditionalMap.answers[field('reason_b').pdfFields.find(item => item.option === '3a').name], true);
for (const item of field('reason_a').pdfFields) assert.equal(conditionalMap.answers[item.name], undefined, 'Section A must not leak into conditional-resident Section B');

const assisted = fixture({ applicant_statement: 'interpreter', interpreter_language: 'Spanish', preparer_used: 'yes', preparer_status: 'attorney', preparer_representation: 'extends' });
assert.equal(Object.keys(api.validateI90Answers(assisted)).length, 0);
assert.equal(api.applicableSigning(assisted).length, 3);
const assistedMap = api.mapI90Answers(assisted);
const languageCopy = schema.derived.find(item => item.fromField === 'interpreter_language');
assert.equal(assistedMap.answers[languageCopy.name], 'Spanish');
assert.ok(assistedMap.answers[field('preparer_representation').pdfFields[0].name]);
const noLongerAssisted = { ...assisted, applicant_statement: 'english', preparer_used: 'no' };
const noLongerMap = api.mapI90Answers(noLongerAssisted);
assert.equal(noLongerMap.answers[languageCopy.name], undefined, 'Hidden derived language must not leak');
assert.equal(noLongerMap.answers[mappedName('preparer_family_name')], undefined);
assert.equal(noLongerMap.answers[field('preparer_representation').pdfFields[0].name], undefined, 'Nested preparer branch must not leak');

const accommodation = fixture({ accommodation: 'yes', accommodation_types: ['hearing'], accommodation_hearing: 'ASL interpreter' });
assert.ok(api.mapI90Answers(accommodation).answers[mappedName('accommodation_hearing')]);
const removedAccommodation = { ...accommodation, accommodation: 'no' };
assert.equal(api.activeQuestions(removedAccommodation).some(item => item.id === 'accommodation-hearing'), false);
assert.equal(api.mapI90Answers(removedAccommodation).answers[mappedName('accommodation_hearing')], undefined, 'Stale child answers must not survive hidden parent selection');

assert.ok(api.validateQuestion(question('birth'), { ...baseline, birth_date: '02/30/1990' }).birth_date);
assert.ok(api.validateQuestion(question('birth'), { ...baseline, birth_date: '02/29/1900' }).birth_date);
assert.equal(api.validateQuestion(question('birth'), { ...baseline, birth_date: '02/29/2000' }).birth_date, undefined);
assert.ok(api.validateQuestion(question('birth'), { ...baseline, birth_date: '01/01/2199' }).birth_date);
assert.ok(api.validateQuestion(question('admission'), { ...baseline, admission_date: '01/01/1980' }).admission_date);
assert.ok(api.validateQuestion(question('admission'), { ...baseline, admission_class: 'IR22' }).admission_class);
assert.ok(api.validateQuestion(question('sex'), { ...baseline, sex: ['male', 'female'] }).sex, 'Single-choice questions must reject arrays');
assert.ok(api.validateQuestion(question('race'), { ...baseline, race: ['white', 'white'] }).race, 'Repeated multiselects must fail');
assert.ok(api.validateQuestion(question('race'), { ...baseline, race: ['unlisted'] }).race);
assert.ok(api.validateQuestion(question('weight'), { ...baseline, weight: '700' }).weight);
assert.ok(api.validateQuestion(question('weight'), { ...baseline, weight: '029' }).weight);
assert.equal(api.validateQuestion(question('weight'), { ...baseline, weight: '000' }).weight, undefined);
assert.ok(api.validateQuestion(question('mail-address'), { ...baseline, mail_street: 'X'.repeat(26) }).mail_street, 'Never silently truncate');
assert.ok(api.validateQuestion(question('mail-address'), { ...baseline, mail_unit_type: 'none', mail_unit: '2' }).mail_unit);
assert.ok(api.validateQuestion(question('mail-address'), { ...baseline, mail_unit_type: 'apt', mail_unit: '' }).mail_unit);
assert.ok(api.validateQuestion(question('mail-address'), { ...baseline, mail_country: 'U.S.A.', mail_state: '' }).mail_state);
assert.ok(api.validateQuestion(question('commuter-port'), { ...baseline, resident_status: 'commuter', mail_country: 'Canada', commuter_port: '' }).commuter_port);
assert.ok(api.validateI90Answers({ ...baseline, resident_status: 'commuter', mail_country: 'United States' }).physical_different);

const requiresExplanation = { ...baseline, removal_history: 'yes' };
assert.ok(api.validateI90Answers(requiresExplanation).removal_history);
assert.throws(() => api.mapI90Answers(requiresExplanation), error => error.name === 'QuestionnaireValidationError' && !!error.errors.removal_history);
const explanation = { ...requiresExplanation, additional_1_page: '3', additional_1_part: '3', additional_1_item: '4', additional_1_text: 'Synthetic explanation for test only.' };
assert.equal(api.validateI90Answers(explanation).removal_history, undefined);
assert.ok(api.validateI90Answers({ ...explanation, additional_1_text: 'N/A' }).removal_history);
assert.ok(api.validateQuestion(question('additional-1'), { ...explanation, additional_1_item: '' }).additional_1_item);
assert.equal(api.questionForPdfField(mappedName('family_name')).id, 'legal-name');
assert.equal(api.questionForPdfField(schema.derived[0].name).id, 'legal-name');
assert.equal(api.questionForPdfField(schema.signing[0].blankPdfFields[0]), undefined);
assert.throws(() => api.mapI90Answers({}), /Enter an answer/);

if (process.env.USCIS_TEST_FIXTURE_OUTPUT) {
  fs.writeFileSync(process.env.USCIS_TEST_FIXTURE_OUTPUT, JSON.stringify({ baseline, assisted, explanation, mapped: filled, assistedMapped: assistedMap }, null, 2));
}
console.log('USCIS I-90 questionnaire: 195 widget dispositions; official choices, grouped inputs, conditional branches, stale-answer exclusion, signatures, validation and PDF mapping passed.');
