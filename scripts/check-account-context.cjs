#!/usr/bin/env node
// Integrate the account provider with real draft storage across authentication changes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const KEY = 'immigration-eagle.preparation-drafts.v1';
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const providerSource = compile('src/AccountContext.tsx');
const draftSource = compile('src/draftStorage.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(setImmediate);
const user = id => ({ id, email: `${id}@example.test`, email_confirmed_at: '2026-10-11T12:00:00Z', user_metadata: {} });
const draft = name => ({ version: 1, formId: 'I-90', title: 'Sample form', answered: 1, total: 3,
  updatedAt: '2026-10-11T12:00:00Z', mode: 'ai', stage: 'interview', answers: { name }, checks: {} });

function host(options = {}) {
  const durable = options.durable || {
    values: new Map(), policy: { loginRequired: false },
    guest: { id: 'local-guest', name: '', email: '', phone: '' },
  };
  let session = { user: null, configured: false, loading: false, error: null, ...options.session };
  let dirty = true;
  let position = 0;
  let tree;
  let active = true;
  let failWrite;
  let failPolicy = false;
  let beforePolicy;
  let signOutCalls = 0;
  let deleteCalls = 0;
  let deletionError;
  let resetError;
  const hooks = [];
  const effects = [];
  const nextEffects = [];
  const React = {
    createContext: () => ({ Provider: 'AccountProvider' }),
    useContext() { throw new Error('Consumers are read from the real provider output'); },
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = position++;
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks[index], next => {
        const value = typeof next === 'function' ? next(hooks[index]) : next;
        if (Object.is(value, hooks[index])) return;
        hooks[index] = value; dirty = true;
      }];
    },
    useRef(initial) { const index = position++; return hooks[index] ||= { current: initial }; },
    useEffect(setup, dependencies) {
      const index = position++;
      const previous = effects[index];
      if (!previous || dependencies.some((dependency, i) => !Object.is(dependency, previous.dependencies[i]))) {
        nextEffects.push({ index, setup, dependencies });
      }
    },
  };
  const storage = {
    async getItem(key) { return durable.values.get(key) ?? null; },
    async setItem(key, value) {
      if (failWrite) await failWrite(key, value);
      durable.values.set(key, value);
    },
    async removeItem(key) { durable.values.delete(key); },
  };
  const drafts = { exports: {} };
  vm.runInNewContext(draftSource, {
    module: drafts, exports: drafts.exports, Error,
    require(name) { if (name === '@react-native-async-storage/async-storage') return storage; throw new Error(name); },
  });
  const provider = { exports: {} };
  vm.runInNewContext(providerSource, {
    module: provider, exports: provider.exports, Error,
    require(name) {
      if (name === 'react') return { ...React, default: React, __esModule: true };
      if (name === './draftStorage') return drafts.exports;
      if (name === './payments') return { async erasePaymentAttempts(userId) {
        assert.equal(durable.deletion?.cloudDeleted, true, 'Keep charge retry protection until remote deletion is confirmed');
        for (const key of durable.values.keys()) if (key.startsWith(`fillout.payment.pending.v1.${userId}.`)) durable.values.delete(key);
      } };
      if (name === './cloudClient') return {
        useCloudSession: () => session,
        async deleteCloudAccount() { deleteCalls++; if (deletionError) throw new Error(deletionError); },
        async signOutCloud() { signOutCalls++; session = { ...session, user: null, loading: false }; dirty = true; },
      };
      if (name === './accountStorage') return {
        async readAccountDeletion() { return durable.deletion || null; },
        newAccountDeletion(ownerId, userId, clearLegacyGuest, email) { return { ownerId, userId, clearLegacyGuest, email, deletionToken: 'a'.repeat(64), guestDraftOwner: 'guest-new-identity', cloudDeleted: !userId }; },
        async saveAccountDeletion(journal) { durable.deletion = plain(journal); },
        async clearAccountDeletion() { durable.deletion = null; },
        async resetDeletedAccountProfile(guestDraftOwner) {
          if (resetError) throw new Error(resetError);
          durable.guest = { id: 'new-guest', name: '', email: '', phone: '' };
          durable.policy = { loginRequired: false, guestDraftOwner };
          return { guest: plain(durable.guest), policy: plain(durable.policy) };
        },
        async loadGuestProfile() { return plain(durable.guest); },
        async readAccountPolicy() { return plain(durable.policy); },
        async saveGuestProfile(profile) { durable.guest = plain(profile); },
        async saveAccountPolicy(policy) {
          if (beforePolicy) await beforePolicy(policy);
          if (failPolicy) throw new Error('Policy storage failed');
          durable.policy = plain(policy);
        },
      };
      throw new Error(name);
    },
  });
  function render() {
    if (!active) throw new Error('Provider is unmounted');
    dirty = false; position = 0;
    tree = provider.exports.AccountProvider({ children: 'App children' });
    for (const effect of nextEffects.splice(0)) {
      effects[effect.index]?.cleanup?.();
      effects[effect.index] = { dependencies: effect.dependencies, cleanup: effect.setup() };
    }
    return tree.props.value;
  }
  return {
    durable, drafts: drafts.exports,
    get value() { return tree.props.value; },
    get deleteCalls() { return deleteCalls; },
    failDeletion(message) { deletionError = message; },
    failReset(message) { resetError = message; },
    get signOutCalls() { return signOutCalls; },
    render,
    session(next) { session = { ...session, ...next }; dirty = true; return render(); },
    failWrites(action) { failWrite = action; },
    failPolicy(value) { failPolicy = value; },
    onPolicy(action) { beforePolicy = action; },
    async settle() { for (let i = 0; i < 12; i++) { if (dirty) render(); await tick(); } return tree.props.value; },
    unmount() { active = false; effects.forEach(effect => effect?.cleanup?.()); },
  };
}

