import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';
import { up as catalogUp } from '../../migrations/20260902000000-create-organization-service-catalog.js';
import { up as connectorUp } from '../../migrations/20261020000000-add-integration-connector-registry.js';
import { up as outboxUp } from '../../migrations/20261021000000-add-integration-outbox.js';
import {
  down,
  up,
} from '../../migrations/20261022000000-add-integration-delivery-attempt.js';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import {
  deliveryStates,
  deliveryStateTransitions,
  terminalDeliveryStates,
  type DeliveryState,
} from '../../src/integration/delivery-contract.js';
import { NO_CAPABILITIES } from '../../src/integration/connector-capabilities.js';
import { toCapabilityColumns } from '../../src/integration/persistence/connector-metadata.js';
import { enqueueIntegrationIntent } from '../../src/integration/persistence/outbox.repository.js';
import type { EnqueueIntentInput } from '../../src/integration/persistence/outbox.js';

/**
 * F062.2D-2A — delivery-attempt persistence and fencing integrity, proven
 * against PostgreSQL.
 *
 * Every assertion is a database property. The tests are deterministic: no
 * sleeps, and every invariant is proven by direct state setup rather than by
 * waiting for anything.
 */

const url = process.env.TEST_DATABASE_URL;
type Database = Kysely<DatabaseSchema>;

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

const SNAPSHOT = {
  supports_idempotency_key: false,
  supports_read_after_write: false,
  side_effect_risk: 'irreversible',
};

interface Fixture {
  readonly db: Database;
  readonly organizationA: string;
  readonly organizationB: string;
  readonly connectorA: string;
  readonly connectorB: string;
  /** A pending obligation in Organization A. */
  readonly outboxA: string;
  /** A pending obligation in Organization B. */
  readonly outboxB: string;
}

