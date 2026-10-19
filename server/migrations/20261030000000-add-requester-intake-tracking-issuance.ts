import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

/**
 * F065: requester-intake tracking issuance and credential expiry.
 *
 * ADR-009 (amended) authorizes automatic issuance inside the successful PUBLIC
 * request-creation transaction. Two structural facts drive this migration.
 *
 * First, a resident has no `staff_identity` row, so `created_by_staff_identity_id`
 * could not previously hold a resident author. Rather than fabricate a staff
 * identity, the column becomes nullable and an explicit `issuer_type`
 * discriminator records who issued the credential. A CHECK keeps the two
 * combinations exact, so a staff row can never lose its author and a
 * requester-intake row can never gain a borrowed one.
 *
 * Second, expiry is stored as an absolute timestamp and evaluated as a
 * predicate -- never as a status. Keeping `status` to ('active','revoked')
 * leaves the active-to-revoked immutability rule and the one-active-credential
 * partial unique index untouched, and means no background expiry job exists.
 *
 * The existing row-immutability trigger needs no change: it compares whole
 * `to_jsonb` rows minus status and revoked_at, so both new columns become
 * immutable automatically.
 */
export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    set local lock_timeout = '5s';
    lock table organization, request_tracking_credential in access exclusive mode;
    -- Adding a not-null column with a constant default is metadata-only on
    -- PostgreSQL 11+, so existing rows are not rewritten. Every pre-F065 row
    -- was staff-issued, which is exactly what the default records.
    alter table request_tracking_credential
      alter column created_by_staff_identity_id drop not null,
      add column issuer_type text not null default 'staff'
        check (issuer_type in ('staff','requester_intake')),
      add column expires_at timestamptz;
    alter table request_tracking_credential
      add constraint request_tracking_issuer_attribution check (
        (issuer_type = 'staff' and created_by_staff_identity_id is not null)
        or (issuer_type = 'requester_intake' and created_by_staff_identity_id is null)),
      -- clock_timestamp() advances within a transaction, so a credential
      -- issued now is strictly later than its own creation stamp.
      add constraint request_tracking_expiry_after_issue check (
        expires_at is null or expires_at > created_at);
    -- The default existed only to classify existing rows. Dropping it forces
    -- every future insert to state its issuer explicitly.
    alter table request_tracking_credential alter column issuer_type drop default;
    -- Tenant lifetime policy. The CHECK is the platform bound, so no tenant
    -- value can exceed it even by direct SQL.
    create table request_tracking_policy (
      organization_id uuid primary key references organization(id),
      credential_lifetime_days integer not null default 180
        check (credential_lifetime_days between 30 and 365),
      revision integer not null default 1 check (revision > 0),
      updated_at timestamptz not null default clock_timestamp()
    );
    insert into request_tracking_policy(organization_id) select id from organization;
    -- A backfill alone would leave future tenants without a policy, so new
    -- Organizations are initialized by trigger, as branding and resident
    -- experience already are.
    create function initialize_request_tracking_policy() returns trigger language plpgsql as $$
    begin
      insert into request_tracking_policy(organization_id) values (NEW.id);
      return NEW;
    end $$;
    create trigger request_tracking_policy_default after insert on organization
      for each row execute function initialize_request_tracking_policy();
  `.execute(db);
}

/**
 * Fail-closed. Dropping these columns would silently convert resident-issued,
 * expiring credentials into staff-attributed, non-expiring ones -- an
 * attribution forgery and a lifetime extension performed by a rollback. The
 * guard refuses instead, and never deletes a credential to make itself pass.
 */
export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    lock table organization, request_tracking_credential, request_tracking_policy
      in access exclusive mode;
    do $$ begin
      if exists(select 1 from request_tracking_credential where issuer_type = 'requester_intake')
        or exists(select 1 from request_tracking_credential where expires_at is not null)
      then raise exception 'Requester-issued or expiring tracking credentials prevent rollback'; end if;
      -- Restoring NOT NULL is only safe once no unattributed row remains.
      if exists(select 1 from request_tracking_credential where created_by_staff_identity_id is null)
      then raise exception 'Unattributed tracking credentials prevent rollback'; end if;
      if exists(select 1 from request_tracking_policy where credential_lifetime_days <> 180 or revision <> 1)
      then raise exception 'Configured tracking lifetime policy prevents rollback'; end if;
    end $$;
    drop trigger request_tracking_policy_default on organization;
    drop function initialize_request_tracking_policy();
    drop table request_tracking_policy;
    alter table request_tracking_credential
      drop constraint request_tracking_issuer_attribution,
      drop constraint request_tracking_expiry_after_issue,
      drop column issuer_type,
      drop column expires_at,
      alter column created_by_staff_identity_id set not null;
  `.execute(db);
}
