import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHmac } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createPaymentHandler } from '../supabase/functions/ai-payment/handler.mjs';
import { createRevenueCatWebhookHandler } from '../supabase/functions/revenuecat-webhook/handler.mjs';
import { createFormReviewHandler } from '../supabase/functions/form-review/handler.mjs';
import { readPaymentConfig } from '../supabase/functions/_shared/payments.mjs';

const owner = '11111111-1111-4111-8111-111111111111',other = '22222222-2222-4222-8222-222222222222';
const products = ['I-90','I-130','I-485','I-864','I-864A'].map(formId => ({ formId,store:'app_store',productId:`net.fillout.ai.${formId.toLowerCase()}.case.v1`,revenueCatProductId:`prod_${formId}`,appId:'app_test' }));
const config = { SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',SUPABASE_SECRET_KEY:'sb_secret_test',
  AI_PAYMENTS_ENABLED:'true',REVENUECAT_SECRET_API_KEY:'sk_synthetic_test',REVENUECAT_PROJECT_ID:'proj_test',REVENUECAT_ENVIRONMENT:'production',
  REVENUECAT_PRODUCTS_JSON:JSON.stringify(products),REVENUECAT_WEBHOOK_AUTHORIZATION:'Bearer '+ 'authorization'.repeat(4),REVENUECAT_WEBHOOK_SIGNING_SECRET:'signing-secret'.repeat(4) };
const env = name => config[name];
const db = new PGlite();
let currentUser = owner,purchases = [],productOverride = null,providerFailure = false;
const calls = [];
const rpcKeys = {
  fillout_payment_sync_begin:['p_user_id'],fillout_payment_sync_finish:['p_user_id','p_version','p_project_id','p_environment','p_purchases','p_accept_app_store_sandbox'],
  fillout_payment_case:['p_user_id','p_case_id','p_form_id','p_parent_case_id','p_action'],fillout_payment_case_access:['p_user_id','p_case_id','p_form_id'],
  fillout_payment_webhook:['p_event_id','p_payload_hash','p_user_ids','p_complete'],
  fillout_form_review_submit:['p_user_id','p_request_id','p_form_id','p_pdf_base64','p_answers','p_case_id'],
  fillout_support_operator_access:['p_operator_id'],fillout_form_review_list:['p_user_id'],
  fillout_form_review_inbox:['p_operator_id','p_before_submitted_at','p_before_id','p_environment'],
  fillout_form_review_file:['p_actor_id','p_submission_id','p_environment'],
  fillout_form_review_decision_context:['p_operator_id','p_submission_id','p_environment'],
  fillout_form_review_decide:['p_operator_id','p_submission_id','p_decision','p_note','p_environment'],
};
async function rpc(name,args) {
  assert.ok(rpcKeys[name],name); const keys = rpcKeys[name].filter(key => Object.hasOwn(args,key));
  await db.exec('set role service_role');
  try {
    const result = await db.query(`select public.${name}(${keys.map((key,i) => `${key} => $${i+1}`).join(',')}) as value`,keys.map(key => key === 'p_user_ids' ? `{${args[key].join(',')}}` : args[key] ?? null));
    return Response.json(result.rows[0].value);
  } catch (error) { return Response.json({ code:error.code,message:'Do not expose private provider data' },{ status:400 }); }
  finally { await db.exec('reset role'); }
}
const fetchImpl = async (url,options) => {
  calls.push({ url,options });
  if (url.endsWith('/auth/v1/user')) return Response.json({ id:currentUser,role:'authenticated',email:'test@example.test',email_confirmed_at:'2026-10-12',is_anonymous:false });
  if (url.startsWith('https://api.revenuecat.com/')) {
    assert.equal(options.headers.Authorization,`Bearer ${config.REVENUECAT_SECRET_API_KEY}`);
    assert.equal(options.redirect,'error');
    assert.equal(options.method,undefined,'Payment verifier is read only');
    if (providerFailure) return Response.json({ secret:'provider-private' },{ status:500 });
    if (url.includes('/customers/')) return Response.json({ object:'list',items:purchases,next_page:null });
    const p = products.find(item => url.endsWith('/products/'+item.revenueCatProductId)); assert.ok(p,url);
    return Response.json({ object:'product',state:'active',id:p.revenueCatProductId,app_id:p.appId,store_identifier:p.productId,type:'one_time',one_time:{ is_consumable:true },...productOverride });
  }
  assert.equal(options.headers.apikey,config.SUPABASE_SECRET_KEY);
  return rpc(url.split('/').at(-1),JSON.parse(options.body));
};
const payment = createPaymentHandler({ env,fetchImpl }),review = createFormReviewHandler({ env,fetchImpl });
async function request(input,handler = payment,headers = {}) {
  const res = await handler(new Request('https://example.supabase.co/functions/v1/test',{ method:'POST',headers:{ Authorization:'Bearer synthetic-user-token','Content-Type':'application/json',...headers },body:JSON.stringify(input) }));
  const body = await res.json();
  assert.equal(JSON.stringify(body).includes('private'),false,'No raw provider or database errors');
  return { status:res.status,body };
}
const input = (caseId,formId = 'I-90',action = 'reconcile',extra = {}) => ({ action,caseId,formId,platform:'ios',...extra });
const purchase = (formId = 'I-90',id = 'purchase_1',extra = {}) => ({ object:'purchase',id,customer_id:owner,original_customer_id:owner,
  product_id:products.find(p => p.formId === formId).revenueCatProductId,purchased_at:Date.now()-1000,quantity:1,status:'owned',environment:'production',
  store:'app_store',store_purchase_identifier:`transaction_${id}`,ownership:'purchased',...extra });
