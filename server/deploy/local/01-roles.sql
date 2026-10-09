-- =====================================================================
-- LOCAL DEVELOPMENT ONLY  --  NOT FOR PRODUCTION
-- Separated database role topology, ADR-027 F060.3C-2d
-- =====================================================================
--
-- !! NOT FOR PRODUCTION. THIS FILE CONTAINS PLACEHOLDER PASSWORDS. !!
--
-- It is referenced only by server/compose.yml, for local development. No
-- production artifact imports, includes or executes it, and the production
-- provisioning artifacts under deploy/database/ set no password at all.
--
-- Runs once, from the postgres entrypoint, on first initialization of an
-- empty data volume. It exists so a developer can work against the same
-- owner/migration/runtime separation the production design specifies,
-- instead of the single superuser the environment used to collapse into.
--
-- THE PASSWORDS HERE ARE DEVELOPMENT-ONLY PLACEHOLDERS, deliberately
-- obvious, and are the reason this file lives under deploy/local/ rather
-- than beside the production artifacts. Production provisioning uses
-- deploy/database/bootstrap-roles.sql, which sets no password at all and
-- expects secret management to inject them.
--
-- The bootstrap role (`cityvue`) remains a superuser and remains the
-- owner of the database the entrypoint created, so existing local tooling
-- that connects as it keeps working. What this adds is the three
-- application identities and the ownership transfer.

\set ON_ERROR_STOP on

-- reqro_owner owns the schema and every object migrations create. NOLOGIN:
-- it is reached only by SET ROLE from reqro_migrate, never by connecting.
create role reqro_owner
  nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;

-- reqro_migrate applies migrations. NOINHERIT is load bearing: it holds no
-- authority at all until it explicitly assumes reqro_owner, so a migration
-- that forgets to do so fails closed rather than creating objects owned by
-- the login.
create role reqro_migrate
  login password 'reqro_migrate_dev_only'
  nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
grant reqro_owner to reqro_migrate;

-- reqro_runtime is the application identity. It owns nothing and receives
-- its privileges from deploy/database/runtime-role.sql, after migrations.
create role reqro_runtime
  login password 'reqro_runtime_dev_only'
  nosuperuser nocreatedb nocreaterole noinherit nobypassrls;

-- reqro_operator is the tenant-domain control plane, unchanged from
-- F060.3C-2c-3. Privileges come from deploy/database/operator-role.sql.
create role reqro_operator
  login password 'reqro_operator_dev_only'
  nosuperuser nocreatedb nocreaterole noinherit nobypassrls;

-- Ownership moves to reqro_owner. On PostgreSQL 15+ schema `public` is owned
-- by `pg_database_owner`, so the database transfer carries the schema with
-- it; the explicit ALTER SCHEMA is kept so the intent is legible.
alter database cityvue owner to reqro_owner;
alter schema public owner to reqro_owner;

-- The same narrow PUBLIC posture the production bootstrap applies. CONNECT
-- is retained deliberately; REVOKE ALL ON DATABASE is never used.
revoke temporary on database cityvue from public;
revoke create on schema public from public;

-- Local usage, after `docker compose up`:
--
--   # apply migrations as the migration identity, which assumes the owner
--   MIGRATION_DATABASE_URL=postgresql://reqro_migrate:reqro_migrate_dev_only@localhost:5432/cityvue \
--     npm run migration:up
--
--   # then grant the runtime and operator surfaces, as the owner
--   psql "postgresql://reqro_migrate:reqro_migrate_dev_only@localhost:5432/cityvue" \
--     -v runtime=reqro_runtime -v schema=public \
--     -c 'set role reqro_owner' -f ../deploy/database/runtime-role.sql
--
--   # finally run the application as the runtime identity
--   DATABASE_URL=postgresql://reqro_runtime:reqro_runtime_dev_only@localhost:5432/cityvue \
--     npm run dev
--
-- The historical `cityvue` superuser still works for existing development
-- CLIs and for the disposable test database, so nothing a developer relies
-- on today stops working.
