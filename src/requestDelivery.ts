import { useCallback, useRef } from 'react';
import { randomUUID } from 'expo-crypto';
import { cloudConfigured, cloudConfigurationError, cloudRequested, invokeCloudFunction, useCloudSession } from './cloudClient';
import { submitLocalRequest, useLocalDelivery, type LocalRequest } from './localRequests';

export type RequestPayload = LocalRequest;
export type RequestReceipt = { id: string; requestId?: string; delivery: 'team-inbox' | 'local-inbox'; externalNotification: false };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function useRequestDelivery() {
  const local = useLocalDelivery();
  const session = useCloudSession();
  return {
    cloud: cloudRequested,
    available: cloudRequested ? cloudConfigured : local.available,
    checking: cloudRequested ? session.loading : local.checking,
    canSubmit: cloudRequested ? cloudConfigured && Boolean(session.user) && !session.loading : local.available,
    user: session.user,
    error: cloudConfigurationError,
  };
}

// A failed/uncertain response can be retried without creating another team request.
// Editing starts a new request; the authenticated account is part of its identity.
export function useRequestIdentity() {
  const previous = useRef<{ fingerprint: string; id: string } | null>(null);
  const reset = useCallback(() => { previous.current = null; }, []);
  const getId = useCallback((payload: RequestPayload, userId?: string) => {
    const fingerprint = JSON.stringify([userId || 'local', payload]);
    if (previous.current?.fingerprint !== fingerprint) previous.current = { fingerprint, id: randomUUID() };
    return previous.current.id;
  }, []);
  return { reset, getId };
}

export async function submitRequest(payload: RequestPayload, requestId: string): Promise<RequestReceipt> {
  if (!cloudRequested) {
    const result = await submitLocalRequest(payload);
    return { id: result.id, delivery: 'local-inbox', externalNotification: false };
  }
  if (!cloudConfigured) throw new Error(cloudConfigurationError || 'Online request delivery is not configured.');
  const result = await invokeCloudFunction<RequestReceipt>('submit-request', { ...payload, requestId });
  if (typeof result?.id !== 'string' || !uuidPattern.test(result.id) || result.requestId !== requestId
    || result.delivery !== 'team-inbox' || result.externalNotification !== false) {
    throw new Error('The server did not confirm delivery. Keep this request unchanged and try again.');
  }
  return result;
}
