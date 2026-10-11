import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

/** Ordinal 52. F062.2D-2A, under the F062.2D-0 worker readiness assessment,
 * the F062.2D-1 identity decision and the F062.2D-1A pending-age policy.
 *
 * **NO WORKER RUNS. NO EXTERNAL DESTINATION IS CONTACTED. NO AGE-BASED
 * AUTOMATIC DEAD-LETTER TRANSITION EXISTS.** There is no polling loop, no
 * claim function, no lease recovery, no transport, no credential, no secret
 * resolution and no operator API. This migration adds persistence and
 * integrity enforcement only.
 *
 * **No age threshold of any kind appears below.** F062.2D-1A decided the
 * semantics of age expiry but left its duration, ownership and measurability
 * unresolved, so the `pending_age_exceeded` edge belongs to a later
 * policy-implementation slice. A placeholder duration in SQL is how a
 * provisional value becomes an unapproved production default.
 *
 * **Claim state lives on the attempt, not the outbox.** F062.2A sketched
 * `claim_generation`, `claim_token` and a lease as outbox columns; F062.2C
 * deferred all of them, and on reflection the attempt is the better home. The
 * one-open-attempt index below makes the open attempt canonically *the*
 * current claim, so storing ownership in both places would create two values
 * that can disagree. A consequence worth stating: this migration adds **no
 * column to `integration_outbox`**, so it is trivially safe for existing rows
 * and fabricates no attempt history.
 *
 * **Only a digest of the claim token is stored.** The raw token is generated
 * by the future worker, lives only in its memory, and will be supplied as a
 * bind parameter to the settle function when that exists. Nothing here
 * generates a token, and no function returns one.
 *
 * **The inert guard is replaced, by name.** F062.2C pinned the outbox to
 * `pending` with `integration_outbox_state_inert` and a guard that refused
 * every UPDATE, deliberately, until a reviewed state machine existed. Both are
 * replaced here rather than layered over, and `down()` restores both exactly.
 *
 * **Trigger functions are SECURITY INVOKER**, which is the established
 * convention for integrity guards in this repository (migrations 45-51) and is
 * correct here: a guard enforcing integrity needs no authority beyond the
 * caller's, and `SECURITY DEFINER` would grant some. Object references are
 * therefore left unqualified, matching every existing guard, which is what
 * keeps the schema portable for the disposable-schema test harness. The
 * residual `search_path` exposure is relation shadowing via `pg_temp`, and the
 * bootstrap already revokes `TEMPORARY` on the database from `PUBLIC`, so no
 * role in the topology can plant a decoy relation. The worker-facing
 * `SECURITY DEFINER` API remains unimplemented and belongs to
 * `reqro_integration_function_owner` in the `reqro_integration_api` schema
 * per F062.2D-1.
 *
 * **No grant, no role and no privilege change.** `deploy/database/*.sql` is
 * untouched and the bootstrap issues no default privileges, so the new table
 * is unreachable by `reqro_runtime` and by `PUBLIC` until F062.2D-3 grants it
 * deliberately.
 */
