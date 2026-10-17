-- Operator membership is provisioned by the service administrator, never by a client.
create table private.support_operators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp()
);
revoke all on private.support_operators from public, anon, authenticated;
grant all on private.support_operators to service_role;

-- Separate audit relation keeps the existing customer message representation stable.
create table private.support_replies (
  message_id uuid primary key references public.support_messages(id) on delete cascade,
  operator_id uuid references auth.users(id) on delete set null
);
revoke all on private.support_replies from public, anon, authenticated;
grant all on private.support_replies to service_role;

create function private.support_operator_allowed(p_operator_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.support_operators o join auth.users u on u.id = o.user_id
    where o.user_id = p_operator_id and u.is_anonymous = false
      and u.email is not null and u.email <> '' and u.email_confirmed_at is not null);
$$;
revoke all on function private.support_operator_allowed(uuid) from public, anon, authenticated;
grant execute on function private.support_operator_allowed(uuid) to service_role;

create function public.fillout_support_operator_access(p_operator_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('allowed', private.support_operator_allowed(p_operator_id));
$$;
revoke all on function public.fillout_support_operator_access(uuid) from public, anon, authenticated;
grant execute on function public.fillout_support_operator_access(uuid) to service_role;

create function public.fillout_support_inbox(p_operator_id uuid, p_before_created_at timestamptz default null, p_before_user_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; has_more boolean; last_row jsonb;
begin
  if not private.support_operator_allowed(p_operator_id) then
    raise sqlstate 'PT403' using message = 'operator_access_required';
  end if;
  if (p_before_created_at is null) <> (p_before_user_id is null) then
    raise sqlstate 'PT422' using message = 'invalid_cursor';
  end if;
  with latest as (
    select distinct on (m.user_id) m.* from public.support_messages m order by m.user_id, m.created_at desc, m.id desc
  ), page as (
    select m.*, left(u.email,320) as email from latest m join auth.users u on m.user_id = u.id
    where p_before_created_at is null or (m.created_at, m.user_id) < (p_before_created_at, p_before_user_id)
    order by m.created_at desc, m.user_id desc limit 21
  ) select coalesce(jsonb_agg(jsonb_build_object('userId',user_id, 'email',email,
    'preview',left(body,240),'lastCreatedAt',created_at,'needsReply',sender = 'customer') order by created_at desc,user_id desc),'[]'::jsonb)
    into result from page;
  has_more := jsonb_array_length(result) > 20;
  if has_more then result := result - 20; end if;
  last_row := result -> (jsonb_array_length(result) - 1);
  return jsonb_build_object('conversations', result, 'hasMore', has_more, 'nextBefore', case when has_more then
    jsonb_build_object('createdAt',last_row->>'lastCreatedAt','userId',last_row->>'userId') else null end);
end;
$$;
revoke all on function public.fillout_support_inbox(uuid,timestamptz,uuid) from public, anon, authenticated;
grant execute on function public.fillout_support_inbox(uuid,timestamptz,uuid) to service_role;

create function public.fillout_support_operator_list(p_operator_id uuid, p_user_id uuid, p_before_created_at timestamptz default null, p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not private.support_operator_allowed(p_operator_id) then
    raise sqlstate 'PT403' using message = 'operator_access_required';
  end if;
  return private.support_list(p_user_id,p_before_created_at,p_before_id);
end;
$$;
revoke all on function public.fillout_support_operator_list(uuid,uuid,timestamptz,uuid) from public, anon, authenticated;
grant execute on function public.fillout_support_operator_list(uuid,uuid,timestamptz,uuid) to service_role;

create function public.fillout_support_reply(p_operator_id uuid, p_user_id uuid, p_client_message_id uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.support_messages%rowtype;
begin
  if not private.support_operator_allowed(p_operator_id) then
    raise sqlstate 'PT403' using message = 'operator_access_required';
  end if;
  if not exists(select 1 from auth.users where id = p_user_id and is_anonymous = false
    and email is not null and email <> '' and email_confirmed_at is not null) then
    raise sqlstate 'PT403' using message = 'verified_email_required';
  end if;
  if p_client_message_id is null or p_body is null or length(btrim(p_body)) not between 1 and 2000
    or octet_length(p_body) > 6000 or p_body !~ '[^[:space:]]'
    or regexp_replace(p_body, E'[\n\r\t]', '', 'g') ~ '[[:cntrl:]]' then
    raise sqlstate 'PT422' using message = 'invalid_message';
  end if;
  p_body := btrim(p_body);
  perform pg_advisory_xact_lock(hashtextextended('fillout-support:' || p_user_id::text, 0));
  select * into saved from public.support_messages where user_id = p_user_id and client_message_id = p_client_message_id;
  if found then
    if saved.body <> p_body or saved.sender <> 'team' or not exists(select 1 from private.support_replies
      where message_id = saved.id and operator_id = p_operator_id) then
      raise sqlstate 'PT409' using message = 'idempotency_conflict';
    end if;
    return private.support_message_json(saved);
  end if;
  insert into public.support_messages(user_id,client_message_id,sender,body)
    values(p_user_id,p_client_message_id,'team',p_body) returning * into saved;
  insert into private.support_replies(message_id,operator_id) values(saved.id,p_operator_id);
  return private.support_message_json(saved);
end;
$$;
revoke all on function public.fillout_support_reply(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.fillout_support_reply(uuid,uuid,uuid,text) to service_role;
