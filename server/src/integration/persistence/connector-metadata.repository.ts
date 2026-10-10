import { Injectable } from '@nestjs/common';
import { type Kysely, type Selectable, sql } from 'kysely';
import { DatabaseService } from '../../database/database.service.js';
import type { DatabaseSchema } from '../../database/database.types.js';
import type { ConnectorCapabilities } from '../connector-capabilities.js';
import type { ConnectorLifecycleState } from '../delivery-contract.js';
import {
  advancesConfigurationRevision,
  assertCapabilities,
  assertConnectorKey,
  assertConnectorKind,
  assertCredentialReference,
  capabilitiesDiffer,
  type ConnectorChangeCategory,
  type ConnectorMetadata,
  ConnectorMetadataRefusal,
  type ConnectorRevisionRecord,
  fromCapabilityColumns,
  INITIAL_CAPABILITIES,
  mayTransitionLifecycle,
  toCapabilityColumns,
} from './connector-metadata.js';

/**
 * F062.2B — connector metadata data access.
 *
 * **Inert by construction.** The only things this class touches are two
 * tables. There is no HTTP client, no transport, no credential resolution, no
 * outbox, no delivery attempt, no queue and no worker; registering a connector
 * sends nothing anywhere, and no code path exists that could.
 *
 * **Every operation is Organization-scoped.** Each query carries
 * `organization_id`, and the schema's composite foreign keys make a
 * cross-tenant reference inexpressible rather than merely rejected. There is
 * deliberately no cross-Organization listing, no global discovery and no
 * lookup by connector key alone — a key is unique only within an Organization,
 * so a key-only lookup would be ambiguous *and* a cross-tenant read.
 *
 * **Writes are optimistic, never last-write-wins.** Every mutation requires
 * an `expectedRecordRevision`, the row is locked, and a stale token is refused
 * with a bounded code. `record_revision` is the concurrency token because it
 * advances on *every* accepted change; `configuration_revision` is the
 * semantic pin and advances only on a behaviour-relevant change, so using it
 * as the token would let two concurrent credential rotations both pass and the
 * later one silently overwrite the earlier. Each write also records audit evidence in the same
 * transaction, which the database requires through a deferred constraint
 * trigger — so a change without evidence aborts at commit rather than
 * committing silently.
 */
@Injectable()
export class ConnectorMetadataRepository {
  constructor(private readonly database: DatabaseService) {}

  private get client(): Kysely<DatabaseSchema> {
    return this.database.client;
  }

  /**
   * Reads one connector by Organization and identity.
   *
   * Returns null both when no such connector exists and when it belongs to
   * another Organization. The two are deliberately indistinguishable: telling
   * them apart would confirm the existence of another tenant's connector.
   */
  async findById(
    organizationId: string,
    connectorId: string,
  ): Promise<ConnectorMetadata | null> {
    const row = await this.client
      .selectFrom('integration_connector')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where('id', '=', connectorId)
      .executeTakeFirst();
    return row ? project(row) : null;
  }

  /** Reads one connector by Organization and logical key. Organization-scoped
   * because the key is unique only within an Organization. */
  async findByKey(
    organizationId: string,
    connectorKey: string,
  ): Promise<ConnectorMetadata | null> {
    const row = await this.client
      .selectFrom('integration_connector')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where('connector_key', '=', connectorKey)
      .executeTakeFirst();
    return row ? project(row) : null;
  }

  /** Every connector one Organization owns. Scoped, not global: there is no
   * platform-wide connector listing in this slice and F062 requires none. */
  async listForOrganization(
    organizationId: string,
  ): Promise<ConnectorMetadata[]> {
    const rows = await this.client
      .selectFrom('integration_connector')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .orderBy('connector_key')
      .execute();
    return rows.map(project);
  }

