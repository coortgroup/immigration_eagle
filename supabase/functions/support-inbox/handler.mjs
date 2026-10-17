import { createAuthenticatedEndpoint, HttpError, UUID, serviceRpc } from '../_shared/http.mjs';
import { validateSupportInput } from '../support-chat/handler.mjs';

const invalid = () => { throw new HttpError(422, 'invalid_inbox_request', 'Check your request and try again.'); };
const isDate = value => typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
function validate(input) {
  const keys = { access: ['action'], inbox: ['action','before'], list: ['action','userId','before'], reply: ['action','userId','clientMessageId','body'] };
  if (!Object.hasOwn(keys,input.action) || Object.keys(input).some(key => !keys[input.action].includes(key))) invalid();
  if (['list','reply'].includes(input.action) && (typeof input.userId !== 'string' || !UUID.test(input.userId))) invalid();
  if (input.action === 'reply') validateSupportInput({ action: 'send', clientMessageId: input.clientMessageId, body: input.body });
  if (input.action === 'list') validateSupportInput({ action: 'list', ...(input.before === undefined ? {} : { before: input.before }) });
  if (input.action === 'inbox' && input.before !== undefined && (!input.before || typeof input.before !== 'object'
    || Object.keys(input.before).some(key => !['createdAt','userId'].includes(key))
    || !isDate(input.before.createdAt) || typeof input.before.userId !== 'string' || !UUID.test(input.before.userId))) invalid();
  return input;
}
const validMessage = m => m && UUID.test(m.id || '') && ['customer','team'].includes(m.sender)
  && typeof m.body === 'string' && m.body.length <= 4000 && !!m.body.trim() && isDate(m.createdAt)
  && (m.clientMessageId === null || UUID.test(m.clientMessageId || ''))
  && (m.sender !== 'customer' || m.clientMessageId !== null);
export function createSupportInboxHandler(options) {
  return createAuthenticatedEndpoint({ ...options, action: async ({ input, user, config, fetchImpl }) => {
    const request = validate(input);
    const access = await serviceRpc(config,'fillout_support_operator_access',{ p_operator_id: user.id },fetchImpl);
    if (typeof access?.allowed !== 'boolean') throw Error('Invalid access response');
    if (request.action === 'access') return { body: { allowed: access.allowed } };
    if (!access.allowed) throw new HttpError(403,'operator_access_required','This account does not have access to client messages.');
    // Every data RPC rechecks membership so revocation also takes effect between calls.
    const params = { p_operator_id: user.id };
    if (request.action === 'inbox') {
      const result = await serviceRpc(config,'fillout_support_inbox',{ ...params,
        p_before_created_at: request.before?.createdAt ?? null, p_before_user_id: request.before?.userId ?? null },fetchImpl);
      if (!Array.isArray(result?.conversations) || result.conversations.length > 20
        || !result.conversations.every(c => c && UUID.test(c.userId || '') && typeof c.email === 'string' && c.email.length <= 320
          && typeof c.preview === 'string' && c.preview.length <= 480 && isDate(c.lastCreatedAt) && typeof c.needsReply === 'boolean')
        || new Set(result.conversations.map(c => c.userId)).size !== result.conversations.length
        || typeof result.hasMore !== 'boolean' || (result.hasMore ? !result.conversations.length
          || !UUID.test(result.nextBefore?.userId || '') || !isDate(result.nextBefore?.createdAt)
          || result.nextBefore.userId !== result.conversations.at(-1)?.userId
          || result.nextBefore.createdAt !== result.conversations.at(-1)?.lastCreatedAt : result.nextBefore !== null)) throw Error('Invalid inbox');
      return { body: result };
    }
    if (request.action === 'reply') {
      const message = await serviceRpc(config,'fillout_support_reply',{ ...params,p_user_id: request.userId,
        p_client_message_id: request.clientMessageId.toLowerCase(),p_body: request.body.trim() },fetchImpl);
      if (!validMessage(message) || message.sender !== 'team' || message.body !== request.body.trim()
        || message.clientMessageId !== request.clientMessageId.toLowerCase()) throw Error('Invalid reply receipt');
      return { status: 201, body: { message } };
    }
    const result = await serviceRpc(config,'fillout_support_operator_list',{ ...params,p_user_id: request.userId,
      p_before_created_at: request.before?.createdAt ?? null,p_before_id: request.before?.id ?? null },fetchImpl);
    if (!Array.isArray(result?.messages) || result.messages.length > 10 || !result.messages.every(validMessage)
      || new Set(result.messages.map(m => m.id)).size !== result.messages.length
      || typeof result.hasMore !== 'boolean' || (result.hasMore ? !result.messages.length || !UUID.test(result.nextBefore?.id || '')
        || !isDate(result.nextBefore?.createdAt) || result.nextBefore.id !== result.messages[0]?.id
        || result.nextBefore.createdAt !== result.messages[0]?.createdAt : result.nextBefore !== null)) throw Error('Invalid conversation');
    return { body: result };
  } });
}
