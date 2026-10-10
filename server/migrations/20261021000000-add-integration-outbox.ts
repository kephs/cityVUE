import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

/** Ordinal 51. F062.2C, under the accepted F062 integration architecture and
 * the F062.2A persistence readiness assessment.
 *
 * **The transactional outbox table only. NO EXTERNAL DELIVERY IS ENABLED.**
 * There is no delivery-attempt table, no worker, no claiming, no lease or
 * fencing column, no retry, no dead-letter processing, no inbox, no external
 * reference, no reconciliation, no queue, no broker and no transport. An
 * outbox row is a durable *intent*; nothing reads it to dispatch, because no
 * dispatch code exists.
 *
 * **Delivery progression is structurally inert.** Every row is forced to
 * `pending` on insert, a deliberately temporary constraint pins the column to
 * that value, and the guard refuses **every** UPDATE. Half a worker state
 * machine is worse than none: exposing transitions before delivery-attempt
 * evidence exists would allow a row to be marked delivered with nothing
 * recording what was actually attempted. The dispatch slice drops
 * `integration_outbox_state_inert` and introduces the transition guard and the
 * attempt table together.
 *
 * **The pinned revision is the semantic one.** `pinned_connector_configuration_revision`
 * records `integration_connector.configuration_revision`, never
 * `record_revision`: F062.2A §9.2 resolves a past ambiguity against the
 * capabilities that governed it, and a credential rotation changes no
 * capabilities. The guard proves the pin names an **existing authoritative
 * semantic snapshot** in `integration_connector_audit` and that it is the
 * connector's current one, and it takes a share lock on the connector so a
 * concurrent configuration change cannot land between resolving and pinning.
 *
 * PostgreSQL cannot express that as a foreign key: the snapshot's uniqueness
 * is a **partial** unique index (`where revision_advanced`), and an FK
 * requires a complete unique constraint. A narrowly scoped guard is therefore
 * the structurally sound mechanism, and F062.2B is left unchanged.
 *
 * **No payload is stored.** The envelope carries none — F062.1 lists `payload`
 * and `body` among `PROHIBITED_ENVELOPE_FIELDS` — and this table carries no
 * business data, no resident value, no vendor text and no snapshot. It holds
 * identifiers, closed vocabulary members, integers and timestamps.
 *
 * Grants are deliberately absent: `deploy/database/runtime-role.sql` is
 * unchanged, so the table's existence enables no runtime capability.
 */