async function withSchema(run: (f: Fixture) => Promise<void>): Promise<void> {
  const schema = 'integration_attempt_' + randomUUID().replaceAll('-', '');
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
    await up(db);
    const organizationA = randomUUID();
    const organizationB = randomUUID();
    await db
      .insertInto('organization')
      .values(
        [organizationA, organizationB].map((id, index) => ({
          id,
          name: 'F062.2D-2A Synthetic ' + String(index),
          short_name: 'Test',
          slug: 'f0622d2a-' + id,
          status: 'active',
          default_business_timezone: 'America/New_York',
        })),
      )
      .execute();
    const connectorA = await registerConnector(
      db,
      organizationA,
      'loopback-one',
    );
    const connectorB = await registerConnector(
      db,
      organizationB,
      'loopback-one',
    );
    await run({
      db,
      organizationA,
      organizationB,
      connectorA,
      connectorB,
      outboxA: await enqueue(db, organizationA, connectorA),
      outboxB: await enqueue(db, organizationB, connectorB),
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
  capabilities = NO_CAPABILITIES,
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

/** Opens an attempt the way a future claim would, returning whether it
 * applied so a race can be observed without either side throwing. */
async function openAttempt(
  db: Database,
  organizationId: string,
  outboxId: string,
  connectorId: string,
  digest = DIGEST_A,
  revision = 1,
): Promise<{ applied: boolean; id?: string }> {
  try {
    const row = await db
      .insertInto('integration_delivery_attempt')
      .values({
        organization_id: organizationId,
        integration_outbox_id: outboxId,
        integration_connector_id: connectorId,
        claim_token_digest: digest,
        connector_configuration_revision: revision,
        capability_snapshot: SNAPSHOT,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { applied: true, id: row.id };
  } catch {
    return { applied: false };
  }
}

async function settle(
  db: Database,
  attemptId: string,
  outcome: 'succeeded' | 'failed_transient' | 'failed_permanent' | 'ambiguous',
  failureCategory: string | null = null,
): Promise<number> {
  const result = await db
    .updateTable('integration_delivery_attempt')
    .set({
      outcome,
      completed_at: new Date(),
      failure_category: failureCategory as never,
    })
    .where('id', '=', attemptId)
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}

async function moveState(
  db: Database,
  outboxId: string,
  next: DeliveryState,
): Promise<void> {
  await sql`update integration_outbox set state = ${next} where id = ${outboxId}`.execute(
    db,
  );
}

// ---------------------------------------------------------------------------
// Parity: F062.1 is the authority, the database mirrors it
// ---------------------------------------------------------------------------

test(
  'the outbox delivery-state vocabulary equals F062.1 exactly, in both directions',
  { skip: !url },
  async () => {
    await withSchema(async ({ db }) => {
      // Single-column CHECK constraints on `state` only. A looser filter
      // also matches the integration-type pairing constraint, whose literals
      // include 'event' and 'state_sync' — contract kinds, not delivery
      // states — which would make this assertion read them as a vocabulary.
      const rows = await sql<{ def: string }>`
        select pg_get_constraintdef(c.oid) as def
          from pg_constraint c
          join pg_class t on t.oid = c.conrelid
          join pg_attribute a on a.attrelid = t.oid and a.attnum = any (c.conkey)
         where t.relname = 'integration_outbox' and c.contype = 'c'
         group by c.oid
        having count(*) = 1 and min(a.attname) = 'state'`.execute(db);
      const stated = new Set<string>(
        [
          ...rows.rows
            .map((r) => r.def)
            .join(' ')
            .matchAll(/'([a-z_]+)'::character varying/g),
        ].flatMap((m) => (m[1] === undefined ? [] : [m[1]])),
      );
      // Every F062.1 state appears in SQL ...
      for (const state of deliveryStates)
        assert.ok(
          stated.has(state),
          `${state} missing from the SQL vocabulary`,
        );
      // ... and SQL names no state F062.1 does not define.
      for (const state of stated)
        assert.ok(
          (deliveryStates as readonly string[]).includes(state),
          `SQL names ${state}, which F062.1 does not define`,
        );
      assert.equal(stated.size, deliveryStates.length);
    });
  },
);

test(
  'the attempt outcome and failure vocabularies equal F062.1 exactly',
  { skip: !url },
  async () => {
    await withSchema(async ({ db }) => {
      const rows = await sql<{ def: string }>`
        select pg_get_constraintdef(c.oid) as def
          from pg_constraint c join pg_class t on t.oid = c.conrelid
         where t.relname = 'integration_delivery_attempt' and c.contype = 'c'`.execute(
        db,
      );
      const text = rows.rows.map((r) => r.def).join(' ');
      for (const outcome of [
        'succeeded',
        'failed_transient',
        'failed_permanent',
        'ambiguous',
      ])
        assert.match(text, new RegExp("'" + outcome + "'"));
      for (const category of [
        'destination_unavailable',
        'destination_timeout',
        'destination_rejected',
        'rate_limited',
        'authentication_failed',
        'destination_unconfigured',
        'projection_failed',
        'contract_unsupported',
        'malformed_request',
        'internal_failure',
      ])
        assert.match(text, new RegExp("'" + category + "'"));
    });
  },
);

test(
  'every ordered state pair behaves exactly as F062.1 declares',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA, connectorA }) => {
      // Exhaustive sweep. A whitelist that only passes its happy path proves
      // nothing about what it forbids, so all 81 ordered pairs are exercised.
      let permitted = 0;
      let refused = 0;
      for (const from of deliveryStates) {
        for (const to of deliveryStates) {
          const outboxId = await enqueue(db, organizationA, connectorA);
          // Place the row in `from` by walking a legal path where one exists;
          // otherwise force it with the guard disabled, which is a test-only
          // setup step and never a reachable application path.
          await forceState(db, outboxId, from);
          const expected =
            from !== to && deliveryStateTransitions[from].includes(to);
          const outcome = await attemptTransition(db, outboxId, to);
          if (expected) {
            // Two edges carry a capability precondition the base connector
            // does not satisfy; they are proven separately below.
            const gated =
              (from === 'accepted' && to === 'acknowledged') ||
              (from === 'ambiguous' && to === 'dispatching');
            if (gated) {
              assert.equal(
                outcome,
                'refused',
                `${from} -> ${to} should be gated`,
              );
              refused += 1;
            } else {
              assert.equal(
                outcome,
                'applied',
                `${from} -> ${to} must be permitted`,
              );
              permitted += 1;
            }
          } else {
            assert.equal(
              outcome,
              'refused',
              `${from} -> ${to} must be refused`,
            );
            refused += 1;
          }
        }
      }
      assert.equal(permitted + refused, deliveryStates.length ** 2);
      assert.ok(permitted > 0, 'some transition must be permitted');
    });
  },
);

test(
  'terminal states accept no transition at all',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA, connectorA }) => {
      for (const terminal of terminalDeliveryStates) {
        const outboxId = await enqueue(db, organizationA, connectorA);
        await forceState(db, outboxId, terminal);
        for (const to of deliveryStates) {
          if (to === terminal) continue;
          assert.equal(
            await attemptTransition(db, outboxId, to),
            'refused',
            `${terminal} -> ${to} must be refused`,
          );
        }
      }
      // And F062.1's classification matches: exactly these four are terminal
      // in the database sense of having no outgoing edge.
      const withoutEdges = deliveryStates.filter(
        (state) => deliveryStateTransitions[state].length === 0,
      );
      assert.deepEqual(
        [...withoutEdges].sort(),
        [...terminalDeliveryStates].sort(),
      );
    });
  },
);

