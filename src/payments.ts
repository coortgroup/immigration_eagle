import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';
import type { PurchasesStoreProduct } from 'react-native-purchases';
import { getCloudUserId, invokeCloudFunction } from './cloudClient';
import pricing from '../data/form-pricing.json';

export type AiPaymentKind = 'free' | 'paid' | 'included' | 'addon' | 'unavailable';
export type PaymentInput = { userId: string; caseId: string; formId: string; parentCaseId?: string };
export type PaymentStatus = {
  caseId: string; formId: string; access: 'granted' | 'payment_required' | 'unavailable';
  productId: string | null; purchaseState?: 'cancelled' | 'pending';
  environment?: 'sandbox' | 'production';
  recoverCaseId?: string;
};
export type PaymentProduct = Readonly<{
  identifier: string; title: string; description: string; priceString: string; currencyCode: string; price: number;
}>;
type PreparedStatus = PaymentStatus & { purchasePrepared?: boolean };
type PendingPurchase = { version: 1; caseId: string; formId: string; productId: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const productIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,199}$/;
const forms = new Map(pricing.forms.map(row => [row.id, row]));
const nativeProducts = new WeakMap<PaymentProduct, { product: PurchasesStoreProduct; input: PaymentInput }>();
const enabled = process.env.EXPO_PUBLIC_ENABLE_AI_PAYMENTS === 'true';
export const isPaymentTestBuild = process.env.EXPO_PUBLIC_PAYMENT_TEST_BUILD === 'true';
const iosKey = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY?.trim() || '';
const androidKey = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY?.trim() || '';
const invalid = () => new Error('The payment status could not be verified. Please check payment again.');
const accountChanged = () => new Error('Your signed-in account changed. Open this form again before continuing.');
const unavailable = () => new Error('In-app payment is not available in this version. Please use the current installed app.');
const erasedAccounts = new Set<string>();

/** Business routing only: checkout always uses a product and localized price from the store. */
export function getAiPaymentKind(formId: string): AiPaymentKind {
  const row = forms.get(formId);
  if (!row) return 'unavailable';
  if (row.eagleAi.serviceAmountUsd30 === 0) return 'free';
  if ('requiredPackage' in row.eagleAi) return 'addon';
  if ('includedWith' in row.eagleAi) return 'included';
  return typeof row.eagleAi.serviceAmountUsd30 === 'number' && row.eagleAi.serviceAmountUsd30 > 0 ? 'paid' : 'unavailable';
}

/** A candidate parent must still be authorized by the server and pass its own qualification. */
export function getAiPaymentParentForms(formId: string): string[] {
  const parents: string[] = [];
  for (const row of pricing.forms) {
    const basis = row.citizenPath;
    if (('includes' in basis && basis.includes?.includes(formId) || 'includesIfNeeded' in basis && basis.includesIfNeeded?.includes(formId))
      && row.id !== formId) parents.push(row.id);
  }
  const ai = forms.get(formId)?.eagleAi;
  if (ai && 'includedWith' in ai) parents.push(...ai.includedWith || []);
  if (ai && 'requiredPackage' in ai && ai.requiredPackage) parents.push(ai.requiredPackage);
  return [...new Set(parents)];
}

export function getPaymentAvailability(): { available: boolean; reason: 'disabled' | 'unsupported-platform' | 'native-build-required' | 'not-configured' | null } {
  if (!enabled) return { available: false, reason: 'disabled' };
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return { available: false, reason: 'unsupported-platform' };
  // RevenueCat has simulated APIs for Expo Go, web, and Rork. Never import or use them here.
  if (!NativeModules.RNPurchases || NativeModules.RorkSandbox) return { available: false, reason: 'native-build-required' };
  const key = Platform.OS === 'ios' ? iosKey : androidKey;
  if (!(Platform.OS === 'ios' ? /^appl_[A-Za-z0-9]+$/ : /^goog_[A-Za-z0-9]+$/).test(key)) {
    return { available: false, reason: 'not-configured' };
  }
  return { available: true, reason: null };
}

function assertOwner(input: PaymentInput) {
  if (!uuid.test(input.userId) || erasedAccounts.has(input.userId) || getCloudUserId() !== input.userId) throw accountChanged();
  if (!uuid.test(input.caseId) || !forms.has(input.formId)
    || input.parentCaseId !== undefined && (!uuid.test(input.parentCaseId) || input.parentCaseId === input.caseId)) throw invalid();
}
function capture(input: PaymentInput): PaymentInput {
  const captured = { ...input };
  assertOwner(captured);
  return captured;
}

