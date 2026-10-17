-- A one-time deletion capability lets the initiating device recover when the
-- Auth deletion succeeds but its HTTP response is lost. No profile/contact data
-- remains in this receipt after deletion; the random secret is never stored.
create table private.account_deletion_receipts (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp()
);
alter table private.account_deletion_receipts enable row level security;
revoke all on private.account_deletion_receipts from public, anon, authenticated;
grant all on private.account_deletion_receipts to service_role;

create function public.fillout_account_deletion_status(p_token_hash text)
returns jsonb language sql security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('state', case when user_id is null then 'deleted' else 'pending' end,
    'userId', user_id) from private.account_deletion_receipts where token_hash = p_token_hash),
    jsonb_build_object('state', 'unknown'));
$$;
revoke all on function public.fillout_account_deletion_status(text) from public, anon, authenticated;
grant execute on function public.fillout_account_deletion_status(text) to service_role;

create function public.fillout_account_deletion_begin(p_user_id uuid, p_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise sqlstate 'PT422' using message = 'invalid_deletion_token';
  end if;
  -- The Edge Function verified this identity via Auth /user and checked a recent
  -- sign-in. This service-only RPC never trusts a browser-provided user id.
  if not exists (select 1 from auth.users where id = p_user_id and is_anonymous = false
    and email is not null and email_confirmed_at is not null) then
    raise sqlstate 'PT403' using message = 'verified_email_required';
  end if;
  insert into private.account_deletion_receipts(token_hash, user_id) values(p_token_hash, p_user_id)
    on conflict (token_hash) do nothing;
  if exists (select 1 from private.account_deletion_receipts where token_hash = p_token_hash and user_id <> p_user_id) then
    raise sqlstate 'PT409' using message = 'deletion_token_conflict';
  end if;
  return public.fillout_account_deletion_status(p_token_hash);
end;
$$;
revoke all on function public.fillout_account_deletion_begin(uuid, text) from public, anon, authenticated;
grant execute on function public.fillout_account_deletion_begin(uuid, text) to service_role;

-- All user content is already attached to auth.users with ON DELETE CASCADE:
-- requests -> notification_outbox, support_messages, and ai_usage_events.
-- Admin hard deletion and these cascades are one Postgres transaction. Any
-- constraint/storage failure rolls back the deletion and leaves the receipt pending.
