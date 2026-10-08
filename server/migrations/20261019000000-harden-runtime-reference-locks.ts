import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

/** Ordinal 49. ADR-027 F060.3C-2d. Removes the runtime application's need for
 * UPDATE privilege on reference tables it only reads, and on the
 * database-maintained columns of `organization_access_state`.
 *
 * **Why this exists.** PostgreSQL requires UPDATE privilege on at least one
 * column of a row-locked table, so `SELECT ... FOR SHARE` on a reference row
 * demands write authority the runtime must not hold. F060.3C-2c-2 solved the
 * same problem once, for `organization` in the operator path; the runtime has
 * it in six more places. Six reference tables are row-locked but never
 * written: `category`, `department`, `division`, `staff_identity`,
 * `operational_role` and `work_group`. None of them carries an immutability
 * trigger, so no column on them is independently inert and a column-scoped
 * UPDATE grant would confer a real mutation — setting `status` to `inactive`
 * would let the runtime disable routing. Five of the six therefore move their
 * locks into narrowly scoped SECURITY DEFINER helpers that return only a
 * boolean.
 *
 * **Category is the deliberate exception.** It is locked at sixteen runtime
 * sites, and thirteen of those use Kysely's OF-alias form inside the shared
 * staff request scope, where the Category row is locked atomically together
 * with the Service Request and the Organization in one statement. Converting
 * them would replace an atomic multi-relation lock with a helper call plus a
 * narrowed OF clause in the hottest request paths, which was judged a worse
 * trade than one tightly constrained privilege. Those thirteen sites, and the
 * default-assignment preflight, keep their native FOR SHARE, and the runtime
 * will instead hold `UPDATE (id)` on Category purely to satisfy the row-lock
 * requirement. `protect_category_identity` below is what makes that column
 * inert, so the privilege confers no authority. Only site 1's atomic
 * Category + Department active lock is routed through a helper, because that
 * site needs the Department active predicate too.
 *
 * **Predicate preservation is the governing rule.** Each helper enforces
 * exactly the predicate its existing caller already relies on and nothing
 * stronger. Two callers lock a reference row *without* any status check, so
 * `lock_department` and `lock_division` deliberately have no active-status
 * requirement. Introducing one would be a new business rule.
 *
 * **Access revision.** `advance_access_revision` updates
 * `authorization_revision`, `mutation_txid` and `updated_at`, and it is
 * reached from AFTER triggers on `role`, `role_permission` and
 * `staff_role_assignment`, which the runtime writes. While both it and its
 * only caller are SECURITY INVOKER, those updates execute with the runtime's
 * privileges, so the runtime would need UPDATE on all three columns.
 * Measured on PostgreSQL 17.11: hardening `advance_access_revision` alone is
 * *not* sufficient, because a plpgsql call to another function is permission
 * checked against the effective user — the trigger call failed with
 * `permission denied for function advance_access_revision`. Hardening its one
 * caller as well removes the requirement entirely: the runtime then needs
 * neither EXECUTE on either function nor UPDATE on any maintained column.
 *
 * `invalidate_access_revision` is safe to harden because it is a pure
 * dispatcher: it compares `to_jsonb(old)` against `to_jsonb(new)` in memory,
 * derives the affected Organizations and calls `advance_access_revision`. It
 * reads and writes no table of its own. **It must stay that way** — any
 * future table access added to it would execute with owner privileges.
 *
 * Both retain their existing `pg_trigger_depth()` protections, so a direct
 * call still fails: `advance_access_revision` raises at depth 0, and
 * `protect_access_state` raises at depth 1 for the maintained columns.
 *
 * Deliberately excluded: every role-specific `GRANT`. This migration revokes
 * PUBLIC EXECUTE because that is a fail-closed property of the object, but
 * grants EXECUTE to no role. The runtime grants belong to the provisioning
 * artifact in the following F060.3C-2d slice, and **Migration 49 must not be
 * considered deployable to a separated-role environment until they exist.**
 *
 * **Rollback coupling, stated prominently. There are two, and both point the
 * same way: Migration 49 rollback and runtime-grant rollback are one atomic
 * operational change.**
 *
 * 1. *Access revision.* After Migration 49 the intended runtime grant on
 *    `organization_access_state` is `SELECT` plus
 *    `UPDATE (bootstrap_established)` only. Rolling back restores SECURITY
 *    INVOKER revision functions, which again require the runtime to hold
 *    UPDATE on `authorization_revision`, `mutation_txid` and `updated_at`. A
 *    rolled-back deployment whose runtime role still holds the narrowed grant
 *    will **fail** on every role, permission and assignment mutation.
 * 2. *Category identity.* Once the runtime grant artifact grants
 *    `UPDATE (id)` on `public.category`, that privilege is safe only while
 *    `protect_category_identity` exists. Rolling back Migration 49 drops the
 *    trigger and would leave the runtime able to **mutate Category identity**
 *    — repointing a Category to another UUID, subject only to foreign keys.
 *    The runtime grant must be removed in the same operation.
 *
 * Roll back both together, or neither.
 *
 * No table, column, index or constraint is added or altered, and no data row
 * is touched. */
