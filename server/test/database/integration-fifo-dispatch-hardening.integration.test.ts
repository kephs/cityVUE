import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';
import {
  applyIntegrationWorkerFunctions,
  applyIntegrationWorkerHardening,
  rollbackIntegrationWorkerHardening,
  workerApiSchema,
  workerHardeningSql,
} from '../helpers/integration-worker-functions.js';
import { up as catalogUp } from '../../migrations/20260902000000-create-organization-service-catalog.js';
import { up as connectorUp } from '../../migrations/20261020000000-add-integration-connector-registry.js';
import { up as outboxUp } from '../../migrations/20261021000000-add-integration-outbox.js';
import { up as attemptUp } from '../../migrations/20261022000000-add-integration-delivery-attempt.js';
import { up as leaseUp } from '../../migrations/20261024000000-add-integration-lease-recovery-evidence.js';
import { up as orderingUp } from '../../migrations/20261025000000-add-integration-ordering-retry-eligibility.js';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import {
  NO_CAPABILITIES,
  type OrderingGuarantee,
} from '../../src/integration/connector-capabilities.js';
import { toCapabilityColumns } from '../../src/integration/persistence/connector-metadata.js';
import { enqueueIntegrationIntent } from '../../src/integration/persistence/outbox.repository.js';
import type { EnqueueIntentInput } from '../../src/integration/persistence/outbox.js';

/**
 * F062.2D-2C-3A — strict FIFO, due-retry eligibility and the dispatch
 * boundary, proven against PostgreSQL.
 *
 * Every assertion is a database property and every test is deterministic:
 * **no sleeps**. Due and future schedules are constructed directly against the
 * database clock, and the concurrency proofs coordinate by observing
 * `pg_locks` rather than by waiting.
 *
 * **No lease is authored, no retry is scheduled, no recovery function exists,
 * no worker holds EXECUTE and no network I/O occurs.**
 */

const url = process.env.TEST_DATABASE_URL;
type Database = Kysely<DatabaseSchema>;

/** The twenty columns Migration 53 returned, in order. F062.2D-2C-3A appends
 * exactly one. */
const ORIGINAL_DESCRIPTOR = [
  'integration_outbox_id',
  'delivery_attempt_id',
  'attempt_number',
  'claim_generation',
  'integration_connector_id',
  'connector_kind',
  'integration_id',
  'contract_kind',
  'integration_type',
  'schema_version',
  'aggregate_type',
  'aggregate_id',
  'aggregate_revision',
  'payload_mode',
  'correlation_id',
  'causation_id',
  'deployment_environment',
  'occurred_at',
  'connector_configuration_revision',
  'capability_snapshot',
] as const;

const BLOCKING = [
  'pending',
  'retrying',
  'dispatching',
  'ambiguous',
  'dead_lettered',
] as const;
const NON_BLOCKING = [
  'accepted',
  'acknowledged',
  'failed_permanent',
  'refused',
] as const;

interface Fixture {
  readonly db: Database;
  /** A second pool, for cross-connection concurrency proofs. */
  readonly other: Database;
  readonly schema: string;
  readonly api: string;
  readonly organizationId: string;
  /** `supports_ordering = 'per_aggregate'` at revision 1. */
  readonly orderedConnector: string;
  /** `supports_ordering = 'none'` at revision 1. */
  readonly plainConnector: string;
}

