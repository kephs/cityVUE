-- =====================================================================
-- Reqro / CityVUE -- integration worker database function API privileges
-- ADR-027, F062.2D-1, F062.2D-2B
-- =====================================================================
--
-- PRODUCTION USE REMAINS UNAUTHORIZED. This file is reviewed
-- configuration, not a provisioning action. Nothing here has been run
-- against any client, staging or production infrastructure.
--
-- NO WORKER RUNS. NO EXTERNAL DESTINATION IS CONTACTED. NO WORKER LOGIN
-- OR WORKER EXECUTE GRANT EXISTS.
--
-- ---------------------------------------------------------------------
-- What this grants, and what it deliberately does not
-- ---------------------------------------------------------------------
--
-- Exactly the privileges the two worker API functions created by
-- Migration 53 need in order to run as their owner, and nothing else.
--
-- A SECURITY DEFINER function executes with its OWNER's authority, so
-- the owner's privilege set is the blast radius if a function body is
-- ever wrong. That is the whole reason
-- reqro_integration_function_owner exists instead of reusing
-- reqro_owner, which owns every business table: a flaw in a worker
-- function must be able to corrupt delivery state and nothing else.
--
-- THE WORKER PRINCIPAL IS NOT GRANTED ANYTHING HERE, because it does
-- not exist. F062.2D-3 creates reqro_integration_worker in the
-- bootstrap and adds its USAGE and per-signature EXECUTE grants to this
-- file. Until then the function API is callable by no login role at all:
-- PUBLIC's EXECUTE is revoked by the migration, the runtime holds
-- nothing, and the owner is NOLOGIN.
--
-- The privilege list was derived from the two function bodies rather
-- than from the design document, statement by statement:
--
--   integration_outbox              SELECT     the eligible-obligation read
--                                   UPDATE     pending -> dispatching, and the
--                                              settlement transition; also the
--                                              FOR UPDATE SKIP LOCKED claim
--   integration_delivery_attempt    SELECT     the open-attempt existence test
--                                              and the claim descriptor read
--                                   INSERT     one open attempt per claim
--                                   UPDATE     the single open -> settled
--                                              transition, which the
--                                              complete-once guard constrains
--   integration_connector           SELECT     lifecycle and connector_kind
--                                   UPDATE(id) required by FOR SHARE; see below
--   integration_connector_audit     SELECT     the pinned semantic snapshot
--
-- Deliberately absent, each for a reason:
--
--   * No INSERT on integration_outbox. Enqueue is the application's
--     path under reqro_runtime; a worker able to insert intents could
--     manufacture obligations to a destination.
--   * No DELETE or TRUNCATE anywhere. Delivery history is evidence
--     (F062.1 mayEraseEvidence is false in every state), and the
--     guards refuse both regardless.
--   * No INSERT or UPDATE on integration_connector_audit. The worker
--     records no connector history; the table is append-only by
--     trigger.
--   * No general UPDATE, INSERT or DELETE on integration_connector.
--     Connector administration is not worker work.
--   * NOTHING on any business table. The outbox exists precisely so a
--     delivery worker never touches resident data.
--   * NO GRANT OPTION on anything. The word WITH GRANT OPTION must
--     never appear in this file: a compromised function owner must not
--     be able to hand delivery-data access to another role.
--   * No default privileges. A table added by a future migration is
--     unreachable until granted here deliberately.
--
-- The UPDATE (id) exception, and why it confers nothing. Measured in
-- Migration 49: SELECT ... FOR SHARE and FOR UPDATE require UPDATE
-- privilege on at least one column of the locked table, checked against
-- the EFFECTIVE executing role -- which inside a definer function is
-- this owner. The claim function takes FOR SHARE on the connector so
-- its configuration cannot change between pinning the snapshot and
-- opening the attempt. Column-scoped UPDATE (id) satisfies the check,
-- and F062.2B's guard_integration_connector already refuses any change
-- to id ("Integration connector identity is immutable"), so the
-- privilege is inert by construction. This is the pattern Migration 49
-- established for Category.
--
-- Run as the schema owner (reqro_owner) AFTER migrations, because the
-- objects granted here are created by them. Provisioning order is in
-- bootstrap-roles.sql.
--
--   psql -v function_owner=reqro_integration_function_owner \
--        -v api_schema=reqro_integration_api -v schema=public \
--        -f deploy/database/integration-worker-role.sql
--
-- NO GRANT ALL. NO ON ALL TABLES. NO default privileges. Repeatable:
-- every statement is idempotent, and the final block refuses the
-- transaction if the result is not exactly what was intended.

