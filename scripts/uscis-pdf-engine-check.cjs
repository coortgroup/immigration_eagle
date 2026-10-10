#!/usr/bin/env node
/* Deterministic engine acceptance checks; synthetic values only. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');
const { PDFDocument, PDFName } = require('pdf-lib');

const compiled = ts.transpileModule(fs.readFileSync('src/pdfEngine.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleValue = { exports: {} };
vm.runInNewContext(compiled, {
  module: moduleValue, exports: moduleValue.exports, Uint8Array, ArrayBuffer, console,
  require(name) {
    if (name === 'expo-crypto') return { digest: (algorithm, data) => webcrypto.subtle.digest(algorithm, data), CryptoDigestAlgorithm: { SHA256: 'SHA-256' } };
    return require(name);
  },
}, { filename: 'pdfEngine.cjs' });
const { fillOfficialPrintPdf } = moduleValue.exports;
const manifest = require('../data/uscis-print-templates.json');
const inventory = require('../data/uscis-form-inventory.json');
const directory = path.resolve('tmp/pdfs/engine-check');
fs.mkdirSync(directory, { recursive: true });

function template(id, allowed = []) {
  const entry = manifest.templates[id];
  return { ...entry, fields: inventory.forms[id].fields.filter(field => allowed.includes(field.name)).map(field => ({
    ...field, disposition: 'answer', approvedForPrint: true,
  })) };
}

function original(id) { return fs.readFileSync(path.join('assets/uscis-print', manifest.templates[id].filename)); }

async function checkOutput(id, bytes, label) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.equal(doc.getPageCount(), manifest.templates[id].pageCount);
  assert.equal(doc.catalog.has(PDFName.of('AcroForm')), false);
  let widgets = 0;
  for (const page of doc.getPages()) {
    const annotations = page.node.Annots();
    if (!annotations) continue;
    for (let index = 0; index < annotations.size(); index++) {
      const annotation = doc.context.lookup(annotations.get(index));
      if (annotation.get(PDFName.of('Subtype')) === PDFName.of('Widget')) widgets++;
    }
  }
  assert.equal(widgets, 0);
  const target = path.join(directory, `${id.toLowerCase()}-${label}.pdf`);
  fs.writeFileSync(target, bytes);
  return target;
}

(async () => {
  for (const id of Object.keys(manifest.templates)) {
    const output = await fillOfficialPrintPdf(original(id), template(id), {});
    await checkOutput(id, output, 'blank');
    console.log(`${id}: blank print passed (${manifest.templates[id].pageCount} pages, 0 widgets)`);
  }
  const i90 = {
    'form1[0].#subform[0].P1_Line3a_FamilyName[0]': 'EXAMPLE',
    'form1[0].#subform[0].P1_Line3b_GivenName[0]': 'ALEX',
    'form1[0].#subform[0].P1_Line2_AcctIdentifier[0]': '123456789012',
    'form1[0].#subform[0].#area[1].P1_Line1_AlienNumber[0]': '012345678',
    'form1[0].#subform[0].P1_Line6e_State[0]': 'NY',
    'form1[0].#subform[1].P1_Line8_male[0]': true,
    'form1[0].#subform[1].P1_Line9_DateOfBirth[0]': '01/02/1990',
    'form1[0].#subform[6].P8_Line3d_AdditionalInfo[0]': 'Synthetic engine test only.\nThis continuation verifies that a confirmed multiline answer remains legible inside the official additional-information box.',
  };
  const g1145 = {
    'form1[0].#subform[0].LastName[0]': 'EXAMPLE',
    'form1[0].#subform[0].FirstName[0]': 'ALEX',
    'form1[0].#subform[0].MiddleName[0]': '',
    'form1[0].#subform[0].Email[0]': 'alex@example.invalid',
    'form1[0].#subform[0].MobilePhoneNumber[0]': '2025550100',
  };
  const i485 = {
    'form1[0].#subform[0].Pt1Line1_FamilyName[0]': 'EXAMPLE',
    'form1[0].#subform[0].Pt1Line1_GivenName[0]': 'ALEX',
    'form1[0].#subform[1].Pt1Line10_State[0]': 'NY',
  };
  for (const [id, answers] of [['I-90', i90], ['G-1145', g1145], ['I-485', i485]]) {
    await checkOutput(id, await fillOfficialPrintPdf(original(id), template(id, Object.keys(answers)), answers), 'synthetic');
    console.log(`${id}: synthetic text, choices and appearances passed`);
  }
  const field = Object.keys(i90)[0];
  const approved = template('I-90', [field]);
  for (const [code, definition, answers] of [
    ['template', { ...approved, sha256: '0'.repeat(64) }, {}],
    ['unknown-field', approved, { 'unmapped': 'no' }],
    ['protected-field', { ...approved, fields: approved.fields.map(f => ({ ...f, approvedForPrint: false })) }, { [field]: 'EXAMPLE' }],
    ['overflow', approved, { [field]: 'EXAMPLE '.repeat(100) }],
    ['characters', approved, { [field]: '示例' }],
    ['value', approved, { [field]: true }],
  ]) {
    await assert.rejects(() => fillOfficialPrintPdf(original('I-90'), definition, answers), error => error.code === code);
    console.log(`Rejected ${code}`);
  }
  for (const name of [
    'form1[0].#subform[3].P5_Line6a_SignatureofApplicant[0]',
    'form1[0].#subform[3].P5_Line6b_DateofSignature[0]',
    'form1[0].#pageSet[0].Page1[0].PDF417BarCode1[0]',
  ]) {
    await assert.rejects(() => fillOfficialPrintPdf(original('I-90'), template('I-90', [name]), { [name]: 'EXAMPLE' }), error => error.code === 'protected-field');
  }
  console.log('Signature, signature date and barcode cannot be written even if accidentally approved');
  // Exercise the actual questionnaire mapper, not a second hand-written mapping.
  const fixturePath = path.join(directory, 'i-90-questionnaire-fixtures.json');
  const questionnaire = spawnSync(process.execPath, ['scripts/check-uscis-questionnaire.cjs'], {
    encoding: 'utf8', env: { ...process.env, USCIS_TEST_FIXTURE_OUTPUT: fixturePath },
  });
  assert.equal(questionnaire.status, 0, questionnaire.stderr || questionnaire.stdout);
  const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  for (const key of ['mapped', 'assistedMapped']) {
    const fixture = fixtures[key];
    await checkOutput('I-90', await fillOfficialPrintPdf(original('I-90'), fixture.definition, fixture.answers), `${key}-full`);
    console.log(`I-90 ${key}: actual questionnaire -> ${Object.keys(fixture.answers).length} mapped answers -> seven-page printable PDF`);
  }
  console.log(`Engine checks passed; synthetic output at ${directory}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
