import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

/** Ordinal 58. F062.2D-2C-3B-2, implementing the destination `Retry-After`
 * evidence model frozen by F062.2D-2C-3B-0 §14-§18 and §28, and named as
 * remaining work by F062.2D-2C-3B-1 §14.
 *
 * **Persistence only. Nothing here executes policy.** No worker function is
 * changed, no lease is authored, no retry is scheduled, no recovery runs, no
 * value is clamped, and **not one policy number is selected**. No grant, no
 * role, no route, no service, no CLI and no seed is added.
 *
 * **The column is NULL-only until F062.2D-2C-3C.**
 * `complete_integration_attempt` is the only function that settles an attempt,
 * its seven-parameter signature is frozen by F062.2D-2C-3-0 §27.3, and it has
 * no parameter that could carry the delay. The eighth parameter is a reviewed
 * signature change owned by 3C (3B-0 §15). This is the established pattern in
 * this program: `claim_expires_at` landed in 2C-1 and stayed NULL until 3A,
 * and `next_attempt_at` landed in 2C-2 and stayed NULL until 3A.
 *
 * **A normalized delay, never the header and never an instant** (3B-0 §14).
 * The raw `Retry-After` header is not persisted: it is unbounded, externally
 * controlled, and would force the database to parse both `delta-seconds` and
 * HTTP-date forms in SQL. A caller-supplied absolute timestamp is rejected by
 * shape, because converting a stated delay into an instant needs a clock and
 * the database authors timestamps. What is stored is a bounded non-negative
 * count of seconds; the absolute floor is computed at schedule time by 3C and
 * never stored.
 *
 * **This is the first caller-supplied, externally-influenced value ever
 * persisted on `integration_delivery_attempt`** (3B-0 §17). Every other caller
 * input on that table is either a fence argument that is compared and
 * discarded, or a value the guard overwrites with its own. That makes the
 * three constraints below a security boundary rather than hygiene.
 *
 * **Zero is legal, and the platform ceiling is deliberately not a constraint.**
 * A destination may state "retry immediately", so the lower bound is `>= 0`
 * rather than the `> 0` used for a lease or a budget. The upper bound
 * (`max_destination_retry_delay_seconds`) is enforced in the function at
 * settlement time, not here, because it is a policy revision that may change
 * while this evidence is immutable (3B-0 §17).
 *
 * **Nothing is backfilled.** Every existing attempt keeps NULL, which is the
 * true statement that the destination stated no retry floor for it. All three
 * constraints are one-directional, so no pre-existing row -- settled, open,
 * rate-limited or otherwise -- becomes illegal.
 *
 * **The guard is extended, never replaced.** It is `CREATE OR REPLACE`d from
 * Migration 57's live definition by asserted transformation: all 149 of its
 * lines are preserved in order and 33 are added, and `down()` restores the
 * Migration 57 definition verbatim.
 */
