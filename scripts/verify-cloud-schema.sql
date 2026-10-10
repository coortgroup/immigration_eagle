-- FILLOUT staging: ceoliqoctkgwkphbmkiv
-- Read-only verification after 20261010000100_cloud_intake.sql is applied.
-- Run the entire file in the project's SQL Editor as postgres. Each row should
-- report passed = true. This inspects system catalogs only, never customer rows.
-- It does not change roles, apply migrations, create users, or write fixtures.
-- Hosted API exposed-schema settings and real JWT behavior still need separate checks.

with
expected_tables(schema_name, table_name) as (
  values ('public', 'requests'), ('private', 'notification_outbox'), ('private', 'ai_usage_events')
),
tables as (
  select expected_tables.*, namespace.oid as schema_oid, relation.oid as table_oid,
    relation.relrowsecurity, relation.relkind, relation.relacl, relation.relowner
  from expected_tables
  left join pg_catalog.pg_namespace namespace on namespace.nspname = schema_name
  left join pg_catalog.pg_class relation on relation.relnamespace = namespace.oid and relation.relname = table_name
),
expected_functions(signature, is_definer) as (
  values
    ('private.submit_request(uuid,uuid,jsonb)', true),
    ('private.consume_ai_quota(uuid)', true),
    ('public.fillout_submit_request(uuid,uuid,jsonb)', false),
    ('public.fillout_consume_ai_quota(uuid)', false)
),
functions as (
  select expected_functions.*, routine.oid, routine.prosecdef, routine.proconfig,
    routine.proacl, routine.proowner, routine.prorettype
  from expected_functions
  left join pg_catalog.pg_proc routine on routine.oid = pg_catalog.to_regprocedure(signature)
),
checks(check_name, passed, expected) as (
  select 'table exists: ' || schema_name || '.' || table_name,
    table_oid is not null and relkind = 'r', 'Ordinary table exists'
  from tables
  union all
  select 'RLS enabled: ' || schema_name || '.' || table_name,
    coalesce(relrowsecurity, false), 'Row Level Security enabled'
  from tables
  union all
  select 'anon denied all table privileges: ' || schema_name || '.' || table_name,
    table_oid is not null and not coalesce(pg_catalog.has_table_privilege('anon', table_oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), true),
    'No anonymous read/write/table privileges'
  from tables
  union all
  select 'PUBLIC denied table privileges: ' || schema_name || '.' || table_name,
    table_oid is not null and not exists (
      select 1 from pg_catalog.aclexplode(coalesce(relacl, pg_catalog.acldefault('r', relowner))) privilege
      where privilege.grantee = 0
    ), 'No PUBLIC table grants'
  from tables
  union all
  select 'authenticated denied writes: ' || schema_name || '.' || table_name,
    table_oid is not null and not coalesce(pg_catalog.has_table_privilege('authenticated', table_oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), true),
    'No direct client write/table-management privileges'
  from tables
  union all
  select 'authenticated request reads granted',
    coalesce(pg_catalog.has_table_privilege('authenticated', pg_catalog.to_regclass('public.requests'), 'SELECT'), false),
    'Authenticated SELECT permitted, constrained by owner RLS policy'
  union all
  select 'authenticated private table reads denied: ' || table_name,
    table_oid is not null and not coalesce(pg_catalog.has_table_privilege('authenticated', table_oid, 'SELECT'), true),
    'No client access to outbox or AI quota rows'
  from tables where schema_name = 'private'
  union all
  select 'private schema usage denied: ' || role_name,
    pg_catalog.to_regnamespace('private') is not null
      and not coalesce(pg_catalog.has_schema_privilege(role_name, pg_catalog.to_regnamespace('private'), 'USAGE'), true),
    'Private schema inaccessible to API user roles'
  from (values ('anon'), ('authenticated')) roles(role_name)
  union all
  select 'service role private schema usage granted',
    coalesce(pg_catalog.has_schema_privilege('service_role', pg_catalog.to_regnamespace('private'), 'USAGE'), false),
    'Server role can invoke private implementation functions'
  union all
  select 'only request owner SELECT policy exists',
    (select count(*) = 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'requests')
      and exists (
        select 1 from pg_catalog.pg_policies
        where schemaname = 'public' and tablename = 'requests'
          and policyname = 'requests_read_own' and cmd = 'SELECT'
          and roles = array['authenticated']::name[] and permissive = 'PERMISSIVE'
          and pg_catalog.regexp_replace(qual, '[[:space:]]', '', 'g') = '((SELECTauth.uid()ASuid)=user_id)'
          and with_check is null
      ), 'Exactly the authenticated owner-only SELECT policy; verify actual two-user isolation separately'
  union all
  select 'private tables have no API policies',
    not exists (select 1 from pg_catalog.pg_policies where schemaname = 'private' and tablename in ('notification_outbox', 'ai_usage_events')),
    'No policy makes private rows available to API users'
  union all
  select 'request idempotency constraint exists',
    exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = pg_catalog.to_regclass('public.requests') and contype = 'u'
        and pg_catalog.pg_get_constraintdef(oid) = 'UNIQUE (user_id, request_id)'
    ), 'Unique (user_id, request_id)'
  union all
  select 'request owner deletion cascades',
    exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = pg_catalog.to_regclass('public.requests') and contype = 'f'
        and confrelid = pg_catalog.to_regclass('auth.users') and confdeltype = 'c'
    ), 'Deleting an Auth user removes their requests'
  union all
  select 'outbox request deletion cascades',
    exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = pg_catalog.to_regclass('private.notification_outbox') and contype = 'f'
        and confrelid = pg_catalog.to_regclass('public.requests') and confdeltype = 'c'
    ), 'Deleting a request removes its notification metadata'
  union all
  select 'AI usage owner deletion cascades',
    exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = pg_catalog.to_regclass('private.ai_usage_events') and contype = 'f'
        and confrelid = pg_catalog.to_regclass('auth.users') and confdeltype = 'c'
    ), 'Deleting an Auth user removes their AI quota metadata'
  union all
  select 'function exists with expected security mode: ' || signature,
    oid is not null and prosecdef = is_definer and prorettype = 'jsonb'::regtype,
    case when is_definer then 'Private SECURITY DEFINER returns JSONB' else 'Public SECURITY INVOKER returns JSONB' end
  from functions
  union all
  select 'function search path pinned: ' || signature,
    oid is not null and coalesce('search_path=""' = any(proconfig), false), 'Empty search_path'
  from functions
  union all
  select 'service role function execution granted: ' || signature,
    coalesce(pg_catalog.has_function_privilege('service_role', oid, 'EXECUTE'), false), 'Server role can execute'
  from functions
  union all
  select 'client function execution denied: ' || signature,
    oid is not null and not coalesce(pg_catalog.has_function_privilege('anon', oid, 'EXECUTE'), true)
      and not coalesce(pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE'), true),
    'Anonymous and authenticated users cannot execute service RPCs or private functions'
  from functions
  union all
  select 'PUBLIC function execution denied: ' || signature,
    oid is not null and not exists (
      select 1 from pg_catalog.aclexplode(coalesce(proacl, pg_catalog.acldefault('f', proowner))) privilege
      where privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
    ), 'No implicit PUBLIC EXECUTE remains'
  from functions
)
select check_name, passed, expected
from checks
order by passed asc, check_name;
