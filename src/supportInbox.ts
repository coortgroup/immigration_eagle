import { randomUUID } from 'expo-crypto';
import { invokeCloudFunction } from './cloudClient';
import { createSupportConversation, type SupportConversationState, type SupportCursor, type SupportMessage, type SupportPage } from './supportChat';

export type ClientConversation = { userId: string; email: string; preview: string; lastCreatedAt: string; needsReply: boolean };
export type InboxCursor = { createdAt: string; userId: string };
export type InboxPage = { conversations: ClientConversation[]; hasMore: boolean; nextBefore: InboxCursor | null };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const date = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
const validMessage = (m: SupportMessage) => !!m && uuid.test(m.id || '') && ['customer','team'].includes(m.sender)
  && typeof m.body === 'string' && !!m.body.trim() && m.body.length <= 4000 && date(m.createdAt)
  && (m.clientMessageId === null || uuid.test(m.clientMessageId || ''))
  && (m.sender !== 'customer' || m.clientMessageId !== null);
export async function supportOperatorAccess(): Promise<boolean> {
  const result = await invokeCloudFunction<{ allowed: boolean }>('support-inbox', { action: 'access' });
  if (typeof result?.allowed !== 'boolean') throw new Error('Client messages could not be loaded. Please try again.');
  return result.allowed;
}
export async function listClientConversations(before?: InboxCursor): Promise<InboxPage> {
  const result = await invokeCloudFunction<InboxPage>('support-inbox', { action: 'inbox', ...(before ? { before } : {}) });
  if (!Array.isArray(result?.conversations) || result.conversations.length > 20
    || !result.conversations.every(c => !!c && uuid.test(c.userId || '') && typeof c.email === 'string' && c.email.length <= 320
      && typeof c.preview === 'string' && c.preview.length <= 480 && date(c.lastCreatedAt) && typeof c.needsReply === 'boolean')
    || new Set(result.conversations.map(c => c.userId)).size !== result.conversations.length
    || typeof result.hasMore !== 'boolean' || (result.hasMore ? !result.conversations.length || !uuid.test(result.nextBefore?.userId || '')
      || !date(result.nextBefore?.createdAt) || result.nextBefore.userId !== result.conversations.at(-1)?.userId
      || result.nextBefore.createdAt !== result.conversations.at(-1)?.lastCreatedAt : result.nextBefore !== null)) throw new Error('Client messages could not be loaded. Please try again.');
  return result;
}
export function createOperatorConversation(userId: string, onChange: (state: SupportConversationState) => void) {
  if (!uuid.test(userId)) throw new Error('Select a client conversation.');
  return createSupportConversation(onChange, {
    uuid: randomUUID,
    list: async (before?: SupportCursor) => {
      const result = await invokeCloudFunction<SupportPage>('support-inbox', { action: 'list', userId, ...(before ? { before } : {}) });
      if (!Array.isArray(result?.messages) || result.messages.length > 10 || !result.messages.every(validMessage)
        || new Set(result.messages.map(m => m.id)).size !== result.messages.length || typeof result.hasMore !== 'boolean'
        || (result.hasMore ? !result.messages.length || !uuid.test(result.nextBefore?.id || '') || !date(result.nextBefore?.createdAt)
          || result.nextBefore.id !== result.messages[0]?.id || result.nextBefore.createdAt !== result.messages[0]?.createdAt : result.nextBefore !== null)) {
        throw new Error('The conversation could not be loaded. Please try again.');
      }
      return result;
    },
    send: async (body: string, clientMessageId: string) => {
      const result = await invokeCloudFunction<{ message: SupportMessage }>('support-inbox', { action: 'reply', userId, body, clientMessageId });
      if (!validMessage(result?.message) || result.message.sender !== 'team' || result.message.clientMessageId !== clientMessageId
        || result.message.body !== body.trim()) throw new Error('Message delivery was not confirmed. Try sending the same message again.');
      return result.message;
    },
  });
}