export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    set local lock_timeout = '5s';
    lock table integration_connector in share row exclusive mode;

    create table integration_outbox (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      integration_connector_id uuid not null,

      -- The envelope identity consumers deduplicate on. Distinct from id:
      -- id is this row, integration_id is the intent that crosses the
      -- boundary, and one intent may fan out to several connectors.
      integration_id uuid not null,

      contract_kind varchar(10) not null check (contract_kind in ('event','state_sync')),
      integration_type varchar(64) not null,
      schema_version integer not null check (schema_version > 0),
      aggregate_type varchar(20) not null
        check (aggregate_type in ('service_request','work_item','attachment')),
      aggregate_id uuid not null,
      aggregate_revision integer check (aggregate_revision > 0),

      -- Loop-prevention evidence, never authorization (F062.1).
      origin_kind varchar(8) not null check (origin_kind in ('reqro','external')),
      origin_connector_id uuid,

      correlation_id uuid not null,
      causation_id uuid,

      -- The serving authority that produced it, so a staging intent cannot be
      -- accepted by a production connector. Matches F062.1's ENVIRONMENT.
      deployment_environment varchar(30) not null
        check (deployment_environment ~ '^[a-z][a-z0-9-]{2,30}$'),

      payload_mode varchar(28) not null check (payload_mode in
        ('historical_reference','approved_snapshot','current_state_projection')),

      -- The semantic pin. NOT record_revision.
      pinned_connector_configuration_revision integer not null
        check (pinned_connector_configuration_revision > 0),

      state varchar(16) not null default 'pending' check (state in
        ('pending','dispatching','accepted','acknowledged','retrying',
         'ambiguous','failed_permanent','dead_lettered','refused')),

      occurred_at timestamptz not null,
      created_at timestamptz not null default clock_timestamp(),

      -- Exposed so the future delivery-attempt table can carry a composite
      -- tenant-safe reference to an intent.
      unique (organization_id, id),

      -- F062's structural idempotency: one intent per connector, once.
      -- integration_id serves as the dedupe identity directly, so no second
      -- column expresses the same invariant. The same intent may fan out to a
      -- different connector, which this key permits by construction.
      unique (organization_id, integration_connector_id, integration_id),

      foreign key (organization_id, integration_connector_id)
        references integration_connector(organization_id, id),
      foreign key (organization_id, origin_connector_id)
        references integration_connector(organization_id, id),
      check ((origin_kind = 'external') = (origin_connector_id is not null)),

      -- The F062.1 vocabulary pairing, enforced rather than documented. A
      -- caller cannot relabel an immutable event as current-state
      -- synchronization, or the reverse, because the whole tuple is checked.
      check ((integration_type, contract_kind, aggregate_type, schema_version) in (
        ('service_request.submitted', 'event', 'service_request', 1),
        ('service_request.status_changed', 'event', 'service_request', 1),
        ('service_request.closed', 'event', 'service_request', 1),
        ('work_item.assigned', 'event', 'work_item', 1),
        ('work_item.sync_requested', 'state_sync', 'work_item', 1)
      )),

      -- F062.1 refuses an immutable event with no revision to be reconstructed
      -- as of, so the database refuses it too.
      check (contract_kind <> 'event' or aggregate_revision is not null),

      -- F062.2A payload-mode policy, unweakened.
      --
      -- No declared event type has proven historical reconstructability, so
      -- historical reference is refused outright. An empty IN list is not
      -- valid SQL, so the fail-closed form is the unconditional refusal.
      constraint integration_outbox_no_historical_reference
        check (payload_mode <> 'historical_reference'),
      -- Snapshot retention is not approved: it is the one mode that would put
      -- business data, and therefore potentially resident PII, in this table.
      constraint integration_outbox_no_approved_snapshot
        check (payload_mode <> 'approved_snapshot'),
      -- The two kinds cannot borrow each other's payload mode.
      check ((contract_kind = 'state_sync') = (payload_mode = 'current_state_projection')),

      -- DELIBERATELY TEMPORARY. The column's domain is the full F062.1
      -- vocabulary so parity holds, while this pins the only reachable value
      -- until the dispatch slice exists. That slice drops this constraint by
      -- name and adds the transition guard in the same migration.
      constraint integration_outbox_state_inert check (state = 'pending'),

      check (occurred_at <= created_at)
    );

    -- ------------------------------------------------------------------
    -- Enqueue guard: forces the initial state, proves the semantic pin and
    -- makes the intent immutable.
    -- ------------------------------------------------------------------
    create function guard_integration_outbox() returns trigger language plpgsql as $$
    declare connector integration_connector;
    begin
      if TG_OP in ('UPDATE','DELETE','TRUNCATE') then
        -- No controlled transition exists yet, so there is no legitimate
        -- update. Delivery evidence is never erased (F062.1
        -- mayEraseEvidence), and retention remains separately governed.
        raise exception 'Integration outbox intents are immutable in this slice';
      end if;

      -- Share-locks the connector inside the caller's transaction, so a
      -- concurrent configuration change cannot commit between resolving the
      -- semantics and pinning them. This is what closes the read-then-pin
      -- race rather than leaving it to application discipline.
      select * into connector from integration_connector
        where organization_id = NEW.organization_id
          and id = NEW.integration_connector_id
        for share;
      if not found then
        raise exception 'Integration intent requires a connector owned by its Organization';
      end if;

      -- F062.1 mayEnqueue: only a retired connector refuses enqueue. A
      -- disabled connector accumulates, because disabling is an outage and
      -- not a decision to discard.
      if connector.lifecycle_state = 'retired' then
        raise exception 'A retired integration connector accepts no new intents';
      end if;

      -- The pin must be the connector's CURRENT semantic revision. A stale
      -- value is refused rather than silently recorded.
      if NEW.pinned_connector_configuration_revision <> connector.configuration_revision then
        raise exception 'Integration intent must pin the current connector semantic revision';
      end if;

      -- And that revision must name a real authoritative semantic snapshot.
      -- Only revision-advancing audit rows carry one; a credential rotation
      -- shares a revision without changing its semantics.
      if not exists (select 1 from integration_connector_audit a
        where a.organization_id = NEW.organization_id
          and a.integration_connector_id = NEW.integration_connector_id
          and a.configuration_revision = NEW.pinned_connector_configuration_revision
          and a.revision_advanced) then
        raise exception 'Integration intent must pin an existing authoritative connector semantic snapshot';
      end if;

      -- The caller does not choose a delivery state. Refused rather than
      -- silently overwritten: a caller that supplied one has a bug, and
      -- quietly storing 'pending' instead would hide it.
      if NEW.state <> 'pending' then
        raise exception 'Integration intent delivery state is not caller controlled';
      end if;
      NEW.created_at = clock_timestamp();
      return NEW;
    end $$;
    create trigger integration_outbox_guard before insert or update or delete
      on integration_outbox for each row execute function guard_integration_outbox();
    create trigger integration_outbox_no_truncate before truncate
      on integration_outbox execute function guard_integration_outbox();
  `.execute(db);
}

/** Refuses rollback while any intent exists.
 *
 * An outbox row is an obligation Reqro accepted; dropping the table would
 * discard it. Removing retained intents is a data-retention decision under a
 * separate privileged authority, never a migration step, and nothing here
 * cascades. */
export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    set local lock_timeout = '5s';
    lock table integration_outbox in access exclusive mode;
    do $$ begin
      if exists (select 1 from integration_outbox) then
        raise exception 'Retained integration outbox intents prevent rollback';
      end if;
    end $$;
    drop table integration_outbox;
    drop function guard_integration_outbox();
  `.execute(db);
}