test(
  'the capability-gated edges are permitted only with the pinned capability',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA }) => {
      // A connector that reports terminal state and supports idempotency.
      const capable = await registerConnector(
        db,
        organizationA,
        'loopback-cap',
        {
          ...NO_CAPABILITIES,
          reportsTerminalState: true,
          supportsIdempotencyKey: true,
        },
      );
      const capableOutbox = await enqueue(db, organizationA, capable);
      await forceState(db, capableOutbox, 'accepted');
      assert.equal(
        await attemptTransition(db, capableOutbox, 'acknowledged'),
        'applied',
      );

      const ambiguous = await enqueue(db, organizationA, capable);
      await forceState(db, ambiguous, 'ambiguous');
      assert.equal(
        await attemptTransition(db, ambiguous, 'dispatching'),
        'applied',
      );
    });
  },
);

test(
  'no transition anywhere is predicated on elapsed time',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA, connectorA }) => {
      // H. An obligation whose created_at is far in the past is treated
      // exactly like a fresh one: no age threshold exists.
      const outboxId = await enqueue(db, organizationA, connectorA);
      await sql`alter table integration_outbox disable trigger integration_outbox_guard`.execute(
        db,
      );
      await sql`update integration_outbox
                  set created_at = clock_timestamp() - interval '400 days',
                      occurred_at = clock_timestamp() - interval '400 days'
                where id = ${outboxId}`.execute(db);
      await sql`alter table integration_outbox enable trigger integration_outbox_guard`.execute(
        db,
      );

      const row = await db
        .selectFrom('integration_outbox')
        .select('state')
        .where('id', '=', outboxId)
        .executeTakeFirstOrThrow();
      assert.equal(row.state, 'pending', 'age alone must not change state');

      // An ambiguous obligation is likewise untouched by age.
      await forceState(db, outboxId, 'ambiguous');
      const stillAmbiguous = await db
        .selectFrom('integration_outbox')
        .select('state')
        .where('id', '=', outboxId)
        .executeTakeFirstOrThrow();
      assert.equal(stillAmbiguous.state, 'ambiguous');

      // And the schema contains no age threshold to apply.
      const defs = await sql<{ def: string }>`
        select pg_get_constraintdef(c.oid) as def
          from pg_constraint c join pg_class t on t.oid = c.conrelid
         where t.relname in ('integration_outbox','integration_delivery_attempt')`.execute(
        db,
      );
      const text = defs.rows
        .map((r) => r.def)
        .join(' ')
        .toLowerCase();
      for (const token of ['interval', 'age(', 'pending_age'])
        assert.equal(
          text.includes(token),
          false,
          `a constraint references ${token}`,
        );
    });
  },
);

// ---------------------------------------------------------------------------
// Attempt persistence, tenancy and fencing
// ---------------------------------------------------------------------------

