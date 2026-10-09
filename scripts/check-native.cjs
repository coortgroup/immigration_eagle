/* Test the native TypeScript engine without a React Native runtime or Jest.
 * Exhaustive yes/no paths ensure that the migration preserves the reviewed
 * prototype routing. Separate checks cover native uncertainty and input errors.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const transpiled = ts.transpileModule(read('src/qualification.ts'), {
  fileName: 'qualification.ts',
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const errors = (transpiled.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error);
assert.equal(errors.length, 0, errors.map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')).join('\n'));

const nativeModule = { exports: {} };
vm.runInNewContext(transpiled.outputText, { module: nativeModule, exports: nativeModule.exports, Date }, {
  filename: 'qualification.native.js', timeout: 1000,
});
const { evaluateQualification, validateField, draftProgress, draftResume, matchesFormSearch } = nativeModule.exports;
assert.equal(typeof evaluateQualification, 'function');
assert.equal(typeof validateField, 'function');

const prototype = {};
vm.runInNewContext(read('prototype/qualification-engine.js') + '\nglobalThis.evaluate = evaluateQualification;', prototype, {
  filename: 'qualification.prototype.js', timeout: 1000,
});
const schemas = [
  ...JSON.parse(read('data/eligibility-main.json')).forms,
  ...JSON.parse(read('data/eligibility-other.json')).forms,
];
const catalog = JSON.parse(read('data/forms-catalog.json')).forms;
assert.equal(schemas.length, catalog.length, 'Every catalog form must have a preliminary check.');
assert.deepEqual(new Set(schemas.map(item => item.id)), new Set(catalog.map(item => item.id)));

let branchComparisons = 0;
for (const schema of schemas) {
  assert(schema.questions.length > 0 && schema.questions.length <= 12, `${schema.id}: expected a short questionnaire`);
  for (let mask = 0; mask < 2 ** schema.questions.length; mask += 1) {
    const answers = Object.fromEntries(schema.questions.map((question, index) => [question.id, mask & (1 << index) ? 'yes' : 'no']));
    assert.equal(
      JSON.stringify(evaluateQualification(schema, answers)),
      JSON.stringify(prototype.evaluate(schema, answers)),
      `${schema.id}: the native result changed for answer mask ${mask}`,
    );
    branchComparisons += 1;
  }
  assert.equal(evaluateQualification(schema, {}).status, 'checking', `${schema.id}: unanswered must not pass`);
  assert.equal(evaluateQualification(schema, { [schema.questions[0].id]: 'unsure' }).status, 'review', `${schema.id}: uncertainty must lead to review`);
}

assert(validateField({ id: 'date_of_birth', type: 'date', required: true }, '02/30/2024'), 'Reject nonexistent calendar days.');
assert.equal(validateField({ id: 'date_of_birth', type: 'date', required: true }, '02/29/2024'), null, 'Accept a valid leap day.');
assert(validateField({ id: 'email', type: 'email', required: true }, 'not-an-email'), 'Reject invalid email addresses.');
assert.equal(validateField({ id: 'email', type: 'email', required: true }, 'person@example.com'), null, 'Accept a valid email address.');
assert(validateField({ id: 'full_name', type: 'text', required: true }, '   '), 'Required fields cannot contain only whitespace.');

const interviews = JSON.parse(read('data/preparation-fields.json')).forms;
assert.deepEqual(new Set(interviews.map(item => item.id)), new Set(catalog.map(item => item.id)), 'Every form must have its own preparation questions.');
let resumeChecks = 0;
for (const form of catalog) {
  assert(matchesFormSearch(form, form.id), `${form.id}: ordinary form search must match`);
  assert(matchesFormSearch(form, form.id.replace('-', '').toLowerCase()), `${form.id}: search without a hyphen must match`);
  assert(matchesFormSearch(form, form.id.replace('-', ' ')), `${form.id}: space-separated form search must match`);
  assert(matchesFormSearch(form, form.id.replace('-', '–')), `${form.id}: pasted en dash must match`);
  assert(!matchesFormSearch(form, 'a form that does not exist xyzzy'), `${form.id}: unrelated searches must not match`);

  const fields = interviews.find(item => item.id === form.id).fields;
  const schema = schemas.find(item => item.id === form.id);
  const checks = Object.fromEntries(schema.questions.map(question => [question.id,
    question.yes === 'next' ? 'yes' : question.no === 'next' ? 'no' : 'unsure']));
  const samples = Object.fromEntries(fields.map(field => [field.id,
    field.type === 'email' ? 'example@example.com' : field.type === 'tel' ? '+1 202 555 0101' : field.type === 'date' ? '04/23/1990' : 'Example answer']));
  const empty = draftResume(schema, checks, fields, {});
  assert.equal(empty.progress.answered, 0, `${form.id}: an empty draft has no completed answers`);
  assert.equal(empty.progress.firstInvalid, 0, `${form.id}: resume at the first required answer`);
  assert.equal(empty.progress.complete, false, `${form.id}: an empty draft is incomplete`);
  const complete = draftResume(schema, checks, fields, samples);
  assert.equal(complete.progress.complete, true, `${form.id}: a valid draft reaches review`);
  assert.equal(complete.progress.answered, fields.length);
  assert.equal(complete.qualification.status, evaluateQualification(schema, checks).status);
  const missingCheck = draftResume(schema, {}, fields, samples);
  assert.equal(missingCheck.qualification.status, 'checking', `${form.id}: completed intake cannot bypass the form check`);
  const uncertain = draftResume(schema, { ...checks, [schema.questions[0].id]: 'unsure' }, fields, samples);
  assert.equal(uncertain.qualification.status, 'review', `${form.id}: an uncertain restored check must not resume preparation`);
  const changedSchema = { ...schema, questions: [...schema.questions, { id: 'new_requirement', text: 'New check', yes: 'next', no: 'review' }] };
  assert.notEqual(draftResume(changedSchema, checks, fields, samples).qualification.status, 'passed', `${form.id}: new questions invalidate an old pass`);
  resumeChecks += 5;
}
const sampleFields = [{ id: 'full_name', type: 'text', required: true }, { id: 'birth_date', type: 'date', required: true }];
const invalidSaved = draftProgress(sampleFields, { full_name: 'Example', birth_date: '02/30/2024' });
assert.equal(invalidSaved.firstInvalid, 1, 'Resume at an invalid nonempty saved answer instead of skipping it.');
assert.equal(invalidSaved.answered, 1, 'Invalid saved values must not count as completed.');
assert.equal(invalidSaved.complete, false);

console.log(`Native preparation checks passed: ${schemas.length} forms, ${branchComparisons} yes/no paths, ${schemas.length * 2} empty/uncertain cases, 5 input validations, ${catalog.length * 5} search cases, ${resumeChecks + 1} draft-resume cases.`);
