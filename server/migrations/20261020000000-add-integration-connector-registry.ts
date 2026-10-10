import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

/** Ordinal 50. F062.2B, under the accepted F062 integration architecture and
 * the F062.2A persistence readiness assessment.
 *
 * **Connector metadata and revision history only. Nothing here enables
 * integration traffic.** There is no outbox, no delivery attempt, no inbox, no
 * external reference, no reconciliation, no queue, no worker and no transport.
 * A row in `integration_connector` is a declaration that a destination exists
 * and what it can do; nothing in the repository reads it to dispatch anything,
 * because no dispatch code exists.
 *
 * **No credential is stored.** `credential_reference` is **non-secret
 * metadata by contract**: this slice never resolves it, never interprets it as
 * credential material, never reads a secret and never authenticates. The
 * grammar and length constraints are **defence-in-depth against accidental
 * misuse, not a secret detector** — no constraint can decide whether a string
 * is secret. The future secret-management architecture owns the reference
 * namespace and its resolution rules. The audit records only whether a
 * reference was present, never its value.
 *
 * **Two revisions, with different jobs.** `configuration_revision` is the
 * semantic pin a future outbox intent records (F062.2A §9.2) and advances only
 * when behaviour-relevant configuration changes. `record_revision` advances on
 * every accepted mutation and is the optimistic-concurrency token. Without the
 * second counter, two concurrent credential rotations would both satisfy a
 * predicate on the unchanged `configuration_revision` and the later write
 * would silently overwrite the earlier one.
 *
 * **Capabilities are explicit columns, not free-form JSON.** The column set
 * mirrors F062.1's `ConnectorCapabilities` exactly, one column per field, so
 * every value is validated by a native constraint and no parse step stands
 * between the schema and its meaning. The defaults reproduce F062.1's
 * `NO_CAPABILITIES`, including `side_effect_risk = 'irreversible'`: a
 * destination supports nothing, and is assumed consequential, until it says
 * otherwise.
 *
 * **Two tables, two different questions.** `integration_connector` answers
 * what is true now; `integration_connector_audit` answers what was
 * authoritative at revision N, which is what F062.2A §9.2 requires so a past
 * ambiguous delivery is resolved against the capabilities that actually
 * governed it rather than whatever is configured today. Neither table is
 * Reqro's authoritative record of *who* authorized an administrative change.
 *
 * Grants are deliberately absent: `deploy/database/runtime-role.sql` is
 * unchanged by this migration, exactly as every other migration here leaves
 * runtime privileges alone. The required grant is reported for review.
 */
