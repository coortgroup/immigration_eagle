import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { createClient, FunctionsHttpError, type User } from '@supabase/supabase-js';

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
      const limit = 1_048_576;
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
  auth: { persistSession: false, detectSessionInUrl: false, autoRefreshToken: true },
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
  client.auth.onAuthStateChange((_event, session) => { updateSession(session?.user || null); });
  void client.auth.getSession().then(({ data, error }) => {
    updateSession(data.session?.user || null, error ? 'Please verify your email again to continue.' : null);
  }).catch(() => updateSession(null, 'Could not check your sign-in. Please try again.'));
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
  if (!/^\d{6}$/.test(code.trim())) throw new Error('Enter the six-digit code from your email.');
  const { data, error } = await requireClient().auth.verifyOtp({ email: cleanEmail(email), token: code.trim(), type: 'email' });
  if (error || !verifiedUser(data.user) || !data.session) throw new Error('This code is invalid or expired. Check your email or request a new code.');
  updateSession(data.user);
}

export async function signOutCloud(): Promise<void> {
  const { error } = await requireClient().auth.signOut({ scope: 'local' });
  if (error) throw new Error('Could not sign out. Please try again.');
  updateSession(null);
}

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
