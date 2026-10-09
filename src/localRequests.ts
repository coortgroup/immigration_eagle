import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

export type LocalRequest = {
  type: 'contact' | 'attorney';
  name: string;
  email?: string;
  phone?: string;
  question: string;
  formId?: string;
};

function localOrigin(): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const { hostname, origin } = window.location;
  return ['127.0.0.1', 'localhost', '[::1]'].includes(hostname) ? origin : null;
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const origin = localOrigin();
  if (!origin) throw new Error('Request delivery is available in the local website only.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    return await fetch(origin + path, { ...init, signal: controller.signal, cache: 'no-store', credentials: 'same-origin' });
  } catch {
    throw new Error('Could not reach the local inbox. Keep this page open and try again.');
  } finally {
    clearTimeout(timer);
  }
}

export function useLocalDelivery() {
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    let active = true;
    if (!localOrigin()) { setChecking(false); return; }
    request('/api/status').then(async response => {
      if (!response.ok) return;
      const data = await response.json();
      if (active) setAvailable(data.local === true && data.contactDelivery === 'local-inbox');
    }).catch(() => undefined).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);
  return { available, checking };
}

export async function submitLocalRequest(payload: LocalRequest): Promise<{ id: string }> {
  const response = await request('/api/requests', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'The request could not be saved. Please try again.');
  if (typeof data?.id !== 'string' || data.delivery !== 'local-inbox') throw new Error('The server did not confirm delivery. Check the local inbox before trying again.');
  return { id: data.id };
}
