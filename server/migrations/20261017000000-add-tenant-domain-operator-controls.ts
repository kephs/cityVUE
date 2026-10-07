import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

/** Ordinal 47. ADR-027 F060.3C-2a. Closes the controlled-provisioning
 * attribution gap for the tenant-domain registry and adds the independent
 * approval required before a hostname becomes publicly reachable or loses its
 * ownership evidence.
 *
 * Platform authority stays infrastructure-rooted. This migration stores
 * *attribution*, not platform authentication: there is no platform_operator
 * table, no permission key, no grant, no role and no identity that any tenant
 * grant path could write. An operator identity recorded here references an
 * infrastructure-issued principal and is never a tenant staff identity.
 *
 * Deliberately excluded: the production operator CLI, Organization status
 * transitions, refused-attempt evidence and any application-data access. Each
 * is a separate reviewed decision. */
export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    set local lock_timeout = '5s';
    lock table tenant_domain,tenant_domain_audit in access exclusive mode;

    -- Every row written before this migration carries a free-text operator
    -- reference and nothing more. Those rows are historical evidence: they
    -- stay version 1 exactly as recorded, keep their actor value, and are
    -- never rewritten or backfilled with an invented identity. Version 2
    -- becomes the only version a new row may use.
    alter table tenant_domain_audit
      add column attribution_version smallint not null default 1,
      add column operator_identity varchar(200),
      add column reason varchar(500),
      add column correlation_id uuid,
      add column outcome varchar(16),
      add column approval_id uuid,
      add constraint tenant_domain_audit_attribution_version check(attribution_version in (1,2)),
      -- A version is all or nothing: a legacy row carries no structured
      -- attribution, a current row carries all of it.
      add constraint tenant_domain_audit_attribution_complete check(
        (attribution_version=1 and operator_identity is null and reason is null
          and correlation_id is null and outcome is null and approval_id is null)
        or (attribution_version=2 and operator_identity is not null and reason is not null
          and correlation_id is not null and outcome is not null)),
      -- Independent approval is required for exactly the two operations that
      -- change what the public can reach, and is refused for every other
      -- action, so an approval can never be attached to a lesser operation.
      add constraint tenant_domain_audit_approval_scope check(
        attribution_version<>2
        or (approval_id is not null)=(action in ('activated','verification_revoked'))),
      -- An infrastructure-issued human identity. The scheme prefix is
      -- mandatory, so the value can never be a bare UUID and is never
      -- mistakable for a staff_identity; 'dev' marks synthetic development
      -- evidence as such instead of letting it look like production.
      add constraint tenant_domain_audit_operator_identity check(
        operator_identity is null
        or (operator_identity ~ '^(iam|oidc|dev):[A-Za-z0-9][A-Za-z0-9._@/+-]{1,180}$'
          -- A long unbroken alphanumeric run is what a secret looks like. An
          -- IAM path, an address or a UUID subject never contains one, so this
          -- refuses a token pasted into the attribution field.
          and operator_identity !~ '[A-Za-z0-9]{32,}')),
      add constraint tenant_domain_audit_reason check(
        reason is null
        or (length(btrim(reason)) between 12 and 500 and reason !~ '[[:cntrl:]]')),
      -- The retained legacy column cannot disagree with the structured
      -- identity on a current row, so the actor value stays trustworthy for
      -- every version and no row can carry a misleading free-text operator.
      add constraint tenant_domain_audit_actor_agrees check(
        attribution_version<>2 or actor=operator_identity),
      -- Only an applied mutation is representable here: the deferred audit
      -- constraint ties every row to committed binding state, so a refused
      -- operator attempt has no row to write. Recording refusals is a
      -- separate future decision, not a silently missing value.
      add constraint tenant_domain_audit_outcome check(outcome is null or outcome in ('applied'));
    alter table tenant_domain_audit alter column attribution_version set default 2;

    -- Immutable independent approval, bound to the exact pre-state the
    -- approver reviewed, so it cannot be replayed against another
    -- Organization, another binding, another operation or a binding that has
    -- moved since.
    create table tenant_domain_operator_approval (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      tenant_domain_id uuid not null,
      operation varchar(24) not null check(operation in ('activated','verification_revoked')),
      expected_revision integer not null check(expected_revision>0),
      expected_hostname varchar(239) not null,
      expected_role varchar(20) not null check(expected_role in ('public_canonical','public_alias','platform_fallback')),
      expected_verification_state varchar(12) not null check(expected_verification_state in ('unverified','pending','verified')),
      expected_active boolean not null,
      requested_by varchar(200) not null,
      approved_by varchar(200) not null,
      reason varchar(500) not null,
      correlation_id uuid not null,
      policy_version integer not null check(policy_version=1),
      approved_at timestamptz not null default clock_timestamp(),
      expires_at timestamptz not null,
      creation_txid bigint not null default txid_current(),
      unique(organization_id,id),
      unique(organization_id,tenant_domain_id,id),
      foreign key(organization_id,tenant_domain_id) references tenant_domain(organization_id,id),
      -- Separation of duties, enforced here and again when the approval is
      -- consumed. If infrastructure issues one shared identity to several
      -- humans this guarantee is void, so distinct per-human infrastructure
      -- identities are a production prerequisite, not a convention.
      check(requested_by<>approved_by),
      check(requested_by ~ '^(iam|oidc|dev):[A-Za-z0-9][A-Za-z0-9._@/+-]{1,180}$'
        and requested_by !~ '[A-Za-z0-9]{32,}'),
      check(approved_by ~ '^(iam|oidc|dev):[A-Za-z0-9][A-Za-z0-9._@/+-]{1,180}$'
        and approved_by !~ '[A-Za-z0-9]{32,}'),
      check(length(btrim(reason)) between 12 and 500 and reason !~ '[[:cntrl:]]'),
      -- The lifetime is fixed at insert from the server clock, so no caller
      -- can backdate the approval or widen its window.
      check(expires_at=approved_at+interval '24 hours'),
      -- An activation approval is only meaningful for a verified, inactive
      -- binding. A revocation approval is only meaningful for an inactive
      -- binding that still holds verification, which preserves the existing
      -- rule that an active hostname is deactivated before it is revoked.
      check((operation='activated' and expected_verification_state='verified' and not expected_active)
        or (operation='verification_revoked' and expected_verification_state<>'unverified' and not expected_active))
    );
    create index tenant_domain_approval_binding on tenant_domain_operator_approval(organization_id,tenant_domain_id,approved_at desc);

    -- The approval is reachable only through the same Organization and
    -- binding as the audit row that spends it, so cross-Organization and
    -- cross-binding reuse fail as referential integrity rather than as a
    -- check the application has to remember.
    alter table tenant_domain_audit
      add constraint tenant_domain_audit_approval
        foreign key(organization_id,tenant_domain_id,approval_id)
        references tenant_domain_operator_approval(organization_id,tenant_domain_id,id);
    -- Single use. Consumption evidence is the committed audit row itself
    -- rather than a mutable flag on the approval, which keeps the approval
    -- strictly immutable and makes double spending a unique-index violation:
    -- two concurrent mutations cannot both commit against one approval.
    create unique index tenant_domain_approval_single_use on tenant_domain_audit(approval_id) where approval_id is not null;

    create function tenant_domain_approval_live(approved timestamptz, expires timestamptz, instant timestamptz)
      returns boolean language sql immutable as $$
      select approved is not null and expires is not null and instant >= approved and instant < expires
    $$;
    create function tenant_domain_approval_consumed(approval uuid) returns boolean language sql stable as $$
      select exists(select 1 from tenant_domain_audit where approval_id=approval)
    $$;

    create function guard_tenant_domain_approval() returns trigger language plpgsql as $$
    declare binding tenant_domain; begin
      if TG_OP in ('UPDATE','DELETE','TRUNCATE') then
        raise exception 'Tenant domain operator approvals are immutable';
      end if;
      perform 1 from organization where id=NEW.organization_id and status='active' for share;
      if not found then raise exception 'Tenant domain approval requires an active Organization'; end if;
      select * into binding from tenant_domain
        where organization_id=NEW.organization_id and id=NEW.tenant_domain_id for share;
      if not found then raise exception 'Tenant domain approval requires its binding'; end if;
      -- The approver cannot describe a state the binding is not actually in,
      -- so a hand-written approval cannot fabricate its own context.
      if NEW.expected_hostname<>binding.hostname or NEW.expected_revision<>binding.revision
        or NEW.expected_role<>binding.role or NEW.expected_verification_state<>binding.verification_state
        or NEW.expected_active<>binding.active then
        raise exception 'Tenant domain approval must record the committed binding state';
      end if;
      NEW.approved_at=clock_timestamp();
      NEW.expires_at=NEW.approved_at+interval '24 hours';
      NEW.creation_txid=txid_current();
      return NEW;
    end $$;
    create trigger tenant_domain_approval_guard before insert or update or delete on tenant_domain_operator_approval
      for each row execute function guard_tenant_domain_approval();
    create trigger tenant_domain_approval_no_truncate before truncate on tenant_domain_operator_approval
      execute function guard_tenant_domain_approval();

    create or replace function guard_tenant_domain_audit() returns trigger language plpgsql as $$
    declare binding tenant_domain; approval tenant_domain_operator_approval; begin
      select * into binding from tenant_domain where organization_id=NEW.organization_id and id=NEW.tenant_domain_id;
      if not found then raise exception 'Tenant domain audit requires its binding'; end if;
      if NEW.hostname<>binding.hostname or NEW.revision<>binding.revision or NEW.role<>binding.role
        or NEW.verification_state<>binding.verification_state or NEW.active<>binding.active then
        raise exception 'Tenant domain audit must record the committed binding state';
      end if;
      -- Legacy attribution closed with this migration. A new row cannot claim
      -- version 1 and so cannot escape the structured requirements below.
      if NEW.attribution_version<>2 then
        raise exception 'Tenant domain audit requires current operator attribution';
      end if;
      if NEW.outcome is distinct from 'applied' then
        raise exception 'Tenant domain audit records applied mutations only';
      end if;
      if NEW.action in ('activated','verification_revoked') then
        select * into approval from tenant_domain_operator_approval
          where organization_id=NEW.organization_id and tenant_domain_id=NEW.tenant_domain_id
            and id=NEW.approval_id for share;
        if not found then raise exception 'Tenant domain operation requires an independent approval'; end if;
        if approval.operation<>NEW.action then
          raise exception 'Tenant domain approval authorizes a different operation';
        end if;
        if approval.expected_revision is distinct from NEW.prior_revision
          or approval.expected_hostname<>NEW.hostname
          or approval.expected_role is distinct from NEW.prior_role
          or approval.expected_verification_state is distinct from NEW.prior_verification_state
          or approval.expected_active is distinct from NEW.prior_active then
          raise exception 'Tenant domain approval does not match the mutation context';
        end if;
        -- Committed in an earlier transaction, so one operator cannot create
        -- and spend an approval atomically.
        if approval.creation_txid=txid_current() then
          raise exception 'Tenant domain approval must be independently committed';
        end if;
        if not tenant_domain_approval_live(approval.approved_at,approval.expires_at,clock_timestamp()) then
          raise exception 'Tenant domain approval has expired';
        end if;
        -- Separation of duties at the moment of use: the approver may not
        -- apply the change, and only the operator the approval names may.
        if approval.approved_by=NEW.operator_identity then
          raise exception 'Tenant domain approval cannot be self-approved';
        end if;
        if approval.requested_by<>NEW.operator_identity then
          raise exception 'Tenant domain approval names a different operator';
        end if;
      end if;
      NEW.occurred_at=clock_timestamp(); NEW.mutation_txid=txid_current(); return NEW;
    end $$;

    -- Structured attribution is now part of the audit invariant: a binding
    -- that changed without a matching *attributed* audit row fails at commit,
    -- so direct SQL cannot mutate the registry unattributed.
    create or replace function verify_tenant_domain_audited() returns trigger language plpgsql as $$ begin
      if not exists(select 1 from tenant_domain_audit a
        where a.organization_id=NEW.organization_id and a.tenant_domain_id=NEW.id
          and a.revision=NEW.revision and a.mutation_txid=txid_current()
          and a.attribution_version=2) then
        raise exception 'Tenant domain changes require matching attributed operator audit evidence';
      end if;
      return null;
    end $$;
  `.execute(db);
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    set local lock_timeout = '5s';
    lock table tenant_domain,tenant_domain_audit,tenant_domain_operator_approval in access exclusive mode;
    -- Legacy version 1 rows are preserved by rollback. Post-cutover evidence
    -- is not: structured attribution and approval records are never silently
    -- discarded or downgraded to legacy attribution.
    do $$ begin
      if exists(select 1 from tenant_domain_operator_approval)
        or exists(select 1 from tenant_domain_audit where attribution_version<>1) then
        raise exception 'Retained operator attribution or approval evidence prevents rollback';
      end if;
    end $$;
    create or replace function verify_tenant_domain_audited() returns trigger language plpgsql as $$ begin
      if not exists(select 1 from tenant_domain_audit a
        where a.organization_id=NEW.organization_id and a.tenant_domain_id=NEW.id
          and a.revision=NEW.revision and a.mutation_txid=txid_current()) then
        raise exception 'Tenant domain changes require matching operator audit evidence';
      end if;
      return null;
    end $$;
    create or replace function guard_tenant_domain_audit() returns trigger language plpgsql as $$
    declare binding tenant_domain; begin
      select * into binding from tenant_domain where organization_id=NEW.organization_id and id=NEW.tenant_domain_id;
      if not found then raise exception 'Tenant domain audit requires its binding'; end if;
      if NEW.hostname<>binding.hostname or NEW.revision<>binding.revision or NEW.role<>binding.role
        or NEW.verification_state<>binding.verification_state or NEW.active<>binding.active then
        raise exception 'Tenant domain audit must record the committed binding state';
      end if;
      NEW.occurred_at=clock_timestamp(); NEW.mutation_txid=txid_current(); return NEW;
    end $$;
    drop index tenant_domain_approval_single_use;
    alter table tenant_domain_audit drop constraint tenant_domain_audit_approval;
    drop table tenant_domain_operator_approval;
    drop function guard_tenant_domain_approval(),tenant_domain_approval_consumed(uuid),
      tenant_domain_approval_live(timestamptz,timestamptz,timestamptz);
    alter table tenant_domain_audit
      drop constraint tenant_domain_audit_outcome,
      drop constraint tenant_domain_audit_actor_agrees,
      drop constraint tenant_domain_audit_reason,
      drop constraint tenant_domain_audit_operator_identity,
      drop constraint tenant_domain_audit_approval_scope,
      drop constraint tenant_domain_audit_attribution_complete,
      drop constraint tenant_domain_audit_attribution_version,
      drop column approval_id,
      drop column outcome,
      drop column correlation_id,
      drop column reason,
      drop column operator_identity,
      drop column attribution_version;
  `.execute(db);
}
