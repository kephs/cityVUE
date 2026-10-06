import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

/** Ordinal 46. ADR-025 Slice 1b-A. Adds the DNS ownership-verification
 * challenge window and append-only attempt evidence. No routes, no permission
 * keys, no grants, no seeded hostname, and no change to request routing: the
 * resolver stays unwired and bootstrap.ts still refuses the registry strategy.
 *
 * Deliberately excluded: platform_delegation, scheduled re-verification
 * fields with no executor, automatic grace-period deactivation and hostname
 * release/reassignment. Each is a separate future decision. */
export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    set local lock_timeout = '5s';
    lock table tenant_domain in access exclusive mode;
    do $$ begin
      -- '_reqro-verify.' costs 14 of DNS's 253 octets, so a longer hostname
      -- could be registered but never verified. Refuse rather than strand it.
      if exists(select 1 from tenant_domain where length(hostname)>239) then
        raise exception 'Hostname exceeds the verifiable length limit';
      end if;
    end $$;

    alter table tenant_domain
      add column verification_expires_at timestamptz,
      add column verification_token_id uuid,
      add constraint tenant_domain_hostname_verifiable check(length(hostname)<=239),
      -- A challenge window exists exactly while a challenge does.
      add constraint tenant_domain_challenge_window check(
        (verification_state='unverified' and verification_expires_at is null and verification_token_id is null)
        or (verification_state in ('pending','verified') and verification_expires_at is not null and verification_token_id is not null)),
      -- Expiry is anchored to the database-assigned request instant and is
      -- bounded by the approved hard maximum, so no caller can widen it.
      add constraint tenant_domain_challenge_bounds check(
        verification_expires_at is null
        or (verification_requested_at is not null
          and verification_expires_at > verification_requested_at
          and verification_expires_at <= verification_requested_at + interval '30 days'));

    create function tenant_domain_challenge_live(requested timestamptz, expires timestamptz, instant timestamptz)
      returns boolean language sql immutable as $$
      select requested is not null and expires is not null and instant >= requested and instant < expires
    $$;

    -- Every attempt is recorded, including failures that change no state.
    -- tenant_domain_audit cannot hold these: it is keyed by binding revision
    -- and must mirror committed state, so a failed attempt has nowhere to go.
    create table tenant_domain_verification_attempt (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      tenant_domain_id uuid not null,
      hostname varchar(239) not null,
      record_name varchar(253) not null,
      token_id uuid not null,
      binding_revision integer not null check(binding_revision>0),
      expected_challenge_hash char(64) not null check(expected_challenge_hash ~ '^[0-9a-f]{64}$'),
      observed_value_hash char(64) check(observed_value_hash ~ '^[0-9a-f]{64}$'),
      observed_value_count integer not null check(observed_value_count>=0),
      result varchar(24) not null check(result in ('verified','no_record','value_mismatch','challenge_expired',
        'disagreement','insufficient_quorum','unreachable','timeout','nxdomain','servfail','zone_undetermined')),
      resolver_mode varchar(16) not null check(resolver_mode in ('authoritative')),
      name_servers text[] not null check(cardinality(name_servers) between 0 and 32),
      agreement_count integer not null check(agreement_count>=0),
      degraded_single_ns boolean not null default false,
      ttl_seconds integer check(ttl_seconds>=0),
      -- Only accurately observable metadata. Node's standard resolver cannot
      -- perform cryptographic DNSSEC validation, so validated is always false
      -- in this slice and no control may depend on it.
      dnssec jsonb not null,
      actor varchar(200) not null check(length(btrim(actor))>0),
      correlation_id uuid not null,
      policy_version integer not null check(policy_version=1),
      observed_at timestamptz not null default clock_timestamp(),
      mutation_txid bigint not null default txid_current(),
      foreign key(organization_id,tenant_domain_id) references tenant_domain(organization_id,id),
      check((result='verified')=(observed_value_hash is not null)),
      check(observed_value_hash is null or observed_value_count>0),
      check(result<>'verified' or agreement_count>=1),
      check(not degraded_single_ns or agreement_count<=1),
      check((dnssec->>'validated')='false')
    );
    create index tenant_domain_attempt_history on tenant_domain_verification_attempt(organization_id,tenant_domain_id,observed_at desc);

    create function guard_tenant_domain_attempt() returns trigger language plpgsql as $$
    declare binding tenant_domain; begin
      select * into binding from tenant_domain where organization_id=NEW.organization_id and id=NEW.tenant_domain_id;
      if not found then raise exception 'Verification attempt requires its binding'; end if;
      if NEW.hostname<>binding.hostname or NEW.binding_revision<>binding.revision
        or NEW.token_id is distinct from binding.verification_token_id then
        raise exception 'Verification attempt must record the committed binding state';
      end if;
      -- The queried name is derived from the stored hostname and nothing else.
      if NEW.record_name<>'_reqro-verify.'||binding.hostname then
        raise exception 'Verification attempt record name is not derived from the hostname';
      end if;
      NEW.observed_at=clock_timestamp(); NEW.mutation_txid=txid_current(); return NEW;
    end $$;
    create trigger tenant_domain_attempt_guard before insert on tenant_domain_verification_attempt
      for each row execute function guard_tenant_domain_attempt();
    create function protect_tenant_domain_attempt() returns trigger language plpgsql as $$ begin
      raise exception 'Tenant domain verification attempts are append-only'; end $$;
    create trigger tenant_domain_attempt_immutable before update or delete on tenant_domain_verification_attempt
      for each row execute function protect_tenant_domain_attempt();
    create trigger tenant_domain_attempt_no_truncate before truncate on tenant_domain_verification_attempt
      execute function protect_tenant_domain_attempt();

    create or replace function guard_tenant_domain() returns trigger language plpgsql as $$ begin
      if TG_OP in ('DELETE','TRUNCATE') then raise exception 'Tenant domain bindings are deactivated, never deleted'; end if;
      perform 1 from organization where id=NEW.organization_id for share;
      if not found then raise exception 'Tenant domain requires an existing Organization'; end if;
      if TG_OP='INSERT' then
        if NEW.revision<>1 or NEW.verification_state<>'unverified' or NEW.active
          or NEW.verification_method is not null or NEW.verification_challenge is not null
          or NEW.verification_requested_at is not null or NEW.verified_at is not null
          or NEW.verification_evidence is not null or NEW.verification_expires_at is not null
          or NEW.verification_token_id is not null then
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
            or NEW.verification_token_id is null or NEW.verification_expires_at is null then
            raise exception 'Tenant domain verification requires an issued ownership challenge';
          end if;
          -- The request instant is database assigned, so the window cannot be
          -- backdated and its bounds are measured against the server clock.
          NEW.verification_requested_at=clock_timestamp();
          if NEW.verification_expires_at<=NEW.verification_requested_at
            or NEW.verification_expires_at>NEW.verification_requested_at+interval '30 days' then
            raise exception 'Tenant domain challenge lifetime is out of bounds';
          end if;
        elsif OLD.verification_state='pending' and NEW.verification_state='verified' then
          if NEW.verification_method is distinct from OLD.verification_method
            or NEW.verification_challenge is distinct from OLD.verification_challenge
            or NEW.verification_token_id is distinct from OLD.verification_token_id
            or NEW.verification_requested_at is distinct from OLD.verification_requested_at
            or NEW.verification_expires_at is distinct from OLD.verification_expires_at
            or NEW.verification_evidence is null then
            raise exception 'Tenant domain verification requires recorded ownership evidence';
          end if;
          if not tenant_domain_challenge_live(OLD.verification_requested_at,OLD.verification_expires_at,clock_timestamp()) then
            raise exception 'Tenant domain challenge has expired';
          end if;
          NEW.verified_at=clock_timestamp();
        elsif NEW.verification_state='unverified' then
          if NEW.active then raise exception 'An active tenant domain cannot lose verification'; end if;
        else
          raise exception 'Unsupported tenant domain verification transition';
        end if;
      elsif OLD.verification_state='pending' and NEW.verification_state='pending' then
        -- Replacement challenge. A new token and window, and the previous
        -- challenge stops being usable the moment this commits.
        if NEW.verification_token_id is null or NEW.verification_token_id=OLD.verification_token_id
          or NEW.verification_challenge is null or NEW.verification_challenge=OLD.verification_challenge
          or NEW.verification_method is distinct from 'dns_txt' or NEW.verification_evidence is not null then
          raise exception 'Replacement challenge requires a new token';
        end if;
        NEW.verification_requested_at=clock_timestamp();
        if NEW.verification_expires_at<=NEW.verification_requested_at
          or NEW.verification_expires_at>NEW.verification_requested_at+interval '30 days' then
          raise exception 'Tenant domain challenge lifetime is out of bounds';
        end if;
      elsif NEW.verification_state='verified'
        and (NEW.verified_at<>OLD.verified_at
          or NEW.verification_method is distinct from OLD.verification_method
          or NEW.verification_challenge is distinct from OLD.verification_challenge
          or NEW.verification_token_id is distinct from OLD.verification_token_id
          or NEW.verification_expires_at is distinct from OLD.verification_expires_at
          or NEW.verification_evidence is distinct from OLD.verification_evidence) then
        raise exception 'Tenant domain verification evidence is immutable';
      end if;
      if NEW.active and NEW.verification_state<>'verified' then
        raise exception 'Only a verified tenant domain can be activated';
      end if;
      NEW.updated_at=clock_timestamp(); return NEW;
    end $$;
  `.execute(db);
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    set local lock_timeout = '5s';
    lock table tenant_domain,tenant_domain_verification_attempt in access exclusive mode;
    do $$ begin
      if exists(select 1 from tenant_domain_verification_attempt)
        or exists(select 1 from tenant_domain where verification_state<>'unverified' or active) then
        raise exception 'Retained tenant domain verification evidence prevents rollback';
      end if;
    end $$;
    drop table tenant_domain_verification_attempt;
    drop function protect_tenant_domain_attempt(),guard_tenant_domain_attempt();
    alter table tenant_domain
      drop constraint tenant_domain_challenge_bounds,
      drop constraint tenant_domain_challenge_window,
      drop constraint tenant_domain_hostname_verifiable,
      drop column verification_token_id,
      drop column verification_expires_at;
    create or replace function guard_tenant_domain() returns trigger language plpgsql as $$ begin
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
    drop function tenant_domain_challenge_live(timestamptz,timestamptz,timestamptz);
  `.execute(db);
}
