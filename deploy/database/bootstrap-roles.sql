-- =====================================================================
-- Reqro / CityVUE -- database role topology bootstrap
-- ADR-027, F060.3C-2d
-- =====================================================================
--
-- PRODUCTION USE REMAINS UNAUTHORIZED. This file is reviewed
-- configuration, not a provisioning action. Nothing here has been run
-- against any client, staging or production infrastructure.
--
-- ---------------------------------------------------------------------
-- What this establishes
-- ---------------------------------------------------------------------
--
-- Four separate identities, replacing the single superuser that the
-- reproducible environment collapsed owner, migration and runtime into:
--
--   reqro_owner     NOLOGIN. Owns the database, the schema and every
--                   application object. Never connects.
--   reqro_migrate   LOGIN. Member of reqro_owner, with NOINHERIT, so it
--                   holds no authority until it explicitly SET ROLEs.
--                   Applies migrations.
--   reqro_runtime   LOGIN. Owns nothing. DML and approved function
--                   EXECUTE only; see runtime-role.sql.
--   reqro_operator  LOGIN. Unchanged from F060.3C-2c-3; see
--                   operator-role.sql. This file does not widen it.
--
-- Measured on PostgreSQL 17.11, which is the version server/compose.yml
-- pins:
--
--   * A NOLOGIN owner cannot connect: "role is not permitted to log in".
--   * A member can SET ROLE into it, and current_user becomes the owner
--     while session_user remains the login, so the audit trail survives.
--   * Objects created after SET ROLE belong to the owner, giving every
--     deployment identical ownership regardless of which credential ran
--     the migration.
--   * With NOINHERIT, the migration login WITHOUT SET ROLE is denied
--     ("permission denied for schema public"). That fail-closed default
--     is the main reason this shape was chosen over granting the login
--     direct ownership.
--   * On a fresh PostgreSQL 17 database, schema `public` is owned by
--     `pg_database_owner` and PUBLIC holds only USAGE, so reassigning
--     database ownership carries the schema with it.
--
-- ---------------------------------------------------------------------
-- Scope, and what this file deliberately does NOT do
-- ---------------------------------------------------------------------
--
-- Run as the provisioning/bootstrap administrator -- the cluster
-- superuser or a role with CREATEROLE and database ownership. This is
-- the only artifact in the repository that creates roles.
--
-- NO PASSWORD APPEARS HERE, and none is set. Login secrets belong to
-- infrastructure and secret management; this file creates the identities
-- and their attributes only. A LOGIN role with no password cannot
-- authenticate under md5/scram, which is the intended fail-closed state
-- until a secret is injected.
--
-- It does not grant table or function privileges to the runtime -- that
-- is runtime-role.sql -- and it does not alter the operator's reviewed
-- privilege definition.
--
-- Identifiers are psql variables so no deployment name is hard-coded:
--
--   psql -v owner=reqro_owner -v migrate=reqro_migrate \
--        -v runtime=reqro_runtime -v operator=reqro_operator \
--        -v schema=public -v db=reqro_production \
--        -f deploy/database/bootstrap-roles.sql
--
-- Repeatable: every step is guarded, so a second run is a no-op rather
-- than an error. Fail-closed: the final block refuses the transaction if
-- the topology it just established is not exactly what was intended.

\set ON_ERROR_STOP on

begin;

-- psql does not interpolate variables inside dollar-quoted text, so the
-- names are handed to the blocks below through session settings.
select set_config('reqro.owner_role', :'owner', false);
select set_config('reqro.migrate_role', :'migrate', false);
select set_config('reqro.runtime_role', :'runtime', false);
select set_config('reqro.operator_role', :'operator', false);
select set_config('reqro.app_schema', :'schema', false);

-- ---------------------------------------------------------------------
-- The four identities
-- ---------------------------------------------------------------------
-- Attributes are stated explicitly rather than relying on defaults, and
-- re-stated on an existing role so a drifted attribute is corrected.
-- NOINHERIT on reqro_migrate is load bearing: it is what makes the
-- owner's authority unavailable until SET ROLE is issued.

do $$
declare
  owner_role text := current_setting('reqro.owner_role');
  migrate_role text := current_setting('reqro.migrate_role');
  runtime_role text := current_setting('reqro.runtime_role');
  operator_role text := current_setting('reqro.operator_role');
