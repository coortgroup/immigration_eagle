#!/usr/bin/env node
/* Coverage and source fidelity of the pinned, field-by-field guided forms.
 * These checks do not assert eligibility or completeness of a filing package.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const manifest = require('../data/uscis-print-templates.json');
const inventory = require('../data/uscis-form-inventory.json');
const definitions = require('../data/uscis-guided-questionnaires.json').forms;
const m = {exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/freePdfEngine.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,require,Uint8Array,ArrayBuffer,console});
const {prepareFreePdf}=m.exports;
const flatten = id => definitions[id].sections.flatMap(section=>section.fields);
const field = (id, shortName, page) => flatten(id).find(q => (!page || q.source.page===page) && q.pdfFields.some(p=>p.name.split('.').at(-1).replace(/\[\d+\]$/,'')===shortName));
const refs = c => !c?[]:'all'in c?c.all.flatMap(refs):[c];
(async()=>{
  assert.deepEqual(Object.keys(definitions).sort(),Object.keys(manifest.templates).sort());
  let total=0;
  for(const [id,definition]of Object.entries(definitions)) {
    const template=manifest.templates[id], bytes=fs.readFileSync(path.join('assets/uscis-print',template.filename));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),definition.templateSha256,`${id}: immutable template`);
    assert.equal(definition.originalSha256,template.originalSha256);
    assert.equal(definition.edition,inventory.forms[id].edition);
    assert.equal(definition.pageCount,template.pageCount);
    for(const key of ['pdfUrl','sourceUrl','instructionsUrl'])assert.match(definition[key],/^https:\/\/www\.uscis\.gov\//);
    const prepared=await prepareFreePdf(bytes,id), actual=new Map(prepared.fields.map(f=>[f.name,f]));
    const official=new Map(inventory.forms[id].fields.map(f=>[f.name,f]));
    const questions=flatten(id), mapped=questions.flatMap(q=>q.pdfFields.map(m=>m.name));
    assert.equal(new Set(mapped).size,mapped.length,`${id}: no duplicate mappings`);
    assert.deepEqual([...mapped].sort(),[...actual.keys()].sort(),`${id}: every editable official field exactly once`);
    assert.equal(definition.coverage.mappedFields,mapped.length);
    assert.equal(definition.coverage.editableFields,prepared.fields.length);
    assert.equal(definition.coverage.officialFields,official.size);
    assert.equal(new Set(questions.map(q=>q.id)).size,questions.length);
    const excluded=definition.excluded.map(f=>f.name);
    assert.equal(new Set(excluded).size,excluded.length);
    assert.deepEqual([...mapped,...excluded].sort(),[...official.keys()].sort(),`${id}: editable + excluded exhaustive`);
    const seen=new Set();
    for(const q of questions) {
      assert.ok(q.label&&q.label.trim());
      assert.doesNotMatch(q.label,/(?:form1\[|#subform|TextField\d|\[\d+\])/,'No raw code identifiers as prompts');
      assert.ok(q.source.page>=1&&q.source.page<=template.pageCount);
      assert.ok(q.source.officialLabel);
      for(const c of refs(q.when)) {
        assert.ok(seen.has(c.field),`${id}: source condition must follow its controlling question (${q.id})`);
        const control=questions.find(f=>f.id===c.field);
        for(const value of c.oneOf||[c.equals||c.includes])assert.ok(control.options.some(o=>o.value===value),`${id}: conditional option exists`);
      }
      seen.add(q.id);
      if(q.options) {
        assert.equal(new Set(q.options.map(o=>o.value)).size,q.options.length,`${id}: unique option keys`);
        assert.equal(new Set(q.options.map(o=>o.label)).size,q.options.length,`${id}: distinguishable option labels`);
        assert.ok(q.options.every(o=>o.label&&o.value));
      }
      for(const map of q.pdfFields) {
        const pdf=actual.get(map.name), meta=official.get(map.name);
        assert.ok(pdf,`${id}: only permitted fields can be mapped`);
        if(map.option!==undefined) {
          assert.equal(pdf.kind,'checkbox');
          assert.ok(q.options.some(o=>o.value===map.option));
          assert.ok(meta.exportStates.includes(map.exportValue),`${id}: exact checkbox export state`);
          assert.ok(['radio','multiselect'].includes(q.kind));
        }else if(pdf.kind==='choice'||pdf.kind==='radio') {
          assert.deepEqual(q.options.map(o=>o.value),[...new Set(pdf.options.filter(o=>o.trim()))],`${id}: exact native choice values incl. spaces`);
        }else if(pdf.kind==='text') {
          assert.equal(q.maxLength,pdf.maxLength,`${id}: preserve character limits`);
          assert.equal(q.kind,pdf.multiline?'textarea':'text');
        }
      }
    }
    for(const signature of definition.signing)for(const name of signature.blankPdfFields)assert.ok(excluded.includes(name),`${id}: signatures never mapped`);
    total+=mapped.length;
    console.log(`${id}: ${mapped.length} editable fields fully mapped, ${excluded.length} protected/non-input fields excluded`);
  }
  // Regressions for misleading/stale tooltips and checkbox groups in official PDFs.
  const arrival=field('I-485','Pt2Line11_CB');
  assert.match(arrival.label,/When I last arrived/);
  assert.equal(arrival.kind,'radio');
  assert.deepEqual(arrival.options.map(o=>o.label),[
    'I was inspected at a Port of Entry and admitted as (for example, exchange visitor, visitor, temporary worker, student).',
    'I was inspected at a Port of Entry and paroled as (for example, humanitarian parole, Cuban parole).',
    'I came into the United States without admission or parole.', 'Other (explain).',
  ]);
  assert.match(field('N-400','P10_Line3_HouseHoldSize').label,/household size/);
  assert.match(field('N-400','P11_Line1_TotalChildren',11).label,/household members earning/);
  assert.match(field('I-864A','P5_SponsorName').label,/SPONSOR/);
  for(const name of ['Pt1Line3_Yes','Pt1Line4_Yes','Pt2Line11_Yes','Pt2Line36_Yes']) {
    const q=field('I-130',name); assert.equal(q.kind,'radio');assert.deepEqual(q.options.map(o=>o.label),['Yes','No']);
  }
  assert.notEqual(field('I-130','Pt1Line1_Spouse').id,field('I-130','Pt1Line2_InWedlock').id,'I130 relationship questions must remain independent');
  assert.equal(field('I-131','CB_AppType').pdfFields.length,37,'One mutually exclusive application-type group across four pages');
  assert.equal(field('I-485','Pt2Line3a_CB').id,field('I-485','Pt2Line3f_CB').id,'One filing-category group across three pages');
  assert.equal(field('N-565','Pt3CheckBox2a').kind,'multiselect','Replacement reasons allow multiple choices');
  assert.equal(field('I-751','Pt3Line1c').kind,'multiselect','Waiver reasons allow multiple choices');
  assert.deepEqual(field('I-751','Pt3Line1').when,{field:'filing-basis',equals:'joint'});
  assert.deepEqual(field('I-751','Pt3Line1c').when,{field:'filing-basis',equals:'waiver'});
  console.log(`Guided schema passed: ${Object.keys(definitions).length} pinned forms, ${total} editable fields, exact options/protection/branch references.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
