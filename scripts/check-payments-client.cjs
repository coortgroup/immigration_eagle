const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const caseA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const caseB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const input = { userId: userA, caseId: caseA, formId: 'I-90' };
const productId = 'net.fillout.ai.i90.case.v1';
const source = ts.transpileModule(fs.readFileSync('src/payments.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const storeProduct = extras => ({ identifier: productId, price: 141, priceString: '141,00 €', currencyCode: 'EUR',
  title: 'I-90 preparation', description: 'One application', productCategory: 'NON_SUBSCRIPTION',
  productType: 'CONSUMABLE', subscriptionPeriod: null, ...extras });

function fixture(options = {}) {
  const calls = [], storage = options.storage || new Map();
  let owner = userA, sdkOwner = null, granted = false, imports = 0;
  let respond, buy = async () => { granted = true; return { customerInfo: { entitlements: { active: { forged: true } } } }; };
  let products = async () => [storeProduct()];
  const sdk = {
    isConfigured: async () => sdkOwner !== null,
    configure: value => { calls.push(['configure', value]); sdkOwner = value.appUserID; },
    getAppUserID: async () => sdkOwner,
    logIn: async id => { calls.push(['logIn', id]); sdkOwner = id; },
    getProducts: async (ids, type) => { calls.push(['getProducts', ids, type]); return products(); },
    purchaseStoreProduct: async product => { calls.push(['purchase', product]); return buy(); },
    restorePurchases: async () => { calls.push(['restore']); granted = true; },
    syncPurchases: async () => { throw Error('The normal checkout flow must not use observer-mode sync'); },
  };
  const moduleRef = { exports: {} };
  vm.runInNewContext(source, {
    module: moduleRef, exports: moduleRef.exports, Error, Object, Promise, Map, WeakMap, Set,
    process: { env: { EXPO_PUBLIC_ENABLE_AI_PAYMENTS: options.enabled === false ? 'false' : 'true',
      EXPO_PUBLIC_PAYMENT_TEST_BUILD: options.testBuild ? 'true' : 'false',
      EXPO_PUBLIC_REVENUECAT_IOS_KEY: options.key || 'appl_publicSdkKey', EXPO_PUBLIC_REVENUECAT_ANDROID_KEY: 'goog_publicSdkKey' } },
    require: name => {
      if (name === '@react-native-async-storage/async-storage') return {
        getItem: async key => storage.get(key) || null,
        setItem: async (key, value) => { calls.push(['savePending']); storage.set(key, value); },
        removeItem: async key => { storage.delete(key); },
      };
      if (name === 'react-native') return { Platform: { OS: options.platform || 'ios' }, NativeModules: options.native === false ? {} : { RNPurchases: {} } };
      if (name === './cloudClient') return {
        getCloudUserId: () => owner,
        invokeCloudFunction: async (name, body) => {
          calls.push(['server', name, body]);
          if (respond) return respond(body);
          return { caseId: body.caseId, formId: body.formId, access: granted ? 'granted' : 'payment_required',
            productId, environment: 'production', ...(body.action === 'prepare' ? { purchasePrepared: true } : {}) };
        },
      };
      if (name === '../data/form-pricing.json') return JSON.parse(fs.readFileSync('data/form-pricing.json', 'utf8'));
      if (name === 'react-native-purchases') {
        imports++;
        return { __esModule: true, default: sdk, PRODUCT_CATEGORY: { NON_SUBSCRIPTION: 'NON_SUBSCRIPTION' },
          PRODUCT_TYPE: { CONSUMABLE: 'CONSUMABLE' }, STOREKIT_VERSION: { STOREKIT_2: 'STOREKIT_2' },
          PURCHASES_ERROR_CODE: { PURCHASE_CANCELLED_ERROR: '1', PAYMENT_PENDING_ERROR: '20' } };
      }
      throw Error(`Unexpected import: ${name}`);
    },
  });
  return { api: moduleRef.exports, calls, storage, setOwner: value => { owner = value; },
    setBuy: value => { buy = value; }, setProducts: value => { products = value; },
    setRespond: value => { respond = value; }, getImports: () => imports };
}
const count = (f, name) => f.calls.filter(call => call[0] === name).length;
const receipt = (body, extra = {}) => ({ caseId: body.caseId, formId: body.formId,
  access: 'payment_required', productId, environment: 'production', ...(body.action === 'prepare' ? { purchasePrepared: true } : {}), ...extra });

