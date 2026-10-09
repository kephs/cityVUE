-- =====================================================================
-- Reqro / CityVUE -- least-privilege runtime application database role
-- ADR-027, F060.3C-2d
-- =====================================================================
--
-- PRODUCTION USE REMAINS UNAUTHORIZED. This file is reviewed
-- configuration, not a provisioning action. Nothing here has been run
-- against any client, staging or production infrastructure.
--
-- ---------------------------------------------------------------------
-- What this grants, and how it was derived
-- ---------------------------------------------------------------------
--
-- The exact privileges the Nest runtime needs, and nothing else. The
-- surface was traced from the transitive require() graph of the built
-- application entry point -- 179 runtime modules -- and cross-checked
-- with five independent techniques, because every single technique
-- missed something:
--
--   1 Kysely builder scan, including the one dynamic selectFrom
--   2 raw SQL scan
--   3 upsert scan (onConflict().doUpdateSet and ON CONFLICT DO UPDATE)
--   4 trigger function bodies, for writes and locks the application
--     cannot see but performs with the caller's privileges
--   5 the runtime module closure, so tooling is excluded
--
-- 62 of the 66 declared tables are runtime reachable. The four that are
-- not -- `permission` and the three operator-only `tenant_domain_audit`,
-- `tenant_domain_operator_approval` and
-- `tenant_domain_verification_attempt` -- appear nowhere below.
--
-- Run as the schema owner (reqro_owner) AFTER migrations, because the
-- objects granted here are created by them. Provisioning order is in
-- bootstrap-roles.sql.
--
--   psql -v runtime=reqro_runtime -v schema=public \
--        -f deploy/database/runtime-role.sql
--
-- NO GRANT ALL. NO ON ALL TABLES. NO default privileges -- a table added
-- by a future migration is unreachable until granted here deliberately,
-- which is the same future-object isolation F060.3C-2c-3 established for
-- the operator.

\set ON_ERROR_STOP on

begin;

select set_config('reqro.runtime_role', :'runtime', false);
select set_config('reqro.app_schema', :'schema', false);

-- ---------------------------------------------------------------------
-- Schema access
-- ---------------------------------------------------------------------
-- Explicit, so the role still works where USAGE has been revoked from
-- PUBLIC. No CREATE: the runtime performs no DDL anywhere -- zero
-- CREATE/ALTER/DROP/TRUNCATE statements and no Kysely schema builder
-- appear in the 179-module closure.
grant usage on schema :"schema" to :"runtime";

-- ---------------------------------------------------------------------
-- Reference reads -- SELECT only, no row-lock privilege
-- ---------------------------------------------------------------------
-- These are read, and five of them are also row-locked. The locks now run
-- through the Migration 49 SECURITY DEFINER helpers, which is precisely
-- why no UPDATE appears here: PostgreSQL would otherwise require UPDATE
-- on at least one column of a row-locked table.
--
-- `tenant_domain` is the one intended overlap with the operator surface:
-- the future hostname resolver reads it. SELECT only, never the
-- operator's INSERT or UPDATE.
grant select on :"schema".department to :"runtime";
grant select on :"schema".division to :"runtime";
grant select on :"schema".operational_role to :"runtime";
grant select on :"schema".operational_role_membership to :"runtime";
grant select on :"schema".resident_alert to :"runtime";
grant select on :"schema".staff_department_membership to :"runtime";
grant select on :"schema".staff_division_membership to :"runtime";
grant select on :"schema".staff_identity to :"runtime";
grant select on :"schema".tenant_domain to :"runtime";
grant select on :"schema".work_group to :"runtime";
grant select on :"schema".work_group_membership to :"runtime";