function checkApplicationGate() {
  let account;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: initial => [initial, () => {}], useEffect() {},
  };
  const moduleRef = { exports: {} };
  vm.runInNewContext(`${compile('App.tsx')}\nexports.readAccountShell = AccountShell;`, {
    module: moduleRef, exports: moduleRef.exports,
    require(name) {
      if (name === 'react') return { ...React, default: React, __esModule: true };
      if (name === 'react-native') return {
        ActivityIndicator: 'ActivityIndicator', Image: 'Image', Pressable: 'Pressable', Text: 'Text', View: 'View',
        Platform: { OS: 'ios' }, StyleSheet: { create: value => value },
      };
      if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView', SafeAreaProvider: 'SafeAreaProvider' };
      if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
      if (name.includes('Ionicons')) return { default: 'Ionicons', __esModule: true };
      if (name.endsWith('LanguageContext')) return { LanguageProvider: 'LanguageProvider', useLanguage: () => ({ t: value => value }) };
      if (name.endsWith('AccountContext')) return { AccountProvider: 'AccountProvider', useAccount: () => account };
      if (name.endsWith('AccountScreen')) return { AccountScreen: 'AccountScreen' };
      if (name.endsWith('AssistantScreen')) return { AssistantScreen: 'AssistantScreen' };
      if (name.endsWith('ApplicationScreen')) return { ApplicationScreen: 'ApplicationScreen' };
      if (name.endsWith('MyReviewSubmissions')) return { MyReviewSubmissions: 'MyReviewSubmissions' };
      if (name.endsWith('FormsFlow')) return { default: 'FormsFlow', __esModule: true };
      if (name.endsWith('draftStorage')) return {};
      if (name.endsWith('/UI')) return { Button: 'Button' };
      if (name.endsWith('/theme')) return { colors: {} };
      throw new Error(`Unexpected App dependency: ${name}`);
    },
  });
  function all(node, predicate, result = []) {
    if (!node || typeof node !== 'object') return result;
    if (Array.isArray(node)) { node.forEach(child => all(child, predicate, result)); return result; }
    if (predicate(node)) result.push(node);
    all(node.props?.children, predicate, result);
    return result;
  }
  const application = tree => all(tree, node => node.type?.name === 'EagleApp');
  const render = state => { account = { retry() {}, ...state }; return moduleRef.exports.readAccountShell(); };
  let tree = render({ ready: false, locked: false, scope: undefined, error: '' });
  assert.equal(application(tree).length, 0, 'No application loads before the first owner is selected');
  for (const error of ['', 'A save failed']) {
    tree = render({ ready: false, locked: false, scope: 'A', error });
    assert.equal(application(tree)[0].props.key, 'A', 'The prior editor remains mounted while switching or after a failed switch');
    assert.equal(application(tree)[0].props.draftOwner, 'A', 'A retained editor keeps its mounted draft owner while the cloud identity changes');
    const panel = all(tree, node => node.props?.accessibilityElementsHidden === true)[0];
    assert.equal(panel.props.importantForAccessibility, 'no-hide-descendants');
    assert.ok(panel.props.style.some(style => style?.display === 'none'), 'Prior account content is visually hidden and inaccessible');
  }
  tree = render({ ready: true, locked: true, scope: 'guest', error: '' });
  assert.equal(all(tree, node => node.type === 'AccountScreen')[0].props.locked, true, 'Logged-out registered users only receive the login gate');
  assert.equal(application(tree)[0].props.draftOwner, null, 'Guest editors use the legacy guest storage scope');
  assert.equal(all(tree, node => node.props?.accessibilityElementsHidden === true).length, 1);
  tree = render({ ready: false, locked: true, scope: 'A', error: 'A save failed' });
  assert.equal(all(tree, node => node.type === 'AccountScreen')[0].props.locked, true, 'Expired sessions can sign in even when a failed save prevents switching storage to guest');
  assert.equal(application(tree)[0].props.key, 'A');
  assert.equal(all(tree, node => node.props?.accessibilityElementsHidden === true).length, 1, 'The old owner remains hidden behind the recovery login');
  let recoveries = 0;
  tree = render({ ready: false, locked: false, scope: 'A', error: 'A save failed', recoverSignIn: () => { recoveries++; } });
  all(tree, node => node.props?.title === 'Return to login')[0].props.onPress();
  assert.equal(recoveries, 1, 'An uncommitted replacement login offers the provider recovery action');
  tree = render({ ready: true, locked: false, scope: 'B', error: '' });
  assert.equal(application(tree)[0].props.key, 'B', 'A successful owner transition remounts the application under its new identity');
  assert.equal(application(tree)[0].props.draftOwner, 'B');
  assert.equal(all(tree, node => node.props?.accessibilityElementsHidden === true).length, 0);
  assert.equal(all(tree, node => node.type === 'AccountScreen').length, 0);
}

