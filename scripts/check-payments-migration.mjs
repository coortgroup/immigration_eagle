import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

// Exercise historical provenance using the actual old RPCs, before applying the
// environment migration. All accounts, answers and PDFs are synthetic/in-memory.
const db = new PGlite();
const sandboxUser = randomUUID(), productionUser = randomUUID(), legacyUser = randomUUID(), operator = randomUUID();
const pdfBase64 = Buffer.from('%PDF-1.7\nSynthetic migration fixture\n%%EOF\n').toString('base64');
const answers = { name: 'SAMPLE ONLY', choices: ['synthetic'] };
const migrations = [
  '20261010000100_cloud_intake.sql', '20261011000100_support_chat.sql',
  '20261011000300_support_inbox.sql', '20261011000400_form_review.sql',
];
const apply = async file => db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
async function rpc(name, args) {
  assert.match(name, /^fillout_[a-z_]+$/);
  await db.exec('set role service_role');
  try {
    const result = await db.query(`select public.${name}(${args.map((_, index) => `$${index + 1}`).join(',')}) as value`, args);
    return result.rows[0].value;
  } finally { await db.exec('reset role'); }
}
const submit = (user, form, caseId) => rpc('fillout_form_review_submit', [user, randomUUID(), form, pdfBase64, answers, ...(caseId ? [caseId] : [])]);
const denied = promise => assert.rejects(promise, error => error.code === 'PT403');
const purchase = (id, formId) => ({
  purchaseId: id, storeTransactionId: `transaction_${id}`, productId: `net.fillout.test.${formId}`,
  formId, store: 'app_store', purchasedAt: '2026-10-12T12:00:00.000Z', active: true,
});
async function sync(user, environment, purchases) {
  const { version } = await rpc('fillout_payment_sync_begin', [user]);
  // The old five-argument signature must also resolve after the migration.
  return rpc('fillout_payment_sync_finish', [user, version, 'synthetic_project', environment, JSON.stringify(purchases)]);
}
async function paidCase(user, form, parent = null) {
  const id = randomUUID();
  const result = await rpc('fillout_payment_case', [user, id, form, parent, 'reconcile']);
  assert.equal(result.allowed, true, 'Historical cases must be authorized by the genuine old ledger');
  return id;
}
async function snapshot() {
  const result = {};
  for (const table of ['auth.users', 'private.payment_purchases', 'private.payment_cases', 'private.form_review_submissions']) {
    result[table] = (await db.query(`select to_jsonb(row) - 'environment' as value from ${table} row order by id`)).rows;
  }
  // Purchase environment is immutable historical evidence too.
  result.purchaseEnvironments = (await db.query('select id, environment from private.payment_purchases order by id')).rows;
  return result;
}