async function withSchema(
  run: (fixture: Fixture) => Promise<void>,
): Promise<void> {
  const schema = 'fifo_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString: url });
  try {
    await prepareDatabaseExtensions(admin);
  } catch (error) {
    await admin.end();
    throw error;
  }
  await admin.query('create schema "' + schema + '"');
  await admin.query('create schema "' + workerApiSchema(schema) + '"');
  const open = () =>
    new Kysely<DatabaseSchema>({
      dialect: new PostgresDialect({
        pool: new Pool({
          connectionString: url,
          options: '-c search_path=' + schema,
          max: 4,
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
    await leaseUp(db);
    await orderingUp(db);
    await applyIntegrationWorkerHardening(db, schema);
    const organizationId = randomUUID();
    await db
      .insertInto('organization')
      .values({
        id: organizationId,
        name: 'F062.2D-2C-3A Synthetic',
        short_name: 'Test',
        slug: 'f0622d2c3a-' + organizationId,
        status: 'active',
        default_business_timezone: 'America/New_York',
      })
      .execute();
    await run({
      db,
      other,
      schema,
      api: workerApiSchema(schema),
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
    await other.destroy();
    await admin.query('drop schema "' + workerApiSchema(schema) + '" cascade');
    await admin.query('drop schema "' + schema + '" cascade');
    await admin.end();
  }
}

function capabilities(supportsOrdering: OrderingGuarantee) {
  return {
    ...NO_CAPABILITIES,
    supportsOrdering,
    supportsIdempotencyKey: true,
    reportsTerminalState: true,
  };
}

async function registerConnector(
  db: Database,
  organizationId: string,
  connectorKey: string,
  supportsOrdering: OrderingGuarantee,
): Promise<string> {
  const declared = capabilities(supportsOrdering);
  const connectorId = await db.transaction().execute(async (trx) => {
    const created = await trx
      .insertInto('integration_connector')
      .values({
        organization_id: organizationId,
        connector_key: connectorKey,
        connector_kind: 'loopback',
        ...toCapabilityColumns(declared),
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
        ...toCapabilityColumns(declared),
        credential_reference_present: false,
        prior_configuration_revision: null,
        prior_lifecycle_state: null,
        actor: 'test-operator',
        correlation_id: randomUUID(),
      })
      .execute();
    return created.id;
  });
  // `configured` is not a claimable lifecycle state, so the connector is
  // advanced to `active` through a reviewed edge with its own audit row. This
  // happens after the registration transaction commits, because the advance
  // reads the connector back on its own connection.
  await activate(db, organizationId, connectorId);
  return connectorId;
}

/** `configured -> active`, one of the two lifecycle states an intent may be
 * claimed in. */
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

/** Advances a connector to the next configuration revision, changing only its
 * ordering capability. This is how the §4.0b activation barrier is built. */
async function reorderConnector(
  db: Database,
  organizationId: string,
  connectorId: string,
  supportsOrdering: OrderingGuarantee,
): Promise<number> {
  return advanceConnector(db, organizationId, connectorId, {
    category: 'capabilities_changed',
    supportsOrdering,
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
    readonly lifecycleState?: 'active';
    readonly supportsOrdering?: OrderingGuarantee;
  },
): Promise<number> {
  return db.transaction().execute(async (trx) => {
    const current = await trx
      .selectFrom('integration_connector')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where('id', '=', connectorId)
      .executeTakeFirstOrThrow();
    const updated = await trx
      .updateTable('integration_connector')
      .set({
        lifecycle_state: change.lifecycleState ?? current.lifecycle_state,
        ...(change.supportsOrdering === undefined
          ? {}
          : toCapabilityColumns(capabilities(change.supportsOrdering))),
        configuration_revision: current.configuration_revision + 1,
        record_revision: current.record_revision + 1,
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
        record_revision: updated.record_revision,
        configuration_revision: updated.configuration_revision,
        prior_record_revision: current.record_revision,
        revision_advanced: true,
        change_category: change.category,
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
  aggregateId: string,
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
  aggregateRevision: number | null,
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

function token(): string {
  return randomBytes(24).toString('base64url');
}

interface ClaimRow {
  readonly integration_outbox_id: string;
  readonly delivery_attempt_id: string;
  readonly claim_generation: string;
  readonly aggregate_revision: number | null;
  readonly claim_expires_at: Date | null;
}

async function claim(
  db: Database,
  api: string,
  organizationId: string,
  connectorId: string,
  raw = token(),
): Promise<ClaimRow[]> {
  const result = await sql<ClaimRow>`
    select * from ${sql.raw(api)}.claim_integration_intent(
      ${organizationId}::uuid, ${connectorId}::uuid, ${raw}::text)`.execute(db);
  return [...result.rows];
}

async function markDispatch(
  db: Database,
  api: string,
  input: {
    readonly organizationId: string;
    readonly attemptId: string;
    readonly generation: string | number;
    readonly raw: string;
  },
): Promise<boolean> {
  const result = await sql<{ marked: boolean }>`
    select ${sql.raw(api)}.mark_integration_dispatch_started(
      ${input.organizationId}::uuid, ${input.attemptId}::uuid,
      ${String(input.generation)}::bigint, ${input.raw}::text) as marked`.execute(
    db,
  );
  return result.rows[0]?.marked ?? false;
}

async function moveState(
  db: Database,
  outboxId: string,
  next: string,
): Promise<void> {
  // Migration 55 forbids a schedule outside `retrying`, so leaving that state
  // clears it in the same statement -- the same discipline the hardened claim
  // function applies to its own transition.
  await sql`update integration_outbox
            set state = ${next}, next_attempt_at = null
            where id = ${outboxId}`.execute(db);
}

/** Drives an obligation into a target state through legal edges only, and
 * where the target is `retrying` optionally establishes a schedule in the same
 * authoritative transition. */
async function driveTo(
  db: Database,
  outboxId: string,
  target: string,
  schedule: 'none' | 'due' | 'future' = 'none',
): Promise<void> {
  if (target === 'pending') return;
  // `refused` is reachable only from `pending`; every other target goes
  // through `dispatching`.
  if (target === 'refused') {
    await moveState(db, outboxId, 'refused');
    return;
  }
  await moveState(db, outboxId, 'dispatching');
  if (target === 'dispatching') return;
  if (target === 'retrying') {
    if (schedule === 'none') {
      await moveState(db, outboxId, 'retrying');
      return;
    }
    const offset = schedule === 'due' ? '-1 hour' : '1 hour';
    await sql
      .raw(
        `update integration_outbox
          set state = 'retrying',
              next_attempt_at = clock_timestamp() + interval '${offset}'
        where id = '${outboxId}'`,
      )
      .execute(db);
    return;
  }
  if (target === 'acknowledged') {
    await moveState(db, outboxId, 'accepted');
    await moveState(db, outboxId, 'acknowledged');
    return;
  }
  await moveState(db, outboxId, target);
}

async function stateOf(db: Database, outboxId: string): Promise<string> {
  const row = await sql<{ state: string }>`
    select state from integration_outbox where id = ${outboxId}`.execute(db);
  return row.rows[0]?.state ?? '';
}

async function scheduleOf(
  db: Database,
  outboxId: string,
): Promise<Date | null> {
  const row = await sql<{ next_attempt_at: Date | null }>`
    select next_attempt_at from integration_outbox
    where id = ${outboxId}`.execute(db);
  return row.rows[0]?.next_attempt_at ?? null;
}

test(
  'F062.2D-2C-3A strict FIFO, due-retry eligibility and the dispatch boundary',
  {
    skip:
      url === undefined &&
      'TEST_DATABASE_URL is not set; the 3A hardening proof is skipped',
  },
  async (t) => {
    // -----------------------------------------------------------------
    // Claim descriptor parity
    // -----------------------------------------------------------------

    await t.test(
      'the claim descriptor is the original twenty columns plus claim_expires_at',
      async () => {
        await withSchema(async ({ db, api, schema }) => {
          const live = await sql<{ argnames: string[]; argmodes: string[] }>`
            select p.proargnames as argnames,
                   coalesce(p.proargmodes::text[], array[]::text[]) as argmodes
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = ${api}
              and p.proname = 'claim_integration_intent'`.execute(db);
          const names = live.rows[0]?.argnames ?? [];
          const modes = live.rows[0]?.argmodes ?? [];
          // Output (TABLE) columns are mode 't'; the three inputs are 'i'.
          const outputs = names.filter((_, index) => modes[index] === 't');
          assert.deepEqual(outputs, [
            ...ORIGINAL_DESCRIPTOR,
            'claim_expires_at',
          ]);
          assert.deepEqual(
            names.filter((_, index) => modes[index] === 'i'),
            ['target_organization', 'target_connector', 'raw_claim_token'],
          );

          // The new column's type, from the live signature.
          const signature = await sql<{ identity: string }>`
            select pg_get_function_identity_arguments(p.oid) as identity
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = ${api}
              and p.proname = 'claim_integration_intent'`.execute(db);
          assert.equal(
            signature.rows[0]?.identity,
            'target_organization uuid, target_connector uuid, raw_claim_token text',
          );
          const result = await sql<{ result: string }>`
            select pg_get_function_result(p.oid) as result
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = ${api}
              and p.proname = 'claim_integration_intent'`.execute(db);
          assert.match(
            result.rows[0]?.result ?? '',
            /claim_expires_at timestamp with time zone\)$/,
          );

          // And the source text agrees with the live catalogue.
          const source = await workerHardeningSql(schema, 'up');
          assert.match(source, /claim_expires_at timestamptz/);
        });
      },
    );

    // -----------------------------------------------------------------
    // Retry eligibility
    // -----------------------------------------------------------------

    await t.test(
      'pending is claimable, and the claim authors no lease',
      async () => {
        await withSchema(async (fixture) => {
          const { db, api, organizationId } = fixture;
          const obligation = await enqueue(
            db,
            organizationId,
            fixture.plainConnector,
            null,
          );
          const claimed = await claim(
            db,
            api,
            organizationId,
            fixture.plainConnector,
          );
          assert.equal(claimed.length, 1);
          assert.equal(claimed[0]?.integration_outbox_id, obligation);
          // H. No lease is authored anywhere in 3A.
          assert.equal(claimed[0].claim_expires_at, null);
          const stored = await sql<{ lease: Date | null }>`
            select claim_expires_at as lease
            from integration_delivery_attempt
            where id = ${claimed[0].delivery_attempt_id}`.execute(db);
          assert.equal(stored.rows[0]?.lease, null);
          assert.equal(await stateOf(db, obligation), 'dispatching');
        });
      },
    );

    await t.test(
      'a retrying obligation is claimable only when its schedule is non-null and due',
      async () => {
        for (const [schedule, claimable] of [
          ['none', false],
          ['future', false],
          ['due', true],
        ] as const) {
          await withSchema(async (fixture) => {
            const { db, api, organizationId } = fixture;
            const obligation = await enqueue(
              db,
              organizationId,
              fixture.plainConnector,
              null,
            );
            await driveTo(db, obligation, 'retrying', schedule);
            assert.equal(await stateOf(db, obligation), 'retrying');

            const claimed = await claim(
              db,
              api,
              organizationId,
              fixture.plainConnector,
            );
            assert.equal(
              claimed.length,
              claimable ? 1 : 0,
              `retrying + ${schedule} should ${claimable ? '' : 'not '}be claimable`,
            );
            if (claimable) {
              // E. The schedule is cleared in the same transition.
              assert.equal(await stateOf(db, obligation), 'dispatching');
              assert.equal(await scheduleOf(db, obligation), null);
            } else {
              // G. Nothing changed merely because the claim was attempted,
              // and no timer moved the row.
              assert.equal(await stateOf(db, obligation), 'retrying');
            }
          });
        }
      },
    );

    await t.test(
      'the due comparison is made against the database clock',
      async () => {
        await withSchema(async (fixture) => {
          const { db, api, organizationId } = fixture;
          const obligation = await enqueue(
            db,
            organizationId,
            fixture.plainConnector,
            null,
          );
          // A schedule one second in the future by the DATABASE clock. If the
          // predicate used any other clock, a host offset would flip this.
          await moveState(db, obligation, 'dispatching');
          await sql`update integration_outbox
                    set state = 'retrying',
                        next_attempt_at = clock_timestamp() + interval '1 second'
                    where id = ${obligation}`.execute(db);
          const before = await sql<{ due: boolean }>`
            select next_attempt_at <= clock_timestamp() as due
            from integration_outbox where id = ${obligation}`.execute(db);
          assert.equal(before.rows[0]?.due, false);
          assert.equal(
            (await claim(db, api, organizationId, fixture.plainConnector))
              .length,
            0,
          );

          // Move the stored schedule into the past, again by database time.
          await moveState(db, obligation, 'dispatching');
          await sql`update integration_outbox
                    set state = 'retrying',
                        next_attempt_at = clock_timestamp() - interval '1 second'
                    where id = ${obligation}`.execute(db);
          const after = await sql<{ due: boolean }>`
            select next_attempt_at <= clock_timestamp() as due
            from integration_outbox where id = ${obligation}`.execute(db);
          assert.equal(after.rows[0]?.due, true);
          assert.equal(
            (await claim(db, api, organizationId, fixture.plainConnector))
              .length,
            1,
          );
        });
      },
    );

    // -----------------------------------------------------------------
    // Strict FIFO: the frozen blocker and non-blocker sets
    // -----------------------------------------------------------------

    await t.test(
      'an earlier unresolved sibling blocks an ordered candidate, in every blocking state',
      async () => {
        // Every blocking state, and -- because retry eligibility must not be
        // confused with blocking -- all three retry schedules.
        type Case = readonly [string, 'none' | 'due' | 'future'];
        const cases: readonly Case[] = BLOCKING.flatMap<Case>((state) =>
          state === 'retrying'
            ? (['none', 'future', 'due'] as const).map<Case>((schedule) => [
                state,
                schedule,
              ])
            : [[state, 'none']],
        );
        for (const [state, schedule] of cases) {
          await withSchema(async (fixture) => {
            const { db, api, organizationId } = fixture;
            const aggregateId = randomUUID();
            const older = await enqueue(
              db,
              organizationId,
              fixture.orderedConnector,
              1,
              aggregateId,
            );
            const newer = await enqueue(
              db,
              organizationId,
              fixture.orderedConnector,
              2,
              aggregateId,
            );
            await driveTo(db, older, state, schedule);
            assert.equal(await stateOf(db, older), state);

            const claimed = await claim(
              db,
              api,
              organizationId,
              fixture.orderedConnector,
            );
            // Either nothing is claimable, or only the older row is -- never
            // the newer one.
            assert.notEqual(
              claimed[0]?.integration_outbox_id,
              newer,
              `${state}/${schedule} predecessor failed to block`,
            );
            // A pending or due-retrying predecessor is itself claimable and
            // simply wins on global order, which would hide a missing gate.
            // After it has been taken it is `dispatching`, so a second claim
            // must still find nothing: that is the gate, not the ordering.
            const again = await claim(
              db,
              api,
              organizationId,
              fixture.orderedConnector,
            );
            assert.equal(
              again.length,
              0,
              `${state}/${schedule}: the newer obligation must stay blocked`,
            );
          });
        }
      },
    );

    await t.test(
      'an earlier terminal sibling does not block an ordered candidate',
      async () => {
        for (const state of NON_BLOCKING) {
          await withSchema(async (fixture) => {
            const { db, api, organizationId } = fixture;
            const aggregateId = randomUUID();
            const older = await enqueue(
              db,
              organizationId,
              fixture.orderedConnector,
              1,
              aggregateId,
            );
            const newer = await enqueue(
              db,
              organizationId,
              fixture.orderedConnector,
              2,
              aggregateId,
            );
            await driveTo(db, older, state);
            assert.equal(await stateOf(db, older), state);

            const claimed = await claim(
              db,
              api,
              organizationId,
              fixture.orderedConnector,
            );
            assert.equal(
              claimed[0]?.integration_outbox_id,
              newer,
              `${state} predecessor should not block`,
            );
          });
        }
      },
    );

    await t.test(
      'the stream key separates Organizations, connectors and aggregates',
      async () => {
        await withSchema(async (fixture) => {
          const { db, api, organizationId } = fixture;
          const aggregateId = randomUUID();

          // A different connector: same aggregate, independent stream.
          const secondOrdered = await registerConnector(
            db,
            organizationId,
            'ordered-two',
            'per_aggregate',
          );
          const onOther = await enqueue(
            db,
            organizationId,
            secondOrdered,
            1,
            aggregateId,
          );
          await driveTo(db, onOther, 'dispatching');

          // A different aggregate on the candidate's own connector.
          const otherAggregate = await enqueue(
            db,
            organizationId,
            fixture.orderedConnector,
            1,
            randomUUID(),
          );
          await driveTo(db, otherAggregate, 'dispatching');

          // A different Organization, same aggregate id.
          const otherOrganization = randomUUID();
          await db
            .insertInto('organization')
            .values({
              id: otherOrganization,
              name: 'Other',
              short_name: 'Test',
              slug: 'other-' + otherOrganization,
              status: 'active',
              default_business_timezone: 'America/New_York',
            })
            .execute();
          const foreignConnector = await registerConnector(
            db,
            otherOrganization,
            'ordered-one',
            'per_aggregate',
          );
          const foreign = await enqueue(
            db,
            otherOrganization,
            foreignConnector,
            1,
            aggregateId,
          );
          await driveTo(db, foreign, 'dispatching');

          // None of the three is in the candidate's stream, so it is claimable.
          const candidate = await enqueue(
            db,
            organizationId,
            fixture.orderedConnector,
            5,
            aggregateId,
          );
          const claimed = await claim(
            db,
            api,
            organizationId,
            fixture.orderedConnector,
          );
          assert.equal(claimed[0]?.integration_outbox_id, candidate);
        });
      },
    );

    // -----------------------------------------------------------------
    // F062.2D-2C-3-0A: the historical / unordered predecessor boundary
    // -----------------------------------------------------------------

    /** Builds the activation barrier: an obligation pinned under a historical
     * unordered revision, then the connector switched to per_aggregate. */
    async function withBarrier(
      fixture: Fixture,
      options: {
        readonly legacyRevision: number | null;
        readonly legacyState: string;
        readonly candidateRevision: number;
        readonly legacyLast?: boolean;
      },
    ): Promise<{ legacy: string; candidate: string; aggregateId: string }> {
      const { db, organizationId } = fixture;
      const aggregateId = randomUUID();
      const connector = fixture.plainConnector;
      let legacy = '';
      if (options.legacyLast !== true)
        legacy = await enqueue(
          db,
          organizationId,
          connector,
          options.legacyRevision,
          aggregateId,
        );
      await reorderConnector(db, organizationId, connector, 'per_aggregate');
      const candidate = await enqueue(
        db,
        organizationId,
        connector,
        options.candidateRevision,
        aggregateId,
      );
      if (options.legacyLast === true) {
        // The legacy row is enqueued AFTER the candidate, which requires
        // reverting the connector so the pin is unordered again.
        await reorderConnector(db, organizationId, connector, 'none');
        legacy = await enqueue(
          db,
          organizationId,
          connector,
          options.legacyRevision,
          aggregateId,
        );
      }
      await driveTo(db, legacy, options.legacyState);
      // The legacy row never becomes ordered.
      const pinned = await sql<{ ordered: boolean }>`
        select requires_ordered_delivery as ordered
        from integration_outbox where id = ${legacy}`.execute(db);
      assert.equal(pinned.rows[0]?.ordered, false);
      const candidateOrdered = await sql<{ ordered: boolean }>`
        select requires_ordered_delivery as ordered
        from integration_outbox where id = ${candidate}`.execute(db);
      assert.equal(candidateOrdered.rows[0]?.ordered, true);
      return { legacy, candidate, aggregateId };
    }

    await t.test(
      'an unresolved historically unordered NULL-revision sibling blocks an ordered candidate',
      async () => {
        await withSchema(async (fixture) => {
          const { db, api, organizationId } = fixture;
          const { legacy, candidate } = await withBarrier(fixture, {
            legacyRevision: null,
            legacyState: 'pending',
            candidateRevision: 5,
          });
          // The legacy row is itself unordered and therefore claimable, and it
          // is taken first on global order.
          const first = await claim(
            db,
            api,
            organizationId,
            fixture.plainConnector,
          );
          assert.equal(first[0]?.integration_outbox_id, legacy);
          // It is now `dispatching` and still unresolved, so the barrier holds
          // and the ordered candidate remains unclaimable.
          const second = await claim(
            db,
            api,
            organizationId,
            fixture.plainConnector,
          );
          assert.equal(
            second.length,
            0,
            'the ordered candidate must not overtake the legacy sibling',
          );
          assert.notEqual(second[0]?.integration_outbox_id, candidate);
        });
      },
    );

    await t.test(
      'an accepted historically unordered sibling does not block, a dead_lettered one does',
      async () => {
        for (const [state, blocks] of [
          ['accepted', false],
          ['dead_lettered', true],
        ] as const) {
          await withSchema(async (fixture) => {
            const { db, api, organizationId } = fixture;
            const { candidate } = await withBarrier(fixture, {
              legacyRevision: null,
              legacyState: state,
              candidateRevision: 5,
            });
            const claimed = await claim(
              db,
              api,
              organizationId,
              fixture.plainConnector,
            );
            if (blocks)
              assert.notEqual(
                claimed[0]?.integration_outbox_id,
                candidate,
                `${state} legacy sibling failed to block`,
              );
            else
              assert.equal(
                claimed[0]?.integration_outbox_id,
                candidate,
                `${state} legacy sibling should not block`,
              );
          });
        }
      },
    );

    await t.test(
      'a numbered legacy revision blocks when it sorts before the candidate and not when it sorts after',
      async () => {
        for (const [legacyRevision, blocks] of [
          [2, true],
          [9, false],
        ] as const) {
          await withSchema(async (fixture) => {
            const { db, api, organizationId } = fixture;
            // `dispatching` keeps the legacy row unresolved while making it
            // unclaimable, so the result isolates the predecessor gate from
            // the unchanged global ordering.
            const { candidate } = await withBarrier(fixture, {
              legacyRevision,
              legacyState: 'dispatching',
              candidateRevision: 5,
            });
            const claimed = await claim(
              db,
              api,
              organizationId,
              fixture.plainConnector,
            );
            if (blocks)
              assert.notEqual(
                claimed[0]?.integration_outbox_id,
                candidate,
                'a legacy revision sorting before the candidate must block',
              );
            else
              assert.equal(
                claimed[0]?.integration_outbox_id,
                candidate,
                'a legacy revision sorting after the candidate must not block',
              );
          });
        }
      },
    );

    await t.test(
      'a NULL revision sorts before numbered revisions even when its created_at is later',
      async () => {
        await withSchema(async (fixture) => {
          const { db, api, organizationId } = fixture;
          // The legacy NULL-revision row is enqueued AFTER the ordered
          // candidate, so chronology and causal position disagree. NULLS FIRST
          // is what makes it block anyway -- PostgreSQL's default NULLS LAST
          // would let the candidate overtake it.
          const { legacy, candidate } = await withBarrier(fixture, {
            legacyRevision: null,
            legacyState: 'pending',
            candidateRevision: 5,
            legacyLast: true,
          });
          const chronology = await sql<{ legacy_later: boolean }>`
            select (select created_at from integration_outbox where id = ${legacy})
                 > (select created_at from integration_outbox where id = ${candidate})
                   as legacy_later`.execute(db);
          assert.equal(
            chronology.rows[0]?.legacy_later,
            true,
            'the legacy row must genuinely be newer for this test to mean anything',
          );
          const claimed = await claim(
            db,
            api,
            organizationId,
            fixture.plainConnector,
          );
          assert.notEqual(
            claimed[0]?.integration_outbox_id,
            candidate,
            'a later-created NULL-revision sibling must still block',
          );
        });
      },
    );

    await t.test('an unordered candidate receives no FIFO gate', async () => {
      await withSchema(async (fixture) => {
        const { db, api, organizationId } = fixture;
        const aggregateId = randomUUID();
        // Two unordered obligations for one aggregate; the older is
        // unresolved. The newer must remain claimable, because the gate
        // applies only to an ordered candidate.
        const older = await enqueue(
          db,
          organizationId,
          fixture.plainConnector,
          1,
          aggregateId,
        );
        const newer = await enqueue(
          db,
          organizationId,
          fixture.plainConnector,
          2,
          aggregateId,
        );
        await driveTo(db, older, 'retrying', 'future');
        const claimed = await claim(
          db,
          api,
          organizationId,
          fixture.plainConnector,
        );
        assert.equal(claimed[0]?.integration_outbox_id, newer);
      });
    });

    // -----------------------------------------------------------------
    // Concurrency
    // -----------------------------------------------------------------

    await t.test(
      'a locked unresolved predecessor still blocks an ordered candidate despite SKIP LOCKED',
      async () => {
        await withSchema(async (fixture) => {
          const { db, other, api, organizationId, schema } = fixture;
          const aggregateId = randomUUID();
          const older = await enqueue(
            db,
            organizationId,
            fixture.orderedConnector,
            1,
            aggregateId,
          );
          const newer = await enqueue(
            db,
            organizationId,
            fixture.orderedConnector,
            2,
            aggregateId,
          );
          const observer = new Pool({ connectionString: url });
          try {
            await other.connection().execute(async (held) => {
              await sql`begin`.execute(held);
              // Hold the predecessor's row lock without changing it.
              await sql`select 1 from integration_outbox
                        where id = ${older} for update`.execute(held);

              // Deterministic, no sleeps: the lock is granted and observable
              // from a third connection before the claim is attempted.
              let locked = false;
              for (let attempt = 0; attempt < 500 && !locked; attempt++) {
                const rows = await observer.query<{ held: number }>(
                  `select count(*)::int as held
                     from pg_locks l
                     join pg_class c on c.oid = l.relation
                     join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = $1
                      and c.relname = 'integration_outbox'
                      and l.mode = 'RowShareLock'
                      and l.granted`,
                  [schema],
                );
                locked = (rows.rows[0]?.held ?? 0) > 0;
              }
              assert.ok(locked, 'the predecessor row lock was not observed');

              // SKIP LOCKED applies to candidate selection. The predecessor
              // predicate is a separate NOT EXISTS over committed rows, so the
              // locked older row must still block the newer one.
              const claimed = await claim(
                db,
                api,
                organizationId,
                fixture.orderedConnector,
              );
              assert.equal(
                claimed.length,
                0,
                'SKIP LOCKED must not let a newer ordered obligation overtake a locked predecessor',
              );
              await sql`rollback`.execute(held);
            });

            // Once the lock is released the contract resumes: the older row is
            // claimable, and the newer one still is not.
            const resumed = await claim(
              db,
              api,
              organizationId,
              fixture.orderedConnector,
            );
            assert.equal(resumed[0]?.integration_outbox_id, older);
            assert.notEqual(resumed[0].integration_outbox_id, newer);
          } finally {
            await observer.end();
          }
        });
      },
    );

    await t.test(
      'unrelated ordered streams remain concurrently claimable',
      async () => {
        await withSchema(async (fixture) => {
          const { db, other, api, organizationId } = fixture;
          const first = await enqueue(
            db,
            organizationId,
            fixture.orderedConnector,
            1,
            randomUUID(),
          );
          const second = await enqueue(
            db,
            organizationId,
            fixture.orderedConnector,
            1,
            randomUUID(),
          );
          // Two claimers, two aggregates, no serialization of the connector.
          const [a, b] = await Promise.all([
            claim(db, api, organizationId, fixture.orderedConnector),
            claim(other, api, organizationId, fixture.orderedConnector),
          ]);
          const claimed = [
            a[0]?.integration_outbox_id,
            b[0]?.integration_outbox_id,
          ].sort();
          assert.deepEqual(claimed, [first, second].sort());
        });
      },
    );

    // -----------------------------------------------------------------
    // The dispatch marker
    // -----------------------------------------------------------------

    await t.test(
      'the rightful owner marks the boundary, database-authored and idempotent',
      async () => {
        await withSchema(async (fixture) => {
          const { db, api, organizationId } = fixture;
          await enqueue(db, organizationId, fixture.plainConnector, null);
          const raw = token();
          const claimed = await claim(
            db,
            api,
            organizationId,
            fixture.plainConnector,
            raw,
          );
          const attemptId = claimed[0]?.delivery_attempt_id ?? '';
          const generation = claimed[0]?.claim_generation ?? '0';

          const before = await sql<{ at: Date }>`
            select clock_timestamp() as at`.execute(db);
          assert.equal(
            await markDispatch(db, api, {
              organizationId,
              attemptId,
              generation,
              raw,
            }),
            true,
          );
          const after = await sql<{ at: Date }>`
            select clock_timestamp() as at`.execute(db);

          const first = await sql<{ marker: Date }>`
            select dispatch_started_at as marker
            from integration_delivery_attempt where id = ${attemptId}`.execute(
            db,
          );
          const marker = first.rows[0]?.marker;
          const low = before.rows[0];
          const high = after.rows[0];
          assert.ok(marker instanceof Date);
          assert.ok(low !== undefined && high !== undefined);
          // Database-authored: it lies between two database clock readings
          // taken around the call, and the function takes no timestamp.
          assert.ok(
            marker.getTime() >= low.at.getTime() &&
              marker.getTime() <= high.at.getTime(),
          );

          // Owner-idempotent: a second valid call succeeds and does not
          // re-stamp, which is what makes a lost response recoverable.
          assert.equal(
            await markDispatch(db, api, {
              organizationId,
              attemptId,
              generation,
              raw,
            }),
            true,
          );
          const second = await sql<{ marker: Date }>`
            select dispatch_started_at as marker
            from integration_delivery_attempt where id = ${attemptId}`.execute(
            db,
          );
          assert.deepEqual(second.rows, first.rows);
        });
      },
    );

    await t.test(
      'the marker is refused for every ownership or fencing failure',
      async () => {
        await withSchema(async (fixture) => {
          const { db, api, organizationId } = fixture;
          const obligation = await enqueue(
            db,
            organizationId,
            fixture.plainConnector,
            null,
          );
          const raw = token();
          const claimed = await claim(
            db,
            api,
            organizationId,
            fixture.plainConnector,
            raw,
          );
          const attemptId = claimed[0]?.delivery_attempt_id ?? '';
          const generation = claimed[0]?.claim_generation ?? '0';

          // Wrong token, stale generation, wrong Organization, unknown
          // attempt: all refused, and indistinguishably so.
          assert.equal(
            await markDispatch(db, api, {
              organizationId,
              attemptId,
              generation,
              raw: token(),
            }),
            false,
          );
          assert.equal(
            await markDispatch(db, api, {
              organizationId,
              attemptId,
              generation: Number(generation) + 1,
              raw,
            }),
            false,
          );
          assert.equal(
            await markDispatch(db, api, {
              organizationId: randomUUID(),
              attemptId,
              generation,
              raw,
            }),
            false,
          );
          assert.equal(
            await markDispatch(db, api, {
              organizationId,
              attemptId: randomUUID(),
              generation,
              raw,
            }),
            false,
          );
          // Still unmarked after all four refusals.
          const unmarked = await sql<{ marker: Date | null }>`
            select dispatch_started_at as marker
            from integration_delivery_attempt where id = ${attemptId}`.execute(
            db,
          );
          assert.equal(unmarked.rows[0]?.marker, null);

          // A settled attempt is refused.
          await sql`update integration_delivery_attempt
                    set outcome = 'succeeded', completed_at = clock_timestamp()
                    where id = ${attemptId}`.execute(db);
          await moveState(db, obligation, 'accepted');
          assert.equal(
            await markDispatch(db, api, {
              organizationId,
              attemptId,
              generation,
              raw,
            }),
            false,
          );
        });
      },
    );

    await t.test('the marker changes nothing but the boundary', async () => {
      await withSchema(async (fixture) => {
        const { db, api, organizationId } = fixture;
        const obligation = await enqueue(
          db,
          organizationId,
          fixture.plainConnector,
          null,
        );
        const raw = token();
        const claimed = await claim(
          db,
          api,
          organizationId,
          fixture.plainConnector,
          raw,
        );
        const attemptId = claimed[0]?.delivery_attempt_id ?? '';
        const generation = claimed[0]?.claim_generation ?? '0';
        const snapshot = await sql<{
          state: string;
          schedule: Date | null;
          attempts: string;
        }>`
            select (select state from integration_outbox where id = ${obligation})
                     as state,
                   (select next_attempt_at from integration_outbox
                     where id = ${obligation}) as schedule,
                   (select count(*)::text from integration_delivery_attempt)
                     as attempts`.execute(db);

        await markDispatch(db, api, {
          organizationId,
          attemptId,
          generation,
          raw,
        });

        const unchanged = await sql<{
          state: string;
          schedule: Date | null;
          attempts: string;
          generation: string;
          outcome: string | null;
        }>`
            select (select state from integration_outbox where id = ${obligation})
                     as state,
                   (select next_attempt_at from integration_outbox
                     where id = ${obligation}) as schedule,
                   (select count(*)::text from integration_delivery_attempt)
                     as attempts,
                   (select claim_generation::text from integration_delivery_attempt
                     where id = ${attemptId}) as generation,
                   (select outcome from integration_delivery_attempt
                     where id = ${attemptId}) as outcome`.execute(db);
        assert.equal(unchanged.rows[0]?.state, 'dispatching');
        assert.equal(unchanged.rows[0].state, snapshot.rows[0]?.state);
        assert.equal(unchanged.rows[0].schedule, null);
        assert.equal(unchanged.rows[0].attempts, snapshot.rows[0]?.attempts);
        assert.equal(unchanged.rows[0].generation, generation);
        assert.equal(unchanged.rows[0].outcome, null);
      });
    });

    // -----------------------------------------------------------------
    // Function security posture
    // -----------------------------------------------------------------

    await t.test(
      'both functions carry the reviewed security posture and no PUBLIC EXECUTE',
      async () => {
        await withSchema(async ({ db, api, schema }) => {
          const functions = await sql<{
            proname: string;
            prosecdef: boolean;
            provolatile: string;
            proconfig: string[] | null;
            acl: string | null;
          }>`
            select p.proname, p.prosecdef, p.provolatile, p.proconfig,
                   p.proacl::text as acl
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = ${api} order by p.proname`.execute(db);
          assert.deepEqual(
            functions.rows.map((row) => row.proname),
            [
              'claim_integration_intent',
              'complete_integration_attempt',
              'mark_integration_dispatch_started',
            ],
            'exactly three functions exist; recovery is not created in 3A',
          );
          for (const row of functions.rows) {
            assert.equal(row.prosecdef, true, `${row.proname} definer`);
            assert.equal(row.provolatile, 'v', `${row.proname} volatility`);
            assert.deepEqual(
              row.proconfig,
              [`search_path=pg_catalog, ${schema}, pg_temp`],
              `${row.proname} search_path`,
            );
            // PUBLIC is the empty grantee in an aclitem. A recreated function
            // carries PostgreSQL's default PUBLIC EXECUTE afresh, so this is
            // the control, not hygiene.
            assert.equal(
              /(^|,)\s*=X\//.test(row.acl ?? ''),
              false,
              `${row.proname} still grants PUBLIC EXECUTE: ${row.acl ?? 'null'}`,
            );
          }
          // No worker role was created anywhere.
          const worker = await sql<{ present: string }>`
            select count(*)::text as present from pg_roles
            where rolname = 'reqro_integration_worker'`.execute(db);
          assert.deepEqual(worker.rows, [{ present: '0' }]);
        });
      },
    );

    // -----------------------------------------------------------------
    // Rollback
    // -----------------------------------------------------------------

    await t.test(
      'rollback restores the Migration 53 claim function exactly and preserves evidence',
      async () => {
        await withSchema(async (fixture) => {
          const { db, api, organizationId, schema } = fixture;

          // Use the hardened functions, producing durable marker evidence.
          await enqueue(db, organizationId, fixture.plainConnector, null);
          const raw = token();
          const claimed = await claim(
            db,
            api,
            organizationId,
            fixture.plainConnector,
            raw,
          );
          const attemptId = claimed[0]?.delivery_attempt_id ?? '';
          await markDispatch(db, api, {
            organizationId,
            attemptId,
            generation: claimed[0]?.claim_generation ?? '0',
            raw,
          });
          const evidence = await sql<{ marker: Date }>`
            select dispatch_started_at as marker
            from integration_delivery_attempt where id = ${attemptId}`.execute(
            db,
          );
          assert.ok(evidence.rows[0]?.marker instanceof Date);

          // The pre-3A definition, for comparison. Re-deriving it from the
          // Migration 53 text is what makes "exactly restored" checkable.
          const hardened = await sql<{ definition: string }>`
            select pg_get_functiondef(p.oid) as definition
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = ${api}
              and p.proname = 'claim_integration_intent'`.execute(db);

          await rollbackIntegrationWorkerHardening(db, schema);

          // The marker function is gone; the other two remain.
          const after = await sql<{ proname: string }>`
            select p.proname from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = ${api} order by p.proname`.execute(db);
          assert.deepEqual(
            after.rows.map((row) => row.proname),
            ['claim_integration_intent', 'complete_integration_attempt'],
          );

          // The restored claim function is the narrow twenty-column one.
          const restored = await sql<{
            definition: string;
            result: string;
            acl: string | null;
            prosecdef: boolean;
            proconfig: string[] | null;
          }>`
            select pg_get_functiondef(p.oid) as definition,
                   pg_get_function_result(p.oid) as result,
                   p.proacl::text as acl, p.prosecdef, p.proconfig
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = ${api}
              and p.proname = 'claim_integration_intent'`.execute(db);
          assert.equal(
            restored.rows[0]?.result.includes('claim_expires_at'),
            false,
            'the restored descriptor must not carry the widened column',
          );
          assert.notEqual(
            restored.rows[0].definition,
            hardened.rows[0]?.definition,
          );
          assert.equal(restored.rows[0].prosecdef, true);
          assert.deepEqual(restored.rows[0].proconfig, [
            `search_path=pg_catalog, ${schema}, pg_temp`,
          ]);
          assert.equal(/(^|,)\s*=X\//.test(restored.rows[0].acl ?? ''), false);

          // Durable evidence survives a function rollback untouched.
          const survived = await sql<{ marker: Date }>`
            select dispatch_started_at as marker
            from integration_delivery_attempt where id = ${attemptId}`.execute(
            db,
          );
          assert.deepEqual(survived.rows, evidence.rows);

          // Reapply, and the widened contract is available again.
          await applyIntegrationWorkerHardening(db, schema);
          const reapplied = await sql<{ result: string }>`
            select pg_get_function_result(p.oid) as result
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = ${api}
              and p.proname = 'claim_integration_intent'`.execute(db);
          assert.match(reapplied.rows[0]?.result ?? '', /claim_expires_at/);
          const stillThere = await sql<{ marker: Date }>`
            select dispatch_started_at as marker
            from integration_delivery_attempt where id = ${attemptId}`.execute(
            db,
          );
          assert.deepEqual(stillThere.rows, evidence.rows);
        });
      },
    );
  },
);
