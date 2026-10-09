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
const { evaluateQualification, validateField } = nativeModule.exports;
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

console.log(`Native preparation checks passed: ${schemas.length} forms, ${branchComparisons} yes/no paths, ${schemas.length * 2} empty/uncertain cases, 5 input validations.`);