// One queue owns both the SDK's global identity and all purchase/reconciliation operations.
// A delayed result for an earlier account never reaches the new account's screen.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(input: PaymentInput, action: (captured: PaymentInput) => Promise<T>): Promise<T> {
  const captured = capture(input);
  const result = queue.then(async () => {
    assertOwner(captured);
    const value = await action(captured);
    assertOwner(captured);
    return value;
  });
  queue = result.catch(() => undefined);
  return result;
}

function pendingKey(input: PaymentInput) { return `fillout.payment.pending.v1.${input.userId}.${input.formId}`; }
async function readPending(input: PaymentInput): Promise<PendingPurchase | null> {
  const raw = await AsyncStorage.getItem(pendingKey(input));
  assertOwner(input);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as PendingPurchase;
    if (value?.version !== 1 || !uuid.test(value.caseId) || value.formId !== input.formId || !productIdentifier.test(value.productId)) throw invalid();
    return value;
  } catch { throw invalid(); }
}
async function clearPending(input: PaymentInput) {
  const pending = await readPending(input);
  if (pending?.caseId === input.caseId) await AsyncStorage.removeItem(pendingKey(input));
  assertOwner(input);
}

async function server(input: PaymentInput, action: 'status' | 'reconcile' | 'prepare' | 'cancel'): Promise<PreparedStatus> {
  assertOwner(input);
  const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';
  const result = await invokeCloudFunction<PreparedStatus>('ai-payment', {
    action, caseId: input.caseId, formId: input.formId, platform,
    ...(input.parentCaseId ? { parentCaseId: input.parentCaseId } : {}),
  });
  assertOwner(input);
  if (!result || result.caseId !== input.caseId || result.formId !== input.formId
    || !['granted', 'payment_required', 'unavailable'].includes(result.access)
    || !(result.productId === null || typeof result.productId === 'string' && productIdentifier.test(result.productId))
    || result.access === 'payment_required' && result.productId === null
    || result.environment !== undefined && !['sandbox', 'production'].includes(result.environment)
    || result.access === 'granted' && getAiPaymentKind(input.formId) !== 'free' && result.environment === undefined
    // After the shared backend moves to production, an unpaid quote may name its
    // default environment. A test build may open paid content only when the
    // server verified an actual sandbox transaction for this exact case.
    || isPaymentTestBuild && result.access === 'granted' && getAiPaymentKind(input.formId) !== 'free' && result.environment !== 'sandbox'
    || result.purchaseState !== undefined && !['pending', 'cancelled'].includes(result.purchaseState)
    || result.recoverCaseId !== undefined && (typeof result.recoverCaseId !== 'string' || !uuid.test(result.recoverCaseId)
      || result.recoverCaseId === input.caseId || result.access !== 'unavailable')) throw invalid();
  if (result.access === 'granted') await clearPending(input);
  return result;
}
async function statusWithPending(input: PaymentInput, action: 'status' | 'reconcile'): Promise<PaymentStatus> {
  const result = await server(input, action);
  if (result.access !== 'granted' && await readPending(input)) return { ...result, purchaseState: 'pending' };
  return result;
}

export function getPaymentStatus(input: PaymentInput): Promise<PaymentStatus> {
  return serialized(input, captured => statusWithPending(captured, 'status'));
}
export function reconcilePayment(input: PaymentInput): Promise<PaymentStatus> {
  return serialized(input, captured => statusWithPending(captured, 'reconcile'));
}

async function nativeSdk(input: PaymentInput) {
  assertOwner(input);
  if (!getPaymentAvailability().available) throw unavailable();
  const module = await import('react-native-purchases');
  assertOwner(input);
  const sdk = module.default;
  if (!await sdk.isConfigured()) {
    assertOwner(input);
    sdk.configure({ apiKey: Platform.OS === 'ios' ? iosKey : androidKey, appUserID: input.userId, storeKitVersion: module.STOREKIT_VERSION.STOREKIT_2 });
  } else {
    const current = await sdk.getAppUserID();
    assertOwner(input);
    if (current !== input.userId) await sdk.logIn(input.userId);
  }
  assertOwner(input);
  if (await sdk.getAppUserID() !== input.userId) throw accountChanged();
  assertOwner(input);
  // Do not log out into an anonymous RevenueCat identity or attach immigration data/metadata.
  return module;
}

