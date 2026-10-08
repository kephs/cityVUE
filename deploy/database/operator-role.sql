-- =====================================================================
-- Reqro / CityVUE -- least-privilege platform-operator database role
-- ADR-027, F060.3C-2c-3
-- =====================================================================
--
-- PRODUCTION USE REMAINS UNAUTHORIZED. This file is reviewed
-- configuration, not a provisioning action. Nothing here has been run
-- against any client, staging or production infrastructure.
--
-- Status established by this slice: **production operator database
-- boundary complete**. That is NOT "Reqro database least privilege
-- complete" and NOT "production deployment authorized". Runtime and
-- migration role separation remains an independent production blocker
-- (F060.3C-2d).
--
-- ---------------------------------------------------------------------
-- What this role is for
-- ---------------------------------------------------------------------
--
-- The tenant-domain operator path (`server/src/database/
-- tenant-domain-operator-cli.ts`) is infrastructure tooling, not an
-- application surface. It registers a hostname, issues and verifies a DNS
-- challenge, records an independent approval, and activates, deactivates
-- or revokes a binding. It must not be able to reach tenant data, rewrite
-- its own audit trail, forge or alter an approval, or change the schema.
--
-- Every privilege below was derived empirically against PostgreSQL 17.11
-- -- the major version `server/compose.yml` pins -- by
-- `server/test/database/tenant-domain-operator-role.integration.test.ts`,
-- which stands up a disposable cluster with three separate identities and
-- proves each grant load bearing by removing it and watching a named verb
-- fail. Nothing here was added because a command failed; each entry is
-- attributable to a specific refusal.
--
-- ---------------------------------------------------------------------
-- Prerequisites, and what this file deliberately does NOT do
-- ---------------------------------------------------------------------
--
-- Run as the schema owner (the role that owns the `tenant_domain*` tables
-- and functions), not as a superuser and not as the operator.
--
-- This file assumes the role ALREADY EXISTS. It does not create the role,
-- set or rotate a password, grant CONNECT, configure TLS, or provision
-- infrastructure: IaC and the deployment's secret management own role
-- creation and credential issuance. No password appears in this file.
--
-- It also does not separate the migration role from the runtime role.
-- That is F060.3C-2d and is NOT addressed here.
--
-- There is no capability-role or SET ROLE architecture in this slice: the
-- operator is a single dedicated constrained LOGIN role.
--
-- Identifiers are psql variables so no deployment name is hard-coded:
--
--   psql -v operator=reqro_operator -v schema=public \
--        -f deploy/database/operator-role.sql
--
-- `schema` must equal the application schema the deployment runs in --
-- the same value the operator CLI receives as REQRO_DEPLOYMENT_SCHEMA
-- (normally `public`). The role is expected to have been created with no
-- authority of its own:
--
--   NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS
--
-- ---------------------------------------------------------------------
-- Measured PostgreSQL 17 defaults this file relies on
-- ---------------------------------------------------------------------
--
-- * PUBLIC has no CREATE on schema `public` (removed in PostgreSQL 15),
--   so the role cannot create objects there.
-- * PUBLIC has no CREATE on the database, so the role cannot create a
--   schema -- including one named after itself. That is what makes the
--   default `search_path` of `"$user", public` safe here rather than
--   merely conventional: the `$user` schema cannot be brought into
--   existence by the role it would serve.
-- * Firing a trigger does NOT check EXECUTE on the trigger function.
--   Proven by revoking EXECUTE from PUBLIC on all seven control-plane
--   trigger functions, confirming the operator held EXECUTE on none, and
--   re-running every verb successfully. The trigger functions therefore
--   appear nowhere below; granting EXECUTE on them would be surplus
--   surface. Note the distinction: CREATING a trigger does require
--   EXECUTE on its function, and the operator never creates triggers.
-- * No `tenant_domain*` table uses an identity or serial column, so no
--   sequence privilege is required.
--
-- Verify these hold on the target server before relying on them. If a
-- deployment has granted PUBLIC additional authority, revoke it there
-- rather than widening this role.

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------
-- Schema access
-- ---------------------------------------------------------------------
-- Redundant on a default PostgreSQL 17 database, where PUBLIC already
-- holds schema USAGE, and deliberately kept: it is what carries the role
-- in a deployment that revokes USAGE from PUBLIC, and an explicit grant
-- of a privilege the role already holds implicitly is not an expansion.
grant usage on schema :"schema" to :"operator";

