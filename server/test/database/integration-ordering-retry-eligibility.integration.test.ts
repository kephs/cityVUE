import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';
import { up as catalogUp } from '../../migrations/20260902000000-create-organization-service-catalog.js';
import { up as connectorUp } from '../../migrations/20261020000000-add-integration-connector-registry.js';
import { up as outboxUp } from '../../migrations/20261021000000-add-integration-outbox.js';
import { up as attemptUp } from '../../migrations/20261022000000-add-integration-delivery-attempt.js';
import { up as leaseUp } from '../../migrations/20261024000000-add-integration-lease-recovery-evidence.js';
import {
  down,
  up,
} from '../../migrations/20261025000000-add-integration-ordering-retry-eligibility.js';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import {
  NO_CAPABILITIES,
  type OrderingGuarantee,
} from '../../src/integration/connector-capabilities.js';
import { toCapabilityColumns } from '../../src/integration/persistence/connector-metadata.js';
import { enqueueIntegrationIntent } from '../../src/integration/persistence/outbox.repository.js';
import type { EnqueueIntentInput } from '../../src/integration/persistence/outbox.js';

/**
 * F062.2D-2C-2 — ordered-stream pinning, mutual exclusion and
 * retry-eligibility persistence, proven against PostgreSQL.
 *
 * Every assertion is a database property and every test is deterministic:
 * **no sleeps**. Timestamps are constructed directly where due/future
 * semantics matter.
 *
 * **No strict-FIFO predicate, no retry scheduler and no worker exists here.**
 * The index proven below is mutual exclusion only.
 */

const url = process.env.TEST_DATABASE_URL;
type Database = Kysely<DatabaseSchema>;

const BLOCKING = ['dispatching', 'ambiguous'] as const;

interface Fixture {
  readonly db: Database;
  readonly organizationId: string;
  /** supports_ordering = 'per_aggregate' at revision 1. */
  readonly orderedConnector: string;
  /** supports_ordering = 'none' at revision 1. */
  readonly plainConnector: string;
}

async function withSchema(
  run: (fixture: Fixture) => Promise<void>,
  options: { readonly applyOrderingMigration?: boolean } = {},
): Promise<void> {
  const schema = 'integration_ordering_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString: url });
  try {
    await prepareDatabaseExtensions(admin);
  } catch (error) {
    await admin.end();
    throw error;
  }
  await admin.query('create schema "' + schema + '"');
  const db = new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: url,
        options: '-c search_path=' + schema,
      }),
    }),
  });
  try {
    await catalogUp(db);
    await connectorUp(db);
    await outboxUp(db);
    await attemptUp(db);
    await leaseUp(db);
    if (options.applyOrderingMigration !== false) await up(db);
    const organizationId = randomUUID();
    await db
      .insertInto('organization')
      .values({
        id: organizationId,
        name: 'F062.2D-2C-2 Synthetic',
        short_name: 'Test',
        slug: 'f0622d2c2-' + organizationId,
        status: 'active',
        default_business_timezone: 'America/New_York',
      })
      .execute();
    await run({
      db,
      organizationId,
      orderedConnector: await registerConnector(
        db,
        organizationId,
        'ordered-one',
        'per_aggregate',
      ),
      plainConnector: await registerConnector(
        db,
        organizationId,
        'plain-one',
        'none',
      ),
    });
  } finally {
    await db.destroy();
    await admin.query('drop schema "' + schema + '" cascade');
    await admin.end();
  }
}