(async () => {
  {
    const app = host();
    assert.equal(app.render().ready, false, 'Draft UI waits for local identity hydration');
    await app.settle();
    assert.equal(app.value.ready, true);
    assert.equal(app.value.scope, 'guest');
    assert.equal(app.value.locked, false, 'Fresh installs remain usable without configured cloud services');
    await app.value.saveGuest({ name: 'Guest Person', email: '', phone: '' });
    await app.settle();
    assert.equal(app.value.guest.name, 'Guest Person');
    assert.equal(app.durable.guest.name, 'Guest Person');
    app.unmount();
  }
  {
    const app = host({ session: { configured: true, loading: true } });
    await app.settle();
    assert.equal(app.value.ready, false, 'An unresolved persisted session must not open guest drafts');
    app.session({ loading: false, user: null });
    await app.settle();
    assert.equal(app.value.ready, true);
    app.unmount();
  }
  {
    const app = host();
    await app.settle();
    await app.drafts.saveDraft(draft('Guest answer'));
    assert.equal(app.session({ configured: true, user: user('A') }).ready, false, 'A session change immediately hides the previous owner');
    await app.settle();
    assert.equal(app.value.scope, 'A');
    assert.equal(app.value.ready, true);
    assert.deepEqual(app.durable.policy, { loginRequired: true, guestClaimedBy: 'A' });
    assert.equal((await app.drafts.loadDraft('I-90')).answers.name, 'Guest answer');
    assert.equal(app.durable.values.has(KEY), false);
    const durable = app.durable;
    app.unmount();
    const restarted = host({ durable, session: { configured: true, user: user('A') } });
    await restarted.settle();
    assert.equal(restarted.value.scope, 'A');
    assert.equal(restarted.value.ready, true, 'Restored sessions reopen the same account without requiring another login');
    assert.equal(restarted.signOutCalls, 0);
    restarted.failWrites(() => { throw new Error('Disk full'); });
    await assert.rejects(restarted.drafts.saveDraft(draft('Unsaved answer')), /Disk full/);
    await assert.rejects(restarted.value.signOut(), /Keep this screen open/);
    await restarted.settle();
    assert.equal(restarted.signOutCalls, 0, 'Failed draft writes block cloud sign-out');
    assert.equal(restarted.value.scope, 'A');
    assert.equal(restarted.value.ready, true, 'The failed sign-out retains the current editor scope');
    restarted.failWrites(undefined);
    await restarted.drafts.saveDraft(draft('Retried answer'));
    await restarted.value.signOut();
    await restarted.settle();
    assert.equal(restarted.value.user, null);
    assert.equal(restarted.value.locked, true);
    assert.equal(restarted.value.scope, 'guest');
    assert.equal((await restarted.drafts.listDrafts()).length, 0, 'Sign-out does not publish A drafts to guest storage');
    const loggedOut = host({ durable, session: { configured: true, user: null } });
    await loggedOut.settle();
    assert.equal(loggedOut.value.locked, true, 'The login requirement survives restarting after logout');
    restarted.unmount(); loggedOut.unmount();
  }
  {
    const app = host({ session: { configured: true, user: user('A') } });
    await app.settle();
    await app.drafts.saveDraft(draft('Saved A answer'));
    let rejectSave;
    app.failWrites(() => new Promise((_, reject) => { rejectSave = reject; }));
    const saving = app.drafts.saveDraft(draft('Unsaved A answer'));
    const failure = assert.rejects(saving, /Disk full/);
    await app.settle();
    assert.equal(typeof rejectSave, 'function');
    app.session({ user: null });
    await app.settle();
    assert.equal(app.value.locked, true);
    assert.equal(app.value.ready, false, 'Expiry hides the editor while the pending save drains');
    rejectSave(new Error('Disk full')); await failure; await app.settle();
    assert.match(app.value.error, /Keep this screen open/);
    assert.equal(app.value.scope, 'A', 'Failed writes retain the old storage and editor scope after an external logout');
    assert.equal(app.durable.values.has(KEY), false, 'No A draft is published into guest storage');

    app.session({ user: user('B') }); await app.settle();
    assert.equal(app.value.user.id, 'B');
    assert.equal(app.value.ready, false, 'Another account cannot open the retained A editor');
    assert.equal(app.value.scope, 'A');
    assert.equal(app.durable.values.has(`${KEY}.owner.B`), false);
    assert.equal(typeof app.value.recoverSignIn, 'function');
    const staleRecovery = app.value.recoverSignIn;
    await app.value.recoverSignIn(); await app.settle();
    assert.equal(app.signOutCalls, 1, 'An uncommitted replacement session may return to login without discarding the original failed save');
    assert.equal(app.value.locked, true);
    assert.equal(app.value.ready, false);
    assert.equal(app.value.scope, 'A');
    await assert.rejects(app.drafts.waitForDraftSaves(), /Keep this screen open/);

    app.session({ user: user('A') }); await app.settle();
    assert.equal(app.value.ready, true, 'Reauthentication to A reopens its retained editor so the user can retry saving');
    assert.equal(app.value.scope, 'A');
    assert.equal(app.value.error, '');
    assert.equal(app.value.recoverSignIn, undefined, 'A committed account cannot bypass the ordinary sign-out save guard');
    await staleRecovery();
    assert.equal(app.signOutCalls, 1, 'A stale wrong-account recovery action cannot sign out the now-restored owner');
    await assert.rejects(app.value.signOut(), /Keep this screen open/);
    assert.equal(app.signOutCalls, 1);
    app.failWrites(undefined);
    await app.drafts.saveDraft(draft('Retried A answer'));
    assert.equal((await app.drafts.loadDraft('I-90')).answers.name, 'Retried A answer');
    await app.value.signOut(); await app.settle();
    assert.equal(app.value.scope, 'guest');
    assert.equal(app.value.locked, true);
    app.unmount();
  }
  {
    const app = host();
    await app.settle();
    await app.drafts.saveDraft(draft('Private guest answer'));
    app.failWrites(key => { if (key.endsWith('.owner.A')) throw new Error('Migration failed'); });
    app.session({ configured: true, user: user('A') });
    await app.settle();
    assert.equal(app.value.ready, false);
    assert.match(app.value.error, /Migration failed/);
    assert.equal(app.value.scope, 'guest', 'A failed migration never marks the target scope ready');
    assert.equal(app.durable.policy.guestClaimedBy, 'A', 'The first association remains reserved after a failed migration');
    assert.equal(app.durable.values.has(KEY), true);
    app.session({ user: user('B') });
    await app.settle();
    assert.equal(app.value.ready, true);
    assert.equal(app.value.scope, 'B');
    assert.equal((await app.drafts.listDrafts()).length, 0, 'Another login cannot claim the failed first account migration');
    app.failWrites(undefined);
    app.session({ user: null }); await app.settle();
    app.session({ user: user('A') }); await app.settle();
    assert.equal(app.value.ready, true);
    assert.equal((await app.drafts.loadDraft('I-90')).answers.name, 'Private guest answer');
    app.unmount();
  }
  {
    const app = host();
    await app.settle();
    await app.drafts.saveDraft(draft('Keep guest safe'));
    app.failPolicy(true);
    app.session({ configured: true, user: user('A') });
    await app.settle();
    assert.equal(app.value.ready, false, 'Failure to persist the account lock blocks application access');
    assert.match(app.value.error, /Policy storage failed/);
    assert.equal(app.durable.values.has(KEY), true);
    assert.equal(app.durable.values.has(`${KEY}.owner.A`), false, 'Draft migration cannot precede the persistent account lock');
    app.failPolicy(false); app.value.retry(); await app.settle();
    assert.equal(app.value.ready, true);
    assert.equal(app.value.scope, 'A');
    app.unmount();
  }
  {
    const app = host();
    await app.settle();
    await app.drafts.saveDraft(draft('First account association'));
    let release;
    app.onPolicy(policy => policy.guestClaimedBy === 'A' && new Promise(resolve => { release = resolve; }));
    app.session({ configured: true, user: user('A') });
    await app.settle();
    assert.equal(typeof release, 'function');
    app.session({ user: user('B') });
    app.onPolicy(undefined); release();
    await app.settle();
    assert.equal(app.value.ready, true);
    assert.equal(app.value.scope, 'B');
    assert.equal(app.durable.policy.guestClaimedBy, 'A', 'An already committing association must remain reserved if the session changes during its write');
    assert.equal((await app.drafts.listDrafts()).length, 0, 'The replacement account cannot inherit another account association during a slow policy write');
    app.unmount();
  }
  {
    const app = host(); await app.settle();
    await app.value.saveGuest({ name: 'Delete guest', email: 'guest@example.test', phone: '' });
    await app.drafts.saveDraft(draft('Guest private answer'));
    await app.value.deleteAccount(); await app.settle();
    assert.equal(app.value.deletionPending, false);
    assert.equal(app.value.scope, 'guest-new-identity');
    assert.equal(app.value.guest.name, '');
    assert.equal(app.value.locked, false);
    assert.equal(app.durable.values.has(KEY), false);
    assert.equal(app.deleteCalls, 0, 'Guest deletion is entirely local');
    await assert.rejects(app.drafts.saveDraft(draft('Late old guest answer'), null), /being deleted/);
    await app.drafts.saveDraft(draft('Fresh guest answer'), app.value.scope);
    assert.equal((await app.drafts.listDrafts())[0].answers.name, 'Fresh guest answer');
    app.session({ user: user('A') }); await app.settle();
    assert.equal((await app.drafts.listDrafts())[0].answers.name, 'Fresh guest answer', 'A fresh guest may still associate its new drafts');
    app.unmount();
  }
  {
    const app = host({ session: { user: user('A') } }); await app.settle();
    await app.drafts.saveDraft(draft('A private answer'));
    // A draft from a different account must survive account A deletion.
    await app.drafts.saveDraft(draft('B private answer'), 'B');
    app.durable.values.set('fillout.payment.pending.v1.A.I-90', 'pending A');
    app.durable.values.set('fillout.payment.pending.v1.B.I-90', 'pending B');
    app.failDeletion('Network unavailable');
    await assert.rejects(app.value.deleteAccount(), /Network unavailable/); await app.settle();
    assert.equal(app.value.deletionPending, true); assert.equal(app.value.ready, false);
    assert.equal(app.durable.deletion.cloudDeleted, false);
    assert.ok(app.durable.values.has(`${KEY}.owner.A`), 'Unconfirmed remote deletion retains local data behind the lock');
    assert.ok(app.durable.values.has('fillout.payment.pending.v1.A.I-90'), 'An unconfirmed deletion retains payment retry protection');
    await assert.rejects(app.drafts.saveDraft(draft('Late A answer'), 'A'), /being deleted/);
    app.failDeletion(undefined); app.failReset('Profile purge failed');
    await assert.rejects(app.value.deleteAccount(), /Profile purge failed/); await app.settle();
    assert.equal(app.durable.deletion.cloudDeleted, true, 'Confirmed server deletion survives local cleanup failure');
    assert.equal(app.value.deletionPending, true);
    const durable = app.durable; app.unmount();
    const resumed = host({ durable }); await resumed.settle();
    assert.equal(resumed.value.deletionPending, true); assert.equal(resumed.value.ready, false);
    await resumed.value.deleteAccount(); await resumed.settle();
    assert.equal(resumed.deleteCalls, 0, 'Restart only retries unfinished cleanup, not confirmed cloud deletion');
    assert.equal(resumed.value.ready, true); assert.equal(resumed.value.locked, false);
    assert.equal(durable.values.has(`${KEY}.owner.A`), false);
    assert.ok(durable.values.has(`${KEY}.owner.B`), 'Other account drafts remain isolated');
    assert.equal(durable.values.has('fillout.payment.pending.v1.A.I-90'), false);
    assert.ok(durable.values.has('fillout.payment.pending.v1.B.I-90'), 'Other account payment journals remain isolated');
    assert.equal(durable.deletion, null);
    resumed.unmount();
  }
  checkApplicationGate();
  console.log('Account provider and app gate passed: offline guest access, hydration, persistent account lock/session, failed-save logout protection and reauthentication, owner isolation, migration races and retained hidden editors.');
})().catch(error => { console.error(error); process.exitCode = 1; });