export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    set local lock_timeout = '5s';

    -- Every helper below is VOLATILE on purpose. Each exists to acquire a row
    -- lock, so the optimizer must not assume it can be elided, reordered or
    -- called fewer times than written.
    --
    -- Each returns only a boolean. Business values -- routing identifiers,
    -- names, display names -- stay with the caller's ordinary SELECT, which
    -- observes the row already pinned by the helper because row locks are
    -- scoped to the transaction rather than to the function call.

    -- Site: admin-issue-creation.domain.ts lockCreationCategory.
    -- The existing caller locks the Category and its Department in ONE
    -- statement and requires BOTH to be active, so the join is part of the
    -- predicate and is preserved here rather than split into two calls, which
    -- would introduce a read-then-lock window that does not exist today.
    create function public.lock_active_category(target_organization uuid, target_category uuid)
      returns boolean language plpgsql volatile security definer
      set search_path = pg_catalog, pg_temp as $$
    declare servable boolean; begin
      select true into servable
        from public.category c
        join public.department d
          on d.id=c.department_id and d.organization_id=c.organization_id
        where c.organization_id=target_organization and c.id=target_category
          and c.status='active' and d.status='active'
        for share;
      return coalesce(servable,false);
    end $$;

    -- Site: internal-request-mutations.service.ts route-target validation.
    create function public.lock_active_department(target_organization uuid, target_department uuid)
      returns boolean language plpgsql volatile security definer
      set search_path = pg_catalog, pg_temp as $$
    declare servable boolean; begin
      select true into servable from public.department
        where organization_id=target_organization and id=target_department
          and status='active' for share;
      return coalesce(servable,false);
    end $$;

    -- Site: internal-request-mutations.service.ts route snapshot. Existence
    -- only: the snapshot reads a name and applies no status predicate today.
    create function public.lock_department(target_organization uuid, target_department uuid)
      returns boolean language plpgsql volatile security definer
      set search_path = pg_catalog, pg_temp as $$
    declare present boolean; begin
      select true into present from public.department
        where organization_id=target_organization and id=target_department for share;
      return coalesce(present,false);
    end $$;

    -- Sites: admin-issue-creation.domain.ts and
    -- internal-request-mutations.service.ts. The Department is part of the
    -- existing hierarchy predicate, not an added rule.
    create function public.lock_active_division(target_organization uuid, target_department uuid, target_division uuid)
      returns boolean language plpgsql volatile security definer
      set search_path = pg_catalog, pg_temp as $$
    declare servable boolean; begin
      select true into servable from public.division
        where organization_id=target_organization and department_id=target_department
          and id=target_division and status='active' for share;
      return coalesce(servable,false);
    end $$;

    -- Site: internal-request-mutations.service.ts route snapshot. Existence
    -- and hierarchy only, with no status predicate.
    create function public.lock_division(target_organization uuid, target_department uuid, target_division uuid)
      returns boolean language plpgsql volatile security definer
      set search_path = pg_catalog, pg_temp as $$
    declare present boolean; begin
      select true into present from public.division
        where organization_id=target_organization and department_id=target_department
          and id=target_division for share;
      return coalesce(present,false);
    end $$;

    -- Sites: request-note.service.ts, request-communication.service.ts and
    -- request-tracking.service.ts. All three require the acting staff row to
    -- be active, so the predicate is preserved including that requirement.
    create function public.lock_staff(target_organization uuid, target_staff uuid)
      returns boolean language plpgsql volatile security definer
      set search_path = pg_catalog, pg_temp as $$
    declare servable boolean; begin
      select true into servable from public.staff_identity
        where organization_id=target_organization and id=target_staff
          and active for share;
      return coalesce(servable,false);
    end $$;

    -- Sites: issue-default-assignment.ts lockTarget and
    -- request-ownership.service.ts. The caller selects one of three principal
    -- tables from a closed TargetType union, so the dispatch is a static
    -- branch over three literal, fully qualified tables. There is no dynamic
    -- table identifier and no dynamic SQL. An unrecognised type raises rather
    -- than returning false, so a typo can never read as "target unavailable".
    --
    -- Neither existing site applies a status predicate, so neither does this.
    -- operational_role carries an active column and work_group does not;
    -- introducing a liveness rule here would be a new business rule.
    create function public.lock_assignment_target(target_organization uuid, target_type varchar, target_id uuid)
      returns boolean language plpgsql volatile security definer
      set search_path = pg_catalog, pg_temp as $$
    declare present boolean; begin
      if target_type='staff' then
        select true into present from public.staff_identity
          where organization_id=target_organization and id=target_id for share;
      elsif target_type='role' then
        select true into present from public.operational_role
          where organization_id=target_organization and id=target_id for share;
      elsif target_type='group' then
        select true into present from public.work_group
          where organization_id=target_organization and id=target_id for share;
      else
        raise exception 'Unknown assignment target type';
      end if;
      return coalesce(present,false);
    end $$;

    revoke execute on function public.lock_active_category(uuid, uuid) from public;
    revoke execute on function public.lock_active_department(uuid, uuid) from public;
    revoke execute on function public.lock_department(uuid, uuid) from public;
    revoke execute on function public.lock_active_division(uuid, uuid, uuid) from public;
    revoke execute on function public.lock_division(uuid, uuid, uuid) from public;
    revoke execute on function public.lock_staff(uuid, uuid) from public;
    revoke execute on function public.lock_assignment_target(uuid, varchar, uuid) from public;

    -- Category identity immutability.
    --
    -- Category is locked FOR SHARE at sixteen runtime sites, thirteen of them
    -- through Kysely's OF-alias form inside the shared staff request scope,
    -- where the Category row is locked together with the Service Request and
    -- the Organization in ONE statement. Converting those would replace an
    -- atomic multi-relation lock with a helper call plus a narrowed OF clause
    -- in the hottest request paths, so they are deliberately left alone and
    -- the runtime will instead hold a column-scoped UPDATE (id) purely to
    -- satisfy PostgreSQL's row-lock privilege requirement.
    --
    -- That privilege must confer no authority, so this invariant makes the
    -- one grantable column independently immutable. It is the barrier the
    -- F060.3C-2d-A rule requires: a column may carry a lock-only grant only
    -- when an independent database invariant makes every meaningful update
    -- impossible. A same-value assignment stays permitted, because that is
    -- what PostgreSQL may need to evaluate, and it changes nothing.
    --
    -- SECURITY INVOKER on purpose: it reads and writes no table, takes no
    -- lock and needs no elevated privilege, so it is not part of the
    -- SECURITY DEFINER surface. Ordinary Category fields are untouched --
    -- name, status, routing and ordering remain mutable by whoever holds the
    -- privilege for them, which the runtime deliberately will not.
    create function public.protect_category_identity() returns trigger
      language plpgsql volatile as $$ begin
      if NEW.id is distinct from OLD.id then
        raise exception 'Category identity is immutable';
      end if;
      return NEW;
    end $$;

    -- OF id, so the trigger is only consulted when a statement actually names
    -- the column. Every other Category update path is unaffected.
    create trigger category_identity_immutable before update of id on public.category
      for each row execute function public.protect_category_identity();

    -- The revision pair, hardened. Behaviour is unchanged: the same increment,
    -- the same mutation_txid stamp, the same updated_at stamp, the same
    -- trailing serialization lock and the same depth-0 refusal.
    create or replace function public.advance_access_revision(org uuid) returns void
      language plpgsql volatile security definer
      set search_path = pg_catalog, pg_temp as $$ begin
      if pg_trigger_depth()=0 then raise exception 'Authorization revision is database maintained'; end if;
      update public.organization_access_state set authorization_revision=authorization_revision+1,
        mutation_txid=txid_current(),updated_at=clock_timestamp()
        where organization_id=org and mutation_txid is distinct from txid_current();
      -- Even a second mutation in this transaction retains the serialization lock.
      perform 1 from public.organization_access_state where organization_id=org for update;
    end $$;

    -- A pure dispatcher, and it must remain one. It reads and writes no table;
    -- it compares the trigger's own OLD/NEW images in memory, derives the
    -- affected Organizations and calls the function above. Because it is now
    -- SECURITY DEFINER, any table access added here in future would execute
    -- with owner privileges.
    create or replace function public.invalidate_access_revision() returns trigger
      language plpgsql volatile security definer
      set search_path = pg_catalog, pg_temp as $$
    declare previous jsonb; current_value jsonb; org uuid; old_org uuid;
    begin
      if TG_OP<>'INSERT' then previous=to_jsonb(old); end if;
      if TG_OP<>'DELETE' then current_value=to_jsonb(new); end if;
      if TG_OP='UPDATE' then
        if TG_TABLE_NAME='organization' and current_value->'status' is not distinct from previous->'status' then return new; end if;
        if TG_TABLE_NAME='role' and (current_value->'organization_id',current_value->'id',current_value->'active') is not distinct from (previous->'organization_id',previous->'id',previous->'active') then return new; end if;
        if TG_TABLE_NAME='staff_identity' and
          (current_value->'organization_id',current_value->'id',current_value->'active',current_value->'entra_tenant_id',current_value->'entra_object_id') is not distinct from
          (previous->'organization_id',previous->'id',previous->'active',previous->'entra_tenant_id',previous->'entra_object_id') then return new; end if;
        if TG_TABLE_NAME not in ('organization','role','staff_identity') and
          (current_value-'updated_at'-'created_at') is not distinct from (previous-'updated_at'-'created_at') then return new; end if;
      end if;
      org=coalesce((current_value->>'organization_id')::uuid,(current_value->>'id')::uuid);
      old_org=coalesce((previous->>'organization_id')::uuid,(previous->>'id')::uuid);
      for org in select distinct v from unnest(array[org,old_org]) v where v is not null order by v loop
        perform public.advance_access_revision(org);
      end loop;
      return coalesce(new,old);
    end $$;

    revoke execute on function public.protect_category_identity() from public;
    revoke execute on function public.advance_access_revision(uuid) from public;
    revoke execute on function public.invalidate_access_revision() from public;
  `.execute(db);
}

/** Restores the exact pre-49 definitions and drops the eight helpers.
 *
 * The two revision functions are restored byte-identically to their
 * Migration 20261008000000 bodies, as SECURITY INVOKER with no pinned
 * `search_path` and the original unqualified references. A focused test
 * asserts that equivalence against the Migration 20261008000000 source rather
 * than trusting this transcription.
 *
 * `create or replace function` preserves ownership and ACL, so the PUBLIC
 * EXECUTE that `up()` revoked is granted back explicitly here; otherwise a
 * rollback would leave a tighter ACL than the pre-49 state.
 *
 * The helpers are dropped without `CASCADE`. Nothing should depend on them, so
 * a dependency error is a signal worth seeing rather than cascading away.
 *
 * **Rolling this back re-imposes the wider runtime privilege requirement.**
 * See the coupling note on `up()`: the narrowed runtime grant on
 * `organization_access_state` becomes incompatible with runtime access
 * administration, so both must be rolled back together.
 *
 * Every data row is preserved and no grant on any table is changed. */
export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    set local lock_timeout = '5s';

    drop trigger category_identity_immutable on public.category;
    drop function public.protect_category_identity();

    drop function public.lock_active_category(uuid, uuid);
    drop function public.lock_active_department(uuid, uuid);
    drop function public.lock_department(uuid, uuid);
    drop function public.lock_active_division(uuid, uuid, uuid);
    drop function public.lock_division(uuid, uuid, uuid);
    drop function public.lock_staff(uuid, uuid);
    drop function public.lock_assignment_target(uuid, varchar, uuid);

    create or replace function advance_access_revision(org uuid) returns void language plpgsql as $$ begin
      if pg_trigger_depth()=0 then raise exception 'Authorization revision is database maintained'; end if;
      update organization_access_state set authorization_revision=authorization_revision+1,
        mutation_txid=txid_current(),updated_at=clock_timestamp()
        where organization_id=org and mutation_txid is distinct from txid_current();
      -- Even a second mutation in this transaction retains the serialization lock.
      perform 1 from organization_access_state where organization_id=org for update;
    end $$;

    create or replace function invalidate_access_revision() returns trigger language plpgsql as $$
    declare previous jsonb; current_value jsonb; org uuid; old_org uuid;
    begin
      if TG_OP<>'INSERT' then previous=to_jsonb(old); end if;
      if TG_OP<>'DELETE' then current_value=to_jsonb(new); end if;
      if TG_OP='UPDATE' then
        if TG_TABLE_NAME='organization' and current_value->'status' is not distinct from previous->'status' then return new; end if;
        if TG_TABLE_NAME='role' and (current_value->'organization_id',current_value->'id',current_value->'active') is not distinct from (previous->'organization_id',previous->'id',previous->'active') then return new; end if;
        if TG_TABLE_NAME='staff_identity' and
          (current_value->'organization_id',current_value->'id',current_value->'active',current_value->'entra_tenant_id',current_value->'entra_object_id') is not distinct from
          (previous->'organization_id',previous->'id',previous->'active',previous->'entra_tenant_id',previous->'entra_object_id') then return new; end if;
        if TG_TABLE_NAME not in ('organization','role','staff_identity') and
          (current_value-'updated_at'-'created_at') is not distinct from (previous-'updated_at'-'created_at') then return new; end if;
      end if;
      org=coalesce((current_value->>'organization_id')::uuid,(current_value->>'id')::uuid);
      old_org=coalesce((previous->>'organization_id')::uuid,(previous->>'id')::uuid);
      for org in select distinct v from unnest(array[org,old_org]) v where v is not null order by v loop
        perform advance_access_revision(org);
      end loop;
      return coalesce(new,old);
    end $$;

    grant execute on function advance_access_revision(uuid) to public;
    grant execute on function invalidate_access_revision() to public;
  `.execute(db);
}