-- ---------------------------------------------------------------------
-- The registry itself
-- ---------------------------------------------------------------------
-- SELECT and UPDATE carry the revision-checked read-modify-write every
-- transition performs; UPDATE is additionally what PostgreSQL requires in
-- order to take the `SELECT ... FOR SHARE` row lock on a binding. No
-- DELETE: a binding is deactivated and revoked, never removed, and the
-- guard trigger refuses deletion regardless.
grant select, insert, update on :"schema".tenant_domain to :"operator";

-- ---------------------------------------------------------------------
-- The audit trail -- append only
-- ---------------------------------------------------------------------
-- INSERT writes the mandatory evidence row for each mutation. SELECT is
-- required by two SECURITY INVOKER guards that read this table as the
-- caller: the deferred `verify_tenant_domain_audited` check that a
-- mutation produced matching attributed evidence, and the single-use
-- approval check. No UPDATE and no DELETE: immutability is enforced by
-- trigger as well, so this is defence in depth rather than the only
-- barrier.
grant select, insert on :"schema".tenant_domain_audit to :"operator";

-- ---------------------------------------------------------------------
-- Independent approvals -- insert and read only
-- ---------------------------------------------------------------------
-- INSERT records an approval; SELECT lets the guards re-check the
-- approval being spent. Separation of duties is enforced by the database
-- (`check(requested_by <> approved_by)`, plus a re-check at the moment of
-- use), not by withholding privileges, so a single role holding both is
-- still unable to approve its own mutation. Proven by writing a
-- self-approving row as raw SQL from the constrained role and watching
-- the check constraint refuse it.
--
-- Kept deliberately separate from the column grant below. Do NOT collapse
-- these into a table-level UPDATE or a GRANT ALL.
grant select, insert on :"schema".tenant_domain_operator_approval
  to :"operator";

-- ---------------------------------------------------------------------
-- The approval row lock -- one column, and only for locking
-- ---------------------------------------------------------------------
-- `guard_tenant_domain_audit` takes `SELECT ... FOR SHARE` on the
-- approval row an audit row spends, so one operator cannot create and
-- spend an approval atomically. PostgreSQL requires UPDATE privilege on
-- at least one column of a row-locked table.
--
-- Measured, attributed to a verb: with no UPDATE privilege here,
-- `register`, `issue-challenge`, `verify` and both `approve` calls
-- succeed and `activate` fails with SQLSTATE 42501; `revoke` fails next.
-- With this single column grant, all seven verbs succeed.
--
-- This grant confers NO mutation authority. `policy_version` is the
-- chosen column because it is inert behind two independent barriers:
--
--   1. `guard_tenant_domain_approval` raises "Tenant domain operator
--      approvals are immutable" on every UPDATE, DELETE and TRUNCATE, so
--      no UPDATE reaches storage. Measured for `policy_version = 1`,
--      `= 2`, and the no-op `= policy_version`, which a privilege check
--      alone would have allowed through.
--   2. `check(policy_version = 1)` admits no other value even if that
--      trigger were absent.
--
-- Also proven: the role cannot disable or drop that trigger, and cannot
-- replace, alter or drop the guard function behind it. Approval rows were
-- compared by content digest before and after every mutation attempt and
-- were byte-for-byte unchanged.
grant update (policy_version)
  on :"schema".tenant_domain_operator_approval to :"operator";

-- ---------------------------------------------------------------------
-- Verification attempts -- append only, write only
-- ---------------------------------------------------------------------
-- Every DNS observation is recorded, successful or not. The operator path
-- never reads them back, so no SELECT: a failed attempt is a fact for
-- later review, not operator input.
grant insert on :"schema".tenant_domain_verification_attempt to :"operator";

