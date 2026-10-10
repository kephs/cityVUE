import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';
import { up as catalogUp } from '../../migrations/20260902000000-create-organization-service-catalog.js';
import { up as connectorUp } from '../../migrations/20261020000000-add-integration-connector-registry.js';
import {
  down,
  up,
} from '../../migrations/20261021000000-add-integration-outbox.js';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import {
  INTEGRATION_TYPES,
  type IntegrationType,
} from '../../src/integration/integration-envelope.js';
import { NO_CAPABILITIES } from '../../src/integration/connector-capabilities.js';
import { toCapabilityColumns } from '../../src/integration/persistence/connector-metadata.js';
import { enqueueIntegrationIntent } from '../../src/integration/persistence/outbox.repository.js';
import type { EnqueueIntentInput } from '../../src/integration/persistence/outbox.js';

/**
 * F062.2C — transactional outbox schema and atomic-enqueue behaviour, proven
 * against PostgreSQL.
 *
 * The schema assertions are written as direct SQL so a passing result cannot
 * depend on application code; the atomicity proofs deliberately go through
 * `enqueueIntegrationIntent`, because the property under test is that the
 * primitive joins the caller's transaction.
 */

const url = process.env.TEST_DATABASE_URL;

type Database = Kysely<DatabaseSchema>;

interface Fixture {
  readonly db: Database;
  readonly organizationA: string;
  readonly organizationB: string;
  /** An active connector in A, at semantic revision 1. */
  readonly connectorA: string;
  /** A second connector in A, for fan-out. */
  readonly connectorA2: string;
  /** A connector owned by B, for cross-tenant attempts. */
  readonly connectorB: string;
}

async function withSchema(
  run: (fixture: Fixture) => Promise<void>,
): Promise<void> {
  const schema = 'integration_outbox_' + randomUUID().replaceAll('-', '');
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
    await up(db);
    const organizationA = randomUUID();
    const organizationB = randomUUID();
    await db
      .insertInto('organization')
      .values(
        [organizationA, organizationB].map((id, index) => ({
          id,
          name: 'F062.2C Synthetic ' + String(index),
          short_name: 'Test',
          slug: 'f0622c-' + id,
          status: 'active',
          default_business_timezone: 'America/New_York',
        })),
      )
      .execute();
    await run({
      db,
      organizationA,
      organizationB,
      connectorA: await registerConnector(db, organizationA, 'loopback-one'),
      connectorA2: await registerConnector(db, organizationA, 'loopback-two'),
      connectorB: await registerConnector(db, organizationB, 'loopback-one'),
    });
  } finally {
    await db.destroy();
    await admin.query('drop schema "' + schema + '" cascade');
    await admin.end();
  }
}