\set ON_ERROR_STOP on

begin;

select set_config('reqro.function_owner_role', :'function_owner', false);
select set_config('reqro.api_schema', :'api_schema', false);
select set_config('reqro.app_schema', :'schema', false);

-- ---------------------------------------------------------------------
-- Schema access
-- ---------------------------------------------------------------------
-- Schema USAGE and table DML are separate privileges in PostgreSQL and
-- neither implies the other: without USAGE the qualified reference
-- public.integration_outbox fails on the namespace before any table
-- privilege is consulted, so the grants below would be inert.
--
-- Explicit, following runtime-role.sql, so the role still works where
-- USAGE has been revoked from PUBLIC. NO CREATE: the function owner
-- creates nothing in the application schema and owns no object in it.
-- Its CREATE is confined to the api schema it owns.
grant usage on schema :"schema" to :"function_owner";

-- ---------------------------------------------------------------------
-- The four integration tables
-- ---------------------------------------------------------------------
grant select, update on :"schema".integration_outbox to :"function_owner";
grant select, insert, update on :"schema".integration_delivery_attempt
  to :"function_owner";
grant select on :"schema".integration_connector to :"function_owner";
grant update (id) on :"schema".integration_connector to :"function_owner";
grant select on :"schema".integration_connector_audit to :"function_owner";

-- ---------------------------------------------------------------------
-- The worker principal
-- ---------------------------------------------------------------------
-- DELIBERATELY EMPTY. F062.2D-3 adds, after the function API has been
-- reviewed:
--
--   grant usage on schema :"api_schema" to :"worker";
--   grant execute on function
--     :"api_schema".claim_integration_intent(uuid, uuid, text) to :"worker";
--   grant execute on function
--     :"api_schema".complete_integration_attempt(
--       uuid, uuid, uuid, bigint, text, varchar, varchar) to :"worker";
--
-- named per signature, never ON ALL FUNCTIONS IN SCHEMA, and with no
-- CREATE on the api schema and no USAGE on the application schema -- so
-- the worker names no application object and cannot reach one whatever
-- table grants might exist.

-- ---------------------------------------------------------------------
-- Fail closed: refuse a privilege set that is not what was intended
-- ---------------------------------------------------------------------
do $$
declare
  function_owner_role text := current_setting('reqro.function_owner_role');
  api_schema text := current_setting('reqro.api_schema');
  app_schema text := current_setting('reqro.app_schema');
  expected text[] := array[
    'integration_connector:SELECT',
    'integration_connector_audit:SELECT',
    'integration_delivery_attempt:INSERT',
    'integration_delivery_attempt:SELECT',
    'integration_delivery_attempt:UPDATE',
    'integration_outbox:SELECT',
    'integration_outbox:UPDATE'];
  actual text[];
  offending text;