(async () => {
  const catalog = fixture().api;
  for (const [form, kind] of [['AR-11', 'free'], ['G-1145', 'free'], ['I-90', 'paid'], ['I-130A', 'included'],
    ['I-765WS', 'included'], ['I-864A', 'addon'], ['G-639', 'unavailable'], ['I-821', 'unavailable'], ['unknown', 'unavailable']]) {
    assert.equal(catalog.getAiPaymentKind(form), kind);
  }
  assert.deepEqual([...catalog.getAiPaymentParentForms('I-130A')].sort(), ['I-130', 'I-485']);
  assert.deepEqual([...catalog.getAiPaymentParentForms('I-864A')], ['I-864']);

  for (const options of [{ enabled: false }, { platform: 'web' }, { native: false }, { key: 'sk_secret' }, { key: 'test_mock' }]) {
    const f = fixture(options);
    assert.equal(f.api.getPaymentAvailability().available, false);
    await assert.rejects(() => f.api.loadPaymentProduct(input, productId), /not available/);
    assert.equal(f.getImports(), 0, 'Preview environments never import the simulated SDK');
  }

  const sandbox = fixture({ testBuild: true });
  sandbox.setRespond(body => receipt(body, { environment: 'sandbox' }));
  assert.equal((await sandbox.api.loadPaymentProduct(input, productId)).identifier, productId);
  for (const environment of ['production', 'invalid', null, undefined]) {
    const guarded = fixture({ testBuild: true });
    guarded.setRespond(body => receipt(body, { environment, access: 'granted' }));
    await assert.rejects(() => guarded.api.getPaymentStatus(input), /could not be verified/);
    assert.equal(guarded.getImports(), 0, 'Test build must reject paid access unless the actual receipt is sandbox');
  }
  const sharedBackend = fixture({ testBuild: true });
  sharedBackend.setRespond(body => receipt(body, { environment: 'production' }));
  assert.equal((await sharedBackend.api.loadPaymentProduct(input, productId)).identifier, productId, 'Unpaid production quote allows real StoreKit sandbox checkout after shared-backend cutover');
  const freeInTest = fixture({ testBuild: true });
  freeInTest.setRespond(body => receipt(body, { productId: null, access: 'granted', environment: undefined }));
  assert.equal((await freeInTest.api.getPaymentStatus({ ...input, formId: 'AR-11' })).access, 'granted', 'Free server grants need no store environment');
  const missingPaidEnvironment = fixture();
  missingPaidEnvironment.setRespond(body => receipt(body, { access: 'granted', environment: undefined }));
  await assert.rejects(() => missingPaidEnvironment.api.getPaymentStatus(input), /could not be verified/, 'Release cannot open a paid case without provenance');
  const badEnvironment = fixture();
  badEnvironment.setRespond(body => receipt(body, { environment: 'staging' }));
  await assert.rejects(() => badEnvironment.api.getPaymentStatus(input), /could not be verified/);

  const good = fixture();
  const product = await good.api.loadPaymentProduct(input, productId);
  assert.equal(product.priceString, '141,00 €', 'Checkout shows the exact store-localized amount');
  assert.equal(product.price, 141);
  assert.equal(good.calls.find(call => call[0] === 'configure')[1].appUserID, userA);
  assert.equal(good.calls.find(call => call[0] === 'getProducts')[2], 'NON_SUBSCRIPTION');
  assert.equal((await good.api.purchaseAiPreparation(input, product)).access, 'granted');
  assert.equal(count(good, 'purchase'), 1);
  assert.equal(good.storage.size, 0);
  const prepareIndex = good.calls.findIndex(call => call[0] === 'server' && call[2].action === 'prepare');
  assert.ok(good.calls.findIndex(call => call[0] === 'savePending') < prepareIndex);
  assert.ok(prepareIndex < good.calls.findIndex(call => call[0] === 'purchase'));
  for (const call of good.calls.filter(call => call[0] === 'server')) {
    assert.equal(call[1], 'ai-payment');
    assert.deepEqual(Object.keys(call[2]).sort(), ['action', 'caseId', 'formId', 'platform']);
    assert.equal(call[2].platform, 'ios');
  }

  for (const corrupt of [{ caseId: caseB }, { formId: 'N-400' }, { access: 'paid' }, { productId: null }, { productId: 'malicious/product' }]) {
    const f = fixture(); f.setRespond(body => receipt(body, corrupt));
    await assert.rejects(() => f.api.getPaymentStatus(input), /could not be verified/);
  }
  for (const bad of [{ productType: 'NON_CONSUMABLE' }, { productCategory: 'SUBSCRIPTION' }, { subscriptionPeriod: 'P1M' }, { price: 0 }, { currencyCode: '' }]) {
    const f = fixture(); f.setProducts(async () => [storeProduct(bad)]);
    await assert.rejects(() => f.api.loadPaymentProduct(input, productId), /not available/);
    assert.equal(count(f, 'purchase'), 0);
  }

  const cancel = fixture();
  const cancelledProduct = await cancel.api.loadPaymentProduct(input, productId);
  cancel.setBuy(async () => { throw { code: '1' }; });
  assert.equal((await cancel.api.purchaseAiPreparation(input, cancelledProduct)).purchaseState, 'cancelled');
  assert.ok(cancel.calls.some(call => call[0] === 'server' && call[2].action === 'cancel'));
  assert.equal(cancel.storage.size, 0);

  for (const storeResult of [async () => ({ customerInfo: { entitlements: { active: { forged: true } } } }),
    async () => { throw { code: '20' }; }, async () => { throw { code: '10' }; }]) {
    const f = fixture(); f.setRespond(body => receipt(body)); f.setBuy(storeResult);
    const p = await f.api.loadPaymentProduct(input, productId);
    const first = await f.api.purchaseAiPreparation(input, p);
    assert.equal(first.access, 'payment_required', 'SDK success or entitlements never grant access');
    assert.equal(first.purchaseState, 'pending');
    assert.equal((await f.api.reconcilePayment(input)).purchaseState, 'pending');
    await f.api.purchaseAiPreparation(input, p);
    assert.equal(count(f, 'purchase'), 1, 'Unconfirmed purchase cannot be repeated');
    const reloaded = fixture({ storage: f.storage }); reloaded.setRespond(body => receipt(body));
    assert.equal((await reloaded.api.reconcilePayment(input)).purchaseState, 'pending', 'Pending survives app restart');
    const p2 = await reloaded.api.loadPaymentProduct(input, productId);
    await reloaded.api.purchaseAiPreparation(input, p2);
    assert.equal(count(reloaded, 'purchase'), 0);
  }

  const reserved = fixture(); reserved.setRespond(body => receipt(body, body.action === 'prepare' ? { purchasePrepared: false, purchaseState: 'pending' } : {}));
  const reservedProduct = await reserved.api.loadPaymentProduct(input, productId);
  assert.equal((await reserved.api.purchaseAiPreparation(input, reservedProduct)).purchaseState, 'pending');
  assert.equal(count(reserved, 'purchase'), 0, 'Another device reservation cannot authorize checkout');

  const recovery = fixture();
  recovery.setRespond(body => receipt(body, { access: 'unavailable', recoverCaseId: caseB }));
  assert.equal((await recovery.api.reconcilePayment(input)).recoverCaseId, caseB);
  for (const corrupt of [{ recoverCaseId: 'bad' }, { recoverCaseId: caseA }, { access: 'granted', recoverCaseId: caseB }]) {
    recovery.setRespond(body => receipt(body, { access: 'unavailable', ...corrupt }));
    await assert.rejects(() => recovery.api.reconcilePayment(input), /could not be verified/);
  }
  const recoveryRace = fixture(); const recoveryProduct = await recoveryRace.api.loadPaymentProduct(input, productId);
  recoveryRace.setRespond(body => receipt(body, body.action === 'prepare'
    ? { access: 'unavailable', recoverCaseId: caseB, purchasePrepared: false } : {}));
  assert.equal((await recoveryRace.api.purchaseAiPreparation(input, recoveryProduct)).recoverCaseId, caseB);
  assert.equal(count(recoveryRace, 'purchase'), 0);
  assert.equal(recoveryRace.storage.size, 0, 'Recovery identified before checkout leaves no new pending attempt');

  const duplicate = fixture(); const p = await duplicate.api.loadPaymentProduct(input, productId);
  const pair = await Promise.all([duplicate.api.purchaseAiPreparation(input, p), duplicate.api.purchaseAiPreparation(input, p)]);
  assert.ok(pair.every(row => row.access === 'granted'));
  assert.equal(count(duplicate, 'purchase'), 1, 'A double tap causes only one native purchase');

  const switcher = fixture();
  let finishProducts;
  switcher.setProducts(() => new Promise(resolve => { finishProducts = resolve; }));
  const delayed = switcher.api.loadPaymentProduct(input, productId);
  while (!finishProducts) await new Promise(resolve => setImmediate(resolve));
  switcher.setOwner(userB);
  finishProducts([storeProduct()]);
  await assert.rejects(delayed, /account changed/);
  assert.equal(count(switcher, 'purchase'), 0);
  switcher.setProducts(async () => [storeProduct()]);
  await switcher.api.loadPaymentProduct({ ...input, userId: userB, caseId: caseB }, productId);
  assert.equal(switcher.calls.find(call => call[0] === 'logIn')[1], userB);
  await assert.rejects(async () => switcher.api.reconcilePayment(input), /account changed/);

  const forged = fixture(); const legit = await forged.api.loadPaymentProduct(input, productId);
  await assert.rejects(() => forged.api.purchaseAiPreparation(input, { ...legit }), /could not be verified/);
  assert.equal(count(forged, 'purchase'), 0, 'Only this account/case native product can be purchased');

  const restore = fixture();
  assert.equal((await restore.api.restoreAiPurchases(input)).access, 'granted');
  assert.equal(count(restore, 'restore'), 1);
  await restore.api.syncAiPurchases(input);
  assert.equal(count(restore, 'purchase'), 0);

  const deleted = fixture(); deleted.setRespond(body => receipt(body)); deleted.setBuy(async () => { throw { code: '20' }; });
  const deletedProduct = await deleted.api.loadPaymentProduct(input, productId);
  await deleted.api.purchaseAiPreparation(input, deletedProduct);
  const otherAccountKey = `fillout.payment.pending.v1.${userB}.I-90`;
  deleted.storage.set(otherAccountKey, 'other account data');
  await deleted.api.erasePaymentAttempts(userA);
  assert.equal(deleted.storage.size, 1);
  assert.ok(deleted.storage.has(otherAccountKey), 'Deletion never touches another account payment journal');
  await assert.rejects(async () => deleted.api.reconcilePayment(input), /account changed/);
  console.log('PASS: payment client real-price catalog, native-only SDK, UUID identity, account races, server-only grants, reservations, cancellation, restore and durable duplicate-charge prevention.');
})().catch(error => { console.error(error); process.exitCode = 1; });