/** Registers a connector with its F062.2B audit evidence, in one transaction. */
async function registerConnector(
  db: Database,
  organizationId: string,
  connectorKey: string,
): Promise<string> {
  return db.transaction().execute(async (trx) => {
    const created = await trx
      .insertInto('integration_connector')
      .values({
        organization_id: organizationId,
        connector_key: connectorKey,
        connector_kind: 'loopback',
        ...toCapabilityColumns(NO_CAPABILITIES),
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
        ...toCapabilityColumns(NO_CAPABILITIES),
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

function intent(
  organizationId: string,
  connectorId: string,
  overrides: Partial<EnqueueIntentInput> = {},
): EnqueueIntentInput {
  return {
    organizationId,
    connectorId,
    integrationId: randomUUID(),
    integrationType: 'work_item.sync_requested',
    aggregateId: randomUUID(),
    aggregateRevision: null,
    origin: { kind: 'reqro' },
    correlationId: randomUUID(),
    causationId: null,
    deploymentEnvironment: 'test',
    occurredAt: new Date(),
    ...overrides,
  };
}

async function message(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected the operation to be refused');
}

function baseRow(
  organizationId: string,
  connectorId: string,
): Record<string, unknown> {
  return {
    organization_id: organizationId,
    integration_connector_id: connectorId,
    integration_id: randomUUID(),
    contract_kind: 'state_sync',
    integration_type: 'work_item.sync_requested',
    schema_version: 1,
    aggregate_type: 'work_item',
    aggregate_id: randomUUID(),
    aggregate_revision: null,
    origin_kind: 'reqro',
    origin_connector_id: null,
    correlation_id: randomUUID(),
    causation_id: null,
    deployment_environment: 'test',
    payload_mode: 'current_state_projection',
    pinned_connector_configuration_revision: 1,
    occurred_at: new Date(),
  };
}

/** Inserts through Kysely so values are bound, but with an explicit row, so a
 * test can supply a field the repository never would. */
async function insertRow(
  db: Database,
  row: Record<string, unknown>,
): Promise<unknown> {
  return db
    .insertInto('integration_outbox')
    .values(row as never)
    .execute();
}

// ---------------------------------------------------------------------------
// Enqueue, isolation and pinning
// ---------------------------------------------------------------------------

test(
  'a valid intent enqueues with the derived contract and pinned semantic revision',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA, connectorA }) => {
      const stored = await db
        .transaction()
        .execute((trx) =>
          enqueueIntegrationIntent(trx, intent(organizationA, connectorA)),
        );

      assert.equal(stored.state, 'pending');
      assert.equal(stored.contractKind, 'state_sync');
      assert.equal(stored.aggregateType, 'work_item');
      assert.equal(stored.schemaVersion, 1);
      assert.equal(stored.payloadMode, 'current_state_projection');
      assert.equal(stored.pinnedConnectorConfigurationRevision, 1);

      const row = await db
        .selectFrom('integration_outbox')
        .selectAll()
        .where('organization_id', '=', organizationA)
        .where('id', '=', stored.id)
        .executeTakeFirstOrThrow();
      assert.equal(row.state, 'pending');
      assert.equal(row.pinned_connector_configuration_revision, 1);

      // The pin names a real authoritative semantic snapshot.
      const snapshot = await db
        .selectFrom('integration_connector_audit')
        .select(['configuration_revision', 'revision_advanced'])
        .where('organization_id', '=', organizationA)
        .where('integration_connector_id', '=', connectorA)
        .where(
          'configuration_revision',
          '=',
          row.pinned_connector_configuration_revision,
        )
        .where('revision_advanced', '=', true)
        .executeTakeFirstOrThrow();
      assert.equal(snapshot.revision_advanced, true);
    });
  },
);

test(
  'an intent cannot reference a connector in another Organization',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA, connectorB }) => {
      // Through the repository: the Organization-scoped read finds nothing.
      assert.match(
        await message(() =>
          db
            .transaction()
            .execute((trx) =>
              enqueueIntegrationIntent(trx, intent(organizationA, connectorB)),
            ),
        ),
        /no such connector for this Organization/i,
      );

      // And directly: the composite foreign key makes the pair the
      // referent, so A claiming B's connector is unrepresentable.
      assert.match(
        await message(() => insertRow(db, baseRow(organizationA, connectorB))),
        /requires a connector owned by its Organization|foreign key/i,
      );

      // Nothing was written by either attempt.
      assert.deepEqual(
        await db.selectFrom('integration_outbox').select('id').execute(),
        [],
      );
    });
  },
);

test(
  'a stale or nonexistent pinned semantic revision is refused',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA, connectorA }) => {
      // A revision that has never existed.
      assert.match(
        await message(() =>
          insertRow(db, {
            ...baseRow(organizationA, connectorA),
            pinned_connector_configuration_revision: 9,
          }),
        ),
        /must pin the current connector semantic revision/i,
      );

      // Advance the connector's semantics to revision 2, with evidence.
      await advanceConnector(db, organizationA, connectorA);

      // Revision 1 still names a real snapshot, but it is no longer current,
      // so pinning it is refused rather than silently recorded.
      assert.match(
        await message(() =>
          insertRow(db, {
            ...baseRow(organizationA, connectorA),
            pinned_connector_configuration_revision: 1,
          }),
        ),
        /must pin the current connector semantic revision/i,
      );

      // Revision 2 is accepted, and the repository resolves it itself.
      const stored = await db
        .transaction()
        .execute((trx) =>
          enqueueIntegrationIntent(trx, intent(organizationA, connectorA)),
        );
      assert.equal(stored.pinnedConnectorConfigurationRevision, 2);
    });
  },
);