begin
  if not exists (select 1 from pg_roles where rolname = owner_role) then
    execute format(
      'create role %I nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls',
      owner_role);
  else
    execute format(
      'alter role %I nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls',
      owner_role);
  end if;

  if not exists (select 1 from pg_roles where rolname = migrate_role) then
    execute format(
      'create role %I login nosuperuser nocreatedb nocreaterole noinherit nobypassrls',
      migrate_role);
  else
    execute format(
      'alter role %I login nosuperuser nocreatedb nocreaterole noinherit nobypassrls',
      migrate_role);
  end if;

  if not exists (select 1 from pg_roles where rolname = runtime_role) then
    execute format(
      'create role %I login nosuperuser nocreatedb nocreaterole noinherit nobypassrls',
      runtime_role);
  else
    execute format(
      'alter role %I login nosuperuser nocreatedb nocreaterole noinherit nobypassrls',
      runtime_role);
  end if;

  -- The operator role is created here only so the topology is complete in
  -- one place. Its PRIVILEGES remain entirely owned by operator-role.sql,
  -- which this file does not touch.
  if not exists (select 1 from pg_roles where rolname = operator_role) then
    execute format(
      'create role %I login nosuperuser nocreatedb nocreaterole noinherit nobypassrls',
      operator_role);
  else
    execute format(
      'alter role %I login nosuperuser nocreatedb nocreaterole noinherit nobypassrls',
      operator_role);
  end if;

  -- Only the migration login may become the owner. Neither the runtime nor
  -- the operator is a member of anything.
  execute format('grant %I to %I', owner_role, migrate_role);
end $$;

-- ---------------------------------------------------------------------
-- Ownership
-- ---------------------------------------------------------------------
-- The database carries schema `public` with it on PostgreSQL 15+, because
-- that schema is owned by `pg_database_owner`. The explicit ALTER SCHEMA
-- is kept anyway so the intent is legible and so a database created under
-- older conventions is corrected.
alter database :"db" owner to :"owner";
alter schema :"schema" owner to :"owner";

-- ---------------------------------------------------------------------
-- PUBLIC posture
-- ---------------------------------------------------------------------
-- CONNECT is deliberately retained: revoking it would lock out every role
-- that has not been granted it explicitly. `REVOKE ALL ON DATABASE` is
-- therefore not used anywhere.
--
-- TEMPORARY is revoked. F060.3C-2c-3 measured that `pg_temp` is the only
-- schema a constrained role can write to, and that the operator path needs
-- no temporary object; the runtime needs none either. Removing it closes
-- that surface at no functional cost.
revoke temporary on database :"db" from public;

-- PostgreSQL 15 removed PUBLIC's CREATE on `public`, so this is normally a
-- no-op. It is issued anyway so a database created under an older
-- convention, or one where CREATE was granted deliberately, is corrected.
revoke create on schema :"schema" from public;

-- EXECUTE is NOT revoked globally from every function. Exactly one
-- SECURITY DEFINER function predates this slice (the operator's
-- Organization lock helper) and Migration 48 already revoked PUBLIC from
-- it; Migration 49's ten functions manage their own PUBLIC posture the
-- same way. Every other function is SECURITY INVOKER, so PUBLIC EXECUTE
-- confers no authority beyond the caller's own privileges, and revoking
-- across ~90 functions would be high-risk churn for no measurable gain.

-- ---------------------------------------------------------------------
-- Default privileges
-- ---------------------------------------------------------------------
-- Deliberately NONE. No ALTER DEFAULT PRIVILEGES is issued for any role.
--
-- A blanket default would hand the runtime access to every future table,
-- including future operator control-plane tables, and would silently widen
-- the surface each time a migration adds one. Explicit per-table grant
-- maintenance in runtime-role.sql is the accepted cost: a new table is
-- unreachable until someone grants it deliberately, which is the same
-- future-object isolation F060.3C-2c-3 established for the operator.

-- ---------------------------------------------------------------------
-- Fail closed: refuse a topology that is not what was intended
-- ---------------------------------------------------------------------
do $$
declare
  owner_role text := current_setting('reqro.owner_role');
  migrate_role text := current_setting('reqro.migrate_role');
  runtime_role text := current_setting('reqro.runtime_role');
  operator_role text := current_setting('reqro.operator_role');
  app_schema text := current_setting('reqro.app_schema');
  offending text;
