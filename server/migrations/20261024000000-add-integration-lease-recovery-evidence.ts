import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

/**
 * F062.2D-2C-1 — claim lease, dispatch boundary and recovery-reason evidence.
 *
 * Implements the persistence half of the F062.2D-2C-0A contract. **No worker
 * runs, no function is added or changed, no retry is scheduled and no
 * destination is contacted.** This migration makes safe lease recovery
 * *representable*; F062.2D-2C-3 makes it *executable*.
 *
 * Three nullable columns, one replaced settlement rule, a set of named
 * settlement-shape constraints, two guard extensions and one partial index.
 *
 * ## Why the columns are nullable
 *
 * The claim function is deliberately not modified in this slice, so nothing
 * populates `claim_expires_at`. Making it `NOT NULL` would either break the
 * existing claim path or require fabricating lease history for rows that never
 * had one. F062.2D-2C-3 tightens it once the claim function computes it from
 * approved policy. **No lease duration, interval or default is encoded here.**
 *
 * ## The settlement matrix
 *
 * F062.2D-2A required every non-successful settlement to carry a destination
 * `failure_category`. That is now too coarse: a lease recovery contacted no
 * destination, so naming destination behaviour would be fabricated evidence.
 * The rule becomes "explained by exactly one namespace":
 *
 * | Origin                             | outcome            | failure_category | reason_code                  |
 * | ---------------------------------- | ------------------ | ---------------- | ---------------------------- |
 * | open                               | null               | null             | null                         |
 * | A success                          | `succeeded`        | null             | null                         |
 * | B adapter-derived                  | the other three    | **not null**     | null                         |
 * | C pre-dispatch recovery            | `failed_transient` | null             | `lease_expired_pre_dispatch` |
 * | D possibly-dispatched expiry       | `ambiguous`        | null             | `lease_expired_uncertain`    |
 *
 * C additionally requires `dispatch_started_at IS NULL` and D requires it
 * `IS NOT NULL`, so **neither reason can assert a boundary state the row
 * contradicts.** That cross-check is the reason recovery can be trusted
 * without trusting the recovery function.
 *
 * ## The dispatch boundary is database-authored
 *
 * A caller signals the transition by setting `dispatch_started_at` to any
 * non-null value; the guard **discards it and stores `clock_timestamp()`**.
 * This is the same authorship pattern F062.2D-2A already uses for `started_at`
 * and `completed_at`, so a forged past or future timestamp cannot become
 * durable evidence. The marker is write-once, cannot be cleared, and cannot be
 * introduced by a settlement — which is what stops a recovery from
 * manufacturing the boundary state its own reason code requires.
 *
 * ## What this migration deliberately does not add
 *
 * `next_attempt_at`, `attempt_count`, `retry_count`, `recovery_count`,
 * `claimed_at`, `claimed_by`, `heartbeat_at`, `renewed_at`,
 * `requires_ordered_delivery`, any ordering index, any retry or backoff
 * computation, any role, grant or function.
 *
 * `attempt_number` remains the immutable monotonic ordinal of attempt
 * **evidence** and is **not** the destination retry count (F062.2D-2C-0A §18.2).
 *
 * ## Schema portability
 *
 * Unlike Migrations 48, 49 and 53 this migration hardcodes no schema name, so
 * it is imported and compiled like Migration 52 rather than applied as text.
 */