  /**
   * Registers a connector at revision 1 in `configured`.
   *
   * Validation runs before the transaction so an invalid contract never
   * reaches a lock, and the database re-checks every one of these properties
   * independently — the application checks exist to produce a bounded refusal,
   * not to be the boundary.
   */
  async register(input: {
    readonly organizationId: string;
    readonly connectorKey: string;
    readonly connectorKind: string;
    readonly capabilities?: ConnectorCapabilities;
    readonly credentialReference?: string | null;
    readonly actor: string;
    readonly correlationId: string;
  }): Promise<ConnectorMetadata> {
    const connectorKey = assertConnectorKey(input.connectorKey);
    const connectorKind = assertConnectorKind(input.connectorKind);
    const capabilities = assertCapabilities(
      input.capabilities ?? INITIAL_CAPABILITIES,
    );
    const credentialReference = assertCredentialReference(
      input.credentialReference ?? null,
    );

    return this.client.transaction().execute(async (trx) => {
      await lockOrganization(trx, input.organizationId);

      // Reported as a duplicate without reading any other Organization's row:
      // the predicate is Organization-scoped, so the answer cannot depend on
      // another tenant's configuration.
      const existing = await trx
        .selectFrom('integration_connector')
        .select('id')
        .where('organization_id', '=', input.organizationId)
        .where('connector_key', '=', connectorKey)
        .executeTakeFirst();
      if (existing)
        throw new ConnectorMetadataRefusal(
          'connector_key_duplicate',
          'the connector key is already registered for this Organization',
        );

      const created = await trx
        .insertInto('integration_connector')
        .values({
          organization_id: input.organizationId,
          connector_key: connectorKey,
          connector_kind: connectorKind,
          credential_reference: credentialReference,
          ...toCapabilityColumns(capabilities),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await writeAudit(trx, created, {
        category: 'registered',
        priorConfigurationRevision: null,
        priorRecordRevision: null,
        priorLifecycleState: null,
        actor: input.actor,
        correlationId: input.correlationId,
      });

      return project(created);
    });
  }

  /**
   * Advances the lifecycle state, which is revision-significant.
   *
   * The transition whitelist is checked here for a bounded refusal and
   * enforced again by the database guard. Both matter: the guard is the
   * boundary, and the application check is what lets a caller distinguish
   * `lifecycle_transition_unsupported` from a generic constraint failure.
   */
  async changeLifecycle(input: {
    readonly organizationId: string;
    readonly connectorId: string;
    readonly expectedRecordRevision: number;
    readonly lifecycleState: ConnectorLifecycleState;
    readonly actor: string;
    readonly correlationId: string;
  }): Promise<ConnectorMetadata> {
    return this.client.transaction().execute(async (trx) => {
      await lockOrganization(trx, input.organizationId);
      const current = await lockConnector(
        trx,
        input.organizationId,
        input.connectorId,
      );
      requireRecordRevision(
        current.record_revision,
        input.expectedRecordRevision,
      );

      if (current.lifecycle_state === input.lifecycleState)
        throw new ConnectorMetadataRefusal(
          'change_not_permitted',
          'the connector already holds that lifecycle state',
        );
      if (
        !mayTransitionLifecycle(current.lifecycle_state, input.lifecycleState)
      )
        throw new ConnectorMetadataRefusal(
          'lifecycle_transition_unsupported',
          'that lifecycle transition is not permitted',
        );

      const updated = await trx
        .updateTable('integration_connector')
        .set({
          lifecycle_state: input.lifecycleState,
          configuration_revision: current.configuration_revision + 1,
          record_revision: current.record_revision + 1,
        })
        .where('organization_id', '=', input.organizationId)
        .where('id', '=', input.connectorId)
        .where('record_revision', '=', input.expectedRecordRevision)
        .returningAll()
        .executeTakeFirst();
      if (!updated) throw staleRevision();

      await writeAudit(trx, updated, {
        category: 'lifecycle_changed',
        priorConfigurationRevision: current.configuration_revision,
        priorRecordRevision: current.record_revision,
        priorLifecycleState: current.lifecycle_state,
        actor: input.actor,
        correlationId: input.correlationId,
      });

      return project(updated);
    });
  }

  /** Replaces the capability contract, which is revision-significant. */
  async updateCapabilities(input: {
    readonly organizationId: string;
    readonly connectorId: string;
    readonly expectedRecordRevision: number;
    readonly capabilities: ConnectorCapabilities;
    readonly actor: string;
    readonly correlationId: string;
  }): Promise<ConnectorMetadata> {
    const capabilities = assertCapabilities(input.capabilities);

    return this.client.transaction().execute(async (trx) => {
      await lockOrganization(trx, input.organizationId);
      const current = await lockConnector(
        trx,
        input.organizationId,
        input.connectorId,
      );
      requireRecordRevision(
        current.record_revision,
        input.expectedRecordRevision,
      );

      if (!capabilitiesDiffer(fromCapabilityColumns(current), capabilities))
        throw new ConnectorMetadataRefusal(
          'change_not_permitted',
          'the capability contract is unchanged',
        );

      const updated = await trx
        .updateTable('integration_connector')
        .set({
          ...toCapabilityColumns(capabilities),
          configuration_revision: current.configuration_revision + 1,
          record_revision: current.record_revision + 1,
        })
        .where('organization_id', '=', input.organizationId)
        .where('id', '=', input.connectorId)
        .where('record_revision', '=', input.expectedRecordRevision)
        .returningAll()
        .executeTakeFirst();
      if (!updated) throw staleRevision();

      await writeAudit(trx, updated, {
        category: 'capabilities_changed',
        priorConfigurationRevision: current.configuration_revision,
        priorRecordRevision: current.record_revision,
        priorLifecycleState: current.lifecycle_state,
        actor: input.actor,
        correlationId: input.correlationId,
      });

      return project(updated);
    });
  }

  /**
   * Rotates the credential reference, which is deliberately *not*
   * configuration-significant.
   *
   * Rotation changes no semantics, so it must not advance
   * `configuration_revision`: doing so would aim every pinned revision at a
   * superseded row and report a behaviour change that did not happen
   * (F062.2A §9.2). It **does** advance `record_revision`, which is what keeps
   * two concurrent rotations from overwriting each other — the alternative,
   * making rotation configuration-significant to get concurrency control for
   * free, would corrupt the meaning of the semantic pin.
   *
   * It is still audited, as a non-advancing row sharing the current
   * configuration revision, because changing which credential a destination
   * uses is operationally significant even when semantically inert. Connector
   * identity is untouched, so nothing in flight is invalidated.
   */
  async rotateCredentialReference(input: {
    readonly organizationId: string;
    readonly connectorId: string;
    readonly expectedRecordRevision: number;
    readonly credentialReference: string | null;
    readonly actor: string;
    readonly correlationId: string;
  }): Promise<ConnectorMetadata> {
    const credentialReference = assertCredentialReference(
      input.credentialReference,
    );

    return this.client.transaction().execute(async (trx) => {
      await lockOrganization(trx, input.organizationId);
      const current = await lockConnector(
        trx,
        input.organizationId,
        input.connectorId,
      );
      requireRecordRevision(
        current.record_revision,
        input.expectedRecordRevision,
      );

      if (current.credential_reference === credentialReference)
        throw new ConnectorMetadataRefusal(
          'change_not_permitted',
          'the credential reference is unchanged',
        );

      const updated = await trx
        .updateTable('integration_connector')
        .set({
          credential_reference: credentialReference,
          // Advances; configuration_revision deliberately does not.
          record_revision: current.record_revision + 1,
        })
        .where('organization_id', '=', input.organizationId)
        .where('id', '=', input.connectorId)
        .where('record_revision', '=', input.expectedRecordRevision)
        .returningAll()
        .executeTakeFirst();
      if (!updated) throw staleRevision();

      await writeAudit(trx, updated, {
        category: 'credential_reference_rotated',
        priorConfigurationRevision: current.configuration_revision,
        priorRecordRevision: current.record_revision,
        priorLifecycleState: current.lifecycle_state,
        actor: input.actor,
        correlationId: input.correlationId,
      });

      return project(updated);
    });
  }

  /** Full mutation history for one connector, newest first. */
  async listRevisions(
    organizationId: string,
    connectorId: string,
  ): Promise<ConnectorRevisionRecord[]> {
    const rows = await this.client
      .selectFrom('integration_connector_audit')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where('integration_connector_id', '=', connectorId)
      .orderBy('record_revision', 'desc')
      .execute();
    return rows.map(projectRevision);
  }

  /**
   * What was authoritative at one exact revision.
   *
   * This is the read F062.2A §9.2 depends on: resolving a past ambiguous
   * delivery must use the capabilities that governed *that* dispatch, never
   * whatever the connector declares now. Only the revision-advancing row is
   * considered, because a credential rotation shares a revision without
   * changing its semantics.
   */
  async capabilitiesAtRevision(
    organizationId: string,
    connectorId: string,
    configurationRevision: number,
  ): Promise<ConnectorRevisionRecord | null> {
    const row = await this.client
      .selectFrom('integration_connector_audit')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where('integration_connector_id', '=', connectorId)
      .where('configuration_revision', '=', configurationRevision)
      .where('revision_advanced', '=', true)
      .executeTakeFirst();
    return row ? projectRevision(row) : null;
  }
}

/** The selected shapes, derived from the schema rather than restated, so a
 * column type change surfaces here as a compile error. */
type ConnectorRow = Selectable<DatabaseSchema['integration_connector']>;
type ConnectorAuditRow = Selectable<
  DatabaseSchema['integration_connector_audit']
>;
function project(row: ConnectorRow): ConnectorMetadata {
  return {
    id: row.id,
    organizationId: row.organization_id,
    connectorKey: row.connector_key,
    connectorKind: row.connector_kind,
    lifecycleState: row.lifecycle_state,
    configurationRevision: row.configuration_revision,
    recordRevision: row.record_revision,
    capabilities: fromCapabilityColumns(row),
    // Presence, not the locator. A caller that does not need it never
    // receives it, which keeps it out of logs and responses by default.
    credentialReferencePresent: row.credential_reference !== null,
  };
}

/**
 * Normalises a database instant to a Date.
 *
 * node-postgres returns `timestamptz` as a Date by default, but the schema's
 * `ColumnType` does not narrow to it under `Selectable`, and a deployment may
 * configure the driver to return strings. Converting once here is honest about
 * both cases and refuses anything else rather than producing an Invalid Date
 * that would surface much later as a confusing history entry.
 */
function instant(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  throw new Error('Invalid connector audit timestamp from the database');
}

function projectRevision(row: ConnectorAuditRow): ConnectorRevisionRecord {
  return {
    recordRevision: row.record_revision,
    priorRecordRevision: row.prior_record_revision,
    configurationRevision: row.configuration_revision,
    revisionAdvanced: row.revision_advanced,
    changeCategory: row.change_category,
    lifecycleState: row.lifecycle_state,
    priorLifecycleState: row.prior_lifecycle_state,
    capabilities: fromCapabilityColumns(row),
    credentialReferencePresent: row.credential_reference_present,
    changedAt: instant(row.changed_at),
  };
}

/**
 * ADR-024's first barrier, unchanged: the Organization is shared-locked before
 * any dependent write, so a connector cannot be registered or altered while
 * the Organization it belongs to is being changed concurrently.
 *
 * `for share` requires UPDATE privilege on at least one column of the locked
 * table, which the runtime already holds on `organization`; no new privilege
 * and no SECURITY DEFINER helper is introduced by this slice.
 */
async function lockOrganization(
  trx: Kysely<DatabaseSchema>,
  organizationId: string,
): Promise<void> {
  const locked = await trx
    .selectFrom('organization')
    .select(['id', 'status'])
    .where('id', '=', organizationId)
    .forShare()
    .executeTakeFirst();
  if (locked?.status !== 'active')
    throw new ConnectorMetadataRefusal(
      'organization_unavailable',
      'the Organization is not available for connector administration',
    );
}

/** Locks one connector for update. Organization-scoped, so a connector in
 * another Organization is simply not found. */
async function lockConnector(
  trx: Kysely<DatabaseSchema>,
  organizationId: string,
  connectorId: string,
): Promise<ConnectorRow> {
  const row = await trx
    .selectFrom('integration_connector')
    .selectAll()
    .where('organization_id', '=', organizationId)
    .where('id', '=', connectorId)
    .forUpdate()
    .executeTakeFirst();
  if (!row)
    throw new ConnectorMetadataRefusal(
      'connector_unknown',
      'no such connector for this Organization',
    );
  return row;
}

function requireRecordRevision(actual: number, expected: number): void {
  if (actual !== expected) throw staleRevision();
}

/** One refusal for every stale-token path, so a caller cannot tell a
 * concurrent writer from a mistaken expectation — and never retries blindly. */
function staleRevision(): ConnectorMetadataRefusal {
  return new ConnectorMetadataRefusal(
    'revision_stale',
    'the connector record revision has moved; re-read before changing it',
  );
}

async function writeAudit(
  trx: Kysely<DatabaseSchema>,
  row: ConnectorRow,
  change: {
    readonly category: ConnectorChangeCategory;
    readonly priorConfigurationRevision: number | null;
    readonly priorRecordRevision: number | null;
    readonly priorLifecycleState: ConnectorLifecycleState | null;
    readonly actor: string;
    readonly correlationId: string;
  },
): Promise<void> {
  await trx
    .insertInto('integration_connector_audit')
    .values({
      organization_id: row.organization_id,
      integration_connector_id: row.id,
      configuration_revision: row.configuration_revision,
      record_revision: row.record_revision,
      revision_advanced: advancesConfigurationRevision(change.category),
      change_category: change.category,
      connector_key: row.connector_key,
      connector_kind: row.connector_kind,
      lifecycle_state: row.lifecycle_state,
      ...toCapabilityColumns(fromCapabilityColumns(row)),
      // Presence only: the locator's value is never copied into history.
      credential_reference_present: row.credential_reference !== null,
      prior_configuration_revision: change.priorConfigurationRevision,
      prior_record_revision: change.priorRecordRevision,
      prior_lifecycle_state: change.priorLifecycleState,
      actor: change.actor,
      correlation_id: change.correlationId,
    })
    .execute();
}

/** Validates the whole transaction now rather than at commit, so a caller can
 * prove the deferred audit constraint is satisfied before committing. */
export async function assertDeferredConstraints(
  trx: Kysely<DatabaseSchema>,
): Promise<void> {
  await sql`set constraints all immediate`.execute(trx);
}
