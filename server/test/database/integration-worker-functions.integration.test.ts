import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';
import {
  applyIntegrationWorkerFunctions,
  rollbackIntegrationWorkerFunctions,
  workerApiSchema,
} from '../helpers/integration-worker-functions.js';
import { up as catalogUp } from '../../migrations/20260902000000-create-organization-service-catalog.js';
import { up as connectorUp } from '../../migrations/20261020000000-add-integration-connector-registry.js';
import { up as outboxUp } from '../../migrations/20261021000000-add-integration-outbox.js';
import { up as attemptUp } from '../../migrations/20261022000000-add-integration-delivery-attempt.js';
import { up as leaseUp } from '../../migrations/20261024000000-add-integration-lease-recovery-evidence.js';
import { up as orderingUp } from '../../migrations/20261025000000-add-integration-ordering-retry-eligibility.js';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import {
  attemptOutcomes,
  deliveryStateTransitions,
  mayTransitionDeliveryState,
  type AttemptOutcome,
  type ConnectorLifecycleState,
  type DeliveryState,
} from '../../src/integration/delivery-contract.js';
import {
  integrationFailureCategories,
  transientIntegrationFailures,
} from '../../src/integration/integration-envelope.js';
import {
  NO_CAPABILITIES,
  type ConnectorCapabilities,
} from '../../src/integration/connector-capabilities.js';
import { toCapabilityColumns } from '../../src/integration/persistence/connector-metadata.js';
import { enqueueIntegrationIntent } from '../../src/integration/persistence/outbox.repository.js';
import type { EnqueueIntentInput } from '../../src/integration/persistence/outbox.js';

/**
 * F062.2D-2B — the worker claim and completion database functions, proven
 * against PostgreSQL.
 *
 * **NO WORKER RUNS HERE EITHER.** Every call below is a direct SQL invocation
 * by the test, there is no polling loop, and no destination is contacted.
 *
 * Concurrency is proven deterministically by holding a real row lock on a
 * second connection, never by sleeping. Ownership, the membership edge and the
 * privilege ceiling are proven where they are real — on a provisioned
 * PostgreSQL 17 cluster — by `database-role-separation.integration.test.ts`;
 * this suite proves behaviour.
 */

const url = process.env.TEST_DATABASE_URL;
type Database = Kysely<DatabaseSchema>;

/** A 256-bit worker token, which is what the production worker is required to
 * generate. The database can bound the encoding and nothing more. */
function token(): string {
  return randomBytes(32).toString('base64url');
}

interface Fixture {
  readonly db: Database;
  /** A second pool, for cross-connection concurrency proofs. */
  readonly other: Database;
  readonly schema: string;
  readonly api: string;
  readonly organizationA: string;
  readonly organizationB: string;
  readonly connectorA: string;
  readonly connectorB: string;
  /** Two pending obligations in Organization A, on connector A. */
  readonly firstA: string;
  readonly secondA: string;
  /** A pending obligation in Organization B, on connector B. */
  readonly onlyB: string;
}

interface ClaimRow {
  readonly integration_outbox_id: string;
  readonly delivery_attempt_id: string;
  readonly attempt_number: number;
  readonly claim_generation: string;
  readonly integration_connector_id: string;
  readonly connector_kind: string;
  readonly integration_id: string;
  readonly contract_kind: string;
  readonly integration_type: string;
  readonly schema_version: number;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly aggregate_revision: number | null;
  readonly payload_mode: string;
  readonly correlation_id: string;
  readonly causation_id: string | null;
  readonly deployment_environment: string;
  readonly occurred_at: Date;
  readonly connector_configuration_revision: number;
  readonly capability_snapshot: Record<string, unknown>;
}

async function withSchema(run: (f: Fixture) => Promise<void>): Promise<void> {
  const schema = 'iw_' + randomUUID().replaceAll('-', '');
  const api = workerApiSchema(schema);
  const admin = new Pool({ connectionString: url });
  try {
    await prepareDatabaseExtensions(admin);
  } catch (error) {
    await admin.end();
    throw error;
  }
  await admin.query('create schema "' + schema + '"');
  const open = () =>
    new Kysely<DatabaseSchema>({
      dialect: new PostgresDialect({
        pool: new Pool({
          connectionString: url,
          options: '-c search_path=' + schema,
        }),
      }),
    });
  const db = open();
  const other = open();
  try {
    await catalogUp(db);
    await connectorUp(db);
    await outboxUp(db);
    await attemptUp(db);
    await applyIntegrationWorkerFunctions(db, schema);
    // F062.2D-2C-1, applied in ordinal order after Migration 53. The worker
    // API must keep working unchanged under the lease, dispatch-boundary and
    // recovery-reason constraints, so the whole suite below runs against
    // them rather than against the pre-2C-1 schema.
    await leaseUp(db);
    // F062.2D-2C-2, also in ordinal order. The worker API must keep working
    // unchanged under the ordered-stream index, the pinned ordering
    // derivation and the retry-schedule rules.
    await orderingUp(db);

    const organizationA = randomUUID();
    const organizationB = randomUUID();
    await db
      .insertInto('organization')
      .values(
        [organizationA, organizationB].map((id, index) => ({
          id,
          name: 'F062.2D-2B Synthetic ' + String(index),
          short_name: 'Test',
          slug: 'f0622d2b-' + id,
          status: 'active',
          default_business_timezone: 'America/New_York',
        })),
      )
      .execute();
    const connectorA = await registerConnector(db, organizationA, 'loopback-a');
    const connectorB = await registerConnector(db, organizationB, 'loopback-b');
    await activate(db, organizationA, connectorA);
    await activate(db, organizationB, connectorB);

    await run({
      db,
      other,
      schema,
      api,
      organizationA,
      organizationB,
      connectorA,
      connectorB,
      firstA: await enqueue(db, organizationA, connectorA),
      secondA: await enqueue(db, organizationA, connectorA),
      onlyB: await enqueue(db, organizationB, connectorB),
    });
  } finally {
    await other.destroy();
    await db.destroy();
    // The api schema is a sibling of the disposable schema rather than a
    // child, so it is dropped explicitly.
    await admin.query('drop schema if exists "' + api + '" cascade');
    await admin.query('drop schema "' + schema + '" cascade');
    await admin.end();
  }
}

