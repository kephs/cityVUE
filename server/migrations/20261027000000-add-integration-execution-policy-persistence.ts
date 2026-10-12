import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

/** Ordinal 57. F062.2D-2C-3B-1, implementing the merged F062.2D-2C-3B-0
 * execution-policy persistence and trust-boundary decision.
 *
 * **Persistence only. Nothing here executes policy.** No worker function is
 * changed, no lease is authored, no retry is scheduled, no recovery runs, no
 * `Retry-After` evidence is added, and **not one policy number is selected**.
 * The platform policy table ships with **zero rows**, so F062.2D-2C-3C fails
 * closed until a separately reviewed operator path records a revision.
 *
 * **Two authority classes, never collapsed** (3B-0 §2). Class A is
 * connector/destination policy, pinned per obligation by
 * `configuration_revision`; class B is global platform safety policy, owned by
 * the operator and versioned by its own append-only `policy_revision`.
 *
 * **Execution-policy revisions are single concern** (3B-0 Phase 0 decision
 * A+). If any of the four policy fields changes, no other change family may
 * change in the same UPDATE, and the audit category must be exactly
 * `execution_policy_changed`. The mixture is made *unrepresentable* rather
 * than resolved by a precedence rule, which is what lets the new category
 * carry structural meaning instead of application convention. This extends
 * Migration 50's existing fail-closed pattern — the same shape as its
 * `Credential rotation must not accompany a configuration change` rule — and
 * deliberately does **not** redesign the pre-existing lifecycle/capability
 * category model, whose looseness for a privileged direct writer is recorded
 * as pre-existing behaviour and left alone.
 *
 * **No grant, no role, no authoring path.** The four connector columns do not
 * authorize direct table `UPDATE`: tenant authority remains logical authority
 * through the existing reviewed connector-authoring boundary, and the audit
 * snapshot stays database-authored as a consequence of that path. No endpoint,
 * function, CLI or seed can write platform policy.
 *
 * **Nothing is backfilled** (3B-0 §26). Every existing connector, audit and
 * attempt row keeps NULL, because NULL is the true statement that execution
 * policy was never established for that revision. The consequence — that
 * pre-policy obligations need operator disposition before 3C — is 3B-0 §26.1's
 * activation gate, which this slice does not discharge.
 *
 * **Guards are extended, never replaced.** The three functions below are
 * `CREATE OR REPLACE`d from their live definitions by asserted
 * transformation, so every protection from Migrations 50, 52 and 54 is
 * preserved byte-identically and `down()` restores the originals verbatim.
 */