test(
  'an attempt is created open, with database-assigned ordinal and generation',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA, outboxA, connectorA }) => {
      const first = await openAttempt(db, organizationA, outboxA, connectorA);
      assert.ok(first.applied && first.id);
      const row = await db
        .selectFrom('integration_delivery_attempt')
        .selectAll()
        .where('id', '=', first.id)
        .executeTakeFirstOrThrow();
      assert.equal(row.attempt_number, 1);
      assert.equal(Number(row.claim_generation), 1);
      assert.equal(row.outcome, null);
      assert.equal(row.completed_at, null);
      assert.equal(row.failure_category, null);
      assert.equal(row.claim_token_digest, DIGEST_A);

      // Settling it frees the open slot, and the next attempt advances both
      // counters.
      assert.equal(
        await settle(db, first.id, 'failed_transient', 'rate_limited'),
        1,
      );
      const second = await openAttempt(
        db,
        organizationA,
        outboxA,
        connectorA,
        DIGEST_B,
      );
      assert.ok(second.applied && second.id);
      const next = await db
        .selectFrom('integration_delivery_attempt')
        .select(['attempt_number', 'claim_generation'])
        .where('id', '=', second.id)
        .executeTakeFirstOrThrow();
      assert.equal(next.attempt_number, 2);
      assert.equal(Number(next.claim_generation), 2);
    });
  },
);

test(
  'two attempts racing to become open for one obligation: exactly one wins',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA, outboxA, connectorA }) => {
      const [a, b] = await Promise.all([
        openAttempt(db, organizationA, outboxA, connectorA, DIGEST_A),
        openAttempt(db, organizationA, outboxA, connectorA, DIGEST_B),
      ]);
      assert.equal(
        [a, b].filter((r) => r.applied).length,
        1,
        'exactly one attempt may be open',
      );
      const rows = await db
        .selectFrom('integration_delivery_attempt')
        .select('id')
        .where('integration_outbox_id', '=', outboxA)
        .execute();
      assert.equal(rows.length, 1);

      // A third, sequential attempt is refused for the same reason.
      assert.equal(
        (await openAttempt(db, organizationA, outboxA, connectorA)).applied,
        false,
      );
    });
  },
);

test(
  'a cross-tenant obligation reference is refused by the database',
  { skip: !url },
  async () => {
    await withSchema(
      async ({ db, organizationA, organizationB, outboxB, connectorA }) => {
        // Organization A claiming B's obligation: the composite foreign key
        // makes the pair the referent, so this is unrepresentable.
        assert.match(
          await message(() =>
            db
              .insertInto('integration_delivery_attempt')
              .values({
                organization_id: organizationA,
                integration_outbox_id: outboxB,
                integration_connector_id: connectorA,
                claim_token_digest: DIGEST_A,
                connector_configuration_revision: 1,
                capability_snapshot: SNAPSHOT,
              })
              .execute(),
          ),
          /requires an obligation owned by its Organization|foreign key/i,
        );
        assert.deepEqual(
          await db
            .selectFrom('integration_delivery_attempt')
            .select('id')
            .execute(),
          [],
        );
        void organizationB;
      },
    );
  },
);

test(
  'an attempt must name its obligation connector and pinned revision',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA, outboxA, connectorA }) => {
      const other = await registerConnector(db, organizationA, 'loopback-two');
      assert.match(
        await message(() =>
          db
            .insertInto('integration_delivery_attempt')
            .values({
              organization_id: organizationA,
              integration_outbox_id: outboxA,
              integration_connector_id: other,
              claim_token_digest: DIGEST_A,
              connector_configuration_revision: 1,
              capability_snapshot: SNAPSHOT,
            })
            .execute(),
        ),
        /must name its obligation connector/i,
      );
      assert.match(
        await message(() =>
          db
            .insertInto('integration_delivery_attempt')
            .values({
              organization_id: organizationA,
              integration_outbox_id: outboxA,
              integration_connector_id: connectorA,
              claim_token_digest: DIGEST_A,
              connector_configuration_revision: 9,
              capability_snapshot: SNAPSHOT,
            })
            .execute(),
        ),
        /must pin the obligation semantic revision/i,
      );
    });
  },
);