async function registerConnector(
  db: Database,
  organizationId: string,
  connectorKey: string,
  capabilities: ConnectorCapabilities = NO_CAPABILITIES,
): Promise<string> {
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

/**
 * Moves a connector along a reviewed lifecycle or capability edge and records
 * the audit row the guard requires, which is what makes the new
 * `configuration_revision` an authoritative pinnable snapshot.
 */
async function advanceConnector(
  db: Database,
  organizationId: string,
  connectorId: string,
  change: {
    readonly category: 'lifecycle_changed' | 'capabilities_changed';
    readonly lifecycleState?: ConnectorLifecycleState;
    readonly capabilities?: ConnectorCapabilities;
  },
): Promise<number> {
  return db.transaction().execute(async (trx) => {
    const before = await trx
      .selectFrom('integration_connector')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where('id', '=', connectorId)
      .executeTakeFirstOrThrow();
    const after = await trx
      .updateTable('integration_connector')
      .set({
        lifecycle_state: change.lifecycleState ?? before.lifecycle_state,
        ...(change.capabilities === undefined
          ? {}
          : toCapabilityColumns(change.capabilities)),
        configuration_revision: before.configuration_revision + 1,
        record_revision: before.record_revision + 1,
      })
      .where('organization_id', '=', organizationId)
      .where('id', '=', connectorId)
      .returningAll()
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('integration_connector_audit')
      .values({
        organization_id: organizationId,
        integration_connector_id: connectorId,
        record_revision: after.record_revision,
        configuration_revision: after.configuration_revision,
        prior_record_revision: before.record_revision,
        revision_advanced: true,
        change_category: change.category,
        connector_key: after.connector_key,
        connector_kind: after.connector_kind,
        lifecycle_state: after.lifecycle_state,
        operations: after.operations,
        supports_idempotency_key: after.supports_idempotency_key,
        supports_read_after_write: after.supports_read_after_write,
        supports_reconciliation: after.supports_reconciliation,
        supports_webhook_callback: after.supports_webhook_callback,
        supports_ordering: after.supports_ordering,
        supports_update: after.supports_update,
        supports_cancel: after.supports_cancel,
        supports_delete: after.supports_delete,
        supports_current_state_sync: after.supports_current_state_sync,
        reports_terminal_state: after.reports_terminal_state,
        side_effect_risk: after.side_effect_risk,
        credential_reference_present: after.credential_reference !== null,
        prior_configuration_revision: before.configuration_revision,
        prior_lifecycle_state: before.lifecycle_state,
        actor: 'test-operator',
        correlation_id: randomUUID(),
      })
      .execute();
    return after.configuration_revision;
  });
}

/** `configured -> active`, which is the only state an intent can be claimed
 * in alongside `degraded` (F062.1 dispatchingLifecycleStates). */
async function activate(
  db: Database,
  organizationId: string,
  connectorId: string,
): Promise<number> {
  return advanceConnector(db, organizationId, connectorId, {
    category: 'lifecycle_changed',
    lifecycleState: 'active',
  });
}

function intent(
  organizationId: string,
  connectorId: string,
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
  };
}

