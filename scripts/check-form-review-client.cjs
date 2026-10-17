const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');

const pdf = new Uint8Array(Buffer.from('%PDF-1.7\nSynthetic reviewed document\n%%EOF\n'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const calls = [], documents = [];
let respond = async () => { throw Error('Unexpected network call'); };
const moduleRef = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/formReview.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, {
  module: moduleRef, exports: moduleRef.exports, Uint8Array, Error,
  require: name => {
    if (name === 'expo-crypto') return { CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digest: async (_algorithm, bytes) => new Uint8Array(crypto.createHash('sha256').update(bytes).digest()).buffer };
    if (name === './cloudClient') return { invokeCloudFunction: async (name, body) => { calls.push({ name, body }); return respond(name, body); } };
    if (name === './officialPdfDocument') return { createPrintableDocument: async (bytes, formId, dialogTitle, options) => { const file = { bytes, formId, dialogTitle, options, uri: 'mock-pdf', dispose() {} }; documents.push(file); return file; } };
    if (name === '../data/forms-catalog.json') return JSON.parse(fs.readFileSync('data/forms-catalog.json', 'utf8'));
    throw Error(`Unexpected import ${name}`);
  },
});
const api = moduleRef.exports;
const submission = extras => ({
  id: crypto.randomUUID(), requestId: crypto.randomUUID(), formId: 'AR-11', status: 'pending',
  environment: 'production', caseId: null,
  submittedAt: '2026-10-11T12:00:00.123456Z', reviewedAt: null, reviewNote: '', sha256: hash(pdf), ...extras,
});
const plain = value => JSON.parse(JSON.stringify(value));

(async () => {
  const pending = submission();
  respond = async (_name, body) => ({ submission: { ...pending, requestId: body.requestId, formId: body.formId } });
  // Each padded and unpadded byte length round-trips without browser/Node globals.
  for (let length = 40; length <= 42; length++) {
    const bytes = new Uint8Array(Buffer.from('%PDF-' + 'x'.repeat(length - 5)));
    const id = crypto.randomUUID();
    respond = async (_name, body) => {
      assert.equal(body.pdfBase64, Buffer.from(bytes).toString('base64'));
      return { submission: { ...pending, requestId: id, sha256: hash(bytes) } };
    };
    assert.equal((await api.submitFormReview({ requestId: id, formId: 'AR-11', pdfBytes: bytes, answers: { name: 'SAMPLE' } })).requestId, id);
  }
  const answers = { name: 'SAMPLE', selections: ['one'] }, bytes = new Uint8Array(pdf);
  const sending = api.submitFormReview({ requestId: pending.requestId, formId: pending.formId, pdfBytes: bytes, answers });
  answers.name = 'CHANGED'; answers.selections.push('two'); bytes[5] = 0;
  respond = async (name, body) => {
    assert.equal(name, 'form-review');
    assert.deepEqual(plain(body.answers), { name: 'SAMPLE', selections: ['one'] });
    assert.equal(body.pdfBase64, Buffer.from(pdf).toString('base64'));
    return { submission: pending };
  };
  await sending;
  assert.equal(documents.length, 0, 'Submitting never creates a customer download');
  for (const bad of [{ requestId: crypto.randomUUID() }, { formId: 'I-90' }, { caseId: crypto.randomUUID() }, { environment: undefined }, { environment: 'mixed' }, { sha256: '0'.repeat(64) }, { status: 'approved' }]) {
    respond = async () => ({ submission: { ...pending, ...bad } });
    await assert.rejects(api.submitFormReview({ requestId: pending.requestId, formId: pending.formId, pdfBytes: pdf, answers: {} }), /could not be verified/);
  }
  for (const rows of [[pending, pending], [submission({ status: 'superseded' })], [submission({ reviewedAt: 'bad' })], [submission({ status: 'changes_requested', reviewedAt: '2026-10-11T13:00:00Z' })], [null]]) {
    respond = async () => ({ submissions: rows });
    await assert.rejects(api.listMyReviews, /could not be verified/);
  }
  respond = async () => ({ submissions: [pending] });
  assert.equal((await api.listMyReviews())[0].id, pending.id);
  const sandbox = submission({ environment: 'sandbox' });
  respond = async () => ({ submissions: [pending, sandbox] });
  assert.equal((await api.listMyReviews()).length, 2, 'The same form can have independent production and sandbox reviews');
  for (const environment of [undefined, null, 'mixed']) {
    respond = async () => ({ submissions: [{ ...pending, environment }] });
    await assert.rejects(api.listMyReviews, /could not be verified/);
  }
  const inbox = { ...pending, userId: crypto.randomUUID(), email: 'sample@example.test' };
  const cursor = { id: inbox.id, submittedAt: inbox.submittedAt };
  respond = async () => ({ submissions: [inbox], hasMore: true, nextBefore: cursor });
  await api.listReviewInbox(cursor);
  assert.equal(calls.at(-1).body.environment, 'production', 'The operator inbox defaults explicitly to production');
  for (const bad of [{ submissions: [pending] }, { submissions: [inbox, inbox] }, { nextBefore: { ...cursor, id: crypto.randomUUID() } }, { hasMore: false }]) {
    respond = async () => ({ submissions: [inbox], hasMore: true, nextBefore: cursor, ...bad });
    await assert.rejects(api.listReviewInbox, /could not be verified/);
  }
  respond = async () => ({ submissions: [{ ...inbox, environment: 'sandbox' }], hasMore: false, nextBefore: null });
  await assert.rejects(api.listReviewInbox, /could not be verified/);
  assert.equal((await api.listReviewInbox(undefined, 'sandbox')).submissions[0].environment, 'sandbox');
  assert.equal(calls.at(-1).body.environment, 'sandbox');
  const approved = { ...pending, status: 'approved', reviewedAt: '2026-10-11T13:00:00Z', reviewNote: 'Reviewed' };
  respond = async () => ({ submission: approved });
  assert.equal((await api.decideReview(pending.id, 'approved', ' Reviewed ', 'production')).status, 'approved');
  assert.equal(calls.at(-1).body.environment, 'production');
  await assert.rejects(api.decideReview(pending.id, 'changes_requested', '  ', 'production'), /review note/);
  const beforeMissingEnvironment = calls.length;
  await assert.rejects(api.decideReview(pending.id, 'approved', 'Reviewed'), /could not be verified/);
  assert.equal(calls.length, beforeMissingEnvironment, 'A decision without a known environment never reaches the server');
  respond = async () => ({ submission: { ...approved, environment: 'sandbox' } });
  await assert.rejects(api.decideReview(pending.id, 'approved', 'Reviewed', 'production'), /could not be verified/);
  respond = async () => ({ submission: { ...approved, reviewNote: 'Other reviewer result' } });
  await assert.rejects(api.decideReview(pending.id, 'approved', 'Reviewed', 'production'), /could not be verified/);
  respond = async () => { throw Error('Approval required'); };
  await assert.rejects(api.downloadReviewDocument(pending), /Approval required/);
  assert.equal(documents.length, 0, 'A server denial never exposes a local file');
  const file = { submissionId: approved.id, formId: approved.formId, environment: 'production', sha256: approved.sha256, pdfBase64: Buffer.from(pdf).toString('base64') };
  for (const bad of [{ submissionId: crypto.randomUUID() }, { formId: 'I-90' }, { environment: 'sandbox' }, { environment: undefined }, { sha256: '0'.repeat(64) }, { pdfBase64: Buffer.from('%PDF-Wrong revision').toString('base64') }, { pdfBase64: '%%%invalid%%%' }]) {
    respond = async () => ({ ...file, ...bad });
    await assert.rejects(api.downloadReviewDocument(approved), /could not be verified/);
  }
  assert.equal(documents.length, 0, 'Corrupt or mismatched PDF receipts never expose a document');
  respond = async () => file;
  const downloaded = await api.downloadReviewDocument(approved);
  assert.equal(calls.at(-1).body.environment, 'production');
  assert.equal(downloaded.options.test, false);
  assert.deepEqual(downloaded.bytes, pdf, 'Delivery contains the exact reviewed bytes');
  respond = async () => ({ ...file, environment: 'sandbox' });
  const testDocument = await api.downloadReviewDocument({ ...approved, environment: 'sandbox' });
  assert.equal(testDocument.options.test, true, 'Sandbox delivery requests a TEST filename');
  assert.equal(testDocument.dialogTitle, 'Save or share test form');
  assert.deepEqual(testDocument.bytes, pdf, 'Test labels do not alter the approved PDF bytes/hash');
  // Realistic large PDF transport and native-safe base64 roundtrip above the old 1MiB JSON bound.
  const large = new Uint8Array(1_500_001); large.set(Buffer.from('%PDF-1.7\n')); large.set(Buffer.from('%%EOF\n'), large.length - 6);
  const largeSubmission = { ...approved, sha256: hash(large) };
  respond = async () => ({ ...file, sha256: largeSubmission.sha256, pdfBase64: Buffer.from(large).toString('base64') });
  assert.deepEqual((await api.downloadReviewDocument(largeSubmission)).bytes, large);
  console.log('PASS: review client immutable uploads, receipts, inbox cursors, authorization failures, exact PDF hash/version, large native-safe transport.');
})().catch(error => { console.error(error); process.exitCode = 1; });
