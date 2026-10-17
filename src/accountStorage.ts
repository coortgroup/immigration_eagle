import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { randomUUID, getRandomBytes } from 'expo-crypto';

// Native sessions live in Keychain/Keystore, never alongside preparation drafts.
// A generation manifest commits all chunks together, including large auth tokens.
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
let pending: Promise<unknown> = Promise.resolve();
function serialized<T>(action: () => Promise<T>): Promise<T> {
  const work = pending.then(action);
  pending = work.catch(() => undefined);
  return work;
}
function storageKey(key: string) { return `fillout.auth.${encodeURIComponent(key).replace(/%/g, '_')}`; }
type Manifest = { generation: string; count: number };
function readManifest(raw: string | null): Manifest | null {
  if (!raw) return null;
  const value = JSON.parse(raw);
  if (!value || !/^[a-f0-9-]{36}$/.test(value.generation) || !Number.isInteger(value.count) || value.count < 1 || value.count > 128) {
    throw new Error('Your saved sign-in could not be read. Please try again.');
  }
  return value;
}
async function removeChunks(key: string, manifest: Manifest | null) {
  if (!manifest) return;
  await Promise.all(Array.from({ length: manifest.count }, (_, index) =>
    SecureStore.deleteItemAsync(`${key}.${manifest.generation}.${index}`, options)));
}
export const accountStorage = {
  getItem(key: string): Promise<string | null> {
    return serialized(async () => {
      if (Platform.OS === 'web') return AsyncStorage.getItem(key);
      const base = storageKey(key);
      const manifest = readManifest(await SecureStore.getItemAsync(base, options));
      if (!manifest) {
        // A previous removal can lose its manifest before chunk erasure succeeds.
        // Finish the recorded purge before reporting an empty store after restart.
        const removing = readManifest(await SecureStore.getItemAsync(`${base}.deleting`, options));
        if (removing) { await removeChunks(base, removing); await SecureStore.deleteItemAsync(`${base}.deleting`, options); }
        return null;
      }
      const chunks = await Promise.all(Array.from({ length: manifest.count }, (_, index) =>
        SecureStore.getItemAsync(`${base}.${manifest.generation}.${index}`, options)));
      if (chunks.some(chunk => chunk === null)) throw new Error('Your saved sign-in could not be read. Please try again.');
      return chunks.join('');
    });
  },
  setItem(key: string, value: string): Promise<void> {
    return serialized(async () => {
      if (Platform.OS === 'web') return AsyncStorage.setItem(key, value);
      // 400 Unicode code points stay below 2 KB without splitting surrogate pairs.
      const chunks = value.match(/[\s\S]{1,400}/gu) || [''];
      if (chunks.length > 128) throw new Error('Your sign-in is too large to save on this device.');
      const base = storageKey(key);
      const previous = readManifest(await SecureStore.getItemAsync(base, options));
      const next = { generation: randomUUID(), count: chunks.length };
      try {
        for (let i = 0; i < chunks.length; i++) await SecureStore.setItemAsync(`${base}.${next.generation}.${i}`, chunks[i], options);
        await SecureStore.setItemAsync(base, JSON.stringify(next), options);
      } catch (error) {
        await removeChunks(base, next).catch(() => undefined);
        throw error;
      }
      await removeChunks(base, previous).catch(() => undefined);
    });
  },
  removeItem(key: string): Promise<void> {
    return serialized(async () => {
      if (Platform.OS === 'web') return AsyncStorage.removeItem(key);
      const base = storageKey(key);
      const previous = readManifest(await SecureStore.getItemAsync(base, options));
      const removing = readManifest(await SecureStore.getItemAsync(`${base}.deleting`, options));
      if (removing && (!previous || removing.generation !== previous.generation)) await removeChunks(base, removing);
      if (previous) await SecureStore.setItemAsync(`${base}.deleting`, JSON.stringify(previous), options);
      await SecureStore.deleteItemAsync(base, options);
      await removeChunks(base, previous || removing);
      await SecureStore.deleteItemAsync(`${base}.deleting`, options);
    });
  },
};