export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    set local lock_timeout = '5s';
    lock table integration_outbox in share row exclusive mode;

    create table integration_delivery_attempt (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      integration_outbox_id uuid not null,
      -- Recorded so a retired connector's evidence stays attributable; the
      -- outbox row's connector could in principle be read instead, but an
      -- attempt is evidence and evidence should not depend on a join to
      -- remain interpretable.
      integration_connector_id uuid not null,

      -- Ordinal: which attempt this is for the obligation.
      attempt_number integer not null check (attempt_number > 0),
      -- Ownership: which claim this attempt belongs to. Distinct from the
      -- ordinal deliberately. They advance together today because each claim
      -- creates exactly one attempt, but they answer different questions, and
      -- keeping them separate means a future lease renewal or re-claim of an
      -- existing attempt can advance ownership without fabricating an attempt.
      claim_generation bigint not null check (claim_generation > 0),

      -- A digest, never the token. SHA-256 hex: 64 lowercase hex characters,
      -- enforced by pattern so a truncated, upper-cased or non-hex value
      -- cannot be stored. The raw token never reaches a column.
      claim_token_digest char(64) not null
        check (claim_token_digest ~ '^[0-9a-f]{64}$'),

      -- The connector semantics this attempt was formed against, pinned so a
      -- later configuration change cannot reinterpret it (F062.2D-0 9.2).
      connector_configuration_revision integer not null
        check (connector_configuration_revision > 0),
      -- The decisive capability inputs, recorded rather than reconstructed.
      capability_snapshot jsonb not null,

      started_at timestamptz not null default clock_timestamp(),
      -- Null while open. One coherent definition of settled, with no separate
      -- status column that could disagree with it.
      completed_at timestamptz,
      outcome varchar(18)
        check (outcome in ('succeeded','failed_transient','failed_permanent','ambiguous')),
      failure_category varchar(28)
        check (failure_category in ('destination_unavailable','destination_timeout',
          'destination_rejected','rate_limited','authentication_failed',
          'destination_unconfigured','projection_failed','contract_unsupported',
          'malformed_request','internal_failure')),

      mutation_txid bigint not null default txid_current(),

      -- Tenant-safe composite references. The pair is the referent, so an
      -- attempt in one Organization cannot name another's outbox row or
      -- connector: the row would have to carry the other Organization's id,
      -- at which point it is that Organization's row.
      foreign key (organization_id, integration_outbox_id)
        references integration_outbox(organization_id, id),
      foreign key (organization_id, integration_connector_id)
        references integration_connector(organization_id, id),

      -- Ordinal and ownership are each unique per obligation.
      unique (organization_id, integration_outbox_id, attempt_number),
      unique (organization_id, integration_outbox_id, claim_generation),

      -- Open versus settled, as a biconditional rather than a convention.
      check ((outcome is null) = (completed_at is null)),
      check (outcome is null or outcome = 'succeeded' or failure_category is not null),
      check (outcome is null or outcome <> 'succeeded' or failure_category is null),
      check (completed_at is null or completed_at >= started_at),

      -- The capability snapshot is bounded: exactly the three decisive keys,
      -- each with a closed value domain. Not an arbitrary JSON blob.
      -- Exactly the three decisive keys, each with a closed value domain. A
      -- CHECK cannot contain a subquery, so the key set is pinned by removing
      -- the three known keys and requiring nothing to remain, which is exact
      -- rather than a count.
      check (
        jsonb_typeof(capability_snapshot) = 'object'
        and (capability_snapshot ?& array['supports_idempotency_key',
          'supports_read_after_write','side_effect_risk'])
        and (capability_snapshot
              - 'supports_idempotency_key'
              - 'supports_read_after_write'
              - 'side_effect_risk') = '{}'::jsonb
        and jsonb_typeof(capability_snapshot->'supports_idempotency_key') = 'boolean'
        and jsonb_typeof(capability_snapshot->'supports_read_after_write') = 'boolean'
        and (capability_snapshot->>'side_effect_risk')
              in ('none','reversible','irreversible','physical')
      )
    );

    -- At most ONE open attempt per obligation. This is what makes the open
    -- attempt canonically the current claim, and it is what makes "settle the
    -- existing attempt" the only reachable recovery rather than a judgement
    -- call: inventing a second open attempt is a constraint violation.
    create unique index integration_attempt_open
      on integration_delivery_attempt (organization_id, integration_outbox_id)
      where completed_at is null;

    -- Attempts for one obligation, newest first. Serves evidence reads and the
    -- settlement lookup. No worker polling index is added: the claim query
    -- does not exist yet, and F062.2A ruled out speculative indexes.
    create index integration_attempt_obligation
      on integration_delivery_attempt
        (organization_id, integration_outbox_id, claim_generation desc);

    -- ------------------------------------------------------------------
    -- Complete-once guard. An attempt is created open and settled at most
    -- once; a settled attempt is immutable.
    -- ------------------------------------------------------------------
    create function guard_integration_delivery_attempt() returns trigger
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

        -- The attempt must belong to an obligation owned by the same
        -- Organization, and must pin the semantics that obligation pinned.
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

        -- Ordinal and ownership are monotonic per obligation. Computed here
        -- rather than trusted from the caller; a concurrent race loses on the
        -- unique constraints above rather than producing a duplicate.
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

      -- UPDATE: the only permitted change is open -> settled.
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
    create trigger integration_delivery_attempt_guard
      before insert or update or delete on integration_delivery_attempt
      for each row execute function guard_integration_delivery_attempt();
    create trigger integration_delivery_attempt_no_truncate
      before truncate on integration_delivery_attempt
      execute function guard_integration_delivery_attempt();

    -- ------------------------------------------------------------------
    -- Replace F062.2C's inert protections with the reviewed non-age state
    -- machine. Both are named explicitly so nothing is layered accidentally.
    -- ------------------------------------------------------------------
    alter table integration_outbox drop constraint integration_outbox_state_inert;

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
  `.execute(db);
}

/** Removes only what this migration owns, and restores F062.2C's protections
 * exactly.
 *
 * Refuses while attempt evidence exists: an attempt row records what was
 * tried against an external system, and dropping the table would discard it.
 * Removing retained evidence is a data-retention decision under a separate
 * privileged authority, never a migration step, and nothing here cascades. */
export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    set local lock_timeout = '5s';
    lock table integration_delivery_attempt, integration_outbox in access exclusive mode;
    do $$ begin
      if exists (select 1 from integration_delivery_attempt) then
        raise exception 'Retained integration delivery attempt evidence prevents rollback';
      end if;
      if exists (select 1 from integration_outbox where state <> 'pending') then
        raise exception 'Integration intents have left the initial state and prevent rollback';
      end if;
    end $$;

    drop table integration_delivery_attempt;
    drop function guard_integration_delivery_attempt();

    -- Restore F062.2C's guard verbatim: every UPDATE refused, which is the
    -- posture the previous schema version depends on.
    create or replace function guard_integration_outbox() returns trigger
      language plpgsql as $$
    declare connector integration_connector;
    begin
      if TG_OP in ('UPDATE','DELETE','TRUNCATE') then
        raise exception 'Integration outbox intents are immutable in this slice';
      end if;

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
    end $$;

    alter table integration_outbox
      add constraint integration_outbox_state_inert check (state = 'pending');
  `.execute(db);
}
