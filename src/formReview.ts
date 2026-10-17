import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { invokeCloudFunction } from './cloudClient';
import { createPrintableDocument, type PrintableDocument } from './officialPdfDocument';
import catalog from '../data/forms-catalog.json';

export type ReviewEnvironment = 'production' | 'sandbox';
export type ReviewSubmission = {
  id: string; requestId: string; formId: string; caseId: string | null;
  environment: ReviewEnvironment;
  status: 'pending' | 'changes_requested' | 'approved' | 'superseded';
  submittedAt: string; reviewedAt: string | null; reviewNote: string; sha256: string;
  userId?: string; email?: string;
};
export type ReviewCursor = { submittedAt: string; id: string };
export type ReviewInboxPage = { submissions: ReviewSubmission[]; hasMore: boolean; nextBefore: ReviewCursor | null };
export type ReviewSubmissionInput = { requestId: string; formId: string; pdfBytes: Uint8Array; answers: Record<string, string | string[]>; caseId?: string };
const forms = new Set(catalog.forms.map(form => form.id));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha = /^[0-9a-f]{64}$/;
const maxPdfBytes = 8 * 1024 * 1024;
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const invalid = () => new Error('The review status could not be verified. Please refresh and try again.');
const date = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const environment = (value: unknown): value is ReviewEnvironment => value === 'production' || value === 'sandbox';

function validSubmission(value: unknown): value is ReviewSubmission {
  if (!value || typeof value !== 'object') return false;
  const row = value as ReviewSubmission;
  return uuid.test(row.id || '') && uuid.test(row.requestId || '') && forms.has(row.formId) && environment(row.environment)
    && (row.caseId === null || typeof row.caseId === 'string' && uuid.test(row.caseId))
    && ['pending', 'changes_requested', 'approved', 'superseded'].includes(row.status)
    && date(row.submittedAt) && (row.reviewedAt === null || date(row.reviewedAt))
    && typeof row.reviewNote === 'string' && Array.from(row.reviewNote).length <= 2000
    && sha.test(row.sha256 || '') && (row.userId === undefined || uuid.test(row.userId))
    && (row.email === undefined || typeof row.email === 'string' && row.email.length <= 320)
    && (row.status !== 'pending' || row.reviewedAt === null)
    && (!['approved', 'changes_requested'].includes(row.status) || row.reviewedAt !== null)
    && (row.status !== 'changes_requested' || !!row.reviewNote.trim());
}

// No Buffer/btoa dependency: these run in Hermes as well as the browser.
function encodePdf(bytes: Uint8Array): string {
  const chunks: string[] = [];
  let chunk = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    chunk += alphabet[n >>> 18] + alphabet[(n >>> 12) & 63]
      + (i + 1 < bytes.length ? alphabet[(n >>> 6) & 63] : '=') + (i + 2 < bytes.length ? alphabet[n & 63] : '=');
    if (chunk.length >= 32768) { chunks.push(chunk); chunk = ''; }
  }
  return chunks.join('') + chunk;
}

function decodePdf(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length < 8 || value.length > Math.ceil(maxPdfBytes / 3) * 4
    || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw invalid();
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const size = value.length / 4 * 3 - padding;
  if (size > maxPdfBytes) throw invalid();
  const bytes = new Uint8Array(size);
  for (let i = 0, j = 0; i < value.length; i += 4) {
    const a = alphabet.indexOf(value[i]), b = alphabet.indexOf(value[i + 1]);
    const c = value[i + 2] === '=' ? 0 : alphabet.indexOf(value[i + 2]);
    const d = value[i + 3] === '=' ? 0 : alphabet.indexOf(value[i + 3]);
    if (i === value.length - 4 && (padding === 2 && (b & 15) || padding === 1 && (c & 3))) throw invalid();
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    bytes[j++] = (n >>> 16) & 255;
    if (j < size) bytes[j++] = (n >>> 8) & 255;
    if (j < size) bytes[j++] = n & 255;
  }
  if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') throw invalid();
  return bytes;
}

async function hashPdf(bytes: Uint8Array): Promise<string> {
  const hashed = await digest(CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes));
  return Array.from(new Uint8Array(hashed), value => value.toString(16).padStart(2, '0')).join('');
}

