#!/usr/bin/env node
/* Editable PDF regressions. All entered values are synthetic. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { decodePDFRawStream, PDFDocument, PDFDict, PDFName, PDFString, StandardFonts } = require('pdf-lib');
const manifest = require('../data/uscis-print-templates.json');
const inventory = require('../data/uscis-form-inventory.json');

const moduleValue = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/freePdfEngine.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: moduleValue, exports: moduleValue.exports, require, Uint8Array, ArrayBuffer, console });
const { prepareFreePdf, saveFreePdf } = moduleValue.exports;
const outputDirectory = path.resolve('tmp/pdfs/free-editor-check');

function countAndCheckWidgets(doc) {
  const known = new Set(doc.getForm().getFields().flatMap(field => field.acroField.getWidgets().map(widget => widget.dict)));
  let total = 0;
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    for (let i = 0; annots && i < annots.size(); i++) {
      const annotation = doc.context.lookup(annots.get(i));
      if (annotation.get(PDFName.of('Subtype')) !== PDFName.of('Widget')) continue;
      assert.ok(known.has(annotation), 'Every page widget must remain in the canonical AcroForm tree');
      total++;
    }
  }
  return total;
}

function snapshots(doc, names) {
  return new Map(names.map(name => {
    const field = doc.getForm().getField(name);
    return [name, field.acroField.dict.toString() + field.acroField.getWidgets().map(widget => widget.dict.toString()).join('\n')];
  }));
}

async function verify(bytes, original, fields, expected, protectedSnapshots) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const form = doc.getForm();
  assert.equal(doc.getPageCount(), original.getPageCount());
  assert.equal(form.hasXFA(), false);
  assert.equal(form.getFields().length, original.getForm().getFields().length);
  assert.equal(countAndCheckWidgets(doc), countAndCheckWidgets(original));
  for (const descriptor of fields) assert.equal(form.getField(descriptor.name).isReadOnly(), false);
  const reopened = await prepareFreePdf(bytes, 'TEST');
  const current = new Map(reopened.fields.map(field => [field.name, field]));
  for (const [name, value] of Object.entries(expected)) {
    assert.equal(current.get(name).value, value, `Canonical saved value: ${name}`);
    const field = form.getField(name);
    for (const widget of field.acroField.getWidgets()) {
      const appearance = widget.getAppearances()?.normal;
      assert.ok(appearance, `Printable appearance: ${name}`);
      if (appearance instanceof PDFDict) {
        const state = widget.getAppearanceState();
        assert.ok(state && appearance.has(state), `The active widget state has an appearance: ${name}`);
        assert.equal(state === PDFName.of('Off'), value === false || value === '' ||
          (current.get(name).kind === 'radio' && widget.getOnValue() !== field.acroField.getValue()));
      }
      // /V may be inherited from a parent; never inspect /AP as a substitute.
      let cursor = widget.dict;
      while (cursor && !cursor.has(PDFName.of('V'))) cursor = cursor.lookupMaybe(PDFName.of('Parent'), PDFDict);
      const effectiveValue = cursor?.get(PDFName.of('V'));
      assert.equal(effectiveValue?.toString(), field.acroField.V()?.toString(), `Widget and canonical field value agree: ${name}`);
    }
  }
  assert.deepEqual(snapshots(doc, [...protectedSnapshots.keys()]), protectedSnapshots, 'Protected values, flags and appearances remain untouched');
  return doc;
}

async function rejects(code, bytes, fields, values) {
  await assert.rejects(() => saveFreePdf(bytes, fields, values), error => error.code === code);
}

(async () => {
  fs.mkdirSync(outputDirectory, { recursive: true });
  let editableFields = 0;
  let unlocked = 0;
  for (const [id, template] of Object.entries(manifest.templates)) {
    const source = fs.readFileSync(path.join('assets/uscis-print', template.filename));
    const original = await PDFDocument.load(source, { updateMetadata: false });
    const prepared = await prepareFreePdf(source, id);
    assert.equal(prepared.pages.length, template.pageCount);
    const available = new Set(prepared.fields.map(field => field.name));
    assert.equal(available.size, prepared.fields.length);
    const protectedNames = original.getForm().getFields().filter(field => !available.has(field.getName())).map(field => field.getName());
    const protection = snapshots(original, protectedNames);
    for (const field of inventory.forms[id].fields) {
      if (['signature', 'government', 'barcode'].includes(field.disposition) || /dateofsign/i.test(field.name) || /date of (?:requestor )?signature/i.test(field.label)) {
        assert.equal(available.has(field.name), false, `Protected ${id} ${field.name}`);
      }
    }
    for (const field of prepared.fields) {
      const metadata = inventory.forms[id].fields.find(item => item.name === field.name);
      assert.ok(metadata);
      assert.equal(field.label, metadata.label);
      for (const widget of field.widgets) {
        assert.ok(widget.page >= 1 && widget.page <= template.pageCount);
        assert.ok(widget.width > 0 && widget.height > 0);
      }
      if (original.getForm().getField(field.name).isReadOnly()) unlocked++;
    }
    const canWrite = field => field.kind === 'text' && (!field.maxLength || field.maxLength >= 6) && field.widgets.every(widget => widget.width >= 70 && widget.height >= 14);
    const first = prepared.fields.find(field => canWrite(field) && /FamilyName|LastName/.test(field.name)) || prepared.fields.find(canWrite);
    const last = [...prepared.fields].reverse().find(canWrite);
    assert.ok(first && last, `${id} has fillable text`);
    const values = { [first.name]: 'TEST', [last.name]: 'LAST' };
    const checkbox = prepared.fields.find(field => field.kind === 'checkbox');
    const choice = prepared.fields.find(field => field.kind === 'choice' && field.options.some(option => option && option.length <= 3));
    if (checkbox) values[checkbox.name] = true;
    if (choice) values[choice.name] = choice.options.includes('NY') ? 'NY' : choice.options.find(option => option && option.length <= 3);
    const saved = await saveFreePdf(prepared.bytes, prepared.fields, values);
    await verify(saved, original, prepared.fields, values, protection);
    const cleared = Object.fromEntries(Object.keys(values).map(name => [name, typeof values[name] === 'boolean' ? false : '']));
    await verify(await saveFreePdf(saved, prepared.fields, cleared), original, prepared.fields, cleared, protection);
    if (['I-90', 'I-485', 'G-1145'].includes(id)) fs.writeFileSync(path.join(outputDirectory, `${id.toLowerCase()}-editable.pdf`), saved);
    editableFields += prepared.fields.length;
    console.log(`${id}: ${prepared.fields.length} editable fields; save, late-page entry, clear, widgets and protection passed`);
  }
  assert.ok(unlocked > 100, 'Conditional and repeated fields become manually editable after XFA removal');

  // Independent fixture exercises types absent from USCIS sources (radio),
  // two widgets for one field, hostile descriptor changes, and fitting edges.
  const synthetic = await PDFDocument.create();
  const font = await synthetic.embedFont(StandardFonts.Helvetica);
  const page1 = synthetic.addPage([612, 792]);
  const page2 = synthetic.addPage([612, 792]);
  const form = synthetic.getForm();
  const text = form.createTextField('manual');
  text.acroField.dict.set(PDFName.of('TU'), PDFString.of('Manual entry'));
  text.addToPage(page1, { x: 50, y: 700, width: 220, height: 22, font });
  text.addToPage(page2, { x: 50, y: 700, width: 220, height: 22, font });
  text.enableReadOnly();
  const short = form.createTextField('short');
  short.setMaxLength(4);
  short.addToPage(page1, { x: 50, y: 650, width: 60, height: 22, font });
  const multiline = form.createTextField('multiline');
  multiline.enableMultiline();
  multiline.addToPage(page2, { x: 50, y: 570, width: 180, height: 90, font });
  const radio = form.createRadioGroup('radio');
  radio.addOptionToPage('A', page1, { x: 50, y: 550, width: 15, height: 15 });
  radio.addOptionToPage('B', page2, { x: 50, y: 550, width: 15, height: 15 });
  const checkbox = form.createCheckBox('checkbox');
  checkbox.addToPage(page2, { x: 50, y: 500, width: 15, height: 15 });
  const choice = form.createDropdown('choice');
  choice.setOptions(['NY', 'CA']);
  choice.addToPage(page2, { x: 50, y: 450, width: 60, height: 22, font });
  const signature = form.createTextField('Signature');
  signature.addToPage(page1, { x: 50, y: 400, width: 220, height: 22, font });
  signature.enableReadOnly();
  const originalBytes = await synthetic.save();
  const original = await PDFDocument.load(originalBytes);
  const prepared = await prepareFreePdf(originalBytes, 'SYNTHETIC');
  assert.equal(prepared.fields.find(field => field.name === 'manual').widgets.length, 2);
  assert.deepEqual(Array.from(prepared.fields.find(field => field.name === 'radio').widgets, widget => widget.option), ['A', 'B']);
  const protection = snapshots(original, ['Signature']);
  const values = { manual: 'SYNTHETIC EXAMPLE', short: '1234', multiline: 'First line\nSecond line', radio: 'B', checkbox: true, choice: 'NY' };
  const saved = await saveFreePdf(prepared.bytes, prepared.fields, values);
  const savedDoc = await verify(saved, original, prepared.fields, values, protection);
  const resources = savedDoc.getForm().acroForm.dict.lookup(PDFName.of('DR'), PDFDict).lookup(PDFName.of('Font'), PDFDict);
  assert.ok(resources.has(PDFName.of('FreeFormHelvetica')), 'Future edits can resolve the saved font');
  const updated = { ...values, manual: 'LATEST', multiline: '', radio: 'A', checkbox: false, choice: 'CA' };
  const updatedBytes = await saveFreePdf(saved, prepared.fields, updated);
  const updatedDoc = await verify(updatedBytes, original, prepared.fields, updated, protection);
  const appearanceText = widget => Buffer.from(decodePDFRawStream(widget.getAppearances().normal).decode()).toString('latin1');
  for (const widget of updatedDoc.getForm().getTextField('manual').acroField.getWidgets()) {
    assert.ok(appearanceText(widget).includes('<4C4154455354>'), 'Every printable appearance contains the latest text, LATEST');
    assert.equal(appearanceText(widget).includes('<53594E544845544943204558414D504C45>'), false, 'Old text is removed from the printable appearance');
  }
  const clearedDoc = await verify(await saveFreePdf(updatedBytes, prepared.fields, { radio: '', choice: '', manual: '' }), original, prepared.fields, { radio: '', choice: '', manual: '' }, protection);
  for (const widget of clearedDoc.getForm().getTextField('manual').acroField.getWidgets()) {
    assert.equal(appearanceText(widget).includes('<4C4154455354>'), false, 'Clearing removes the latest text from every printable appearance');
  }
  await rejects('unknown-field', prepared.bytes, prepared.fields, { absent: 'x' });
  await rejects('protected-field', prepared.bytes, prepared.fields, { Signature: 'x' });
  await rejects('protected-field', prepared.bytes, [...prepared.fields, { ...prepared.fields[0], name: 'Signature' }], { Signature: 'x' });
  await rejects('value', prepared.bytes, prepared.fields, { manual: true });
  await rejects('value', prepared.bytes, prepared.fields, { checkbox: 'true' });
  await rejects('value', prepared.bytes, prepared.fields, { choice: 'XX' });
  await rejects('value', prepared.bytes, prepared.fields, { radio: 'XX' });
  await rejects('overflow', prepared.bytes, prepared.fields.map(field => ({ ...field, maxLength: 99999 })), { short: '12345' });
  await rejects('overflow', prepared.bytes, prepared.fields, { manual: 'W'.repeat(100) });
  await rejects('overflow', prepared.bytes, prepared.fields, { manual: 'one\ntwo' });
  await rejects('overflow', prepared.bytes, prepared.fields, { multiline: 'Line\n'.repeat(100) });
  await rejects('characters', prepared.bytes, prepared.fields, { manual: '示例' });
  await rejects('characters', prepared.bytes, prepared.fields, { manual: 'hidden\u0000value' });
  await rejects('characters', prepared.bytes, prepared.fields, { manual: 'tab\tvalue' });
  console.log(`Passed 21 official templates (${editableFields} editable fields, ${unlocked} unlocked), repeated editing, independent radio/multiple-widget cases, and validation failures.`);
  console.log(`Synthetic completed official PDFs: ${outputDirectory}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
