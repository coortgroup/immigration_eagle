#!/usr/bin/env node
// Account storage contracts use only synthetic strings and in-memory stores.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync('src/accountStorage.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const settle = () => new Promise(setImmediate);
const plain = value => JSON.parse(JSON.stringify(value));

function host(os) {
  const secure = new Map(), web = new Map(), calls = [];
  let nextId = 0, intercept = async () => {};
  const access = 6;
  const module = { exports: {} };
  function storeApi(map, kind) {
    const action = async (method, key, value, options) => {
      calls.push({ kind, method, key });
      if (kind === 'secure') {
        assert.deepEqual(plain(options), { keychainAccessible: access });
        assert.match(key, /^[\w.-]+$/);
      }
      await intercept({ kind, method, key, value });
      if (method === 'get') return map.get(key) ?? null;
      if (method === 'set') { map.set(key, kind === 'secure' ? Buffer.from(value, 'utf8').toString('utf8') : value); return; }
      map.delete(key);
    };
    return {
      getItem: key => action('get', key), setItem: (key, value) => action('set', key, value), removeItem: key => action('remove', key),
      getItemAsync: (key, options) => action('get', key, undefined, options),
      setItemAsync: (key, value, options) => action('set', key, value, options),
      deleteItemAsync: (key, options) => action('remove', key, undefined, options),
    };
  }
  vm.runInNewContext(source, { module, exports: module.exports, require(name) {
    if (name === '@react-native-async-storage/async-storage') return storeApi(web, 'web');
    if (name === 'react-native') return { Platform: { OS: os } };
    if (name === 'expo-secure-store') return { ...storeApi(secure, 'secure'), WHEN_UNLOCKED_THIS_DEVICE_ONLY: access };
    if (name === 'expo-crypto') return { getRandomBytes: count => new Uint8Array(count).fill(123), randomUUID: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}` };
    throw new Error(name);
  } });
  return { ...module.exports, secure, web, calls, intercept: callback => { intercept = callback; } };
}
const key = 'sb-example-auth-token';
const base = `fillout.auth.${key}`;
const currentManifest = app => JSON.parse(app.secure.get(base));
const chunksFor = (app, manifest) => [...app.secure.keys()].filter(key => key.includes(`.${manifest.generation}.`));

(async () => {
  for (const os of ['ios', 'android']) {
    const app = host(os);
    assert.equal(await app.accountStorage.getItem(key), null);
    const initial = 'Synthetic profile text: '.repeat(70);
    await app.accountStorage.setItem(key, initial);
    const first = currentManifest(app);
    assert.ok(first.count > 1);
    assert.equal(await app.accountStorage.getItem(key), initial);
    assert.equal(app.web.size, 0, 'Native sessions must never enter AsyncStorage');
    assert.equal(chunksFor(app, first).length, first.count);
    for (const chunk of chunksFor(app, first)) assert.ok(Buffer.byteLength(app.secure.get(chunk), 'utf8') < 2048);

    let release;
    app.intercept(async call => {
      if (call.method === 'set' && call.key.endsWith('.1')) await new Promise(resolve => { release = resolve; });
    });
    const updated = 'SYNTHETIC NEW VALUE '.repeat(100);
    const writing = app.accountStorage.setItem(key, updated);
    await settle();
    assert.deepEqual(currentManifest(app), first, 'Incomplete chunks must not replace the committed generation');
    let readCompleted = false;
    const reading = app.accountStorage.getItem(key).then(value => { readCompleted = true; return value; });
    await settle();
    assert.equal(readCompleted, false, 'Concurrent reads wait for the complete queued write');
    release(); await writing;
    assert.equal(await reading, updated);
    const second = currentManifest(app);
    assert.notEqual(second.generation, first.generation);
    assert.equal(chunksFor(app, first).length, 0, 'A committed generation removes its obsolete chunks');

    for (const failure of ['chunk', 'manifest']) {
      app.intercept(async call => {
        if (call.method === 'set' && (failure === 'chunk' ? call.key.endsWith('.1') : call.key === base)) throw new Error('Synthetic write failure');
      });
      await assert.rejects(app.accountStorage.setItem(key, initial), /Synthetic write failure/);
      assert.deepEqual(currentManifest(app), second, `${failure}: preserve the last committed generation`);
      app.intercept(async () => {});
      assert.equal(await app.accountStorage.getItem(key), updated);
      assert.equal(app.secure.size, second.count + 1, 'A failed generation must clean up partial chunks');
    }

    app.intercept(async call => { if (call.method === 'get') throw new Error('Synthetic read failure'); });
    await assert.rejects(app.accountStorage.getItem(key), /Synthetic read failure/);
    app.intercept(async () => {});
    const firstChunk = `${base}.${second.generation}.0`;
    const chunkValue = app.secure.get(firstChunk); app.secure.delete(firstChunk);
    await assert.rejects(app.accountStorage.getItem(key), /could not be read/);
    app.secure.set(firstChunk, chunkValue);
    const committed = app.secure.get(base);
    for (const bad of ['{', '{}', '{"generation":"invalid","count":1}', JSON.stringify({ generation: second.generation, count: 129 })]) {
      app.secure.set(base, bad);
      await assert.rejects(app.accountStorage.getItem(key));
    }
    app.secure.set(base, committed);
    await assert.rejects(app.accountStorage.setItem(key, 'X'.repeat(51_201)), /too large/);
    assert.equal(await app.accountStorage.getItem(key), updated);

    app.intercept(async call => { if (call.method === 'remove' && call.key === base) throw new Error('Synthetic deletion failure'); });
    await assert.rejects(app.accountStorage.removeItem(key), /Synthetic deletion failure/);
    app.intercept(async () => {});
    assert.equal(await app.accountStorage.getItem(key), updated, 'Failed manifest deletion must not erase the session');
    await app.accountStorage.removeItem(key);
    assert.equal(await app.accountStorage.getItem(key), null);
    assert.equal(app.secure.size, 0);
    await app.accountStorage.removeItem(key);
    await app.accountStorage.setItem(key, '');
    assert.equal(await app.accountStorage.getItem(key), '');
    const unicode = 'A' + '🦅'.repeat(450) + ' Сохранённый профиль';
    await app.accountStorage.setItem(key, unicode);
    assert.equal(await app.accountStorage.getItem(key), unicode, 'Native UTF-8 chunks must not split Unicode surrogate pairs');
  }

  const web = host('web');
  await web.accountStorage.setItem(key, 'SYNTHETIC WEB SESSION');
  assert.equal(await web.accountStorage.getItem(key), 'SYNTHETIC WEB SESSION');
  assert.equal(web.web.get(key), 'SYNTHETIC WEB SESSION');
  assert.equal(web.secure.size, 0);
  await web.accountStorage.removeItem(key);
  assert.equal(await web.accountStorage.getItem(key), null);
  web.intercept(async () => { throw new Error('Synthetic browser storage failure'); });
  await assert.rejects(web.accountStorage.setItem(key, 'SAMPLE'), /browser storage failure/);
  await assert.rejects(web.accountStorage.getItem(key), /browser storage failure/);
  await assert.rejects(web.accountStorage.removeItem(key), /browser storage failure/);

  for (const os of ['web', 'ios']) {
    const app = host(os);
    assert.deepEqual(plain(await app.readAccountPolicy()), { loginRequired: false });
    const guest = await app.loadGuestProfile();
    assert.match(guest.id, /^[a-f0-9-]{36}$/);
    assert.deepEqual(plain(guest), { id: guest.id, name: '', email: '', phone: '' });
    assert.deepEqual(plain(await app.loadGuestProfile()), plain(guest), 'Guest identity persists across loads');
    const profile = { ...guest, name: 'Sample Person', email: 'sample@example.test', phone: '+15555550123' };
    await app.saveGuestProfile(profile);
    assert.deepEqual(plain(await app.loadGuestProfile()), plain(profile));
    await app.saveAccountPolicy({ loginRequired: true, guestClaimedBy: 'synthetic-account' });
    assert.deepEqual(plain(await app.readAccountPolicy()), { loginRequired: true, guestClaimedBy: 'synthetic-account' });
    await app.accountStorage.setItem('fillout.account-policy.v1', '{"loginRequired":"false"}');
    await assert.rejects(app.readAccountPolicy(), /account settings could not be read/);
    await app.accountStorage.setItem('fillout.guest-profile.v1', '{"name":"Missing identity"}');
    await assert.rejects(app.loadGuestProfile(), /profile could not be read/);
    app.intercept(async call => { if (call.method === 'get') throw new Error('Synthetic profile read failure'); });
    await assert.rejects(app.loadGuestProfile(), /profile read failure/);
    await assert.rejects(app.readAccountPolicy(), /profile read failure/);
  }
  for (const os of ['web', 'ios', 'android']) {
    const app = host(os);
    let release;
    let held = false;
    app.intercept(async call => {
      if (call.method === 'get' && !held) { held = true; await new Promise(resolve => { release = resolve; }); }
    });
    // React StrictMode and concurrent providers can both hydrate before the first
    // storage read completes. Every caller must receive the one persisted identity.
    const first = app.loadGuestProfile();
    const second = app.loadGuestProfile();
    await settle();
    const third = app.loadGuestProfile();
    release();
    const profiles = await Promise.all([first, second, third]);
    assert.equal(new Set(profiles.map(profile => profile.id)).size, 1, `${os}: concurrent hydration must not create multiple guest identities`);
    assert.deepEqual(plain(await app.loadGuestProfile()), plain(profiles[0]), `${os}: every returned identity matches the persisted profile`);
    const profileWrites = app.calls.filter(call => call.method === 'set' && (call.key === 'fillout.guest-profile.v1' || call.key === 'fillout.auth.fillout.guest-profile.v1'));
    assert.equal(profileWrites.length, 1, `${os}: concurrent hydration commits the guest profile only once`);

    const retry = host(os);
    retry.intercept(async call => { if (call.method === 'get') throw new Error('Hydration failed'); });
    const outcomes = await Promise.allSettled([retry.loadGuestProfile(), retry.loadGuestProfile()]);
    assert.ok(outcomes.every(outcome => outcome.status === 'rejected'), 'Concurrent callers receive the hydration failure');
    retry.intercept(async () => {});
    const recovered = await retry.loadGuestProfile();
    assert.deepEqual(plain(await retry.loadGuestProfile()), plain(recovered), 'A failed shared request must release the latch for retry');
  }
  for (const os of ['web', 'ios', 'android']) {
    const app = host(os);
    const profile = await app.loadGuestProfile();
    await app.saveGuestProfile({ ...profile, name: 'Private name', email: 'private@example.test', phone: '+15555550123' });
    const journal = app.newAccountDeletion('A', 'A', true, 'private@example.test');
    assert.match(journal.deletionToken, /^[0-9a-f]{64}$/);
    await app.saveAccountDeletion(journal);
    assert.deepEqual(plain(await app.readAccountDeletion()), plain(journal));
    if (os !== 'web') {
      let failOnce = true;
      app.intercept(async call => {
        if (failOnce && call.method === 'remove' && call.key.startsWith('fillout.auth.fillout.guest-profile.v1.')) {
          failOnce = false; throw new Error('Private chunk could not be erased');
        }
      });
      await assert.rejects(app.resetDeletedAccountProfile(journal.guestDraftOwner), /could not be erased/);
      assert.ok(app.secure.has('fillout.auth.fillout.guest-profile.v1'), 'A failed private chunk purge retains its manifest for retry');
      assert.ok(await app.readAccountDeletion(), 'The deletion journal remains readable through a partial profile purge');
      app.intercept(async () => {});
    }
    const fresh = await app.resetDeletedAccountProfile(journal.guestDraftOwner);
    assert.equal(fresh.guest.name, ''); assert.equal(fresh.policy.loginRequired, false);
    assert.equal(fresh.policy.guestDraftOwner, journal.guestDraftOwner);
    assert.ok(![...app.secure.values(), ...app.web.values()].some(value => String(value).includes('Private name')), 'Profile chunks containing personal details are erased');
    await app.clearAccountDeletion(); assert.equal(await app.readAccountDeletion(), null);
  }
  console.log('Account storage passed: native secure generations/chunks, queued reads, atomic write recovery, read/delete failures, web persistence, guest identity and account policy.');
})().catch(error => { console.error(error); process.exitCode = 1; });