export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    set local lock_timeout = '5s';
    lock table integration_connector in access exclusive mode;
    lock table integration_connector_audit in access exclusive mode;
    lock table integration_delivery_attempt in access exclusive mode;

    -- ------------------------------------------------------------------
    -- 1. Connector-pinned execution policy: four columns, nullable, NO
    --    default. A default would be a policy number chosen by a migration.
    -- ------------------------------------------------------------------
    alter table integration_connector
      add column request_execution_budget_seconds integer,
      add column destination_retry_base_delay_seconds integer,
      add column destination_retry_max_delay_seconds integer,
      add column destination_retry_attempt_ceiling integer;

    alter table integration_connector
      add constraint integration_connector_execution_policy_positive check (
        (request_execution_budget_seconds is null
          or request_execution_budget_seconds > 0)
        and (destination_retry_base_delay_seconds is null
          or destination_retry_base_delay_seconds > 0)
        and (destination_retry_max_delay_seconds is null
          or destination_retry_max_delay_seconds > 0)
        and (destination_retry_attempt_ceiling is null
          or destination_retry_attempt_ceiling > 0)),
      -- All four or none. A partially configured revision is UNREPRESENTABLE,
      -- which removes the "executable because one field was set" hazard
      -- structurally instead of checking for it at claim time.
      add constraint integration_connector_execution_policy_complete check (
        (request_execution_budget_seconds is null
          and destination_retry_base_delay_seconds is null
          and destination_retry_max_delay_seconds is null
          and destination_retry_attempt_ceiling is null)
        or (request_execution_budget_seconds is not null
          and destination_retry_base_delay_seconds is not null
          and destination_retry_max_delay_seconds is not null
          and destination_retry_attempt_ceiling is not null)),
      -- The base delay never exceeds the connector's own cap. The platform
      -- clamp can still pull the EFFECTIVE cap below the base; that check is
      -- 3C's, at derivation time, and is not expressible here.
      add constraint integration_connector_retry_delay_ordered check (
        destination_retry_base_delay_seconds is null
        or destination_retry_max_delay_seconds is null
        or destination_retry_base_delay_seconds
          <= destination_retry_max_delay_seconds);

    -- ------------------------------------------------------------------
    -- 2. The identical four, mirrored into the immutable audit snapshot.
    --    The snapshot is the PINNED source every future policy read uses;
    --    the live columns exist so an authorized writer has somewhere to
    --    write and the guard has something to verify the snapshot against.
    -- ------------------------------------------------------------------
    alter table integration_connector_audit
      add column request_execution_budget_seconds integer,
      add column destination_retry_base_delay_seconds integer,
      add column destination_retry_max_delay_seconds integer,
      add column destination_retry_attempt_ceiling integer;

    alter table integration_connector_audit
      add constraint integration_connector_audit_execution_policy_positive check (
        (request_execution_budget_seconds is null
          or request_execution_budget_seconds > 0)
        and (destination_retry_base_delay_seconds is null
          or destination_retry_base_delay_seconds > 0)
        and (destination_retry_max_delay_seconds is null
          or destination_retry_max_delay_seconds > 0)
        and (destination_retry_attempt_ceiling is null
          or destination_retry_attempt_ceiling > 0)),
      -- All four or none. A partially configured revision is UNREPRESENTABLE,
      -- which removes the "executable because one field was set" hazard
      -- structurally instead of checking for it at claim time.
      add constraint integration_connector_audit_execution_policy_complete check (
        (request_execution_budget_seconds is null
          and destination_retry_base_delay_seconds is null
          and destination_retry_max_delay_seconds is null
          and destination_retry_attempt_ceiling is null)
        or (request_execution_budget_seconds is not null
          and destination_retry_base_delay_seconds is not null
          and destination_retry_max_delay_seconds is not null
          and destination_retry_attempt_ceiling is not null)),
      -- The base delay never exceeds the connector's own cap. The platform
      -- clamp can still pull the EFFECTIVE cap below the base; that check is
      -- 3C's, at derivation time, and is not expressible here.
      add constraint integration_connector_audit_retry_delay_ordered check (
        destination_retry_base_delay_seconds is null
        or destination_retry_max_delay_seconds is null
        or destination_retry_base_delay_seconds
          <= destination_retry_max_delay_seconds);

    -- ------------------------------------------------------------------
    -- 3. The new audit category. Replaces Migration 50's auto-named column
    --    check, located by its definition rather than by a guessed name so
    --    upstream drift fails loudly instead of leaving the old vocabulary
    --    in place. revision_advanced needs no change: Migration 50's
    --    existing check already ties it to "not credential_reference_rotated",
    --    so the new category advances configuration_revision by construction.
    -- ------------------------------------------------------------------
    do $$
    declare target text; found_count integer;
    begin
      select count(*), min(conname) into found_count, target
        from pg_constraint
        where conrelid = 'integration_connector_audit'::regclass
          and contype = 'c'
          and pg_get_constraintdef(oid) like '%capabilities_changed%';
      if found_count <> 1 then
        raise exception
          'Expected exactly one connector audit change-category vocabulary constraint, found %',
          found_count;
      end if;
      execute format(
        'alter table integration_connector_audit drop constraint %I', target);
    end $$;

    alter table integration_connector_audit
      add constraint integration_connector_audit_change_category_check check (
        change_category in ('registered','lifecycle_changed',
          'capabilities_changed','credential_reference_rotated',
          'execution_policy_changed'));

    -- ------------------------------------------------------------------
    -- 4. Global platform execution-safety policy.
    --
    --    NO organization_id, EVER: this is Reqro's own safety ceiling, not
    --    tenant configuration, and an Organization column is exactly how a
    --    tenant would come to own a bound that exists to protect the
    --    platform and the destination.
    --
    --    Append-only. "Current policy" is the greatest committed
    --    policy_revision -- no is_active flag and no mutable pointer, both of
    --    which would be a second mutable object able to disagree with the
    --    immutable rows it describes.
    --
    --    SHIPS WITH ZERO ROWS. Seeding one would be choosing numbers.
    -- ------------------------------------------------------------------
    create table integration_execution_safety_policy (
      -- DATABASE-AUTHORED. generated always as identity means a caller
      -- cannot choose a revision, so monotonicity is the sequence's job
      -- rather than a read-modify-write the caller performs. Gaps are
      -- ACCEPTABLE: a rolled-back transaction consumes a value, and nothing
      -- depends on contiguity because pins reference a revision by value.
      policy_revision bigint primary key generated always as identity,

      -- The eight approved platform values. Every one NOT NULL, so a
      -- revision is complete when it is inserted, and every one without a
      -- default, so no number enters the schema.
      max_claim_lease_seconds integer not null,
      lease_safety_margin_seconds integer not null,
      max_destination_retry_delay_seconds integer not null,
      max_destination_retry_attempts integer not null,
      max_retry_horizon_seconds integer not null,
      max_pre_dispatch_recoveries integer not null,
      recovery_delay_seconds integer not null,
      max_recovery_batch_size integer not null,

      -- Human and operational context. There is deliberately NO actor:
      -- no trusted operator identity model exists for this write surface, so
      -- the column could hold only self-declared text -- attribution that
      -- looks authoritative in an audit and is not. Deferred to the future
      -- reviewed operator-authoring path (3B-0 §7, §28.3).
      reason varchar(200) not null check (length(btrim(reason)) > 0),
      correlation_id uuid not null,

      -- DATABASE-AUTHORED, and forced again by the guard, so a caller cannot
      -- backdate a revision or forge its transaction evidence.
      recorded_at timestamptz not null default clock_timestamp(),
      mutation_txid bigint not null default txid_current(),

      -- Structural contract, not policy tuning: a non-positive duration,
      -- count or batch size is meaningless, and a zero margin would make
      -- budget + margin > budget false.
      check (max_claim_lease_seconds > 0),
      check (lease_safety_margin_seconds > 0),
      check (max_destination_retry_delay_seconds > 0),
      check (max_destination_retry_attempts > 0),
      check (max_retry_horizon_seconds > 0),
      check (max_pre_dispatch_recoveries > 0),
      check (recovery_delay_seconds > 0),
      check (max_recovery_batch_size > 0),
      -- Retained as a cheap backstop even though the database authors the
      -- value: a sufficiently privileged writer can still bypass identity
      -- generation with OVERRIDING SYSTEM VALUE.
      check (policy_revision > 0)
    );

    comment on table integration_execution_safety_policy is
      'Global platform execution-safety policy, operator-owned and append-only. Never organization-scoped. Carries no actor: there is no trusted operator identity model for this surface, so reason and correlation_id are the interim record.';

    -- No index beyond the primary key. The only reads are "the greatest
    -- revision" and a lookup by revision from a foreign key; the primary key
    -- index serves both.

    create function guard_integration_execution_safety_policy()
      returns trigger language plpgsql as $$
    begin
      -- Append-only: a correction is a NEW revision, never an edit. Without
      -- this, a silent UPDATE would destroy the only record of what governed
      -- a past lease, which is the whole point of pinning a revision.
      if TG_OP in ('UPDATE','DELETE','TRUNCATE') then
        raise exception 'Integration execution safety policy is append-only';
      end if;
      -- DATABASE AUTHORED. Whatever the caller supplied is discarded.
      NEW.recorded_at = clock_timestamp();
      NEW.mutation_txid = txid_current();
      return NEW;
    end $$;

    create trigger integration_execution_safety_policy_guard
      before insert or update or delete on integration_execution_safety_policy
      for each row execute function guard_integration_execution_safety_policy();
    -- TRUNCATE fires only statement-level triggers, so a row trigger would
    -- leave the table truncatable. This is a separate statement trigger.
    create trigger integration_execution_safety_policy_no_truncate
      before truncate on integration_execution_safety_policy
      execute function guard_integration_execution_safety_policy();

    -- ------------------------------------------------------------------
    -- 5. Attempt policy pins. Two, because the lease is authored at claim
    --    and its consequence at settlement, with a legitimate policy change
    --    possible in between; one column could not answer both questions.
    --
    --    bigint to match policy_revision exactly. A narrower referencing
    --    column would make every foreign-key check a cross-type comparison
    --    and would cap the pin below the range of the value it references.
    -- ------------------------------------------------------------------
    alter table integration_delivery_attempt
      add column claim_policy_revision bigint,
      add column settlement_policy_revision bigint;

    alter table integration_delivery_attempt
      -- NO ACTION (the default) on delete and on update: policy rows are
      -- durable evidence. CASCADE would delete attempt evidence and SET NULL
      -- would erase the justification, both of which F062.1's evidence rule
      -- forbids. Deletion is impossible anyway -- the guard above refuses it
      -- -- so this is defence in depth, and it is also what makes down()
      -- refuse referentially rather than only procedurally.
      add constraint integration_attempt_claim_policy_fk
        foreign key (claim_policy_revision)
        references integration_execution_safety_policy(policy_revision),
      add constraint integration_attempt_settlement_policy_fk
        foreign key (settlement_policy_revision)
        references integration_execution_safety_policy(policy_revision),
      -- ONE-DIRECTIONAL deliberately. The biconditional
      -- (pin is null iff completed_at is null) would break every pre-3B
      -- settled attempt, which has completed_at non-null and this column
      -- NULL. 3B-0 §26's no-backfill decision forces the weaker form.
      add constraint integration_attempt_settlement_policy_settled check (
        settlement_policy_revision is null or completed_at is not null);

    -- ------------------------------------------------------------------
    -- 6. The three guards, extended from their live definitions.
    -- ------------------------------------------------------------------
    create or replace function guard_integration_connector() returns trigger language plpgsql as $$
    declare semantic_change boolean; credential_change boolean;
      configuration_change boolean; policy_change boolean;
    begin
      if TG_OP in ('DELETE','TRUNCATE') then
        raise exception 'Integration connectors are retired, never deleted';
      end if;

      -- Duplicate operations are refused rather than silently normalized; a
      -- CHECK constraint cannot express this because it needs a subquery.
      if (select count(*) from unnest(NEW.operations) as o) <>
         (select count(distinct o) from unnest(NEW.operations) as o) then
        raise exception 'Integration connector operations must not repeat';
      end if;

      if TG_OP = 'INSERT' then
        if NEW.configuration_revision <> 1 or NEW.record_revision <> 1
          or NEW.lifecycle_state <> 'configured'
          or NEW.disabled_at is not null or NEW.retired_at is not null then
          raise exception 'Integration connector must start configured at revision 1';
        end if;
        NEW.created_at = clock_timestamp();
        NEW.updated_at = NEW.created_at;
        return NEW;
      end if;

      if NEW.id <> OLD.id or NEW.organization_id <> OLD.organization_id
        or NEW.connector_key <> OLD.connector_key
        or NEW.connector_kind <> OLD.connector_kind
        or NEW.created_at <> OLD.created_at then
        raise exception 'Integration connector identity is immutable';
      end if;

      -- Revision significance, encoded once: lifecycle plus every capability
      -- field. Credential rotation is deliberately NOT semantic.
      configuration_change =
        NEW.lifecycle_state is distinct from OLD.lifecycle_state
        or NEW.operations is distinct from OLD.operations
        or NEW.supports_idempotency_key is distinct from OLD.supports_idempotency_key
        or NEW.supports_read_after_write is distinct from OLD.supports_read_after_write
        or NEW.supports_reconciliation is distinct from OLD.supports_reconciliation
        or NEW.supports_webhook_callback is distinct from OLD.supports_webhook_callback
        or NEW.supports_ordering is distinct from OLD.supports_ordering
        or NEW.supports_update is distinct from OLD.supports_update
        or NEW.supports_cancel is distinct from OLD.supports_cancel
        or NEW.supports_delete is distinct from OLD.supports_delete
        or NEW.supports_current_state_sync is distinct from OLD.supports_current_state_sync
        or NEW.reports_terminal_state is distinct from OLD.reports_terminal_state
        or NEW.side_effect_risk is distinct from OLD.side_effect_risk;

      -- F062.2D-2C-3B-1. Execution policy IS configuration, so it joins
      -- the semantic boundary and advances configuration_revision. It is
      -- deliberately tracked as its own boolean rather than folded into
      -- the disjunction above, because the exclusivity rule below has to
      -- tell a policy change apart from a lifecycle or capability one.
      policy_change =
        NEW.request_execution_budget_seconds
          is distinct from OLD.request_execution_budget_seconds
        or NEW.destination_retry_base_delay_seconds
          is distinct from OLD.destination_retry_base_delay_seconds
        or NEW.destination_retry_max_delay_seconds
          is distinct from OLD.destination_retry_max_delay_seconds
        or NEW.destination_retry_attempt_ceiling
          is distinct from OLD.destination_retry_attempt_ceiling;
      semantic_change = configuration_change or policy_change;
      credential_change = NEW.credential_reference is distinct from OLD.credential_reference;

      if not semantic_change and not credential_change then
        raise exception 'Integration connector update changes nothing';
      end if;
      if semantic_change and credential_change then
        raise exception 'Credential rotation must not accompany a configuration change';
      end if;
      -- F062.2D-2C-3B-1. An execution-policy revision is SINGLE CONCERN.
      -- Policy combined with a credential rotation is already refused
      -- above, because policy_change implies semantic_change; this adds
      -- the lifecycle and capability families. The mixture is made
      -- unrepresentable rather than resolved by a precedence rule, so
      -- the audit category below can be bound to the policy delta.
      if policy_change and configuration_change then
        raise exception 'An execution policy change must not accompany a lifecycle or capability change';
      end if;

      -- EVERY accepted mutation advances the record revision. This is what
      -- makes a lost update impossible: a rotation that changes no semantics
      -- still moves the concurrency token.
      if NEW.record_revision <> OLD.record_revision + 1 then
        raise exception 'Integration connector record revision must advance exactly once';
      end if;

      if semantic_change then
        if NEW.configuration_revision <> OLD.configuration_revision + 1 then
          raise exception 'Integration connector configuration revision must advance exactly once';
        end if;
      elsif NEW.configuration_revision <> OLD.configuration_revision then
        raise exception 'Credential rotation must not advance the configuration revision';
      end if;

      -- Closed lifecycle transitions. retired is terminal and nothing returns
      -- to configured, so a decommissioned connector cannot be reactivated.
      if NEW.lifecycle_state is distinct from OLD.lifecycle_state then
        if OLD.lifecycle_state = 'retired' then
          raise exception 'A retired integration connector cannot change state';
        end if;
        if NEW.lifecycle_state = 'configured' then
          raise exception 'An integration connector cannot return to configured';
        end if;
        if not (
          (OLD.lifecycle_state = 'configured' and NEW.lifecycle_state in ('active','disabled','retired'))
          or (OLD.lifecycle_state = 'active' and NEW.lifecycle_state in ('degraded','disabled','retired'))
          or (OLD.lifecycle_state = 'degraded' and NEW.lifecycle_state in ('active','disabled','retired'))
          or (OLD.lifecycle_state = 'disabled' and NEW.lifecycle_state in ('active','retired'))
        ) then
          raise exception 'Unsupported integration connector lifecycle transition';
        end if;
        if NEW.lifecycle_state = 'disabled' then NEW.disabled_at = clock_timestamp(); end if;
        if NEW.lifecycle_state = 'retired' then NEW.retired_at = clock_timestamp(); end if;
      end if;

      -- A disable timestamp records the most recent disable and is never
      -- cleared on re-enable, so operational history survives.
      if NEW.retired_at is distinct from OLD.retired_at and NEW.lifecycle_state <> 'retired' then
        raise exception 'Integration connector retirement evidence is immutable';
      end if;

      NEW.updated_at = clock_timestamp();
      return NEW;
    end $$;

    create or replace function guard_integration_connector_audit() returns trigger language plpgsql as $$
    declare connector integration_connector;
      prior integration_connector_audit; policy_change boolean;
    begin
      select * into connector from integration_connector
        where organization_id = NEW.organization_id and id = NEW.integration_connector_id;
      if not found then
        raise exception 'Integration connector audit requires its connector';
      end if;
      if NEW.connector_key <> connector.connector_key
        or NEW.connector_kind <> connector.connector_kind
        or NEW.configuration_revision <> connector.configuration_revision
        or NEW.record_revision <> connector.record_revision
        or NEW.lifecycle_state <> connector.lifecycle_state
        or NEW.operations is distinct from connector.operations
        or NEW.supports_idempotency_key <> connector.supports_idempotency_key
        or NEW.supports_read_after_write <> connector.supports_read_after_write
        or NEW.supports_reconciliation <> connector.supports_reconciliation
        or NEW.supports_webhook_callback <> connector.supports_webhook_callback
        or NEW.supports_ordering <> connector.supports_ordering
        or NEW.supports_update <> connector.supports_update
        or NEW.supports_cancel <> connector.supports_cancel
        or NEW.supports_delete <> connector.supports_delete
        or NEW.supports_current_state_sync <> connector.supports_current_state_sync
        or NEW.reports_terminal_state <> connector.reports_terminal_state
        or NEW.side_effect_risk <> connector.side_effect_risk
        -- F062.2D-2C-3B-1. The four policy values are mirrored exactly,
        -- so the snapshot a future claim reads is the policy that was
        -- committed at this revision. is distinct from because every
        -- one is nullable and NULL means policy was never established.
        or NEW.request_execution_budget_seconds
          is distinct from connector.request_execution_budget_seconds
        or NEW.destination_retry_base_delay_seconds
          is distinct from connector.destination_retry_base_delay_seconds
        or NEW.destination_retry_max_delay_seconds
          is distinct from connector.destination_retry_max_delay_seconds
        or NEW.destination_retry_attempt_ceiling
          is distinct from connector.destination_retry_attempt_ceiling
        or NEW.credential_reference_present <> (connector.credential_reference is not null) then
        raise exception 'Integration connector audit must record the committed connector state';
      end if;
      -- F062.2D-2C-3B-1. execution_policy_changed is bound to a real
      -- policy delta in both directions, so the category carries
      -- STRUCTURAL meaning rather than application convention.
      --
      -- The immediately prior snapshot is deterministic from the
      -- existing linkage: the connector guard advances record_revision by
      -- exactly one per accepted mutation, and
      -- unique (organization_id, integration_connector_id,
      -- record_revision) makes revision - 1 a single row. No session
      -- state, flag or caller assertion is introduced.
      --
      -- Keyed on PREDECESSOR EXISTENCE, not on category. Revision 1 has
      -- no predecessor to compare against, and Migration 50's existing
      -- (change_category = 'registered') = (prior_record_revision is null)
      -- check already refuses any other category there, so REGISTRATION
      -- SEMANTICS STAY OWNED BY MIGRATION 50 and this guard raises only
      -- about the comparison it actually needs.
      if NEW.record_revision > 1 then
        select * into prior from integration_connector_audit
          where organization_id = NEW.organization_id
            and integration_connector_id = NEW.integration_connector_id
            and record_revision = NEW.record_revision - 1;
        if not found then
          raise exception 'Integration connector audit requires its immediately prior revision';
        end if;
        policy_change =
          NEW.request_execution_budget_seconds
            is distinct from prior.request_execution_budget_seconds
          or NEW.destination_retry_base_delay_seconds
            is distinct from prior.destination_retry_base_delay_seconds
          or NEW.destination_retry_max_delay_seconds
            is distinct from prior.destination_retry_max_delay_seconds
          or NEW.destination_retry_attempt_ceiling
            is distinct from prior.destination_retry_attempt_ceiling;
        if policy_change and NEW.change_category <> 'execution_policy_changed' then
          raise exception 'An execution policy change must be recorded as execution_policy_changed';
        end if;
        if NEW.change_category = 'execution_policy_changed' and not policy_change then
          raise exception 'The execution_policy_changed category requires an execution policy change';
        end if;
      end if;

      NEW.changed_at = clock_timestamp();
      NEW.mutation_txid = txid_current();
      return NEW;
    end $$;

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
  `.execute(db);
}

/**
 * Refuses rollback while ANY durable execution-policy evidence exists.
 *
 * Five conditions, not one: 3B-0 §27 was strengthened precisely because
 * keying the refusal on *evidence referenced by an attempt* is too narrow. A
 * platform policy row that no attempt has used yet is still the record of an
 * authorized operator decision, and a connector policy value written but not
 * yet claimed against is still a tenant's exercised configuration authority.
 *
 * Nothing is deleted, nulled or rewritten to make rollback succeed. A clean
 * rollback is possible only from the state immediately after apply, where
 * every new column is NULL everywhere and the policy table is empty -- and
 * there it destroys nothing.
 */
export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    set local lock_timeout = '5s';
    lock table integration_connector in access exclusive mode;
    lock table integration_connector_audit in access exclusive mode;
    lock table integration_delivery_attempt in access exclusive mode;

    do $$ begin
      if exists (select 1 from integration_connector
        where request_execution_budget_seconds is not null
           or destination_retry_base_delay_seconds is not null
           or destination_retry_max_delay_seconds is not null
           or destination_retry_attempt_ceiling is not null) then
        raise exception
          'Retained integration connector execution-policy evidence prevents rollback';
      end if;
      if exists (select 1 from integration_connector_audit
        where request_execution_budget_seconds is not null
           or destination_retry_base_delay_seconds is not null
           or destination_retry_max_delay_seconds is not null
           or destination_retry_attempt_ceiling is not null) then
        raise exception
          'Retained integration connector audit execution-policy evidence prevents rollback';
      end if;
      if exists (select 1 from integration_execution_safety_policy) then
        raise exception
          'Retained integration execution safety policy evidence prevents rollback';
      end if;
      if exists (select 1 from integration_delivery_attempt
        where claim_policy_revision is not null
           or settlement_policy_revision is not null) then
        raise exception
          'Retained integration attempt policy-revision evidence prevents rollback';
      end if;
    end $$;

    -- Restore the F062.2D-2C-1 attempt guard verbatim.
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

    alter table integration_delivery_attempt
      drop constraint integration_attempt_settlement_policy_settled,
      drop constraint integration_attempt_settlement_policy_fk,
      drop constraint integration_attempt_claim_policy_fk;
    alter table integration_delivery_attempt
      drop column settlement_policy_revision,
      drop column claim_policy_revision;

    drop trigger integration_execution_safety_policy_no_truncate
      on integration_execution_safety_policy;
    drop trigger integration_execution_safety_policy_guard
      on integration_execution_safety_policy;
    drop table integration_execution_safety_policy;
    drop function guard_integration_execution_safety_policy();

    -- Restore Migration 50's audit guard and category vocabulary verbatim.
    create or replace function guard_integration_connector_audit() returns trigger language plpgsql as $$
    declare connector integration_connector;
    begin
      select * into connector from integration_connector
        where organization_id = NEW.organization_id and id = NEW.integration_connector_id;
      if not found then
        raise exception 'Integration connector audit requires its connector';
      end if;
      if NEW.connector_key <> connector.connector_key
        or NEW.connector_kind <> connector.connector_kind
        or NEW.configuration_revision <> connector.configuration_revision
        or NEW.record_revision <> connector.record_revision
        or NEW.lifecycle_state <> connector.lifecycle_state
        or NEW.operations is distinct from connector.operations
        or NEW.supports_idempotency_key <> connector.supports_idempotency_key
        or NEW.supports_read_after_write <> connector.supports_read_after_write
        or NEW.supports_reconciliation <> connector.supports_reconciliation
        or NEW.supports_webhook_callback <> connector.supports_webhook_callback
        or NEW.supports_ordering <> connector.supports_ordering
        or NEW.supports_update <> connector.supports_update
        or NEW.supports_cancel <> connector.supports_cancel
        or NEW.supports_delete <> connector.supports_delete
        or NEW.supports_current_state_sync <> connector.supports_current_state_sync
        or NEW.reports_terminal_state <> connector.reports_terminal_state
        or NEW.side_effect_risk <> connector.side_effect_risk
        or NEW.credential_reference_present <> (connector.credential_reference is not null) then
        raise exception 'Integration connector audit must record the committed connector state';
      end if;
      NEW.changed_at = clock_timestamp();
      NEW.mutation_txid = txid_current();
      return NEW;
    end $$;

    alter table integration_connector_audit
      drop constraint integration_connector_audit_change_category_check;
    alter table integration_connector_audit
      add constraint integration_connector_audit_change_category_check check (
        change_category in ('registered','lifecycle_changed',
          'capabilities_changed','credential_reference_rotated'));

    alter table integration_connector_audit
      drop constraint integration_connector_audit_retry_delay_ordered,
      drop constraint integration_connector_audit_execution_policy_complete,
      drop constraint integration_connector_audit_execution_policy_positive;
    alter table integration_connector_audit
      drop column destination_retry_attempt_ceiling,
      drop column destination_retry_max_delay_seconds,
      drop column destination_retry_base_delay_seconds,
      drop column request_execution_budget_seconds;

    -- Restore Migration 50's connector guard verbatim.
    create or replace function guard_integration_connector() returns trigger language plpgsql as $$
    declare semantic_change boolean; credential_change boolean;
    begin
      if TG_OP in ('DELETE','TRUNCATE') then
        raise exception 'Integration connectors are retired, never deleted';
      end if;

      -- Duplicate operations are refused rather than silently normalized; a
      -- CHECK constraint cannot express this because it needs a subquery.
      if (select count(*) from unnest(NEW.operations) as o) <>
         (select count(distinct o) from unnest(NEW.operations) as o) then
        raise exception 'Integration connector operations must not repeat';
      end if;

      if TG_OP = 'INSERT' then
        if NEW.configuration_revision <> 1 or NEW.record_revision <> 1
          or NEW.lifecycle_state <> 'configured'
          or NEW.disabled_at is not null or NEW.retired_at is not null then
          raise exception 'Integration connector must start configured at revision 1';
        end if;
        NEW.created_at = clock_timestamp();
        NEW.updated_at = NEW.created_at;
        return NEW;
      end if;

      if NEW.id <> OLD.id or NEW.organization_id <> OLD.organization_id
        or NEW.connector_key <> OLD.connector_key
        or NEW.connector_kind <> OLD.connector_kind
        or NEW.created_at <> OLD.created_at then
        raise exception 'Integration connector identity is immutable';
      end if;

      -- Revision significance, encoded once: lifecycle plus every capability
      -- field. Credential rotation is deliberately NOT semantic.
      semantic_change =
        NEW.lifecycle_state is distinct from OLD.lifecycle_state
        or NEW.operations is distinct from OLD.operations
        or NEW.supports_idempotency_key is distinct from OLD.supports_idempotency_key
        or NEW.supports_read_after_write is distinct from OLD.supports_read_after_write
        or NEW.supports_reconciliation is distinct from OLD.supports_reconciliation
        or NEW.supports_webhook_callback is distinct from OLD.supports_webhook_callback
        or NEW.supports_ordering is distinct from OLD.supports_ordering
        or NEW.supports_update is distinct from OLD.supports_update
        or NEW.supports_cancel is distinct from OLD.supports_cancel
        or NEW.supports_delete is distinct from OLD.supports_delete
        or NEW.supports_current_state_sync is distinct from OLD.supports_current_state_sync
        or NEW.reports_terminal_state is distinct from OLD.reports_terminal_state
        or NEW.side_effect_risk is distinct from OLD.side_effect_risk;
      credential_change = NEW.credential_reference is distinct from OLD.credential_reference;

      if not semantic_change and not credential_change then
        raise exception 'Integration connector update changes nothing';
      end if;
      if semantic_change and credential_change then
        raise exception 'Credential rotation must not accompany a configuration change';
      end if;

      -- EVERY accepted mutation advances the record revision. This is what
      -- makes a lost update impossible: a rotation that changes no semantics
      -- still moves the concurrency token.
      if NEW.record_revision <> OLD.record_revision + 1 then
        raise exception 'Integration connector record revision must advance exactly once';
      end if;

      if semantic_change then
        if NEW.configuration_revision <> OLD.configuration_revision + 1 then
          raise exception 'Integration connector configuration revision must advance exactly once';
        end if;
      elsif NEW.configuration_revision <> OLD.configuration_revision then
        raise exception 'Credential rotation must not advance the configuration revision';
      end if;

      -- Closed lifecycle transitions. retired is terminal and nothing returns
      -- to configured, so a decommissioned connector cannot be reactivated.
      if NEW.lifecycle_state is distinct from OLD.lifecycle_state then
        if OLD.lifecycle_state = 'retired' then
          raise exception 'A retired integration connector cannot change state';
        end if;
        if NEW.lifecycle_state = 'configured' then
          raise exception 'An integration connector cannot return to configured';
        end if;
        if not (
          (OLD.lifecycle_state = 'configured' and NEW.lifecycle_state in ('active','disabled','retired'))
          or (OLD.lifecycle_state = 'active' and NEW.lifecycle_state in ('degraded','disabled','retired'))
          or (OLD.lifecycle_state = 'degraded' and NEW.lifecycle_state in ('active','disabled','retired'))
          or (OLD.lifecycle_state = 'disabled' and NEW.lifecycle_state in ('active','retired'))
        ) then
          raise exception 'Unsupported integration connector lifecycle transition';
        end if;
        if NEW.lifecycle_state = 'disabled' then NEW.disabled_at = clock_timestamp(); end if;
        if NEW.lifecycle_state = 'retired' then NEW.retired_at = clock_timestamp(); end if;
      end if;

      -- A disable timestamp records the most recent disable and is never
      -- cleared on re-enable, so operational history survives.
      if NEW.retired_at is distinct from OLD.retired_at and NEW.lifecycle_state <> 'retired' then
        raise exception 'Integration connector retirement evidence is immutable';
      end if;

      NEW.updated_at = clock_timestamp();
      return NEW;
    end $$;

    alter table integration_connector
      drop constraint integration_connector_retry_delay_ordered,
      drop constraint integration_connector_execution_policy_complete,
      drop constraint integration_connector_execution_policy_positive;
    alter table integration_connector
      drop column destination_retry_attempt_ceiling,
      drop column destination_retry_max_delay_seconds,
      drop column destination_retry_base_delay_seconds,
      drop column request_execution_budget_seconds;
  `.execute(db);
}
