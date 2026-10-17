import { createAuthenticatedEndpoint, HttpError, UUID, serviceRpc } from '../_shared/http.mjs';
import { FREE_AI_FORMS, requirePaidCase } from '../_shared/payments.mjs';

export const REVIEW_FORM_IDS = ['AR-11','G-1145','G-639','I-90','I-129F','I-130','I-130A','I-131','I-131A','I-134','I-485','I-751','I-765','I-765WS','I-821','I-821D','I-864','I-864A','N-400','N-565','N-600'];
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const invalid = () => { throw new HttpError(422,'invalid_review_request','Check your form review request and try again.'); };
const isDate = value => typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
const isUuid = value => typeof value === 'string' && UUID.test(value);
const isEnvironment = value => ['production','sandbox'].includes(value);
const byteLength = value => new TextEncoder().encode(value).length;
const validNote = value => typeof value === 'string' && value.length <= 2000 && byteLength(value) <= 6000 && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);

export function decodeReviewPdf(value) {
  if (typeof value !== 'string' || value.length < 24 || value.length > 4 * Math.ceil(MAX_PDF_BYTES / 3)
    || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) invalid();
  let decoded;
  try { decoded = atob(value); } catch { invalid(); }
  if (decoded.length < 16 || decoded.length > MAX_PDF_BYTES || btoa(decoded) !== value
    || !/^%PDF-[12]\.\d/.test(decoded) || !decoded.slice(-1024).includes('%%EOF')) invalid();
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}
async function pdfHash(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)), byte => byte.toString(16).padStart(2,'0')).join('');
}
function validate(input) {
  const keys = { submit: ['action','requestId','formId','pdfBase64','answers','caseId'],list: ['action'],inbox: ['action','before','environment'],file: ['action','submissionId','environment'],decide: ['action','submissionId','decision','note','environment'] };
  if (!Object.hasOwn(keys,input.action) || Object.keys(input).some(key => !keys[input.action].includes(key))) invalid();
  if (input.environment !== undefined && !isEnvironment(input.environment)) invalid();
  if (['file','decide'].includes(input.action) && !isUuid(input.submissionId)) invalid();
  if (input.action === 'submit') {
    if (input.caseId !== undefined && !isUuid(input.caseId)) invalid();
    if (!isUuid(input.requestId) || !REVIEW_FORM_IDS.includes(input.formId) || !input.answers || typeof input.answers !== 'object' || Array.isArray(input.answers)
      || byteLength(JSON.stringify(input.answers)) > 512 * 1024) invalid();
    const validString = value => typeof value === 'string' && value.length <= 10000;
    for (const [key,value] of Object.entries(input.answers)) {
      if (!key || key.length > 256 || !(validString(value) || (Array.isArray(value) && value.length <= 100 && value.every(validString)))) invalid();
    }
    input.pdfBytes = decodeReviewPdf(input.pdfBase64);
  }
  if (input.action === 'inbox' && input.before !== undefined && (!input.before || typeof input.before !== 'object' || Array.isArray(input.before)
    || Object.keys(input.before).some(key => !['submittedAt','id'].includes(key)) || !isDate(input.before.submittedAt) || !isUuid(input.before.id))) invalid();
  if (input.action === 'decide' && (!['approved','changes_requested'].includes(input.decision) || !validNote(input.note)
    || (input.decision === 'changes_requested' && !input.note.trim()))) invalid();
  return input;
}
export function validReviewSummary(row) {
  return row && typeof row === 'object' && isUuid(row.id) && isUuid(row.requestId) && REVIEW_FORM_IDS.includes(row.formId)
    && isEnvironment(row.environment) && (FREE_AI_FORMS.includes(row.formId) ? row.caseId === null && row.environment === 'production' : isUuid(row.caseId))
    && ['pending','changes_requested','approved','superseded'].includes(row.status) && isDate(row.submittedAt)
    && (row.reviewedAt === null || isDate(row.reviewedAt)) && validNote(row.reviewNote) && /^[0-9a-f]{64}$/.test(row.sha256 || '')
    && (row.status !== 'pending' || (row.reviewedAt === null && row.reviewNote === ''))
    && (!['approved','changes_requested'].includes(row.status) || row.reviewedAt !== null)
    && (row.status !== 'changes_requested' || !!row.reviewNote.trim());
}
// Return only the agreed metadata. Never accidentally forward stored answers or bytes in a receipt.
const summary = row => ({ id: row.id,requestId: row.requestId,formId: row.formId,status: row.status,submittedAt: row.submittedAt,
  reviewedAt: row.reviewedAt,reviewNote: row.reviewNote,sha256: row.sha256,environment: row.environment,caseId: row.caseId });
