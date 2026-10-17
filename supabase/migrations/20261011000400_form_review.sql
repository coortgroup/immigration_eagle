-- Exact submitted PDFs and answer snapshots stay private until a team member approves.
-- User deletion removes every revision, including PDF bytes, in the Auth cascade.
create table private.form_review_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  form_id text not null check (form_id in ('AR-11','G-1145','G-639','I-90','I-129F','I-130','I-130A','I-131','I-131A','I-134','I-485','I-751','I-765','I-765WS','I-821','I-821D','I-864','I-864A','N-400','N-565','N-600')),
  status text not null default 'pending' check (status in ('pending','changes_requested','approved','superseded')),
  answers jsonb not null check (jsonb_typeof(answers) = 'object' and octet_length(answers::text) <= 524288),
  pdf_bytes bytea not null check (octet_length(pdf_bytes) between 16 and 8388608),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$' and sha256 = encode(sha256(pdf_bytes),'hex')),
  submitted_at timestamptz not null default clock_timestamp(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text not null default '' check (length(review_note) <= 2000 and octet_length(review_note) <= 6000),
  unique(user_id,request_id)
);
create unique index form_review_one_current on private.form_review_submissions(user_id,form_id) where status <> 'superseded';
create index form_review_inbox_idx on private.form_review_submissions(submitted_at desc,id desc) where status <> 'superseded';
create index form_review_user_created_idx on private.form_review_submissions(user_id,submitted_at desc);
alter table private.form_review_submissions enable row level security;
revoke all on private.form_review_submissions from public, anon, authenticated;
grant all on private.form_review_submissions to service_role;
comment on table private.form_review_submissions is 'Immutable submitted content; only status/reviewer/note change through service-only RPCs. No external file bucket.';

create function private.form_review_verified(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from auth.users where id = p_user_id and is_anonymous = false
    and email is not null and email <> '' and email_confirmed_at is not null);
$$;
revoke all on function private.form_review_verified(uuid) from public, anon, authenticated;
grant execute on function private.form_review_verified(uuid) to service_role;

create function private.form_review_json(p_row private.form_review_submissions)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id',p_row.id,'formId',p_row.form_id,'status',p_row.status,
    'submittedAt',p_row.submitted_at,'reviewedAt',p_row.reviewed_at,'reviewNote',p_row.review_note,
    'sha256',p_row.sha256,'requestId',p_row.request_id);
$$;
revoke all on function private.form_review_json(private.form_review_submissions) from public, anon, authenticated;
grant execute on function private.form_review_json(private.form_review_submissions) to service_role;