async function enqueue(
  db: Database,
  organizationId: string,
  connectorId: string,
): Promise<string> {
  const stored = await db
    .transaction()
    .execute((trx) =>
      enqueueIntegrationIntent(trx, intent(organizationId, connectorId)),
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

async function claim(
  db: Database,
  api: string,
  organizationId: string,
  connectorId: string,
  raw: string,
): Promise<ClaimRow[]> {
  const result = await sql<ClaimRow>`
    select * from ${sql.raw(api)}.claim_integration_intent(
      ${organizationId}::uuid, ${connectorId}::uuid, ${raw}::text)`.execute(db);
  return [...result.rows];
}

async function complete(
  db: Database,
  api: string,
  input: {
    readonly organizationId: string;
    readonly obligationId: string;
    readonly attemptId: string;
    readonly generation: string | number;
    readonly raw: string;
    readonly outcome: string;
    readonly category: string | null;
  },
): Promise<boolean> {
  const result = await sql<{ settled: boolean }>`
    select ${sql.raw(api)}.complete_integration_attempt(
      ${input.organizationId}::uuid,
      ${input.obligationId}::uuid,
      ${input.attemptId}::uuid,
      ${String(input.generation)}::bigint,
      ${input.raw}::text,
      ${input.outcome}::varchar,
      ${input.category}::varchar) as settled`.execute(db);
  return result.rows[0]?.settled === true;
}

async function stateOf(
  db: Database,
  organizationId: string,
  obligationId: string,
): Promise<string> {
  const row = await db
    .selectFrom('integration_outbox')
    .select('state')
    .where('organization_id', '=', organizationId)
    .where('id', '=', obligationId)
    .executeTakeFirstOrThrow();
  return row.state;
}

async function attemptsOf(
  db: Database,
  organizationId: string,
  obligationId: string,
) {
  return db
    .selectFrom('integration_delivery_attempt')
    .selectAll()
    .where('organization_id', '=', organizationId)
    .where('integration_outbox_id', '=', obligationId)
    .orderBy('claim_generation')
    .execute();
}

/** The one path to a second claim generation today, and deliberately a
 * privileged one: no reviewed API produces it, because re-claim and recovery
 * are not implemented. See the deferred-recovery finding in the feature
 * record. */
async function forceSecondAttempt(
  db: Database,
  organizationId: string,
  obligationId: string,
  connectorId: string,
  digest: string,
  revision: number,
): Promise<{ id: string; claim_generation: string }> {
  const row = await db
    .insertInto('integration_delivery_attempt')
    .values({
      organization_id: organizationId,
      integration_outbox_id: obligationId,
      integration_connector_id: connectorId,
      claim_token_digest: digest,
      connector_configuration_revision: revision,
      capability_snapshot: {
        supports_idempotency_key: false,
        supports_read_after_write: false,
        side_effect_risk: 'irreversible',
      },
    })
    .returning(['id', 'claim_generation'])
    .executeTakeFirstOrThrow();
  return { id: row.id, claim_generation: row.claim_generation };
}

// ---------------------------------------------------------------------------
// Claim
// ---------------------------------------------------------------------------

test(
  'a claim establishes ownership and returns only a bounded descriptor',
  { skip: !url },
  async () => {
    await withSchema(async (f) => {
      const raw = token();
      const claimed = await claim(
        f.db,
        f.api,
        f.organizationA,
        f.connectorA,
        raw,
      );
      assert.equal(claimed.length, 1);
      const descriptor = claimed[0];
      assert.ok(descriptor !== undefined);

      // The return is an exact, closed set of columns. No raw token, no digest,
      // no credential locator, no vendor metadata, no resident value.
      assert.deepEqual(Object.keys(descriptor).sort(), [
        'aggregate_id',
        'aggregate_revision',
        'aggregate_type',
        'attempt_number',
        'capability_snapshot',
        'causation_id',
        'claim_generation',
        'connector_configuration_revision',
        'connector_kind',
        'contract_kind',
        'correlation_id',
        'delivery_attempt_id',
        'deployment_environment',
        'integration_connector_id',
        'integration_id',
        'integration_outbox_id',
        'integration_type',
        'occurred_at',
        'payload_mode',
        'schema_version',
      ]);
      const serialized = JSON.stringify(descriptor);
      assert.equal(
        serialized.includes(raw),
        false,
        'the raw token is returned',
      );
      assert.equal(/credential/i.test(serialized), false);

      // The oldest pending obligation is claimed first.
      assert.equal(descriptor.integration_outbox_id, f.firstA);
      assert.equal(descriptor.attempt_number, 1);
      assert.equal(descriptor.claim_generation, '1');
      assert.equal(descriptor.connector_kind, 'loopback');
      assert.equal(descriptor.contract_kind, 'state_sync');
      assert.equal(descriptor.payload_mode, 'current_state_projection');
      assert.deepEqual(Object.keys(descriptor.capability_snapshot).sort(), [
        'side_effect_risk',
        'supports_idempotency_key',
        'supports_read_after_write',
      ]);

      assert.equal(
        await stateOf(f.db, f.organizationA, f.firstA),
        'dispatching',
      );
      const attempts = await attemptsOf(f.db, f.organizationA, f.firstA);
      assert.equal(attempts.length, 1);
      assert.equal(attempts[0]?.completed_at, null);
      assert.equal(attempts[0].outcome, null);
    });
  },
);

test(
  'only the digest of the claim token is ever persisted',
  { skip: !url },
  async () => {
    await withSchema(async (f) => {
      const raw = token();
      await claim(f.db, f.api, f.organizationA, f.connectorA, raw);
      const expected = await sql<{ digest: string }>`
      select pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(${raw}, 'UTF8')), 'hex') as digest`.execute(
        f.db,
      );
      const attempts = await attemptsOf(f.db, f.organizationA, f.firstA);
      assert.equal(attempts[0]?.claim_token_digest, expected.rows[0]?.digest);

      // Stronger than checking one column: no column of the attempt row, and no
      // column of the obligation, holds the raw value anywhere.
      const dump = await sql<{ attempt: string; obligation: string }>`
      select a::text as attempt, o::text as obligation
      from integration_delivery_attempt a
      join integration_outbox o
        on o.organization_id = a.organization_id and o.id = a.integration_outbox_id
      where a.organization_id = ${f.organizationA}`.execute(f.db);
      assert.equal(dump.rows[0]?.attempt.includes(raw), false);
      assert.equal(dump.rows[0].obligation.includes(raw), false);
    });
  },
);

test(
  'two concurrent claimers cannot claim the same obligation',
  { skip: !url },
  async () => {
    await withSchema(async (f) => {
      // Only one obligation is claimable, so both claimers compete for it.
      await f.db
        .updateTable('integration_outbox')
        .set({ state: 'refused' })
        .where('id', '=', f.secondA)
        .execute();

      const second: ClaimRow[][] = [];
      await f.db.connection().execute(async (held) => {
        await sql.raw('begin').execute(held);
        const first = await claim(
          held,
          f.api,
          f.organizationA,
          f.connectorA,
          token(),
        );
        assert.equal(first.length, 1, 'the first claimer must succeed');
        // The obligation row is locked by the uncommitted claim, so the
        // competing claimer skips it and finds no work. Deterministic: SKIP
        // LOCKED never waits, so there is nothing to sleep for.
        second.push(
          await claim(f.other, f.api, f.organizationA, f.connectorA, token()),
        );
        await sql.raw('rollback').execute(held);
      });
      assert.deepEqual(second[0], [], 'the second claimer must find no work');

      // After the rollback the obligation is claimable again, and exactly one
      // attempt exists for it.
      const after = await claim(
        f.db,
        f.api,
        f.organizationA,
        f.connectorA,
        token(),
      );
      assert.equal(after.length, 1);
      assert.equal(
        (await attemptsOf(f.db, f.organizationA, f.firstA)).length,
        1,
        'the rolled-back claim left no attempt evidence',
      );
    });
  },
);

test(
  'two available obligations may be claimed independently',
  { skip: !url },
  async () => {
    await withSchema(async (f) => {
      await f.db.connection().execute(async (held) => {
        await sql.raw('begin').execute(held);
        const first = await claim(
          held,
          f.api,
          f.organizationA,
          f.connectorA,
          token(),
        );
        const second = await claim(
          f.other,
          f.api,
          f.organizationA,
          f.connectorA,
          token(),
        );
        assert.equal(first.length, 1);
        assert.equal(second.length, 1);
        assert.notEqual(
          first[0]?.integration_outbox_id,
          second[0]?.integration_outbox_id,
          'two claimers must not receive the same obligation',
        );
        await sql.raw('commit').execute(held);
      });
      assert.equal(
        await stateOf(f.db, f.organizationA, f.firstA),
        'dispatching',
      );
      assert.equal(
        await stateOf(f.db, f.organizationA, f.secondA),
        'dispatching',
      );
    });
  },
);

test(
  'an obligation with an open attempt is never claimed twice',
  { skip: !url },
  async () => {
    await withSchema(async (f) => {
      await f.db
        .updateTable('integration_outbox')
        .set({ state: 'refused' })
        .where('id', '=', f.secondA)
        .execute();
      const first = await claim(
        f.db,
        f.api,
        f.organizationA,
        f.connectorA,
        token(),
      );
      assert.equal(first.length, 1);
      // Committed this time: the obligation has left pending and carries an open
      // attempt, so both halves of the eligibility predicate exclude it.
      assert.deepEqual(
        await claim(f.db, f.api, f.organizationA, f.connectorA, token()),
        [],
      );
      assert.equal(
        (await attemptsOf(f.db, f.organizationA, f.firstA)).length,
        1,
      );

      // And the partial unique index is the independent second guarantee: even
      // forcing a second open attempt directly is refused.
      const refusal = await message(() =>
        forceSecondAttempt(
          f.db,
          f.organizationA,
          f.firstA,
          f.connectorA,
          'c'.repeat(64),
          2,
        ),
      );
      assert.match(refusal, /integration_attempt_open/);
    });
  },
);

test(
  'a claim cannot cross an Organization boundary',
  { skip: !url },
  async () => {
    await withSchema(async (f) => {
      // Another Organization's connector is indistinguishable from one that does
      // not exist and from one with no work: zero rows, no error detail.
      assert.deepEqual(
        await claim(f.db, f.api, f.organizationB, f.connectorA, token()),
        [],
      );
      assert.deepEqual(
        await claim(f.db, f.api, f.organizationA, f.connectorB, token()),
        [],
      );
      assert.deepEqual(
        await claim(f.db, f.api, f.organizationA, f.connectorA, token()).then(
          (rows) => rows.map((row) => row.integration_outbox_id),
        ),
        [f.firstA],
      );
      // Organization B's obligation was never touched.
      assert.equal(await stateOf(f.db, f.organizationB, f.onlyB), 'pending');
      assert.equal(
        (await attemptsOf(f.db, f.organizationB, f.onlyB)).length,
        0,
      );
    });
  },
);

test(
  'a connector that may not dispatch yields no claim',
  { skip: !url },
  async () => {
    await withSchema(async (f) => {
      // F062.1 dispatchingLifecycleStates is exactly active and degraded.
      await advanceConnector(f.db, f.organizationA, f.connectorA, {
        category: 'lifecycle_changed',
        lifecycleState: 'disabled',
      });
      assert.deepEqual(
        await claim(f.db, f.api, f.organizationA, f.connectorA, token()),
        [],
      );
      // Disabling accumulates rather than discarding: the obligation is intact.
      assert.equal(await stateOf(f.db, f.organizationA, f.firstA), 'pending');

      await advanceConnector(f.db, f.organizationA, f.connectorA, {
        category: 'lifecycle_changed',
        lifecycleState: 'active',
      });
      assert.equal(
        (await claim(f.db, f.api, f.organizationA, f.connectorA, token()))
          .length,
        1,
      );
    });
  },
);

test(
  'a claim pins the semantics the intent pinned, not the connector current row',
  { skip: !url },
  async () => {
    await withSchema(async (f) => {
      const pinned = await f.db
        .selectFrom('integration_outbox')
        .select('pinned_connector_configuration_revision')
        .where('id', '=', f.firstA)
        .executeTakeFirstOrThrow();
      assert.equal(pinned.pinned_connector_configuration_revision, 2);

      // The connector gains idempotency support AFTER the intent was enqueued.
      const advanced = await advanceConnector(
        f.db,
        f.organizationA,
        f.connectorA,
        {
          category: 'capabilities_changed',
          capabilities: {
            ...NO_CAPABILITIES,
            supportsIdempotencyKey: true,
            sideEffectRisk: 'reversible',
          },
        },
      );
      assert.equal(advanced, 3);

      const claimed = await claim(
        f.db,
        f.api,
        f.organizationA,
        f.connectorA,
        token(),
      );
      // The attempt records revision 2's semantics. A later configuration change
      // cannot retroactively authorise anything about this dispatch.
      assert.equal(claimed[0]?.connector_configuration_revision, 2);
      assert.deepEqual(claimed[0].capability_snapshot, {
        supports_idempotency_key: false,
        supports_read_after_write: false,
        side_effect_risk: 'irreversible',
      });
    });
  },
);

test(
  'a claim is refused when the pinned semantic snapshot is missing',
  { skip: !url },
  async () => {
    await withSchema(async (f) => {
      // The audit table is append-only by trigger, so removing the pinned
      // snapshot requires disabling that protection. A deliberately privileged
      // test-only manipulation, to prove the claim fails closed rather than
      // reconstructing semantics it cannot know.
      for (const trigger of [
        'integration_connector_audit_guard',
        'integration_connector_audit_immutable',
      ])
        await sql
          .raw(
            `alter table integration_connector_audit disable trigger ${trigger}`,
          )
          .execute(f.db);
      await f.db
        .deleteFrom('integration_connector_audit')
        .where('organization_id', '=', f.organizationA)
        .where('configuration_revision', '=', 2)
        .execute();
      for (const trigger of [
        'integration_connector_audit_guard',
        'integration_connector_audit_immutable',
      ])
        await sql
          .raw(
            `alter table integration_connector_audit enable trigger ${trigger}`,
          )
          .execute(f.db);

      const refusal = await message(() =>
        claim(f.db, f.api, f.organizationA, f.connectorA, token()),
      );
      assert.match(refusal, /pinned integration connector semantic snapshot/);
      assert.equal(await stateOf(f.db, f.organizationA, f.firstA), 'pending');
      assert.equal(
        (await attemptsOf(f.db, f.organizationA, f.firstA)).length,
        0,
      );
    });
  },
);

test(
  'a claim requires a worker token of at least 128 bits and never echoes it',
  { skip: !url },
  async () => {
    await withSchema(async (f) => {
      for (const bad of ['', 'short', 'a'.repeat(21)]) {
        const refusal = await message(() =>
          claim(f.db, f.api, f.organizationA, f.connectorA, bad),
        );
        assert.match(refusal, /claim token of at least 128 bits/);
        assert.equal(
          refusal.includes(bad) && bad.length > 0,
          false,
          'the refusal must not echo the supplied token',
        );
      }
      assert.equal(await stateOf(f.db, f.organizationA, f.firstA), 'pending');
      assert.equal(
        (await attemptsOf(f.db, f.organizationA, f.firstA)).length,
        0,
      );
    });
  },
);

test(
  'claim eligibility is pending only, so no retry or ambiguity is auto-dispatched',
  { skip: !url },
  async () => {
    await withSchema(async (f) => {
      const raw = token();
      const claimed = await claim(
        f.db,
        f.api,
        f.organizationA,
        f.connectorA,
        raw,
      );
      const descriptor = claimed[0];
      assert.ok(descriptor !== undefined);

      // retrying is a legal F062.1 edge back to dispatching, and it is
      // deliberately not claimable: no approved backoff exists, so claiming it
      // would be an unbounded hot retry loop.
      assert.equal(mayTransitionDeliveryState('retrying', 'dispatching'), true);
      assert.equal(
        await complete(f.db, f.api, {
          organizationId: f.organizationA,
          obligationId: f.firstA,
          attemptId: descriptor.delivery_attempt_id,
          generation: descriptor.claim_generation,
          raw,
          outcome: 'failed_transient',
          category: 'destination_unavailable',
        }),
        true,
      );
      assert.equal(await stateOf(f.db, f.organizationA, f.firstA), 'retrying');

      // The second obligation is still claimable; the retrying one is not.
      const next = await claim(
        f.db,
        f.api,
        f.organizationA,
        f.connectorA,
        token(),
      );
      assert.equal(next[0]?.integration_outbox_id, f.secondA);
      const again = await claim(
        f.db,
        f.api,
        f.organizationA,
        f.connectorA,
        token(),
      );
      assert.deepEqual(again, []);
    });
  },
);

// ---------------------------------------------------------------------------
// Completion and fencing
// ---------------------------------------------------------------------------

test(
  'the outcome to delivery-state mapping is exactly F062.1 and settles once',
  { skip: !url },
  async () => {
    const expected: Readonly<Record<AttemptOutcome, DeliveryState>> = {
      succeeded: 'accepted',
      failed_transient: 'retrying',
      failed_permanent: 'failed_permanent',
      ambiguous: 'ambiguous',
    };
    const category: Readonly<Record<AttemptOutcome, string | null>> = {
      succeeded: null,
      failed_transient: 'rate_limited',
      failed_permanent: 'destination_rejected',
      ambiguous: 'destination_timeout',
    };
    for (const outcome of attemptOutcomes) {
      await withSchema(async (f) => {
        const raw = token();
        const descriptor = (
          await claim(f.db, f.api, f.organizationA, f.connectorA, raw)
        )[0];
        assert.ok(descriptor !== undefined);
        assert.equal(
          await complete(f.db, f.api, {
            organizationId: f.organizationA,
            obligationId: f.firstA,
            attemptId: descriptor.delivery_attempt_id,
            generation: descriptor.claim_generation,
            raw,
            outcome,
            category: category[outcome],
          }),
          true,
        );
        // Every mapped state is a declared edge out of dispatching.
        assert.ok(
          mayTransitionDeliveryState('dispatching', expected[outcome]),
          `dispatching -> ${expected[outcome]} must be declared`,
        );
        assert.equal(
          await stateOf(f.db, f.organizationA, f.firstA),
          expected[outcome],
        );
        const attempts = await attemptsOf(f.db, f.organizationA, f.firstA);
        assert.equal(attempts.length, 1);
        assert.equal(attempts[0]?.outcome, outcome);
        assert.equal(attempts[0].failure_category, category[outcome]);
        assert.notEqual(attempts[0].completed_at, null);

        // Exactly once: the same correct settlement does not apply twice.
        assert.equal(
          await complete(f.db, f.api, {
            organizationId: f.organizationA,
            obligationId: f.firstA,
            attemptId: descriptor.delivery_attempt_id,
            generation: descriptor.claim_generation,
            raw,
            outcome,
            category: category[outcome],
          }),
          false,
        );
        assert.equal(
          await stateOf(f.db, f.organizationA, f.firstA),
          expected[outcome],
        );
      });
    }
  },
);

test(
  'a wrong token, a stale generation and a foreign Organization all mutate nothing',
  { skip: !url },
  async () => {
    await withSchema(async (f) => {
      const raw = token();
      const descriptor = (
        await claim(f.db, f.api, f.organizationA, f.connectorA, raw)
      )[0];
      assert.ok(descriptor !== undefined);
      const base = {
        organizationId: f.organizationA,
        obligationId: f.firstA,
        attemptId: descriptor.delivery_attempt_id,
        generation: descriptor.claim_generation,
        raw,
        outcome: 'succeeded',
        category: null,
      };

      // Each refusal is the same undifferentiated false, so a caller cannot
      // learn which part of the fence it failed — or that another Organization's
      // attempt exists at all.
      for (const variant of [
        { ...base, raw: token() },
        { ...base, generation: '2' },
        { ...base, generation: '99' },
        { ...base, organizationId: f.organizationB },
        { ...base, obligationId: f.secondA },
        { ...base, attemptId: randomUUID() },
      ]) {
        assert.equal(await complete(f.db, f.api, variant), false);
        assert.equal(
          await stateOf(f.db, f.organizationA, f.firstA),
          'dispatching',
          'a refused settlement must not transition the obligation',
        );
        const attempts = await attemptsOf(f.db, f.organizationA, f.firstA);
        assert.equal(attempts[0]?.completed_at, null);
        assert.equal(attempts[0].outcome, null);
      }

      // The correct claimant still settles afterwards, so none of the refusals
      // consumed the claim.
      assert.equal(await complete(f.db, f.api, base), true);
      assert.equal(await stateOf(f.db, f.organizationA, f.firstA), 'accepted');
    });
  },
);

test('generation N cannot settle generation N+1', { skip: !url }, async () => {
  await withSchema(async (f) => {
    const firstRaw = token();
    const first = (
      await claim(f.db, f.api, f.organizationA, f.connectorA, firstRaw)
    )[0];
    assert.ok(first !== undefined);
    assert.equal(first.claim_generation, '1');
    assert.equal(
      await complete(f.db, f.api, {
        organizationId: f.organizationA,
        obligationId: f.firstA,
        attemptId: first.delivery_attempt_id,
        generation: first.claim_generation,
        raw: firstRaw,
        outcome: 'ambiguous',
        category: 'destination_timeout',
      }),
      true,
    );

    // Ownership moves to generation 2. No reviewed API produces this today,
    // so it is forced directly; the fence it proves is what a future re-claim
    // will rely on.
    const secondRaw = token();
    const digest = await sql<{ digest: string }>`
      select pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(${secondRaw}, 'UTF8')), 'hex') as digest`.execute(
      f.db,
    );
    const second = await forceSecondAttempt(
      f.db,
      f.organizationA,
      f.firstA,
      f.connectorA,
      digest.rows[0]?.digest ?? '',
      2,
    );
    assert.equal(second.claim_generation, '2');
    // ambiguous -> dispatching requires idempotency support, which this
    // connector does not declare, so the obligation stays ambiguous and the
    // settlement path below is exercised against that state.
    assert.equal(await stateOf(f.db, f.organizationA, f.firstA), 'ambiguous');

    // The displaced claimant cannot settle the new generation: neither its
    // generation nor its token matches.
    assert.equal(
      await complete(f.db, f.api, {
        organizationId: f.organizationA,
        obligationId: f.firstA,
        attemptId: second.id,
        generation: first.claim_generation,
        raw: firstRaw,
        outcome: 'succeeded',
        category: null,
      }),
      false,
    );
    // Correct generation with the wrong token, and the correct token with the
    // wrong generation, are both refused.
    assert.equal(
      await complete(f.db, f.api, {
        organizationId: f.organizationA,
        obligationId: f.firstA,
        attemptId: second.id,
        generation: second.claim_generation,
        raw: firstRaw,
        outcome: 'succeeded',
        category: null,
      }),
      false,
    );
    assert.equal(
      await complete(f.db, f.api, {
        organizationId: f.organizationA,
        obligationId: f.firstA,
        attemptId: second.id,
        generation: first.claim_generation,
        raw: secondRaw,
        outcome: 'succeeded',
        category: null,
      }),
      false,
    );
    const attempts = await attemptsOf(f.db, f.organizationA, f.firstA);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[1]?.completed_at, null);
    assert.equal(await stateOf(f.db, f.organizationA, f.firstA), 'ambiguous');
  });
});

test(
  'a settlement whose obligation is not dispatching is refused atomically',
  { skip: !url },
  async () => {
    await withSchema(async (f) => {
      const raw = token();
      const descriptor = (
        await claim(f.db, f.api, f.organizationA, f.connectorA, raw)
      )[0];
      assert.ok(descriptor !== undefined);

      // The obligation leaves dispatching underneath the claimant. Its open
      // attempt is still open and its fence still matches, so this isolates the
      // transition check from the ownership check.
      await f.db
        .updateTable('integration_outbox')
        .set({ state: 'ambiguous' })
        .where('id', '=', f.firstA)
        .execute();

      const refusal = await message(() =>
        complete(f.db, f.api, {
          organizationId: f.organizationA,
          obligationId: f.firstA,
          attemptId: descriptor.delivery_attempt_id,
          generation: descriptor.claim_generation,
          raw,
          outcome: 'succeeded',
          category: null,
        }),
      );
      assert.match(refusal, /not dispatching/);
      // Atomic: the attempt settlement that ran before the refusal is rolled
      // back with it, so the attempt is still open.
      const attempts = await attemptsOf(f.db, f.organizationA, f.firstA);
      assert.equal(attempts[0]?.completed_at, null);
      assert.equal(attempts[0].outcome, null);
      assert.equal(await stateOf(f.db, f.organizationA, f.firstA), 'ambiguous');
    });
  },
);

test(
  'an invalid outcome or failure category is refused structurally',
  { skip: !url },
  async () => {
    await withSchema(async (f) => {
      const raw = token();
      const descriptor = (
        await claim(f.db, f.api, f.organizationA, f.connectorA, raw)
      )[0];
      assert.ok(descriptor !== undefined);
      const base = {
        organizationId: f.organizationA,
        obligationId: f.firstA,
        attemptId: descriptor.delivery_attempt_id,
        generation: descriptor.claim_generation,
        raw,
      };

      const refusals: readonly (readonly [string, string | null, RegExp])[] = [
        // Free text, and plausible-but-undeclared states.
        ['delivered', null, /Unsupported integration attempt outcome/],
        ['SUCCEEDED', null, /Unsupported integration attempt outcome/],
        ['dead_lettered', null, /Unsupported integration attempt outcome/],
        ['', null, /Unsupported integration attempt outcome/],
        [
          'failed_permanent',
          'because the vendor said no',
          /Unsupported integration failure category/,
        ],
        ['failed_permanent', null, /Unsupported integration failure category/],
        [
          'succeeded',
          'internal_failure',
          /successful integration attempt carries no failure category/,
        ],
        // F062.1 classification coherence, both halves.
        [
          'failed_transient',
          'destination_timeout',
          /Only a transient integration failure category/,
        ],
        [
          'failed_transient',
          'authentication_failed',
          /Only a transient integration failure category/,
        ],
        [
          'failed_permanent',
          'destination_timeout',
          /destination timeout is ambiguous/,
        ],
      ];
      for (const [outcome, category, expected] of refusals) {
        const refusal = await message(() =>
          complete(f.db, f.api, { ...base, outcome, category }),
        );
        assert.match(refusal, expected);
      }

      // Nothing above mutated anything.
      assert.equal(
        await stateOf(f.db, f.organizationA, f.firstA),
        'dispatching',
      );
      assert.equal(
        (await attemptsOf(f.db, f.organizationA, f.firstA))[0]?.completed_at,
        null,
      );

      // And the contract's own classification is what was enforced: exactly the
      // two transient categories are accepted for a transient outcome.
      assert.deepEqual([...transientIntegrationFailures].sort(), [
        'destination_unavailable',
        'rate_limited',
      ]);
      assert.equal(
        integrationFailureCategories.includes('destination_timeout'),
        true,
      );
      assert.equal(
        transientIntegrationFailures.includes('destination_timeout'),
        false,
      );
    });
  },
);

test(
  'a settlement requires the claim token and never echoes it',
  { skip: !url },
  async () => {
    await withSchema(async (f) => {
      const raw = token();
      const descriptor = (
        await claim(f.db, f.api, f.organizationA, f.connectorA, raw)
      )[0];
      assert.ok(descriptor !== undefined);
      const refusal = await message(() =>
        complete(f.db, f.api, {
          organizationId: f.organizationA,
          obligationId: f.firstA,
          attemptId: descriptor.delivery_attempt_id,
          generation: descriptor.claim_generation,
          raw: 'tiny',
          outcome: 'succeeded',
          category: null,
        }),
      );
      assert.match(refusal, /requires the claim token/);
      assert.equal(refusal.includes('tiny'), false);
    });
  },
);

// ---------------------------------------------------------------------------
// Definer hardening
// ---------------------------------------------------------------------------

test(
  'both functions are hardened SECURITY DEFINER with no PUBLIC EXECUTE',
  { skip: !url },
  async () => {
    await withSchema(async (f) => {
      const functions = await sql<{
        proname: string;
        prosecdef: boolean;
        provolatile: string;
        proconfig: string[] | null;
        public_execute: boolean;
        arguments: string;
        definition: string;
      }>`
      select p.proname, p.prosecdef, p.provolatile, p.proconfig,
             has_function_privilege('public', p.oid, 'EXECUTE') as public_execute,
             pg_get_function_identity_arguments(p.oid) as arguments,
             pg_get_functiondef(p.oid) as definition
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = ${f.api} order by p.proname`.execute(f.db);

      assert.deepEqual(
        functions.rows.map((row) => row.proname),
        ['claim_integration_intent', 'complete_integration_attempt'],
        'the api schema holds exactly the two reviewed functions',
      );
      assert.deepEqual(
        functions.rows.map((row) => row.arguments),
        [
          'target_organization uuid, target_connector uuid, raw_claim_token text',
          'target_organization uuid, target_obligation uuid, target_attempt uuid, ' +
            'expected_claim_generation bigint, raw_claim_token text, ' +
            'attempt_outcome character varying, attempt_failure_category character varying',
        ],
      );
      for (const row of functions.rows) {
        assert.equal(row.prosecdef, true, `${row.proname} must be definer`);
        assert.equal(row.provolatile, 'v', `${row.proname} must be VOLATILE`);
        // The application schema is deliberately absent from the path, so an
        // unqualified application reference fails loudly instead of resolving
        // to something plausible.
        assert.deepEqual(row.proconfig, [
          'search_path=pg_catalog, ' + f.schema + ', pg_temp',
        ]);
        assert.equal(
          row.public_execute,
          false,
          `PUBLIC must not execute ${row.proname}`,
        );
        // No dynamic SQL, and no concatenation of the token into a statement.
        assert.equal(/\bexecute\s+(format|'|")/i.test(row.definition), false);
        assert.equal(row.definition.includes('raw_claim_token ||'), false);
        assert.equal(row.definition.includes('|| raw_claim_token'), false);
        // The token is never named in a raised message.
        for (const raised of row.definition.matchAll(/raise exception[^;]*;/gi))
          assert.equal(
            raised[0].includes('raw_claim_token'),
            false,
            `${row.proname} names the token in an exception`,
          );
      }
    });
  },
);

test(
  'a pg_temp decoy cannot divert a claim away from the real tables',
  { skip: !url },
  async () => {
    await withSchema(async (f) => {
      await f.db.connection().execute(async (held) => {
        // The one schema a constrained caller can write to. With pg_temp last in
        // the pinned search_path and every application object qualified, a decoy
        // relation is unreachable from inside the function.
        for (const relation of [
          'integration_outbox',
          'integration_delivery_attempt',
          'integration_connector',
          'integration_connector_audit',
        ])
          await sql
            .raw(
              `create temporary table ${relation} (organization_id uuid, id uuid, state text)`,
            )
            .execute(held);

        const raw = token();
        const claimed = await claim(
          held,
          f.api,
          f.organizationA,
          f.connectorA,
          raw,
        );
        // The real obligation was claimed, from the real table.
        assert.equal(claimed.length, 1);
        assert.equal(claimed[0]?.integration_outbox_id, f.firstA);

        const decoys = await sql<{ planted: string }>`
        select count(*)::text as planted
        from pg_temp.integration_delivery_attempt`.execute(held);
        assert.equal(decoys.rows[0]?.planted, '0', 'the decoy must stay empty');

        // The converse, which is why the pin is load bearing rather than
        // decorative: an UNPINNED session query on this same connection IS
        // diverted, because PostgreSQL searches pg_temp before anything else
        // when pg_temp is not named in search_path. The function names it last,
        // so the function is immune where the plain session is not.
        const diverted = await sql<{ visible: string }>`
        select count(*)::text as visible from integration_outbox`.execute(held);
        assert.equal(
          diverted.rows[0]?.visible,
          '0',
          'the decoy should divert an unpinned session query',
        );

        // Dropped before the connection returns to the pool, or a later query
        // on it would read the decoy.
        for (const relation of [
          'integration_outbox',
          'integration_delivery_attempt',
          'integration_connector',
          'integration_connector_audit',
        ])
          await sql.raw(`drop table pg_temp.${relation}`).execute(held);
      });
      assert.equal(
        await stateOf(f.db, f.organizationA, f.firstA),
        'dispatching',
      );
    });
  },
);

test(
  'no column anywhere in the integration schema can hold a raw token',
  { skip: !url },
  async () => {
    await withSchema(async (f) => {
      const columns = await sql<{ table_name: string; column_name: string }>`
      select table_name, column_name from information_schema.columns
      where table_schema = ${f.schema}
        and table_name like 'integration\\_%'
        and column_name like '%token%'
      order by 1, 2`.execute(f.db);
      assert.deepEqual(columns.rows, [
        {
          table_name: 'integration_delivery_attempt',
          column_name: 'claim_token_digest',
        },
      ]);
    });
  },
);

// ---------------------------------------------------------------------------
// Migration cycle
// ---------------------------------------------------------------------------

test(
  'rollback refuses while a claim is unsettled, then applies and reapplies',
  { skip: !url },
  async () => {
    await withSchema(async (f) => {
      const raw = token();
      const descriptor = (
        await claim(f.db, f.api, f.organizationA, f.connectorA, raw)
      )[0];
      assert.ok(descriptor !== undefined);

      // An open attempt has no settlement path without these functions, so
      // rollback refuses rather than stranding it.
      const refusal = await message(() =>
        rollbackIntegrationWorkerFunctions(f.db, f.schema),
      );
      assert.match(refusal, /unsettled integration delivery claim/);
      const stillThere = await sql<{ present: number }>`
      select count(*)::int as present from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace where n.nspname = ${f.api}`.execute(
        f.db,
      );
      assert.equal(stillThere.rows[0]?.present, 2);

      assert.equal(
        await complete(f.db, f.api, {
          organizationId: f.organizationA,
          obligationId: f.firstA,
          attemptId: descriptor.delivery_attempt_id,
          generation: descriptor.claim_generation,
          raw,
          outcome: 'succeeded',
          category: null,
        }),
        true,
      );

      await rollbackIntegrationWorkerFunctions(f.db, f.schema);
      const gone = await sql<{ present: number }>`
      select count(*)::int as present from pg_namespace where nspname = ${f.api}`.execute(
        f.db,
      );
      assert.equal(gone.rows[0]?.present, 0, 'the api schema is removed');

      // Settled evidence survived the rollback, and reapplying restores the API.
      assert.equal(
        (await attemptsOf(f.db, f.organizationA, f.firstA)).length,
        1,
      );
      assert.equal(await stateOf(f.db, f.organizationA, f.firstA), 'accepted');
      await applyIntegrationWorkerFunctions(f.db, f.schema);
      const again = await claim(
        f.db,
        f.api,
        f.organizationA,
        f.connectorA,
        token(),
      );
      assert.equal(again[0]?.integration_outbox_id, f.secondA);
    });
  },
);

test(
  'the delivery-state machine still refuses every edge the contract omits',
  { skip: !url },
  async () => {
    await withSchema(async (f) => {
      // The functions add no edge. dead_lettered in particular stays unreachable
      // from any of them, because authorized replay evidence does not exist.
      assert.deepEqual([...deliveryStateTransitions.dead_lettered], []);
      const raw = token();
      const descriptor = (
        await claim(f.db, f.api, f.organizationA, f.connectorA, raw)
      )[0];
      assert.ok(descriptor !== undefined);
      assert.equal(
        await complete(f.db, f.api, {
          organizationId: f.organizationA,
          obligationId: f.firstA,
          attemptId: descriptor.delivery_attempt_id,
          generation: descriptor.claim_generation,
          raw,
          outcome: 'failed_permanent',
          category: 'destination_rejected',
        }),
        true,
      );
      assert.equal(
        await stateOf(f.db, f.organizationA, f.firstA),
        'failed_permanent',
      );
      // Terminal, and no function can move it.
      const refusal = await message(() =>
        f.db
          .updateTable('integration_outbox')
          .set({ state: 'pending' })
          .where('id', '=', f.firstA)
          .execute(),
      );
      assert.match(
        refusal,
        /Unsupported integration delivery state transition/,
      );
    });
  },
);
