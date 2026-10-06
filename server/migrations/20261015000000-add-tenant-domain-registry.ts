import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

/** Ordinal 45. ADR-025 Slice 1a. Registry structure only: no routes, no
 * permission keys, no grants, no default or seeded hostname, and no change to
 * any existing table. The resolver that reads these tables is not wired to
 * HTTP, and bootstrap.ts still refuses to serve under the registry strategy. */
export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    set local lock_timeout = '5s';
    lock table organization in share row exclusive mode;

    create table tenant_domain (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references organization(id),
      -- Global and unconditional: one hostname, exactly one Organization.
      hostname varchar(253) not null unique,
      role varchar(20) not null check(role in ('public_canonical','public_alias','platform_fallback')),
      verification_state varchar(12) not null default 'unverified' check(verification_state in ('unverified','pending','verified')),
      active boolean not null default false,
      verification_method varchar(12) check(verification_method in ('dns_txt')),
      verification_challenge varchar(128),
      verification_requested_at timestamptz,
      verified_at timestamptz,
      verification_evidence jsonb,
      revision integer not null default 1 check(revision>0),
      created_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp(),
      unique(organization_id,id),
      -- Only the normalizer's canonical output is storable. A wildcard, port,
      -- trailing dot, underscore, uppercase letter, empty label, oversized
      -- label or comma-joined value cannot be written at all, so exact
      -- equality in the resolver is exact equality over canonical names.
      check(hostname=lower(hostname)),
      check(length(hostname) between 1 and 253),
      check(hostname ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$'),
      -- An IP literal cannot hold DNS ownership evidence, so it is not a name.
      check(hostname !~ '(^|[.])[0-9]+$'),
      -- Unverified and inactive bindings can never resolve.
      check(not active or verification_state='verified'),
      check((verification_state='verified')=(verified_at is not null)),
      check(verification_state<>'unverified' or (verification_method is null and verification_challenge is null
        and verification_requested_at is null and verification_evidence is null)),
      check(verification_state<>'pending' or (verification_method is not null and verification_challenge is not null
        and verification_requested_at is not null and verification_evidence is null)),
      check(verification_state<>'verified' or (verification_method is not null and verification_challenge is not null
        and verification_requested_at is not null and verification_evidence is not null))
    );
    -- At most one public canonical resident-facing address per Organization.
    create unique index tenant_domain_canonical on tenant_domain(organization_id) where role='public_canonical';
    create index tenant_domain_organization on tenant_domain(organization_id,hostname);

    create table tenant_domain_audit (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      tenant_domain_id uuid not null,
      hostname varchar(253) not null,
      action varchar(24) not null check(action in ('registered','verification_requested','verified','verification_revoked','activated','deactivated','role_changed')),
      actor varchar(200) not null check(length(btrim(actor))>0),
      prior_revision integer check(prior_revision>0),
      revision integer not null check(revision>0),
      prior_role varchar(20),
      role varchar(20) not null,
      prior_verification_state varchar(12),
      verification_state varchar(12) not null,
      prior_active boolean,
      active boolean not null,
      evidence jsonb,
      occurred_at timestamptz not null default clock_timestamp(),
      mutation_txid bigint not null default txid_current(),
      unique(tenant_domain_id,revision),
      foreign key(organization_id,tenant_domain_id) references tenant_domain(organization_id,id),
      check((action='registered' and revision=1 and prior_revision is null and prior_role is null
          and prior_verification_state is null and prior_active is null
          and verification_state='unverified' and not active)
        or (action<>'registered' and prior_revision is not null and revision=prior_revision+1
          and prior_role is not null and prior_verification_state is not null and prior_active is not null))
    );

    create function guard_tenant_domain() returns trigger language plpgsql as $$ begin
      -- Bindings are deactivated, never removed: audit evidence outlives them.
      if TG_OP in ('DELETE','TRUNCATE') then raise exception 'Tenant domain bindings are deactivated, never deleted'; end if;
      perform 1 from organization where id=NEW.organization_id for share;
      if not found then raise exception 'Tenant domain requires an existing Organization'; end if;
      if TG_OP='INSERT' then
        if NEW.revision<>1 or NEW.verification_state<>'unverified' or NEW.active
          or NEW.verification_method is not null or NEW.verification_challenge is not null
          or NEW.verification_requested_at is not null or NEW.verified_at is not null
          or NEW.verification_evidence is not null then
          raise exception 'Tenant domain must start unverified and inactive';
        end if;
        NEW.created_at=clock_timestamp(); NEW.updated_at=NEW.created_at; return NEW;
      end if;
      if NEW.id<>OLD.id or NEW.organization_id<>OLD.organization_id
        or NEW.hostname<>OLD.hostname or NEW.created_at<>OLD.created_at then
        raise exception 'Tenant domain identity and hostname are immutable';
      end if;
      if NEW.revision<>OLD.revision+1 then raise exception 'Tenant domain revision must advance exactly once'; end if;
      if NEW.verification_state is distinct from OLD.verification_state then
        if OLD.verification_state='unverified' and NEW.verification_state='pending' then
          if NEW.verification_method is distinct from 'dns_txt' or NEW.verification_challenge is null
            or NEW.verification_requested_at is null then
            raise exception 'Tenant domain verification requires an issued ownership challenge';
          end if;
        elsif OLD.verification_state='pending' and NEW.verification_state='verified' then
          -- Verification only ever records ownership evidence observed against
          -- the challenge already issued for this binding. No path marks a
          -- hostname verified because an operator asserted ownership.
          if NEW.verification_method is distinct from OLD.verification_method
            or NEW.verification_challenge is distinct from OLD.verification_challenge
            or NEW.verification_requested_at is distinct from OLD.verification_requested_at
            or NEW.verification_evidence is null or NEW.verified_at is null then
            raise exception 'Tenant domain verification requires recorded ownership evidence';
          end if;
        elsif NEW.verification_state='unverified' then
          if NEW.active then raise exception 'An active tenant domain cannot lose verification'; end if;
        else
          raise exception 'Unsupported tenant domain verification transition';
        end if;
      elsif NEW.verification_state='verified'
        and (NEW.verified_at<>OLD.verified_at
          or NEW.verification_method is distinct from OLD.verification_method
          or NEW.verification_challenge is distinct from OLD.verification_challenge
          or NEW.verification_evidence is distinct from OLD.verification_evidence) then
        raise exception 'Tenant domain verification evidence is immutable';
      end if;
      if NEW.active and NEW.verification_state<>'verified' then
        raise exception 'Only a verified tenant domain can be activated';
      end if;
      NEW.updated_at=clock_timestamp(); return NEW;
    end $$;
    create trigger tenant_domain_guard before insert or update or delete on tenant_domain for each row execute function guard_tenant_domain();
    create trigger tenant_domain_no_truncate before truncate on tenant_domain execute function guard_tenant_domain();

    -- Operator evidence is mandatory, not best effort: a binding that changed
    -- without a matching audit row fails the transaction at commit.
    create function verify_tenant_domain_audited() returns trigger language plpgsql as $$ begin
      if not exists(select 1 from tenant_domain_audit a
        where a.organization_id=NEW.organization_id and a.tenant_domain_id=NEW.id
          and a.revision=NEW.revision and a.mutation_txid=txid_current()) then
        raise exception 'Tenant domain changes require matching operator audit evidence';
      end if;
      return null;
    end $$;
    create constraint trigger tenant_domain_audited after insert or update on tenant_domain
      deferrable initially deferred for each row execute function verify_tenant_domain_audited();

    create function guard_tenant_domain_audit() returns trigger language plpgsql as $$
    declare binding tenant_domain; begin
      select * into binding from tenant_domain where organization_id=NEW.organization_id and id=NEW.tenant_domain_id;
      if not found then raise exception 'Tenant domain audit requires its binding'; end if;
      if NEW.hostname<>binding.hostname or NEW.revision<>binding.revision or NEW.role<>binding.role
        or NEW.verification_state<>binding.verification_state or NEW.active<>binding.active then
        raise exception 'Tenant domain audit must record the committed binding state';
      end if;
      NEW.occurred_at=clock_timestamp(); NEW.mutation_txid=txid_current(); return NEW;
    end $$;
    create trigger tenant_domain_audit_guard before insert on tenant_domain_audit for each row execute function guard_tenant_domain_audit();
    create function protect_tenant_domain_audit() returns trigger language plpgsql as $$ begin
      raise exception 'Tenant domain audit is append-only'; end $$;
    create trigger tenant_domain_audit_immutable before update or delete on tenant_domain_audit for each row execute function protect_tenant_domain_audit();
    create trigger tenant_domain_audit_no_truncate before truncate on tenant_domain_audit execute function protect_tenant_domain_audit();
  `.execute(db);
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    set local lock_timeout = '5s';
    lock table tenant_domain,tenant_domain_audit in access exclusive mode;
    do $$ begin
      if exists(select 1 from tenant_domain_audit)
        or exists(select 1 from tenant_domain where active or verification_state<>'unverified') then
        raise exception 'Retained tenant domain evidence prevents rollback';
      end if;
    end $$;
    drop table tenant_domain_audit;
    drop table tenant_domain;
    drop function protect_tenant_domain_audit(),guard_tenant_domain_audit(),verify_tenant_domain_audited(),guard_tenant_domain();
  `.execute(db);
}
