import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

/**
 * F062.2D-2C-2 — ordered-stream pinning and retry-eligibility persistence.
 *
 * > **NO STRICT-FIFO CLAIM PREDICATE EXISTS YET. NO RETRY SCHEDULER EXISTS.
 * > NO BACKOFF IS CALCULATED. NO WORKER RUNS.**
 *
 * Implements the persistence half of F062.2D-2C-0A §15 and §16. Two nullable
 * columns become one nullable and one `NOT NULL`, two named constraints, one
 * guard extension and one partial unique index. **No function is added or
 * changed**, and F062.2D-3 remains blocked.
 *
 * ## `requires_ordered_delivery` is database-authored from the PINNED snapshot
 *
 * The ordering contract belongs to the connector revision the obligation
 * pinned, never to the connector's current row. The guard reads the pinned
 * `integration_connector_audit` snapshot — the same row it already required to
 * exist — and derives `supports_ordering = 'per_aggregate'`. A caller that
 * omits the value gets the authoritative one; a caller that supplies a value
 * contradicting the snapshot is **refused**, which is the convention
 * F062.2C already uses for `state`.
 *
 * So an administrator switching a connector from `per_aggregate` to `none`
 * cannot retroactively unblock obligations enqueued under an ordering promise,
 * and the reverse switch cannot retroactively block work enqueued without one.
 *
 * ## The index is MUTUAL EXCLUSION ONLY
 *
 * `integration_outbox_ordered_stream_in_flight` guarantees at most one
 * `dispatching` or `ambiguous` obligation per ordered aggregate stream. **It
 * does not guarantee FIFO**, and nothing here claims it does: an earlier
 * sibling that is `retrying` or `pending` is not in the predicate at all, so a
 * newer obligation could still be claimed first. The strict-FIFO predecessor
 * predicate is **F062.2D-2C-3's** work, together with its own concurrency
 * tests, because it is function-enforced and the index cannot catch a bug in
 * it.
 *
 * `accepted` is deliberately non-blocking (F062.2D-2C-0A §17): a connector
 * without `reports_terminal_state` can never reach `acknowledged`, so
 * requiring it would block that stream forever.
 *
 * ## `next_attempt_at` is representational in this slice
 *
 * Nothing computes it. The completion function is byte-unchanged and writes no
 * schedule, so a `retrying` obligation legitimately carries `NULL` — which
 * means **not currently retry-eligible**, the fail-closed reading. The only
 * legal outbox `UPDATE` is a state transition, and the guard refuses an
 * update that changes nothing, so a schedule can be written **only at the
 * moment of a transition** and cannot be rewritten while the obligation stays
 * `retrying`. That is deliberately conservative: F062.2D-2C-3's completion and
 * recovery functions author schedules at exactly that moment.
 *
 * No delay, exponent, jitter, ceiling or horizon is encoded. No scheduler, no
 * timer, and no state changes because a timestamp became due.
 *
 * ## Deliberately not added
 *
 * `attempt_count`, `retry_count`, `recovery_count` — `attempt_number` remains
 * the evidence ordinal and the destination retry budget is derived later from
 * boundary-crossing destination evidence (F062.2D-2C-0A §18.2). No
 * schedule-source column: the settling attempt's `reason_code` already
 * distinguishes a platform recovery delay from destination backoff. No retry
 * polling index — F062.2D-2C-3 will know the exact claim query.
 */
