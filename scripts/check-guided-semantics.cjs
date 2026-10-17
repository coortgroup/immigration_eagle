#!/usr/bin/env node
// Printed-source regressions: which answer is being asked, not just PDF coverage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const cache = new Map();
function load(file) {
  const full = path.resolve(file);
  if (cache.has(full)) return cache.get(full);
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, {
    module, exports: module.exports, console, Uint8Array, ArrayBuffer, Date, Error,
    require(name) { return name.startsWith('.') ? name.endsWith('.json') ? require(path.resolve(path.dirname(full), name)) : load(path.resolve(path.dirname(full), `${name}.ts`)) : require(name); },
  });
  cache.set(full, module.exports);
  return module.exports;
}
const engine = load('src/guidedPreparation.ts');
const schemas = load('src/guidedFormSchema.ts').guidedFormDefinitions;
const progress = load('src/fullPreparationDraft.ts');
const short = name => name.split('.').at(-1).replace(/\[\d+\]$/, '');
const fields = id => schemas[id].sections.flatMap(section => section.fields);
const field = (id, name) => fields(id).find(q => q.pdfFields.some(m => short(m.name) === name));
const choice = (id, name, state) => {
  const q = field(id, name), value = q.pdfFields.find(m => m.exportValue?.trim() === state)?.option;
  assert.ok(value, `${id}: source export ${name}/${state}`);
  return { [q.id]: value };
};
const shown = (id, name, answers) => engine.activePreparationQuestions(id, answers).some(q => q.fields.some(f => f.id === field(id, name).id));
const add = (id, name, value) => ({ [field(id, name).id]: value });
const blank = (id, name, answers) => {
  const mapped = engine.mapGuidedPreparationAnswers(id, answers);
  for (const mapping of field(id, name).pdfFields) assert.equal(mapped[mapping.name], mapping.option ? false : '', `${id}: hidden ${name} must clear`);
};

// I-131 pages 1–4: one document type, with receipts/subchoices belonging to that type.
assert.equal(field('I-131', 'CB_AppType').kind, 'radio');
assert.equal(field('I-131', 'CB_AppType').options.length, 37);
const tps = choice('I-131', 'CB_AppType', '4');
assert.ok(shown('I-131', 'P1_Line4', tps));
assert.ok(!shown('I-131', 'P1_Line5A', tps));
blank('I-131', 'P1_Line5A', { ...tps, ...add('I-131', 'P1_Line5A', 'OLD RECEIPT') });
assert.ok(!shown('I-131', 'P1_Line8A_1', tps));
assert.ok(shown('I-131', 'P1_Line8A_1', choice('I-131', 'CB_AppType', '24')));
for (const [state, visible, hidden] of [
  ['1', 'P5_Line1_Lessthan6', 'P6_Line1_CountryRefugee'],
  ['2', 'P6_Line1_CountryRefugee', 'P5_Line1_Lessthan6'],
  ['5', 'P7_Line1_DateOfDeparture', 'P8_Line1_Explain'],
  ['18', 'P8_Line1_Explain', 'P9_Line1_EAD'],
  ['28', 'P9_Line1_EAD', 'P7_Line1_DateOfDeparture'],
]) {
  const answers = { ...choice('I-131', 'CB_AppType', state), 'parole-recipient': 'self' };
  assert.ok(shown('I-131', visible, answers)); assert.ok(!shown('I-131', hidden, answers));
}
// Printed page 6: never export another person's block for a self-filed request.
const another = { ...choice('I-131', 'CB_AppType', '18'), 'parole-recipient': 'other', ...add('I-131', 'P2_Line16_FamilyName', 'OTHER PERSON') };
assert.ok(shown('I-131', 'P2_Line16_FamilyName', another));
assert.ok(shown('I-131', 'P2_Line27_I94RecordNo', another));
for (const self of [{ ...another, 'parole-recipient': 'self' }, { ...another, ...choice('I-131', 'CB_AppType', '1') }]) {
  assert.ok(!shown('I-131', 'P2_Line16_FamilyName', self));
  blank('I-131', 'P2_Line16_FamilyName', self);
}
const delivery = field('I-131', 'P4_Line7a');
assert.match(delivery.options.find(o => o.value === choice('I-131', 'P4_Line7a', 'A')[delivery.id]).label, /To the U.S. address shown in Part 2/);