export function loadPaymentProduct(input: PaymentInput, productId: string): Promise<PaymentProduct> {
  return serialized(input, async captured => {
    if (!productIdentifier.test(productId)) throw invalid();
    const status = await server(captured, 'status');
    if (status.access !== 'payment_required' || status.productId !== productId) throw invalid();
    const module = await nativeSdk(captured);
    const products = await module.default.getProducts([productId], module.PRODUCT_CATEGORY.NON_SUBSCRIPTION);
    assertOwner(captured);
    const product = products.find(row => row.identifier === productId);
    if (!product || product.productCategory !== module.PRODUCT_CATEGORY.NON_SUBSCRIPTION || product.subscriptionPeriod
      || Platform.OS === 'ios' && product.productType !== module.PRODUCT_TYPE.CONSUMABLE
      || !Number.isFinite(product.price) || product.price <= 0 || !product.priceString?.trim()
      || !/^[A-Z]{3}$/.test(product.currencyCode || '')) throw new Error('This form is not available for purchase in your store yet.');
    const result: PaymentProduct = Object.freeze({ identifier: product.identifier, title: product.title,
      description: product.description, priceString: product.priceString, currencyCode: product.currencyCode, price: product.price });
    nativeProducts.set(result, { product, input: captured });
    return result;
  });
}

/** SDK success is only a reason to reconcile; only the authenticated server grants access. */
export function purchaseAiPreparation(input: PaymentInput, product: PaymentProduct): Promise<PaymentStatus> {
  return serialized(input, async captured => {
    const status = await statusWithPending(captured, 'reconcile');
    if (status.access !== 'payment_required' || status.purchaseState === 'pending') return status;
    const loaded = nativeProducts.get(product);
    if (!loaded || loaded.input.userId !== captured.userId || loaded.input.caseId !== captured.caseId
      || loaded.input.formId !== captured.formId || loaded.input.parentCaseId !== captured.parentCaseId
      || status.productId !== product.identifier) throw invalid();
    const module = await nativeSdk(captured);
    // Persist before reservation/checkout. An ambiguous network failure must not enable another charge.
    await AsyncStorage.setItem(pendingKey(captured), JSON.stringify({ version: 1, caseId: captured.caseId,
      formId: captured.formId, productId: product.identifier } satisfies PendingPurchase));
    assertOwner(captured);
    const prepared = await server(captured, 'prepare');
    if (prepared.access === 'granted') return prepared;
    if (prepared.recoverCaseId && prepared.purchasePrepared === false) {
      // The server identified an existing application before a new checkout started.
      await clearPending(captured);
      return prepared;
    }
    if (prepared.access !== 'payment_required' || prepared.productId !== product.identifier || prepared.purchasePrepared !== true) {
      return { ...prepared, purchaseState: 'pending' };
    }
    assertOwner(captured);
    try {
      await module.default.purchaseStoreProduct(loaded.product);
    } catch (reason) {
      assertOwner(captured);
      const code = reason && typeof reason === 'object' && 'code' in reason ? reason.code : null;
      if (code === module.PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
        const cancelled = await server(captured, 'cancel');
        await clearPending(captured);
        return cancelled.access === 'granted' ? cancelled : { ...cancelled, purchaseState: 'cancelled' };
      }
      // Pending approval, a lost response, or an unknown store error can still produce a charge.
      // Keep the reservation and receipt recovery path; never retry the store purchase automatically.
      const checked = await statusWithPending(captured, 'reconcile');
      return checked.access === 'granted' ? checked : { ...checked, purchaseState: 'pending' };
    }
    assertOwner(captured);
    const checked = await statusWithPending(captured, 'reconcile');
    return checked.access === 'granted' ? checked : { ...checked, purchaseState: 'pending' };
  });
}

/** Explicit user action only: the store may display a sign-in prompt. */
export function restoreAiPurchases(input: PaymentInput): Promise<PaymentStatus> {
  return serialized(input, async captured => {
    const existing = await statusWithPending(captured, 'reconcile');
    if (existing.access === 'granted') return existing;
    const module = await nativeSdk(captured);
    await module.default.restorePurchases();
    assertOwner(captured);
    return statusWithPending(captured, 'reconcile');
  });
}

// The native SDK automatically syncs purchaseStoreProduct. Its syncPurchases API is intended
// for integrations completing transactions themselves; refresh our server ledger instead.
export function syncAiPurchases(input: PaymentInput): Promise<PaymentStatus> { return reconcilePayment(input); }

/** Call only once cloud account deletion is confirmed. Keep pending charge protection on a failed deletion. */
export function erasePaymentAttempts(userId: string): Promise<void> {
  if (!uuid.test(userId)) return Promise.reject(accountChanged());
  // Immediately fence queued/in-flight work, then erase after it has stopped writing.
  erasedAccounts.add(userId);
  const operation = queue.then(async () => {
    for (const formId of forms.keys()) await AsyncStorage.removeItem(pendingKey({ userId, formId, caseId: userId }));
  });
  queue = operation.catch(() => undefined);
  return operation;
}