export async function submitFormReview(input: ReviewSubmissionInput): Promise<ReviewSubmission> {
  if (!uuid.test(input.requestId) || (input.caseId !== undefined && !uuid.test(input.caseId)) || !forms.has(input.formId) || !(input.pdfBytes instanceof Uint8Array)
    || input.pdfBytes.length < 8 || input.pdfBytes.length > maxPdfBytes
    || String.fromCharCode(...input.pdfBytes.subarray(0, 5)) !== '%PDF-') throw new Error('This form could not be sent for review. Please try again.');
  // Copy the data before any await so editing cannot alter an in-flight revision.
  const bytes = new Uint8Array(input.pdfBytes);
  const answers = Object.fromEntries(Object.entries(input.answers).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]));
  const expectedHash = await hashPdf(bytes);
  const result = await invokeCloudFunction<{ submission: ReviewSubmission }>('form-review', {
    action: 'submit', requestId: input.requestId, formId: input.formId, pdfBase64: encodePdf(bytes), answers,
    ...(input.caseId ? { caseId: input.caseId } : {}),
  });
  if (!validSubmission(result?.submission) || result.submission.requestId !== input.requestId
    || result.submission.formId !== input.formId || result.submission.caseId !== (input.caseId ?? null)
    || result.submission.sha256 !== expectedHash) throw invalid();
  return result.submission;
}

export async function listMyReviews(): Promise<ReviewSubmission[]> {
  const result = await invokeCloudFunction<{ submissions: ReviewSubmission[] }>('form-review', { action: 'list' });
  if (!Array.isArray(result?.submissions) || result.submissions.length > forms.size * 2
    || !result.submissions.every(row => validSubmission(row) && row.status !== 'superseded')
    || new Set(result.submissions.map(row => `${row.environment}:${row.formId}`)).size !== result.submissions.length
    || new Set(result.submissions.map(row => row.id)).size !== result.submissions.length) throw invalid();
  return result.submissions;
}

export async function listReviewInbox(before?: ReviewCursor, reviewEnvironment: ReviewEnvironment = 'production'): Promise<ReviewInboxPage> {
  if (!environment(reviewEnvironment) || before && (!uuid.test(before.id) || !date(before.submittedAt))) throw invalid();
  const result = await invokeCloudFunction<ReviewInboxPage>('form-review', { action: 'inbox', environment: reviewEnvironment, ...(before ? { before } : {}) });
  if (!Array.isArray(result?.submissions) || result.submissions.length > 20 || typeof result.hasMore !== 'boolean'
    || !result.submissions.every(row => validSubmission(row) && row.environment === reviewEnvironment && row.status !== 'superseded' && !!row.userId && typeof row.email === 'string')
    || new Set(result.submissions.map(row => row.id)).size !== result.submissions.length
    || (result.hasMore ? !result.submissions.length || result.nextBefore?.id !== result.submissions.at(-1)?.id
      || result.nextBefore?.submittedAt !== result.submissions.at(-1)?.submittedAt : result.nextBefore !== null)) throw invalid();
  return result;
}

export async function decideReview(submissionId: string, decision: 'approved' | 'changes_requested', note: string, reviewEnvironment: ReviewEnvironment): Promise<ReviewSubmission> {
  if (!environment(reviewEnvironment)) throw invalid();
  if (!uuid.test(submissionId) || !['approved', 'changes_requested'].includes(decision) || Array.from(note).length > 2000
    || (decision === 'changes_requested' && !note.trim())) throw new Error('Add a review note before requesting changes.');
  const result = await invokeCloudFunction<{ submission: ReviewSubmission }>('form-review', { action: 'decide', submissionId, decision, note: note.trim(), environment: reviewEnvironment });
  if (!validSubmission(result?.submission) || result.submission.id !== submissionId || result.submission.status !== decision
    || result.submission.reviewNote !== note.trim() || result.submission.environment !== reviewEnvironment) throw invalid();
  return result.submission;
}

/** The server authorizes every file fetch: owner after approval, or a current reviewer. */
export async function downloadReviewDocument(submission: ReviewSubmission): Promise<PrintableDocument> {
  if (!validSubmission(submission)) throw invalid();
  const result = await invokeCloudFunction<{ submissionId: string; formId: string; sha256: string; pdfBase64: string; environment: ReviewEnvironment }>('form-review', {
    action: 'file', submissionId: submission.id, environment: submission.environment,
  });
  if (result?.submissionId !== submission.id || result.formId !== submission.formId || result.sha256 !== submission.sha256
    || result.environment !== submission.environment) throw invalid();
  const bytes = decodePdf(result.pdfBase64);
  if (await hashPdf(bytes) !== submission.sha256) throw invalid();
  return createPrintableDocument(bytes, submission.formId, submission.environment === 'sandbox' ? 'Save or share test form' : 'Save or share reviewed form', { test: submission.environment === 'sandbox' });
}
