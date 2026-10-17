-- Metadata only: no answers, receipts, emails, or document IDs enter this ledger.
-- Keep anonymous spent transaction tombstones after account deletion to prevent reuse.
create table private.payment_sync (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version bigint not null default 0,
  completed_version bigint not null default 0,
  window_started_at timestamptz not null default clock_timestamp(),
  attempts integer not null default 0,
  synced_at timestamptz
);
create table private.payment_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  project_id text not null,
  environment text not null check (environment in ('production','sandbox')),
  purchase_id text not null,
  store_transaction_id text not null,
  product_id text not null,
  form_id text not null,
  store text not null check (store in ('app_store','play_store')),
  purchased_at timestamptz not null,
  active boolean not null default false,
  unique(project_id,purchase_id),
  unique(project_id,environment,store,store_transaction_id)
);
create table private.payment_cases (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete set null,
  form_id text not null,
  parent_case_id uuid references private.payment_cases(id),
  package_case_id uuid references private.payment_cases(id),
  purchase_id uuid unique references private.payment_purchases(id),
  created_at timestamptz not null default clock_timestamp()
);
create unique index payment_one_included_component on private.payment_cases(package_case_id,form_id) where form_id in ('I-130','I-130A');
create table private.payment_purchase_intents (
  user_id uuid references auth.users(id) on delete cascade,
  form_id text not null,
  case_id uuid not null references private.payment_cases(id),
  created_at timestamptz not null default clock_timestamp(),
  primary key(user_id,form_id)
);
create table private.payment_webhook_events (
  event_id text primary key,
  payload_hash text not null,
  user_ids uuid[] not null,
  created_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz
);
alter table private.payment_sync enable row level security;
alter table private.payment_purchases enable row level security;
alter table private.payment_cases enable row level security;
alter table private.payment_purchase_intents enable row level security;
alter table private.payment_webhook_events enable row level security;
revoke all on private.payment_sync,private.payment_purchases,private.payment_cases,private.payment_purchase_intents,private.payment_webhook_events from public,anon,authenticated;
grant all on private.payment_sync,private.payment_purchases,private.payment_cases,private.payment_purchase_intents,private.payment_webhook_events to service_role;