begin
  -- Table privileges equal the derived list exactly. An EQUALITY
  -- assertion, so a privilege nobody reviewed fails provisioning rather
  -- than passing unnoticed -- and so a privilege on a business table is
  -- caught by the same check that proves the intended ones exist.
  --
  -- relacl carries only TABLE-level entries; a column grant lives in
  -- pg_attribute.attacl, which is why UPDATE (id) on
  -- integration_connector is absent from `expected` and asserted
  -- separately below.
  select coalesce(array_agg(distinct c.relname || ':' || a.privilege_type
           order by c.relname || ':' || a.privilege_type), array[]::text[])
    into actual
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join aclexplode(c.relacl) a
  where n.nspname = app_schema
    and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
    and a.grantee::regrole::text = function_owner_role;
  if actual <> expected then
    raise exception
      'refusing: % holds table privileges % but exactly % were intended',
      function_owner_role, actual, expected;
  end if;

  -- The column grant exists, and the table-wide one it stands in for
  -- does not.
  if not has_column_privilege(function_owner_role,
      format('%I.%I', app_schema, 'integration_connector'), 'id', 'UPDATE') then
    raise exception 'refusing: % needs UPDATE (id) on integration_connector for FOR SHARE',
      function_owner_role;
  end if;
  if has_table_privilege(function_owner_role,
      format('%I.%I', app_schema, 'integration_connector'), 'UPDATE') then
    raise exception 'refusing: % holds table-wide UPDATE on integration_connector',
      function_owner_role;
  end if;

  -- No DELETE, TRUNCATE or REFERENCES anywhere in the application
  -- schema, stated as its own assertion so the reason is legible.
  select string_agg(distinct c.relname || ' ' || a.privilege_type, ', ')
    into offending
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join aclexplode(c.relacl) a
  where n.nspname = app_schema
    and a.grantee::regrole::text = function_owner_role
    and a.privilege_type in ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER');
  if offending is not null then
    raise exception 'refusing: % holds %', function_owner_role, offending;
  end if;

  -- No GRANT OPTION on any privilege granted over an application
  -- object. Ownership of the api schema and its functions is a
  -- different thing and is intentional; this is about privileges
  -- granted TO the owner, which it must not be able to pass on.
  select string_agg(distinct c.relname || ' ' || a.privilege_type, ', ')
    into offending
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join aclexplode(c.relacl) a
  where n.nspname = app_schema
    and a.grantee::regrole::text = function_owner_role
    and a.is_grantable;
  if offending is not null then
    raise exception 'refusing: % holds GRANT OPTION on %',
      function_owner_role, offending;
  end if;

  -- No CREATE on the application schema or the database, and no
  -- ownership of any relation in the application schema.
  if has_schema_privilege(function_owner_role, app_schema, 'CREATE')
    or has_database_privilege(function_owner_role, current_database(), 'CREATE') then
    raise exception 'refusing: % must hold no CREATE outside %',
      function_owner_role, api_schema;
  end if;
  select string_agg(c.relname, ', ' order by c.relname) into offending
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = app_schema and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
    and pg_get_userbyid(c.relowner) = function_owner_role;
  if offending is not null then
    raise exception 'refusing: % owns %', function_owner_role, offending;
  end if;

  -- USAGE on the application schema is required and must be present, or
  -- every grant above is inert.
  if not has_schema_privilege(function_owner_role, app_schema, 'USAGE') then
    raise exception 'refusing: % needs USAGE on %', function_owner_role, app_schema;
  end if;

  -- The function API remains callable by nobody but its owner: PUBLIC's
  -- EXECUTE is revoked by Migration 53, no worker principal exists, and
  -- this file grants EXECUTE to no one.
  select string_agg(distinct a.grantee::regrole::text, ', ') into offending
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join aclexplode(p.proacl) a
  where n.nspname = api_schema
    and a.grantee <> 0
    and a.grantee::regrole::text <> function_owner_role;
  if offending is not null then
    raise exception 'refusing: % may execute a worker function in %',
      offending, api_schema;
  end if;
  select string_agg(p.proname, ', ' order by p.proname) into offending
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = api_schema
    and has_function_privilege('public', p.oid, 'EXECUTE');
  if offending is not null then
    raise exception 'refusing: PUBLIC may execute % in %', offending, api_schema;
  end if;

  -- No default privileges for this role, for the same reason
  -- bootstrap-roles.sql issues none for any other.
  if exists (select 1 from pg_default_acl
    where pg_get_userbyid(defaclrole) = function_owner_role) then
    raise exception
      'refusing: default privileges exist for %; explicit per-table grants are required',
      function_owner_role;
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------
--
--   select c.relname, a.privilege_type, a.is_grantable
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--     cross join aclexplode(c.relacl) a
--     where n.nspname = 'public'
--       and a.grantee::regrole::text = 'reqro_integration_function_owner'
--     order by 1, 2;
--     -- expected: exactly the seven rows listed in the header, none grantable
--
--   select has_function_privilege('public',
--     'reqro_integration_api.claim_integration_intent(uuid,uuid,text)', 'EXECUTE');
--     -- expected: false
--
-- The authoritative check is the integration suite, which proves the
-- whole topology rather than individual flags:
--
--   cd server && npm run test:compile && node --test --test-concurrency=1 \
--     dist-test/test/database/database-role-separation.integration.test.js
--
-- It requires Docker and skips without it. A skip is not a pass.
