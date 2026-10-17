-- Keep verified store environments separate through purchases, cases and review.
-- This migration grants no credit. Legacy paid submissions without provable
-- payment provenance are retained in quarantine and never treated as production.
alter table private.payment_sync add column project_id text;
alter table private.payment_sync add column environment text check (environment in ('production','sandbox'));
alter table private.payment_sync add column accept_app_store_sandbox boolean not null default false;
alter table private.payment_purchase_intents add column known_purchase_ids uuid[] not null default '{}';
-- Pending checkouts predate environment-aware reservations; never adopt old
-- sandbox balances while recovering one after deployment.
update private.payment_purchase_intents i set known_purchase_ids = array(
  select p.id from private.payment_purchases p where p.user_id = i.user_id and p.form_id = i.form_id);

create function private.payment_case_environment(p_user_id uuid,p_case_id uuid,p_form_id text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare c private.payment_cases%rowtype; parent private.payment_cases%rowtype; own_environment text; parent_environment text;
begin
  select * into c from private.payment_cases where id = p_case_id and user_id = p_user_id and form_id = p_form_id;
  if not found then return null; end if;
  select environment into own_environment from private.payment_purchases where id = c.purchase_id and user_id = p_user_id and form_id = c.form_id;
  if c.parent_case_id is null then return case when c.form_id <> 'I-130A' then own_environment else null end; end if;
  select * into parent from private.payment_cases where id = c.parent_case_id and user_id = p_user_id;
  if not found then return null; end if;
  if not ((c.form_id = 'I-130A' and parent.form_id in ('I-130','I-485')) or (c.form_id = 'I-130' and parent.form_id = 'I-485')
    or (c.form_id = 'I-864A' and parent.form_id = 'I-864')) then return null; end if;
  parent_environment := private.payment_case_environment(p_user_id,parent.id,parent.form_id);
  if c.form_id = 'I-864A' and own_environment is distinct from parent_environment then return null; end if;
  return parent_environment;
end;
$$;


create or replace function private.payment_case_allowed(p_user_id uuid,p_case_id uuid,p_form_id text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare c private.payment_cases%rowtype; parent private.payment_cases%rowtype; own_purchase boolean;
begin
  select * into c from private.payment_cases where id = p_case_id and user_id = p_user_id and form_id = p_form_id;
  if not found or not exists(select 1 from private.payment_sync where user_id = p_user_id and completed_version = version
    and synced_at > clock_timestamp() - interval '5 minutes') then return false; end if;
  own_purchase := exists(select 1 from private.payment_purchases p join private.payment_sync s on s.user_id = p.user_id
    where p.id = c.purchase_id and p.user_id = p_user_id and p.active and p.form_id = c.form_id and p.project_id = s.project_id
      and (p.environment = s.environment or s.environment = 'production' and s.accept_app_store_sandbox and p.environment = 'sandbox' and p.store = 'app_store'));
  if c.parent_case_id is null then return own_purchase and c.form_id <> 'I-130A'; end if;
  select * into parent from private.payment_cases where id = c.parent_case_id and user_id = p_user_id;
  if not found then return false; end if;
  -- Package rights only; each component still runs its own preliminary check in the app.
  if (c.form_id = 'I-130A' and parent.form_id in ('I-130','I-485')) or (c.form_id = 'I-130' and parent.form_id = 'I-485') then
    return private.payment_case_allowed(p_user_id,parent.id,parent.form_id);
  elsif c.form_id = 'I-864A' and parent.form_id = 'I-864' then
    return own_purchase and private.payment_case_environment(p_user_id,c.id,c.form_id) is not null
      and private.payment_case_allowed(p_user_id,parent.id,parent.form_id);
  end if;
  return false;
end;
$$;

drop function public.fillout_payment_sync_finish(uuid,bigint,text,text,jsonb);
create function public.fillout_payment_sync_finish(p_user_id uuid,p_version bigint,p_project_id text,p_environment text,p_purchases jsonb,p_accept_app_store_sandbox boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v bigint; item jsonb; saved private.payment_purchases%rowtype; intent record; chosen uuid; item_environment text; parent_environment text; candidate_environments integer;
begin
  select version into v from private.payment_sync where user_id = p_user_id for update;
  if v is distinct from p_version then raise sqlstate 'PT409' using message = 'newer_reconciliation_started'; end if;
  if not private.form_review_verified(p_user_id) then raise sqlstate 'PT403' using message = 'verified_email_required'; end if;
  if p_project_id is null or length(p_project_id) not between 1 and 255 or p_environment not in ('production','sandbox')
    or p_accept_app_store_sandbox is null or (p_accept_app_store_sandbox and p_environment <> 'production')
    or p_purchases is null or jsonb_typeof(p_purchases) <> 'array' or jsonb_array_length(p_purchases) > 1000 then raise sqlstate 'PT422' using message = 'invalid_snapshot'; end if;
  update private.payment_purchases set active = false where user_id = p_user_id;
  for item in select * from jsonb_array_elements(p_purchases) loop
    item_environment := coalesce(item->>'environment',p_environment);
    if item_environment not in ('production','sandbox') or not (item_environment = p_environment
      or p_environment = 'production' and p_accept_app_store_sandbox and item_environment = 'sandbox' and item->>'store' = 'app_store') then
      raise sqlstate 'PT422' using message = 'invalid_purchase_environment'; end if;
    if item->>'formId' not in ('I-90','I-129F','I-130','I-131','I-131A','I-134','I-485','I-751','I-765','I-864','I-864A','N-400','N-565','N-600')
      or item->>'store' not in ('app_store','play_store') or jsonb_typeof(item->'active') <> 'boolean'
      or item->>'purchaseId' is null or item->>'storeTransactionId' is null or item->>'productId' is null then raise sqlstate 'PT422' using message = 'invalid_purchase'; end if;
    insert into private.payment_purchases(user_id,project_id,environment,purchase_id,store_transaction_id,product_id,form_id,store,purchased_at)
      values(p_user_id,p_project_id,item_environment,item->>'purchaseId',item->>'storeTransactionId',item->>'productId',item->>'formId',item->>'store',(item->>'purchasedAt')::timestamptz)
      on conflict do nothing;
    select * into saved from private.payment_purchases where project_id = p_project_id and purchase_id = item->>'purchaseId' for update;
    -- Immutable owner and transaction identity. Never transfer or remint spent credit.
    if saved.user_id = p_user_id and saved.environment = item_environment and saved.store_transaction_id = item->>'storeTransactionId'
      and saved.product_id = item->>'productId' and saved.form_id = item->>'formId' and saved.store = item->>'store'
      and saved.purchased_at = (item->>'purchasedAt')::timestamptz then
      update private.payment_purchases set active = (item->>'active')::boolean where id = saved.id;
    end if;
  end loop;
  update private.payment_sync set completed_version = p_version,synced_at = clock_timestamp(),project_id = p_project_id,environment = p_environment,accept_app_store_sandbox = p_accept_app_store_sandbox where user_id = p_user_id;
  -- A purchase recovered after an interrupted callback belongs to the reserved case.
  for intent in select * from private.payment_purchase_intents where user_id = p_user_id loop
    select private.payment_case_environment(p_user_id,parent.id,parent.form_id) into parent_environment
      from private.payment_cases c join private.payment_cases parent on parent.id = c.parent_case_id where c.id = intent.case_id;
    -- A restored old receipt is not a purchase made for this reservation. Allow
    -- five seconds only for store timestamp rounding/clock skew. If different
    -- environments arrive together, keep the reservation pending, never guess.
    select count(distinct p.environment)::integer into candidate_environments from private.payment_purchases p
      where p.user_id = p_user_id and p.form_id = intent.form_id and p.active and p.project_id = p_project_id
        and not (p.id = any(intent.known_purchase_ids)) and p.purchased_at >= intent.created_at - interval '5 seconds'
        and (parent_environment is null or p.environment = parent_environment)
        and not exists(select 1 from private.payment_cases c where c.purchase_id = p.id);
    if candidate_environments <> 1 then continue; end if;
    select p.id into chosen from private.payment_purchases p where p.user_id = p_user_id and p.form_id = intent.form_id and p.active
      and p.project_id = p_project_id and not (p.id = any(intent.known_purchase_ids))
      and p.purchased_at >= intent.created_at - interval '5 seconds'
      and (parent_environment is null or p.environment = parent_environment)
      and not exists(select 1 from private.payment_cases c where c.purchase_id = p.id) order by p.purchased_at,p.id limit 1 for update;
    if chosen is not null then
      update private.payment_cases set purchase_id = chosen where id = intent.case_id and purchase_id is null;
      delete from private.payment_purchase_intents where user_id = p_user_id and form_id = intent.form_id;
    end if;
  end loop;
  return jsonb_build_object('synced',true);
end;
$$;

create or replace function public.fillout_payment_case(p_user_id uuid,p_case_id uuid,p_form_id text,p_parent_case_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved private.payment_cases%rowtype; parent private.payment_cases%rowtype; chosen uuid; reserved uuid; recovered uuid; package_id uuid; allowed boolean; case_exists boolean; preferred_environment text;
begin
  select environment into preferred_environment from private.payment_sync where user_id = p_user_id for update;
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
      and private.payment_case_environment(p_user_id,c.id,c.form_id) = preferred_environment
      and private.payment_case_allowed(p_user_id,c.id,c.form_id) order by (c.form_id = 'I-485') desc,c.created_at,c.id limit 1;
  end if;
  if p_form_id in ('I-130A','I-864A') and p_parent_case_id is null then return jsonb_build_object('allowed',false,'purchasePrepared',false,'unavailable',true); end if;
  if p_form_id in ('I-130A','I-864A') or (p_form_id = 'I-130' and p_parent_case_id is not null) then
    select * into parent from private.payment_cases where id = p_parent_case_id and user_id = p_user_id;
    if not found or not ((p_form_id = 'I-130A' and parent.form_id in ('I-130','I-485'))
      or (p_form_id = 'I-130' and parent.form_id = 'I-485') or (p_form_id = 'I-864A' and parent.form_id = 'I-864'))
      or not private.payment_case_allowed(p_user_id,parent.id,parent.form_id) then raise sqlstate 'PT402' using message = 'parent_purchase_required'; end if;
  elsif p_parent_case_id is not null then raise sqlstate 'PT422' using message = 'invalid_parent'; end if;
  preferred_environment := coalesce(private.payment_case_environment(p_user_id,p_case_id,p_form_id),private.payment_case_environment(p_user_id,parent.id,parent.form_id),preferred_environment);
  if p_form_id in ('I-130','I-130A') and p_parent_case_id is not null then package_id := coalesce(parent.package_case_id,parent.id); end if;
  if case_exists and saved.parent_case_id is distinct from p_parent_case_id then
    if saved.parent_case_id is not null or saved.purchase_id is not null or reserved is not null then raise sqlstate 'PT409' using message = 'case_conflict'; end if;
  end if;
  if package_id is not null then
    select c.id into recovered from private.payment_cases c where c.user_id = p_user_id and c.id <> p_case_id and c.form_id = p_form_id
      and c.package_case_id = package_id and private.payment_case_allowed(p_user_id,c.id,c.form_id) limit 1;
    if recovered is not null then return jsonb_build_object('allowed',false,'purchasePrepared',false,'recoverCaseId',recovered,'environment',private.payment_case_environment(p_user_id,recovered,p_form_id)); end if;
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
  if p_action in ('reconcile','prepare') and saved.purchase_id is null and reserved is null and not (p_form_id = 'I-130A' or (p_form_id = 'I-130' and p_parent_case_id is not null)) then
    select p.id into chosen from private.payment_purchases p where p.user_id = p_user_id and p.form_id = p_form_id and p.active
      and p.environment = preferred_environment
      and not exists(select 1 from private.payment_cases c where c.purchase_id = p.id) order by p.purchased_at,p.id limit 1 for update;
    if chosen is not null then update private.payment_cases set purchase_id = chosen where id = p_case_id; end if;
  end if;
  allowed := private.payment_case_allowed(p_user_id,p_case_id,p_form_id);
  if not allowed and saved.purchase_id is null and p_action <> 'cancel' then
    select c.id into recovered from private.payment_cases c where c.user_id = p_user_id and c.id <> p_case_id and c.form_id = p_form_id
      and c.parent_case_id is not distinct from p_parent_case_id and private.payment_case_environment(p_user_id,c.id,c.form_id) = preferred_environment and private.payment_case_allowed(p_user_id,c.id,c.form_id)
      order by c.created_at,c.id limit 1;
    if recovered is not null then return jsonb_build_object('allowed',false,'purchasePrepared',false,'recoverCaseId',recovered,'environment',private.payment_case_environment(p_user_id,recovered,p_form_id)); end if;
  end if;
  if p_action = 'prepare' and not allowed then
    -- Refunded consumed cases need support; purchasing again must use a new case.
    if saved.purchase_id is not null then return jsonb_build_object('allowed',false,'purchasePrepared',false,'unavailable',true); end if;
    if reserved is not null then raise sqlstate 'PT409' using message = 'purchase_already_pending'; end if;
    insert into private.payment_purchase_intents(user_id,form_id,case_id,known_purchase_ids) values(p_user_id,p_form_id,p_case_id,array(select id from private.payment_purchases where user_id = p_user_id and form_id = p_form_id)) on conflict do nothing;
  end if;
  if allowed or p_action = 'cancel' then delete from private.payment_purchase_intents where user_id = p_user_id and form_id = p_form_id and case_id = p_case_id; end if;
  return jsonb_build_object('environment',coalesce(private.payment_case_environment(p_user_id,p_case_id,p_form_id),preferred_environment),'allowed',allowed,'purchasePrepared',p_action = 'prepare' and not allowed,
    'unavailable',not allowed and saved.purchase_id is not null,
    'included',p_form_id in ('I-130','I-130A') and p_parent_case_id is not null,
    'purchaseState',case when not allowed and (reserved is not null or p_action = 'prepare') and p_action <> 'cancel' then 'pending' else null end);
end;
$$;

create or replace function public.fillout_payment_case_access(p_user_id uuid,p_case_id uuid,p_form_id text)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('environment',private.payment_case_environment(p_user_id,p_case_id,p_form_id),'allowed',private.form_review_verified(p_user_id) and private.payment_case_allowed(p_user_id,p_case_id,p_form_id));
$$;
alter table private.form_review_submissions add column environment text not null default 'legacy'
  check (environment in ('production','sandbox','legacy'));
update private.form_review_submissions s set environment = case when s.form_id in ('AR-11','G-1145') then 'production'
  else coalesce(private.payment_case_environment(s.user_id,s.payment_case_id,s.form_id),'legacy') end;
-- Preserve unknown historical content without presenting it as a verified order.
comment on column private.form_review_submissions.environment is 'Immutable purchase provenance. legacy is quarantined; it is excluded from user/operator workflows until separately audited.';
drop index private.form_review_one_current;
create unique index form_review_one_current on private.form_review_submissions(user_id,form_id,environment) where status <> 'superseded';
create index form_review_environment_inbox_idx on private.form_review_submissions(environment,submitted_at desc,id desc) where status <> 'superseded';

create or replace function private.form_review_json(p_row private.form_review_submissions)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id',p_row.id,'formId',p_row.form_id,'status',p_row.status,
    'submittedAt',p_row.submitted_at,'reviewedAt',p_row.reviewed_at,'reviewNote',p_row.review_note,
    'sha256',p_row.sha256,'requestId',p_row.request_id,'environment',p_row.environment,'caseId',p_row.payment_case_id);
$$;

drop function private.form_review_submit_content(uuid,uuid,text,text,jsonb);
create function private.form_review_submit_content(p_user_id uuid,p_request_id uuid,p_form_id text,p_pdf_base64 text,p_answers jsonb,p_case_id uuid,p_environment text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved private.form_review_submissions%rowtype; pdf bytea; pdf_hash text; item record;
begin
  if not private.form_review_verified(p_user_id) then raise sqlstate 'PT403' using message = 'verified_email_required'; end if;
  if p_environment is null or p_environment not in ('production','sandbox') or p_request_id is null or p_form_id is null or p_form_id not in ('AR-11','G-1145','G-639','I-90','I-129F','I-130','I-130A','I-131','I-131A','I-134','I-485','I-751','I-765','I-765WS','I-821','I-821D','I-864','I-864A','N-400','N-565','N-600')
    or p_pdf_base64 is null or length(p_pdf_base64) not between 24 and 11184812
    or p_pdf_base64 !~ '^[A-Za-z0-9+/]+={0,2}$' or length(p_pdf_base64) % 4 <> 0
    or p_answers is null or jsonb_typeof(p_answers) <> 'object' or octet_length(p_answers::text) > 524288 then
    raise sqlstate 'PT422' using message = 'invalid_submission';
  end if;
  for item in select * from jsonb_each(p_answers) loop
    if length(item.key) not between 1 and 256 or jsonb_typeof(item.value) not in ('string','array') then
      raise sqlstate 'PT422' using message = 'invalid_answers';
    end if;
    if jsonb_typeof(item.value) = 'string' then
      if length(item.value #>> '{}') > 10000 then raise sqlstate 'PT422' using message = 'invalid_answers'; end if;
    else
      if jsonb_array_length(item.value) > 100 or exists(select 1 from jsonb_array_elements(item.value) v
        where jsonb_typeof(v) <> 'string' or length(v #>> '{}') > 10000) then raise sqlstate 'PT422' using message = 'invalid_answers'; end if;
    end if;
  end loop;
  begin pdf := decode(p_pdf_base64,'base64'); exception when others then raise sqlstate 'PT422' using message = 'invalid_pdf'; end;
  if octet_length(pdf) not between 16 and 8388608 or substring(pdf from 1 for 5) <> convert_to('%PDF-','UTF8')
    or position(convert_to('%%EOF','UTF8') in substring(pdf from greatest(1,octet_length(pdf)-1023))) = 0
    or replace(encode(pdf,'base64'), E'\n','') <> p_pdf_base64 then raise sqlstate 'PT422' using message = 'invalid_pdf'; end if;
  pdf_hash := encode(sha256(pdf),'hex');
  -- Lock the user first: quotas and request IDs are shared across forms.
  perform pg_advisory_xact_lock(hashtextextended('fillout-form-review-quota:' || p_user_id::text,0));
  -- Same lock serializes submissions and decisions for one customer's form.
  perform pg_advisory_xact_lock(hashtextextended('fillout-form-review:' || p_user_id::text || ':' || p_form_id,0));
  if not private.form_review_verified(p_user_id) then raise sqlstate 'PT403' using message = 'verified_email_required'; end if;
  select * into saved from private.form_review_submissions where user_id = p_user_id and request_id = p_request_id;
  if found then
    if saved.environment <> p_environment or saved.payment_case_id is distinct from p_case_id or saved.form_id <> p_form_id or saved.sha256 <> pdf_hash or saved.pdf_bytes <> pdf or saved.answers <> p_answers then
      raise sqlstate 'PT409' using message = 'idempotency_conflict';
    end if;
    return private.form_review_json(saved);
  end if;
  if (select count(*) from private.form_review_submissions where user_id = p_user_id and submitted_at > clock_timestamp() - interval '1 hour') >= 10
    or (select count(*) from private.form_review_submissions where user_id = p_user_id and submitted_at > clock_timestamp() - interval '1 day') >= 30
    or (select coalesce(sum(octet_length(pdf_bytes)),0) from private.form_review_submissions where user_id = p_user_id) + octet_length(pdf) > 268435456 then
    raise sqlstate 'PT429' using message = 'review_limit';
  end if;
  update private.form_review_submissions set status = 'superseded' where user_id = p_user_id and form_id = p_form_id and environment = p_environment and status <> 'superseded';
  insert into private.form_review_submissions(user_id,request_id,form_id,pdf_bytes,sha256,answers,payment_case_id,environment)
    values(p_user_id,p_request_id,p_form_id,pdf,pdf_hash,p_answers,p_case_id,p_environment) returning * into saved;
  return private.form_review_json(saved);
end;
$$;

create or replace function public.fillout_form_review_submit(p_user_id uuid,p_request_id uuid,p_form_id text,p_pdf_base64 text,p_answers jsonb,p_case_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved private.form_review_submissions%rowtype; result jsonb; purchase_environment text;
begin
  perform 1 from private.payment_sync where user_id = p_user_id for update;
  if p_form_id not in ('AR-11','G-1145') and not private.payment_case_allowed(p_user_id,p_case_id,p_form_id) then raise sqlstate 'PT402' using message = 'payment_required'; end if;
  purchase_environment := case when p_form_id in ('AR-11','G-1145') then 'production' else private.payment_case_environment(p_user_id,p_case_id,p_form_id) end;
  if purchase_environment is null then raise sqlstate 'PT402' using message = 'payment_required'; end if;
  if p_form_id in ('AR-11','G-1145') and p_case_id is not null then raise sqlstate 'PT422' using message = 'invalid_case'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fillout-form-review-quota:' || p_user_id::text,0));
  select * into saved from private.form_review_submissions where user_id = p_user_id and request_id = p_request_id;
  if found and saved.payment_case_id is distinct from p_case_id then raise sqlstate 'PT409' using message = 'case_binding_conflict'; end if;
  result := private.form_review_submit_content(p_user_id,p_request_id,p_form_id,p_pdf_base64,p_answers,p_case_id,purchase_environment);
  return result;
end;
$$;

create or replace function public.fillout_form_review_list(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if not private.form_review_verified(p_user_id) then raise sqlstate 'PT403' using message = 'verified_email_required'; end if;
  select coalesce(jsonb_agg(private.form_review_json(s) order by s.submitted_at desc,s.id desc),'[]'::jsonb) into result
    from private.form_review_submissions s where s.user_id = p_user_id and s.status <> 'superseded' and s.environment in ('production','sandbox');
  return jsonb_build_object('submissions',result);
end;
$$;

drop function public.fillout_form_review_inbox(uuid,timestamptz,uuid);
create function public.fillout_form_review_inbox(p_operator_id uuid,p_before_submitted_at timestamptz default null,p_before_id uuid default null,p_environment text default 'production')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; has_more boolean; last_row jsonb;
begin
  if not private.support_operator_allowed(p_operator_id) then raise sqlstate 'PT403' using message = 'operator_access_required'; end if;
  if p_environment is null or p_environment not in ('production','sandbox') then raise sqlstate 'PT422' using message = 'invalid_environment'; end if;
  if (p_before_submitted_at is null) <> (p_before_id is null) then raise sqlstate 'PT422' using message = 'invalid_cursor'; end if;
  with page as (
    select s.*,left(u.email,320) as email from private.form_review_submissions s join auth.users u on u.id = s.user_id
    where s.status <> 'superseded' and s.environment = p_environment and (p_before_submitted_at is null or (s.submitted_at,s.id) < (p_before_submitted_at,p_before_id))
    order by s.submitted_at desc,s.id desc limit 21
  ) select coalesce(jsonb_agg(private.form_review_json(s) || jsonb_build_object('userId',p.user_id,'email',p.email)
    order by p.submitted_at desc,p.id desc),'[]'::jsonb) into result from page p join private.form_review_submissions s on s.id = p.id;
  has_more := jsonb_array_length(result) > 20;
  if has_more then result := result - 20; end if;
  last_row := result -> (jsonb_array_length(result)-1);
  return jsonb_build_object('submissions',result,'hasMore',has_more,'nextBefore',case when has_more then
    jsonb_build_object('submittedAt',last_row->>'submittedAt','id',last_row->>'id') else null end);
end;
$$;

drop function public.fillout_form_review_file(uuid,uuid);
create function public.fillout_form_review_file(p_actor_id uuid,p_submission_id uuid,p_environment text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved private.form_review_submissions%rowtype;
begin
  if not private.form_review_verified(p_actor_id) then raise sqlstate 'PT403' using message = 'verified_email_required'; end if;
  select * into saved from private.form_review_submissions where id = p_submission_id and status <> 'superseded';
  if not found then raise sqlstate 'PT403' using message = 'form_not_available'; end if;
  if saved.environment not in ('production','sandbox') or (p_environment is not null and saved.environment <> p_environment) then raise sqlstate 'PT403' using message = 'form_not_available'; end if;
  if not ((saved.user_id = p_actor_id and saved.status = 'approved') or (private.support_operator_allowed(p_actor_id) and saved.environment = coalesce(p_environment,'production'))) then
    raise sqlstate 'PT403' using message = 'form_not_available';
  end if;
  return jsonb_build_object('submissionId',saved.id,'formId',saved.form_id,'sha256',saved.sha256,'environment',saved.environment,'caseId',saved.payment_case_id,
    'pdfBase64',replace(encode(saved.pdf_bytes,'base64'), E'\n',''));
end;
$$;

drop function public.fillout_form_review_decide(uuid,uuid,text,text);
create function public.fillout_form_review_decide(p_operator_id uuid,p_submission_id uuid,p_decision text,p_note text,p_environment text default 'production')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved private.form_review_submissions%rowtype;
begin
  if not private.support_operator_allowed(p_operator_id) then raise sqlstate 'PT403' using message = 'operator_access_required'; end if;
  if p_environment is null or p_environment not in ('production','sandbox') or p_decision is null or p_decision not in ('approved','changes_requested') or p_note is null
    or length(p_note) > 2000 or octet_length(p_note) > 6000 or regexp_replace(p_note,E'[\n\r\t]','','g') ~ '[[:cntrl:]]'
    or (p_decision = 'changes_requested' and p_note !~ '[^[:space:]]') then raise sqlstate 'PT422' using message = 'invalid_decision'; end if;
  p_note := btrim(p_note);
  select * into saved from private.form_review_submissions where id = p_submission_id;
  if not found or saved.environment <> p_environment then raise sqlstate 'PT403' using message = 'form_not_available'; end if;
  -- Match submit's payment-sync-before-form lock order; a refund cannot race
  -- between the final entitlement check and approval.
  perform 1 from private.payment_sync where user_id = saved.user_id for update;
  perform pg_advisory_xact_lock(hashtextextended('fillout-form-review:' || saved.user_id::text || ':' || saved.form_id,0));
  if not private.support_operator_allowed(p_operator_id) then raise sqlstate 'PT403' using message = 'operator_access_required'; end if;
  select * into saved from private.form_review_submissions where id = p_submission_id for update;
  if not found or saved.environment <> p_environment then raise sqlstate 'PT403' using message = 'form_not_available'; end if;
  if saved.status = p_decision and saved.reviewed_by = p_operator_id and saved.review_note = p_note then return private.form_review_json(saved); end if;
  if saved.status <> 'pending' then raise sqlstate 'PT409' using message = 'revision_already_reviewed'; end if;
  if p_decision = 'approved' and saved.form_id not in ('AR-11','G-1145') and not private.payment_case_allowed(saved.user_id,saved.payment_case_id,saved.form_id) then
    raise sqlstate 'PT402' using message = 'payment_required'; end if;
  update private.form_review_submissions set status = p_decision,review_note = p_note,reviewed_by = p_operator_id,reviewed_at = clock_timestamp()
    where id = p_submission_id returning * into saved;
  return private.form_review_json(saved);
end;
$$;

revoke all on function private.payment_case_environment(uuid,uuid,text),private.form_review_submit_content(uuid,uuid,text,text,jsonb,uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.payment_case_environment(uuid,uuid,text) to service_role;
revoke all on function public.fillout_payment_sync_finish(uuid,bigint,text,text,jsonb,boolean),public.fillout_form_review_inbox(uuid,timestamptz,uuid,text),public.fillout_form_review_file(uuid,uuid,text),public.fillout_form_review_decide(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.fillout_payment_sync_finish(uuid,bigint,text,text,jsonb,boolean),public.fillout_form_review_inbox(uuid,timestamptz,uuid,text),public.fillout_form_review_file(uuid,uuid,text),public.fillout_form_review_decide(uuid,uuid,text,text,text) to service_role;

-- A pending order must still be paid when an operator first approves it.
-- This context contains metadata only and is read before fresh provider verification.
create function public.fillout_form_review_decision_context(p_operator_id uuid,p_submission_id uuid,p_environment text default 'production')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved private.form_review_submissions%rowtype;
begin
  if not private.support_operator_allowed(p_operator_id) then raise sqlstate 'PT403' using message = 'operator_access_required'; end if;
  if p_environment is null or p_environment not in ('production','sandbox') then raise sqlstate 'PT422' using message = 'invalid_environment'; end if;
  select * into saved from private.form_review_submissions where id = p_submission_id and environment = p_environment;
  if not found then raise sqlstate 'PT403' using message = 'form_not_available'; end if;
  return jsonb_build_object('userId',saved.user_id,'caseId',saved.payment_case_id,'formId',saved.form_id,'environment',saved.environment,'status',saved.status);
end;
$$;
revoke all on function public.fillout_form_review_decision_context(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.fillout_form_review_decision_context(uuid,uuid,text) to service_role;