create function private.payment_case_allowed(p_user_id uuid,p_case_id uuid,p_form_id text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare c private.payment_cases%rowtype; parent private.payment_cases%rowtype; own_purchase boolean;
begin
  select * into c from private.payment_cases where id = p_case_id and user_id = p_user_id and form_id = p_form_id;
  if not found or not exists(select 1 from private.payment_sync where user_id = p_user_id and completed_version = version
    and synced_at > clock_timestamp() - interval '5 minutes') then return false; end if;
  own_purchase := exists(select 1 from private.payment_purchases where id = c.purchase_id and user_id = p_user_id and active and form_id = c.form_id);
  if c.parent_case_id is null then return own_purchase and c.form_id <> 'I-130A'; end if;
  select * into parent from private.payment_cases where id = c.parent_case_id and user_id = p_user_id;
  if not found then return false; end if;
  -- Package rights only; each component still runs its own preliminary check in the app.
  if (c.form_id = 'I-130A' and parent.form_id in ('I-130','I-485')) or (c.form_id = 'I-130' and parent.form_id = 'I-485') then
    return private.payment_case_allowed(p_user_id,parent.id,parent.form_id);
  elsif c.form_id = 'I-864A' and parent.form_id = 'I-864' then
    return own_purchase and private.payment_case_allowed(p_user_id,parent.id,parent.form_id);
  end if;
  return false;
end;
$$;

create function public.fillout_payment_sync_begin(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v bigint; saved private.payment_sync%rowtype;
begin
  if not private.form_review_verified(p_user_id) then raise sqlstate 'PT403' using message = 'verified_email_required'; end if;
  insert into private.payment_sync(user_id) values(p_user_id) on conflict do nothing;
  select * into saved from private.payment_sync where user_id = p_user_id for update;
  if saved.window_started_at > clock_timestamp()-interval '1 hour' and saved.attempts >= 120 then raise sqlstate 'PT429' using message = 'payment_verification_limit'; end if;
  update private.payment_sync set version = version + 1,
    attempts = case when saved.window_started_at > clock_timestamp()-interval '1 hour' then attempts+1 else 1 end,
    window_started_at = case when saved.window_started_at > clock_timestamp()-interval '1 hour' then window_started_at else clock_timestamp() end
    where user_id = p_user_id returning version into v;
  return jsonb_build_object('version',v);
end;
$$;

create function public.fillout_payment_sync_finish(p_user_id uuid,p_version bigint,p_project_id text,p_environment text,p_purchases jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v bigint; item jsonb; saved private.payment_purchases%rowtype; intent record; chosen uuid;
begin
  select version into v from private.payment_sync where user_id = p_user_id for update;
  if v is distinct from p_version then raise sqlstate 'PT409' using message = 'newer_reconciliation_started'; end if;
  if not private.form_review_verified(p_user_id) then raise sqlstate 'PT403' using message = 'verified_email_required'; end if;
  if p_project_id is null or length(p_project_id) not between 1 and 255 or p_environment not in ('production','sandbox')
    or p_purchases is null or jsonb_typeof(p_purchases) <> 'array' or jsonb_array_length(p_purchases) > 1000 then raise sqlstate 'PT422' using message = 'invalid_snapshot'; end if;
  update private.payment_purchases set active = false where user_id = p_user_id;
  for item in select * from jsonb_array_elements(p_purchases) loop
    if item->>'formId' not in ('I-90','I-129F','I-130','I-131','I-131A','I-134','I-485','I-751','I-765','I-864','I-864A','N-400','N-565','N-600')
      or item->>'store' not in ('app_store','play_store') or jsonb_typeof(item->'active') <> 'boolean'
      or item->>'purchaseId' is null or item->>'storeTransactionId' is null or item->>'productId' is null then raise sqlstate 'PT422' using message = 'invalid_purchase'; end if;
    insert into private.payment_purchases(user_id,project_id,environment,purchase_id,store_transaction_id,product_id,form_id,store,purchased_at)
      values(p_user_id,p_project_id,p_environment,item->>'purchaseId',item->>'storeTransactionId',item->>'productId',item->>'formId',item->>'store',(item->>'purchasedAt')::timestamptz)
      on conflict do nothing;
    select * into saved from private.payment_purchases where project_id = p_project_id and purchase_id = item->>'purchaseId' for update;
    -- Immutable owner and transaction identity. Never transfer or remint spent credit.
    if saved.user_id = p_user_id and saved.environment = p_environment and saved.store_transaction_id = item->>'storeTransactionId'
      and saved.product_id = item->>'productId' and saved.form_id = item->>'formId' and saved.store = item->>'store'
      and saved.purchased_at = (item->>'purchasedAt')::timestamptz then
      update private.payment_purchases set active = (item->>'active')::boolean where id = saved.id;
    end if;
  end loop;
  update private.payment_sync set completed_version = p_version,synced_at = clock_timestamp() where user_id = p_user_id;
  -- A purchase recovered after an interrupted callback belongs to the reserved case.
  for intent in select * from private.payment_purchase_intents where user_id = p_user_id loop
    select p.id into chosen from private.payment_purchases p where p.user_id = p_user_id and p.form_id = intent.form_id and p.active
      and not exists(select 1 from private.payment_cases c where c.purchase_id = p.id) order by p.purchased_at,p.id limit 1 for update;
    if chosen is not null then
      update private.payment_cases set purchase_id = chosen where id = intent.case_id and purchase_id is null;
      delete from private.payment_purchase_intents where user_id = p_user_id and form_id = intent.form_id;
    end if;
  end loop;
  return jsonb_build_object('synced',true);
end;
$$;

create function public.fillout_payment_case(p_user_id uuid,p_case_id uuid,p_form_id text,p_parent_case_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved private.payment_cases%rowtype; parent private.payment_cases%rowtype; chosen uuid; reserved uuid; recovered uuid; package_id uuid; allowed boolean; case_exists boolean;
begin
  perform 1 from private.payment_sync where user_id = p_user_id for update;
  if not private.form_review_verified(p_user_id) then raise sqlstate 'PT403' using message = 'verified_email_required'; end if;
  if p_case_id is null or p_form_id is null or p_form_id not in ('I-90','I-129F','I-130','I-130A','I-131','I-131A','I-134','I-485','I-751','I-765','I-864','I-864A','N-400','N-565','N-600')
    or p_action not in ('status','reconcile','prepare','cancel') then raise sqlstate 'PT422' using message = 'invalid_case'; end if;
  if not exists(select 1 from private.payment_sync where user_id = p_user_id and completed_version = version and synced_at > clock_timestamp() - interval '5 minutes') then raise sqlstate 'PT402' using message = 'verification_required'; end if;
  select * into saved from private.payment_cases where id = p_case_id;
  case_exists := found;
  if case_exists and (saved.user_id is distinct from p_user_id or saved.form_id <> p_form_id) then raise sqlstate 'PT409' using message = 'case_conflict'; end if;
  select case_id into reserved from private.payment_purchase_intents where user_id = p_user_id and form_id = p_form_id;
  if saved.parent_case_id is not null and p_parent_case_id is null then p_parent_case_id := saved.parent_case_id; end if;
  -- Recover package scope even when a reinstall lost the local parent draft.
  if p_parent_case_id is null and p_form_id in ('I-130','I-130A','I-864A') and saved.purchase_id is null and reserved is null then
    select c.id into p_parent_case_id from private.payment_cases c where c.user_id = p_user_id and c.id <> p_case_id
      and ((p_form_id = 'I-130' and c.form_id = 'I-485') or (p_form_id = 'I-130A' and c.form_id in ('I-130','I-485')) or (p_form_id = 'I-864A' and c.form_id = 'I-864'))
      and private.payment_case_allowed(p_user_id,c.id,c.form_id) order by (c.form_id = 'I-485') desc,c.created_at,c.id limit 1;
  end if;
  if p_form_id in ('I-130A','I-864A') and p_parent_case_id is null then return jsonb_build_object('allowed',false,'purchasePrepared',false,'unavailable',true); end if;
  if p_form_id in ('I-130A','I-864A') or (p_form_id = 'I-130' and p_parent_case_id is not null) then
    select * into parent from private.payment_cases where id = p_parent_case_id and user_id = p_user_id;
    if not found or not ((p_form_id = 'I-130A' and parent.form_id in ('I-130','I-485'))
      or (p_form_id = 'I-130' and parent.form_id = 'I-485') or (p_form_id = 'I-864A' and parent.form_id = 'I-864'))
      or not private.payment_case_allowed(p_user_id,parent.id,parent.form_id) then raise sqlstate 'PT402' using message = 'parent_purchase_required'; end if;
  elsif p_parent_case_id is not null then raise sqlstate 'PT422' using message = 'invalid_parent'; end if;
  if p_form_id in ('I-130','I-130A') and p_parent_case_id is not null then package_id := coalesce(parent.package_case_id,parent.id); end if;
  if case_exists and saved.parent_case_id is distinct from p_parent_case_id then
    if saved.parent_case_id is not null or saved.purchase_id is not null or reserved is not null then raise sqlstate 'PT409' using message = 'case_conflict'; end if;
  end if;
  if package_id is not null then
    select c.id into recovered from private.payment_cases c where c.user_id = p_user_id and c.id <> p_case_id and c.form_id = p_form_id
      and c.package_case_id = package_id and private.payment_case_allowed(p_user_id,c.id,c.form_id) limit 1;
    if recovered is not null then return jsonb_build_object('allowed',false,'purchasePrepared',false,'recoverCaseId',recovered); end if;
  end if;
  if not case_exists then
    if (select count(*) from private.payment_cases where user_id = p_user_id and created_at > clock_timestamp()-interval '1 hour') >= 30 then raise sqlstate 'PT429' using message = 'case_limit'; end if;
    begin
      insert into private.payment_cases(id,user_id,form_id,parent_case_id,package_case_id) values(p_case_id,p_user_id,p_form_id,p_parent_case_id,package_id) returning * into saved;
    exception when unique_violation then raise sqlstate 'PT409' using message = 'component_already_bound'; end;
  elsif saved.parent_case_id is distinct from p_parent_case_id then
    update private.payment_cases set parent_case_id = p_parent_case_id,package_case_id = package_id where id = p_case_id returning * into saved;
  end if;
  select case_id into reserved from private.payment_purchase_intents where user_id = p_user_id and form_id = p_form_id;
  if p_action in ('reconcile','prepare') and saved.purchase_id is null and (reserved is null or reserved = p_case_id) and not (p_form_id = 'I-130A' or (p_form_id = 'I-130' and p_parent_case_id is not null)) then
    select p.id into chosen from private.payment_purchases p where p.user_id = p_user_id and p.form_id = p_form_id and p.active
      and not exists(select 1 from private.payment_cases c where c.purchase_id = p.id) order by p.purchased_at,p.id limit 1 for update;
    if chosen is not null then update private.payment_cases set purchase_id = chosen where id = p_case_id; end if;
  end if;
  allowed := private.payment_case_allowed(p_user_id,p_case_id,p_form_id);
  if not allowed and saved.purchase_id is null and p_action <> 'cancel' then
    select c.id into recovered from private.payment_cases c where c.user_id = p_user_id and c.id <> p_case_id and c.form_id = p_form_id
      and c.parent_case_id is not distinct from p_parent_case_id and private.payment_case_allowed(p_user_id,c.id,c.form_id)
      order by c.created_at,c.id limit 1;
    if recovered is not null then return jsonb_build_object('allowed',false,'purchasePrepared',false,'recoverCaseId',recovered); end if;
  end if;
  if p_action = 'prepare' and not allowed then
    -- Refunded consumed cases need support; purchasing again must use a new case.
    if saved.purchase_id is not null then return jsonb_build_object('allowed',false,'purchasePrepared',false,'unavailable',true); end if;
    if reserved is not null then raise sqlstate 'PT409' using message = 'purchase_already_pending'; end if;
    insert into private.payment_purchase_intents(user_id,form_id,case_id) values(p_user_id,p_form_id,p_case_id) on conflict do nothing;
  end if;
  if allowed or p_action = 'cancel' then delete from private.payment_purchase_intents where user_id = p_user_id and form_id = p_form_id and case_id = p_case_id; end if;
  return jsonb_build_object('allowed',allowed,'purchasePrepared',p_action = 'prepare' and not allowed,
    'unavailable',not allowed and saved.purchase_id is not null,
    'included',p_form_id in ('I-130','I-130A') and p_parent_case_id is not null,
    'purchaseState',case when not allowed and (reserved is not null or p_action = 'prepare') and p_action <> 'cancel' then 'pending' else null end);
end;
$$;

create function public.fillout_payment_case_access(p_user_id uuid,p_case_id uuid,p_form_id text)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('allowed',private.form_review_verified(p_user_id) and private.payment_case_allowed(p_user_id,p_case_id,p_form_id));
$$;

create function public.fillout_payment_webhook(p_event_id text,p_payload_hash text,p_user_ids uuid[],p_complete boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved private.payment_webhook_events%rowtype;
begin
  if p_event_id is null or length(p_event_id) not between 1 and 255 or p_payload_hash !~ '^[0-9a-f]{64}$' or cardinality(p_user_ids) > 20 then raise sqlstate 'PT422' using message = 'invalid_event'; end if;
  insert into private.payment_webhook_events(event_id,payload_hash,user_ids) values(p_event_id,p_payload_hash,p_user_ids) on conflict do nothing;
  select * into saved from private.payment_webhook_events where event_id = p_event_id for update;
  if saved.payload_hash <> p_payload_hash or saved.user_ids <> p_user_ids then raise sqlstate 'PT409' using message = 'event_conflict'; end if;
  if p_complete then update private.payment_webhook_events set processed_at = clock_timestamp() where event_id = p_event_id; end if;
  return jsonb_build_object('processed',p_complete or saved.processed_at is not null,'userIds',coalesce((select jsonb_agg(id order by id) from auth.users where id = any(saved.user_ids) and private.form_review_verified(id)),'[]'::jsonb));
end;
$$;

-- Keep the previous validated implementation private; every new public submission
-- now binds its immutable review request to an authorized case in the same transaction.
alter table private.form_review_submissions add column payment_case_id uuid references private.payment_cases(id);
alter function public.fillout_form_review_submit(uuid,uuid,text,text,jsonb) set schema private;
alter function private.fillout_form_review_submit(uuid,uuid,text,text,jsonb) rename to form_review_submit_content;
revoke all on function private.form_review_submit_content(uuid,uuid,text,text,jsonb) from service_role;
create function public.fillout_form_review_submit(p_user_id uuid,p_request_id uuid,p_form_id text,p_pdf_base64 text,p_answers jsonb,p_case_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved private.form_review_submissions%rowtype; result jsonb;
begin
  perform 1 from private.payment_sync where user_id = p_user_id for update;
  if p_form_id not in ('AR-11','G-1145') and not private.payment_case_allowed(p_user_id,p_case_id,p_form_id) then raise sqlstate 'PT402' using message = 'payment_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fillout-form-review-quota:' || p_user_id::text,0));
  select * into saved from private.form_review_submissions where user_id = p_user_id and request_id = p_request_id;
  if found and saved.payment_case_id is distinct from p_case_id then raise sqlstate 'PT409' using message = 'case_binding_conflict'; end if;
  result := private.form_review_submit_content(p_user_id,p_request_id,p_form_id,p_pdf_base64,p_answers);
  update private.form_review_submissions set payment_case_id = p_case_id where user_id = p_user_id and request_id = p_request_id;
  return result;
end;
$$;

revoke all on function private.payment_case_allowed(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.fillout_payment_sync_begin(uuid),public.fillout_payment_sync_finish(uuid,bigint,text,text,jsonb),public.fillout_payment_case(uuid,uuid,text,uuid,text),public.fillout_payment_case_access(uuid,uuid,text),public.fillout_payment_webhook(text,text,uuid[],boolean),public.fillout_form_review_submit(uuid,uuid,text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function private.payment_case_allowed(uuid,uuid,text),public.fillout_payment_sync_begin(uuid),public.fillout_payment_sync_finish(uuid,bigint,text,text,jsonb),public.fillout_payment_case(uuid,uuid,text,uuid,text),public.fillout_payment_case_access(uuid,uuid,text),public.fillout_payment_webhook(text,text,uuid[],boolean),public.fillout_form_review_submit(uuid,uuid,text,text,jsonb,uuid) to service_role;