begin
  -- The owner must not be able to log in, or the NOLOGIN guarantee is void.
  if (select rolcanlogin from pg_roles where rolname = owner_role) then
    raise exception 'refusing: % must be NOLOGIN', owner_role;
  end if;

  -- No role in this topology may be a superuser, create roles or databases,
  -- bypass RLS, or inherit silently.
  select string_agg(rolname, ', ' order by rolname) into offending
  from pg_roles
  where rolname in (owner_role, migrate_role, runtime_role, operator_role)
    and (rolsuper or rolcreatedb or rolcreaterole or rolbypassrls or rolinherit);
  if offending is not null then
    raise exception 'refusing: over-privileged or inheriting roles: %', offending;
  end if;

  -- Exactly one membership exists: migrate -> owner.
  select string_agg(format('%s->%s',
      (select rolname from pg_roles r where r.oid = m.member),
      (select rolname from pg_roles r where r.oid = m.roleid)), ', ')
    into offending
  from pg_auth_members m
  where (select rolname from pg_roles r where r.oid = m.member)
          in (owner_role, migrate_role, runtime_role, operator_role)
    and not ((select rolname from pg_roles r where r.oid = m.member) = migrate_role
         and (select rolname from pg_roles r where r.oid = m.roleid) = owner_role);
  if offending is not null then
    raise exception 'refusing: unexpected role memberships: %', offending;
  end if;

  if not exists (
    select 1 from pg_auth_members m
    where (select rolname from pg_roles r where r.oid = m.member) = migrate_role
      and (select rolname from pg_roles r where r.oid = m.roleid) = owner_role)
  then
    raise exception 'refusing: % is not a member of %', migrate_role, owner_role;
  end if;

  -- The runtime and the operator must own nothing.
  select string_agg(format('%s owns %s', pg_get_userbyid(c.relowner), c.relname), ', ')
    into offending
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = app_schema and c.relkind in ('r','p','v','m','f','S')
    and pg_get_userbyid(c.relowner) in (runtime_role, operator_role, migrate_role);
  if offending is not null then
    raise exception 'refusing: non-owner roles own objects: %', offending;
  end if;

  -- No role here may hold CREATE on the schema or the database.
  select string_agg(rolname, ', ' order by rolname) into offending
  from pg_roles
  where rolname in (migrate_role, runtime_role, operator_role)
    and (has_schema_privilege(rolname, app_schema, 'CREATE')
      or has_database_privilege(rolname, current_database(), 'CREATE'));
  if offending is not null then
    raise exception
      'refusing: % holds CREATE; only the owner role may create objects', offending;
  end if;

  -- PUBLIC posture.
  if has_database_privilege('public', current_database(), 'TEMPORARY') then
    raise exception 'refusing: PUBLIC still holds TEMPORARY on the database';
  end if;
  if has_schema_privilege('public', app_schema, 'CREATE') then
    raise exception 'refusing: PUBLIC still holds CREATE on %', app_schema;
  end if;
  if not has_database_privilege('public', current_database(), 'CONNECT') then
    raise exception 'refusing: PUBLIC lost CONNECT; this file must not revoke it';
  end if;

  -- No default privileges may exist for any role in this topology.
  select string_agg(pg_get_userbyid(defaclrole), ', ') into offending
  from pg_default_acl
  where pg_get_userbyid(defaclrole)
          in (owner_role, migrate_role, runtime_role, operator_role);
  if offending is not null then
    raise exception
      'refusing: default privileges exist for %; explicit per-table grants are required',
      offending;
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------
-- Provisioning order
-- ---------------------------------------------------------------------
--
--   1. create the database (infrastructure)
--   2. this file, as the bootstrap administrator
--   3. inject login secrets for reqro_migrate, reqro_runtime and
--      reqro_operator from secret management -- never from source
--   4. migrations, as reqro_migrate, which SET ROLEs to reqro_owner:
--        MIGRATION_DATABASE_URL=... npm run migration:up
--   5. deploy/database/runtime-role.sql, as reqro_owner
--   6. deploy/database/operator-role.sql, as reqro_owner
--   7. start the application with DATABASE_URL pointing at reqro_runtime
--
-- Steps 5 and 6 must follow step 4, because they grant privileges on
-- objects the migrations create.
--
-- ---------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------
--
--   select rolname, rolcanlogin, rolsuper, rolinherit, rolcreaterole
--     from pg_roles where rolname like 'reqro\_%' order by rolname;
--     -- expected: owner NOLOGIN; all four nosuper/noinherit/nocreaterole
--
--   select has_database_privilege('reqro_runtime', current_database(), 'TEMPORARY');
--     -- expected: false
--
-- The authoritative check is the integration suite, which proves the whole
-- topology rather than individual flags:
--
--   cd server && npm run test:compile && node --test --test-concurrency=1 \
--     dist-test/test/database/database-role-separation.integration.test.js
--
-- It requires Docker and skips without it. A skip is not a pass.