export type GuestProfile = { id: string; name: string; email: string; phone: string };
export type AccountPolicy = { loginRequired: boolean; guestClaimedBy?: string; guestDraftOwner?: string };
const PROFILE_KEY = 'fillout.guest-profile.v1';
const POLICY_KEY = 'fillout.account-policy.v1';
let guestProfileLoad: Promise<GuestProfile> | undefined;
export async function readAccountPolicy(): Promise<AccountPolicy> {
  const raw = await accountStorage.getItem(POLICY_KEY);
  if (!raw) return { loginRequired: false };
  const value = JSON.parse(raw);
  if (typeof value?.loginRequired !== 'boolean' || (value.guestClaimedBy !== undefined && typeof value.guestClaimedBy !== 'string') || (value.guestDraftOwner !== undefined && !/^guest-[a-f0-9-]{36}$/.test(value.guestDraftOwner))) {
    throw new Error('Your account settings could not be read. Please try again.');
  }
  return value;
}
export function saveAccountPolicy(value: AccountPolicy) { return accountStorage.setItem(POLICY_KEY, JSON.stringify(value)); }
export function loadGuestProfile(): Promise<GuestProfile> {
  // Share the entire read/create transaction across simultaneous hydration effects.
  // Serial storage calls alone still allow two readers to observe a missing profile.
  if (!guestProfileLoad) {
    guestProfileLoad = readOrCreateGuestProfile().finally(() => { guestProfileLoad = undefined; });
  }
  return guestProfileLoad;
}
async function readOrCreateGuestProfile(): Promise<GuestProfile> {
  const raw = await accountStorage.getItem(PROFILE_KEY);
  if (raw) {
    const profile = JSON.parse(raw);
    if (['id', 'name', 'email', 'phone'].every(key => typeof profile?.[key] === 'string')) return profile;
    throw new Error('Your profile could not be read. Please try again.');
  }
  const profile = { id: randomUUID(), name: '', email: '', phone: '' };
  await saveGuestProfile(profile);
  return profile;
}
export function saveGuestProfile(profile: GuestProfile) {
  return accountStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export type AccountDeletion = {
  ownerId: string | null; userId: string | null; email: string | null; deletionToken: string;
  guestDraftOwner: string; cloudDeleted: boolean; clearLegacyGuest: boolean;
};
const DELETION_KEY = 'fillout.account-deletion.v1';
export async function readAccountDeletion(): Promise<AccountDeletion | null> {
  const raw = await accountStorage.getItem(DELETION_KEY);
  if (!raw) return null;
  const value = JSON.parse(raw);
  const owner = (id: unknown) => id === null || typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(id);
  if (!owner(value?.ownerId) || !owner(value?.userId) || !/^[0-9a-f]{64}$/.test(value?.deletionToken || '')
    || !(value?.email === null || typeof value?.email === 'string' && value.email.length <= 254)
    || !/^guest-[a-f0-9-]{36}$/.test(value?.guestDraftOwner || '') || typeof value?.cloudDeleted !== 'boolean'
    || typeof value?.clearLegacyGuest !== 'boolean') throw new Error('Your account deletion could not be read. Please try again.');
  return value;
}
export function newAccountDeletion(ownerId: string | null, userId: string | null, clearLegacyGuest: boolean, email: string | null): AccountDeletion {
  return { ownerId, userId, email, clearLegacyGuest, cloudDeleted: !userId, guestDraftOwner: `guest-${randomUUID()}`,
    deletionToken: Array.from(getRandomBytes(32), byte => byte.toString(16).padStart(2, '0')).join('') };
}
export function saveAccountDeletion(value: AccountDeletion) { return accountStorage.setItem(DELETION_KEY, JSON.stringify(value)); }
export function clearAccountDeletion() { return accountStorage.removeItem(DELETION_KEY); }
export async function resetDeletedAccountProfile(guestDraftOwner: string): Promise<{ guest: GuestProfile; policy: AccountPolicy }> {
  // The durable deletion journal stays until every removal/reset has succeeded.
  // Repeating these writes after a crash cannot restore the removed profile.
  if (guestProfileLoad) await guestProfileLoad;
  await serialized(async () => {
    if (Platform.OS === 'web') return AsyncStorage.removeItem(PROFILE_KEY);
    const base = storageKey(PROFILE_KEY);
    const manifest = readManifest(await SecureStore.getItemAsync(base, options));
    // Keep the manifest until all private chunks are erased so a failed purge can retry.
    await removeChunks(base, manifest);
    await SecureStore.deleteItemAsync(base, options);
  });
  const guest = { id: guestDraftOwner.slice(6), name: '', email: '', phone: '' };
  const policy = { loginRequired: false, guestDraftOwner };
  await saveGuestProfile(guest);
  await saveAccountPolicy(policy);
  return { guest, policy };
}