async function state(caseId,formId = 'I-90',action = 'reconcile',extra = {}) {
  const result = await request(input(caseId,formId,action,extra)); assert.equal(result.status,200,JSON.stringify(result)); return result.body;
}
try {
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean not null default false);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  for (const file of ['20261010000100_cloud_intake.sql','20261011000100_support_chat.sql','20261011000300_support_inbox.sql','20261011000400_form_review.sql','20261012000100_ai_payments.sql','20261017000100_payment_environments.sql'])
    await db.exec(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
  for (const id of [owner,other]) await db.query("insert into auth.users values($1,'test@example.test','2026-10-12',false)",[id]);

  const caseA = randomUUID(),caseB = randomUUID();
  for (const invalid of [{ ...input(caseA),paid:true },{ ...input(caseA),userId:other },{ ...input(caseA),productId:'untrusted' },{ ...input(caseA),caseId:'not-uuid' },{ ...input(caseA),platform:'other' }])
    assert.equal((await request(invalid)).status,422);
  assert.equal((await request(input(caseA),payment,{ Authorization:'' })).status,401);
  assert.equal((await request(input(caseA),payment,{ Origin:'https://evil.example' })).status,403);
  config.AI_PAYMENTS_ENABLED = 'false';
  assert.equal((await state(caseA)).access,'unavailable');
  assert.equal((await state(caseA)).environment,undefined,'Disabled config makes no environment claim');
  assert.equal((await state(caseA,'AR-11')).access,'granted');
  assert.equal((await state(caseA,'AR-11')).environment,undefined,'Free forms do not require store configuration');
  config.AI_PAYMENTS_ENABLED = 'true';
  assert.equal((await state(caseA,'I-90','status',{ platform:'web' })).access,'unavailable');
  for (const form of ['G-639','I-821D','I-821','I-765WS','I-130A','I-864A']) assert.equal((await state(caseA,form)).access,'unavailable');
  assert.equal((await state(caseA)).access,'payment_required');
  assert.equal((await state(caseA)).environment,'production','Authenticated checkout identifies verified backend environment');
  const prepared = await state(caseA,'I-90','prepare'); assert.equal(prepared.purchasePrepared,true);
  assert.equal((await request(input(caseA,'I-90','prepare'))).status,409,'Repeated same-case checkout blocked across devices');
  assert.equal((await request(input(caseB,'I-90','prepare'))).status,409,'One pending purchase per account/form');
  assert.equal((await state(caseB,'I-90','status')).purchaseState,'pending','New device sees server pending checkout');
  assert.equal((await state(caseA,'I-90','cancel')).access,'payment_required');
  assert.equal((await state(caseA,'I-90','prepare')).purchasePrepared,true,'Conclusive cancellation releases reservation');
  const tx = purchase(); purchases = [tx];
  const recovered = await state(caseB);
  assert.equal(recovered.access,'unavailable','Recovered callback belongs to reserved first case');
  assert.equal(recovered.recoverCaseId,caseA,'New device recovers paid case instead of another charge');
  const recoverBeforePurchase = await state(caseB,'I-90','prepare');
  assert.equal(recoverBeforePurchase.purchasePrepared,false);
  assert.equal(recoverBeforePurchase.recoverCaseId,caseA);
  assert.equal((await state(caseA)).access,'granted');
  assert.equal((await state(caseA)).access,'granted','Idempotent retry keeps same redemption');
  assert.equal((await db.query('select count(*)::int as n from private.payment_purchases')).rows[0].n,1);
  currentUser = other; purchases = [{ ...tx,customer_id:other }];
  assert.equal((await state(randomUUID())).access,'payment_required','Transferred receipt is not minted again');
  assert.equal((await request(input(caseA))).status,409,'Case cannot be rebound to another account');
  currentUser = owner; purchases = [tx];
  const pdfBase64 = Buffer.from('%PDF-1.7\nTest content\n%%EOF\n').toString('base64');
  const submission = { action:'submit',requestId:randomUUID(),formId:'I-90',pdfBase64,answers:{},caseId:caseA };
  assert.equal((await request({ ...submission,caseId:undefined },review)).status,402);
  assert.equal((await request({ ...submission,caseId:caseB },review)).status,402);
  config.AI_PAYMENTS_ENABLED = 'false';
  assert.equal((await request(submission,review)).status,503,'Disabled checkout never bypasses verification for new paid reviews');
  assert.equal((await request({ ...submission,caseId:undefined },review)).status,402,'An old client without a case cannot bypass paid review enforcement');
  config.AI_PAYMENTS_ENABLED = 'true';
  const submitted = await request(submission,review); assert.equal(submitted.status,201,JSON.stringify(submitted));
  assert.equal((await request(submission,review)).body.submission.id,submitted.body.submission.id,'Paid revision is idempotent');
  assert.equal((await db.query('select payment_case_id from private.form_review_submissions where request_id=$1',[submission.requestId])).rows[0].payment_case_id,caseA);
  const secondTx = purchase('I-90','purchase_2'); purchases = [tx,secondTx];
  assert.equal((await state(caseB)).access,'granted');
  assert.equal((await request({ ...submission,caseId:caseB },review)).status,409,'A request ID cannot move to another paid case');

  // Refunds revoke access, reversals restore the original case without minting credit.
  purchases = [{ ...tx,status:'refunded' },secondTx];
  assert.equal((await state(caseA)).access,'unavailable');
  assert.equal((await request(submission,review)).status,402);
  assert.equal((await state(caseA,'I-90','prepare')).purchasePrepared,false,'No accidental second charge for refunded consumed case');
  purchases = [tx,secondTx]; assert.equal((await state(caseA)).access,'granted');
  assert.equal((await state(randomUUID())).recoverCaseId,caseA);

  const parent = randomUUID(),child = randomUUID(),i130 = purchase('I-130','purchase_130'); purchases = [tx,secondTx,i130];
  assert.equal((await state(parent,'I-130')).access,'granted');
  assert.equal((await state(child,'I-130A','reconcile',{ parentCaseId:parent })).access,'granted');
  assert.equal((await state(randomUUID(),'I-130A','reconcile',{ parentCaseId:parent })).recoverCaseId,child,'One component per parent package recovered');
  assert.equal((await request(input(randomUUID(),'I-130A','reconcile',{ parentCaseId:caseA }))).status,402);
  purchases = [tx,secondTx,{ ...i130,status:'refunded' }];
  assert.equal((await request(input(child,'I-130A','reconcile',{ parentCaseId:parent }))).status,402,'Parent refund removes included access');

  const i485 = purchase('I-485','purchase_485'),case485 = randomUUID(),case130 = randomUUID(),case130A = randomUUID();
  purchases = [tx,secondTx,i485];
  assert.equal((await state(case485,'I-485')).access,'granted');
  const autoIncluded = await state(case130,'I-130');
  assert.equal(autoIncluded.access,'granted','Parent package recovered without any local parent draft');
  assert.equal(autoIncluded.productId,null,'Included package component has no checkout SKU');
  const included130A = await state(case130A,'I-130A','reconcile',{ parentCaseId:case130 });
  assert.equal(included130A.access,'granted'); assert.equal(included130A.productId,null);
  assert.equal((await state(randomUUID(),'I-130A','reconcile',{ parentCaseId:case485 })).recoverCaseId,case130A,'One I-130A component even through different package parent paths');
  assert.equal((await state(case130A,'I-130A')).access,'granted','Recovered component reuses persisted parent with no local hint');

  const i864 = purchase('I-864','purchase_864'),i864A = purchase('I-864A','purchase_864a'),case864 = randomUUID(),case864A = randomUUID();
  purchases = [tx,secondTx,i864,i864A];
  assert.equal((await state(case864,'I-864')).access,'granted');
  assert.equal((await state(case864A,'I-864A','reconcile',{ parentCaseId:case864 })).access,'granted');
  purchases = [tx,secondTx,{ ...i864,status:'refunded' },i864A];
  assert.equal((await request(input(case864A,'I-864A','reconcile',{ parentCaseId:case864 }))).status,402,'Additional I-864A requires active paid parent');

  // Wrong app, non-consumable, sandbox, family share, quantity, and duplicate store transaction fail closed.
  productOverride = { app_id:'wrong_app' }; assert.equal((await request(input(caseA))).status,503); productOverride = null;
  productOverride = { one_time:{ is_consumable:false } }; assert.equal((await request(input(caseA))).status,503); productOverride = null;
  purchases = [purchase('I-90','sandbox',{ environment:'sandbox' }),purchase('I-90','shared',{ ownership:'family_shared' })];
  assert.equal((await state(randomUUID())).access,'payment_required');
  purchases = [purchase('I-90','quantity',{ quantity:2 })]; assert.equal((await request(input(caseA))).status,503);
  purchases = [purchase('I-90','missing_store_id',{ store_purchase_identifier:undefined })]; assert.equal((await request(input(caseA))).status,503,'Missing transaction identity fails closed');
  purchases = [{ ...tx,id:'duplicate_rc_id' }]; assert.equal((await state(randomUUID())).access,'payment_required','Store identity unique even if provider purchase ID changes');
  providerFailure = true; assert.equal((await request(input(caseA))).status,503); providerFailure = false;
  config.REVENUECAT_ENVIRONMENT = 'sandbox'; assert.throws(() => readPaymentConfig(env),error => error.status === 503); config.REVENUECAT_ENVIRONMENT = 'production';

  const beginOne = (await (await rpc('fillout_payment_sync_begin',{ p_user_id:owner })).json()).version;
  const beginTwo = (await (await rpc('fillout_payment_sync_begin',{ p_user_id:owner })).json()).version;
  const finish = version => rpc('fillout_payment_sync_finish',{ p_user_id:owner,p_version:version,p_project_id:'proj_test',p_environment:'production',p_purchases:[] });
  assert.equal((await (await finish(beginOne)).json()).code,'PT409','Out-of-order provider snapshot cannot restore revoked access');
  assert.equal((await finish(beginTwo)).status,200);

  // HMAC is over original bytes; timestamp bounds and stored event identity defeat replay/tampering.
  purchases = [tx,secondTx];
  const hook = createRevenueCatWebhookHandler({ env,fetchImpl });
  const event = { event:{ id:'event_1',type:'NON_RENEWING_PURCHASE',app_id:'app_test',environment:'PRODUCTION',app_user_id:owner } };
  async function webhook(payload = JSON.stringify(event),{ signed = payload,timestamp = Math.floor(Date.now()/1000),authorization = config.REVENUECAT_WEBHOOK_AUTHORIZATION,formatSignature = value => value } = {}) {
    const signature = createHmac('sha256',config.REVENUECAT_WEBHOOK_SIGNING_SECRET).update(`${timestamp}.${signed}`).digest('hex');
    return hook(new Request('https://example.supabase.co/functions/v1/revenuecat-webhook',{ method:'POST',headers:{ 'Content-Type':'application/json',Authorization:authorization,'X-RevenueCat-Webhook-Signature':formatSignature(`t=${timestamp},v1=${signature}`) },body:payload }));
  }
  const testEvent = JSON.stringify({ event:{ ...event.event,id:'dashboard_test',type:'TEST' } });
  const callsBeforeTest = calls.length;
  config.AI_PAYMENTS_ENABLED = 'false';
  const dashboardTest = await webhook(testEvent,{ formatSignature:value => value.replace(',',', ') });
  assert.equal(dashboardTest.status,200,'Signed dashboard test works before checkout activation');
  assert.deepEqual(await dashboardTest.json(),{ received:true,test:true });
  assert.equal((await webhook(testEvent,{ authorization:'wrong' })).status,401);
  assert.equal((await webhook(testEvent,{ formatSignature:() => '' })).status,401);
  assert.equal((await webhook(testEvent,{ formatSignature:value => `${value},v1=${'0'.repeat(64)}` })).status,401,'Duplicate signature fields rejected');
  assert.equal((await webhook(testEvent,{ timestamp:Math.floor(Date.now()/1000)-301 })).status,401);
  assert.equal((await webhook()).status,503,'Actual purchase events cannot be acknowledged as processed while disabled');
  assert.equal(calls.length,callsBeforeTest,'Dashboard tests and disabled events make zero RPC/provider calls');
  assert.equal((await db.query('select count(*)::int as n from private.payment_webhook_events')).rows[0].n,0,'Test delivery does not create ledger evidence');
  config.AI_PAYMENTS_ENABLED = 'true';
  assert.equal((await webhook()).status,200);
  const callCount = calls.filter(c => c.url.includes('api.revenuecat.com')).length;
  assert.equal((await webhook()).status,200);
  assert.equal(calls.filter(c => c.url.includes('api.revenuecat.com')).length,callCount,'Duplicate event does not remint or reprocess');
  assert.equal((await webhook(undefined,{ authorization:'wrong' })).status,401);
  assert.equal((await webhook(undefined,{ timestamp:Math.floor(Date.now()/1000)-301 })).status,401);
  assert.equal((await webhook(JSON.stringify(event)+' ',{ signed:JSON.stringify(event) })).status,401);
  const conflict = { event:{ ...event.event,type:'CANCELLATION' } };
  assert.equal((await webhook(JSON.stringify(conflict))).status,409,'Same event ID with changed signed body rejected');
  purchases = [{ ...tx,status:'refunded' },secondTx];
  assert.equal((await webhook(JSON.stringify({ event:{ ...event.event,id:'refund_event',type:'CANCELLATION' } }))).status,200);
  assert.equal((await db.query('select active from private.payment_purchases where purchase_id=$1',[tx.id])).rows[0].active,false);

  // The release staging backend accepts real Apple sandbox receipts only. Switching
  // environments is fail-closed: an old environment's case cannot spend new credit.
  config.REVENUECAT_ENVIRONMENT = 'sandbox'; config.PAYMENTS_STAGING = 'true';
  const sandboxCase = randomUUID(),sandboxPurchase = purchase('I-90','sandbox_verified',{ environment:'sandbox' });
  purchases = [tx,sandboxPurchase];
  const sandboxPrepared = await state(sandboxCase,'I-90','prepare');
  assert.equal(sandboxPrepared.access,'granted','Confirmed sandbox purchase fulfills staging case once');
  assert.equal(sandboxPrepared.environment,'sandbox');
  assert.equal(sandboxPrepared.purchasePrepared,false,'Existing verified credit does not open a second checkout');
  assert.equal((await state(sandboxCase)).access,'granted');
  assert.equal((await db.query('select environment,active from private.payment_purchases where purchase_id=$1',[sandboxPurchase.id])).rows[0].environment,'sandbox');
  assert.equal((await state(caseA)).access,'unavailable','Production receipt cannot unlock a staging case');
  purchases = [{ ...sandboxPurchase,status:'refunded' }];
  const sandboxEvent = JSON.stringify({ event:{ ...event.event,id:'sandbox_refund',type:'CANCELLATION',environment:'SANDBOX' } });
  assert.equal((await webhook(sandboxEvent)).status,200);
  assert.equal((await state(sandboxCase)).access,'unavailable','Sandbox refund removes staging access without offering a duplicate charge');
  assert.equal((await request({ ...submission,requestId:randomUUID(),caseId:sandboxCase },review)).status,402);
  purchases = [sandboxPurchase];
  assert.equal((await webhook(JSON.stringify({ event:{ ...event.event,id:'sandbox_reversal',environment:'SANDBOX' } }))).status,200);
  assert.equal((await state(sandboxCase)).access,'granted','Sandbox reversal restores the same case');
  assert.equal((await request({ ...submission,requestId:randomUUID(),caseId:sandboxCase },review)).status,201);
  config.REVENUECAT_ENVIRONMENT = 'production'; config.PAYMENTS_STAGING = 'false';
  assert.equal((await state(sandboxCase)).access,'unavailable','Sandbox receipt never grants production access');
  const callsBeforeIgnored = calls.length;
  assert.equal((await webhook(sandboxEvent)).status,200);
  assert.equal(calls.length,callsBeforeIgnored,'Wrong-environment webhook performs no reconciliation');
  providerFailure = true;
  assert.equal((await webhook(JSON.stringify({ event:{ ...event.event,id:'pending_event' } }))).status,503);
  assert.equal((await db.query("select processed_at from private.payment_webhook_events where event_id='pending_event'")).rows[0].processed_at,null,'Failed events durably queued and eligible for retry');
  providerFailure = false;
  purchases = [{ ...tx,customer_id:other }];
  assert.equal((await webhook(JSON.stringify({ event:{ id:'transfer_event',type:'TRANSFER',transferred_from:[owner],transferred_to:[other] } }))).status,200,'Transfer without environment reconciles both parties');
  assert.equal((await db.query('select active from private.payment_purchases where purchase_id=$1',[tx.id])).rows[0].active,false);
  const beforeTransferWithEnvironment = calls.length;
  assert.equal((await webhook(JSON.stringify({ event:{ id:'transfer_with_environment',type:'TRANSFER',environment:'PRODUCTION',transferred_from:[owner],transferred_to:[other] } }))).status,200);
  assert.ok(calls.length > beforeTransferWithEnvironment,'Transfer with environment and no app_id still reconciles verified identities');

  // A production backend accepts verified Apple App Review receipts into a
  // separate sandbox namespace. Both snapshots are committed atomically.
  config.REVENUECAT_ACCEPT_APP_STORE_SANDBOX = 'yes';
  assert.throws(() => readPaymentConfig(env),error => error.status === 503);
  config.REVENUECAT_ACCEPT_APP_STORE_SANDBOX = 'true';
  config.REVENUECAT_ENVIRONMENT = 'sandbox'; config.PAYMENTS_STAGING = 'true';
  assert.throws(() => readPaymentConfig(env),error => error.status === 503,'Mixed mode cannot be enabled on a staging-only backend');
  config.REVENUECAT_ENVIRONMENT = 'production'; config.PAYMENTS_STAGING = 'false';
  purchases = [sandboxPurchase];
  assert.equal((await state(sandboxCase)).access,'granted','An existing TestFlight sandbox case reopens after mixed production cutover');
  assert.equal((await state(sandboxCase)).environment,'sandbox');
  const mixedUser = randomUUID();
  await db.query("insert into auth.users values($1,'mixed@example.test','2026-10-12',false)",[mixedUser]);
  await db.query('insert into private.support_operators(user_id) values($1)',[other]);
  currentUser = mixedUser;
  const mixedPurchase = (form,id,extra = {}) => purchase(form,id,{ customer_id:mixedUser,original_customer_id:mixedUser,...extra });
  const preexistingSandbox = mixedPurchase('I-90','mixed_old_sandbox',{ environment:'sandbox',purchased_at:Date.now()-86400000 });
  const reviewerCase = randomUUID(); purchases = [preexistingSandbox];
  assert.equal((await request(input(reviewerCase,'I-90','reconcile',{ environment:'production' }))).status,422,'Client cannot claim its payment environment');
  assert.equal((await state(reviewerCase)).access,'payment_required','Old sandbox balance cannot silently unlock a new production case');
  assert.equal((await state(reviewerCase,'I-90','prepare')).purchasePrepared,true);
  assert.equal((await state(reviewerCase)).purchaseState,'pending','An old sandbox balance cannot consume a checkout reservation');
  const reviewerPurchase = mixedPurchase('I-90','mixed_reviewer',{ environment:'sandbox' });
  purchases.push(reviewerPurchase);
  const reviewerGrant = await state(reviewerCase);
  assert.equal(reviewerGrant.access,'granted'); assert.equal(reviewerGrant.environment,'sandbox');
  const prodCase = randomUUID();
  assert.equal((await state(prodCase)).access,'payment_required','A sandbox case is not recovered as a production application');
  const livePurchase = mixedPurchase('I-90','mixed_live'); purchases.push(livePurchase);
  assert.equal((await state(prodCase)).environment,'production'); assert.equal((await state(prodCase)).access,'granted');
  assert.equal((await state(reviewerCase)).environment,'sandbox','Production receipt never relabels a bound sandbox case');
  assert.equal((await state(randomUUID())).recoverCaseId,prodCase,'Default recovery prefers the matching production namespace');
  const reviewerSubmitted = await request({ ...submission,requestId:randomUUID(),caseId:reviewerCase },review);
  const liveSubmitted = await request({ ...submission,requestId:randomUUID(),caseId:prodCase },review);
  assert.equal(reviewerSubmitted.status,201); assert.equal(liveSubmitted.status,201);
  const sampleReview = reviewerSubmitted.body.submission,liveReview = liveSubmitted.body.submission;
  assert.equal(sampleReview.environment,'sandbox'); assert.equal(sampleReview.caseId,reviewerCase);
  assert.equal(liveReview.environment,'production'); assert.equal(liveReview.caseId,prodCase);
  const bothReviews = (await request({ action:'list' },review)).body.submissions;
  assert.equal(bothReviews.length,2,'Sandbox submission must not supersede the real application');
  assert.deepEqual(new Set(bothReviews.map(s => s.environment)),new Set(['production','sandbox']));
  currentUser = other;
  const productionInbox = (await request({ action:'inbox' },review)).body.submissions;
  assert.ok(productionInbox.some(s => s.id === liveReview.id));
  assert.ok(productionInbox.every(s => s.environment === 'production'));
  const sandboxInbox = (await request({ action:'inbox',environment:'sandbox' },review)).body.submissions;
  assert.ok(sandboxInbox.some(s => s.id === sampleReview.id));
  assert.ok(sandboxInbox.every(s => s.environment === 'sandbox'));
  assert.equal((await request({ action:'file',submissionId:sampleReview.id },review)).status,403,'Old operator without explicit sandbox selection cannot open test documents');
  assert.equal((await request({ action:'file',submissionId:sampleReview.id,environment:'production' },review)).status,403);
  assert.equal((await request({ action:'file',submissionId:sampleReview.id,environment:'sandbox' },review)).body.environment,'sandbox');
  const approve = { action:'decide',submissionId:sampleReview.id,decision:'approved',note:'' };
  assert.equal((await request(approve,review)).status,403,'Default production decision cannot approve a test order');
  assert.equal((await request({ ...approve,environment:'production' },review)).status,403);
  assert.equal((await request({ ...approve,environment:'sandbox' },review)).body.submission.environment,'sandbox');
  assert.equal((await request({ ...approve,submissionId:liveReview.id,environment:'sandbox' },review)).status,403);
  assert.equal((await request({ ...approve,submissionId:liveReview.id,environment:'production' },review)).status,200);
  currentUser = mixedUser;
  assert.equal((await request({ action:'file',submissionId:sampleReview.id },review)).status,200,'Older TestFlight owners can download their approved sandbox PDF');
  assert.equal((await request({ action:'file',submissionId:sampleReview.id,environment:'sandbox' },review)).body.environment,'sandbox');
  assert.equal((await request({ action:'file',submissionId:sampleReview.id,environment:'production' },review)).status,403,'Sandbox PDF cannot be requested as a real service');
  currentUser = owner;
  assert.equal((await request({ action:'file',submissionId:sampleReview.id,environment:'sandbox' },review)).status,403,'Explicit sandbox is never an ownership bypass');
  currentUser = mixedUser;
  const refundPending = (await request({ ...submission,requestId:randomUUID(),caseId:reviewerCase },review)).body.submission;
  purchases = purchases.map(p => p.id === reviewerPurchase.id ? { ...p,status:'refunded' } : p);
  const mixedHook = (id,type='CANCELLATION') => JSON.stringify({ event:{ ...event.event,id,type,environment:'SANDBOX',app_user_id:mixedUser } });
  assert.equal((await webhook(mixedHook('mixed_sandbox_refund'))).status,200);
  assert.equal((await state(reviewerCase)).access,'unavailable');
  assert.equal((await state(prodCase)).access,'granted','Sandbox refund does not revoke the same owner’s real purchase');
  currentUser = other;
  assert.equal((await request({ ...approve,submissionId:refundPending.id,environment:'sandbox' },review)).status,402,'A refunded pending order cannot receive a new approval');
  assert.equal((await request({ ...approve,submissionId:liveReview.id,environment:'production' },review)).status,200,'Refund of another environment does not revoke an existing real approval');
  currentUser = mixedUser;
  assert.equal((await request({ ...submission,requestId:randomUUID(),caseId:reviewerCase },review)).status,402);
  purchases = purchases.map(p => p.id === reviewerPurchase.id ? reviewerPurchase : p);
  assert.equal((await webhook(mixedHook('mixed_sandbox_reversal','NON_RENEWING_PURCHASE'))).status,200);
  assert.equal((await state(reviewerCase)).access,'granted');
  assert.equal((await state(prodCase)).access,'granted');

  // A late old test receipt must never steal a newly purchased real application.
  const delayedCase = randomUUID();
  assert.equal((await state(delayedCase,'I-130','prepare')).purchasePrepared,true);
  const delayedOld = mixedPurchase('I-130','mixed_late_old',{ environment:'sandbox',purchased_at:Date.now()-86400000 });
  const delayedLive = mixedPurchase('I-130','mixed_new_live'); purchases.push(delayedOld,delayedLive);
  assert.equal((await state(delayedCase,'I-130')).access,'granted');
  assert.equal((await state(delayedCase,'I-130')).environment,'production');
  // Ambiguous concurrent receipts fail closed; general reconciliation must not
  // bypass a pending reservation and choose an arbitrary environment.
  const ambiguousCase = randomUUID();
  assert.equal((await state(ambiguousCase,'I-485','prepare')).purchasePrepared,true);
  purchases.push(mixedPurchase('I-485','mixed_ambiguous_live'),mixedPurchase('I-485','mixed_ambiguous_test',{ environment:'sandbox' }));
  const ambiguous = await state(ambiguousCase,'I-485');
  assert.equal(ambiguous.access,'payment_required'); assert.equal(ambiguous.purchaseState,'pending');
  assert.equal((await db.query('select purchase_id from private.payment_cases where id=$1',[ambiguousCase])).rows[0].purchase_id,null);

  // A paid add-on must use the same environment as its immutable parent.
  const testParent = randomUUID(),testAddon = randomUUID();
  assert.equal((await state(testParent,'I-864','prepare')).purchasePrepared,true);
  purchases.push(mixedPurchase('I-864','mixed_parent_test',{ environment:'sandbox' }));
  assert.equal((await state(testParent,'I-864')).environment,'sandbox');
  purchases.push(mixedPurchase('I-864A','mixed_addon_live'));
  const addonBefore = await state(testAddon,'I-864A','reconcile',{ parentCaseId:testParent });
  assert.equal(addonBefore.access,'payment_required'); assert.equal(addonBefore.environment,'sandbox');
  assert.equal((await state(testAddon,'I-864A','prepare',{ parentCaseId:testParent })).purchasePrepared,true);
  purchases.push(mixedPurchase('I-864A','mixed_addon_test',{ environment:'sandbox' }));
  assert.equal((await state(testAddon,'I-864A','reconcile',{ parentCaseId:testParent })).access,'granted');
  assert.equal((await state(testAddon,'I-864A','reconcile',{ parentCaseId:testParent })).environment,'sandbox');

  const playProduct = { ...products[0],store:'play_store',productId:'net.fillout.play.i90',revenueCatProductId:'prod_play_i90',appId:'app_play' };
  products.push(playProduct); config.REVENUECAT_PRODUCTS_JSON = JSON.stringify(products);
  purchases.push(mixedPurchase('I-90','mixed_play_sandbox',{ environment:'sandbox',store:'play_store',product_id:playProduct.revenueCatProductId }));
  await state(prodCase);
  assert.equal((await db.query("select count(*)::int as n from private.payment_purchases where purchase_id='mixed_play_sandbox'")).rows[0].n,0,'App Review flag never accepts Play Store sandbox purchases');
  const playCallCount = calls.length;
  assert.equal((await webhook(JSON.stringify({ event:{ ...event.event,id:'mixed_play_hook',app_id:'app_play',environment:'SANDBOX',app_user_id:mixedUser } }))).status,200);
  assert.equal(calls.length,playCallCount,'Wrong-store sandbox webhook cannot request a ledger sync');
  config.REVENUECAT_ACCEPT_APP_STORE_SANDBOX = 'false';
  assert.equal((await state(reviewerCase)).access,'unavailable'); assert.equal((await state(prodCase)).access,'granted');
  assert.equal((await db.query('select environment from private.form_review_submissions where id=$1',[sampleReview.id])).rows[0].environment,'sandbox','Disabling acceptance never relabels historical test orders');
  currentUser = owner;

  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select * from private.payment_purchases'));
    await assert.rejects(db.query('select public.fillout_payment_sync_begin($1)',[owner]));
    await assert.rejects(db.query('select private.form_review_submit_content($1,$2,$3,$4,$5)',[owner,randomUUID(),'I-90',pdfBase64,{}]));
    await db.exec('reset role');
  }
  await db.query('delete from auth.users where id=$1',[owner]);
  const tombstone = (await db.query('select user_id from private.payment_purchases where purchase_id=$1',[tx.id])).rows[0]; assert.equal(tombstone.user_id,null);
  currentUser = other; purchases = [{ ...tx,customer_id:other,original_customer_id:other }];
  assert.equal((await state(randomUUID())).access,'payment_required','Deleted account transaction remains spent and cannot transfer');
  console.log('Payment checks passed: account/case and sandbox/production isolation, checkout reservations, one-time redemption, refund/reversal, authenticated dormant webhook tests, HMAC replay defense, RLS, immutable review binding.');
} finally { await db.close(); }