export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    -- ------------------------------------------------------------------
    -- Both columns arrive nullable so existing rows are not forced to carry
    -- fabricated history. requires_ordered_delivery is tightened to NOT NULL
    -- below, after it is derived from each row's own pinned snapshot.
    -- ------------------------------------------------------------------
    alter table integration_outbox
      add column next_attempt_at timestamptz,
      add column requires_ordered_delivery boolean;

    -- ------------------------------------------------------------------
    -- Backfill from the PINNED connector audit snapshot.
    --
    -- Never from integration_connector: that row carries the connector's
    -- CURRENT capabilities, and reinterpreting historical intent through them
    -- is the exact mistake the pin exists to prevent.
    -- ------------------------------------------------------------------
    -- The row guard refuses any UPDATE that does not move the delivery
    -- state, which is correct for an application caller and wrong for a
    -- migration backfilling a derived column. It is suspended for exactly
    -- this statement and restored on the next line; a failure anywhere in
    -- this migration rolls the suspension back with everything else.
    alter table integration_outbox disable trigger integration_outbox_guard;
    update integration_outbox o
       set requires_ordered_delivery = (a.supports_ordering = 'per_aggregate')
      from integration_connector_audit a
     where a.organization_id = o.organization_id
       and a.integration_connector_id = o.integration_connector_id
       and a.configuration_revision = o.pinned_connector_configuration_revision
       and a.revision_advanced;
    alter table integration_outbox enable trigger integration_outbox_guard;

    do $$
    declare
      orphaned bigint;
      ambiguous_snapshots bigint;
      uninterpretable bigint;
      missing_revision bigint;
      colliding bigint;
    begin
      -- Fail closed: an obligation whose pinned snapshot is absent has no
      -- derivable ordering semantics, and guessing one is not permitted.
      -- Defaulting the unknown to false would silently drop an ordering
      -- promise.
      select count(*) into orphaned from integration_outbox
        where requires_ordered_delivery is null;
      if orphaned > 0 then
        raise exception
          'Cannot derive ordering semantics: % integration intents have no advancing pinned connector snapshot',
          orphaned;
      end if;

      -- Fail closed: more than one advancing snapshot for one pinned revision
      -- would make the derivation non-deterministic.
      select count(*) into ambiguous_snapshots from (
        select o.id from integration_outbox o
          join integration_connector_audit a
            on a.organization_id = o.organization_id
           and a.integration_connector_id = o.integration_connector_id
           and a.configuration_revision = o.pinned_connector_configuration_revision
           and a.revision_advanced
          group by o.id having count(*) > 1) as duplicated;
      if ambiguous_snapshots > 0 then
        raise exception
          'Cannot derive ordering semantics: % integration intents match more than one advancing pinned snapshot',
          ambiguous_snapshots;
      end if;

      -- Fail closed: an ordering capability outside the reviewed vocabulary
      -- cannot be interpreted. The audit CHECK should make this unreachable;
      -- it is asserted rather than assumed.
      select count(*) into uninterpretable
        from integration_connector_audit a
        join integration_outbox o
          on a.organization_id = o.organization_id
         and a.integration_connector_id = o.integration_connector_id
         and a.configuration_revision = o.pinned_connector_configuration_revision
         and a.revision_advanced
        where a.supports_ordering not in ('none', 'per_aggregate');
      if uninterpretable > 0 then
        raise exception
          'Cannot derive ordering semantics: % pinned snapshots carry an uninterpretable ordering capability',
          uninterpretable;
      end if;

      -- F062.2D-2C-0A §16. An ordered stream is sequenced by
      -- aggregate_revision, so an ordered obligation without one cannot be
      -- placed in its stream. created_at is enqueue time, not causal order,
      -- and is deliberately NOT substituted.
      select count(*) into missing_revision from integration_outbox
        where requires_ordered_delivery and aggregate_revision is null;
      if missing_revision > 0 then
        raise exception
          'Cannot enforce ordered delivery: % existing ordered intents have no aggregate_revision',
          missing_revision;
      end if;

      -- Fail closed before the unique index is built, so the migration
      -- surfaces a pre-existing inconsistency rather than resolving it. No
      -- winner is selected, no state rewritten, no row marked unordered and
      -- no evidence deleted.
      select count(*) into colliding from (
        select 1 from integration_outbox
          where requires_ordered_delivery
            and state in ('dispatching', 'ambiguous')
          group by organization_id, integration_connector_id,
                   aggregate_type, aggregate_id
          having count(*) > 1) as conflicts;
      if colliding > 0 then
        raise exception
          'Cannot enforce ordered delivery: % aggregate streams already hold more than one in-flight or ambiguous intent',
          colliding;
      end if;
    end $$;

    -- Derived for every row, so the column can carry no default that would
    -- bypass snapshot derivation for a future insert.
    alter table integration_outbox
      alter column requires_ordered_delivery set not null;

    alter table integration_outbox
      -- F062.2D-2C-0A §16, as a table invariant rather than guard-only.
      add constraint integration_outbox_ordered_requires_revision
        check (requires_ordered_delivery = false or aggregate_revision is not null),
      -- A retry schedule exists only while retrying. Leaving that state
      -- requires clearing it, so no terminal or in-flight row retains one.
      add constraint integration_outbox_retry_schedule_only_when_retrying
        check (next_attempt_at is null or state = 'retrying');

    -- ------------------------------------------------------------------
    -- Extend the F062.2C/F062.2D-2A guard. Every existing protection is
    -- preserved verbatim; the snapshot lookup that already had to succeed now
    -- also yields the ordering derivation.
    -- ------------------------------------------------------------------
    create or replace function guard_integration_outbox() returns trigger
      language plpgsql as $$
    declare
      connector integration_connector;
      snapshot integration_connector_audit;
      ordered boolean;
    begin
      if TG_OP in ('DELETE','TRUNCATE') then
        raise exception 'Integration outbox intents are never deleted';
      end if;

      if TG_OP = 'INSERT' then
        select * into connector from integration_connector
          where organization_id = NEW.organization_id
            and id = NEW.integration_connector_id
          for share;
        if not found then
          raise exception 'Integration intent requires a connector owned by its Organization';
        end if;
        if connector.lifecycle_state = 'retired' then
          raise exception 'A retired integration connector accepts no new intents';
        end if;
        if NEW.pinned_connector_configuration_revision <> connector.configuration_revision then
          raise exception 'Integration intent must pin the current connector semantic revision';
        end if;
        -- The same snapshot F062.2C already required, now read rather than
        -- merely tested, so the ordering contract comes from the pinned
        -- revision instead of the connector's mutable current row.
        select * into snapshot from integration_connector_audit a
          where a.organization_id = NEW.organization_id
            and a.integration_connector_id = NEW.integration_connector_id
            and a.configuration_revision = NEW.pinned_connector_configuration_revision
            and a.revision_advanced;
        if not found then
          raise exception 'Integration intent must pin an existing authoritative connector semantic snapshot';
        end if;
        if NEW.state <> 'pending' then
          raise exception 'Integration intent delivery state is not caller controlled';
        end if;

        -- F062.2D-2C-2. The ordering requirement is derived, never trusted.
        ordered := snapshot.supports_ordering = 'per_aggregate';
        if NEW.requires_ordered_delivery is null then
          NEW.requires_ordered_delivery = ordered;
        elsif NEW.requires_ordered_delivery <> ordered then
          -- Fail closed rather than silently correcting: a caller that
          -- supplied the wrong ordering contract has a bug, and quietly
          -- overwriting it would hide the bug exactly as F062.2C reasoned
          -- about a caller-supplied delivery state.
          raise exception 'Integration intent ordering requirement is derived from the pinned connector revision and is not caller controlled';
        end if;
        if NEW.requires_ordered_delivery and NEW.aggregate_revision is null then
          raise exception 'An ordered integration intent requires an aggregate revision to sequence its stream';
        end if;
        -- No schedule may exist before any attempt has been made.
        if NEW.next_attempt_at is not null then
          raise exception 'Integration intent retry scheduling is not caller controlled';
        end if;

        NEW.created_at = clock_timestamp();
        return NEW;
      end if;

      -- UPDATE: identity and intent semantics remain immutable. Only the
      -- delivery state may move, and only along a reviewed edge.
      if NEW.id <> OLD.id
        or NEW.organization_id <> OLD.organization_id
        or NEW.integration_connector_id <> OLD.integration_connector_id
        or NEW.integration_id <> OLD.integration_id
        or NEW.contract_kind <> OLD.contract_kind
        or NEW.integration_type <> OLD.integration_type
        or NEW.schema_version <> OLD.schema_version
        or NEW.aggregate_type <> OLD.aggregate_type
        or NEW.aggregate_id <> OLD.aggregate_id
        or NEW.aggregate_revision is distinct from OLD.aggregate_revision
        or NEW.origin_kind <> OLD.origin_kind
        or NEW.origin_connector_id is distinct from OLD.origin_connector_id
        or NEW.correlation_id <> OLD.correlation_id
        or NEW.causation_id is distinct from OLD.causation_id
        or NEW.deployment_environment <> OLD.deployment_environment
        or NEW.payload_mode <> OLD.payload_mode
        or NEW.pinned_connector_configuration_revision
             <> OLD.pinned_connector_configuration_revision
        or NEW.occurred_at <> OLD.occurred_at
        or NEW.created_at <> OLD.created_at then
        raise exception 'Integration intent identity and semantics are immutable';
      end if;
      -- F062.2D-2C-2. Pinned ordering evidence is immutable: a later
      -- connector revision must not reinterpret an existing obligation.
      if NEW.requires_ordered_delivery <> OLD.requires_ordered_delivery then
        raise exception 'Integration intent ordering requirement is pinned evidence and is immutable';
      end if;
      if NEW.state = OLD.state then
        raise exception 'Integration intent update changes nothing';
      end if;

      -- The reviewed non-age transition whitelist, mirroring F062.1
      -- deliveryStateTransitions. No edge is predicated on elapsed time, and
      -- dead_lettered has no outgoing edge because authorized replay requires
      -- audit evidence that does not exist yet.
      if not (
        (OLD.state = 'pending' and NEW.state in ('dispatching','refused'))
        or (OLD.state = 'dispatching' and NEW.state in ('accepted','retrying',
              'ambiguous','failed_permanent','dead_lettered'))
        or (OLD.state = 'retrying' and NEW.state in ('dispatching','dead_lettered'))
        or (OLD.state = 'accepted' and NEW.state = 'acknowledged')
        or (OLD.state = 'ambiguous' and NEW.state in ('dispatching','accepted',
              'failed_permanent','dead_lettered'))
      ) then
        raise exception 'Unsupported integration delivery state transition';
      end if;

      -- F062.2D-2C-2. A retry schedule exists only while retrying, so an
      -- obligation leaving that state must clear it in the same transition.
      -- Because the guard above refuses an update that changes nothing, a
      -- schedule can be written ONLY at a transition and never rewritten in
      -- place: F062.2D-2C-3 authors it at exactly that moment.
      if NEW.state <> 'retrying' and NEW.next_attempt_at is not null then
        raise exception 'An integration retry schedule exists only while the intent is retrying';
      end if;

      -- Two edges carry a capability precondition, read from the snapshot the
      -- intent pinned rather than from the connector's current row.
      if (OLD.state = 'accepted' and NEW.state = 'acknowledged')
        or (OLD.state = 'ambiguous' and NEW.state = 'dispatching') then
        select * into snapshot from integration_connector_audit a
          where a.organization_id = NEW.organization_id
            and a.integration_connector_id = NEW.integration_connector_id
            and a.configuration_revision = NEW.pinned_connector_configuration_revision
            and a.revision_advanced;
        if not found then
          raise exception 'Integration delivery transition requires the pinned connector snapshot';
        end if;
        if NEW.state = 'acknowledged' and not snapshot.reports_terminal_state then
          raise exception 'Only a connector that reports terminal state may acknowledge delivery';
        end if;
        if OLD.state = 'ambiguous' and NEW.state = 'dispatching'
          and not snapshot.supports_idempotency_key then
          raise exception 'An ambiguous delivery may not be retried without idempotency support';
        end if;
      end if;

      return NEW;
    end $$;

    -- ------------------------------------------------------------------
    -- Ordered-stream mutual exclusion.
    --
    -- At most one blocking obligation per ordered aggregate stream. Only
    -- dispatching and ambiguous occupy the slot: pending and retrying are
    -- absent by design, so the index constrains CONCURRENCY and never queue
    -- depth, and F062.1 mayEnqueue stays intact. accepted is non-blocking.
    --
    -- MUTUAL EXCLUSION ONLY. This is not FIFO; see the header.
    -- ------------------------------------------------------------------
    create unique index integration_outbox_ordered_stream_in_flight
      on integration_outbox
        (organization_id, integration_connector_id, aggregate_type, aggregate_id)
      where requires_ordered_delivery and state in ('dispatching', 'ambiguous');
  `.execute(db);
}

/**
 * Rolls back only where nothing durable is lost.
 *
 * The two columns differ in kind, so they are judged separately:
 *
 * - **`next_attempt_at` is durable scheduling evidence.** Once non-null it
 *   records a decision, so rollback refuses rather than nulling it.
 * - **`requires_ordered_delivery` is denormalised pinned evidence**, fully
 *   reconstructable from the immutable connector audit. Rollback may drop it
 *   only while every row still matches its pinned snapshot exactly; a
 *   mismatch means the column carries information the audit does not, and
 *   dropping it would lose that.
 *
 * No outbox, attempt, connector or audit row is deleted or rewritten.
 */
export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    set local lock_timeout = '5s';
    lock table integration_outbox in access exclusive mode;
    do $$
    declare
      scheduled bigint;
      drifted bigint;
    begin
      select count(*) into scheduled from integration_outbox
        where next_attempt_at is not null;
      if scheduled > 0 then
        raise exception
          'Retained integration retry scheduling evidence prevents rollback: % intents carry next_attempt_at',
          scheduled;
      end if;

      -- Every value must still be exactly what its pinned snapshot implies,
      -- or the column is not purely derived and dropping it loses evidence.
      select count(*) into drifted from integration_outbox o
        join integration_connector_audit a
          on a.organization_id = o.organization_id
         and a.integration_connector_id = o.integration_connector_id
         and a.configuration_revision = o.pinned_connector_configuration_revision
         and a.revision_advanced
        where o.requires_ordered_delivery
              <> (a.supports_ordering = 'per_aggregate');
      if drifted > 0 then
        raise exception
          'Integration ordering evidence no longer matches its pinned snapshot and prevents rollback: % intents',
          drifted;
      end if;
      -- A row with no reachable snapshot could not be re-derived on reapply.
      select count(*) into drifted from integration_outbox o
        where not exists (
          select 1 from integration_connector_audit a
            where a.organization_id = o.organization_id
              and a.integration_connector_id = o.integration_connector_id
              and a.configuration_revision = o.pinned_connector_configuration_revision
              and a.revision_advanced);
      if drifted > 0 then
        raise exception
          'Integration intents without a reachable pinned snapshot prevent rollback: %',
          drifted;
      end if;
    end $$;

    drop index if exists integration_outbox_ordered_stream_in_flight;

    -- Restore the F062.2D-2A guard verbatim.
    create or replace function guard_integration_outbox() returns trigger
      language plpgsql as $$
    declare connector integration_connector; snapshot integration_connector_audit;
    begin
      if TG_OP in ('DELETE','TRUNCATE') then
        raise exception 'Integration outbox intents are never deleted';
      end if;

      if TG_OP = 'INSERT' then
        select * into connector from integration_connector
          where organization_id = NEW.organization_id
            and id = NEW.integration_connector_id
          for share;
        if not found then
          raise exception 'Integration intent requires a connector owned by its Organization';
        end if;
        if connector.lifecycle_state = 'retired' then
          raise exception 'A retired integration connector accepts no new intents';
        end if;
        if NEW.pinned_connector_configuration_revision <> connector.configuration_revision then
          raise exception 'Integration intent must pin the current connector semantic revision';
        end if;
        if not exists (select 1 from integration_connector_audit a
          where a.organization_id = NEW.organization_id
            and a.integration_connector_id = NEW.integration_connector_id
            and a.configuration_revision = NEW.pinned_connector_configuration_revision
            and a.revision_advanced) then
          raise exception 'Integration intent must pin an existing authoritative connector semantic snapshot';
        end if;
        if NEW.state <> 'pending' then
          raise exception 'Integration intent delivery state is not caller controlled';
        end if;
        NEW.created_at = clock_timestamp();
        return NEW;
      end if;

      if NEW.id <> OLD.id
        or NEW.organization_id <> OLD.organization_id
        or NEW.integration_connector_id <> OLD.integration_connector_id
        or NEW.integration_id <> OLD.integration_id
        or NEW.contract_kind <> OLD.contract_kind
        or NEW.integration_type <> OLD.integration_type
        or NEW.schema_version <> OLD.schema_version
        or NEW.aggregate_type <> OLD.aggregate_type
        or NEW.aggregate_id <> OLD.aggregate_id
        or NEW.aggregate_revision is distinct from OLD.aggregate_revision
        or NEW.origin_kind <> OLD.origin_kind
        or NEW.origin_connector_id is distinct from OLD.origin_connector_id
        or NEW.correlation_id <> OLD.correlation_id
        or NEW.causation_id is distinct from OLD.causation_id
        or NEW.deployment_environment <> OLD.deployment_environment
        or NEW.payload_mode <> OLD.payload_mode
        or NEW.pinned_connector_configuration_revision
             <> OLD.pinned_connector_configuration_revision
        or NEW.occurred_at <> OLD.occurred_at
        or NEW.created_at <> OLD.created_at then
        raise exception 'Integration intent identity and semantics are immutable';
      end if;
      if NEW.state = OLD.state then
        raise exception 'Integration intent update changes nothing';
      end if;

      if not (
        (OLD.state = 'pending' and NEW.state in ('dispatching','refused'))
        or (OLD.state = 'dispatching' and NEW.state in ('accepted','retrying',
              'ambiguous','failed_permanent','dead_lettered'))
        or (OLD.state = 'retrying' and NEW.state in ('dispatching','dead_lettered'))
        or (OLD.state = 'accepted' and NEW.state = 'acknowledged')
        or (OLD.state = 'ambiguous' and NEW.state in ('dispatching','accepted',
              'failed_permanent','dead_lettered'))
      ) then
        raise exception 'Unsupported integration delivery state transition';
      end if;

      if (OLD.state = 'accepted' and NEW.state = 'acknowledged')
        or (OLD.state = 'ambiguous' and NEW.state = 'dispatching') then
        select * into snapshot from integration_connector_audit a
          where a.organization_id = NEW.organization_id
            and a.integration_connector_id = NEW.integration_connector_id
            and a.configuration_revision = NEW.pinned_connector_configuration_revision
            and a.revision_advanced;
        if not found then
          raise exception 'Integration delivery transition requires the pinned connector snapshot';
        end if;
        if NEW.state = 'acknowledged' and not snapshot.reports_terminal_state then
          raise exception 'Only a connector that reports terminal state may acknowledge delivery';
        end if;
        if OLD.state = 'ambiguous' and NEW.state = 'dispatching'
          and not snapshot.supports_idempotency_key then
          raise exception 'An ambiguous delivery may not be retried without idempotency support';
        end if;
      end if;

      return NEW;
    end $$;

    alter table integration_outbox
      drop constraint if exists integration_outbox_ordered_requires_revision,
      drop constraint if exists integration_outbox_retry_schedule_only_when_retrying;

    alter table integration_outbox
      drop column requires_ordered_delivery,
      drop column next_attempt_at;
  `.execute(db);
}
