import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createSupportChatHandler } from '../supabase/functions/support-chat/handler.mjs';

const userId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const pendingId = '33333333-3333-4333-8333-333333333333';
const settings = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example', SUPABASE_SECRET_KEY: 'sb_secret_example' };
let user = { id: userId, role: 'authenticated', email: 'chat@example.test', email_confirmed_at: '2026-10-11T00:00:00Z', is_anonymous: false };
let badReceipt = false;
const calls = [];
const db = new PGlite();
try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, is_anonymous boolean not null default false);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/20261010000100_cloud_intake.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/20261011000100_support_chat.sql', import.meta.url), 'utf8'));
  for (const id of [userId, otherId, pendingId]) await db.query('insert into auth.users values($1,$2,$3,false)', [id, 'test@example.test', id === pendingId ? null : '2026-10-11T00:00:00Z']);
  const rpc = async (name, args) => {
    await db.exec('set role service_role');
    try {
      let result;
      if (name === 'fillout_support_send') result = await db.query('select public.fillout_support_send($1,$2,$3) as value', [args.p_user_id, args.p_client_message_id, args.p_body]);
      else if (name === 'fillout_support_list') result = await db.query('select public.fillout_support_list($1,$2,$3) as value', [args.p_user_id, args.p_before_created_at, args.p_before_id]);
      else throw Error(`Unexpected RPC ${name}`);
      return Response.json(badReceipt ? {} : result.rows[0].value);
    } catch (error) {
      return Response.json({ code: error.code, message: 'Private database diagnostic' }, { status: 400 });
    } finally { await db.exec('reset role'); }
  };
  const handler = createSupportChatHandler({ env: name => settings[name], fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return Response.json(user);
    assert.equal(options.headers.apikey, settings.SUPABASE_SECRET_KEY);
    return rpc(url.split('/').at(-1), JSON.parse(options.body));
  } });
  async function send(input, { auth = true, origin = 'https://fillout.net' } = {}) {
    const result = await handler(new Request('https://example.supabase.co/functions/v1/support-chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer synthetic-user-token' } : {}), ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(input),
    }));
    return { status: result.status, body: await result.json() };
  }
  const message = { action: 'send', body: '  Synthetic customer question  ', clientMessageId: randomUUID() };
  assert.equal((await send(message, { auth: false })).status, 401);
  assert.equal(calls.length, 0);
  assert.equal((await send(message, { origin: 'https://evil.example' })).status, 403);
  assert.equal(calls.length, 0);
  for (const input of [
    { ...message, userId: otherId }, { ...message, sender: 'team' }, { ...message, body: 'a'.repeat(2001) },
    { ...message, body: '\n  ' }, { ...message, body: 'a\u0000b' }, { ...message, clientMessageId: 'bad' },
    { action: 'list', before: { id: randomUUID() } }, { action: 'list', userId: otherId }, { action: 'delete' },
  ]) assert.equal((await send(input)).status, 422);
  user.is_anonymous = true;
  assert.equal((await send(message)).status, 403);
  user.is_anonymous = false;
  user.email_confirmed_at = null;
  assert.equal((await send(message)).status, 403);
  user.email_confirmed_at = '2026-10-11T00:00:00Z';

  const first = await send(message, { origin: null });
  assert.equal(first.status, 201, JSON.stringify(first));
  assert.equal(first.body.message.body, message.body.trim());
  assert.equal(first.body.message.sender, 'customer');
  assert.equal(first.body.message.clientMessageId, message.clientMessageId);
  assert.deepEqual((await send(message)).body, first.body, 'Uncertain delivery retries keep one stored message');
  assert.equal((await send({ ...message, body: 'different' })).status, 409);
  assert.equal((await db.query('select count(*)::int as count from public.support_messages')).rows[0].count, 1);

  await db.query("insert into public.support_messages(user_id,sender,body) values($1,'team',$2)", [userId, 'Synthetic human reply']);
  let page = await send({ action: 'list' });
  assert.equal(page.status, 200, JSON.stringify(page));
  assert.deepEqual(page.body.messages.map(item => item.sender), ['customer', 'team']);
  assert.equal(page.body.hasMore, false);
  assert.equal(page.body.nextBefore, null);
  user.id = otherId;
  assert.deepEqual((await send({ action: 'list' })).body.messages, [], 'List derives owner from verified Auth token');
  const otherMessage = await send({ ...message, body: 'Second account' });
  assert.equal(otherMessage.status, 201, 'Same client id is isolated per account');
  user.id = userId;

  // The timestamp and ID cursor does not skip messages sharing one timestamp.
  for (let i = 0; i < 23; i++) await db.query("insert into public.support_messages(user_id,sender,body,created_at) values($1,'team',$2,'2026-10-12T12:00:00Z')", [userId, `Reply ${i}`]);
  const ids = new Set();
  let before;
  do {
    page = await send({ action: 'list', ...(before ? { before } : {}) });
    assert.equal(page.status, 200, JSON.stringify(page));
    assert.ok(page.body.messages.length <= 10);
    for (const row of page.body.messages) { assert.ok(!ids.has(row.id), 'Pagination never duplicates IDs'); ids.add(row.id); }
    before = page.body.nextBefore;
  } while (before);
  assert.equal(ids.size, 25, 'Pagination returns every customer and team message');

  for (let i = 0; i < 10; i++) await db.query("insert into public.support_messages(user_id,sender,body,created_at) values($1,'team',$2,'2030-01-01T12:00:00Z')", [userId, '字'.repeat(2000)]);
  page = await send({ action: 'list' });
  assert.equal(page.status, 200, 'Worst-case allowed Unicode page fits the bounded service response');
  assert.ok(new TextEncoder().encode(JSON.stringify(page.body)).length < 65_536);
  await assert.rejects(db.query("insert into public.support_messages(user_id,sender,body) values($1,'team',$2)", [userId, '😀'.repeat(2000)]), error => error.code === '23514');

  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [otherId]);
  assert.equal((await db.query('select * from public.support_messages')).rows.length, 1, 'RLS also isolates direct reads');
  for (const query of [
    "insert into public.support_messages(user_id,sender,body) values('11111111-1111-4111-8111-111111111111','team','Forged')",
    "update public.support_messages set body = 'Changed'", 'delete from public.support_messages',
    `select public.fillout_support_list('${userId}',null,null)`, `select public.fillout_support_send('${userId}','${randomUUID()}','Hidden')`,
  ]) await assert.rejects(db.exec(query), error => error.code === '42501');
  await db.exec('reset role; set role anon');
  await assert.rejects(db.exec('select * from public.support_messages'), error => error.code === '42501');
  await db.exec('reset role');
  assert.equal((await (await rpc('fillout_support_send', { p_user_id: pendingId, p_client_message_id: randomUUID(), p_body: 'Pending' })).json()).code, 'PT403');
  assert.equal((await (await rpc('fillout_support_send', { p_user_id: userId, p_client_message_id: randomUUID(), p_body: '\n\t' })).json()).code, 'PT422');
  assert.equal((await (await rpc('fillout_support_list', { p_user_id: pendingId, p_before_created_at: null, p_before_id: null })).json()).code, 'PT403');

  // Failed storage cannot produce a delivered message; upstream diagnostics remain private.
  await db.exec(`create function private.reject_support_test() returns trigger language plpgsql as $$ begin raise exception 'Private storage failure'; end; $$;
    create trigger reject_support_test before insert on public.support_messages for each row execute function private.reject_support_test();`);
  const failure = await send({ ...message, clientMessageId: randomUUID() });
  assert.equal(failure.status, 503);
  assert.equal(JSON.stringify(failure).includes('Private storage failure'), false);
  await db.exec('drop trigger reject_support_test on public.support_messages; drop function private.reject_support_test()');
  badReceipt = true;
  assert.equal((await send({ action: 'list' })).status, 503);
  badReceipt = false;
  for (let i = 1; i < 30; i++) assert.equal((await send({ ...message, clientMessageId: randomUUID() })).status, 201);
  assert.equal((await send({ ...message, clientMessageId: randomUUID() })).status, 429);
  assert.equal((await send(message)).status, 201, 'An idempotent replay succeeds even after quota is reached');
  assert.ok(calls.every(call => !call.url.includes('openai')), 'Human chat never invokes an AI provider');
  console.log('Human support backend passed: real SQL persistence, team replies, auth/RLS isolation, immutable customer messages, idempotency, pagination ties, quotas and failed storage. No live messages sent.');
} finally { await db.close(); }
