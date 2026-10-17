import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createSupportInboxHandler } from '../supabase/functions/support-inbox/handler.mjs';

const operatorId = '11111111-1111-4111-8111-111111111111';
const customerId = '22222222-2222-4222-8222-222222222222';
const otherId = '33333333-3333-4333-8333-333333333333';
const secondOperatorId = '44444444-4444-4444-8444-444444444444';
const pendingId = '55555555-5555-4555-8555-555555555555';
const settings = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example', SUPABASE_SECRET_KEY: 'sb_secret_example' };
let user = { id: operatorId, role: 'authenticated', email: 'owner@example.test', email_confirmed_at: '2026-10-11T00:00:00Z', is_anonymous: false };
let overrideResponse, afterAccess;
const calls = [];
const db = new PGlite();
try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, is_anonymous boolean not null default false, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `);
  for (const path of ['20261010000100_cloud_intake.sql','20261011000100_support_chat.sql','20261011000300_support_inbox.sql']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${path}`, import.meta.url), 'utf8'));
  }
  for (const id of [operatorId,customerId,otherId,secondOperatorId,pendingId]) {
    await db.query('insert into auth.users values($1,$2,$3,false,$4)', [id, `${id}@example.test`, id === pendingId ? null : '2026-10-11T00:00:00Z', { role: 'operator' }]);
  }
  await db.query('insert into private.support_operators(user_id) values($1),($2)', [operatorId,secondOperatorId]);
  const rpcArgs = {
    fillout_support_operator_access: ['p_operator_id'],
    fillout_support_inbox: ['p_operator_id','p_before_created_at','p_before_user_id'],
    fillout_support_operator_list: ['p_operator_id','p_user_id','p_before_created_at','p_before_id'],
    fillout_support_reply: ['p_operator_id','p_user_id','p_client_message_id','p_body'],
    fillout_support_send: ['p_user_id','p_client_message_id','p_body'],
  };
  async function rpc(name, args) {
    assert.ok(Object.hasOwn(rpcArgs,name), `Only expected RPC: ${name}`);
    await db.exec('set role service_role');
    try {
      const keys = rpcArgs[name];
      const value = (await db.query(`select public.${name}(${keys.map((_,i) => `$${i+1}`).join(',')}) as value`, keys.map(key => args[key]))).rows[0].value;
      return Response.json(value);
    } catch (error) {
      return Response.json({ code: error.code, message: 'Private storage diagnostic' }, { status: 400 });
    } finally { await db.exec('reset role'); }
  }
  const handler = createSupportInboxHandler({ env: name => settings[name], fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return Response.json(user);
    assert.equal(options.headers.apikey, settings.SUPABASE_SECRET_KEY);
    assert.equal(options.headers.Authorization, undefined, 'Opaque secret is not used as a bearer token');
    const name = url.split('/').at(-1), args = JSON.parse(options.body);
    if (overrideResponse?.name === name) return Response.json(overrideResponse.body);
    const response = await rpc(name,args);
    if (name === 'fillout_support_operator_access' && afterAccess) await afterAccess();
    return response;
  } });
  async function request(input, { auth = true, origin = 'https://fillout.net' } = {}) {
    const result = await handler(new Request('https://example.supabase.co/functions/v1/support-inbox', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer synthetic-user-token' } : {}), ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(input),
    }));
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
    return { status: result.status, body: await result.json() };
  }
  const reply = { action: 'reply', userId: customerId, clientMessageId: randomUUID(), body: '  Synthetic operator reply  ' };
  assert.equal((await request(reply,{ auth: false })).status,401);
  assert.equal((await request(reply,{ origin: 'https://evil.example' })).status,403);
  assert.equal(calls.length,0);
  assert.equal((await request({ action: 'access' })).body.allowed,true);
  for (const input of [
    { ...reply, operatorId: secondOperatorId }, { ...reply, sender: 'customer' }, { ...reply, userId: 'bad' },
    { ...reply, clientMessageId: 'bad' }, { ...reply, body: 'a'.repeat(2001) }, { ...reply, body: '\n\t' },
    { ...reply, body: 'hidden\u0000' }, { action: 'delete' }, { action: 'access', role: 'operator' },
    { action: 'inbox', before: { userId: customerId } }, { action: 'inbox', before: { userId: customerId, createdAt: 'bad' } },
    { action: 'inbox', before: { userId: customerId, createdAt: '2026-10-11', extra: 1 } },
    { action: 'list', userId: customerId, before: { id: randomUUID() } },
  ]) assert.equal((await request(input)).status,422,JSON.stringify(input));

  // Neither token metadata nor a user-editable database metadata field grants access.
  user = { ...user, id: customerId, user_metadata: { role: 'operator', is_admin: true } };
  assert.deepEqual((await request({ action: 'access' })).body,{ allowed: false });
  for (const input of [{ action: 'inbox' },{ action: 'list',userId: otherId },reply]) {
    const denied = await request(input);
    assert.equal(denied.status,403);
    assert.equal(denied.body.error.code,'operator_access_required');
  }
  user.id = operatorId;
  user.is_anonymous = true;
  assert.equal((await request({ action: 'access' })).status,403);
  user.is_anonymous = false;
  user.email_confirmed_at = null;
  assert.equal((await request({ action: 'access' })).status,403);
  user.email_confirmed_at = '2026-10-11T00:00:00Z';
  await db.query('update auth.users set email_confirmed_at = null where id = $1',[operatorId]);
  assert.equal((await request({ action: 'access' })).body.allowed,false,'Database also verifies operator account state');
  await db.query("update auth.users set email_confirmed_at = '2026-10-11' where id = $1",[operatorId]);

  const first = await request(reply,{ origin: null });
  assert.equal(first.status,201,JSON.stringify(first));
  assert.equal(first.body.message.sender,'team');
  assert.equal(first.body.message.body,reply.body.trim());
  assert.deepEqual((await request(reply)).body,first.body,'Lost-response retry returns the exact original receipt');
  assert.equal((await db.query('select count(*)::int as count from public.support_messages')).rows[0].count,1);
  assert.equal((await db.query('select operator_id from private.support_replies')).rows[0].operator_id,operatorId,'Audit attribution comes from token');
  assert.equal((await request({ ...reply, body: 'Edited' })).status,409);
  user.id = secondOperatorId;
  assert.equal((await request(reply)).status,409,'Another operator cannot claim an existing idempotency key');
  user.id = operatorId;
  assert.equal((await request({ ...reply, userId: otherId })).status,201,'Same key is isolated per customer');
  const customerKey = randomUUID();
  await rpc('fillout_support_send',{ p_user_id: customerId,p_client_message_id: customerKey,p_body: 'Customer original' });
  assert.equal((await request({ ...reply, clientMessageId: customerKey,body: 'Customer original' })).status,409,'Customer receipt cannot be claimed as a team reply');
  assert.equal((await (await rpc('fillout_support_send',{ p_user_id: customerId,p_client_message_id: reply.clientMessageId,p_body: reply.body.trim() })).json()).code,'PT409');
  assert.equal((await request({ ...reply, userId: pendingId })).status,403);
  assert.equal((await request({ action: 'list',userId: pendingId })).status,403);
  assert.equal((await request({ action: 'list',userId: otherId })).body.messages.length,1);
  assert.equal((await request({ action: 'list',userId: customerId })).body.messages.length,2);
  assert.ok(calls.filter(call => call.url.includes('/rpc/')).every(call => {
    const args = JSON.parse(call.options.body);
    return args.p_operator_id === undefined || [operatorId,customerId,secondOperatorId].includes(args.p_operator_id);
  }));

  // Access is rechecked inside each data RPC, even after the endpoint's first access check succeeds.
  for (const input of [{ action: 'inbox' },{ action: 'list',userId: customerId },reply]) {
    afterAccess = () => db.query('delete from private.support_operators where user_id = $1',[operatorId]);
    assert.equal((await request(input)).status,403,'Revocation between authorization and data access must deny');
    afterAccess = undefined;
    await db.query('insert into private.support_operators(user_id) values($1)',[operatorId]);
  }

  // Identical timestamps must not skip conversations, and newest message ID breaks ties within a conversation.
  for (let i = 0; i < 43; i++) {
    const id = randomUUID();
    await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,'2026-10-11')",[id,`${i}@example.test`]);
    await db.query("insert into public.support_messages(user_id,sender,body,client_message_id,created_at) values($1,'customer',$2,$3,'2030-01-01T00:00:00.123456Z')",[id,`Question ${i}`,randomUUID()]);
  }
  const seen = new Set(); let before, page;
  do {
    page = await request({ action: 'inbox',...(before ? { before } : {}) });
    assert.equal(page.status,200,JSON.stringify(page));
    assert.ok(page.body.conversations.length <= 20);
    for (const item of page.body.conversations) { assert.ok(!seen.has(item.userId)); seen.add(item.userId); }
    before = page.body.nextBefore;
  } while (before);
  assert.equal(seen.size,45);
  const customerMessages = [];
  for (let i = 0; i < 23; i++) {
    const id = randomUUID(); customerMessages.push(id);
    await db.query("insert into public.support_messages(id,user_id,sender,body,created_at) values($1,$2,'team',$3,'2031-01-01T00:00:00.123456Z')",[id,customerId,`Reply ${i}`]);
  }
  const conversationIds = new Set(); before = undefined;
  do {
    page = await request({ action: 'list',userId: customerId,...(before ? { before } : {}) });
    assert.equal(page.status,200,JSON.stringify(page));
    for (const item of page.body.messages) { assert.ok(!conversationIds.has(item.id)); conversationIds.add(item.id); }
    before = page.body.nextBefore;
  } while (before);
  assert.equal(conversationIds.size,25);
  page = await request({ action: 'inbox' });
  const newest = (await db.query('select body from public.support_messages where id = $1',[customerMessages.sort().at(-1)])).rows[0].body;
  assert.equal(page.body.conversations[0].userId,customerId);
  assert.equal(page.body.conversations[0].preview,newest);
  assert.equal(page.body.conversations[0].needsReply,false);

  // Maximum legal Unicode payloads remain below the shared upstream boundary.
  for (let i = 0; i < 10; i++) await db.query("insert into public.support_messages(user_id,sender,body,created_at) values($1,'team',$2,'2032-01-01')",[customerId,'字'.repeat(2000)]);
  page = await request({ action: 'list',userId: customerId });
  assert.equal(page.status,200);
  assert.ok(new TextEncoder().encode(JSON.stringify(page.body)).length < 65_536);
  await db.query('update auth.users set email = $1',['😀'.repeat(160)]);
  await db.query('update public.support_messages set body = $1',['😀'.repeat(1500)]);
  page = await request({ action: 'inbox' });
  assert.equal(page.status,200);
  assert.ok(new TextEncoder().encode(JSON.stringify(page.body)).length < 65_536);

  for (const role of ['authenticated','anon']) {
    await db.exec(`set role ${role}`);
    for (const query of [
      'select * from private.support_operators', 'select * from private.support_replies',
      `insert into private.support_operators(user_id) values('${customerId}')`,
      `select public.fillout_support_operator_access('${operatorId}')`,
      `select public.fillout_support_inbox('${operatorId}',null,null)`,
      `select public.fillout_support_operator_list('${operatorId}','${customerId}',null,null)`,
      `select public.fillout_support_reply('${operatorId}','${customerId}','${randomUUID()}','Forged')`,
    ]) await assert.rejects(db.exec(query),error => error.code === '42501',`${role}: ${query}`);
    await db.exec('reset role');
  }

  // Corrupt or oversized upstream data must fail closed, without private diagnostics.
  const summary = { userId: customerId,email: 'client@example.test',preview: 'Question',lastCreatedAt: '2032-01-01T00:00:00Z',needsReply: true };
  const receipt = first.body.message;
  for (const [name,input,bodies] of [
    ['fillout_support_operator_access',{ action: 'access' },[null,{}, { allowed: 'yes' }]],
    ['fillout_support_inbox',{ action: 'inbox' },[
      {}, { conversations: [],hasMore: true,nextBefore: null },{ conversations: [null],hasMore: false,nextBefore: null },
      { conversations: [summary,summary],hasMore: false,nextBefore: null },
      { conversations: [summary],hasMore: true,nextBefore: { userId: otherId,createdAt: summary.lastCreatedAt } },
      { conversations: [summary],hasMore: true,nextBefore: { userId: customerId,createdAt: '2031-01-01' } },
    ]],
    ['fillout_support_operator_list',{ action: 'list',userId: customerId },[
      {}, { messages: [receipt],hasMore: true,nextBefore: null },
      { messages: [receipt,receipt],hasMore: false,nextBefore: null },
      { messages: [{ ...receipt,sender: 'customer',clientMessageId: null }],hasMore: false,nextBefore: null },
      { messages: [receipt],hasMore: true,nextBefore: { id: randomUUID(),createdAt: receipt.createdAt } },
      { messages: [receipt],hasMore: true,nextBefore: { id: receipt.id,createdAt: '2031-01-01' } },
    ]],
    ['fillout_support_reply',reply,[{}, { ...first.body.message,sender: 'customer' }, { ...first.body.message,clientMessageId: randomUUID() }, { ...first.body.message,body: 'Wrong receipt' }]],
  ]) for (const body of bodies) {
    overrideResponse = { name,body };
    const result = await request(input);
    assert.equal(result.status,503,JSON.stringify(result));
    assert.equal(JSON.stringify(result).includes('Private'),false);
  }
  overrideResponse = { name: 'fillout_support_inbox',body: { secret: 'x'.repeat(65_536) } };
  assert.equal((await request({ action: 'inbox' })).status,503);
  overrideResponse = undefined;

  await db.query('delete from auth.users where id = $1',[customerId]);
  assert.equal((await db.query('select count(*)::int as count from public.support_messages where user_id = $1',[customerId])).rows[0].count,0);
  assert.equal((await db.query('select count(*)::int as count from private.support_replies where message_id = $1',[first.body.message.id])).rows[0].count,0,'Customer deletion cascades reply audit records');
  await db.query('delete from auth.users where id = $1',[operatorId]);
  assert.equal((await db.query('select count(*)::int as count from private.support_operators where user_id = $1',[operatorId])).rows[0].count,0);
  assert.equal((await db.query('select operator_id from private.support_replies')).rows[0].operator_id,null,'Operator deletion removes attribution while retaining the other customer conversation');
  assert.equal((await request({ action: 'access' })).body.allowed,false,'A stale operator token cannot restore deleted membership');
  assert.ok(calls.every(call => !call.url.includes('openai')));
  console.log('Operator inbox backend passed: private role provisioning, verified token identity, revocation, RPC grants, isolated replies, idempotency, timestamp pagination, bounded Unicode output, invalid receipts and deletion cascades. No live messages sent.');
} finally { await db.close(); }