try {
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean not null default false);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  for (const file of migrations) await apply(file);
  for (const user of [sandboxUser, productionUser, legacyUser, operator]) {
    await db.query("insert into auth.users values($1,'synthetic@example.test','2026-10-12',false)", [user]);
  }
  await db.query('insert into private.support_operators(user_id) values($1)', [operator]);

  // These were accepted before the payment ledger existed. A paid form name is
  // not proof of a production purchase, even if an operator already approved it.
  const legacyPending = await submit(legacyUser, 'I-90');
  const legacyApproved = await submit(legacyUser, 'N-400');
  await rpc('fillout_form_review_decide', [operator, legacyApproved.id, 'approved', '']);
  const free = await submit(legacyUser, 'AR-11');
  await rpc('fillout_form_review_decide', [operator, free.id, 'approved', '']);
  assert.equal((await rpc('fillout_form_review_file', [operator, legacyApproved.id])).pdfBase64, pdfBase64);

  await apply('20261012000100_ai_payments.sql');
  const sandboxPurchase = purchase('sandbox_package', 'I-485');
  await sync(sandboxUser, 'sandbox', [sandboxPurchase]);
  const sandboxParent = await paidCase(sandboxUser, 'I-485');
  const sandboxChild = await paidCase(sandboxUser, 'I-130', sandboxParent);
  const sandboxGrandchild = await paidCase(sandboxUser, 'I-130A', sandboxChild);
  const sandboxSubmissions = [
    await submit(sandboxUser, 'I-485', sandboxParent),
    await submit(sandboxUser, 'I-130', sandboxChild),
    await submit(sandboxUser, 'I-130A', sandboxGrandchild),
  ];
  await rpc('fillout_form_review_decide', [operator, sandboxSubmissions[0].id, 'approved', '']);
  const productionPurchase = purchase('production_case', 'I-90');
  await sync(productionUser, 'production', [productionPurchase]);
  const productionCase = await paidCase(productionUser, 'I-90');
  const production = await submit(productionUser, 'I-90', productionCase);

  const before = await snapshot();
  await apply('20261017000100_payment_environments.sql');
  assert.deepEqual(await snapshot(), before, 'Backfill changes no accounts, case/purchase identity, content bytes/hash, answers or review status');
  const historical = (await db.query('select id, environment from private.form_review_submissions')).rows;
  const byId = new Map(historical.map(row => [row.id, row.environment]));
  for (const submission of sandboxSubmissions) assert.equal(byId.get(submission.id), 'sandbox', 'Included ancestry inherits the sandbox purchase provenance');
  assert.equal(byId.get(production.id), 'production');
  assert.equal(byId.get(free.id), 'production', 'Free forms retain their payment-independent production workflow');
  for (const submission of [legacyPending, legacyApproved]) assert.equal(byId.get(submission.id), 'legacy');

  const legacyList = await rpc('fillout_form_review_list', [legacyUser]);
  assert.deepEqual(legacyList.submissions.map(row => row.id), [free.id], 'Unproven paid history is hidden from the owner list');
  const defaultInbox = await rpc('fillout_form_review_inbox', [operator]);
  assert.deepEqual(new Set(defaultInbox.submissions.map(row => row.id)), new Set([free.id, production.id]), 'Old inbox signature defaults to production only');
  const sandboxInbox = await rpc('fillout_form_review_inbox', [operator, null, null, 'sandbox']);
  assert.deepEqual(new Set(sandboxInbox.submissions.map(row => row.id)), new Set(sandboxSubmissions.map(row => row.id)));
  for (const submission of [legacyPending, legacyApproved]) {
    for (const environment of ['production', 'sandbox']) {
      await denied(rpc('fillout_form_review_decision_context', [operator, submission.id, environment]));
      await denied(rpc('fillout_form_review_decide', [operator, submission.id, 'approved', '', environment]));
      await denied(rpc('fillout_form_review_file', [operator, submission.id, environment]));
      await denied(rpc('fillout_form_review_file', [legacyUser, submission.id, environment]));
    }
    await denied(rpc('fillout_form_review_decide', [operator, submission.id, 'approved', '']));
    await denied(rpc('fillout_form_review_file', [operator, submission.id]));
    await denied(rpc('fillout_form_review_file', [legacyUser, submission.id]));
  }

  await assert.rejects(rpc('fillout_form_review_decide', [operator, production.id, 'approved', '']),
    error => error.code === 'PT402', 'Historical sync without environment context cannot authorize a first paid approval');
  const decisionContext = await rpc('fillout_form_review_decision_context', [operator, production.id]);
  assert.deepEqual(decisionContext, { userId: productionUser, caseId: productionCase, formId: 'I-90', environment: 'production', status: 'pending' },
    'Decision context returns only the metadata needed for fresh verification');
  assert.equal((await sync(productionUser, 'production', [productionPurchase])).synced, true);
  assert.equal((await rpc('fillout_payment_case_access', [productionUser, productionCase, 'I-90'])).allowed, true);
  const approved = await rpc('fillout_form_review_decide', [operator, production.id, 'approved', '']);
  assert.equal(approved.environment, 'production', 'Old decision signature still handles production');
  assert.equal((await rpc('fillout_form_review_file', [productionUser, production.id])).pdfBase64, pdfBase64);
  assert.equal((await rpc('fillout_form_review_file', [legacyUser, free.id])).pdfBase64, pdfBase64);
  await denied(rpc('fillout_form_review_file', [operator, sandboxSubmissions[0].id]));
  const oldSandboxOwnerFile = await rpc('fillout_form_review_file', [sandboxUser, sandboxSubmissions[0].id]);
  assert.equal(oldSandboxOwnerFile.environment, 'sandbox', 'Old owner downloads retain sandbox provenance');
  assert.equal(oldSandboxOwnerFile.pdfBase64, pdfBase64);
  assert.equal((await rpc('fillout_form_review_decide', [operator, sandboxSubmissions[0].id, 'approved', '', 'sandbox'])).environment, 'sandbox',
    'Historical approved decisions remain idempotent without new payment context');
  await denied(rpc('fillout_form_review_decide', [operator, sandboxSubmissions[1].id, 'approved', '']));
  await assert.rejects(rpc('fillout_form_review_decide', [operator, sandboxSubmissions[1].id, 'approved', '', 'sandbox']),
    error => error.code === 'PT402', 'First sandbox approval also requires a fresh verified snapshot');
  assert.equal((await sync(sandboxUser, 'sandbox', [sandboxPurchase])).synced, true);
  assert.equal((await rpc('fillout_form_review_decide', [operator, sandboxSubmissions[1].id, 'approved', '', 'sandbox'])).environment, 'sandbox');

  const serviceFunctions = [
    'public.fillout_payment_sync_finish(uuid,bigint,text,text,jsonb,boolean)',
    'public.fillout_form_review_inbox(uuid,timestamp with time zone,uuid,text)',
    'public.fillout_form_review_file(uuid,uuid,text)',
    'public.fillout_form_review_decide(uuid,uuid,text,text,text)',
    'public.fillout_form_review_decision_context(uuid,uuid,text)',
    'private.payment_case_environment(uuid,uuid,text)',
  ];
  for (const signature of serviceFunctions) {
    for (const role of ['service_role', 'anon', 'authenticated']) {
      const { rows } = await db.query("select has_function_privilege($1,$2,'execute') as allowed", [role, signature]);
      assert.equal(rows[0].allowed, role === 'service_role', `${signature}: ${role} execute boundary`);
    }
  }
  for (const role of ['service_role', 'anon', 'authenticated']) {
    const { rows } = await db.query("select has_function_privilege($1,'private.form_review_submit_content(uuid,uuid,text,text,jsonb,uuid,text)','execute') as allowed", [role]);
    assert.equal(rows[0].allowed, false, 'No role may bypass payment provenance through the private content writer');
  }
  console.log('Payment migration passed: genuine historical purchases, sandbox package ancestry, legacy quarantine, unchanged accounts/content/ledger, old RPC defaults and service permissions.');
} finally { await db.close(); }