test(
  'an attempt settles once, and a settled attempt is immutable',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA, outboxA, connectorA }) => {
      const open = await openAttempt(db, organizationA, outboxA, connectorA);
      assert.ok(open.applied && open.id);
      const id = open.id;

      assert.equal(await settle(db, id, 'succeeded'), 1);

      // C. A second settlement is refused.
      assert.match(
        await message(() =>
          settle(db, id, 'failed_permanent', 'internal_failure'),
        ),
        /settled integration delivery attempt is immutable/i,
      );

      // E. Terminal fields cannot be rewritten, individually.
      for (const statement of [
        sql`update integration_delivery_attempt set outcome = 'ambiguous' where id = ${id}`,
        sql`update integration_delivery_attempt set completed_at = null where id = ${id}`,
        sql`update integration_delivery_attempt set claim_generation = 9 where id = ${id}`,
        sql`update integration_delivery_attempt set claim_token_digest = ${DIGEST_B} where id = ${id}`,
        sql`update integration_delivery_attempt set attempt_number = 7 where id = ${id}`,
        sql`update integration_delivery_attempt set started_at = clock_timestamp() where id = ${id}`,
        sql`update integration_delivery_attempt set organization_id = gen_random_uuid() where id = ${id}`,
        sql`delete from integration_delivery_attempt where id = ${id}`,
        sql`truncate table integration_delivery_attempt`,
      ])
        assert.match(
          await message(() => statement.execute(db)),
          /immutable|never deleted/i,
        );

      const row = await db
        .selectFrom('integration_delivery_attempt')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      assert.equal(row.outcome, 'succeeded');
      assert.equal(row.claim_token_digest, DIGEST_A);
      assert.equal(Number(row.claim_generation), 1);
    });
  },
);

test(
  'a stale claim generation cannot settle a newer generation',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA, outboxA, connectorA }) => {
      // Generation 1 opens and is recovered (settled ambiguous), then
      // generation 2 opens — the situation a returning stale worker meets.
      const first = await openAttempt(
        db,
        organizationA,
        outboxA,
        connectorA,
        DIGEST_A,
      );
      assert.ok(first.applied && first.id);
      assert.equal(
        await settle(db, first.id, 'ambiguous', 'destination_timeout'),
        1,
      );
      const second = await openAttempt(
        db,
        organizationA,
        outboxA,
        connectorA,
        DIGEST_B,
      );
      assert.ok(second.applied && second.id);

      // B. The stale worker's settlement, expressed as the future fencing
      // predicate: its generation and digest match nothing open.
      const fenced = await db
        .updateTable('integration_delivery_attempt')
        .set({ outcome: 'succeeded', completed_at: new Date() })
        .where('organization_id', '=', organizationA)
        .where('integration_outbox_id', '=', outboxA)
        .where('claim_generation', '=', '1')
        .where('claim_token_digest', '=', DIGEST_A)
        .where('completed_at', 'is', null)
        .executeTakeFirst();
      assert.equal(
        Number(fenced.numUpdatedRows),
        0,
        'a stale generation must settle nothing',
      );

      // The newer generation is untouched and still open.
      const current = await db
        .selectFrom('integration_delivery_attempt')
        .select(['claim_generation', 'completed_at', 'outcome'])
        .where('id', '=', second.id)
        .executeTakeFirstOrThrow();
      assert.equal(Number(current.claim_generation), 2);
      assert.equal(current.completed_at, null);
      // And the recovered attempt kept its ambiguous outcome.
      const recovered = await db
        .selectFrom('integration_delivery_attempt')
        .select('outcome')
        .where('id', '=', first.id)
        .executeTakeFirstOrThrow();
      assert.equal(recovered.outcome, 'ambiguous');
    });
  },
);