-- ---------------------------------------------------------------------
-- Append-only evidence -- INSERT only, deliberately no SELECT
-- ---------------------------------------------------------------------
-- The runtime writes these and never reads them back. Withholding SELECT
-- is not an oversight: a failed attempt or an audit row is a fact for
-- later review, not runtime input.
grant insert on :"schema".ai_audit_event to :"runtime";
grant insert on :"schema".issue_default_assignment_audit to :"runtime";
grant insert on :"schema".issue_requester_identity_audit to :"runtime";
grant insert on :"schema".participation_area_audit to :"runtime";
grant insert on :"schema".participation_collection_audit to :"runtime";
grant insert on :"schema".requester_history_audit to :"runtime";
grant insert on :"schema".service_participation_audit to :"runtime";

-- ---------------------------------------------------------------------
-- Append-and-read -- SELECT, INSERT
-- ---------------------------------------------------------------------
-- No UPDATE and no DELETE: each of these is immutable once written, and
-- most are additionally protected by an append-only trigger, so this is
-- defence in depth rather than the only barrier.
--
-- The three access_* entries were found only by the raw-SQL scan; the
-- builder scan did not see them, and an earlier version of this model was
-- wrong as a result.
grant select, insert on :"schema".access_change_set to :"runtime";
grant select, insert on :"schema".access_permission_delta to :"runtime";
grant select, insert on :"schema".access_role_ownership to :"runtime";
grant select, insert on :"schema".activity to :"runtime";
grant select, insert on :"schema".answer to :"runtime";
grant select, insert on :"schema".answer_selected_option to :"runtime";
grant select, insert on :"schema".attachment_audit to :"runtime";
grant select, insert on :"schema".location to :"runtime";
-- question and question_option are written by the admin Issue version-copy
-- path in raw SQL; approved as an existing runtime requirement, not
-- broadened beyond those exact operations.
grant select, insert on :"schema".question to :"runtime";
grant select, insert on :"schema".question_option to :"runtime";
grant select, insert on :"schema".request_communication to :"runtime";
grant select, insert on :"schema".request_internal_note to :"runtime";
grant select, insert on :"schema".request_operational_activity to :"runtime";
grant select, insert on :"schema".requester to :"runtime";
grant select, insert on :"schema".requester_contact to :"runtime";
grant select, insert on :"schema".resident_experience_action to :"runtime";
grant select, insert on :"schema".resident_experience_benefit to :"runtime";
grant select, insert on :"schema".resident_experience_contact to :"runtime";
grant select, insert on :"schema".resident_experience_event to :"runtime";
grant select, insert on :"schema".resident_experience_revision to :"runtime";
-- The review tables are database-enforced immutable
-- (resident_review_immutable raises on UPDATE and DELETE), which is why
-- F060.3C-2d removed their FOR UPDATE locks.
grant select, insert on :"schema".resident_experience_review_request to :"runtime";
grant select, insert on :"schema".resident_experience_review_decision to :"runtime";
grant select, insert on :"schema".role to :"runtime";
grant select, insert on :"schema".staff_role_assignment to :"runtime";

-- ---------------------------------------------------------------------
-- Mutable application state -- SELECT, INSERT, UPDATE
-- ---------------------------------------------------------------------
-- No DELETE on any of these: application state is superseded or
-- deactivated, never removed.
--
-- issue_default_assignment, issue_requester_identity_policy and
-- service_request_reference_sequence need UPDATE because they are
-- upserts; the first two use Kysely's doUpdateSet and the third uses
-- ON CONFLICT DO UPDATE with RETURNING. All three were missed by the
-- builder-only scan.
grant select, insert, update on :"schema".ai_usage to :"runtime";
grant select, insert, update on :"schema".issue_default_assignment to :"runtime";
grant select, insert, update on :"schema".issue_requester_identity_policy to :"runtime";
grant select, insert, update on :"schema".organization_branding to :"runtime";
grant select, insert, update on :"schema".organization_resident_experience to :"runtime";
grant select, insert, update on :"schema".participation_area to :"runtime";
grant select, insert, update on :"schema".request_tracking_credential to :"runtime";
grant select, insert, update on :"schema".service_definition to :"runtime";
grant select, insert, update on :"schema".service_definition_version to :"runtime";
grant select, insert, update on :"schema".service_request to :"runtime";
grant select, insert, update on :"schema".service_request_assignment to :"runtime";
grant select, insert, update on :"schema".service_request_reference_config to :"runtime";
grant select, insert, update on :"schema".service_request_reference_sequence to :"runtime";