export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    set local lock_timeout = '5s';
    lock table integration_delivery_attempt in access exclusive mode;

    -- ------------------------------------------------------------------
    -- 1. The evidence column: nullable, NO default. A default would be a
    --    policy number chosen by a migration, and there is no number here.
    --
    --    integer seconds, not interval: no interval column exists anywhere
    --    in this schema, and interval comparison normalises a month to 30
    --    days -- not what belongs under a security-sensitive comparison.
    -- ------------------------------------------------------------------
    alter table integration_delivery_attempt
      add column destination_retry_after_seconds integer;

    -- ------------------------------------------------------------------
    -- 2. The three structural bounds (3B-0 §17).
    -- ------------------------------------------------------------------
    alter table integration_delivery_attempt
      -- A negative delay is the obvious way to force an immediate or
      -- past-dated retry. Zero is legal: a destination may state "retry
      -- immediately", unlike a lease or a budget where zero is meaningless.
      add constraint integration_attempt_retry_after_nonnegative check (
        destination_retry_after_seconds is null
          or destination_retry_after_seconds >= 0),
      -- NULL-SAFE, and this is load-bearing rather than stylistic.
      -- PostgreSQL satisfies a CHECK when the expression is true OR NULL.
      -- Written as failure_category = 'rate_limited' this check would
      -- evaluate to NULL for a SUCCESSFUL settlement -- where Migration 52
      -- requires the category to be NULL -- and the evidence would be
      -- admitted by *unknown*. is not distinct from is two-valued, so a
      -- NULL category is refused exactly like a wrong one.
      add constraint integration_attempt_retry_after_rate_limited check (
        destination_retry_after_seconds is null
          or failure_category is not distinct from 'rate_limited'),
      -- Evidence of what a destination answered cannot exist before the
      -- attempt is settled; this also closes the dispatch-boundary update,
      -- where the attempt is still open. ONE-DIRECTIONAL deliberately: the
      -- biconditional would break every pre-58 settled attempt, exactly as
      -- it would have for the settlement policy pin.
      add constraint integration_attempt_retry_after_settled check (
        destination_retry_after_seconds is null or completed_at is not null);

    -- ------------------------------------------------------------------
    -- 3. The attempt guard, extended from its Migration 57 definition.
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

        -- F062.2D-2C-3B-1. A settlement policy pin justifies a schedule
        -- produced by a settlement, so it cannot exist on an attempt
        -- that is by definition being created open. The CLAIM pin may be
        -- supplied here, because a future 3C claim authors it at
        -- creation; in this slice nothing supplies it and it stays NULL.
        if NEW.settlement_policy_revision is not null then
          raise exception 'Integration delivery attempt must be created without a settlement policy revision';
        end if;

        -- F062.2D-2C-3B-2. Destination retry evidence records what a
        -- destination answered during one transmission, so it cannot
        -- predate the transmission. An attempt is created open, before any
        -- dispatch and before any settlement.
        if NEW.destination_retry_after_seconds is not null then
          raise exception 'Integration delivery attempt must be created without destination retry evidence';
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

      -- F062.2D-2C-3B-1. The claim policy pin is write-once at creation:
      -- it records which platform revision authorised this lease, so an
      -- update could only ever rewrite that justification.
      if NEW.claim_policy_revision is distinct from OLD.claim_policy_revision then
        raise exception 'The integration claim policy revision is write-once and cannot be changed or cleared';
      end if;

      -- F062.2D-2C-3B-1. The settlement policy pin may appear only as
      -- part of a settlement, and never changes or clears afterwards.
      -- Settled rows are already immutable above, so the only way to set
      -- it is the settling update itself; these checks make that
      -- explicit rather than relying on the earlier refusal, and they
      -- also cover the dispatch-boundary update, which is reached below.
      if OLD.settlement_policy_revision is not null
        and NEW.settlement_policy_revision
          is distinct from OLD.settlement_policy_revision then
        raise exception 'The integration settlement policy revision is write-once and cannot be changed or cleared';
      end if;
      if NEW.settlement_policy_revision is not null and NEW.completed_at is null then
        raise exception 'An integration settlement policy revision requires a settled attempt';
      end if;

      -- F062.2D-2C-3B-2. Destination retry evidence may appear only as part
      -- of a rate_limited settlement, and never changes or clears
      -- afterwards. Settled rows are already immutable above, so the only
      -- way to set it is the settling update itself; these checks make that
      -- explicit rather than relying on the earlier refusal, and the
      -- settled-attempt rule also covers the dispatch-boundary update,
      -- which is reached below.
      if OLD.destination_retry_after_seconds is not null
        and NEW.destination_retry_after_seconds
          is distinct from OLD.destination_retry_after_seconds then
        raise exception 'Destination retry evidence is write-once and cannot be changed or cleared';
      end if;
      if NEW.destination_retry_after_seconds is not null and NEW.completed_at is null then
        raise exception 'Destination retry evidence requires a settled attempt';
      end if;
      -- NULL-SAFE deliberately, and this is not stylistic. Written as
      -- NEW.failure_category <> 'rate_limited' the comparison yields NULL
      -- for a successful settlement, the branch would not be taken, and the
      -- evidence would be admitted by *unknown*. is distinct from is
      -- two-valued, so a NULL category is refused like any other wrong one.
      if NEW.destination_retry_after_seconds is not null
        and NEW.failure_category is distinct from 'rate_limited' then
        raise exception 'Destination retry evidence is legal only for a rate_limited settlement';
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
  `.execute(db);
}

/**
 * Refuses rollback while ANY destination retry evidence exists.
 *
 * One condition, because this slice adds one evidence class -- the
 * single-condition analogue of Migration 57's five. A stated retry floor is
 * what a destination asked for during a real transmission, so it is business
 * evidence, and the refusal protects it rather than deleting it.
 *
 * Nothing is deleted, nulled or rewritten to make rollback succeed. A clean
 * rollback is possible only from the state immediately after apply, where the
 * column is NULL everywhere -- and there it destroys nothing.
 */
export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    set local lock_timeout = '5s';
    lock table integration_delivery_attempt in access exclusive mode;

    do $$ begin
      if exists (select 1 from integration_delivery_attempt
        where destination_retry_after_seconds is not null) then
        raise exception
          'Retained integration destination retry evidence prevents rollback';
      end if;
    end $$;

    -- Restore the F062.2D-2C-3B-1 attempt guard verbatim. This precedes the
    -- column drop so the function never references a column that is gone.
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

        -- F062.2D-2C-3B-1. A settlement policy pin justifies a schedule
        -- produced by a settlement, so it cannot exist on an attempt
        -- that is by definition being created open. The CLAIM pin may be
        -- supplied here, because a future 3C claim authors it at
        -- creation; in this slice nothing supplies it and it stays NULL.
        if NEW.settlement_policy_revision is not null then
          raise exception 'Integration delivery attempt must be created without a settlement policy revision';
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

      -- F062.2D-2C-3B-1. The claim policy pin is write-once at creation:
      -- it records which platform revision authorised this lease, so an
      -- update could only ever rewrite that justification.
      if NEW.claim_policy_revision is distinct from OLD.claim_policy_revision then
        raise exception 'The integration claim policy revision is write-once and cannot be changed or cleared';
      end if;

      -- F062.2D-2C-3B-1. The settlement policy pin may appear only as
      -- part of a settlement, and never changes or clears afterwards.
      -- Settled rows are already immutable above, so the only way to set
      -- it is the settling update itself; these checks make that
      -- explicit rather than relying on the earlier refusal, and they
      -- also cover the dispatch-boundary update, which is reached below.
      if OLD.settlement_policy_revision is not null
        and NEW.settlement_policy_revision
          is distinct from OLD.settlement_policy_revision then
        raise exception 'The integration settlement policy revision is write-once and cannot be changed or cleared';
      end if;
      if NEW.settlement_policy_revision is not null and NEW.completed_at is null then
        raise exception 'An integration settlement policy revision requires a settled attempt';
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

    alter table integration_delivery_attempt
      drop constraint integration_attempt_retry_after_nonnegative,
      drop constraint integration_attempt_retry_after_rate_limited,
      drop constraint integration_attempt_retry_after_settled;

    alter table integration_delivery_attempt
      drop column destination_retry_after_seconds;
  `.execute(db);
}