create function public.fillout_form_review_submit(p_user_id uuid,p_request_id uuid,p_form_id text,p_pdf_base64 text,p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved private.form_review_submissions%rowtype; pdf bytea; pdf_hash text; item record;
begin
  if not private.form_review_verified(p_user_id) then raise sqlstate 'PT403' using message = 'verified_email_required'; end if;
  if p_request_id is null or p_form_id is null or p_form_id not in ('AR-11','G-1145','G-639','I-90','I-129F','I-130','I-130A','I-131','I-131A','I-134','I-485','I-751','I-765','I-765WS','I-821','I-821D','I-864','I-864A','N-400','N-565','N-600')
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
    if saved.form_id <> p_form_id or saved.sha256 <> pdf_hash or saved.pdf_bytes <> pdf or saved.answers <> p_answers then
      raise sqlstate 'PT409' using message = 'idempotency_conflict';
    end if;
    return private.form_review_json(saved);
  end if;
  if (select count(*) from private.form_review_submissions where user_id = p_user_id and submitted_at > clock_timestamp() - interval '1 hour') >= 10
    or (select count(*) from private.form_review_submissions where user_id = p_user_id and submitted_at > clock_timestamp() - interval '1 day') >= 30
    or (select coalesce(sum(octet_length(pdf_bytes)),0) from private.form_review_submissions where user_id = p_user_id) + octet_length(pdf) > 268435456 then
    raise sqlstate 'PT429' using message = 'review_limit';
  end if;
  update private.form_review_submissions set status = 'superseded' where user_id = p_user_id and form_id = p_form_id and status <> 'superseded';
  insert into private.form_review_submissions(user_id,request_id,form_id,pdf_bytes,sha256,answers)
    values(p_user_id,p_request_id,p_form_id,pdf,pdf_hash,p_answers) returning * into saved;
  return private.form_review_json(saved);
end;
$$;
revoke all on function public.fillout_form_review_submit(uuid,uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.fillout_form_review_submit(uuid,uuid,text,text,jsonb) to service_role;

create function public.fillout_form_review_list(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if not private.form_review_verified(p_user_id) then raise sqlstate 'PT403' using message = 'verified_email_required'; end if;
  select coalesce(jsonb_agg(private.form_review_json(s) order by s.submitted_at desc,s.id desc),'[]'::jsonb) into result
    from private.form_review_submissions s where s.user_id = p_user_id and s.status <> 'superseded';
  return jsonb_build_object('submissions',result);
end;
$$;
revoke all on function public.fillout_form_review_list(uuid) from public, anon, authenticated;
grant execute on function public.fillout_form_review_list(uuid) to service_role;

create function public.fillout_form_review_inbox(p_operator_id uuid,p_before_submitted_at timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; has_more boolean; last_row jsonb;
begin
  if not private.support_operator_allowed(p_operator_id) then raise sqlstate 'PT403' using message = 'operator_access_required'; end if;
  if (p_before_submitted_at is null) <> (p_before_id is null) then raise sqlstate 'PT422' using message = 'invalid_cursor'; end if;
  with page as (
    select s.*,left(u.email,320) as email from private.form_review_submissions s join auth.users u on u.id = s.user_id
    where s.status <> 'superseded' and (p_before_submitted_at is null or (s.submitted_at,s.id) < (p_before_submitted_at,p_before_id))
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
revoke all on function public.fillout_form_review_inbox(uuid,timestamptz,uuid) from public, anon, authenticated;
grant execute on function public.fillout_form_review_inbox(uuid,timestamptz,uuid) to service_role;

create function public.fillout_form_review_file(p_actor_id uuid,p_submission_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved private.form_review_submissions%rowtype;
begin
  if not private.form_review_verified(p_actor_id) then raise sqlstate 'PT403' using message = 'verified_email_required'; end if;
  select * into saved from private.form_review_submissions where id = p_submission_id and status <> 'superseded';
  if not found then raise sqlstate 'PT403' using message = 'form_not_available'; end if;
  if not ((saved.user_id = p_actor_id and saved.status = 'approved') or private.support_operator_allowed(p_actor_id)) then
    raise sqlstate 'PT403' using message = 'form_not_available';
  end if;
  return jsonb_build_object('submissionId',saved.id,'formId',saved.form_id,'sha256',saved.sha256,
    'pdfBase64',replace(encode(saved.pdf_bytes,'base64'), E'\n',''));
end;
$$;
revoke all on function public.fillout_form_review_file(uuid,uuid) from public, anon, authenticated;
grant execute on function public.fillout_form_review_file(uuid,uuid) to service_role;

create function public.fillout_form_review_decide(p_operator_id uuid,p_submission_id uuid,p_decision text,p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved private.form_review_submissions%rowtype;
begin
  if not private.support_operator_allowed(p_operator_id) then raise sqlstate 'PT403' using message = 'operator_access_required'; end if;
  if p_decision is null or p_decision not in ('approved','changes_requested') or p_note is null
    or length(p_note) > 2000 or octet_length(p_note) > 6000 or regexp_replace(p_note,E'[\n\r\t]','','g') ~ '[[:cntrl:]]'
    or (p_decision = 'changes_requested' and p_note !~ '[^[:space:]]') then raise sqlstate 'PT422' using message = 'invalid_decision'; end if;
  p_note := btrim(p_note);
  select * into saved from private.form_review_submissions where id = p_submission_id;
  if not found then raise sqlstate 'PT403' using message = 'form_not_available'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fillout-form-review:' || saved.user_id::text || ':' || saved.form_id,0));
  if not private.support_operator_allowed(p_operator_id) then raise sqlstate 'PT403' using message = 'operator_access_required'; end if;
  select * into saved from private.form_review_submissions where id = p_submission_id for update;
  if not found then raise sqlstate 'PT403' using message = 'form_not_available'; end if;
  if saved.status = p_decision and saved.reviewed_by = p_operator_id and saved.review_note = p_note then return private.form_review_json(saved); end if;
  if saved.status <> 'pending' then raise sqlstate 'PT409' using message = 'revision_already_reviewed'; end if;
  update private.form_review_submissions set status = p_decision,review_note = p_note,reviewed_by = p_operator_id,reviewed_at = clock_timestamp()
    where id = p_submission_id returning * into saved;
  return private.form_review_json(saved);
end;
$$;
revoke all on function public.fillout_form_review_decide(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.fillout_form_review_decide(uuid,uuid,text,text) to service_role;
