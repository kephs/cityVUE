import { Injectable } from '@nestjs/common';
import type { Kysely, Selectable } from 'kysely';
import { DatabaseService } from '../../database/database.service.js';
import type { DatabaseSchema } from '../../database/database.types.js';
import {
  assertEnqueueable,
  type EnqueueIntentInput,
  INITIAL_DELIVERY_STATE,
  type IntegrationIntent,
  OutboxRefusal,
} from './outbox.js';

/**
 * F062.2C — transactional outbox data access.
 *
 * **NO EXTERNAL DELIVERY IS ENABLED.** No worker, no claim, no lease, no
 * retry, no dead-letter query, no ready-item scan, no transport. The only
 * write is an insert.
 *
 * **There is deliberately no update and no delete primitive.** A controlled
 * transition belongs with the delivery-attempt slice, where evidence of what
 * was attempted exists to accompany it; offering transitions first would let a
 * row be marked delivered with nothing recording the attempt. The database
 * refuses every UPDATE and DELETE on the table, so this is not merely an
 * omission in the repository.
 *
 * **No real business event is wired to this.** No domain service calls it.
 * Each future producer needs its own payload and authority review, which is a
 * product decision rather than a mechanism one.
 */
@Injectable()
export class OutboxRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Reads one intent by Organization and identity.
   *
   * Returns null both when no such intent exists and when it belongs to
   * another Organization — the two are indistinguishable by design.
   */
  async findById(
    organizationId: string,
    outboxId: string,
  ): Promise<IntegrationIntent | null> {
    const row = await this.database.client
      .selectFrom('integration_outbox')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where('id', '=', outboxId)
      .executeTakeFirst();
    return row ? project(row) : null;
  }

  /**
   * Reads one intent by its per-connector dedupe identity.
   *
   * This exists to make the idempotency invariant observable: a caller that
   * re-runs a handler can establish that the intent is already enqueued rather
   * than inferring it from a constraint violation.
   */
  async findByIntegrationId(
    organizationId: string,
    connectorId: string,
    integrationId: string,
  ): Promise<IntegrationIntent | null> {
    const row = await this.database.client
      .selectFrom('integration_outbox')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where('integration_connector_id', '=', connectorId)
      .where('integration_id', '=', integrationId)
      .executeTakeFirst();
    return row ? project(row) : null;
  }
}

/**
 * Enqueues one integration intent **inside a transaction the caller owns**.
 *
 * This is the whole point of the slice, and the signature is the mechanism:
 * the transaction is a parameter, so a business mutation and its integration
 * intent commit or roll back **together**. A version that opened its own
 * transaction, or reached for a shared client, would be a dual write — the
 * exact failure the outbox pattern exists to prevent, and it would lose
 * intents silently rather than loudly.
 *
 * It is a free function rather than a repository method for the same reason:
 * a method on an injected repository holding its own `DatabaseService` invites
 * exactly the mistake of using that connection instead of the caller's.
 *
 * **The caller is responsible for ADR-024's authority barrier** — Organization
 * `FOR SHARE` first, then the domain row — and must have completed it before
 * calling. Enqueue deliberately does not re-acquire the Organization lock:
 * taking an authority lock *after* a domain row lock is the ordering ADR-024
 * warns against, and re-taking it here would do that.
 *
 * The connector's semantic revision is resolved and pinned inside this
 * transaction. The database guard share-locks the connector, proves the pin is
 * the connector's current semantic revision, and proves that revision names a
 * real authoritative snapshot — so a concurrent configuration change cannot
 * land between resolving and pinning, and a stale pin is refused rather than
 * recorded.
 */
export async function enqueueIntegrationIntent(
  transaction: Kysely<DatabaseSchema>,
  input: EnqueueIntentInput,
): Promise<IntegrationIntent> {
  const contract = assertEnqueueable(input);

  // Resolved in the caller's transaction. The guard re-reads and share-locks
  // the same row, so this read is for the value and the refusal message; the
  // database is the boundary.
  const connector = await transaction
    .selectFrom('integration_connector')
    .select(['configuration_revision', 'lifecycle_state'])
    .where('organization_id', '=', input.organizationId)
    .where('id', '=', input.connectorId)
    .forShare()
    .executeTakeFirst();
  if (!connector)
    throw new OutboxRefusal(
      'connector_unknown',
      'no such connector for this Organization',
    );
  if (connector.lifecycle_state === 'retired')
    throw new OutboxRefusal(
      'connector_retired',
      'a retired connector accepts no new intents',
    );

  const row = await transaction
    .insertInto('integration_outbox')
    .values({
      organization_id: input.organizationId,
      integration_connector_id: input.connectorId,
      integration_id: input.integrationId,
      integration_type: input.integrationType,
      contract_kind: contract.contractKind,
      aggregate_type: contract.aggregateType,
      schema_version: contract.schemaVersion,
      payload_mode: contract.payloadMode,
      aggregate_id: input.aggregateId,
      aggregate_revision: input.aggregateRevision,
      origin_kind: input.origin.kind,
      origin_connector_id:
        input.origin.kind === 'external' ? input.origin.connectorId : null,
      correlation_id: input.correlationId,
      causation_id: input.causationId,
      deployment_environment: input.deploymentEnvironment,
      pinned_connector_configuration_revision: connector.configuration_revision,
      occurred_at: input.occurredAt,
      // `state` is deliberately not supplied: the database forces it.
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return project(row);
}

type OutboxRow = Selectable<DatabaseSchema['integration_outbox']>;

function project(row: OutboxRow): IntegrationIntent {
  return {
    id: row.id,
    organizationId: row.organization_id,
    connectorId: row.integration_connector_id,
    integrationId: row.integration_id,
    integrationType: row.integration_type,
    contractKind: row.contract_kind,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    aggregateRevision: row.aggregate_revision,
    schemaVersion: row.schema_version,
    payloadMode: row.payload_mode,
    pinnedConnectorConfigurationRevision:
      row.pinned_connector_configuration_revision,
    // Narrowed to the only reachable value. If a later slice makes other
    // states reachable, this stops compiling, which is the intended signal
    // that the projection and the state machine must be revisited together.
    state: INITIAL_DELIVERY_STATE,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    occurredAt: instant(row.occurred_at),
  };
}

/** node-postgres returns `timestamptz` as a Date, but the schema's
 * `ColumnType` does not narrow to it under `Selectable`, and a deployment may
 * configure the driver to return strings. Converted once, and refused rather
 * than silently becoming an Invalid Date. */
function instant(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  throw new Error('Invalid integration outbox timestamp from the database');
}
