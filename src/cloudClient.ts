import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { createClient, FunctionsHttpError, type User } from '@supabase/supabase-js';
import { accountStorage } from './accountStorage';

// Expo replaces these public values at build time. A service-role key must never be used here.
const projectUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || '';
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || '';
export const cloudRequested = Boolean(projectUrl || publishableKey);

function validProjectUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /^[a-z0-9]+(?:-[a-z0-9]+)*\.supabase\.co$/.test(url.hostname)
      && !url.port && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/';
  } catch { return false; }
}

export const cloudConfigured = validProjectUrl(projectUrl) && /^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey);
export const cloudConfigurationError = cloudRequested && !cloudConfigured
  ? 'Online services are not configured correctly. Please contact the FILLOUT team.' : null;

// Bound every auth/function request, including when a mobile connection stalls.
async function boundedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const originalSignal = init?.signal || (typeof input === 'object' && 'signal' in input ? input.signal : null);
  let rejectDeadline: (reason: Error) => void = () => undefined;
  const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
  const abort = () => { controller.abort(); rejectDeadline(new Error('The online request timed out or was cancelled.')); };
  const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const timer = setTimeout(abort, requestUrl.includes('/functions/v1/') ? 55_000 : 25_000);
  if (originalSignal?.aborted) abort();
  else originalSignal?.addEventListener('abort', abort, { once: true });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    // Supabase parses the body after fetch resolves. Buffer it here so the same
    // deadline and size cap cover a stalled or unexpectedly large JSON body.
    return await Promise.race([deadline, (async () => {
      const response = await fetch(input, { ...init, signal: controller.signal });
      // A reviewed PDF is returned through this authenticated endpoint only.
      // Keep auth, chat, and every other service at their existing small limit.
      const limit = requestUrl === `${projectUrl.replace(/\/$/, '')}/functions/v1/form-review` ? 12 * 1024 * 1024 : 1_048_576;
      const declaredLength = Number(response.headers.get('content-length'));
      if (declaredLength > limit) throw new Error('The online response is too large.');
      let bytes: Uint8Array<ArrayBuffer>;
      if (response.body?.getReader) {
        reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > limit) throw new Error('The online response is too large.');
          chunks.push(value);
        }
        bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      } else {
        // Some React Native fetch implementations do not expose a readable stream.
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > limit) throw new Error('The online response is too large.');
        bytes = new Uint8Array(buffer);
      }
      return new Response([204, 205, 304].includes(response.status) ? null : bytes, {
        status: response.status, statusText: response.statusText, headers: response.headers,
      });
    })()]);
  } finally {
    clearTimeout(timer); originalSignal?.removeEventListener('abort', abort);
    controller.abort();
    void reader?.cancel().catch(() => undefined);
  }
}

const client = cloudConfigured ? createClient(projectUrl, publishableKey, {
  auth: { persistSession: true, storage: accountStorage, detectSessionInUrl: false, autoRefreshToken: true },
  global: { fetch: boundedFetch },
}) : null;

type SessionState = { configured: boolean; user: User | null; loading: boolean; error: string | null };
let state: SessionState = { configured: cloudConfigured, user: null, loading: cloudConfigured, error: cloudConfigurationError };
const listeners = new Set<() => void>();
function verifiedUser(user: User | null | undefined): User | null {
  return user?.email && user.email_confirmed_at && !user.is_anonymous ? user : null;
}
function updateSession(user: User | null, error: string | null = null) {
  state = { configured: cloudConfigured, user: verifiedUser(user), loading: false, error };
  listeners.forEach(listener => listener());
}
if (client) {
  let sessionRevision = 0;
  client.auth.onAuthStateChange((_event, session) => { sessionRevision++; updateSession(session?.user || null); });
  const initialRevision = sessionRevision;
  void client.auth.getSession().then(({ data, error }) => {
    if (sessionRevision === initialRevision) updateSession(data.session?.user || null, error ? 'Please sign in again to continue.' : null);
  }).catch(() => { if (sessionRevision === initialRevision) updateSession(null, 'Could not check your sign-in. Please try again.'); });
  if (Platform.OS !== 'web') {
    if (AppState.currentState === 'active') client.auth.startAutoRefresh();
    else client.auth.stopAutoRefresh();
    AppState.addEventListener('change', status => {
      if (status === 'active') client.auth.startAutoRefresh();
      else client.auth.stopAutoRefresh();
    });
  }
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const getSnapshot = () => state;
export function useCloudSession(): SessionState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function requireClient() {
  if (!client) throw new Error(cloudConfigurationError || 'Online services are not connected yet.');
  return client;
}
function cleanEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
  return email;
}

