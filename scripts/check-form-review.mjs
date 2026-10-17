import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createFormReviewHandler, decodeReviewPdf, REVIEW_FORM_IDS } from '../supabase/functions/form-review/handler.mjs';
import { boundedFetchJson } from '../supabase/functions/_shared/http.mjs';

const owner = '11111111-1111-4111-8111-111111111111';
const client = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const secondOwner = '44444444-4444-4444-8444-444444444444';
const pending = '55555555-5555-4555-8555-555555555555';
const config = { SUPABASE_URL: 'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',SUPABASE_SECRET_KEY: 'sb_secret_test' };
const pdf = Buffer.from('%PDF-1.7\n1 0 obj<</Type /Catalog>>endobj\n%%EOF\n');
const pdfBase64 = pdf.toString('base64');
const sha256 = createHash('sha256').update(pdf).digest('hex');
const maxPdf = Buffer.alloc(8 * 1024 * 1024,32);
maxPdf.write('%PDF-1.7\n'); maxPdf.write('%%EOF\n',maxPdf.length - 6);
assert.equal(decodeReviewPdf(maxPdf.toString('base64')).length,maxPdf.length);
assert.throws(() => decodeReviewPdf(Buffer.concat([maxPdf,Buffer.from(' ')]).toString('base64')),error => error.status === 422);
let user = { id: client,role: 'authenticated',email: 'synthetic@example.test',email_confirmed_at: '2026-10-11',is_anonymous: false };
let override,afterAccess; const calls = [];
const db = new PGlite();
try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean not null default false);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `);
  for (const file of ['20261010000100_cloud_intake.sql','20261011000100_support_chat.sql','20261011000300_support_inbox.sql','20261011000400_form_review.sql','20261012000100_ai_payments.sql','20261017000100_payment_environments.sql']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
  }
  for (const id of [owner,client,other,secondOwner,pending]) {
    await db.query('insert into auth.users values($1,$2,$3,false)',[id,`${id}@example.test`,id === pending ? null : '2026-10-11']);
  }
  await db.query('insert into private.support_operators(user_id) values($1),($2)',[owner,secondOwner]);
  const rpcKeys = {
    fillout_support_operator_access: ['p_operator_id'],
    fillout_form_review_submit: ['p_user_id','p_request_id','p_form_id','p_pdf_base64','p_answers'],
    fillout_form_review_list: ['p_user_id'],
    fillout_form_review_inbox: ['p_operator_id','p_before_submitted_at','p_before_id','p_environment'],
    fillout_form_review_file: ['p_actor_id','p_submission_id','p_environment'],
    fillout_form_review_decision_context:['p_operator_id','p_submission_id','p_environment'],
    fillout_form_review_decide: ['p_operator_id','p_submission_id','p_decision','p_note','p_environment'],
  };
  async function rpc(name,args) {
    assert.ok(Object.hasOwn(rpcKeys,name));
    await db.exec('set role service_role');
    try {
      const keys = rpcKeys[name].filter(key => Object.hasOwn(args,key));
      const result = await db.query(`select public.${name}(${keys.map((key,i) => `${key} => $${i+1}`).join(',')}) as value`,keys.map(key => args[key]));
      return Response.json(result.rows[0].value);
    } catch (error) {
      return Response.json({ code: error.code,message: 'Private diagnostic' },{ status: 400 });
    } finally { await db.exec('reset role'); }
  }
  const handler = createFormReviewHandler({ env: name => config[name],fetchImpl: async (url,options) => {
    calls.push({ url,options });
    if (url.endsWith('/auth/v1/user')) return Response.json(user);
    assert.equal(options.headers.apikey,config.SUPABASE_SECRET_KEY);
    assert.equal(options.headers.Authorization,undefined);
    const name = url.split('/').at(-1);
    if (override?.name === name) return Response.json(override.body);
    const result = await rpc(name,JSON.parse(options.body));
    if (name === 'fillout_support_operator_access' && afterAccess) await afterAccess();
    return result;
  } });
  async function request(input,{ auth = true,origin = 'https://fillout.net',headers = {} } = {}) {
    const response = await handler(new Request('https://example.supabase.co/functions/v1/form-review',{
      method: 'POST',headers: { 'Content-Type': 'application/json',...(auth ? { Authorization: 'Bearer synthetic-user-token' } : {}),...(origin ? { Origin: origin } : {}),...headers },body: JSON.stringify(input),
    }));
    assert.equal(response.headers.get('Cache-Control'),'no-store');
    const result = { status: response.status,body: await response.json() };
    assert.equal(JSON.stringify(result).includes('Private diagnostic'),false);
    return result;
  }
  const submission = { action: 'submit',requestId: randomUUID(),formId: 'AR-11',pdfBase64,answers: { last_name: 'SYNTHETIC',options: ['one','two'] } };
  assert.equal((await request(submission,{ auth: false })).status,401);
  assert.equal((await request(submission,{ origin: 'https://evil.example' })).status,403);
  assert.equal(calls.length,0);
  for (const input of [
    { ...submission,userId: other },{ ...submission,status: 'approved' },{ ...submission,requestId: 'bad' },{ ...submission,formId: 'I-999' },
    { ...submission,pdfBase64: Buffer.from('not a pdf').toString('base64') },{ ...submission,pdfBase64: pdfBase64 + '\n' },
    { ...submission,pdfBase64: Buffer.from('%PDF-1.7\nmissing end marker').toString('base64') },
    { ...submission,answers: [] },{ ...submission,answers: { field: true } },{ ...submission,answers: { field: [['nested']] } },
    { ...submission,answers: { field: 'x'.repeat(10001) } },{ ...submission,answers: { ['x'.repeat(257)]: 'a' } },
    { action: 'decide',submissionId: randomUUID(),decision: 'approved',note: '\0' },
    { action: 'decide',submissionId: randomUUID(),decision: 'changes_requested',note: ' ' },
    { action: 'inbox',before: { id: randomUUID() } },{ action: 'inbox',before: { id: randomUUID(),submittedAt: 'bad' } },
    { action: 'file',submissionId: 'bad' },{ action: 'delete' },{ action: 'list',userId: other },
  ]) assert.equal((await request(input)).status,422,JSON.stringify(input));
  assert.equal((await request(submission,{ headers: { 'Content-Length': String(12 * 1024 * 1024 + 1) } })).status,413);
  user.is_anonymous = true; assert.equal((await request(submission)).status,403); user.is_anonymous = false;
  user.email_confirmed_at = null; assert.equal((await request(submission)).status,403); user.email_confirmed_at = '2026-10-11';
  user.id = pending; assert.equal((await request(submission)).status,403); user.id = client;

  const first = await request(submission,{ origin: null });
  assert.equal(first.status,201,JSON.stringify(first));
  const firstId = first.body.submission.id;
  assert.equal(first.body.submission.status,'pending');
  assert.equal(first.body.submission.sha256,sha256);
  assert.equal(first.body.submission.reviewedAt,null);
  assert.equal(first.body.submission.userId,undefined);
  assert.equal(first.body.submission.answers,undefined);
  assert.deepEqual((await request(submission)).body,first.body,'Lost response retry returns same exact revision');
  assert.equal((await request({ ...submission,answers: { last_name: 'OTHER' } })).status,409);
  assert.equal((await request({ ...submission,formId: 'G-1145' })).status,409);
  assert.equal((await request({ ...submission,pdfBase64: Buffer.from('%PDF-1.7\nDifferent exact bytes\n%%EOF').toString('base64') })).status,409);
  assert.equal((await request({ action: 'file',submissionId: firstId })).status,403,'Pending client download denied by backend');
  assert.deepEqual((await request({ action: 'list' })).body.submissions,[first.body.submission]);
  user.id = other;
  assert.equal((await request({ action: 'file',submissionId: firstId })).status,403);
  assert.deepEqual((await request({ action: 'list' })).body,{ submissions: [] });
  user.user_metadata = { role: 'operator',is_admin: true };
  for (const input of [{ action: 'inbox' },{ action: 'decide',submissionId: firstId,decision: 'approved',note: '' }]) {
    const denied = await request(input); assert.equal(denied.status,403); assert.equal(denied.body.error.code,'operator_access_required');
  }

  user.id = owner;
  assert.equal((await request({ action: 'inbox' })).body.submissions[0].userId,client);
  const reviewFile = await request({ action: 'file',submissionId: firstId });
  assert.equal(reviewFile.status,200,JSON.stringify(reviewFile));
  assert.equal(reviewFile.body.pdfBase64,pdfBase64);
  const decision = { action: 'decide',submissionId: firstId,decision: 'changes_requested',note: '  Correct the synthetic street number.  ' };
  const returned = await request(decision);
  assert.equal(returned.status,200,JSON.stringify(returned));
  assert.equal(returned.body.submission.status,'changes_requested');
  assert.equal(returned.body.submission.reviewNote,decision.note.trim());
  assert.deepEqual((await request(decision)).body,returned.body);
  assert.equal((await request({ ...decision,decision: 'approved' })).status,409);
  user.id = secondOwner; assert.equal((await request(decision)).status,409); user.id = client;
  assert.equal((await request({ action: 'file',submissionId: firstId })).status,403);
  assert.equal((await request({ action: 'list' })).body.submissions[0].reviewNote,decision.note.trim());

  const revised = { ...submission,requestId: randomUUID(),answers: { last_name: 'REVISED' } };
  const second = await request(revised);
  assert.equal(second.status,201); const secondId = second.body.submission.id;
  assert.notEqual(secondId,firstId);
  assert.equal((await request({ action: 'list' })).body.submissions.length,1);
  assert.equal((await request(submission)).body.submission.status,'superseded','Retrying old revision cannot reactivate it');
  user.id = owner;
  assert.equal((await request({ action: 'file',submissionId: firstId })).status,403,'Superseded operator file denied');
  assert.equal((await request({ ...decision,note: 'Stale approval',decision: 'approved' })).status,409);
  const approval = { action: 'decide',submissionId: secondId,decision: 'approved',note: '' };
  const approved = await request(approval); assert.equal(approved.status,200,JSON.stringify(approved));
  assert.equal(approved.body.submission.status,'approved'); assert.ok(approved.body.submission.reviewedAt);
  assert.deepEqual((await request(approval)).body,approved.body);
  user.id = client;
  const download = await request({ action: 'file',submissionId: secondId });
  assert.equal(download.status,200);
  assert.deepEqual(download.body,reviewFile.body.submissionId === secondId ? reviewFile.body : { ...reviewFile.body,submissionId: secondId });
  user.id = other; assert.equal((await request({ action: 'file',submissionId: secondId })).status,403);
  user.id = client;
  const third = await request({ ...revised,requestId: randomUUID() }); assert.equal(third.status,201);
  assert.equal((await request({ action: 'file',submissionId: secondId })).status,403,'New submission invalidates old approval');
  assert.equal((await request({ action: 'file',submissionId: third.body.submission.id })).status,403);
  assert.equal((await request({ action: 'list' })).body.submissions[0].status,'pending');

  // Authorization is checked inside data RPCs too, so role revocation cannot be raced.
  user.id = owner;
  for (const input of [{ action: 'inbox' },{ action: 'decide',submissionId: third.body.submission.id,decision: 'approved',note: '' }]) {
    afterAccess = () => db.query('delete from private.support_operators where user_id = $1',[owner]);
    assert.equal((await request(input)).status,403); afterAccess = undefined;
    await db.query('insert into private.support_operators(user_id) values($1)',[owner]);
  }
  await db.query('delete from private.support_operators where user_id = $1',[owner]);
  assert.equal((await request({ action: 'file',submissionId: third.body.submission.id })).status,403);
  await db.query('insert into private.support_operators(user_id) values($1)',[owner]);
  await db.query('update auth.users set email_confirmed_at = null where id = $1',[owner]);
  assert.equal((await request({ action: 'inbox' })).status,403);
  await db.query("update auth.users set email_confirmed_at = '2026-10-11' where id = $1",[owner]);

  // Synthetic metadata fixtures exercise all supported form responses; new unpaid paid-form submissions are denied.
  // Historical records without verified provenance are covered by the migration quarantine suite.
  // A 100KiB exact file uses only the dedicated file response limit.
  const manifest = JSON.parse(await readFile(new URL('../data/uscis-print-templates.json',import.meta.url),'utf8'));
  assert.deepEqual([...REVIEW_FORM_IDS].sort(),Object.keys(manifest.templates).sort());
  user.id = other;
  const bigPdf = Buffer.concat([Buffer.from('%PDF-1.7\n'),Buffer.alloc(100000,32),Buffer.from('\n%%EOF\n')]);
  for (const formId of REVIEW_FORM_IDS) {
    const result = await request({ ...submission,requestId: randomUUID(),formId,pdfBase64: bigPdf.toString('base64') });
    if (['AR-11','G-1145'].includes(formId)) assert.equal(result.status,201,JSON.stringify(result));
    else {
      assert.equal(result.status,402,JSON.stringify(result));
      const metadataCase = randomUUID();
      await db.query('insert into private.payment_cases(id,user_id,form_id) values($1,$2,$3)',[metadataCase,other,formId]);
      await db.query("insert into private.form_review_submissions(user_id,request_id,form_id,answers,pdf_bytes,sha256,environment,payment_case_id) values($1,$2,$3,$4,$5,$6,'production',$7)",
        [other,randomUUID(),formId,{},bigPdf,createHash('sha256').update(bigPdf).digest('hex'),metadataCase]);
    }
    await db.query("update private.form_review_submissions set submitted_at = '2020-01-01' where user_id = $1",[other]);
  }
  const all = await request({ action: 'list' }); assert.equal(all.body.submissions.length,21);
  user.id = owner;
  const bigFile = await request({ action: 'file',submissionId: all.body.submissions[0].id }); assert.equal(bigFile.status,200);
  assert.equal(bigFile.body.pdfBase64,bigPdf.toString('base64'));
  await assert.rejects(boundedFetchJson('https://example.test',{},async () => Response.json({ data: 'x'.repeat(65536) })),error => error.status === 503,'Shared upstream limit remains 64KiB');
  await db.query("update private.form_review_submissions set status = 'approved',review_note = $1,reviewed_at = now(),reviewed_by = $2 where user_id = $3",['字'.repeat(2000),owner,other]);
  user.id = other;
  const unicodeList = await request({ action: 'list' }); assert.equal(unicodeList.status,200);
  assert.ok(Buffer.byteLength(JSON.stringify(unicodeList.body)) > 65536,'Maximum Unicode notes use the bounded metadata allowance');
  user.id = owner;
  const unicodeInbox = await request({ action: 'inbox',before: { submittedAt: '2021-01-01T00:00:00Z',id: randomUUID() } });
  assert.equal(unicodeInbox.status,200); assert.ok(Buffer.byteLength(JSON.stringify(unicodeInbox.body)) > 65536);
  await db.query("update private.form_review_submissions set status = 'pending',review_note = '',reviewed_at = null,reviewed_by = null where user_id = $1",[other]);

  // Identical microsecond timestamps paginate without skipping any current revision.
  for (let index = 0; index < 25; index++) {
    const id = randomUUID();
    await db.query("insert into auth.users values($1,$2,'2026-10-11',false)",[id,`synthetic-${index}@example.test`]);
    await db.query("insert into private.form_review_submissions(user_id,request_id,form_id,answers,pdf_bytes,sha256,submitted_at,environment) values($1,$2,'AR-11','{}',$3,$4,'2030-01-01T00:00:00.123456Z','production')",[id,randomUUID(),pdf,sha256]);
  }
  const seen = new Set(); let before;
  do {
    const page = await request({ action: 'inbox',...(before ? { before } : {}) }); assert.equal(page.status,200,JSON.stringify(page));
    for (const row of page.body.submissions) { assert.ok(!seen.has(row.id)); seen.add(row.id); }
    before = page.body.nextBefore;
  } while (before);
  assert.equal(seen.size,47);

  // Quotas preserve the existing current revision, and retry receipts bypass the new-submission quota.
  user.id = client;
  let lastRequest;
  for (let i = 3; i < 10; i++) {
    lastRequest = { ...submission,requestId: randomUUID() };
    assert.equal((await request(lastRequest)).status,201);
  }
  const atQuota = (await request({ action: 'list' })).body.submissions[0];
  assert.equal((await request({ ...submission,requestId: randomUUID() })).status,429);
  assert.equal((await request(lastRequest)).status,201);
  assert.equal((await request({ action: 'list' })).body.submissions[0].id,atQuota.id);

  for (const role of ['authenticated','anon']) {
    await db.exec(`set role ${role}`);
    for (const query of [
      'select * from private.form_review_submissions',`update private.form_review_submissions set status = 'approved'`,
      `select public.fillout_form_review_list('${client}')`,
      `select public.fillout_form_review_inbox('${owner}',null,null)`,
      `select public.fillout_form_review_file('${client}','${atQuota.id}')`,
      `select public.fillout_form_review_decide('${owner}','${atQuota.id}','approved','')`,
      `select public.fillout_form_review_submit('${client}','${randomUUID()}','AR-11','${pdfBase64}','{}')`,
    ]) await assert.rejects(db.exec(query),error => error.code === '42501',`${role}: ${query}`);
    await db.exec('reset role');
  }
  assert.equal((await db.query("select relrowsecurity from pg_class where oid = 'private.form_review_submissions'::regclass")).rows[0].relrowsecurity,true);

  // Corrupt upstream records, wrong hashes and duplicate IDs fail closed.
  for (const body of [{}, { submissions: [null] }, { submissions: [atQuota,atQuota] }, { submissions: [{ ...atQuota,status: 'approved',reviewedAt: null }] }]) {
    override = { name: 'fillout_form_review_list',body }; assert.equal((await request({ action: 'list' })).status,503);
  }
  override = { name: 'fillout_form_review_file',body: { submissionId: atQuota.id,formId: 'AR-11',sha256: '0'.repeat(64),pdfBase64 } };
  assert.equal((await request({ action: 'file',submissionId: atQuota.id })).status,503);
  override = { name: 'fillout_form_review_file',body: { submissionId: atQuota.id,formId: 'AR-11',sha256,pdfBase64: 'not base64' } };
  assert.equal((await request({ action: 'file',submissionId: atQuota.id })).status,503);
  override = { name: 'fillout_form_review_list',body: { submissions: [],privateData: 'x'.repeat(256 * 1024) } };
  assert.equal((await request({ action: 'list' })).status,503);
  override = undefined;

  // Deleting Auth users atomically deletes every snapshot and PDF, without object-storage cleanup.
  assert.equal((await db.query('select count(*)::int as count from private.form_review_submissions where user_id = $1',[client])).rows[0].count,10);
  await db.query('delete from auth.users where id = $1',[client]);
  assert.equal((await db.query('select count(*)::int as count from private.form_review_submissions where user_id = $1',[client])).rows[0].count,0);
  assert.equal((await request({ action: 'list' })).status,403,'Stale token cannot retrieve deleted account data');
  assert.equal((await db.query('select count(*)::int as count from private.form_review_submissions where user_id = $1',[other])).rows[0].count,21,'Another account remains intact');
  user.id = owner;
  const approvedOther = all.body.submissions.find(row => row.formId === 'AR-11').id;
  assert.equal((await request({ action: 'decide',submissionId: approvedOther,decision: 'approved',note: 'Checked' })).status,200);
  await db.query('delete from auth.users where id = $1',[owner]);
  const survived = (await db.query('select status,reviewed_by from private.form_review_submissions where id = $1',[approvedOther])).rows[0];
  assert.equal(survived.status,'approved'); assert.equal(survived.reviewed_by,null);
  assert.equal((await request({ action: 'file',submissionId: approvedOther })).status,403,'Deleted reviewer cannot use stale Auth response');
  console.log('Form review backend passed: all21 forms, verified ownership, private PDF bytes, exact-byte approval, changes/resubmission, idempotency, stale approval rejection, quotas, role revocation, pagination, bounded transport, RLS/grants and full account deletion cascade. No live submissions made.');
} finally { await db.close(); }