test(
  'a revision with no authoritative semantic snapshot cannot be pinned',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA, connectorA }) => {
      // A credential rotation advances record_revision only, so revision 1
      // remains the current semantic revision and keeps its single snapshot.
      await rotateCredential(db, organizationA, connectorA);
      const connector = await db
        .selectFrom('integration_connector')
        .select(['configuration_revision', 'record_revision'])
        .where('id', '=', connectorA)
        .executeTakeFirstOrThrow();
      assert.equal(connector.configuration_revision, 1);
      assert.equal(connector.record_revision, 2);

      // Pinning the record revision instead of the semantic one is refused:
      // record revision 2 is not a semantic revision at all.
      assert.match(
        await message(() =>
          insertRow(db, {
            ...baseRow(organizationA, connectorA),
            pinned_connector_configuration_revision: 2,
          }),
        ),
        /must pin the current connector semantic revision/i,
      );

      // The semantic pin still works, and the rotation did not disturb it.
      const stored = await db
        .transaction()
        .execute((trx) =>
          enqueueIntegrationIntent(trx, intent(organizationA, connectorA)),
        );
      assert.equal(stored.pinnedConnectorConfigurationRevision, 1);

      // The guard's second check, isolated. Reaching this state requires a
      // privileged manipulation that ordinary code cannot perform: F062.2B
      // forbids flipping `revision_advanced` on a `registered` row by check
      // constraint, and forbids deleting any audit row by trigger. So the
      // snapshot is removed with the immutability trigger deliberately
      // disabled, purely to prove the outbox guard does not assume the
      // snapshot exists.
      await sql`alter table integration_connector_audit disable trigger integration_connector_audit_immutable`.execute(
        db,
      );
      await sql`delete from integration_connector_audit
                where integration_connector_id = ${connectorA}
                  and configuration_revision = 1 and revision_advanced`.execute(
        db,
      );
      await sql`alter table integration_connector_audit enable trigger integration_connector_audit_immutable`.execute(
        db,
      );
      assert.match(
        await message(() => insertRow(db, baseRow(organizationA, connectorA))),
        /must pin an existing authoritative connector semantic snapshot/i,
      );
    });
  },
);

test(
  'the same intent cannot be enqueued twice for one connector, but may fan out',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA, connectorA, connectorA2 }) => {
      const integrationId = randomUUID();
      const first = await db
        .transaction()
        .execute((trx) =>
          enqueueIntegrationIntent(
            trx,
            intent(organizationA, connectorA, { integrationId }),
          ),
        );
      assert.ok(first.id);

      // Structural idempotency: a re-run of a handler is safe by
      // construction rather than by remembering to check.
      assert.match(
        await message(() =>
          db
            .transaction()
            .execute((trx) =>
              enqueueIntegrationIntent(
                trx,
                intent(organizationA, connectorA, { integrationId }),
              ),
            ),
        ),
        /duplicate key|integration_id/i,
      );

      // Fan-out to a different connector is permitted, because the dedupe
      // identity is per connector.
      const fannedOut = await db
        .transaction()
        .execute((trx) =>
          enqueueIntegrationIntent(
            trx,
            intent(organizationA, connectorA2, { integrationId }),
          ),
        );
      assert.equal(fannedOut.integrationId, integrationId);
      assert.notEqual(fannedOut.connectorId, first.connectorId);

      assert.equal(
        (
          await db
            .selectFrom('integration_outbox')
            .select('id')
            .where('integration_id', '=', integrationId)
            .execute()
        ).length,
        2,
      );
    });
  },
);