export function createFormReviewHandler(options) {
  return createAuthenticatedEndpoint({ ...options,maxBodyBytes: 12 * 1024 * 1024,action: async ({ input,user,config,fetchImpl }) => {
    const request = validate(input);
    if (['inbox','decide'].includes(request.action)) {
      const access = await serviceRpc(config,'fillout_support_operator_access',{ p_operator_id: user.id },fetchImpl);
      if (typeof access?.allowed !== 'boolean') throw Error('Invalid access receipt');
      if (!access.allowed) throw new HttpError(403,'operator_access_required','This account does not have access to submitted forms.');
    }
    if (request.action === 'submit') {
      const caseId = FREE_AI_FORMS.includes(request.formId) ? null : request.caseId?.toLowerCase();
      const paymentEnvironment = await requirePaidCase({ config,env:options.env,userId:user.id,caseId,formId:request.formId,fetchImpl });
      const sha256 = await pdfHash(request.pdfBytes);
      const receipt = await serviceRpc(config,'fillout_form_review_submit',{ p_user_id: user.id,p_request_id: request.requestId.toLowerCase(),
        p_form_id: request.formId,p_pdf_base64: request.pdfBase64,p_answers: request.answers,...(caseId ? { p_case_id:caseId } : {}) },fetchImpl);
      if (!validReviewSummary(receipt) || receipt.requestId !== request.requestId.toLowerCase() || receipt.formId !== request.formId || receipt.sha256 !== sha256
        || receipt.caseId !== (caseId ?? null) || receipt.environment !== paymentEnvironment) throw Error('Invalid submission receipt');
      return { status: 201,body: { submission: summary(receipt) } };
    }
    if (request.action === 'list' || request.action === 'inbox') {
      const isInbox = request.action === 'inbox';
      const result = await serviceRpc(config,isInbox ? 'fillout_form_review_inbox' : 'fillout_form_review_list',isInbox
        ? { p_operator_id: user.id,p_before_submitted_at: request.before?.submittedAt ?? null,p_before_id: request.before?.id?.toLowerCase() ?? null,p_environment:request.environment ?? 'production' }
        : { p_user_id: user.id },fetchImpl);
      if (!Array.isArray(result?.submissions) || result.submissions.length > (isInbox ? 20 : 42)
        || !result.submissions.every(row => validReviewSummary(row) && row.status !== 'superseded'
          && (!isInbox || (row.environment === (request.environment ?? 'production') && isUuid(row.userId) && typeof row.email === 'string' && row.email.length <= 320)))
        || new Set(result.submissions.map(row => row.id)).size !== result.submissions.length
        || (!isInbox && new Set(result.submissions.map(row => `${row.formId}:${row.environment}`)).size !== result.submissions.length)) throw Error('Invalid review list');
      const submissions = result.submissions.map(row => ({ ...summary(row),...(isInbox ? { userId: row.userId,email: row.email } : {}) }));
      if (!isInbox) return { body: { submissions } };
      const last = submissions.at(-1);
      if (typeof result.hasMore !== 'boolean' || (result.hasMore ? !last || !isUuid(result.nextBefore?.id) || !isDate(result.nextBefore?.submittedAt)
        || result.nextBefore.id !== last.id || result.nextBefore.submittedAt !== last.submittedAt : result.nextBefore !== null)) throw Error('Invalid review cursor');
      return { body: { submissions,hasMore: result.hasMore,nextBefore: result.hasMore ? { id: last.id,submittedAt: last.submittedAt } : null } };
    }
    if (request.action === 'decide') {
      if (request.decision === 'approved') {
        const context = await serviceRpc(config,'fillout_form_review_decision_context',{ p_operator_id:user.id,p_submission_id:request.submissionId.toLowerCase(),p_environment:request.environment ?? 'production' },fetchImpl);
        if (!isUuid(context?.userId) || !REVIEW_FORM_IDS.includes(context.formId) || context.environment !== (request.environment ?? 'production')
          || !['pending','approved','changes_requested','superseded'].includes(context.status)
          || (FREE_AI_FORMS.includes(context.formId) ? context.caseId !== null : !isUuid(context.caseId))) throw Error('Invalid decision context');
        if (context.status === 'pending') {
          const verifiedEnvironment = await requirePaidCase({ config,env:options.env,userId:context.userId,caseId:context.caseId,formId:context.formId,fetchImpl });
          if (verifiedEnvironment !== context.environment) throw Error('Invalid decision environment');
        }
      }
      const receipt = await serviceRpc(config,'fillout_form_review_decide',{ p_operator_id: user.id,p_submission_id: request.submissionId.toLowerCase(),
        p_decision: request.decision,p_note: request.note.trim(),p_environment:request.environment ?? 'production' },fetchImpl);
      if (!validReviewSummary(receipt) || receipt.id !== request.submissionId.toLowerCase() || receipt.status !== request.decision || receipt.reviewNote !== request.note.trim() || receipt.environment !== (request.environment ?? 'production')) throw Error('Invalid decision receipt');
      return { body: { submission: summary(receipt) } };
    }
    const result = await serviceRpc(config,'fillout_form_review_file',{ p_actor_id: user.id,p_submission_id: request.submissionId.toLowerCase(),p_environment:request.environment ?? null },fetchImpl);
    if (result?.submissionId !== request.submissionId.toLowerCase() || !REVIEW_FORM_IDS.includes(result.formId) || !/^[0-9a-f]{64}$/.test(result.sha256 || '')
      || !isEnvironment(result.environment) || request.environment !== undefined && result.environment !== request.environment
      || (FREE_AI_FORMS.includes(result.formId) ? result.caseId !== null || result.environment !== 'production' : !isUuid(result.caseId))) throw Error('Invalid file receipt');
    let bytes;
    try { bytes = decodeReviewPdf(result.pdfBase64); } catch { throw Error('Invalid stored PDF'); }
    if (await pdfHash(bytes) !== result.sha256) throw Error('PDF integrity check failed');
    return { body: { submissionId: result.submissionId,formId: result.formId,sha256: result.sha256,pdfBase64: result.pdfBase64,environment:result.environment,caseId:result.caseId } };
  } });
}