export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    set local lock_timeout = '5s';
    lock table organization in share row exclusive mode;

    create table integration_connector (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references organization(id),
      -- Stable logical name. Unique WITHIN an Organization and never globally:
      -- a globally unique connector name is how one tenant's configuration
      -- becomes reachable from another's lookup.
      connector_key varchar(64) not null,
      -- A capability profile, never a vendor product. No destination name,
      -- brand or API identity may be encoded here.
      connector_kind varchar(40) not null check (connector_kind in
        ('loopback','work_management','asset_management','service_request_exchange')),
      lifecycle_state varchar(12) not null default 'configured'
        check (lifecycle_state in ('configured','active','degraded','disabled','retired')),
      -- The semantic pin. Advances only when behaviour-relevant configuration
      -- changes, so a pinned revision keeps meaning what it meant.
      configuration_revision integer not null default 1 check (configuration_revision > 0),
      -- The mutation-concurrency token. Advances on EVERY accepted change,
      -- including a credential rotation that is semantically inert, so no
      -- mutation can be lost to a concurrent one.
      record_revision integer not null default 1 check (record_revision > 0),
      check (configuration_revision <= record_revision),

      -- F062.1 ConnectorCapabilities, one column per declared field.
      operations text[] not null default '{}',
      supports_idempotency_key boolean not null default false,
      supports_read_after_write boolean not null default false,
      supports_reconciliation boolean not null default false,
      supports_webhook_callback boolean not null default false,
      supports_ordering varchar(14) not null default 'none'
        check (supports_ordering in ('none','per_aggregate')),
      supports_update boolean not null default false,
      supports_cancel boolean not null default false,
      supports_delete boolean not null default false,
      supports_current_state_sync boolean not null default false,
      reports_terminal_state boolean not null default false,
      side_effect_risk varchar(12) not null default 'irreversible'
        check (side_effect_risk in ('none','reversible','irreversible','physical')),

      -- A LOCATOR, never a secret. Rotation changes this and nothing else.
      credential_reference varchar(200),

      created_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp(),
      disabled_at timestamptz,
      retired_at timestamptz,

      -- Exposed so children can carry a composite tenant-safe reference.
      unique (organization_id, id),
      unique (organization_id, connector_key),

      -- Matches F062.1's CONNECTOR_ID grammar, so a key that the contract
      -- layer would refuse cannot be stored.
      check (connector_key ~ '^[a-z][a-z0-9-]{2,62}$'),

      -- The operations array is bounded and closed. Duplicate membership is
      -- refused by the guard trigger, because a CHECK cannot contain the
      -- subquery that test needs.
      check (cardinality(operations) between 0 and 5),
      check (operations <@ array['createRequest','getRequest','getRequestStatus',
        'updateRequest','addAttachment']::text[]),

      check ((lifecycle_state = 'retired') = (retired_at is not null)),
      check (lifecycle_state <> 'disabled' or disabled_at is not null),
      check (retired_at is null or retired_at >= created_at),
      check (disabled_at is null or disabled_at >= created_at),

      -- Defence-in-depth, NOT a secret detector: no constraint can decide
      -- whether a string is secret. These bound the field to a short, opaque,
      -- URL-free, whitespace-free token so an obvious accidental paste is
      -- refused at the boundary. Non-secrecy is a contract (see the header),
      -- upheld by this slice never resolving or interpreting the value.
      check (credential_reference is null or credential_reference ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{2,199}$'),
      check (credential_reference is null or credential_reference !~ '[A-Za-z0-9+/=]{32,}')
    );

    create index integration_connector_organization
      on integration_connector(organization_id, connector_key);

    create table integration_connector_audit (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      integration_connector_id uuid not null,
      -- The connector's mutation revision at this change. Monotonic, one per
      -- accepted mutation, and the history's ordering key. It replaces a
      -- separately computed audit sequence deliberately: two independent
      -- counters would have to agree, and this one is already authoritative on
      -- the connector row.
      record_revision integer not null check (record_revision > 0),
      configuration_revision integer not null check (configuration_revision > 0),
      prior_record_revision integer check (prior_record_revision > 0),
      revision_advanced boolean not null,
      change_category varchar(32) not null check (change_category in
        ('registered','lifecycle_changed','capabilities_changed','credential_reference_rotated')),

      -- The authoritative semantic snapshot for this revision. Mirrors the
      -- connector's committed state, verified by the guard.
      connector_key varchar(64) not null,
      connector_kind varchar(40) not null,
      lifecycle_state varchar(12) not null
        check (lifecycle_state in ('configured','active','degraded','disabled','retired')),
      operations text[] not null,
      supports_idempotency_key boolean not null,
      supports_read_after_write boolean not null,
      supports_reconciliation boolean not null,
      supports_webhook_callback boolean not null,
      supports_ordering varchar(14) not null
        check (supports_ordering in ('none','per_aggregate')),
      supports_update boolean not null,
      supports_cancel boolean not null,
      supports_delete boolean not null,
      supports_current_state_sync boolean not null,
      reports_terminal_state boolean not null,
      side_effect_risk varchar(12) not null
        check (side_effect_risk in ('none','reversible','irreversible','physical')),

      -- Presence only. The locator's value is deliberately not copied into
      -- history: "was a credential configured at revision N" is answerable
      -- without retaining anything that identifies which one.
      credential_reference_present boolean not null,

      prior_configuration_revision integer check (prior_configuration_revision > 0),
      prior_lifecycle_state varchar(12)
        check (prior_lifecycle_state in ('configured','active','degraded','disabled','retired')),

      -- Traceability, not authorization. See the table comment below.
      actor varchar(200) not null check (length(btrim(actor)) > 0),
      correlation_id uuid not null,
      changed_at timestamptz not null default clock_timestamp(),
      mutation_txid bigint not null default txid_current(),

      -- Every accepted mutation has exactly one audit row, structurally.
      unique (organization_id, integration_connector_id, record_revision),
      foreign key (organization_id, integration_connector_id)
        references integration_connector(organization_id, id),

      check ((change_category = 'registered') = (prior_configuration_revision is null)),
      check ((change_category = 'registered') = (prior_record_revision is null)),
      check (prior_record_revision is null or record_revision = prior_record_revision + 1),
      check (change_category <> 'registered' or record_revision = 1),
      check (configuration_revision <= record_revision),
      check ((change_category = 'registered') = (prior_lifecycle_state is null)),
      check (change_category <> 'registered'
        or (configuration_revision = 1 and lifecycle_state = 'configured' and revision_advanced)),
      -- Exactly one category does not advance the revision, and the flag may
      -- not disagree with the category.
      check (revision_advanced = (change_category <> 'credential_reference_rotated')),
      check (prior_configuration_revision is null
        or (revision_advanced and configuration_revision = prior_configuration_revision + 1)
        or (not revision_advanced and configuration_revision = prior_configuration_revision)),
      check (change_category <> 'lifecycle_changed'
        or prior_lifecycle_state is distinct from lifecycle_state),
      check (change_category <> 'credential_reference_rotated'
        or prior_lifecycle_state = lifecycle_state)
    );

    comment on table integration_connector_audit is
      'What connector configuration and capabilities were authoritative at a revision. Records actor for traceability only; it is NOT Reqro authoritative authorization evidence for who approved an administrative change.';

    -- Exactly one audit row per revision records the authoritative semantics.
    -- Non-advancing rows (rotation) share a revision and are excluded.
    create unique index integration_connector_audit_revision
      on integration_connector_audit(organization_id, integration_connector_id, configuration_revision)
      where revision_advanced;
    create index integration_connector_audit_history
      on integration_connector_audit(organization_id, integration_connector_id, record_revision desc);

    -- ------------------------------------------------------------------
    -- Connector guard: immutable identity, closed lifecycle transitions,
    -- and a revision that advances exactly when semantics change.
    -- ------------------------------------------------------------------
    create function guard_integration_connector() returns trigger language plpgsql as $$
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
    create trigger integration_connector_guard before insert or update or delete
      on integration_connector for each row execute function guard_integration_connector();
    create trigger integration_connector_no_truncate before truncate
      on integration_connector execute function guard_integration_connector();

    -- ------------------------------------------------------------------
    -- Audit evidence is mandatory, not best effort: a connector that
    -- changed without a matching audit row fails the transaction at commit.
    -- ------------------------------------------------------------------
    create function verify_integration_connector_audited() returns trigger language plpgsql as $$
    begin
      if not exists (select 1 from integration_connector_audit a
        where a.organization_id = NEW.organization_id
          and a.integration_connector_id = NEW.id
          and a.record_revision = NEW.record_revision
          and a.configuration_revision = NEW.configuration_revision
          and a.mutation_txid = txid_current()) then
        raise exception 'Integration connector changes require matching audit evidence';
      end if;
      return null;
    end $$;
    create constraint trigger integration_connector_audited after insert or update
      on integration_connector deferrable initially deferred
      for each row execute function verify_integration_connector_audited();

    -- ------------------------------------------------------------------
    -- Audit guard: the snapshot must mirror committed connector state, and
    -- the sequence is assigned here rather than trusted from the caller.
    -- ------------------------------------------------------------------
    create function guard_integration_connector_audit() returns trigger language plpgsql as $$
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
    create trigger integration_connector_audit_guard before insert
      on integration_connector_audit for each row execute function guard_integration_connector_audit();

    create function protect_integration_connector_audit() returns trigger language plpgsql as $$
    begin raise exception 'Integration connector audit is append-only'; end $$;
    create trigger integration_connector_audit_immutable before update or delete
      on integration_connector_audit for each row execute function protect_integration_connector_audit();
    create trigger integration_connector_audit_no_truncate before truncate
      on integration_connector_audit execute function protect_integration_connector_audit();
  `.execute(db);
}

/** Fails closed while any connector or audit evidence exists.
 *
 * Because every connector change requires matching audit evidence, a single
 * registered connector leaves an audit row — so in practice this refuses
 * rollback unless both tables are empty, which is the only case where no
 * evidence is destroyed. Dropping an evidence-bearing integration registry is
 * a data-retention decision, not a migration step. */
export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    set local lock_timeout = '5s';
    lock table integration_connector, integration_connector_audit in access exclusive mode;
    do $$ begin
      if exists (select 1 from integration_connector_audit)
        or exists (select 1 from integration_connector) then
        raise exception 'Retained integration connector evidence prevents rollback';
      end if;
    end $$;
    drop table integration_connector_audit;
    drop table integration_connector;
    drop function protect_integration_connector_audit(), guard_integration_connector_audit(),
      verify_integration_connector_audited(), guard_integration_connector();
  `.execute(db);
}