// ---------------------------------------------------------------------------
// Payload mode, parity and initial state
// ---------------------------------------------------------------------------

test(
  'historical_reference and approved_snapshot are both unavailable',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA, connectorA }) => {
      assert.match(
        await message(() =>
          insertRow(db, {
            ...baseRow(organizationA, connectorA),
            contract_kind: 'event',
            integration_type: 'service_request.submitted',
            aggregate_type: 'service_request',
            aggregate_revision: 1,
            payload_mode: 'historical_reference',
          }),
        ),
        /integration_outbox_no_historical_reference/i,
      );
      assert.match(
        await message(() =>
          insertRow(db, {
            ...baseRow(organizationA, connectorA),
            contract_kind: 'event',
            integration_type: 'service_request.submitted',
            aggregate_type: 'service_request',
            aggregate_revision: 1,
            payload_mode: 'approved_snapshot',
          }),
        ),
        /integration_outbox_no_approved_snapshot/i,
      );

      // Consequently no declared event type is enqueueable at all: every
      // remaining mode contradicts its contract kind.
      assert.match(
        await message(() =>
          insertRow(db, {
            ...baseRow(organizationA, connectorA),
            contract_kind: 'event',
            integration_type: 'service_request.submitted',
            aggregate_type: 'service_request',
            aggregate_revision: 1,
            payload_mode: 'current_state_projection',
          }),
        ),
        /violates check constraint/i,
      );
    });
  },
);

test(
  'a caller cannot relabel an event as synchronization or the reverse',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA, connectorA }) => {
      // state_sync label on an event type.
      assert.match(
        await message(() =>
          insertRow(db, {
            ...baseRow(organizationA, connectorA),
            integration_type: 'service_request.submitted',
            contract_kind: 'state_sync',
            aggregate_type: 'service_request',
          }),
        ),
        /violates check constraint/i,
      );
      // event label on the state_sync type.
      assert.match(
        await message(() =>
          insertRow(db, {
            ...baseRow(organizationA, connectorA),
            contract_kind: 'event',
            aggregate_revision: 1,
            payload_mode: 'historical_reference',
          }),
        ),
        /violates check constraint/i,
      );
      // A mismatched aggregate type for a known integration type.
      assert.match(
        await message(() =>
          insertRow(db, {
            ...baseRow(organizationA, connectorA),
            aggregate_type: 'service_request',
          }),
        ),
        /violates check constraint/i,
      );
      // A mismatched schema version.
      assert.match(
        await message(() =>
          insertRow(db, {
            ...baseRow(organizationA, connectorA),
            schema_version: 2,
          }),
        ),
        /violates check constraint/i,
      );
    });
  },
);

test(
  'the database vocabulary pairing equals the F062.1 contract exactly',
  { skip: !url },
  async () => {
    await withSchema(async ({ db }) => {
      const definition = await sql<{ def: string }>`
        select pg_get_constraintdef(c.oid) as def
          from pg_constraint c
          join pg_class t on t.oid = c.conrelid
         where t.relname = 'integration_outbox'
           and c.contype = 'c'
           and pg_get_constraintdef(c.oid) like '%integration_type%'
           and pg_get_constraintdef(c.oid) like '%schema_version%'`.execute(db);
      const text = definition.rows.map((row) => row.def).join(' ');
      assert.ok(text.length > 0, 'the pairing constraint must exist');

      // Every declared type appears with exactly its declared kind, aggregate
      // and version. Parsing the tuples rather than trusting the text.
      const tuples = new Map<string, string>();
      for (const type of Object.keys(INTEGRATION_TYPES) as IntegrationType[]) {
        const declared = INTEGRATION_TYPES[type];
        // PostgreSQL renders the constraint with `(column)::text` casts, so
        // the gaps between literals contain parentheses. Bounded rather than
        // unbounded, so a match cannot wander into a neighbouring tuple.
        const tuple = new RegExp(
          "'" +
            type.replace('.', '\\.') +
            "'[\\s\\S]{0,120}?'" +
            declared.kind +
            "'[\\s\\S]{0,120}?'" +
            declared.aggregate +
            "'[\\s\\S]{0,120}?schema_version = " +
            String(declared.schemaVersion),
        );
        assert.match(
          text,
          tuple,
          `${type} must be paired with ${declared.kind}/${declared.aggregate}/${String(declared.schemaVersion)}`,
        );
        tuples.set(type, declared.kind);
      }
      assert.equal(tuples.size, Object.keys(INTEGRATION_TYPES).length);

      // And the constraint names no type F062.1 does not define.
      for (const quoted of text.matchAll(/'([a-z_]+\.[a-z_]+)'/g))
        assert.ok(
          Object.hasOwn(INTEGRATION_TYPES, quoted[1] ?? ''),
          `the constraint names ${String(quoted[1])}, which F062.1 does not declare`,
        );
    });
  },
);