// I-485 page 2: the admission class and parole class are distinct printed lines.
assert.match(field('I-485', 'Pt1Line11_Admitted').label, /admitted as/);
assert.match(field('I-485', 'Pt1Line11_Paroled').label, /paroled as/);
const admitted = { ...choice('I-485', 'Pt2Line11_CB', '11A'), ...add('I-485', 'Pt1Line11_Admitted', 'F-1'), ...add('I-485', 'Pt1Line11_Paroled', 'STALE') };
assert.ok(shown('I-485', 'Pt1Line11_Admitted', admitted));
assert.ok(!shown('I-485', 'Pt1Line11_Paroled', admitted));
blank('I-485', 'Pt1Line11_Paroled', admitted);
// Pages 5–7: all application categories are one choice; associated details clear.
assert.equal(field('I-485', 'Pt2Line3a_CB').kind, 'radio');
assert.equal(field('I-485', 'Pt2Line3a_CB').options.length, 51);
const asylum = choice('I-485', 'Pt2Line3a_CB', '3d0');
assert.ok(shown('I-485', 'Pt2Line3d_Asylum', asylum));
assert.ok(!shown('I-485', 'Pt2Line3d_Refugee', asylum));
blank('I-485', 'Pt2Line3d_Refugee', { ...asylum, ...add('I-485', 'Pt2Line3d_Refugee', '01/01/2020') });
const employment = { ...choice('I-485', 'Pt2Line3a_CB', '3b1'), ...choice('I-485', 'Pt2Line3b_CB140Assoc', 'Y') };
assert.ok(shown('I-485', 'Pt2Relative_CB', employment));
assert.ok(!shown('I-485', 'Pt2Relative_CB', { ...employment, ...choice('I-485', 'Pt2Line3b_CB140Assoc', 'N') }));
assert.ok(!shown('I-485', 'Pt2Relative_CB', { ...employment, ...asylum }));
// Page 18: a stale tooltip called the Refugee box Lautenberg. They are different boxes.
const publicCharge = field('I-485', 'Pt9Line56_CB');
const sourceCaption = state => publicCharge.options.find(o => o.value === choice('I-485', 'Pt9Line56_CB', state)[publicCharge.id]).label;
assert.equal(sourceCaption('1'), 'Refugee (Form I-590 or Form I-730).');
assert.match(sourceCaption('18'), /Lautenberg/);
assert.match(sourceCaption('23'), /57\. - 64/);
assert.doesNotMatch(sourceCaption('23'), /57\. - 66|Item Number 67/);
const notExempt = { ...choice('I-485', 'Pt9Line56_CB', '23'), ...choice('I-485', 'Pt9Line63_YesNo', 'Y'), ...add('I-485', 'Pt9Line57_HouseholdSize', '3') };
assert.ok(shown('I-485', 'Pt9Line57_HouseholdSize', notExempt));
assert.ok(shown('I-485', 'Pt8Line68c_Column1Row1', notExempt));
const exempt = { ...notExempt, ...choice('I-485', 'Pt9Line56_CB', '1') };
assert.ok(!shown('I-485', 'Pt9Line57_HouseholdSize', exempt));
assert.ok(!shown('I-485', 'Pt8Line68c_Column1Row1', exempt));
blank('I-485', 'Pt9Line57_HouseholdSize', exempt);

// I-751 page 3: joint filing is exclusive; waiver reasons explicitly allow multiple.
const waiver = field('I-751', 'Pt3Line1c'), joint = field('I-751', 'Pt3Line1');
assert.equal(waiver.kind, 'multiselect'); assert.equal(joint.kind, 'radio');
const waiverAnswers = { 'filing-basis': 'waiver', [waiver.id]: waiver.options.slice(0, 2).map(o => o.value), [joint.id]: joint.options[0].value };
const waiverPdf = engine.mapGuidedPreparationAnswers('I-751', waiverAnswers);
assert.equal(waiver.pdfFields.filter(m => waiverPdf[m.name]).length, 2);
assert.ok(joint.pdfFields.every(m => waiverPdf[m.name] === false));
const jointAnswers = { ...waiverAnswers, 'filing-basis': 'joint' };
assert.ok(waiver.pdfFields.every(m => engine.mapGuidedPreparationAnswers('I-751', jointAnswers)[m.name] === false));

// N-400 printed pages 4 and 11: skip target and nested fee-reduction conditions.
assert.match(field('N-400', 'P10_Line1_MaritalStatus').options.find(o => /Single/.test(o.label)).label, /Part 6\. Information About Your Children/);
const reduced = { ...choice('N-400', 'P10_Line1_Citizen', 'Y'), ...choice('N-400', 'P10_Line5a', 'N'), ...add('N-400', 'P10_Line5b_NameOfHousehold', 'HEAD') };
assert.ok(shown('N-400', 'P10_Line5b_NameOfHousehold', reduced));
for (const answers of [{ ...reduced, ...choice('N-400', 'P10_Line5a', 'Y') }, { ...reduced, ...choice('N-400', 'P10_Line1_Citizen', 'N') }]) {
  assert.ok(!shown('N-400', 'P10_Line5b_NameOfHousehold', answers));
  blank('N-400', 'P10_Line5b_NameOfHousehold', answers);
  const question = engine.getPreparationDefinition('N-400').questions.find(q => q.fields.some(f => f.id === field('N-400', 'P10_Line5b_NameOfHousehold').id));
  assert.ok(!progress.validCompletedQuestions(answers, [question.id], 'N-400').includes(question.id));
}
assert.equal(field('N-565', 'Pt4_Item1_Name').kind, 'multiselect');
assert.match(field('N-565', 'Pt6CheckBox1A').label, /go to Part 9/);
console.log('Guided semantics passed: printed labels, mutually exclusive routes, multiple waiver reasons, conditional visibility, and stale-answer clearing.');
