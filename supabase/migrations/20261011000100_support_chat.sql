-- One persistent human-support conversation per verified account.
-- Customers cannot insert team replies or mutate delivered messages.
create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_message_id uuid,
  sender text not null check (sender in ('customer', 'team')),
  body text not null check (length(btrim(body)) between 1 and 2000 and body ~ '[^[:space:]]' and octet_length(body) <= 6000
    and regexp_replace(body, E'[\n\r\t]', '', 'g') !~ '[[:cntrl:]]'),
  created_at timestamptz not null default clock_timestamp(),
  check (sender <> 'customer' or client_message_id is not null),
  unique (user_id, client_message_id)
);
create index support_messages_user_order_idx on public.support_messages (user_id, created_at desc, id desc);
alter table public.support_messages enable row level security;
revoke all on public.support_messages from public, anon, authenticated;
grant select on public.support_messages to authenticated;
grant all on public.support_messages to service_role;
create policy support_messages_read_own on public.support_messages for select to authenticated
  using ((select auth.uid()) = user_id);
comment on table public.support_messages is 'Human support conversation. Team replies are inserted by an authorized operator through the service backend or Supabase dashboard. No AI replies or external notification worker.';

create function private.support_message_json(message public.support_messages)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', message.id, 'clientMessageId', message.client_message_id,
    'sender', message.sender, 'body', message.body, 'createdAt', message.created_at);
$$;
revoke all on function private.support_message_json(public.support_messages) from public, anon, authenticated;
grant execute on function private.support_message_json(public.support_messages) to service_role;

create function private.support_send(p_user_id uuid, p_client_message_id uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.support_messages%rowtype;
begin
  if not exists (select 1 from auth.users where id = p_user_id and is_anonymous = false
    and email is not null and email <> '' and email_confirmed_at is not null) then
    raise sqlstate 'PT403' using message = 'verified_email_required';
  end if;
  if p_client_message_id is null or p_body is null or length(btrim(p_body)) not between 1 and 2000
    or p_body !~ '[^[:space:]]'
    or regexp_replace(p_body, E'[\n\r\t]', '', 'g') ~ '[[:cntrl:]]' then
    raise sqlstate 'PT422' using message = 'invalid_message';
  end if;
  p_body := btrim(p_body);
  perform pg_advisory_xact_lock(hashtextextended('fillout-support:' || p_user_id::text, 0));
  select * into saved from public.support_messages where user_id = p_user_id and client_message_id = p_client_message_id;
  if found then
    if saved.body <> p_body or saved.sender <> 'customer' then
      raise sqlstate 'PT409' using message = 'idempotency_conflict';
    end if;
    return private.support_message_json(saved);
  end if;
  if (select count(*) from public.support_messages where user_id = p_user_id and sender = 'customer'
    and created_at > clock_timestamp() - interval '1 hour') >= 30 then
    raise sqlstate 'PT429' using message = 'message_rate_limited';
  end if;
  insert into public.support_messages(user_id, client_message_id, sender, body)
    values(p_user_id, p_client_message_id, 'customer', p_body) returning * into saved;
  return private.support_message_json(saved);
end;
$$;
revoke all on function private.support_send(uuid, uuid, text) from public, anon, authenticated;
grant execute on function private.support_send(uuid, uuid, text) to service_role;

create function private.support_list(p_user_id uuid, p_before_created_at timestamptz default null, p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare messages jsonb; oldest public.support_messages%rowtype; more boolean;
begin
  if not exists (select 1 from auth.users where id = p_user_id and is_anonymous = false
    and email is not null and email <> '' and email_confirmed_at is not null) then
    raise sqlstate 'PT403' using message = 'verified_email_required';
  end if;
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise sqlstate 'PT422' using message = 'invalid_cursor';
  end if;
  select coalesce(jsonb_agg(private.support_message_json(page::public.support_messages) order by page.created_at, page.id), '[]'::jsonb)
    into messages from (select * from public.support_messages
      where user_id = p_user_id and (p_before_created_at is null or (created_at, id) < (p_before_created_at, p_before_id))
      order by created_at desc, id desc limit 10) page;
  if jsonb_array_length(messages) = 0 then
    return jsonb_build_object('messages', messages, 'hasMore', false, 'nextBefore', null);
  end if;
  select * into oldest from public.support_messages where id = (messages->0->>'id')::uuid and user_id = p_user_id;
  select exists(select 1 from public.support_messages where user_id = p_user_id and (created_at, id) < (oldest.created_at, oldest.id)) into more;
  return jsonb_build_object('messages', messages, 'hasMore', more, 'nextBefore', case when more
    then jsonb_build_object('createdAt', oldest.created_at, 'id', oldest.id) else null end);
end;
$$;
revoke all on function private.support_list(uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function private.support_list(uuid, timestamptz, uuid) to service_role;

create function public.fillout_support_send(p_user_id uuid, p_client_message_id uuid, p_body text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.support_send(p_user_id, p_client_message_id, p_body);
$$;
revoke all on function public.fillout_support_send(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fillout_support_send(uuid, uuid, text) to service_role;

create function public.fillout_support_list(p_user_id uuid, p_before_created_at timestamptz default null, p_before_id uuid default null)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.support_list(p_user_id, p_before_created_at, p_before_id);
$$;
revoke all on function public.fillout_support_list(uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.fillout_support_list(uuid, timestamptz, uuid) to service_role;