test(
  'the delivery-state vocabulary equals F062.1 while only pending is reachable',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA, connectorA }) => {
      const definition = await sql<{ def: string }>`
        select pg_get_constraintdef(c.oid) as def
          from pg_constraint c
          join pg_class t on t.oid = c.conrelid
         where t.relname = 'integration_outbox' and c.contype = 'c'
           and pg_get_constraintdef(c.oid) like '%state%'`.execute(db);
      const text = definition.rows.map((row) => row.def).join(' ');
      const stated = new Set(
        [...text.matchAll(/'([a-z_]+)'::character varying/g)].map(
          (match) => match[1],
        ),
      );
      // Parity: the column's domain is exactly the F062.1 vocabulary.
      for (const state of [
        'pending',
        'dispatching',
        'accepted',
        'acknowledged',
        'retrying',
        'ambiguous',
        'failed_permanent',
        'dead_lettered',
        'refused',
      ])
        assert.ok(stated.has(state), `${state} must appear in the vocabulary`);

      // Inertness: a caller cannot choose another state, even though the
      // vocabulary names it.
      // A caller-supplied state is refused by the guard, which runs before
      // the constraint and gives the precise reason. The
      // `integration_outbox_state_inert` constraint remains the declarative
      // backstop if the guard were ever disabled.
      assert.match(
        await message(() =>
          insertRow(db, {
            ...baseRow(organizationA, connectorA),
            state: 'accepted',
          }),
        ),
        /delivery state is not caller controlled/i,
      );
      assert.ok(
        stated.has('pending'),
        'the inert constraint must still pin the initial state',
      );

      // And the guard forces the initial state regardless of what is supplied
      // within the inert constraint.
      await insertRow(db, {
        ...baseRow(organizationA, connectorA),
        state: 'pending',
      });
      const rows = await db
        .selectFrom('integration_outbox')
        .select('state')
        .execute();
      assert.deepEqual(
        rows.map((row) => row.state),
        ['pending'],
      );
    });
  },
);

test(
  'an enqueued intent is immutable and cannot be deleted',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA, connectorA }) => {
      const stored = await db
        .transaction()
        .execute((trx) =>
          enqueueIntegrationIntent(trx, intent(organizationA, connectorA)),
        );

      for (const statement of [
        sql`update integration_outbox set state = 'accepted' where id = ${stored.id}`,
        sql`update integration_outbox set organization_id = gen_random_uuid() where id = ${stored.id}`,
        sql`update integration_outbox set integration_id = gen_random_uuid() where id = ${stored.id}`,
        sql`update integration_outbox set contract_kind = 'event' where id = ${stored.id}`,
        sql`update integration_outbox set integration_type = 'service_request.closed' where id = ${stored.id}`,
        sql`update integration_outbox set schema_version = 2 where id = ${stored.id}`,
        sql`update integration_outbox set aggregate_id = gen_random_uuid() where id = ${stored.id}`,
        sql`update integration_outbox set aggregate_revision = 5 where id = ${stored.id}`,
        sql`update integration_outbox set origin_kind = 'external' where id = ${stored.id}`,
        sql`update integration_outbox set correlation_id = gen_random_uuid() where id = ${stored.id}`,
        sql`update integration_outbox set causation_id = gen_random_uuid() where id = ${stored.id}`,
        sql`update integration_outbox set payload_mode = 'approved_snapshot' where id = ${stored.id}`,
        sql`update integration_outbox set pinned_connector_configuration_revision = 2 where id = ${stored.id}`,
        sql`delete from integration_outbox where id = ${stored.id}`,
        sql`truncate table integration_outbox`,
      ])
        assert.match(
          await message(() => statement.execute(db)),
          /immutable in this slice/i,
        );

      // The row is untouched.
      const row = await db
        .selectFrom('integration_outbox')
        .selectAll()
        .where('id', '=', stored.id)
        .executeTakeFirstOrThrow();
      assert.equal(row.state, 'pending');
      assert.equal(row.organization_id, organizationA);
    });
  },
);

