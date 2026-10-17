import { createAuthenticatedEndpoint, HttpError, UUID, serviceRpc } from '../_shared/http.mjs';

const invalid = () => { throw new HttpError(422, 'invalid_message', 'Check your message and try again.'); };
const isDate = value => typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));

export function validateSupportInput(input) {
  if (input.action === 'send') {
    if (Object.keys(input).some(key => !['action', 'clientMessageId', 'body'].includes(key))
      || typeof input.clientMessageId !== 'string' || !UUID.test(input.clientMessageId)
      || typeof input.body !== 'string' || !input.body.trim() || input.body.length > 2000
      || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input.body)) invalid();
    return { action: 'send', clientMessageId: input.clientMessageId.toLowerCase(), body: input.body.trim() };
  }
  if (input.action !== 'list' || Object.keys(input).some(key => !['action', 'before'].includes(key))) invalid();
  if (input.before !== undefined && (!input.before || typeof input.before !== 'object' || Array.isArray(input.before)
    || Object.keys(input.before).some(key => !['createdAt', 'id'].includes(key))
    || !isDate(input.before.createdAt) || typeof input.before.id !== 'string' || !UUID.test(input.before.id))) invalid();
  return { action: 'list', before: input.before };
}

function validMessage(message) {
  return message && typeof message.id === 'string' && UUID.test(message.id) && ['customer', 'team'].includes(message.sender)
    && typeof message.body === 'string' && message.body.trim() && message.body.length <= 4000
    && isDate(message.createdAt) && (message.clientMessageId === null || typeof message.clientMessageId === 'string' && UUID.test(message.clientMessageId))
    && (message.sender !== 'customer' || message.clientMessageId !== null);
}

export function createSupportChatHandler(options) {
  return createAuthenticatedEndpoint({
    ...options,
    action: async ({ input, user, config, fetchImpl }) => {
      const request = validateSupportInput(input);
      if (request.action === 'send') {
        const message = await serviceRpc(config, 'fillout_support_send', {
          p_user_id: user.id, p_client_message_id: request.clientMessageId, p_body: request.body,
        }, fetchImpl);
        if (!validMessage(message) || message.sender !== 'customer' || message.clientMessageId !== request.clientMessageId
          || message.body !== request.body) throw new Error('Invalid message receipt');
        return { status: 201, body: { message } };
      }
      const result = await serviceRpc(config, 'fillout_support_list', {
        p_user_id: user.id, p_before_created_at: request.before?.createdAt ?? null, p_before_id: request.before?.id ?? null,
      }, fetchImpl);
      if (!result || !Array.isArray(result.messages) || result.messages.length > 10 || !result.messages.every(validMessage)
        || typeof result.hasMore !== 'boolean' || (result.hasMore && (!UUID.test(result.nextBefore?.id || '')
          || !isDate(result.nextBefore?.createdAt))) || (!result.hasMore && result.nextBefore !== null)) {
        throw new Error('Invalid conversation response');
      }
      return { body: result };
    },
  });
}