-- ---------------------------------------------------------------------
-- The Organization lock helper -- the entire function surface
-- ---------------------------------------------------------------------
-- The only function the role is granted, and the only reason it needs
-- none of the Organization table. The helper is SECURITY DEFINER, pins
-- `search_path = pg_catalog, pg_temp`, takes the row lock, and returns a
-- single boolean. Migration 48 revoked EXECUTE from PUBLIC, so this grant
-- is what makes the operator path work at all.
--
-- Deliberately NOT granted: `tenant_domain_approval_consumed`, the seven
-- trigger functions, and every other tenant-domain function. The seven
-- production verbs were proven to need none of them.
grant execute on function
  :"schema".tenant_domain_lock_organization(uuid) to :"operator";

-- ---------------------------------------------------------------------
-- Fail closed: the posture this file is allowed to leave behind
-- ---------------------------------------------------------------------
-- Refuses the transaction if anything above was mistyped into a wider
-- privilege than was reviewed. Cheap, and it turns a silent widening into
-- a failed deployment.
-- psql does not interpolate variables inside dollar-quoted text, so the
-- names are handed to the block through session settings instead of being
-- substituted into it.
select set_config('reqro.operator_role', :'operator', false);
select set_config('reqro.app_schema', :'schema', false);

do $$
declare
  role_name text := current_setting('reqro.operator_role');
  app_schema text := current_setting('reqro.app_schema');
  approval regclass := format('%I.%I', app_schema,
    'tenant_domain_operator_approval')::regclass;
  offending text;