-- Organization status is mutated by the runtime, and that UPDATE is also
-- what permits the FOR SHARE/FOR UPDATE the request paths take on it.
grant select, update on :"schema".organization to :"runtime";

-- ---------------------------------------------------------------------
-- The only four tables the runtime may DELETE from
-- ---------------------------------------------------------------------
-- Attachment lifecycle genuinely removes rows; permissions and watchers
-- are set-membership tables whose removals are real.
grant select, insert, update, delete on :"schema".attachment to :"runtime";
grant select, insert, update, delete on :"schema".attachment_batch to :"runtime";
grant select, insert, delete on :"schema".role_permission to :"runtime";
grant select, insert, delete on :"schema".service_request_watcher to :"runtime";

-- ---------------------------------------------------------------------
-- Category -- the single lock-only column privilege in the whole design
-- ---------------------------------------------------------------------
-- Category is locked at sixteen runtime sites. Thirteen use Kysely's
-- OF-alias form inside the shared staff request scope, where the Category
-- row is locked atomically together with the Service Request and the
-- Organization in ONE statement. Converting those would replace an atomic
-- multi-relation lock with a helper call plus a narrowed OF clause in the
-- hottest request paths, which was judged the worse trade.
--
-- So the runtime holds UPDATE on exactly one Category column, purely to
-- satisfy PostgreSQL's row-lock privilege requirement. It confers no
-- authority: Migration 49's `category_identity_immutable` trigger raises
-- "Category identity is immutable" on any real change while permitting
-- the same-value assignment PostgreSQL may need to evaluate.
--
-- There is NO table-level Category UPDATE, and no UPDATE on name, status,
-- department_id, division_id, display_order, icon_key or any other
-- column. Every other Category mutation stays unauthorized.
grant select on :"schema".category to :"runtime";
grant update (id) on :"schema".category to :"runtime";

-- ---------------------------------------------------------------------
-- Access state -- one genuinely mutated column
-- ---------------------------------------------------------------------
-- The runtime sets bootstrap_established directly, and that single column
-- grant also satisfies every row lock on this table, including the four
-- taken inside SECURITY INVOKER trigger functions.
--
-- authorization_revision, mutation_txid and updated_at are
-- database-maintained and are deliberately absent. Migration 49 hardened
-- advance_access_revision and invalidate_access_revision to SECURITY
-- DEFINER so the trigger chain updates them under the owner's privileges
-- rather than the caller's; without that hardening this grant would be
-- insufficient and role, permission and assignment writes would fail.
--
-- No INSERT: the row is created by a trigger on Organization insert, and
-- the runtime never inserts an Organization.
grant select on :"schema".organization_access_state to :"runtime";
grant update (bootstrap_established) on :"schema".organization_access_state
  to :"runtime";

-- ---------------------------------------------------------------------
-- Function EXECUTE -- eleven, and no more
-- ---------------------------------------------------------------------
-- Four pre-existing business functions the runtime calls directly in SQL.
grant execute on function :"schema".effective_access_managers(uuid) to :"runtime";
grant execute on function :"schema".resident_review_authorized(uuid, uuid, boolean)
  to :"runtime";
grant execute on function :"schema".resident_review_contributors(uuid, uuid, uuid)
  to :"runtime";
grant execute on function :"schema".issue_name_key(text) to :"runtime";