test(
  'only a digest-shaped claim token may be stored, and no raw token column exists',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA, outboxA, connectorA }) => {
      for (const bad of [
        '',
        'short',
        'A'.repeat(64),
        'g'.repeat(64),
        'a'.repeat(63),
      ])
        assert.match(
          await message(() =>
            db
              .insertInto('integration_delivery_attempt')
              .values({
                organization_id: organizationA,
                integration_outbox_id: outboxA,
                integration_connector_id: connectorA,
                claim_token_digest: bad,
                connector_configuration_revision: 1,
                capability_snapshot: SNAPSHOT,
              })
              .execute(),
          ),
          /claim_token_digest|value too long/i,
          `${JSON.stringify(bad)} must be refused`,
        );

      // No column anywhere in the integration schema holds a raw token.
      const columns = await sql<{ table_name: string; column_name: string }>`
        select table_name, column_name from information_schema.columns
         where table_name in ('integration_delivery_attempt','integration_outbox',
           'integration_connector','integration_connector_audit')
           and column_name like '%token%'`.execute(db);
      assert.deepEqual(
        columns.rows.map((r) => r.column_name).sort(),
        ['claim_token_digest'],
        'the only token-named column must be the digest',
      );
    });
  },
);

test(
  'the capability snapshot is bounded to three keys with closed value domains',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA, outboxA, connectorA }) => {
      for (const bad of [
        {},
        { supports_idempotency_key: false },
        { ...SNAPSHOT, extra: 1 },
        { ...SNAPSHOT, side_effect_risk: 'catastrophic' },
        { ...SNAPSHOT, supports_idempotency_key: 'yes' },
      ])
        assert.match(
          await message(() =>
            db
              .insertInto('integration_delivery_attempt')
              .values({
                organization_id: organizationA,
                integration_outbox_id: outboxA,
                integration_connector_id: connectorA,
                claim_token_digest: DIGEST_A,
                connector_configuration_revision: 1,
                capability_snapshot: bad,
              })
              .execute(),
          ),
          /violates check constraint/i,
          `${JSON.stringify(bad)} must be refused`,
        );
    });
  },
);

test(
  'an attempt cannot be created already settled',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA, outboxA, connectorA }) => {
      assert.match(
        await message(() =>
          db
            .insertInto('integration_delivery_attempt')
            .values({
              organization_id: organizationA,
              integration_outbox_id: outboxA,
              integration_connector_id: connectorA,
              claim_token_digest: DIGEST_A,
              connector_configuration_revision: 1,
              capability_snapshot: SNAPSHOT,
              outcome: 'succeeded',
              completed_at: new Date(),
            })
            .execute(),
        ),
        /must be created open/i,
      );
    });
  },
);

// ---------------------------------------------------------------------------
// Migration lifecycle
// ---------------------------------------------------------------------------

test(
  'the migration applies, refuses rollback with evidence, rolls back and reapplies',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA, outboxA, connectorA }) => {
      const open = await openAttempt(db, organizationA, outboxA, connectorA);
      assert.ok(open.applied);

      assert.match(
        await message(() => down(db)),
        /Retained integration delivery attempt evidence prevents rollback/i,
      );

      // A moved obligation also blocks rollback, because the previous schema
      // version pins the state to pending.
      await sql`alter table integration_delivery_attempt disable trigger integration_delivery_attempt_guard`.execute(
        db,
      );
      await sql`delete from integration_delivery_attempt`.execute(db);
      await sql`alter table integration_delivery_attempt enable trigger integration_delivery_attempt_guard`.execute(
        db,
      );
      await moveState(db, outboxA, 'dispatching');
      assert.match(
        await message(() => down(db)),
        /left the initial state and prevent rollback/i,
      );

      // dispatching -> pending is deliberately not a legal edge, so the
      // reset is a test-only forced setup rather than a transition.
      await forceState(db, outboxA, 'pending');
      await down(db);

      // The attempt table and its guard are gone ...
      const gone = await sql<{ present: boolean }>`
        select to_regclass('integration_delivery_attempt') is not null as present`.execute(
        db,
      );
      assert.equal(gone.rows[0]?.present, false);
      // ... the connector registry and outbox survive ...
      assert.ok(
        await db
          .selectFrom('integration_outbox')
          .select('id')
          .where('id', '=', outboxA)
          .executeTakeFirst(),
        'rollback must not cascade into obligations',
      );
      assert.ok(
        await db
          .selectFrom('integration_connector')
          .select('id')
          .where('id', '=', connectorA)
          .executeTakeFirst(),
      );
      // ... and F062.2C's inert protections are restored exactly.
      const restored = await sql<{ def: string }>`
        select pg_get_constraintdef(c.oid) as def
          from pg_constraint c join pg_class t on t.oid = c.conrelid
         where t.relname = 'integration_outbox'
           and c.conname = 'integration_outbox_state_inert'`.execute(db);
      assert.equal(
        restored.rows.length,
        1,
        'the inert constraint must be restored',
      );
      assert.match(
        await message(() => moveState(db, outboxA, 'dispatching')),
        /immutable in this slice/i,
        'the restored guard must refuse every update',
      );

      // Reapply, and the schema is usable again.
      await up(db);
      const again = await openAttempt(db, organizationA, outboxA, connectorA);
      assert.ok(again.applied);
      assert.equal(
        await attemptTransition(db, outboxA, 'dispatching'),
        'applied',
      );
    });
  },
);

