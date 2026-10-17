import { randomUUID } from 'expo-crypto';
import { invokeCloudFunction } from './cloudClient';

export type SupportMessage = {
  id: string;
  clientMessageId: string | null;
  sender: 'customer' | 'team';
  body: string;
  createdAt: string;
};
export type SupportCursor = { createdAt: string; id: string };
export type SupportPage = { messages: SupportMessage[]; hasMore: boolean; nextBefore: SupportCursor | null };
export type SupportConversationState = {
  messages: SupportMessage[];
  loading: boolean;
  sending: boolean;
  error: string;
  older: SupportCursor | null;
};
// Account-scoped screens remount after login. Carry only an explicitly handed-off
// guest composer through that transition; never mark it delivered or send it.
let loginDraft = '';
export function rememberSupportLoginDraft(body: string) { loginDraft = body.slice(0, 2000); }
export function takeSupportLoginDraft() { const body = loginDraft; loginDraft = ''; return body; }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const date = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
function validMessage(value: unknown): value is SupportMessage {
  const message = value as SupportMessage | undefined;
  return !!message && typeof message.id === 'string' && uuid.test(message.id)
    && ['customer', 'team'].includes(message.sender) && typeof message.body === 'string' && !!message.body.trim()
    && message.body.length <= 4000 && date(message.createdAt)
    && (message.clientMessageId === null || typeof message.clientMessageId === 'string' && uuid.test(message.clientMessageId))
    && (message.sender !== 'customer' || message.clientMessageId !== null);
}
export async function listSupportMessages(before?: SupportCursor): Promise<SupportPage> {
  const result = await invokeCloudFunction<SupportPage>('support-chat', { action: 'list', ...(before ? { before } : {}) });
  if (!result || !Array.isArray(result.messages) || result.messages.length > 10 || !result.messages.every(validMessage)
    || new Set(result.messages.map(message => message.id)).size !== result.messages.length
    || typeof result.hasMore !== 'boolean' || (result.hasMore && (!result.messages.length || !uuid.test(result.nextBefore?.id || '')
      || !date(result.nextBefore?.createdAt))) || (!result.hasMore && result.nextBefore !== null)) {
    throw new Error('The conversation could not be loaded. Please try again.');
  }
  return result;
}
export async function sendSupportMessage(body: string, clientMessageId: string): Promise<SupportMessage> {
  if (!body.trim() || body.length > 2000 || !uuid.test(clientMessageId)) throw new Error('Enter a message of up to 2,000 characters.');
  const result = await invokeCloudFunction<{ message: SupportMessage }>('support-chat', { action: 'send', body: body.trim(), clientMessageId });
  if (!validMessage(result?.message) || result.message.clientMessageId !== clientMessageId || result.message.sender !== 'customer'
    || result.message.body !== body.trim()) {
    throw new Error('Message delivery was not confirmed. Try sending the same message again.');
  }
  return result.message;
}

export function mergeSupportMessages(previous: SupportMessage[], incoming: SupportMessage[]): SupportMessage[] {
  const all = new Map(previous.map(message => [message.id, message]));
  incoming.forEach(message => all.set(message.id, message));
  return [...all.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
    || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** Per-account lifecycle: disposed operations cannot publish a previous account's messages. */
export function createSupportConversation(onChange: (state: SupportConversationState) => void, api = {
  list: listSupportMessages, send: sendSupportMessage, uuid: randomUUID,
}) {
  let active = true;
  let listing = false;
  let sendPending = false;
  let retry: { body: string; id: string } | null = null;
  let loaded = false;
  let state: SupportConversationState = { messages: [], loading: false, sending: false, error: '', older: null };
  const update = (patch: Partial<SupportConversationState>) => { if (active) { state = { ...state, ...patch }; onChange(state); } };
  async function refresh(earlier = false) {
    if (!active || listing || (earlier && !state.older)) return;
    listing = true;
    update({ loading: true, error: '' });
    try {
      let page = await api.list(earlier ? state.older! : undefined);
      let received = page.messages;
      // Catch up through all unseen pages, so multiple replies between polls do not leave a gap.
      if (!earlier && loaded && state.messages.length) {
        const known = new Set(state.messages.map(message => message.id));
        const visited = new Set<string>();
        while (active && page.hasMore && !page.messages.some(message => known.has(message.id))) {
          const key = JSON.stringify(page.nextBefore);
          if (visited.has(key)) throw new Error('The conversation could not be loaded. Please try again.');
          visited.add(key);
          page = await api.list(page.nextBefore!);
          received = [...page.messages, ...received];
        }
      }
      if (!active) return;
      update({ messages: mergeSupportMessages(state.messages, received),
        ...(!loaded || earlier ? { older: page.nextBefore } : {}) });
      loaded = true;
    } catch (error) {
      update({ error: error instanceof Error ? error.message : 'The conversation could not be loaded. Please try again.' });
    } finally { listing = false; update({ loading: false }); }
  }
  async function send(body: string): Promise<boolean> {
    if (!active || sendPending || !body.trim() || body.length > 2000) return false;
    const normalized = body.trim();
    if (retry?.body !== normalized) retry = { body: normalized, id: api.uuid() };
    sendPending = true;
    update({ sending: true, error: '' });
    try {
      const message = await api.send(normalized, retry.id);
      if (!active) return false;
      update({ messages: mergeSupportMessages(state.messages, [message]) });
      retry = null;
      return true;
    } catch (error) {
      update({ error: error instanceof Error ? error.message : 'Message delivery was not confirmed. Try sending the same message again.' });
      return false;
    } finally { sendPending = false; update({ sending: false }); }
  }
  return { refresh, send, dispose() { active = false; retry = null; } };
}