export async function requestEmailCode(email: string): Promise<void> {
  const { error } = await requireClient().auth.signInWithOtp({ email: cleanEmail(email), options: { shouldCreateUser: true } });
  if (error) throw new Error(error.status === 429
    ? 'Please wait before requesting another code.' : 'The verification email could not be sent. Please try again.');
}

export async function verifyEmailCode(email: string, code: string): Promise<void> {
  if (!/^\d{8}$/.test(code.trim())) throw new Error('Enter the eight-digit code from your email.');
  const { data, error } = await requireClient().auth.verifyOtp({ email: cleanEmail(email), token: code.trim(), type: 'email' });
  if (error || !verifiedUser(data.user) || !data.session) throw new Error('This code is invalid or expired. Check your email or request a new code.');
  updateSession(data.user);
}

export type AccountDetails = { name?: string; email: string; phone: string };
function cleanProfile(profile: Pick<AccountDetails, 'name' | 'phone'>) {
  const name = profile.name?.trim();
  const phone = profile.phone.trim();
  if (name && name.length > 120) throw new Error('Enter your name (up to 120 characters).');
  if (!phone) throw new Error('Enter your phone number.');
  if (!/^\+?[\d\s().-]+$/.test(phone) || phone.replace(/\D/g, '').length < 7 || phone.replace(/\D/g, '').length > 15) {
    throw new Error('Enter a valid phone number, including its country code if needed.');
  }
  // Names are no longer collected here. Omission preserves an existing name.
  return { ...(name ? { full_name: name } : {}), phone };
}
function checkPassword(password: string) {
  if (!password) throw new Error('Enter your password.');
}
function passwordServiceError(error: { code?: string; message?: string }): string | undefined {
  if (error.code === 'validation_failed' && /^Password cannot be longer than \d+ characters\.?$/i.test(error.message || '')) {
    return 'This password is too long for the sign-in service. Use a shorter password.';
  }
  if (error.code !== 'weak_password') return undefined;
  const minimum = error.message?.match(/at least (\d{1,3}) characters/i)?.[1];
  return minimum ? `The sign-in service requires at least ${minimum} characters.`
    : 'The sign-in service did not accept this password. Choose another password.';
}
export async function signUpWithPassword(profile: AccountDetails, password: string) {
  const email = cleanEmail(profile.email);
  const details = cleanProfile(profile);
  checkPassword(password);
  const { data, error } = await requireClient().auth.signUp({ email, password, options: { data: { ...details, fillout_password_account: true } } });
  if (error) throw new Error(passwordServiceError(error) || (error.status === 429 ? 'Please wait before trying again.' : 'Your account could not be created. Try signing in or requesting an email code.'));
  if (data.session && verifiedUser(data.user)) updateSession(data.user);
  // Existing unconfirmed OTP users keep their original credentials on signup.
  // Only the server-returned marker can confirm this app created their password.
  return { confirmationRequired: !data.session, email, passwordSetupRequired: data.user?.user_metadata?.fillout_password_account !== true };
}
export async function signInWithPassword(email: string, password: string): Promise<void> {
  checkPassword(password);
  const { data, error } = await requireClient().auth.signInWithPassword({ email: cleanEmail(email), password });
  if (error || !data.session || !verifiedUser(data.user)) throw new Error('Could not sign in. Check your email and password, and confirm your email if you just registered.');
  updateSession(data.user);
}
/** Recovery uses a verified email code and never silently creates a new account. */
export async function requestSignInCode(email: string): Promise<void> {
  const { error } = await requireClient().auth.signInWithOtp({ email: cleanEmail(email), options: { shouldCreateUser: false } });
  if (error) throw new Error(error.status === 429 ? 'Please wait before requesting another code.' : 'The verification email could not be sent. Please try again.');
}
export async function saveCloudProfile(profile: Pick<AccountDetails, 'name' | 'phone'>): Promise<void> {
  if (!state.user) throw new Error('Please sign in again to continue.');
  const expected = state.user.id;
  const { data, error } = await requireClient().auth.updateUser({ data: cleanProfile(profile) });
  if (error || !data.user || data.user.id !== expected || state.user?.id !== expected) throw new Error('Your profile could not be saved. Please try again.');
  updateSession(data.user);
}
export async function changeCloudPassword(password: string): Promise<void> {
  checkPassword(password);
  if (!state.user) throw new Error('Please sign in again to continue.');
  const expected = state.user.id;
  const { data, error } = await requireClient().auth.updateUser({ password, data: { fillout_password_account: true } });
  if (error && state.user?.id === expected) throw new Error(passwordServiceError(error) || 'Your password could not be updated. Request a fresh email code and try again.');
  if (error || !data.user || data.user.id !== expected || state.user?.id !== expected) throw new Error('Your password could not be updated. Request a fresh email code and try again.');
  updateSession(data.user);
}
export async function requestCloudEmailChange(email: string, password: string): Promise<boolean> {
  const nextEmail = cleanEmail(email);
  const current = state.user;
  if (!current?.email) throw new Error('Please sign in again to continue.');
  // Verify current credentials before changing the account's login identity.
  await signInWithPassword(current.email, password);
  if (state.user?.id !== current.id) throw new Error('Your signed-in account changed. Review your details and try again.');
  const { data, error } = await requireClient().auth.updateUser({ email: nextEmail });
  if (error || !data.user || data.user.id !== current.id || state.user?.id !== current.id) throw new Error('Your email could not be updated. Please try again.');
  updateSession(data.user);
  return data.user.email !== nextEmail;
}
export async function refreshCloudUser(): Promise<void> {
  const api = requireClient();
  const expected = state.user?.id;
  if (!expected) throw new Error('Please sign in again to continue.');
  // getUser only reads the server profile. Refresh the session as well so a
  // confirmed email change survives reopening the app before token expiry.
  const { data, error } = await api.auth.refreshSession();
  if (error) throw new Error('Could not check your sign-in. Please try again.');
  if (state.user?.id !== expected) return;
  if (!data.session || !verifiedUser(data.user) || data.user?.id !== expected) {
    throw new Error('Could not check your sign-in. Please try again.');
  }
  updateSession(data.user);
}