async function registerConnector(
  db: Database,
  organizationId: string,
  connectorKey: string,
  supportsOrdering: OrderingGuarantee,
): Promise<string> {
  const capabilities = {
    ...NO_CAPABILITIES,
    supportsOrdering,
    supportsIdempotencyKey: true,
  };
  return db.transaction().execute(async (trx) => {
    const created = await trx
      .insertInto('integration_connector')
      .values({
        organization_id: organizationId,
        connector_key: connectorKey,
        connector_kind: 'loopback',
        ...toCapabilityColumns(capabilities),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('integration_connector_audit')
      .values({
        organization_id: organizationId,
        integration_connector_id: created.id,
        record_revision: created.record_revision,
        configuration_revision: created.configuration_revision,
        prior_record_revision: null,
        revision_advanced: true,
        change_category: 'registered',
        connector_key: created.connector_key,
        connector_kind: created.connector_kind,
        lifecycle_state: created.lifecycle_state,
        ...toCapabilityColumns(capabilities),
        credential_reference_present: false,
        prior_configuration_revision: null,
        prior_lifecycle_state: null,
        actor: 'test-operator',
        correlation_id: randomUUID(),
      })
      .execute();
    return created.id;
  });
}

/** Advances a connector to the next configuration revision, changing only its
 * ordering capability, and writes the matching advancing audit snapshot. */
async function reorderConnector(
  db: Database,
  organizationId: string,
  connectorId: string,
  supportsOrdering: OrderingGuarantee,
): Promise<number> {
  return db.transaction().execute(async (trx) => {
    const current = await trx
      .selectFrom('integration_connector')
      .selectAll()
      .where('id', '=', connectorId)
      .executeTakeFirstOrThrow();
    const updated = await trx
      .updateTable('integration_connector')
      .set({
        supports_ordering: supportsOrdering,
        configuration_revision: current.configuration_revision + 1,
        record_revision: current.record_revision + 1,
      })
      .where('id', '=', connectorId)
      .returningAll()
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('integration_connector_audit')
      .values({
        organization_id: organizationId,
        integration_connector_id: connectorId,
        record_revision: updated.record_revision,
        configuration_revision: updated.configuration_revision,
        prior_record_revision: current.record_revision,
        revision_advanced: true,
        change_category: 'capabilities_changed',
        connector_key: updated.connector_key,
        connector_kind: updated.connector_kind,
        lifecycle_state: updated.lifecycle_state,
        operations: updated.operations,
        supports_idempotency_key: updated.supports_idempotency_key,
        supports_read_after_write: updated.supports_read_after_write,
        supports_reconciliation: updated.supports_reconciliation,
        supports_webhook_callback: updated.supports_webhook_callback,
        supports_ordering: updated.supports_ordering,
        supports_update: updated.supports_update,
        supports_cancel: updated.supports_cancel,
        supports_delete: updated.supports_delete,
        supports_current_state_sync: updated.supports_current_state_sync,
        reports_terminal_state: updated.reports_terminal_state,
        side_effect_risk: updated.side_effect_risk,
        credential_reference_present: updated.credential_reference !== null,
        prior_configuration_revision: current.configuration_revision,
        prior_lifecycle_state: current.lifecycle_state,
        actor: 'test-operator',
        correlation_id: randomUUID(),
      })
      .execute();
    return updated.configuration_revision;
  });
}

function intent(
  organizationId: string,
  connectorId: string,
  aggregateRevision: number | null,
  aggregateId = randomUUID(),
): EnqueueIntentInput {
  return {
    organizationId,
    connectorId,
    integrationId: randomUUID(),
    integrationType: 'work_item.sync_requested',
    aggregateId,
    aggregateRevision,
    origin: { kind: 'reqro' },
    correlationId: randomUUID(),
    causationId: null,
    deploymentEnvironment: 'test',
    occurredAt: new Date(),
  };
}

async function enqueue(
  db: Database,
  organizationId: string,
  connectorId: string,
  aggregateRevision: number | null = 1,
  aggregateId = randomUUID(),
): Promise<string> {
  const stored = await db
    .transaction()
    .execute((trx) =>
      enqueueIntegrationIntent(
        trx,
        intent(organizationId, connectorId, aggregateRevision, aggregateId),
      ),
    );
  return stored.id;
}

async function message(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected the operation to be refused');
}

async function moveState(
  db: Database,
  outboxId: string,
  next: string,
): Promise<void> {
  await sql`update integration_outbox set state = ${next}
            where id = ${outboxId}`.execute(db);
}

/** Drives an obligation to a blocking state through legal edges only. */
async function toBlocking(
  db: Database,
  outboxId: string,
  target: 'dispatching' | 'ambiguous',
): Promise<void> {
  await moveState(db, outboxId, 'dispatching');
  if (target === 'ambiguous') await moveState(db, outboxId, 'ambiguous');
}

async function orderingOf(
  db: Database,
  outboxId: string,
): Promise<{ ordered: boolean; revision: number }> {
  const row = await sql<{ ordered: boolean; revision: number }>`
    select requires_ordered_delivery as ordered,
           pinned_connector_configuration_revision as revision
    from integration_outbox where id = ${outboxId}`.execute(db);
  const first = row.rows[0];
  assert.ok(first !== undefined);
  return first;
}

test(
  'F062.2D-2C-2 ordered-stream pinning, mutual exclusion and retry eligibility',
  {
    skip:
      url === undefined &&
      'TEST_DATABASE_URL is not set; the ordering persistence proof is skipped',
  },
  async (t) => {
    // -----------------------------------------------------------------
    // Schema shape
    // -----------------------------------------------------------------

    await t.test(
      'the two columns carry the reviewed types, nullability and absence of defaults',
      async () => {
        await withSchema(async ({ db }) => {
          const columns = await sql<{
            column_name: string;
            data_type: string;
            is_nullable: string;
            column_default: string | null;
          }>`
            select column_name, data_type, is_nullable, column_default
            from information_schema.columns
            where table_schema = current_schema()
              and table_name = 'integration_outbox'
              and column_name in ('next_attempt_at', 'requires_ordered_delivery')
            order by column_name`.execute(db);
          assert.deepEqual(columns.rows, [
            {
              column_name: 'next_attempt_at',
              data_type: 'timestamp with time zone',
              is_nullable: 'YES',
              column_default: null,
            },
            {
              // NOT NULL with NO default: the value can only come from the
              // guard's snapshot derivation, never from a column default.
              column_name: 'requires_ordered_delivery',
              data_type: 'boolean',
              is_nullable: 'NO',
              column_default: null,
            },
          ]);

          // No delay, exponent, jitter, ceiling or horizon is encoded.
          const constraints = await sql<{ definition: string }>`
            select pg_get_constraintdef(c.oid) as definition
            from pg_constraint c
            where c.conrelid = 'integration_outbox'::regclass`.execute(db);
          for (const row of constraints.rows)
            assert.equal(
              /interval|backoff|jitter/i.test(row.definition),
              false,
              `a constraint encodes scheduling policy: ${row.definition}`,
            );
        });
      },
    );

    await t.test(
      'the ordered-stream index is partial, unique and keyed on the stream identity',
      async () => {
        await withSchema(async ({ db }) => {
          const index = await sql<{ indexdef: string }>`
            select indexdef from pg_indexes
            where schemaname = current_schema()
              and tablename = 'integration_outbox'
              and indexname = 'integration_outbox_ordered_stream_in_flight'`.execute(
            db,
          );
          const definition = index.rows[0]?.indexdef ?? '';
          assert.match(definition, /CREATE UNIQUE INDEX/);
          assert.match(
            definition,
            /\(organization_id, integration_connector_id, aggregate_type, aggregate_id\)/,
          );
          assert.match(definition, /requires_ordered_delivery/);
          // Exactly the reviewed blocking states occupy the slot.
          for (const blocking of BLOCKING)
            assert.ok(
              definition.includes(`'${blocking}'`),
              `${blocking} must occupy the blocking slot`,
            );
          // pending, retrying and accepted are deliberately absent: the index
          // constrains concurrency, never queue depth.
          for (const absent of ['pending', 'retrying', 'accepted'])
            assert.equal(
              definition.includes(`'${absent}'`),
              false,
              `${absent} must not occupy the blocking slot`,
            );

          // Exactly one index was added by this migration, and it is the only
          // one mentioning the ordering flag.
          const all = await sql<{ indexname: string; indexdef: string }>`
            select indexname, indexdef from pg_indexes
            where schemaname = current_schema()
              and tablename = 'integration_outbox'`.execute(db);
          assert.deepEqual(
            all.rows
              .filter((row) =>
                row.indexdef.includes('requires_ordered_delivery'),
              )
              .map((row) => row.indexname),
            ['integration_outbox_ordered_stream_in_flight'],
          );
          // No speculative retry polling index.
          assert.deepEqual(
            all.rows
              .filter((row) => row.indexdef.includes('next_attempt_at'))
              .map((row) => row.indexname),
            [],
          );
        });
      },
    );

    // -----------------------------------------------------------------
    // Ordering derivation and pinning
    // -----------------------------------------------------------------

    await t.test(
      'A and B — the ordering requirement is derived from the pinned revision',
      async () => {
        await withSchema(async (fixture) => {
          const { db, organizationId } = fixture;
          const ordered = await enqueue(
            db,
            organizationId,
            fixture.orderedConnector,
            7,
          );
          assert.deepEqual(await orderingOf(db, ordered), {
            ordered: true,
            revision: 1,
          });
          const plain = await enqueue(
            db,
            organizationId,
            fixture.plainConnector,
            null,
          );
          assert.deepEqual(await orderingOf(db, plain), {
            ordered: false,
            revision: 1,
          });
        });
      },
    );

    await t.test(
      'C and D — a caller cannot forge the ordering requirement in either direction',
      async () => {
        await withSchema(async (fixture) => {
          const { db, organizationId } = fixture;
          const forge = (connectorId: string, claimed: boolean) =>
            sql`
              insert into integration_outbox (
                organization_id, integration_connector_id, integration_id,
                contract_kind, integration_type, schema_version,
                aggregate_type, aggregate_id, aggregate_revision,
                origin_kind, correlation_id, deployment_environment,
                payload_mode, pinned_connector_configuration_revision,
                occurred_at, requires_ordered_delivery
              ) values (
                ${organizationId}, ${connectorId}, ${randomUUID()},
                'state_sync', 'work_item.sync_requested', 1,
                'work_item', ${randomUUID()}, 3,
                'reqro', ${randomUUID()}, 'test',
                'current_state_projection', 1,
                clock_timestamp(), ${claimed}
              )`.execute(db);

          // false against a per_aggregate contract: the dangerous direction,
          // because it would silently drop an ordering promise.
          const forgedFalse = await message(() =>
            forge(fixture.orderedConnector, false),
          );
          assert.match(
            forgedFalse,
            /ordering requirement is derived from the pinned connector revision and is not caller controlled/,
          );
          // true against a none contract: equally refused.
          const forgedTrue = await message(() =>
            forge(fixture.plainConnector, true),
          );
          assert.match(
            forgedTrue,
            /ordering requirement is derived from the pinned connector revision and is not caller controlled/,
          );
          // A value consistent with the snapshot is accepted, so the refusal
          // above is about contradiction rather than about supplying anything.
          await forge(fixture.orderedConnector, true);
          await forge(fixture.plainConnector, false);
        });
      },
    );

    await t.test(
      'E, F and the inverse — a later connector revision never reinterprets existing work',
      async () => {
        await withSchema(async (fixture) => {
          const { db, organizationId } = fixture;

          // Ordered at revision 1, then the connector stops requiring order.
          const pinnedOrdered = await enqueue(
            db,
            organizationId,
            fixture.orderedConnector,
            1,
          );
          const secondRevision = await reorderConnector(
            db,
            organizationId,
            fixture.orderedConnector,
            'none',
          );
          assert.equal(secondRevision, 2);
          // The existing obligation keeps the contract it pinned.
          assert.deepEqual(await orderingOf(db, pinnedOrdered), {
            ordered: true,
            revision: 1,
          });
          // A new obligation takes the later semantics.
          const pinnedPlain = await enqueue(
            db,
            organizationId,
            fixture.orderedConnector,
            null,
          );
          assert.deepEqual(await orderingOf(db, pinnedPlain), {
            ordered: false,
            revision: 2,
          });

          // And the inverse: none -> per_aggregate.
          const pinnedUnordered = await enqueue(
            db,
            organizationId,
            fixture.plainConnector,
            null,
          );
          assert.deepEqual(await orderingOf(db, pinnedUnordered), {
            ordered: false,
            revision: 1,
          });
          await reorderConnector(
            db,
            organizationId,
            fixture.plainConnector,
            'per_aggregate',
          );
          // The older obligation stays unordered, so a newly-declared
          // ordering promise cannot retroactively block in-flight work.
          assert.deepEqual(await orderingOf(db, pinnedUnordered), {
            ordered: false,
            revision: 1,
          });
          const nowOrdered = await enqueue(
            db,
            organizationId,
            fixture.plainConnector,
            4,
          );
          assert.deepEqual(await orderingOf(db, nowOrdered), {
            ordered: true,
            revision: 2,
          });
        });
      },
    );

    await t.test(
      'the pinned ordering requirement is immutable after insert',
      async () => {
        await withSchema(async (fixture) => {
          const { db, organizationId } = fixture;
          const ordered = await enqueue(
            db,
            organizationId,
            fixture.orderedConnector,
            1,
          );
          const refusal = await message(() =>
            sql`update integration_outbox
                      set requires_ordered_delivery = false,
                          state = 'dispatching'
                      where id = ${ordered}`.execute(db),
          );
          assert.match(
            refusal,
            /ordering requirement is pinned evidence and is immutable/,
          );
          assert.deepEqual(await orderingOf(db, ordered), {
            ordered: true,
            revision: 1,
          });
        });
      },
    );

    await t.test(
      'G — an intent with no reachable pinned snapshot is refused',
      async () => {
        await withSchema(async (fixture) => {
          const { db, organizationId } = fixture;
          // Advance to revision 2 legally, then remove that advancing
          // snapshot so the connector's current revision has no pinned
          // semantics. The audit is append-only, so its protections are
          // suspended for the removal: this is privileged test construction
          // of a state no reviewed path can produce.
          // 'none' rather than 'per_aggregate': the connector guard refuses
          // an update that changes nothing, so the revision must advance on a
          // real capability change.
          await reorderConnector(
            db,
            organizationId,
            fixture.orderedConnector,
            'none',
          );
          await sql`alter table integration_connector_audit
                    disable trigger user`.execute(db);
          await sql`delete from integration_connector_audit
                    where integration_connector_id = ${fixture.orderedConnector}
                      and configuration_revision = 2`.execute(db);
          await sql`alter table integration_connector_audit
                    enable trigger user`.execute(db);
          const refusal = await message(() =>
            enqueue(db, organizationId, fixture.orderedConnector, 1),
          );
          assert.match(
            refusal,
            /must pin an existing authoritative connector semantic snapshot/,
          );
        });
      },
    );

    await t.test(
      'H and I — an ordered intent requires an aggregate revision; an unordered one does not',
      async () => {
        await withSchema(async (fixture) => {
          const { db, organizationId } = fixture;
          // H: ordered with no causal revision is refused. created_at is NOT
          // substituted: it is enqueue time, not the aggregate's sequence.
          const refusal = await message(() =>
            enqueue(db, organizationId, fixture.orderedConnector, null),
          );
          assert.match(
            refusal,
            /ordered integration intent requires an aggregate revision to sequence its stream/,
          );
          // I: unordered state_sync with a null revision stays legal, which
          // is what keeps the pre-existing enqueue contract intact.
          const plain = await enqueue(
            db,
            organizationId,
            fixture.plainConnector,
            null,
          );
          const row = await sql<{ revision: number | null }>`
            select aggregate_revision as revision
            from integration_outbox where id = ${plain}`.execute(db);
          assert.deepEqual(row.rows, [{ revision: null }]);
        });
      },
    );

    // -----------------------------------------------------------------
    // Mutual exclusion
    // -----------------------------------------------------------------

    await t.test(
      'A, B and C — no two blocking obligations may share one ordered stream',
      async () => {
        for (const [first, second] of [
          ['dispatching', 'dispatching'],
          ['dispatching', 'ambiguous'],
          ['ambiguous', 'ambiguous'],
        ] as const) {
          await withSchema(async (fixture) => {
            const { db, organizationId } = fixture;
            const aggregateId = randomUUID();
            const a = await enqueue(
              db,
              organizationId,
              fixture.orderedConnector,
              1,
              aggregateId,
            );
            const b = await enqueue(
              db,
              organizationId,
              fixture.orderedConnector,
              2,
              aggregateId,
            );
            await toBlocking(db, a, first);
            const refusal = await message(() => toBlocking(db, b, second));
            assert.match(
              refusal,
              /integration_outbox_ordered_stream_in_flight/,
              `${first} + ${second} was not refused`,
            );
          });
        }
      },
    );

    await t.test(
      'D and E — pending and retrying siblings coexist freely',
      async () => {
        await withSchema(async (fixture) => {
          const { db, organizationId } = fixture;
          const aggregateId = randomUUID();
          const first = await enqueue(
            db,
            organizationId,
            fixture.orderedConnector,
            1,
            aggregateId,
          );
          const second = await enqueue(
            db,
            organizationId,
            fixture.orderedConnector,
            2,
            aggregateId,
          );
          const third = await enqueue(
            db,
            organizationId,
            fixture.orderedConnector,
            3,
            aggregateId,
          );
          // D: three pending rows for one aggregate. The index constrains
          // concurrency, never queue depth, so mayEnqueue stays intact.
          const pending = await sql<{ rows: string }>`
            select count(*)::text as rows from integration_outbox
            where aggregate_id = ${aggregateId} and state = 'pending'`.execute(
            db,
          );
          assert.deepEqual(pending.rows, [{ rows: '3' }]);

          // E: one retrying alongside two pending, still for one aggregate.
          await moveState(db, first, 'dispatching');
          await moveState(db, first, 'retrying');
          const mixed = await sql<{ state: string; rows: string }>`
            select state, count(*)::text as rows from integration_outbox
            where aggregate_id = ${aggregateId}
            group by state order by state`.execute(db);
          assert.deepEqual(mixed.rows, [
            { state: 'pending', rows: '2' },
            { state: 'retrying', rows: '1' },
          ]);
          assert.ok(second !== third);
        });
      },
    );

    await t.test(
      'F — an accepted predecessor does not occupy the blocking slot',
      async () => {
        await withSchema(async (fixture) => {
          const { db, organizationId } = fixture;
          const aggregateId = randomUUID();
          const first = await enqueue(
            db,
            organizationId,
            fixture.orderedConnector,
            1,
            aggregateId,
          );
          const second = await enqueue(
            db,
            organizationId,
            fixture.orderedConnector,
            2,
            aggregateId,
          );
          await moveState(db, first, 'dispatching');
          await moveState(db, first, 'accepted');
          // A connector without reports_terminal_state can never reach
          // acknowledged, so requiring it would block the stream forever.
          await toBlocking(db, second, 'dispatching');
          const states = await sql<{ state: string }>`
            select state from integration_outbox
            where aggregate_id = ${aggregateId} order by state`.execute(db);
          assert.deepEqual(states.rows, [
            { state: 'accepted' },
            { state: 'dispatching' },
          ]);
        });
      },
    );

    await t.test(
      'G, H and I — the stream key separates connectors, aggregates and unordered work',
      async () => {
        await withSchema(async (fixture) => {
          const { db, organizationId } = fixture;
          const shared = randomUUID();

          // G: the same aggregate under a second ordered connector. A
          // fan-out to two destinations must not let one block the other.
          const secondOrdered = await registerConnector(
            db,
            organizationId,
            'ordered-two',
            'per_aggregate',
          );
          const onFirst = await enqueue(
            db,
            organizationId,
            fixture.orderedConnector,
            1,
            shared,
          );
          const onSecond = await enqueue(
            db,
            organizationId,
            secondOrdered,
            1,
            shared,
          );
          await toBlocking(db, onFirst, 'dispatching');
          await toBlocking(db, onSecond, 'dispatching');

          // H: a different aggregate on the same connector.
          const otherAggregate = await enqueue(
            db,
            organizationId,
            fixture.orderedConnector,
            1,
            randomUUID(),
          );
          await toBlocking(db, otherAggregate, 'dispatching');

          // I: unordered obligations are outside the index entirely, so a
          // poison aggregate on such a connector blocks nothing at all.
          const plainAggregate = randomUUID();
          const plainA = await enqueue(
            db,
            organizationId,
            fixture.plainConnector,
            null,
            plainAggregate,
          );
          const plainB = await enqueue(
            db,
            organizationId,
            fixture.plainConnector,
            null,
            plainAggregate,
          );
          await toBlocking(db, plainA, 'dispatching');
          await toBlocking(db, plainB, 'ambiguous');

          const blocking = await sql<{ rows: string }>`
            select count(*)::text as rows from integration_outbox
            where state in ('dispatching', 'ambiguous')`.execute(db);
          assert.deepEqual(blocking.rows, [{ rows: '5' }]);
        });
      },
    );

    await t.test(
      'a second transaction cannot establish a conflicting blocking state',
      async () => {
        await withSchema(async (fixture) => {
          const { db, organizationId } = fixture;
          const aggregateId = randomUUID();
          const a = await enqueue(
            db,
            organizationId,
            fixture.orderedConnector,
            1,
            aggregateId,
          );
          const b = await enqueue(
            db,
            organizationId,
            fixture.orderedConnector,
            2,
            aggregateId,
          );

          // Deterministic, no sleeps: the first transaction holds an
          // uncommitted index entry, the second blocks on it and then fails
          // once the first commits. The contender is started inside the held
          // connection and awaited after the commit.
          const current = await sql<{ schema: string }>`
            select current_schema() as schema`.execute(db);
          const schema = current.rows[0]?.schema ?? '';
          assert.notEqual(schema, '');
          const rival = new Kysely<DatabaseSchema>({
            dialect: new PostgresDialect({
              pool: new Pool({
                connectionString: url,
                options: '-c search_path=' + schema,
              }),
            }),
          });
          try {
            let contender: Promise<string> | undefined;
            await db.connection().execute(async (held) => {
              await sql`begin`.execute(held);
              await sql`update integration_outbox set state = 'dispatching'
                        where id = ${a}`.execute(held);
              // The rival's conflicting update now waits on the uncommitted
              // unique index entry.
              contender = message(() =>
                sql`update integration_outbox set state = 'dispatching'
                          where id = ${b}`.execute(rival),
              );
              await sql`commit`.execute(held);
            });
            assert.ok(contender !== undefined);
            assert.match(
              await contender,
              /integration_outbox_ordered_stream_in_flight/,
            );
          } finally {
            await rival.destroy();
          }

          const states = await sql<{ id: string; state: string }>`
            select id, state from integration_outbox
            where aggregate_id = ${aggregateId} order by aggregate_revision`.execute(
            db,
          );
          assert.deepEqual(states.rows, [
            { id: a, state: 'dispatching' },
            { id: b, state: 'pending' },
          ]);
        });
      },
    );

    // -----------------------------------------------------------------
    // Retry eligibility persistence
    // -----------------------------------------------------------------

    await t.test(
      'next_attempt_at is null at enqueue and is not caller controlled',
      async () => {
        await withSchema(async (fixture) => {
          const { db, organizationId } = fixture;
          const obligation = await enqueue(
            db,
            organizationId,
            fixture.plainConnector,
            null,
          );
          const row = await sql<{ schedule: Date | null }>`
            select next_attempt_at as schedule
            from integration_outbox where id = ${obligation}`.execute(db);
          assert.equal(row.rows[0]?.schedule, null);

          const refusal = await message(() =>
            sql`
              insert into integration_outbox (
                organization_id, integration_connector_id, integration_id,
                contract_kind, integration_type, schema_version,
                aggregate_type, aggregate_id, origin_kind, correlation_id,
                deployment_environment, payload_mode,
                pinned_connector_configuration_revision, occurred_at,
                next_attempt_at
              ) values (
                ${organizationId}, ${fixture.plainConnector}, ${randomUUID()},
                'state_sync', 'work_item.sync_requested', 1,
                'work_item', ${randomUUID()}, 'reqro', ${randomUUID()},
                'test', 'current_state_projection', 1,
                clock_timestamp(), clock_timestamp() + interval '1 hour'
              )`.execute(db),
          );
          assert.match(refusal, /retry scheduling is not caller controlled/);
        });
      },
    );

    await t.test(
      'a retry schedule is legal only while retrying, in every other state refused',
      async () => {
        await withSchema(async (fixture) => {
          const { db, organizationId } = fixture;

          // Legal: established by the transition INTO retrying.
          const retrying = await enqueue(
            db,
            organizationId,
            fixture.plainConnector,
            null,
          );
          await moveState(db, retrying, 'dispatching');
          await sql`update integration_outbox
                    set state = 'retrying',
                        next_attempt_at = clock_timestamp() + interval '1 hour'
                    where id = ${retrying}`.execute(db);
          const scheduled = await sql<{ future: boolean }>`
            select next_attempt_at > clock_timestamp() as future
            from integration_outbox where id = ${retrying}`.execute(db);
          assert.deepEqual(scheduled.rows, [{ future: true }]);

          // Leaving retrying requires clearing it.
          const retained = await message(() =>
            sql`update integration_outbox set state = 'dispatching'
                      where id = ${retrying}`.execute(db),
          );
          assert.match(
            retained,
            /retry schedule exists only while the intent is retrying/,
          );
          await sql`update integration_outbox
                    set state = 'dispatching', next_attempt_at = null
                    where id = ${retrying}`.execute(db);

          // And every non-retrying state refuses a schedule outright.
          // Each target is reached from a legal predecessor, so the
          // refusal is attributable to the schedule rather than to a no-op
          // update: 'dispatching' is entered from pending, the rest from
          // dispatching.
          for (const target of [
            'dispatching',
            'ambiguous',
            'failed_permanent',
            'accepted',
          ] as const) {
            const obligation = await enqueue(
              db,
              organizationId,
              fixture.plainConnector,
              null,
            );
            if (target !== 'dispatching')
              await moveState(db, obligation, 'dispatching');
            const refusal = await message(() =>
              sql
                .raw(
                  `update integration_outbox
                    set state = '${target}',
                        next_attempt_at = clock_timestamp() + interval '1 hour'
                  where id = '${obligation}'`,
                )
                .execute(db),
            );
            assert.match(
              refusal,
              /retry schedule exists only while the intent is retrying|integration_outbox_retry_schedule_only_when_retrying/,
              target,
            );
          }
        });
      },
    );

    await t.test(
      'a due schedule changes nothing on its own, and no timer exists',
      async () => {
        await withSchema(async (fixture) => {
          const { db, organizationId } = fixture;
          const obligation = await enqueue(
            db,
            organizationId,
            fixture.plainConnector,
            null,
          );
          await moveState(db, obligation, 'dispatching');
          // Constructed directly as already due: no sleep, database clock.
          await sql`update integration_outbox
                    set state = 'retrying',
                        next_attempt_at = clock_timestamp() - interval '1 hour'
                    where id = ${obligation}`.execute(db);
          const due = await sql<{
            state: string;
            due: boolean;
          }>`
            select state, next_attempt_at <= clock_timestamp() as due
            from integration_outbox where id = ${obligation}`.execute(db);
          // Conceptually retry-eligible for 2C-3, and nothing has acted on
          // it: the state is unchanged and no attempt exists.
          assert.deepEqual(due.rows, [{ state: 'retrying', due: true }]);
          const attempts = await sql<{ rows: string }>`
            select count(*)::text as rows
            from integration_delivery_attempt`.execute(db);
          assert.deepEqual(attempts.rows, [{ rows: '0' }]);
        });
      },
    );

    // -----------------------------------------------------------------
    // Migration transaction safety
    //
    // The backfill suspends the row guard for one statement (§5.1 of the
    // feature document). These two tests prove the suspension cannot leak
    // and cannot be exploited, against the real guard and the real
    // migration rather than a stand-in.
    // -----------------------------------------------------------------

    await t.test(
      'a failure inside the unguarded window leaves the guard enabled and nothing written',
      async () => {
        await withSchema(async (fixture) => {
          const { db, organizationId } = fixture;
          const obligation = await enqueue(
            db,
            organizationId,
            fixture.plainConnector,
            null,
          );

          // The write the guard normally refuses outright: changing pinned
          // identity. It is attempted inside the unguarded window, so its
          // success there is what proves the window is real.
          const forbidden = (target: Kysely<DatabaseSchema>) =>
            sql`update integration_outbox
                set integration_id = ${'00000000-0000-0000-0000-00000000beef'}
                where id = ${obligation}`.execute(target);

          const before = await message(() => forbidden(db));
          assert.match(before, /identity and semantics are immutable/);

          await db.connection().execute(async (held) => {
            await sql`begin`.execute(held);
            await sql
              .raw(
                'alter table integration_outbox disable trigger integration_outbox_guard',
              )
              .execute(held);
            // Inside the window the guard is genuinely off, which is what
            // the backfill relies on.
            await forbidden(held);
            try {
              // Deliberate failure BEFORE the explicit re-enable, which is
              // exactly the leak the review asks about.
              await sql`select 1 / 0`.execute(held);
              throw new Error('the deliberate failure did not occur');
            } catch (error) {
              assert.match(
                error instanceof Error ? error.message : String(error),
                /division by zero/,
              );
            }
            await sql`rollback`.execute(held);
          });

          // 1. The trigger is enabled in the catalogue. 'O' is origin-enabled,
          // which is the normal state; 'D' would mean it leaked disabled.
          const trigger = await sql<{ tgname: string; tgenabled: string }>`
            select t.tgname, t.tgenabled from pg_trigger t
            where t.tgrelid = 'integration_outbox'::regclass
              and not t.tgisinternal
            order by t.tgname`.execute(db);
          assert.deepEqual(trigger.rows, [
            { tgname: 'integration_outbox_guard', tgenabled: 'O' },
            { tgname: 'integration_outbox_no_truncate', tgenabled: 'O' },
          ]);

          // 2. The write the guard normally refuses is refused again.
          const after = await message(() => forbidden(db));
          assert.match(after, /identity and semantics are immutable/);

          // 3. Nothing from the aborted transaction persisted.
          const row = await sql<{ integration_id: string; state: string }>`
            select integration_id, state from integration_outbox
            where id = ${obligation}`.execute(db);
          assert.notEqual(
            row.rows[0]?.integration_id,
            '00000000-0000-0000-0000-00000000beef',
          );
          assert.equal(row.rows[0]?.state, 'pending');
        });
      },
    );

    await t.test(
      'a concurrent writer cannot enter the unguarded window',
      async () => {
        await withSchema(async (fixture) => {
          const { db, organizationId } = fixture;
          const obligation = await enqueue(
            db,
            organizationId,
            fixture.plainConnector,
            null,
          );
          const current = await sql<{ schema: string }>`
            select current_schema() as schema`.execute(db);
          const schema = current.rows[0]?.schema ?? '';
          assert.notEqual(schema, '');
          const rival = new Kysely<DatabaseSchema>({
            dialect: new PostgresDialect({
              pool: new Pool({
                connectionString: url,
                options: '-c search_path=' + schema,
              }),
            }),
          });
          const observer = new Pool({ connectionString: url });
          try {
            let contender: Promise<string> | undefined;
            await db.connection().execute(async (held) => {
              await sql`begin`.execute(held);
              await sql
                .raw(
                  'alter table integration_outbox disable trigger integration_outbox_guard',
                )
                .execute(held);

              // ALTER TABLE ... DISABLE TRIGGER takes ShareRowExclusiveLock,
              // which conflicts with the RowExclusiveLock any INSERT or
              // UPDATE needs. So the window is not merely unlikely to be
              // shared -- it is unreachable while the migration holds it.
              const held_locks = await sql<{ mode: string }>`
                select l.mode from pg_locks l
                where l.relation = 'integration_outbox'::regclass
                  and l.pid = pg_backend_pid()
                  and l.mode = 'ShareRowExclusiveLock'`.execute(held);
              assert.deepEqual(held_locks.rows, [
                { mode: 'ShareRowExclusiveLock' },
              ]);

              // The rival attempts the forbidden identity write that would
              // succeed if it could reach the unguarded window.
              contender = message(() =>
                sql`update integration_outbox
                          set integration_id = ${'00000000-0000-0000-0000-0000000000ff'}
                          where id = ${obligation}`.execute(rival),
              );

              // Deterministic, no sleeps: poll the catalogue from a third
              // connection until the rival's ungranted lock request is
              // visible. That is the proof it is waiting rather than racing.
              let blocked = false;
              for (let attempt = 0; attempt < 500 && !blocked; attempt++) {
                const waiting = await observer.query<{ waiting: number }>(
                  `select count(*)::int as waiting
                     from pg_locks l
                     join pg_class c on c.oid = l.relation
                     join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = $1
                      and c.relname = 'integration_outbox'
                      and not l.granted`,
                  [schema],
                );
                blocked = (waiting.rows[0]?.waiting ?? 0) > 0;
              }
              assert.ok(
                blocked,
                'the concurrent writer was not blocked on a table lock',
              );

              await sql`rollback`.execute(held);
            });

            // Once the window closes the rival proceeds -- and is GUARDED,
            // so it never obtained unguarded access at any point.
            assert.ok(contender !== undefined);
            assert.match(
              await contender,
              /identity and semantics are immutable/,
            );
          } finally {
            await rival.destroy();
            await observer.end();
          }

          // And the obligation is untouched by either party.
          const row = await sql<{ integration_id: string }>`
            select integration_id from integration_outbox
            where id = ${obligation}`.execute(db);
          assert.notEqual(
            row.rows[0]?.integration_id,
            '00000000-0000-0000-0000-0000000000ff',
          );
        });
      },
    );

    // -----------------------------------------------------------------
    // Existing-row compatibility and rollback
    // -----------------------------------------------------------------

    await t.test(
      'existing obligations are backfilled from their own pinned snapshots',
      async () => {
        await withSchema(
          async (fixture) => {
            const { db, organizationId } = fixture;
            // Enqueue BEFORE the migration, under both contracts, then
            // advance the ordered connector so the current row disagrees with
            // what the older obligation pinned.
            const ordered = await enqueue(
              db,
              organizationId,
              fixture.orderedConnector,
              5,
            );
            const plain = await enqueue(
              db,
              organizationId,
              fixture.plainConnector,
              null,
            );
            await reorderConnector(
              db,
              organizationId,
              fixture.orderedConnector,
              'none',
            );

            await up(db);

            // Derived per row from the PINNED revision, not the current row.
            assert.deepEqual(await orderingOf(db, ordered), {
              ordered: true,
              revision: 1,
            });
            assert.deepEqual(await orderingOf(db, plain), {
              ordered: false,
              revision: 1,
            });
            // Nothing fabricated and nothing rewritten.
            const preserved = await sql<{
              rows: string;
              revisions: string;
              schedules: string;
              states: string;
            }>`
              select count(*)::text as rows,
                     count(*) filter (where aggregate_revision is not null)::text
                       as revisions,
                     count(*) filter (where next_attempt_at is not null)::text
                       as schedules,
                     count(distinct state)::text as states
              from integration_outbox`.execute(db);
            assert.deepEqual(preserved.rows, [
              { rows: '2', revisions: '1', schedules: '0', states: '1' },
            ]);
          },
          { applyOrderingMigration: false },
        );
      },
    );

    await t.test(
      'rollback refuses durable retry evidence, then succeeds and reapplies identically',
      async () => {
        await withSchema(async (fixture) => {
          const { db, organizationId } = fixture;
          const ordered = await enqueue(
            db,
            organizationId,
            fixture.orderedConnector,
            9,
          );
          const scheduled = await enqueue(
            db,
            organizationId,
            fixture.plainConnector,
            null,
          );
          await moveState(db, scheduled, 'dispatching');
          await sql`update integration_outbox
                    set state = 'retrying',
                        next_attempt_at = clock_timestamp() + interval '1 hour'
                    where id = ${scheduled}`.execute(db);

          const refusal = await message(() => down(db));
          assert.match(
            refusal,
            /Retained integration retry scheduling evidence prevents rollback/,
          );
          // The refusal changed nothing.
          const intact = await sql<{ schedules: string }>`
            select count(*) filter (where next_attempt_at is not null)::text
                     as schedules
            from integration_outbox`.execute(db);
          assert.deepEqual(intact.rows, [{ schedules: '1' }]);

          // Approved cleanup: the schedule is cleared by a legal transition
          // out of retrying, which is the only path the guard permits.
          await sql`update integration_outbox
                    set state = 'dead_lettered', next_attempt_at = null
                    where id = ${scheduled}`.execute(db);

          await down(db);
          const columns = await sql<{ present: string }>`
            select count(*)::text as present
            from information_schema.columns
            where table_schema = current_schema()
              and table_name = 'integration_outbox'
              and column_name in ('next_attempt_at', 'requires_ordered_delivery')`.execute(
            db,
          );
          assert.deepEqual(columns.rows, [{ present: '0' }]);
          const index = await sql<{ present: string }>`
            select count(*)::text as present from pg_indexes
            where schemaname = current_schema()
              and indexname = 'integration_outbox_ordered_stream_in_flight'`.execute(
            db,
          );
          assert.deepEqual(index.rows, [{ present: '0' }]);
          // Every obligation survives rollback.
          const survivors = await sql<{ rows: string }>`
            select count(*)::text as rows from integration_outbox`.execute(db);
          assert.deepEqual(survivors.rows, [{ rows: '2' }]);

          // Reapply reproduces the derived ordering identically.
          await up(db);
          assert.deepEqual(await orderingOf(db, ordered), {
            ordered: true,
            revision: 1,
          });
          assert.deepEqual(await orderingOf(db, scheduled), {
            ordered: false,
            revision: 1,
          });
        });
      },
    );

    await t.test(
      'the migration refuses to build the index over a pre-existing stream conflict',
      async () => {
        await withSchema(
          async (fixture) => {
            const { db, organizationId } = fixture;
            const aggregateId = randomUUID();
            // Two blocking obligations for one ordered aggregate, created
            // before the index exists.
            for (const revision of [1, 2]) {
              const obligation = await enqueue(
                db,
                organizationId,
                fixture.orderedConnector,
                revision,
                aggregateId,
              );
              await moveState(db, obligation, 'dispatching');
            }
            const refusal = await message(() => up(db));
            assert.match(
              refusal,
              /aggregate streams already hold more than one in-flight or ambiguous intent/,
            );
            // No winner selected, no state rewritten, nothing deleted.
            const untouched = await sql<{ state: string; rows: string }>`
              select state, count(*)::text as rows from integration_outbox
              group by state`.execute(db);
            assert.deepEqual(untouched.rows, [
              { state: 'dispatching', rows: '2' },
            ]);
          },
          { applyOrderingMigration: false },
        );
      },
    );

    await t.test(
      'the migration refuses an existing ordered obligation with no aggregate revision',
      async () => {
        await withSchema(
          async (fixture) => {
            const { db, organizationId } = fixture;
            // Legal before this slice: an ordered connector's state_sync
            // intent with no causal revision.
            await enqueue(db, organizationId, fixture.orderedConnector, null);
            const refusal = await message(() => up(db));
            assert.match(
              refusal,
              /existing ordered intents have no aggregate_revision/,
            );
          },
          { applyOrderingMigration: false },
        );
      },
    );

    await t.test(
      'the existing outbox guard protections remain intact',
      async () => {
        await withSchema(async (fixture) => {
          const { db, organizationId } = fixture;
          const obligation = await enqueue(
            db,
            organizationId,
            fixture.plainConnector,
            null,
          );

          // Identity and semantics immutable.
          const identity = await message(() =>
            sql`update integration_outbox
                      set integration_id = ${randomUUID()}, state = 'dispatching'
                      where id = ${obligation}`.execute(db),
          );
          assert.match(identity, /identity and semantics are immutable/);
          // A no-op update is still refused.
          const noop = await message(() =>
            sql`update integration_outbox set state = 'pending'
                      where id = ${obligation}`.execute(db),
          );
          assert.match(noop, /update changes nothing/);
          // Unreviewed transitions are still refused.
          const illegal = await message(() =>
            sql`update integration_outbox set state = 'acknowledged'
                      where id = ${obligation}`.execute(db),
          );
          assert.match(
            illegal,
            /Unsupported integration delivery state transition/,
          );
          // Deletion is still refused.
          const deletion = await message(() =>
            sql`delete from integration_outbox
                      where id = ${obligation}`.execute(db),
          );
          assert.match(deletion, /never deleted/);
          // The caller still cannot choose a delivery state at enqueue.
          const forcedState = await message(() =>
            sql`
              insert into integration_outbox (
                organization_id, integration_connector_id, integration_id,
                contract_kind, integration_type, schema_version,
                aggregate_type, aggregate_id, origin_kind, correlation_id,
                deployment_environment, payload_mode,
                pinned_connector_configuration_revision, occurred_at, state
              ) values (
                ${organizationId}, ${fixture.plainConnector}, ${randomUUID()},
                'state_sync', 'work_item.sync_requested', 1,
                'work_item', ${randomUUID()}, 'reqro', ${randomUUID()},
                'test', 'current_state_projection', 1,
                clock_timestamp(), 'dispatching'
              )`.execute(db),
          );
          assert.match(forcedState, /delivery state is not caller controlled/);
          // A stale pinned revision is still refused.
          const stalePin = await message(() =>
            sql`
              insert into integration_outbox (
                organization_id, integration_connector_id, integration_id,
                contract_kind, integration_type, schema_version,
                aggregate_type, aggregate_id, origin_kind, correlation_id,
                deployment_environment, payload_mode,
                pinned_connector_configuration_revision, occurred_at
              ) values (
                ${organizationId}, ${fixture.plainConnector}, ${randomUUID()},
                'state_sync', 'work_item.sync_requested', 1,
                'work_item', ${randomUUID()}, 'reqro', ${randomUUID()},
                'test', 'current_state_projection', 9,
                clock_timestamp()
              )`.execute(db),
          );
          assert.match(
            stalePin,
            /must pin the current connector semantic revision/,
          );
        });
      },
    );
  },
);