-- The seven Migration 49 lock helpers. These are the whole reason the
-- reference tables above need no UPDATE privilege.
grant execute on function :"schema".lock_active_category(uuid, uuid) to :"runtime";
grant execute on function :"schema".lock_active_department(uuid, uuid) to :"runtime";
grant execute on function :"schema".lock_department(uuid, uuid) to :"runtime";
grant execute on function :"schema".lock_active_division(uuid, uuid, uuid) to :"runtime";
grant execute on function :"schema".lock_division(uuid, uuid, uuid) to :"runtime";
grant execute on function :"schema".lock_staff(uuid, uuid) to :"runtime";
grant execute on function :"schema".lock_assignment_target(uuid, varchar, uuid)
  to :"runtime";

-- Deliberately NOT granted:
--   advance_access_revision        -- owner-controlled revision primitive
--   invalidate_access_revision     -- owner-controlled dispatcher
--   tenant_domain_lock_organization -- operator only
--   every trigger function         -- firing a trigger does not check
--                                     EXECUTE, proven on PostgreSQL 17
--   protect_category_identity      -- trigger internal

-- ---------------------------------------------------------------------
-- Fail closed: refuse a posture wider than was reviewed
-- ---------------------------------------------------------------------
do $$
declare
  runtime_role text := current_setting('reqro.runtime_role');
  app_schema text := current_setting('reqro.app_schema');
  offending text;