export async function signOutCloud(): Promise<void> {
  const { error } = await requireClient().auth.signOut({ scope: 'local' });
  if (error) throw new Error('Could not sign out. Please try again.');
  updateSession(null);
}

/** Capture the authenticated owner before and after a store operation. */
export function getCloudUserId(): string | null { return state.user?.id || null; }

export async function invokeCloudFunction<T>(name: string, body: unknown): Promise<T> {
  const api = requireClient();
  const expectedUserId = state.user?.id;
  const { data: sessionData, error: sessionError } = await api.auth.getSession();
  if (sessionError || !verifiedUser(sessionData.session?.user) || !sessionData.session?.access_token) {
    throw new Error('Verify your email before continuing.');
  }
  if (expectedUserId && (sessionData.session.user.id !== expectedUserId || state.user?.id !== expectedUserId)) {
    throw new Error('Your signed-in account changed. Review your details and try again.');
  }
  const { data, error } = await api.functions.invoke<T>(name, {
    body: body as Record<string, unknown>, headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
  });
  if (expectedUserId && state.user?.id !== expectedUserId) {
    throw new Error('Your signed-in account changed. Review your details and try again.');
  }
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const response = await error.context.json().catch(() => null);
      const message = response?.error?.message;
      if (typeof message === 'string' && message.length > 0 && message.length <= 400) throw new Error(message);
    }
    throw new Error('Could not reach the online service. Please keep this screen open and try again.');
  }
  if (data === null || data === undefined) throw new Error('The server did not confirm the result. Please try again.');
  return data;
}

/** Retry carries only a random deletion capability, including after Auth removes the session. */
export async function deleteCloudAccount(deletionToken: string, expectedUserId: string): Promise<void> {
  const api = requireClient();
  if (state.user && state.user.id !== expectedUserId) throw new Error('Your signed-in account changed. Review your details and try again.');
  const { data } = await api.auth.getSession();
  const token = data.session?.user.id === expectedUserId ? data.session.access_token : undefined;
  const response = await boundedFetch(`${projectUrl.replace(/\/$/, '')}/functions/v1/delete-account`, {
    method: 'POST', headers: { apikey: publishableKey, 'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ confirmation: 'DELETE', deletionToken }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.deleted !== true) {
    const message = result?.error?.message;
    throw new Error(typeof message === 'string' && message.length <= 400 ? message : 'Account deletion has not been confirmed. Keep this screen open and try again.');
  }
}