export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    -- ------------------------------------------------------------------
    -- Lease, dispatch-boundary and recovery-reason columns.
    --
    -- All three nullable, with no default: existing evidence keeps null for
    -- each, and nothing fabricates history it never had.
    -- ------------------------------------------------------------------
    alter table integration_delivery_attempt
      add column claim_expires_at timestamptz,
      add column dispatch_started_at timestamptz,
      add column reason_code varchar(40);

    -- ------------------------------------------------------------------
    -- Replace F062.2D-2A's "every failure names a destination category".
    --
    -- The constraint is unnamed in Migration 52, so it is located by
    -- definition rather than by a generated name, and the lookup fails closed
    -- if it is absent or ambiguous. The sibling rule, that a success carries
    -- no category, is matched by 'failure_category IS NULL' and is therefore
    -- not selected here; it is retained unchanged.
    -- ------------------------------------------------------------------
    do $$
    declare
      doomed text[];
    begin
      -- Resolved through regclass, so the row is located on the actual table
      -- this migration is altering rather than on any same-named relation
      -- earlier in the search path.
      select array_agg(c.conname order by c.conname) into doomed
        from pg_constraint c
       where c.conrelid = 'integration_delivery_attempt'::regclass
         and c.contype = 'c'
         and pg_get_constraintdef(c.oid) like '%failure_category IS NOT NULL%'
         and pg_get_constraintdef(c.oid) like '%succeeded%'
         and pg_get_constraintdef(c.oid) not like '%reason_code%';
      if doomed is null or array_length(doomed, 1) <> 1 then
        raise exception
          'Expected exactly one F062.2D-2A settlement constraint to replace, found %',
          coalesce(array_length(doomed, 1), 0);
      end if;
      execute format(
        'alter table integration_delivery_attempt drop constraint %I', doomed[1]);
    end $$;

    -- ------------------------------------------------------------------
    -- The settlement matrix, named so every rule is identifiable and
    -- individually testable.
    -- ------------------------------------------------------------------
    alter table integration_delivery_attempt
      -- Every settlement is explained by exactly one namespace. This is the
      -- replacement for the dropped rule: a destination category OR a
      -- Reqro-owned lifecycle reason, never neither.
      add constraint integration_attempt_settlement_explained
        check (outcome is null or outcome = 'succeeded'
               or failure_category is not null or reason_code is not null),

      -- An open attempt has nothing to explain yet.
      add constraint integration_attempt_open_carries_no_evidence
        check (outcome is not null
               or (failure_category is null and reason_code is null)),

      -- A success carries no reason. The sibling rule for failure_category is
      -- Migration 52's and is retained.
      add constraint integration_attempt_success_carries_no_reason
        check (outcome is distinct from 'succeeded' or reason_code is null),

      -- The CURRENT implemented subset: the only persisted reason codes are
      -- Reqro-owned lifecycle reasons, and a lifecycle reason never coexists
      -- with destination behaviour it did not observe.
      --
      -- This is deliberately NOT a permanent architectural assertion.
      -- F062.2A §8.1's broader design permits a destination-derived reason
      -- refining a destination category, and when a producer for those values
      -- exists this constraint is the one a reviewed migration widens.
      add constraint integration_attempt_lifecycle_reason_excludes_category
        check (reason_code is null or failure_category is null),

      -- No lifecycle origin produces a permanent failure: a permanent failure
      -- is always a destination or configuration fact.
      add constraint integration_attempt_permanent_requires_category
        check (outcome is distinct from 'failed_permanent'
               or failure_category is not null),

      -- Shape C, including the boundary cross-check. The reason asserts that
      -- no transmission could have occurred, and the row must agree.
      add constraint integration_attempt_pre_dispatch_reason_shape
        check (reason_code is distinct from 'lease_expired_pre_dispatch'
               or (outcome = 'failed_transient'
                   and failure_category is null
                   and dispatch_started_at is null)),

      -- Shape D, including the opposite cross-check.
      add constraint integration_attempt_uncertain_reason_shape
        check (reason_code is distinct from 'lease_expired_uncertain'
               or (outcome = 'ambiguous'
                   and failure_category is null
                   and dispatch_started_at is not null)),

      -- The closed vocabulary. Exactly the two values a producer exists for
      -- in this slice; the rest of F062.2A's taxonomy stays design authority
      -- until the classifying settle path can write it.
      add constraint integration_attempt_reason_code_vocabulary
        check (reason_code is null
               or reason_code in ('lease_expired_pre_dispatch',
                                  'lease_expired_uncertain')),

      -- F062.1 transientIntegrationFailures, made structural. Migration 53's
      -- completion function already refuses these two combinations; moving
      -- them into the table means a privileged direct write cannot assert
      -- them either, which is what §7 of the authorization requires.
      add constraint integration_attempt_transient_category_shape
        check (outcome is distinct from 'failed_transient'
               or failure_category is null
               or failure_category in ('destination_unavailable', 'rate_limited')),
      add constraint integration_attempt_timeout_is_ambiguous
        check (failure_category is distinct from 'destination_timeout'
               or outcome = 'ambiguous'),

      -- Lease and boundary timestamps are bounded by the attempt's own start.
      -- No duration is implied: only ordering.
      add constraint integration_attempt_lease_after_start
        check (claim_expires_at is null or claim_expires_at > started_at),
      add constraint integration_attempt_dispatch_not_before_start
        check (dispatch_started_at is null or dispatch_started_at >= started_at);

    -- ------------------------------------------------------------------
    -- Extend the F062.2D-2A guard. Every existing protection is preserved
    -- verbatim; three are added, and the identity test is factored into a
    -- local so the original ORDER of refusals is unchanged for settlements.
    -- ------------------------------------------------------------------
    create or replace function guard_integration_delivery_attempt() returns trigger
      language plpgsql as $$
    declare
      obligation integration_outbox;
      identity_changed boolean;
    begin
      if TG_OP in ('DELETE','TRUNCATE') then
        raise exception 'Integration delivery attempts are evidence and are never deleted';
      end if;

      if TG_OP = 'INSERT' then
        if NEW.outcome is not null or NEW.completed_at is not null
          or NEW.failure_category is not null then
          raise exception 'Integration delivery attempt must be created open';
        end if;

        -- F062.2D-2C-1. An attempt is created at claim, which is before any
        -- dispatch and before any settlement, so neither the boundary marker
        -- nor a settlement reason may be present.
        if NEW.dispatch_started_at is not null then
          raise exception 'Integration delivery attempt must be created before its dispatch boundary';
        end if;
        if NEW.reason_code is not null then
          raise exception 'Integration delivery attempt must be created without a settlement reason';
        end if;

        select * into obligation from integration_outbox
          where organization_id = NEW.organization_id
            and id = NEW.integration_outbox_id;
        if not found then
          raise exception 'Integration delivery attempt requires an obligation owned by its Organization';
        end if;
        if NEW.integration_connector_id <> obligation.integration_connector_id then
          raise exception 'Integration delivery attempt must name its obligation connector';
        end if;
        if NEW.connector_configuration_revision
             <> obligation.pinned_connector_configuration_revision then
          raise exception 'Integration delivery attempt must pin the obligation semantic revision';
        end if;

        select coalesce(max(attempt_number), 0) + 1 into NEW.attempt_number
          from integration_delivery_attempt
          where organization_id = NEW.organization_id
            and integration_outbox_id = NEW.integration_outbox_id;
        select coalesce(max(claim_generation), 0) + 1 into NEW.claim_generation
          from integration_delivery_attempt
          where organization_id = NEW.organization_id
            and integration_outbox_id = NEW.integration_outbox_id;

        NEW.started_at = clock_timestamp();
        NEW.mutation_txid = txid_current();
        return NEW;
      end if;

      -- UPDATE. A settled attempt is immutable, which is also what makes the
      -- dispatch marker unsettable after settlement and the reason code
      -- immutable once written.
      if OLD.completed_at is not null then
        raise exception 'A settled integration delivery attempt is immutable';
      end if;

      -- F062.2D-2C-1. The lease deadline is written once, at claim. There is
      -- no renewal in this contract, so there is no legitimate update.
      if NEW.claim_expires_at is distinct from OLD.claim_expires_at then
        raise exception 'The integration claim lease is immutable and cannot be extended';
      end if;

      -- F062.2D-2C-1. The dispatch boundary is write-once. Once set it can be
      -- neither changed nor cleared, by anyone.
      if OLD.dispatch_started_at is not null
        and NEW.dispatch_started_at is distinct from OLD.dispatch_started_at then
        raise exception 'The integration dispatch boundary is write-once and cannot be changed or cleared';
      end if;

      identity_changed := NEW.id <> OLD.id
        or NEW.organization_id <> OLD.organization_id
        or NEW.integration_outbox_id <> OLD.integration_outbox_id
        or NEW.integration_connector_id <> OLD.integration_connector_id
        or NEW.attempt_number <> OLD.attempt_number
        or NEW.claim_generation <> OLD.claim_generation
        or NEW.claim_token_digest <> OLD.claim_token_digest
        or NEW.connector_configuration_revision <> OLD.connector_configuration_revision
        or NEW.capability_snapshot is distinct from OLD.capability_snapshot
        or NEW.started_at <> OLD.started_at;

      -- F062.2D-2C-1. Recording the dispatch boundary on an OPEN attempt is
      -- the one permitted update that is not a settlement.
      if OLD.dispatch_started_at is null and NEW.dispatch_started_at is not null then
        if NEW.outcome is not null or NEW.completed_at is not null then
          raise exception 'The integration dispatch boundary must be recorded before settlement';
        end if;
        if NEW.reason_code is not null or NEW.failure_category is not null then
          raise exception 'The integration dispatch boundary carries no settlement evidence';
        end if;
        if identity_changed then
          raise exception 'Integration delivery attempt claim identity is immutable';
        end if;
        -- DATABASE AUTHORED. Whatever the caller supplied is discarded, so a
        -- forged past or future timestamp cannot become durable evidence and
        -- no caller-controlled timestamp API exists.
        NEW.dispatch_started_at = clock_timestamp();
        return NEW;
      end if;

      -- Otherwise the only permitted change remains open -> settled. A
      -- settlement may not introduce the boundary marker: that is what stops
      -- a recovery from manufacturing the boundary state its own reason code
      -- requires.
      if NEW.outcome is null or NEW.completed_at is null then
        raise exception 'Integration delivery attempt may only be updated to settle it';
      end if;
      if identity_changed then
        raise exception 'Integration delivery attempt claim identity is immutable';
      end if;
      NEW.completed_at = clock_timestamp();
      return NEW;
    end $$;

    -- ------------------------------------------------------------------
    -- Recovery-scan index.
    --
    -- Supports exactly one future query, F062.2D-2C-3's expired-claim scan:
    --
    --   select ... from integration_delivery_attempt
    --    where organization_id = $1
    --      and completed_at is null
    --      and claim_expires_at < clock_timestamp()
    --    order by claim_expires_at
    --    limit $2 for update skip locked;
    --
    -- Organization first, matching every other index on these tables and the
    -- Organization-qualified shape of every reviewed function. Deployment
    -- per tenant keeps the leading cardinality low, so a platform-wide sweep
    -- remains serviceable from the same index.
    --
    -- Partial on open attempts that actually carry a lease, so it indexes
    -- only rows a recovery scan could ever return. No second speculative
    -- polling index is added, and no polling loop exists.
    -- ------------------------------------------------------------------
    create index integration_attempt_lease_expiry
      on integration_delivery_attempt (organization_id, claim_expires_at)
      where completed_at is null and claim_expires_at is not null;
  `.execute(db);
}

/**
 * Refuses rollback while any lease, dispatch-boundary or recovery-reason
 * evidence exists.
 *
 * Nulling or deleting that evidence to make rollback succeed is exactly what
 * F062.1 `mayEraseEvidence()` forbids, so the refusal is unconditional and
 * there is no cleanup path inside the migration. Where the three columns are
 * empty there is nothing to lose, and rollback restores F062.2D-2A's
 * constraints and guard exactly.
 */
export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    set local lock_timeout = '5s';
    lock table integration_delivery_attempt in access exclusive mode;
    do $$ begin
      if exists (select 1 from integration_delivery_attempt
        where claim_expires_at is not null
           or dispatch_started_at is not null
           or reason_code is not null) then
        raise exception 'Retained integration lease, dispatch-boundary or recovery-reason evidence prevents rollback';
      end if;
    end $$;

    drop index if exists integration_attempt_lease_expiry;

    -- Restore the F062.2D-2A guard verbatim.
    create or replace function guard_integration_delivery_attempt() returns trigger
      language plpgsql as $$
    declare obligation integration_outbox;
    begin
      if TG_OP in ('DELETE','TRUNCATE') then
        raise exception 'Integration delivery attempts are evidence and are never deleted';
      end if;

      if TG_OP = 'INSERT' then
        if NEW.outcome is not null or NEW.completed_at is not null
          or NEW.failure_category is not null then
          raise exception 'Integration delivery attempt must be created open';
        end if;

        select * into obligation from integration_outbox
          where organization_id = NEW.organization_id
            and id = NEW.integration_outbox_id;
        if not found then
          raise exception 'Integration delivery attempt requires an obligation owned by its Organization';
        end if;
        if NEW.integration_connector_id <> obligation.integration_connector_id then
          raise exception 'Integration delivery attempt must name its obligation connector';
        end if;
        if NEW.connector_configuration_revision
             <> obligation.pinned_connector_configuration_revision then
          raise exception 'Integration delivery attempt must pin the obligation semantic revision';
        end if;

        select coalesce(max(attempt_number), 0) + 1 into NEW.attempt_number
          from integration_delivery_attempt
          where organization_id = NEW.organization_id
            and integration_outbox_id = NEW.integration_outbox_id;
        select coalesce(max(claim_generation), 0) + 1 into NEW.claim_generation
          from integration_delivery_attempt
          where organization_id = NEW.organization_id
            and integration_outbox_id = NEW.integration_outbox_id;

        NEW.started_at = clock_timestamp();
        NEW.mutation_txid = txid_current();
        return NEW;
      end if;

      if OLD.completed_at is not null then
        raise exception 'A settled integration delivery attempt is immutable';
      end if;
      if NEW.outcome is null or NEW.completed_at is null then
        raise exception 'Integration delivery attempt may only be updated to settle it';
      end if;
      if NEW.id <> OLD.id
        or NEW.organization_id <> OLD.organization_id
        or NEW.integration_outbox_id <> OLD.integration_outbox_id
        or NEW.integration_connector_id <> OLD.integration_connector_id
        or NEW.attempt_number <> OLD.attempt_number
        or NEW.claim_generation <> OLD.claim_generation
        or NEW.claim_token_digest <> OLD.claim_token_digest
        or NEW.connector_configuration_revision <> OLD.connector_configuration_revision
        or NEW.capability_snapshot is distinct from OLD.capability_snapshot
        or NEW.started_at <> OLD.started_at then
        raise exception 'Integration delivery attempt claim identity is immutable';
      end if;
      NEW.completed_at = clock_timestamp();
      return NEW;
    end $$;

    -- Drop this migration's constraints explicitly rather than relying on
    -- column-drop cascade, so the set removed is the set named here.
    alter table integration_delivery_attempt
      drop constraint if exists integration_attempt_settlement_explained,
      drop constraint if exists integration_attempt_open_carries_no_evidence,
      drop constraint if exists integration_attempt_success_carries_no_reason,
      drop constraint if exists integration_attempt_lifecycle_reason_excludes_category,
      drop constraint if exists integration_attempt_permanent_requires_category,
      drop constraint if exists integration_attempt_pre_dispatch_reason_shape,
      drop constraint if exists integration_attempt_uncertain_reason_shape,
      drop constraint if exists integration_attempt_reason_code_vocabulary,
      drop constraint if exists integration_attempt_transient_category_shape,
      drop constraint if exists integration_attempt_timeout_is_ambiguous,
      drop constraint if exists integration_attempt_lease_after_start,
      drop constraint if exists integration_attempt_dispatch_not_before_start;

    alter table integration_delivery_attempt
      drop column reason_code,
      drop column dispatch_started_at,
      drop column claim_expires_at;

    -- Restore F062.2D-2A's settlement rule, unnamed exactly as it was.
    alter table integration_delivery_attempt
      add check (outcome is null or outcome = 'succeeded'
                 or failure_category is not null);
  `.execute(db);
}