begin
  -- The approval table must never carry table-level UPDATE.
  if has_table_privilege(role_name, approval, 'UPDATE') then
    raise exception
      'refusing: % holds table-level UPDATE on %; only UPDATE (policy_version) is authorized',
      role_name, approval;
  end if;

  -- ...and no column other than policy_version may be updatable.
  select string_agg(a.attname, ', ' order by a.attname) into offending
  from pg_attribute a
  where a.attrelid = approval and a.attnum > 0 and not a.attisdropped
    and a.attname <> 'policy_version'
    and has_column_privilege(role_name, approval, a.attname, 'UPDATE');
  if offending is not null then
    raise exception
      'refusing: % holds UPDATE on approval columns beyond policy_version: %',
      role_name, offending;
  end if;

  -- The one authorized column exception must actually be in place, so a
  -- deployment cannot silently end up with a role that fails at `activate`.
  if not has_column_privilege(role_name, approval, 'policy_version', 'UPDATE')
  then
    raise exception
      'refusing: % lacks UPDATE (policy_version) on %, which activate and revoke require',
      role_name, approval;
  end if;

  -- No DELETE or TRUNCATE anywhere on the control-plane surface.
  select string_agg(format('%s:%s', c.relname, p.privilege), ', ')
    into offending
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join unnest(array['DELETE', 'TRUNCATE']) as p(privilege)
  where n.nspname = app_schema
    and c.relname in ('tenant_domain', 'tenant_domain_audit',
      'tenant_domain_operator_approval', 'tenant_domain_verification_attempt')
    and has_table_privilege(role_name, c.oid, p.privilege);
  if offending is not null then
    raise exception 'refusing: % holds destructive privileges: %',
      role_name, offending;
  end if;

  -- The Organization table stays entirely out of reach.
  select string_agg(p.privilege, ', ') into offending
  from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
    'REFERENCES', 'TRIGGER']) as p(privilege)
  where has_table_privilege(role_name,
    format('%I.%I', app_schema, 'organization')::regclass, p.privilege);
  if offending is not null then
    raise exception 'refusing: % holds Organization privileges: %',
      role_name, offending;
  end if;

  -- No CREATE anywhere, so no writable schema the search_path could reach.
  if has_schema_privilege(role_name, app_schema, 'CREATE')
    or has_database_privilege(role_name, current_database(), 'CREATE') then
    raise exception 'refusing: % holds CREATE on the schema or database',
      role_name;
  end if;

  -- Exactly one direct function grant. Asserted on ACL entries naming the
  -- role, not on effective privilege: every function carries a default
  -- EXECUTE for PUBLIC, so effective privilege would also report the
  -- trigger functions and say nothing about what this role was granted.
  select string_agg(p.oid::regprocedure::text, ', ' order by 1)
    into offending
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(p.proacl) a
  where n.nspname = app_schema
    and a.privilege_type = 'EXECUTE'
    and a.grantee = (select r.oid from pg_roles r where r.rolname = role_name)
    and p.proname <> 'tenant_domain_lock_organization';
  if offending is not null then
    raise exception 'refusing: % holds direct EXECUTE beyond the lock helper: %',
      role_name, offending;
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------
-- Deterministic object resolution (application side, already implemented)
-- ---------------------------------------------------------------------
--
-- A PostgreSQL role may always change its own stored `search_path` with
-- `ALTER ROLE ... SET search_path`. Measured: setting it to a value that
-- omits the application schema breaks the operator path's unqualified
-- reference to `tenant_domain_lock_organization(uuid)`. It is a
-- self-inflicted availability fault rather than an escalation -- the role
-- cannot redirect the call, because PostgreSQL never consults `pg_temp`
-- for function names and the role can create no other schema -- but
-- object resolution must not depend on a value the operator can edit.
--
-- The operator CLI therefore pins the schema on the connection at startup
-- from REQRO_DEPLOYMENT_SCHEMA, which is infrastructure owned exactly like
-- REQRO_DEPLOYMENT_ENVIRONMENT. There is no `--schema` flag and no
-- operator-supplied override. The value must be a plain lower-case
-- identifier; reserved namespaces (`pg_*`, `information_schema`) are
-- refused, and it defaults to `public`.
--
-- Deployment checklist:
--
--   REQRO_DEPLOYMENT_SCHEMA=public   # must equal :schema above
--
-- Proven end to end: with the role's stored default set to a hostile
-- `pg_temp`, a fresh pinned connection reports an effective `search_path`
-- equal to the deployment-owned schema, the unqualified helper resolves to
-- the owner-created SECURITY DEFINER function, and all seven verbs work --
-- while the same connection without the pin fails.
--
-- ---------------------------------------------------------------------
-- Recommended additional hardening (measured, not applied here)
-- ---------------------------------------------------------------------
--
-- Both are narrow, production-style revokes that were tested under the
-- constrained role with all seven verbs still passing. They are left out
-- of the transaction above because each is a database- or schema-wide
-- change affecting every role, which is a deployment decision rather than
-- part of this role.
--
--   revoke temporary on database <database> from public;
--   revoke create on schema <schema> from public;
--
-- Revoking TEMPORARY closes the only schema this role can write to: with
-- it revoked, the role can create neither a temporary table nor a
-- `pg_temp` function, so no competing same-signature helper can exist
-- anywhere, and the application's own unqualified relation names stop
-- being shadowable within the operator's session.
--
-- Explicitly NOT recommended and NOT performed:
--   revoke all on database ... from public;   -- would also remove CONNECT
--
-- ---------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------
--
--   select has_table_privilege('<operator>', '<schema>.organization', 'SELECT');
--     -- expected: false
--   select has_table_privilege('<operator>', '<schema>.tenant_domain', 'DELETE');
--     -- expected: false
--   select has_table_privilege('<operator>',
--     '<schema>.tenant_domain_operator_approval', 'UPDATE');
--     -- expected: false  (the column grant must not become table-level)
--   select has_column_privilege('<operator>',
--     '<schema>.tenant_domain_operator_approval', 'policy_version', 'UPDATE');
--     -- expected: true
--   select has_schema_privilege('<operator>', '<schema>', 'CREATE');
--     -- expected: false
--
-- The authoritative check is the integration suite, which proves the
-- whole model rather than individual flags:
--
--   cd server && npm run test:compile && node --test --test-concurrency=1 \
--     dist-test/test/database/tenant-domain-operator-role.integration.test.js
--
-- It requires Docker and skips without it. A skip is not a pass.
