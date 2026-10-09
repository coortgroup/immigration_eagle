const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const values = new Map();
let failNextWrite = false;
const storage = {
  async getItem(key) { return values.get(key) ?? null; },
  async setItem(key, value) {
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
  assert.equal(await api.loadDraft('I-130'),null);
  await api.saveDraft(draft('I-130'));
  assert.ok(await api.loadDraft('I-130'),'Queue must recover after failed writes');
  await assert.rejects(api.saveDraft({...draft('I-90'),checks:{test:'invalid'}}),/could not be saved/);
  const key = [...values.keys()][0];
  values.set(key,'not valid JSON');
  await assert.rejects(api.listDrafts(),/could not be read/);
  await assert.rejects(api.saveDraft(draft('I-90')),/could not be read/);
  assert.equal(values.get(key),'not valid JSON','Corrupt storage must not be overwritten silently');
  console.log('Draft storage: concurrent saves, per-form restore/removal, validation and storage failure recovery passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