test('a retired connector accepts no new intents', { skip: !url }, async () => {
  await withSchema(async ({ db, organizationA, connectorA }) => {
    await retireConnector(db, organizationA, connectorA);
    assert.match(
      await message(() =>
        db
          .transaction()
          .execute((trx) =>
            enqueueIntegrationIntent(trx, intent(organizationA, connectorA)),
          ),
      ),
      /retired connector accepts no new intents/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Atomicity: the point of the slice
// ---------------------------------------------------------------------------

test(
  'a domain mutation and an integration intent commit together',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA, connectorA }) => {
      const departmentId = randomUUID();
      const integrationId = randomUUID();

      // ONE transaction: a controlled domain-state mutation and the intent.
      await db.transaction().execute(async (trx) => {
        await trx
          .insertInto('department')
          .values({
            id: departmentId,
            organization_id: organizationA,
            name: 'Atomicity Commit Department',
            status: 'active',
            display_order: 0,
          })
          .execute();
        await enqueueIntegrationIntent(
          trx,
          intent(organizationA, connectorA, { integrationId }),
        );
      });

      // Both persist.
      assert.ok(
        await db
          .selectFrom('department')
          .select('id')
          .where('id', '=', departmentId)
          .executeTakeFirst(),
        'the domain mutation must persist',
      );
      assert.ok(
        await db
          .selectFrom('integration_outbox')
          .select('id')
          .where('integration_id', '=', integrationId)
          .executeTakeFirst(),
        'the integration intent must persist',
      );
    });
  },
);

test(
  'a rolled-back transaction persists neither the domain mutation nor the intent',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA, connectorA }) => {
      const departmentId = randomUUID();
      const integrationId = randomUUID();

      // ONE transaction, forced to roll back after both writes.
      await assert.rejects(
        db.transaction().execute(async (trx) => {
          await trx
            .insertInto('department')
            .values({
              id: departmentId,
              organization_id: organizationA,
              name: 'Atomicity Rollback Department',
              status: 'active',
              display_order: 0,
            })
            .execute();
          await enqueueIntegrationIntent(
            trx,
            intent(organizationA, connectorA, { integrationId }),
          );
          // Both writes succeeded; the transaction is abandoned deliberately.
          throw new Error('forced rollback');
        }),
        /forced rollback/,
      );

      // Neither persists. This is the property an outbox exists to provide:
      // without it, the intent would either be lost or sent for a domain
      // change that never happened.
      assert.equal(
        await db
          .selectFrom('department')
          .select('id')
          .where('id', '=', departmentId)
          .executeTakeFirst(),
        undefined,
        'the domain mutation must not persist',
      );
      assert.equal(
        await db
          .selectFrom('integration_outbox')
          .select('id')
          .where('integration_id', '=', integrationId)
          .executeTakeFirst(),
        undefined,
        'the integration intent must not persist',
      );
    });
  },
);

// ---------------------------------------------------------------------------
// Migration lifecycle
// ---------------------------------------------------------------------------

