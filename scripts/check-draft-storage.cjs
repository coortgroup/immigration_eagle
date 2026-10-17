const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const values = new Map();
let failNextWrite = false;
let nextWriteGate;
const storage = {
  async getItem(key) { return values.get(key) ?? null; },
  async setItem(key, value) {
    if (nextWriteGate) { const gate = nextWriteGate; nextWriteGate = undefined; await gate; }
    if (failNextWrite) { failNextWrite = false; throw new Error('Storage unavailable'); }
    values.set(key, value);
  },
};
const moduleRef = { exports: {} };
const compiled = ts.transpileModule(fs.readFileSync('src/draftStorage.ts','utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
vm.runInNewContext(compiled, {
  module:moduleRef, exports:moduleRef.exports,
  require(name) { if (name === '@react-native-async-storage/async-storage') return storage; throw new Error(name); },
});
const api = moduleRef.exports;
const draft = (formId) => ({version:1,formId,title:'Sample form',answered:1,total:3,updatedAt:'2026-10-09T12:00:00.000Z',answers:{full_name:'Sample Tester'},checks:{citizen:'yes'}});

(async()=>{
  assert.equal((await api.listDrafts()).length,0);
  await Promise.all([api.saveDraft(draft('I-129F')),api.saveDraft(draft('N-400'))]);
  assert.equal((await api.listDrafts()).length,2,'Parallel saves must preserve both forms');
  await api.saveDraft({...draft('I-129F'),answers:{full_name:'Updated Sample'}});
  assert.equal((await api.loadDraft('I-129F')).answers.full_name,'Updated Sample');
  assert.equal((await api.listDrafts()).length,2,'Updating one form must not duplicate it');
  await api.deleteDraft('I-129F');
  assert.equal(await api.loadDraft('I-129F'),null);
  assert.ok(await api.loadDraft('N-400'),'Removing one draft must preserve another');
  failNextWrite=true;
  await assert.rejects(api.saveDraft(draft('I-130')),/Storage unavailable/);
  await assert.rejects(api.loadDraft('I-130'),/Keep this screen open/,'Restore must not replace unsaved answers after a failed save');
  assert.ok(!(await api.listDrafts()).some(item=>item.formId==='I-130'),'Safely stored drafts remain listable after a failed save');
  await api.saveDraft(draft('I-130'));
  assert.ok(await api.loadDraft('I-130'),'Queue must recover after failed writes');
  await api.saveDraft({...draft('I-90'), mode:'self', stage:'check', answered:1, answers:{}, checks:{replacement:'yes'}});
  assert.equal((await api.loadDraft('I-90')).answered,1,'A single eligibility answer is enough to save a draft');
  assert.equal((await api.loadDraft('N-400')).mode,undefined,'Legacy version 1 drafts must load without migration');
  const fullDraft = {...draft('I-90'), mode:'ai', stage:'fullPreparation', completedFieldIds:['middle_name'],
    fullAnswers:{family_name:'Tester',reason:['renewal'],middle_name:''}, completedQuestionIds:['name']};
  await api.saveDraft(fullDraft);
  assert.equal(JSON.stringify(await api.loadDraft('I-90')),JSON.stringify(fullDraft),'Full answers and completed optional questions must survive restore');
  const pdfDraft = {...draft('I-765'), mode:'self', stage:'freePreparation',
    pdfValues:{'form1[0].name[0]':'Sample Tester',is_married:false,consent:true},pdfPage:4};
  await api.saveDraft(pdfDraft);
  assert.equal(JSON.stringify(await api.loadDraft('I-765')),JSON.stringify(pdfDraft),'PDF entries, false checkboxes and current page must survive restore');
  for (const attorneyStatus of ['awaiting_call','preparing_documents','sent']) {
    const attorney = {...draft('I-130'),mode:'attorney',stage:'attorney',attorneyStatus,
      attorneyDetails:{name:'Sample Tester',email:'tester@example.test',phone:'123',note:'Please call'}};
    await api.saveDraft(attorney);
    assert.equal(JSON.stringify(await api.loadDraft('I-130')),JSON.stringify(attorney),'Attorney details and status must survive restore');
  }
  await assert.rejects(api.saveDraft({...draft('I-90'),checks:{test:'invalid'}}),/could not be saved/);
  await assert.rejects(api.saveDraft(null),/could not be saved/);
  for (const invalid of [
    {mode:'other'}, {stage:'unknown'}, {attorneyStatus:'submitted'}, {answers:[]},
    {fullAnswers:{name:42}}, {fullAnswers:{choices:['valid',false]}}, {fullAnswers:{name:'x'.repeat(20001)}},
    {fullAnswers:{choices:Array(101).fill('option')}}, {completedQuestionIds:['name','name']},
    {completedQuestionIds:[23]}, {completedFieldIds:['__proto__']}, {pdfValues:{nested:{value:'x'}}},
    {pdfPage:0}, {pdfPage:1.5}, {pdfPage:1001}, {attorneyDetails:{name:'Missing other fields'}},
    {fullAnswers:JSON.parse('{"__proto__":"unsafe"}')},
  ]) await assert.rejects(api.saveDraft({...draft('I-90'),...invalid}),/could not be saved/);
  assert.equal((await api.listDrafts()).find(item=>item.formId==='I-90').mode,'ai','Invalid progress must not replace the last saved draft');
  await api.saveDraft(fullDraft);

  // Continue can be pressed before the failed-save UI has had a chance to render.
  let rejectWrite;
  nextWriteGate = new Promise((resolve,reject)=>{rejectWrite=reject;});
  const newer = {...fullDraft,fullAnswers:{family_name:'Unsaved latest answer'}};
  const saving = api.saveDraft(newer);
  const failedSave = assert.rejects(saving,/Deferred write failure/);
  const restoring = api.loadDraft('I-90');
  const blockedRestore = assert.rejects(restoring,/Keep this screen open/,'An in-flight failing save must cancel an already-requested restore');
  rejectWrite(new Error('Deferred write failure'));
  await Promise.all([failedSave,blockedRestore]);
  assert.equal((await api.listDrafts()).find(item=>item.formId==='I-90').fullAnswers.family_name,'Tester');
  await api.saveDraft(newer);
  assert.equal((await api.loadDraft('I-90')).fullAnswers.family_name,'Unsaved latest answer','Successful retry must release the restore guard');

  failNextWrite=true;
  await assert.rejects(api.saveDraft({...newer,fullAnswers:{family_name:'Deleted unsaved answer'}}),/Storage unavailable/);
  await api.deleteDraft('I-90');
  assert.equal(await api.loadDraft('I-90'),null,'Intentional deletion must release a failed draft rather than blocking restores forever');
  assert.ok(await api.loadDraft('N-400'),'Other forms must remain restorable after intentional deletion');

  // A delete already in progress cannot clear the outcome of a later edit.
  let releaseDelete;
  nextWriteGate = new Promise(resolve=>{releaseDelete=resolve;});
  const removing = api.deleteDraft('I-90');
  await new Promise(setImmediate);
  const laterInvalidSave = api.saveDraft({...newer,pdfPage:0});
  await assert.rejects(laterInvalidSave,/could not be saved/);
  releaseDelete(); await removing;
  await assert.rejects(api.loadDraft('N-400'),/Keep this screen open/,'Deleting an older snapshot must not clear a newer unsaved change');
  await api.saveDraft(newer);
  assert.ok(await api.loadDraft('N-400'));
  const key = [...values.keys()][0];
  values.set(key,'not valid JSON');
  await assert.rejects(api.listDrafts(),/could not be read/);
  await assert.rejects(api.saveDraft(draft('I-90')),/could not be read/);
  assert.equal(values.get(key),'not valid JSON','Corrupt storage must not be overwritten silently');
  console.log('Draft storage: legacy/one-answer drafts, full/PDF progress, attorney stages, validation, concurrent saves, in-flight failure restore protection and retry/delete recovery passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
