-- New free attorney requests require versioned, explicit permission to share.
-- Historical records are preserved; absence of consent never implies permission.
create or replace function private.submit_request(p_user_id uuid, p_request_id uuid, p_payload jsonb)
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
    or (select count(*) from jsonb_object_keys(p_payload)) <> (case when p_payload->>'type' = 'attorney' then 7 else 6 end)
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
    or (p_payload->>'type' = 'attorney' and (p_payload->>'formId' is null or p_payload->>'attorneyConsent' is distinct from 'share-contact-and-question-v1'))
    or (p_payload->>'type' <> 'attorney' and p_payload ? 'attorneyConsent') then
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