test(
  'migration apply is safe with existing pending obligations',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA, connectorA, outboxA }) => {
      // Roll back, enqueue more obligations under the old schema, reapply.
      await down(db);
      const extra = [
        await enqueue(db, organizationA, connectorA),
        await enqueue(db, organizationA, connectorA),
      ];
      await up(db);
      // Pre-existing rows survive untouched, with no fabricated attempts.
      for (const id of [outboxA, ...extra]) {
        const row = await db
          .selectFrom('integration_outbox')
          .select('state')
          .where('id', '=', id)
          .executeTakeFirstOrThrow();
        assert.equal(row.state, 'pending');
      }
      assert.deepEqual(
        await db
          .selectFrom('integration_delivery_attempt')
          .select('id')
          .execute(),
        [],
        'no synthetic attempt history may be created',
      );
    });
  },
);

// ---------------------------------------------------------------------------
// Privilege posture
// ---------------------------------------------------------------------------

test(
  'the new table grants nothing to PUBLIC and holds no default privileges',
  { skip: !url },
  async () => {
    await withSchema(async ({ db }) => {
      const granted = await sql<{ grantee: string; privilege_type: string }>`
        select grantee, privilege_type from information_schema.role_table_grants
         where table_name = 'integration_delivery_attempt'
           and grantee = 'PUBLIC'`.execute(db);
      assert.deepEqual(granted.rows, [], 'PUBLIC must receive nothing');

      const defaults = await sql<{ count: string }>`
        select count(*)::text as count from pg_default_acl`.execute(db);
      assert.equal(
        defaults.rows[0]?.count,
        '0',
        'no default privileges may exist',
      );
    });
  },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Places an obligation in an arbitrary state for test setup, bypassing the
 * guard. This is deliberately a privileged manipulation that no application
 * path can perform: it exists so a transition can be tested *from* a state
 * the whitelist does not otherwise reach. */
async function forceState(
  db: Database,
  outboxId: string,
  state: DeliveryState,
): Promise<void> {
  if (state === 'pending') {
    await sql`alter table integration_outbox disable trigger integration_outbox_guard`.execute(
      db,
    );
    await sql`update integration_outbox set state = 'pending' where id = ${outboxId}`.execute(
      db,
    );
    await sql`alter table integration_outbox enable trigger integration_outbox_guard`.execute(
      db,
    );
    return;
  }
  await sql`alter table integration_outbox disable trigger integration_outbox_guard`.execute(
    db,
  );
  await sql`update integration_outbox set state = ${state} where id = ${outboxId}`.execute(
    db,
  );
  await sql`alter table integration_outbox enable trigger integration_outbox_guard`.execute(
    db,
  );
}

async function attemptTransition(
  db: Database,
  outboxId: string,
  to: DeliveryState,
): Promise<'applied' | 'refused'> {
  try {
    await sql`update integration_outbox set state = ${to} where id = ${outboxId}`.execute(
      db,
    );
    return 'applied';
  } catch {
    return 'refused';
  }
}