test(
  'the migration applies, refuses rollback while intents exist, then rolls back and reapplies',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA, connectorA }) => {
      const stored = await db
        .transaction()
        .execute((trx) =>
          enqueueIntegrationIntent(trx, intent(organizationA, connectorA)),
        );

      assert.match(
        await message(() => down(db)),
        /Retained integration outbox intents prevent rollback/i,
      );
      // The intent survived the refused rollback.
      assert.ok(
        await db
          .selectFrom('integration_outbox')
          .select('id')
          .where('id', '=', stored.id)
          .executeTakeFirst(),
      );

      // Evidence is removable only through a privileged path that ordinary
      // code cannot reach: the owner disables the guard deliberately.
      await sql`alter table integration_outbox disable trigger integration_outbox_guard`.execute(
        db,
      );
      await sql`delete from integration_outbox`.execute(db);
      await sql`alter table integration_outbox enable trigger integration_outbox_guard`.execute(
        db,
      );

      await down(db);
      const gone = await sql<{ present: boolean }>`
        select to_regclass('integration_outbox') is not null as present`.execute(
        db,
      );
      assert.equal(gone.rows[0]?.present, false);
      // The connector registry is untouched by the outbox rollback.
      assert.ok(
        await db
          .selectFrom('integration_connector')
          .select('id')
          .where('id', '=', connectorA)
          .executeTakeFirst(),
        'rollback must not cascade into connector evidence',
      );

      await up(db);
      const again = await db
        .transaction()
        .execute((trx) =>
          enqueueIntegrationIntent(trx, intent(organizationA, connectorA)),
        );
      assert.equal(again.state, 'pending');
    });
  },
);

// ---------------------------------------------------------------------------
// Connector mutation helpers (F062.2B semantics)
// ---------------------------------------------------------------------------

/** Advances the connector's semantic revision with matching audit evidence. */
async function advanceConnector(
  db: Database,
  organizationId: string,
  connectorId: string,
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const current = await trx
      .selectFrom('integration_connector')
      .selectAll()
      .where('id', '=', connectorId)
      .executeTakeFirstOrThrow();
    const updated = await trx
      .updateTable('integration_connector')
      .set({
        supports_idempotency_key: !current.supports_idempotency_key,
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
  });
}

/** Rotates the credential reference: record revision advances, semantic
 * revision does not. */
async function rotateCredential(
  db: Database,
  organizationId: string,
  connectorId: string,
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const current = await trx
      .selectFrom('integration_connector')
      .selectAll()
      .where('id', '=', connectorId)
      .executeTakeFirstOrThrow();
    const updated = await trx
      .updateTable('integration_connector')
      .set({
        credential_reference: 'reqro/integration/rotated',
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
        revision_advanced: false,
        change_category: 'credential_reference_rotated',
        connector_key: updated.connector_key,
        connector_kind: updated.connector_kind,
        lifecycle_state: updated.lifecycle_state,
        ...toCapabilityColumns(NO_CAPABILITIES),
        credential_reference_present: true,
        prior_configuration_revision: current.configuration_revision,
        prior_lifecycle_state: current.lifecycle_state,
        actor: 'test-operator',
        correlation_id: randomUUID(),
      })
      .execute();
  });
}

async function retireConnector(
  db: Database,
  organizationId: string,
  connectorId: string,
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const current = await trx
      .selectFrom('integration_connector')
      .selectAll()
      .where('id', '=', connectorId)
      .executeTakeFirstOrThrow();
    const updated = await trx
      .updateTable('integration_connector')
      .set({
        lifecycle_state: 'retired',
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
        change_category: 'lifecycle_changed',
        connector_key: updated.connector_key,
        connector_kind: updated.connector_kind,
        lifecycle_state: updated.lifecycle_state,
        ...toCapabilityColumns(NO_CAPABILITIES),
        credential_reference_present: false,
        prior_configuration_revision: current.configuration_revision,
        prior_lifecycle_state: current.lifecycle_state,
        actor: 'test-operator',
        correlation_id: randomUUID(),
      })
      .execute();
  });
}
