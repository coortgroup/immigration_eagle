import { createAuthenticatedEndpoint, HttpError, UUID, serviceRpc } from '../_shared/http.mjs';
import { FORM_IDS } from '../_shared/form-ids.mjs';

export function validateRequest(input) {
  const allowed = new Set(['requestId', 'type', 'name', 'email', 'phone', 'question', 'formId', 'attorneyConsent']);
  const fields = {};
  if (Object.keys(input).some(key => !allowed.has(key))) fields.request = 'Unexpected fields are not accepted.';
  const value = {};
  for (const key of allowed) {
    if (input[key] !== undefined && typeof input[key] !== 'string') fields[key] = 'Use text for this field.';
    value[key] = typeof input[key] === 'string' ? input[key].trim() : '';
  }
  if (!UUID.test(value.requestId)) fields.requestId = 'Use a valid request ID.';
  if (!['contact', 'attorney'].includes(value.type)) fields.type = 'Choose a valid request type.';
  if (!value.name || value.name.length > 150 || /[\x00-\x1f\x7f]/.test(value.name)) fields.name = 'Enter a name of up to 150 characters.';
  if (!value.email && !value.phone) fields.email = 'Enter an email address or phone number.';
  if (value.email && (value.email.length > 254 || !/^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+\.[^\s@\x00-\x1f\x7f]+$/.test(value.email))) fields.email = 'Enter a valid email address.';
  if (value.phone && (value.phone.length > 40 || !/^\+?[\d ().-]+$/.test(value.phone) || !/^\d{7,15}$/.test(value.phone.replace(/\D/g, '')))) fields.phone = 'Enter a valid phone number.';
  if (!value.question || value.question.length > 3000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value.question)) fields.question = 'Enter a question of up to 3,000 characters.';
  if (value.formId && !FORM_IDS.has(value.formId)) fields.formId = 'Choose a form from the catalog.';
  if (value.type === 'attorney' && !FORM_IDS.has(value.formId)) fields.formId = 'Choose the form for your attorney request.';
  if (value.type === 'attorney' && value.attorneyConsent !== 'share-contact-and-question-v1') fields.attorneyConsent = 'Confirm permission to share this request with an independent attorney.';
  if (value.type !== 'attorney' && input.attorneyConsent !== undefined) fields.attorneyConsent = 'Consent is only accepted for attorney requests.';
  if (Object.keys(fields).length) throw new HttpError(422, 'validation_failed', 'Please check the highlighted fields.', fields);
  return {
    requestId: value.requestId.toLowerCase(),
    payload: { type: value.type, name: value.name, email: value.email || null, phone: value.phone || null, question: value.question, formId: value.formId || null, ...(value.type === 'attorney' ? {attorneyConsent: value.attorneyConsent} : {}) },
  };
}

export function createSubmitRequestHandler(options) {
  return createAuthenticatedEndpoint({
    ...options,
    action: async ({ input, user, config, fetchImpl }) => {
      const { requestId, payload } = validateRequest(input);
      const result = await serviceRpc(config, 'fillout_submit_request', { p_user_id: user.id, p_request_id: requestId, p_payload: payload }, fetchImpl);
      if (!UUID.test(result?.id || '') || typeof result.createdAt !== 'string' || Number.isNaN(Date.parse(result.createdAt))) {
        throw new Error('Invalid storage receipt');
      }
      return { status: 201, body: { id: result.id, requestId, createdAt: result.createdAt, delivery: 'team-inbox', externalNotification: false } };
    },
  });
}
