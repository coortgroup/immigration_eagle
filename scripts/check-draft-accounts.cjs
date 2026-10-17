#!/usr/bin/env node
// Exercise real draft storage across account boundaries, queued writes and migration failures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const KEY = 'immigration-eagle.preparation-drafts.v1';
const accountKey = id => `${KEY}.owner.${id}`;
const source = ts.transpileModule(fs.readFileSync('src/draftStorage.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
function host() {
  const values = new Map();
  const events = [];
  let beforeWrite;
  let beforeRemove;
  const storage = {
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) {
      events.push(['write', key]);
      if (beforeWrite) await beforeWrite(key, value);
      values.set(key, value);
    },
    async removeItem(key) {
      events.push(['remove', key]);
      if (beforeRemove) await beforeRemove(key);
      values.delete(key);
    },
  };
  const moduleRef = { exports: {} };
  vm.runInNewContext(source, {
    module: moduleRef, exports: moduleRef.exports,
    require(name) { if (name === '@react-native-async-storage/async-storage') return storage; throw new Error(name); },
  });
  return {
    api: moduleRef.exports, values, events,
    onWrite(fn) { beforeWrite = fn; }, onRemove(fn) { beforeRemove = fn; },
  };
}
const draft = (formId = 'I-90', name = 'Guest answer', updatedAt = '2026-10-11T12:00:00Z') => ({
  version: 1, formId, title: 'Sample form', answered: 1, total: 3, updatedAt,
  mode: 'ai', stage: 'interview', answers: { full_name: name }, checks: { citizen: 'yes' },
});
const tick = () => new Promise(setImmediate);
const names = drafts => Array.from(drafts, item => item.answers.full_name).sort();

(async () => {
  {
    const { api, values } = host();
    await api.saveDraft(draft());
    await api.setDraftOwner('user-A');
    assert.equal((await api.listDrafts()).length, 0, 'Ordinary sign-in must not claim guest drafts');
    await api.setDraftOwner(null);
    assert.deepEqual(names(await api.listDrafts()), ['Guest answer']);
    await api.setDraftOwner('user-A', { claimGuest: true });
    assert.deepEqual(names(await api.listDrafts()), ['Guest answer']);
    assert.equal(values.has(KEY), false, 'Successful association removes the migrated guest store');
    await api.setDraftOwner(null);
    assert.equal((await api.listDrafts()).length, 0, 'Signing out must not expose the signed account');
    await api.setDraftOwner('user-B', { claimGuest: true });
    assert.equal((await api.listDrafts()).length, 0, 'Another account cannot inherit the first account drafts');
    await api.saveDraft(draft('N-400', 'Account B answer'));
    await api.setDraftOwner('user-A', { claimGuest: true });
    assert.deepEqual(names(await api.listDrafts()), ['Guest answer'], 'Signed-to-signed switches never import the source account');
    await api.setDraftOwner('user-B');
    assert.deepEqual(names(await api.listDrafts()), ['Account B answer']);
  }
  {
    const { api } = host();
    await api.setDraftOwner('A');
    await api.saveDraft(draft('I-90', 'Newer account', '2026-10-11T14:00:00Z'));
    await api.saveDraft(draft('I-130', 'Older account', '2026-10-11T10:00:00Z'));
    await api.saveDraft(draft('N-400', 'Account only'));
    await api.setDraftOwner(null);
    await api.saveDraft(draft('I-90', 'Older guest'));
    await api.saveDraft(draft('I-130', 'Newer guest'));
    await api.saveDraft(draft('I-765', 'Guest only'));
    await api.setDraftOwner('A', { claimGuest: true });
    assert.deepEqual(names(await api.listDrafts()), ['Account only', 'Guest only', 'Newer account', 'Newer guest'], 'Merge keeps the newest date for each form and preserves distinct forms');
  }
  {
    const app = host();
    const { api } = app;
    await api.setDraftOwner('A');
    let release;
    app.onWrite(() => new Promise(resolve => { release = resolve; }));
    const saving = api.saveDraft(draft('I-90', 'Queued A answer'));
    await tick();
    let switched = false;
    const switching = api.setDraftOwner('B').then(() => { switched = true; });
    const oldRead = api.listDrafts();
    await tick();
    assert.equal(switched, false, 'Account switching waits for earlier writes');
    app.onWrite(undefined); release();
    await Promise.all([saving, switching]);
    assert.deepEqual(names(await oldRead), ['Queued A answer'], 'A read requested before switching stays scoped to its original owner');
    assert.equal((await api.listDrafts()).length, 0, 'Queued A writes cannot populate B');
    assert.ok(app.values.has(accountKey('A')));
    assert.equal(app.values.has(accountKey('B')), false);
  }
  {
    const app = host();
    const { api } = app;
    await api.setDraftOwner('A');
    const saveFromOldEditor = next => api.saveDraft(next, 'A');
    await saveFromOldEditor(draft('I-90', 'Original A answer'));
    await api.setDraftOwner('B');
    await api.saveDraft(draft('I-90', 'Current B answer'));
    await saveFromOldEditor(draft('I-90', 'Late A PDF message'));
    assert.deepEqual(names(await api.listDrafts()), ['Current B answer'], 'An old editor callback after a completed switch cannot overwrite B');
    assert.deepEqual(names(JSON.parse(app.values.get(accountKey('A')))), ['Late A PDF message'], 'The callback must still save into its mounted owner A');
    await api.saveDraft(draft('N-400', 'Late guest message'), null);
    assert.deepEqual(names(await api.listDrafts()), ['Current B answer'], 'Explicit guest ownership must not fall back to the signed-in owner');
    assert.deepEqual(names(JSON.parse(app.values.get(KEY))), ['Late guest message']);
    app.onWrite(key => { if (key === accountKey('A')) throw new Error('Old editor save failed'); });
    await assert.rejects(saveFromOldEditor(draft('I-90', 'Unsaved A message')), /Old editor save failed/);
    await api.waitForDraftSaves();
    assert.equal((await api.loadDraft('I-90')).answers.full_name, 'Current B answer', 'A late failure from A must not block B');
    await api.setDraftOwner('A');
    await assert.rejects(api.loadDraft('I-90'), /Keep this screen open/, 'The failed save remains associated with A');
    app.onWrite(undefined);
    await saveFromOldEditor(draft('I-90', 'Retried A message'));
    assert.equal((await api.loadDraft('I-90')).answers.full_name, 'Retried A message');
  }
  {
    const app = host();
    const { api } = app;
    await api.setDraftOwner('A');
    const switching = api.setDraftOwner('B');
    const blocked = assert.rejects(switching, /Keep this screen open/);
    const lateSave = api.saveDraft(draft('I-90', 'Late A answer'));
    await Promise.all([blocked, lateSave]);
    assert.deepEqual(names(await api.listDrafts()), ['Late A answer'], 'A late old-screen write stays in A and invalidates the pending transition');
    await api.waitForDraftSaves();
    await api.setDraftOwner('B');
    assert.equal((await api.listDrafts()).length, 0);
  }
  {
    const app = host();
    const { api } = app;
    await api.setDraftOwner('A');
    await api.saveDraft(draft('I-90', 'Safe answer'));
    app.onWrite(() => { throw new Error('Storage unavailable'); });
    await assert.rejects(api.saveDraft(draft('I-90', 'Unsaved answer')), /Storage unavailable/);
    await assert.rejects(api.waitForDraftSaves(), /Keep this screen open/);
    await assert.rejects(api.setDraftOwner(null), /Keep this screen open/, 'Sign-out must preserve an unsaved editor');
    await assert.rejects(api.setDraftOwner('B'), /Keep this screen open/);
    assert.deepEqual(names(await api.listDrafts()), ['Safe answer'], 'A failed transition keeps the original owner');
    app.onWrite(undefined);
    await api.saveDraft(draft('I-90', 'Retried answer'));
    await api.waitForDraftSaves();
    await api.setDraftOwner('B');
    await api.waitForDraftSaves();
    assert.equal((await api.listDrafts()).length, 0, 'Recovered A errors must not contaminate B');
  }
  for (const phase of ['write', 'remove']) {
    const app = host();
    const { api, values, events } = app;
    await api.saveDraft(draft('I-90', 'Preserved guest'));
    if (phase === 'write') app.onWrite(key => { if (key === accountKey('A')) throw new Error('Claim write failed'); });
    else app.onRemove(() => { throw new Error('Claim remove failed'); });
    await assert.rejects(api.setDraftOwner('A', { claimGuest: true }), /Claim .* failed/);
    assert.deepEqual(names(await api.listDrafts()), ['Preserved guest'], 'Failed claims keep the guest owner and source data');
    assert.ok(values.has(KEY));
    if (phase === 'write') assert.ok(!events.some(event => event[0] === 'remove'), 'Never delete guest drafts before the target is written');
    else assert.deepEqual(names(JSON.parse(values.get(accountKey('A')))), ['Preserved guest'], 'A removal failure retains the destination backup');
    app.onWrite(undefined); app.onRemove(undefined);
    await api.setDraftOwner('A', { claimGuest: true });
    assert.equal((await api.listDrafts()).length, 1, 'Retrying a partially completed claim must not duplicate drafts');
    assert.equal(values.has(KEY), false);
  }
  {
    const app = host();
    const { api, values } = app;
    await api.saveDraft(draft('I-90', 'Before association'));
    let lateSave;
    app.onRemove(() => { lateSave = api.saveDraft(draft('I-90', 'Changed during association')); });
    await assert.rejects(api.setDraftOwner('A', { claimGuest: true }), /Keep this screen open/);
    await lateSave;
    assert.deepEqual(names(await api.listDrafts()), ['Changed during association'], 'A guest edit arriving during removal cancels the transition without losing the source');
    assert.ok(values.has(KEY));
    assert.deepEqual(names(JSON.parse(values.get(accountKey('A')))), ['Before association']);
  }
  {
    const { api } = host();
    for (const invalid of ['', '../other', 'a.b', 'a_b', ' space ', 'x'.repeat(129), undefined]) {
      await assert.rejects(api.setDraftOwner(invalid), /account could not be opened/);
      if (invalid !== undefined) await assert.rejects(api.saveDraft(draft(), invalid), /account could not be opened/);
    }
    await api.setDraftOwner('12345678-1234-1234-1234-123456789abc');
    await api.setDraftOwner(null);
  }
  console.log('Draft accounts: explicit guest claims, newest-draft merge, account isolation, queued and stale-editor writes, save-failure guards, retry and owner validation passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