begin
  -- No ownership, no CREATE, no role membership that could escalate.
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = app_schema and pg_get_userbyid(c.relowner) = runtime_role)
  then
    raise exception 'refusing: % owns objects in %', runtime_role, app_schema;
  end if;
  if has_schema_privilege(runtime_role, app_schema, 'CREATE')
     or has_database_privilege(runtime_role, current_database(), 'CREATE') then
    raise exception 'refusing: % holds CREATE', runtime_role;
  end if;
  if exists (select 1 from pg_auth_members m
             where (select rolname from pg_roles r where r.oid = m.member) = runtime_role)
  then
    raise exception 'refusing: % holds a role membership', runtime_role;
  end if;

  -- Category: column-scoped UPDATE on id ONLY.
  if has_table_privilege(runtime_role,
       format('%I.%I', app_schema, 'category')::regclass, 'UPDATE') then
    raise exception
      'refusing: % holds table-level UPDATE on category; only UPDATE (id) is authorized',
      runtime_role;
  end if;
  select string_agg(a.attname, ', ' order by a.attname) into offending
  from pg_attribute a
  where a.attrelid = format('%I.%I', app_schema, 'category')::regclass
    and a.attnum > 0 and not a.attisdropped and a.attname <> 'id'
    and has_column_privilege(runtime_role, a.attrelid, a.attname, 'UPDATE');
  if offending is not null then
    raise exception 'refusing: % holds UPDATE on Category columns beyond id: %',
      runtime_role, offending;
  end if;
  if not has_column_privilege(runtime_role,
       format('%I.%I', app_schema, 'category')::regclass, 'id', 'UPDATE') then
    raise exception
      'refusing: % lacks UPDATE (id) on category, which its row locks require',
      runtime_role;
  end if;

  -- Access state: bootstrap_established ONLY.
  if has_table_privilege(runtime_role,
       format('%I.%I', app_schema, 'organization_access_state')::regclass, 'UPDATE')
  then
    raise exception
      'refusing: % holds table-level UPDATE on organization_access_state', runtime_role;
  end if;
  select string_agg(a.attname, ', ' order by a.attname) into offending
  from pg_attribute a
  where a.attrelid = format('%I.%I', app_schema, 'organization_access_state')::regclass
    and a.attnum > 0 and not a.attisdropped
    and a.attname <> 'bootstrap_established'
    and has_column_privilege(runtime_role, a.attrelid, a.attname, 'UPDATE');
  if offending is not null then
    raise exception
      'refusing: % holds UPDATE on database-maintained access-state columns: %',
      runtime_role, offending;
  end if;

  -- The operator control plane stays entirely out of reach.
  select string_agg(format('%s:%s', c.relname, p.privilege), ', ') into offending
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) as p(privilege)
  where n.nspname = app_schema
    and c.relname in ('tenant_domain_audit', 'tenant_domain_operator_approval',
                      'tenant_domain_verification_attempt')
    and has_table_privilege(runtime_role, c.oid, p.privilege);
  if offending is not null then
    raise exception 'refusing: % reaches the operator control plane: %',
      runtime_role, offending;
  end if;
  -- tenant_domain itself is readable, but never writable.
  select string_agg(p.privilege, ', ') into offending
  from unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) as p(privilege)
  where has_table_privilege(runtime_role,
    format('%I.%I', app_schema, 'tenant_domain')::regclass, p.privilege);
  if offending is not null then
    raise exception 'refusing: % may write tenant_domain: %', runtime_role, offending;
  end if;

  -- No TRUNCATE anywhere, and DELETE on exactly four tables.
  select string_agg(c.relname, ', ' order by c.relname) into offending
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = app_schema and c.relkind = 'r'
    and has_table_privilege(runtime_role, c.oid, 'TRUNCATE');
  if offending is not null then
    raise exception 'refusing: % holds TRUNCATE on %', runtime_role, offending;
  end if;
  select string_agg(c.relname, ', ' order by c.relname) into offending
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = app_schema and c.relkind = 'r'
    and has_table_privilege(runtime_role, c.oid, 'DELETE')
    and c.relname not in ('attachment', 'attachment_batch', 'role_permission',
                          'service_request_watcher');
  if offending is not null then
    raise exception 'refusing: % holds unexpected DELETE on %', runtime_role, offending;
  end if;

  -- Exactly eleven direct function grants, and none of the forbidden ones.
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into offending
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(p.proacl) a
  where n.nspname = app_schema and a.privilege_type = 'EXECUTE'
    and a.grantee = (select r.oid from pg_roles r where r.rolname = runtime_role)
    and p.proname in ('advance_access_revision', 'invalidate_access_revision',
                      'tenant_domain_lock_organization', 'protect_category_identity');
  if offending is not null then
    raise exception 'refusing: % holds EXECUTE on an owner-only function: %',
      runtime_role, offending;
  end if;

  -- No default privileges may exist; a future table must be unreachable.
  if exists (select 1 from pg_default_acl) then
    raise exception
      'refusing: default privileges exist; explicit per-table grants are required';
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------
-- Rollback coupling -- read before rolling anything back
-- ---------------------------------------------------------------------
--
-- Two of the grants above are safe only while Migration 49 is applied.
--
--   UPDATE (id) ON category is inert because
--   category_identity_immutable refuses a real identity change. Rolling
--   Migration 49 back drops that trigger and would leave the runtime able
--   to repoint a Category to another UUID, bounded only by foreign keys.
--
--   UPDATE (bootstrap_established) is sufficient because
--   advance_access_revision and invalidate_access_revision are SECURITY
--   DEFINER. Rolling Migration 49 back restores SECURITY INVOKER
--   functions, and every role, permission and assignment write would then
--   fail for want of UPDATE on authorization_revision, mutation_txid and
--   updated_at.
--
-- Migration 49 rollback and withdrawal of these grants are therefore ONE
-- operational change. Roll back both together, or neither.
--
-- ---------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------
--
--   select has_table_privilege('<runtime>', '<schema>.category', 'UPDATE');
--     -- expected: false
--   select has_column_privilege('<runtime>', '<schema>.category', 'id', 'UPDATE');
--     -- expected: true
--   select has_table_privilege('<runtime>', '<schema>.tenant_domain_audit', 'SELECT');
--     -- expected: false
--   select has_schema_privilege('<runtime>', '<schema>', 'CREATE');
--     -- expected: false
--
-- The authoritative check is the integration suite:
--
--   cd server && npm run test:compile && node --test --test-concurrency=1 \
--     dist-test/test/database/database-role-separation.integration.test.js
--
-- It requires Docker and skips without it. A skip is not a pass.
