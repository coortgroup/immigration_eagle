-- User content stays in Postgres. The notification outbox contains IDs only.
-- Private implementations are not exposed by PostgREST; service-only wrappers
-- run as invoker, with separate execute grants for both layers.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new', 'in_progress', 'closed')),
  unique (user_id, request_id)
);
create index requests_user_created_idx on public.requests (user_id, created_at desc);
alter table public.requests enable row level security;
revoke all on public.requests from public, anon, authenticated;
grant select on public.requests to authenticated;
grant all on public.requests to service_role;
create policy requests_read_own on public.requests for select to authenticated
  using ((select auth.uid()) = user_id);

create table private.notification_outbox (
  request_id uuid primary key references public.requests(id) on delete cascade,
  event_type text not null default 'request_created' check (event_type = 'request_created'),
  created_at timestamptz not null default now(),
  state text not null default 'pending' check (state in ('pending', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0)
);
comment on table private.notification_outbox is 'Metadata only. No worker is enabled yet; pending never means an email was sent.';
alter table private.notification_outbox enable row level security;
revoke all on private.notification_outbox from public, anon, authenticated;
grant all on private.notification_outbox to service_role;

create table private.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index ai_usage_events_created_idx on private.ai_usage_events (created_at);
create index ai_usage_events_user_created_idx on private.ai_usage_events (user_id, created_at);
alter table private.ai_usage_events enable row level security;
revoke all on private.ai_usage_events from public, anon, authenticated;
grant all on private.ai_usage_events to service_role;

create function private.submit_request(p_user_id uuid, p_request_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.requests%rowtype;
  received_at timestamptz;
begin
  if not exists (select 1 from auth.users where id = p_user_id and is_anonymous = false and email is not null and email <> '' and email_confirmed_at is not null) then
    raise sqlstate 'PT403' using message = 'verified_email_required';
  end if;
  if p_request_id is null or p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or (select count(*) from jsonb_object_keys(p_payload)) <> 6
    or not (p_payload ?& array['type', 'name', 'email', 'phone', 'question', 'formId'])
    or jsonb_typeof(p_payload->'type') <> 'string' or p_payload->>'type' not in ('contact', 'attorney')
    or jsonb_typeof(p_payload->'name') <> 'string' or length(btrim(p_payload->>'name')) not between 1 and 150
    or p_payload->>'name' ~ '[[:cntrl:]]'
    or jsonb_typeof(p_payload->'question') <> 'string' or length(btrim(p_payload->>'question')) not between 1 and 3000
    or regexp_replace(p_payload->>'question', E'[\n\r\t]', '', 'g') ~ '[[:cntrl:]]'
    or jsonb_typeof(p_payload->'email') not in ('string', 'null')
    or jsonb_typeof(p_payload->'phone') not in ('string', 'null')
    or jsonb_typeof(p_payload->'formId') not in ('string', 'null')
    or (coalesce(p_payload->>'email', '') = '' and coalesce(p_payload->>'phone', '') = '')
    or (p_payload->>'email' is not null and (length(p_payload->>'email') > 254 or p_payload->>'email' !~ '^[^[:space:]@[:cntrl:]]+@[^[:space:]@[:cntrl:]]+\.[^[:space:]@[:cntrl:]]+$'))
    or (p_payload->>'phone' is not null and (length(p_payload->>'phone') > 40 or p_payload->>'phone' !~ '^\+?[0-9 ().-]+$' or length(regexp_replace(p_payload->>'phone', '[^0-9]', '', 'g')) not between 7 and 15))
    or (p_payload->>'formId' is not null and p_payload->>'formId' not in ('AR-11','G-1145','G-639','I-90','I-129F','I-130','I-130A','I-131','I-131A','I-134','I-485','I-751','I-765','I-765WS','I-821','I-821D','I-864','I-864A','N-400','N-565','N-600'))
    or (p_payload->>'type' = 'attorney' and p_payload->>'formId' is null) then
    raise sqlstate 'PT422' using message = 'invalid_request';
  end if;

  -- Serialize submissions by owner; parallel retries cannot double-write or
  -- bypass the five-per-rolling-hour quota. Replays do not consume quota.
  perform pg_advisory_xact_lock(hashtextextended('fillout-intake:' || p_user_id::text, 0));
  select * into saved from public.requests where user_id = p_user_id and request_id = p_request_id;
  if found then
    if saved.payload <> p_payload then
      raise sqlstate 'PT409' using message = 'idempotency_conflict';
    end if;
    return jsonb_build_object('id', saved.id, 'createdAt', saved.created_at);
  end if;

  received_at := clock_timestamp();
  if (select count(*) from public.requests where user_id = p_user_id and created_at > received_at - interval '1 hour') >= 5 then
    raise sqlstate 'PT429' using message = 'request_rate_limited';
  end if;
  insert into public.requests(user_id, request_id, payload, created_at)
    values (p_user_id, p_request_id, p_payload, received_at) returning * into saved;
  insert into private.notification_outbox(request_id, created_at) values (saved.id, received_at);
  return jsonb_build_object('id', saved.id, 'createdAt', saved.created_at);
end;
$$;
revoke all on function private.submit_request(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function private.submit_request(uuid, uuid, jsonb) to service_role;

create function public.fillout_submit_request(p_user_id uuid, p_request_id uuid, p_payload jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.submit_request(p_user_id, p_request_id, p_payload); $$;
revoke all on function public.fillout_submit_request(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.fillout_submit_request(uuid, uuid, jsonb) to service_role;

create function private.consume_ai_quota(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  received_at timestamptz;
begin
  if not exists (select 1 from auth.users where id = p_user_id and is_anonymous = false and email is not null and email <> '' and email_confirmed_at is not null) then
    raise sqlstate 'PT403' using message = 'verified_email_required';
  end if;
  -- The shared lock makes both user and global cost limits atomic.
  perform pg_advisory_xact_lock(hashtextextended('fillout-ai-global-quota', 0));
  received_at := clock_timestamp();
  delete from private.ai_usage_events where created_at <= received_at - interval '24 hours';
  if (select count(*) from private.ai_usage_events where user_id = p_user_id) >= 20
    or (select count(*) from private.ai_usage_events) >= 200 then
    raise sqlstate 'PT429' using message = 'ai_rate_limited';
  end if;
  insert into private.ai_usage_events(user_id, created_at) values (p_user_id, received_at);
  -- Failed upstream calls consume a slot too: a retry cannot bypass cost limits.
  return jsonb_build_object('allowed', true);
end;
$$;
revoke all on function private.consume_ai_quota(uuid) from public, anon, authenticated;
grant execute on function private.consume_ai_quota(uuid) to service_role;

create function public.fillout_consume_ai_quota(p_user_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.consume_ai_quota(p_user_id); $$;
revoke all on function public.fillout_consume_ai_quota(uuid) from public, anon, authenticated;
grant execute on function public.fillout_consume_ai_quota(uuid) to service_role;
