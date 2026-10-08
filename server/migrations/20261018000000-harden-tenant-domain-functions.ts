import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

/** Ordinal 48. ADR-027 F060.3C-2c-2. Hardens the tenant-domain database
 * primitives against object-resolution attacks and removes the operator
 * path's need for any privilege on the Organization table.
 *
 * Two problems are fixed together.
 *
 * **Organization row locking.** The registry path takes `SELECT ... FOR SHARE`
 * on `organization`, and PostgreSQL requires UPDATE privilege on at least one
 * column of a row-locked table. The intended least-privilege operator role
 * must not hold write authority over tenant metadata, so the lock moves into
 * one narrowly scoped SECURITY DEFINER helper that returns only a boolean.
 * Row locks are scoped to the calling transaction, not to the function call,
 * so the original concurrency guarantee is preserved exactly rather than
 * relocated.
 *
 * **Object resolution.** The live functions were SECURITY INVOKER with
 * unqualified references and no `search_path`. Because the threat model
 * includes interactive misuse of the operator credential, and `pg_temp` is
 * implicitly searched first for relation *and data type* names, a temporary
 * table could shadow both a relation and the composite type used in a
 * `DECLARE`. Every security-sensitive function is therefore pinned to
 * `search_path = pg_catalog, pg_temp` with every application object schema
 * qualified; `public` is deliberately absent from the path so that a missed
 * reference fails loudly instead of resolving through the caller.
 *
 * Deliberately excluded: any deployment-specific `GRANT`. This migration
 * revokes PUBLIC EXECUTE on the new helper because that is a fail-closed
 * property of the object, but it grants EXECUTE to no role. **Migration 48
 * must not be considered deployable to a non-owner runtime environment until
 * the required role grants are provisioned under F060.3C-2c-3.**
 *
 * No table, column, index or constraint is added or altered, and no data row
 * is touched. */
export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    set local lock_timeout = '5s';

    -- Locks the one supplied Organization row and reports only whether it is
    -- servable. Locking and active-status enforcement are separate decisions:
    -- this returns the status verdict and each caller decides whether a false
    -- result is fatal, so safe-direction operations do not become impossible
    -- merely because an Organization is no longer active.
    --
    -- VOLATILE on purpose. The function exists to acquire a row lock, so the
    -- optimizer must not be allowed to assume it can be elided, reordered or
    -- called fewer times than written.
    create function public.tenant_domain_lock_organization(target uuid)
      returns boolean language plpgsql volatile security definer
      set search_path = pg_catalog, pg_temp as $$
    declare servable boolean; begin
      select o.status='active' into servable
        from public.organization o where o.id=target for share;
      -- A missing Organization and an inactive one are both false. Nothing
      -- else about the Organization is exposed: no name, slug, short name or
      -- any other column can be read through this function.
      return coalesce(servable,false);
    end $$;
    -- Fail closed and role agnostic. Deployment-specific EXECUTE grants are
    -- intentionally not issued here.
    revoke execute on function public.tenant_domain_lock_organization(uuid) from public;

    create or replace function public.guard_tenant_domain() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$ begin
      if TG_OP in ('DELETE','TRUNCATE') then raise exception 'Tenant domain bindings are deactivated, never deleted'; end if;
      -- Lock only. This guard never required an active Organization, so the
      -- result is deliberately discarded, and a missing Organization remains
      -- authoritatively refused by the foreign key rather than here.
      perform public.tenant_domain_lock_organization(NEW.organization_id);
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
          if not public.tenant_domain_challenge_live(OLD.verification_requested_at,OLD.verification_expires_at,clock_timestamp()) then
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

    create or replace function public.guard_tenant_domain_attempt() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
    declare binding public.tenant_domain; begin
      select * into binding from public.tenant_domain where organization_id=NEW.organization_id and id=NEW.tenant_domain_id;
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

    create or replace function public.guard_tenant_domain_audit() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
    declare binding public.tenant_domain; approval public.tenant_domain_operator_approval; begin
      select * into binding from public.tenant_domain where organization_id=NEW.organization_id and id=NEW.tenant_domain_id;
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
        select * into approval from public.tenant_domain_operator_approval
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
        if not public.tenant_domain_approval_live(approval.approved_at,approval.expires_at,clock_timestamp()) then
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

    create or replace function public.verify_tenant_domain_audited() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$ begin
      if not exists(select 1 from public.tenant_domain_audit a
        where a.organization_id=NEW.organization_id and a.tenant_domain_id=NEW.id
          and a.revision=NEW.revision and a.mutation_txid=txid_current()
          and a.attribution_version=2) then
        raise exception 'Tenant domain changes require matching attributed operator audit evidence';
      end if;
      return null;
    end $$;

    create or replace function public.guard_tenant_domain_approval() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
    declare binding public.tenant_domain; begin
      if TG_OP in ('UPDATE','DELETE','TRUNCATE') then
        raise exception 'Tenant domain operator approvals are immutable';
      end if;
      -- Unchanged requirement, now routed through the hardened helper so no
      -- caller needs any privilege on the Organization table.
      if not public.tenant_domain_lock_organization(NEW.organization_id) then
        raise exception 'Tenant domain approval requires an active Organization';
      end if;
      select * into binding from public.tenant_domain
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

    create or replace function public.tenant_domain_approval_consumed(approval uuid) returns boolean language sql stable set search_path = pg_catalog, pg_temp as $$
      select exists(select 1 from public.tenant_domain_audit where approval_id=approval)
    $$;
  `.execute(db);
}

/** Restores the exact pre-48 function definitions and drops the helper.
 *
 * **Rolling this back intentionally removes the hardening**, so the operator
 * path returns to requiring a privilege on `organization` that the intended
 * least-privilege role must not hold. After a rollback the production operator
 * path is once again **production use unauthorized**. Reapplying restores the
 * hardened state.
 *
 * Every data row is preserved: audit, approval and verification evidence are
 * untouched, and no grant is changed. */
export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    set local lock_timeout = '5s';

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

    create or replace function guard_tenant_domain_attempt() returns trigger language plpgsql as $$
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

    create or replace function verify_tenant_domain_audited() returns trigger language plpgsql as $$ begin
      if not exists(select 1 from tenant_domain_audit a
        where a.organization_id=NEW.organization_id and a.tenant_domain_id=NEW.id
          and a.revision=NEW.revision and a.mutation_txid=txid_current()
          and a.attribution_version=2) then
        raise exception 'Tenant domain changes require matching attributed operator audit evidence';
      end if;
      return null;
    end $$;

    create or replace function guard_tenant_domain_approval() returns trigger language plpgsql as $$
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

    create or replace function tenant_domain_approval_consumed(approval uuid) returns boolean language sql stable as $$
      select exists(select 1 from tenant_domain_audit where approval_id=approval)
    $$;

    drop function public.tenant_domain_lock_organization(uuid);
  `.execute(db);
}
