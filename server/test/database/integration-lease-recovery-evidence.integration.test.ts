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
import {
  down,
  up,
} from '../../migrations/20261024000000-add-integration-lease-recovery-evidence.js';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import { integrationAttemptReasonCodes } from '../../src/integration/delivery-contract.js';
import { NO_CAPABILITIES } from '../../src/integration/connector-capabilities.js';
import { toCapabilityColumns } from '../../src/integration/persistence/connector-metadata.js';
import { enqueueIntegrationIntent } from '../../src/integration/persistence/outbox.repository.js';
import type { EnqueueIntentInput } from '../../src/integration/persistence/outbox.js';

/**
 * F062.2D-2C-1 — claim lease, dispatch boundary and recovery-reason
 * persistence, proven against PostgreSQL.
 *
 * Every assertion is a database property, and every one is deterministic:
 * **no sleeps anywhere.** Where an expired lease or a past boundary is
 * needed, the timestamp is constructed directly rather than waited for.
 *
 * No recovery function, no dispatch function and no worker exists. The
 * database is driven exactly as a future function would drive it, so what is
 * proven here is the integrity of the evidence rather than the behaviour of
 * any caller.
 */

const url = process.env.TEST_DATABASE_URL;
type Database = Kysely<DatabaseSchema>;

const DIGEST = 'a'.repeat(64);
const SNAPSHOT = {
  supports_idempotency_key: false,
  supports_read_after_write: false,
  side_effect_risk: 'irreversible',
};
const GUARD = 'integration_delivery_attempt_guard';

interface Fixture {
  readonly db: Database;
  readonly organizationId: string;
  readonly connectorId: string;
  readonly outboxId: string;
  /** A second pending obligation, for tests needing an independent attempt. */
  newObligation: () => Promise<string>;
}

/** Builds a disposable schema carrying Migrations 1, 50, 51, 52 and 54.
 *
 * Migration 53's function API is deliberately absent: this slice changes no
 * function, and the settlement paths exercised here are the direct table
 * writes a future function would perform. */
async function withSchema(
  run: (fixture: Fixture) => Promise<void>,
  options: { readonly applyLeaseMigration?: boolean } = {},
): Promise<void> {
  const schema = 'integration_lease_' + randomUUID().replaceAll('-', '');
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
    if (options.applyLeaseMigration !== false) await up(db);
    const organizationId = randomUUID();
    await db
      .insertInto('organization')
      .values({
        id: organizationId,
        name: 'F062.2D-2C-1 Synthetic',
        short_name: 'Test',
        slug: 'f0622d2c1-' + organizationId,
        status: 'active',
        default_business_timezone: 'America/New_York',
      })
      .execute();
    const connectorId = await registerConnector(db, organizationId);
    await run({
      db,
      organizationId,
      connectorId,
      outboxId: await enqueue(db, organizationId, connectorId),
      newObligation: () => enqueue(db, organizationId, connectorId),
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
): Promise<string> {
  return db.transaction().execute(async (trx) => {
    const created = await trx
      .insertInto('integration_connector')
      .values({
        organization_id: organizationId,
        connector_key: 'loopback-one',
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

/** Runs an operation expected to be refused and returns the message. */
async function message(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected the operation to be refused');
}

/** Columns this slice adds, as a caller may try to supply them at insert.
 *
 * Kept explicit rather than a loose record so the pre-migration fixture can
 * open an attempt without naming columns that do not exist yet. */
interface AttemptExtras {
  readonly reasonCode?: string;
  readonly failureCategory?: string;
  readonly dispatchStartedAt?: string | Date;
  readonly claimExpiresAt?: string | Date;
}

/** Opens an attempt the way a future claim would. */
async function openAttempt(
  fixture: Fixture,
  outboxId: string,
  extras?: AttemptExtras,
): Promise<string> {
  if (extras === undefined) {
    // The base shape, valid both before and after this migration.
    const base = await sql<{ id: string }>`
      insert into integration_delivery_attempt (
        organization_id, integration_outbox_id, integration_connector_id,
        claim_token_digest, connector_configuration_revision,
        capability_snapshot
      ) values (
        ${fixture.organizationId}, ${outboxId}, ${fixture.connectorId},
        ${DIGEST}, 1, ${JSON.stringify(SNAPSHOT)}::jsonb
      ) returning id`.execute(fixture.db);
    return base.rows[0]?.id ?? '';
  }
  const row = await sql<{ id: string }>`
    insert into integration_delivery_attempt (
      organization_id, integration_outbox_id, integration_connector_id,
      claim_token_digest, connector_configuration_revision,
      capability_snapshot, reason_code, failure_category,
      dispatch_started_at, claim_expires_at
    ) values (
      ${fixture.organizationId}, ${outboxId}, ${fixture.connectorId},
      ${DIGEST}, 1, ${JSON.stringify(SNAPSHOT)}::jsonb,
      ${extras.reasonCode ?? null},
      ${extras.failureCategory ?? null},
      ${extras.dispatchStartedAt ?? null},
      ${extras.claimExpiresAt ?? null}
    ) returning id`.execute(fixture.db);
  return row.rows[0]?.id ?? '';
}

/** Moves the obligation so a settlement is legal under the F062.2D-2A guard. */
async function toDispatching(db: Database, outboxId: string): Promise<void> {
  await sql`update integration_outbox set state = 'dispatching'
            where id = ${outboxId}`.execute(db);
}

/** Records the dispatch boundary the way a future marker function would: the
 * caller signals the transition, the database authors the value. */
async function markDispatch(
  db: Database,
  attemptId: string,
  signalled: string | Date = new Date(),
): Promise<void> {
  await sql`update integration_delivery_attempt
            set dispatch_started_at = ${signalled}
            where id = ${attemptId}`.execute(db);
}

/** Settles an attempt in the pre-F062.2D-2C-1 shape, naming no column this
 * migration adds. Used by the existing-row compatibility fixture, which runs
 * before the migration is applied. */
async function settleLegacy(
  db: Database,
  attemptId: string,
  outcome: string,
  failureCategory: string | null,
): Promise<void> {
  await sql`update integration_delivery_attempt
            set outcome = ${outcome},
                completed_at = clock_timestamp(),
                failure_category = ${failureCategory}
            where id = ${attemptId}`.execute(db);
}

async function settle(
  db: Database,
  attemptId: string,
  outcome: string,
  failureCategory: string | null,
  reasonCode: string | null = null,
): Promise<void> {
  await sql`update integration_delivery_attempt
            set outcome = ${outcome},
                completed_at = clock_timestamp(),
                failure_category = ${failureCategory},
                reason_code = ${reasonCode}
            where id = ${attemptId}`.execute(db);
}

/** Privileged direct construction, bypassing the guard.
 *
 * This is the only way to build an already-expired lease without sleeping,
 * and the only way to simulate evidence a future function would write. It is
 * explicitly NOT a capability any role holds in deployment: the guard is
 * re-enabled before the assertion under test runs. */
async function withGuardDisabled(
  db: Database,
  run: () => Promise<void>,
): Promise<void> {
  await sql
    .raw(`alter table integration_delivery_attempt disable trigger ${GUARD}`)
    .execute(db);
  try {
    await run();
  } finally {
    await sql
      .raw(`alter table integration_delivery_attempt enable trigger ${GUARD}`)
      .execute(db);
  }
}

/** An open attempt whose lease has already expired, constructed directly. */
async function openExpiredAttempt(
  fixture: Fixture,
  outboxId: string,
  options: { readonly dispatched?: boolean } = {},
): Promise<string> {
  const id = randomUUID();
  await withGuardDisabled(fixture.db, async () => {
    await sql`
      insert into integration_delivery_attempt (
        id, organization_id, integration_outbox_id, integration_connector_id,
        attempt_number, claim_generation, claim_token_digest,
        connector_configuration_revision, capability_snapshot,
        started_at, claim_expires_at, dispatch_started_at
      ) values (
        ${id}, ${fixture.organizationId}, ${outboxId}, ${fixture.connectorId},
        1, 1, ${DIGEST}, 1, ${JSON.stringify(SNAPSHOT)}::jsonb,
        clock_timestamp() - interval '1 hour',
        clock_timestamp() - interval '30 minutes',
        ${options.dispatched === true ? sql`clock_timestamp() - interval '45 minutes'` : sql`null`}
      )`.execute(fixture.db);
  });
  return id;
}

test(
  'F062.2D-2C-1 claim lease, dispatch boundary and recovery-reason evidence',
  {
    skip:
      url === undefined &&
      'TEST_DATABASE_URL is not set; the lease evidence proof is skipped',
  },
  async (t) => {
    // -----------------------------------------------------------------
    // Schema shape
    // -----------------------------------------------------------------

    await t.test(
      'the three columns are nullable timestamps and a bounded varchar, with no defaults',
      async () => {
        await withSchema(async ({ db }) => {
          const columns = await sql<{
            column_name: string;
            data_type: string;
            is_nullable: string;
            column_default: string | null;
            character_maximum_length: number | null;
          }>`
            select column_name, data_type, is_nullable, column_default,
                   character_maximum_length
            from information_schema.columns
            where table_schema = current_schema()
              and table_name = 'integration_delivery_attempt'
              and column_name in
                ('claim_expires_at', 'dispatch_started_at', 'reason_code')
            order by column_name`.execute(db);
          assert.deepEqual(columns.rows, [
            {
              column_name: 'claim_expires_at',
              data_type: 'timestamp with time zone',
              is_nullable: 'YES',
              column_default: null,
              character_maximum_length: null,
            },
            {
              column_name: 'dispatch_started_at',
              data_type: 'timestamp with time zone',
              is_nullable: 'YES',
              column_default: null,
              character_maximum_length: null,
            },
            {
              column_name: 'reason_code',
              data_type: 'character varying',
              is_nullable: 'YES',
              column_default: null,
              character_maximum_length: 40,
            },
          ]);
          // No lease duration is encoded anywhere: no default, and no
          // interval literal in any constraint on the table.
          const definitions = await sql<{ definition: string }>`
            select pg_get_constraintdef(c.oid) as definition
            from pg_constraint c
            where c.conrelid = 'integration_delivery_attempt'::regclass`.execute(
            db,
          );
          for (const row of definitions.rows)
            assert.equal(
              /interval/i.test(row.definition),
              false,
              `a constraint encodes an interval: ${row.definition}`,
            );
        });
      },
    );

    await t.test(
      'reason_code admits exactly the two authorized values and refuses anything else',
      async () => {
        await withSchema(async (fixture) => {
          const { db } = fixture;
          const definition = await sql<{ definition: string }>`
            select pg_get_constraintdef(c.oid) as definition
            from pg_constraint c
            where c.conrelid = 'integration_delivery_attempt'::regclass
              and c.conname = 'integration_attempt_reason_code_vocabulary'`.execute(
            db,
          );
          const text = definition.rows[0]?.definition ?? '';
          // Set equality in both directions against the TypeScript source.
          const inSql = [...text.matchAll(/'([a-z_]+)'::/g)].map(
            (match) => match[1] ?? '',
          );
          assert.deepEqual(
            [...inSql].sort(),
            [...integrationAttemptReasonCodes].sort(),
          );

          const attempt = await openAttempt(fixture, fixture.outboxId);
          await toDispatching(db, fixture.outboxId);
          for (const forged of [
            'fenced_stale_completion',
            'internal_failure',
            'lease_expired',
            'LEASE_EXPIRED_PRE_DISPATCH',
            'anything at all',
            '',
          ]) {
            const refusal = await message(() =>
              settle(db, attempt, 'failed_transient', null, forged),
            );
            assert.match(
              refusal,
              /integration_attempt_reason_code_vocabulary/,
              `${forged} was not refused by the vocabulary constraint`,
            );
          }
        });
      },
    );

    await t.test(
      'the recovery-scan index is partial on open attempts carrying a lease',
      async () => {
        await withSchema(async ({ db }) => {
          const index = await sql<{ indexdef: string }>`
            select indexdef from pg_indexes
            where schemaname = current_schema()
              and tablename = 'integration_delivery_attempt'
              and indexname = 'integration_attempt_lease_expiry'`.execute(db);
          const definition = index.rows[0]?.indexdef ?? '';
          assert.match(definition, /\(organization_id, claim_expires_at\)/);
          assert.match(definition, /WHERE \(\(completed_at IS NULL\)/);
          assert.match(definition, /claim_expires_at IS NOT NULL/);
          assert.equal(/UNIQUE/i.test(definition), false);

          // Exactly one index was added by this migration, and it is the
          // only one that mentions the lease at all. The two unique-constraint
          // index names are auto-generated and truncated to 63 characters, so
          // they depend on the disposable schema's name and are counted rather
          // than spelled.
          const all = await sql<{ indexname: string; indexdef: string }>`
            select indexname, indexdef from pg_indexes
            where schemaname = current_schema()
              and tablename = 'integration_delivery_attempt'
            order by indexname`.execute(db);
          assert.equal(all.rows.length, 6);
          assert.deepEqual(
            all.rows
              .filter((row) => row.indexdef.includes('claim_expires_at'))
              .map((row) => row.indexname),
            ['integration_attempt_lease_expiry'],
          );
          for (const expected of [
            'integration_attempt_lease_expiry',
            'integration_attempt_obligation',
            'integration_attempt_open',
            'integration_delivery_attempt_pkey',
          ])
            assert.ok(
              all.rows.some((row) => row.indexname === expected),
              `${expected} is missing`,
            );
        });
      },
    );

    await t.test(
      'the attempt guard is extended and the outbox guard is untouched',
      async () => {
        await withSchema(async ({ db }) => {
          const triggers = await sql<{ tgname: string; tgenabled: string }>`
            select t.tgname, t.tgenabled
            from pg_trigger t
            where t.tgrelid = 'integration_delivery_attempt'::regclass
              and not t.tgisinternal
            order by t.tgname`.execute(db);
          assert.deepEqual(triggers.rows, [
            { tgname: GUARD, tgenabled: 'O' },
            {
              tgname: 'integration_delivery_attempt_no_truncate',
              tgenabled: 'O',
            },
          ]);

          const bodies = await sql<{ name: string; body: string }>`
            select p.proname as name, pg_get_functiondef(p.oid) as body
            from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = current_schema()
              and p.proname in ('guard_integration_delivery_attempt',
                                'guard_integration_outbox')
            order by p.proname`.execute(db);
          const attemptGuard =
            bodies.rows.find(
              (row) => row.name === 'guard_integration_delivery_attempt',
            )?.body ?? '';
          const outboxGuard =
            bodies.rows.find((row) => row.name === 'guard_integration_outbox')
              ?.body ?? '';
          // Extended, not replaced: the original protections are still there.
          for (const preserved of [
            'are evidence and are never deleted',
            'must be created open',
            'A settled integration delivery attempt is immutable',
            'may only be updated to settle it',
            'claim identity is immutable',
          ])
            assert.ok(
              attemptGuard.includes(preserved),
              `the attempt guard lost: ${preserved}`,
            );
          for (const added of [
            'claim lease is immutable',
            'dispatch boundary is write-once',
            'dispatch boundary must be recorded before settlement',
          ])
            assert.ok(
              attemptGuard.includes(added),
              `the attempt guard is missing: ${added}`,
            );
          // The outbox guard is not this slice's business.
          assert.equal(outboxGuard.includes('dispatch_started_at'), false);
          assert.equal(outboxGuard.includes('reason_code'), false);
          assert.equal(outboxGuard.includes('claim_expires_at'), false);
        });
      },
    );

    // -----------------------------------------------------------------
    // Existing-row compatibility
    // -----------------------------------------------------------------

    await t.test(
      'attempt evidence written before the migration survives it and still validates',
      async () => {
        await withSchema(
          async (fixture) => {
            const { db } = fixture;
            // Settle two attempts in the pre-migration shapes: a success and
            // an adapter-derived failure.
            const first = await openAttempt(fixture, fixture.outboxId);
            await toDispatching(db, fixture.outboxId);
            await settleLegacy(db, first, 'succeeded', null);
            await sql`update integration_outbox set state = 'accepted'
                      where id = ${fixture.outboxId}`.execute(db);

            const secondObligation = await fixture.newObligation();
            const second = await openAttempt(fixture, secondObligation);
            await toDispatching(db, secondObligation);
            await settleLegacy(
              db,
              second,
              'failed_permanent',
              'destination_rejected',
            );

            // Apply Migration 54 over that existing evidence.
            await up(db);

            const rows = await sql<{
              id: string;
              outcome: string;
              failure_category: string | null;
              claim_expires_at: Date | null;
              dispatch_started_at: Date | null;
              reason_code: string | null;
            }>`
              select id, outcome, failure_category, claim_expires_at,
                     dispatch_started_at, reason_code
              from integration_delivery_attempt order by attempt_number`.execute(
              db,
            );
            // One exact assertion over both rows: the pre-migration
            // evidence is unchanged and no history was fabricated.
            assert.deepEqual(
              rows.rows.map((row) => ({
                outcome: row.outcome,
                failure_category: row.failure_category,
                claim_expires_at: row.claim_expires_at,
                dispatch_started_at: row.dispatch_started_at,
                reason_code: row.reason_code,
              })),
              [
                {
                  outcome: 'succeeded',
                  failure_category: null,
                  claim_expires_at: null,
                  dispatch_started_at: null,
                  reason_code: null,
                },
                {
                  outcome: 'failed_permanent',
                  failure_category: 'destination_rejected',
                  claim_expires_at: null,
                  dispatch_started_at: null,
                  reason_code: null,
                },
              ],
            );

            // And the constraints genuinely validate those rows: a forced
            // revalidation of every constraint on the table succeeds.
            await sql`alter table integration_delivery_attempt
                      validate constraint integration_attempt_settlement_explained`.execute(
              db,
            );
          },
          { applyLeaseMigration: false },
        );
      },
    );

    // -----------------------------------------------------------------
    // The settlement matrix: the four authorized shapes
    // -----------------------------------------------------------------

    await t.test(
      'shape A — a success carries neither a category nor a reason',
      async () => {
        await withSchema(async (fixture) => {
          const { db } = fixture;
          const attempt = await openAttempt(fixture, fixture.outboxId);
          await toDispatching(db, fixture.outboxId);
          await settle(db, attempt, 'succeeded', null);
          const row = await sql<{
            outcome: string;
            failure_category: string | null;
            reason_code: string | null;
          }>`select outcome, failure_category, reason_code
             from integration_delivery_attempt where id = ${attempt}`.execute(
            db,
          );
          assert.deepEqual(row.rows, [
            {
              outcome: 'succeeded',
              failure_category: null,
              reason_code: null,
            },
          ]);
        });
      },
    );

    await t.test(
      'shape B — an adapter-derived settlement carries a category and no reason',
      async () => {
        await withSchema(async (fixture) => {
          const { db } = fixture;
          for (const [outcome, category] of [
            ['failed_transient', 'destination_unavailable'],
            ['failed_transient', 'rate_limited'],
            ['failed_permanent', 'destination_rejected'],
            ['failed_permanent', 'authentication_failed'],
            ['ambiguous', 'destination_timeout'],
          ] as const) {
            const obligation = await fixture.newObligation();
            const attempt = await openAttempt(fixture, obligation);
            await toDispatching(db, obligation);
            await settle(db, attempt, outcome, category);
            const row = await sql<{
              outcome: string;
              failure_category: string;
              reason_code: string | null;
            }>`select outcome, failure_category, reason_code
               from integration_delivery_attempt where id = ${attempt}`.execute(
              db,
            );
            assert.deepEqual(row.rows, [
              { outcome, failure_category: category, reason_code: null },
            ]);
          }
        });
      },
    );

    await t.test(
      'shape C — pre-dispatch recovery evidence, with no destination category',
      async () => {
        await withSchema(async (fixture) => {
          const { db } = fixture;
          const attempt = await openAttempt(fixture, fixture.outboxId);
          await toDispatching(db, fixture.outboxId);
          await settle(
            db,
            attempt,
            'failed_transient',
            null,
            'lease_expired_pre_dispatch',
          );
          const row = await sql<{
            outcome: string;
            failure_category: string | null;
            reason_code: string;
            dispatch_started_at: Date | null;
          }>`select outcome, failure_category, reason_code, dispatch_started_at
             from integration_delivery_attempt where id = ${attempt}`.execute(
            db,
          );
          assert.deepEqual(row.rows, [
            {
              outcome: 'failed_transient',
              failure_category: null,
              reason_code: 'lease_expired_pre_dispatch',
              dispatch_started_at: null,
            },
          ]);
        });
      },
    );

    await t.test(
      'shape D — possibly-dispatched expiry evidence, requiring a crossed boundary',
      async () => {
        await withSchema(async (fixture) => {
          const { db } = fixture;
          const attempt = await openAttempt(fixture, fixture.outboxId);
          await markDispatch(db, attempt);
          await toDispatching(db, fixture.outboxId);
          await settle(
            db,
            attempt,
            'ambiguous',
            null,
            'lease_expired_uncertain',
          );
          const row = await sql<{
            outcome: string;
            failure_category: string | null;
            reason_code: string;
            marked: boolean;
          }>`select outcome, failure_category, reason_code,
                    dispatch_started_at is not null as marked
             from integration_delivery_attempt where id = ${attempt}`.execute(
            db,
          );
          assert.deepEqual(row.rows, [
            {
              outcome: 'ambiguous',
              failure_category: null,
              reason_code: 'lease_expired_uncertain',
              marked: true,
            },
          ]);
        });
      },
    );

    // -----------------------------------------------------------------
    // The settlement matrix: impossible evidence is unwritable
    // -----------------------------------------------------------------

    await t.test(
      'every impossible settlement combination is refused by PostgreSQL',
      async () => {
        await withSchema(async (fixture) => {
          const { db } = fixture;

          // Each case settles a freshly opened attempt, so a refusal is
          // attributable to the combination rather than to prior state.
          const cases: readonly {
            readonly label: string;
            readonly outcome: string;
            readonly category: string | null;
            readonly reason: string | null;
            readonly marked: boolean;
            readonly expect: RegExp;
          }[] = [
            {
              label: 'succeeded with a failure category',
              outcome: 'succeeded',
              category: 'destination_unavailable',
              reason: null,
              marked: false,
              expect: /integration_delivery_attempt_check/,
            },
            {
              label: 'succeeded with a reason code',
              outcome: 'succeeded',
              category: null,
              reason: 'lease_expired_pre_dispatch',
              marked: false,
              expect:
                /integration_attempt_success_carries_no_reason|integration_attempt_pre_dispatch_reason_shape/,
            },
            {
              label: 'failed_permanent with no category',
              outcome: 'failed_permanent',
              category: null,
              reason: null,
              marked: false,
              // Two rules forbid it and PostgreSQL reports whichever it
              // evaluates first, so either name is a correct refusal.
              expect:
                /integration_attempt_settlement_explained|integration_attempt_permanent_requires_category/,
            },
            {
              label: 'adapter failure carrying a lifecycle reason',
              outcome: 'failed_transient',
              category: 'destination_unavailable',
              reason: 'lease_expired_pre_dispatch',
              marked: false,
              expect:
                /integration_attempt_lifecycle_reason_excludes_category|integration_attempt_pre_dispatch_reason_shape/,
            },
            {
              label: 'pre-dispatch reason with a category',
              outcome: 'failed_transient',
              category: 'rate_limited',
              reason: 'lease_expired_pre_dispatch',
              marked: false,
              expect:
                /integration_attempt_lifecycle_reason_excludes_category|integration_attempt_pre_dispatch_reason_shape/,
            },
            {
              label: 'pre-dispatch reason on a dispatched attempt',
              outcome: 'failed_transient',
              category: null,
              reason: 'lease_expired_pre_dispatch',
              marked: true,
              expect: /integration_attempt_pre_dispatch_reason_shape/,
            },
            {
              label: 'pre-dispatch reason with the wrong outcome',
              outcome: 'ambiguous',
              category: null,
              reason: 'lease_expired_pre_dispatch',
              marked: false,
              expect: /integration_attempt_pre_dispatch_reason_shape/,
            },
            {
              label: 'uncertain reason with a category',
              outcome: 'ambiguous',
              category: 'destination_timeout',
              reason: 'lease_expired_uncertain',
              marked: true,
              expect:
                /integration_attempt_lifecycle_reason_excludes_category|integration_attempt_uncertain_reason_shape/,
            },
            {
              label: 'uncertain reason with no crossed boundary',
              outcome: 'ambiguous',
              category: null,
              reason: 'lease_expired_uncertain',
              marked: false,
              expect: /integration_attempt_uncertain_reason_shape/,
            },
            {
              label: 'uncertain reason with the wrong outcome',
              outcome: 'failed_transient',
              category: null,
              reason: 'lease_expired_uncertain',
              marked: true,
              expect: /integration_attempt_uncertain_reason_shape/,
            },
            {
              label: 'failed_transient with a non-transient category',
              outcome: 'failed_transient',
              category: 'authentication_failed',
              reason: null,
              marked: false,
              expect: /integration_attempt_transient_category_shape/,
            },
            {
              label: 'a timeout settled as anything but ambiguous',
              outcome: 'failed_permanent',
              category: 'destination_timeout',
              reason: null,
              marked: false,
              expect: /integration_attempt_timeout_is_ambiguous/,
            },
          ];

          for (const scenario of cases) {
            const obligation = await fixture.newObligation();
            const attempt = await openAttempt(fixture, obligation);
            if (scenario.marked) await markDispatch(db, attempt);
            await toDispatching(db, obligation);
            const refusal = await message(() =>
              settle(
                db,
                attempt,
                scenario.outcome,
                scenario.category,
                scenario.reason,
              ),
            );
            assert.match(refusal, scenario.expect, scenario.label);
          }
        });
      },
    );

    await t.test(
      'an open attempt may carry neither a category nor a reason',
      async () => {
        await withSchema(async (fixture) => {
          const { db } = fixture;
          // At INSERT the guard refuses both outright.
          const withReason = await message(async () =>
            openAttempt(fixture, await fixture.newObligation(), {
              reasonCode: 'lease_expired_pre_dispatch',
            }),
          );
          assert.match(
            withReason,
            /must be created without a settlement reason/,
          );
          const withCategory = await message(async () =>
            openAttempt(fixture, await fixture.newObligation(), {
              failureCategory: 'destination_unavailable',
            }),
          );
          assert.match(withCategory, /must be created open/);

          // And the constraint refuses it independently of the guard, so a
          // privileged direct write cannot assert it either.
          const obligation = await fixture.newObligation();
          await withGuardDisabled(db, async () => {
            const refusal = await message(() =>
              sql`
                insert into integration_delivery_attempt (
                  organization_id, integration_outbox_id,
                  integration_connector_id, attempt_number, claim_generation,
                  claim_token_digest, connector_configuration_revision,
                  capability_snapshot, reason_code
                ) values (
                  ${fixture.organizationId}, ${obligation},
                  ${fixture.connectorId}, 1, 1, ${DIGEST}, 1,
                  ${JSON.stringify(SNAPSHOT)}::jsonb,
                  'lease_expired_pre_dispatch')`.execute(db),
            );
            assert.match(
              refusal,
              /integration_attempt_open_carries_no_evidence|integration_attempt_pre_dispatch_reason_shape/,
            );
          });
        });
      },
    );

    // -----------------------------------------------------------------
    // The dispatch boundary
    // -----------------------------------------------------------------

    await t.test(
      'the dispatch boundary is null at claim and cannot be set at insert',
      async () => {
        await withSchema(async (fixture) => {
          const { db } = fixture;
          const attempt = await openAttempt(fixture, fixture.outboxId);
          const row = await sql<{ marker: Date | null }>`
            select dispatch_started_at as marker
            from integration_delivery_attempt where id = ${attempt}`.execute(
            db,
          );
          assert.equal(row.rows[0]?.marker, null);

          const obligation = await fixture.newObligation();
          const refusal = await message(() =>
            openAttempt(fixture, obligation, {
              dispatchStartedAt: new Date(),
            }),
          );
          assert.match(refusal, /must be created before its dispatch boundary/);
        });
      },
    );

    await t.test(
      'the stored dispatch boundary is database-authored, not caller-supplied',
      async () => {
        await withSchema(async (fixture) => {
          const { db } = fixture;
          const attempt = await openAttempt(fixture, fixture.outboxId);

          const before = await sql<{ at: Date }>`
            select clock_timestamp() as at`.execute(db);
          // Two obviously forged signals: far past and far future.
          await markDispatch(db, attempt, '1999-01-01T00:00:00Z');
          const after = await sql<{ at: Date }>`
            select clock_timestamp() as at`.execute(db);

          const stored = await sql<{ marker: Date }>`
            select dispatch_started_at as marker
            from integration_delivery_attempt where id = ${attempt}`.execute(
            db,
          );
          const marker = stored.rows[0]?.marker;
          const low = before.rows[0];
          const high = after.rows[0];
          assert.ok(marker instanceof Date);
          assert.ok(low !== undefined && high !== undefined);
          // The durable value lies between two database clock readings taken
          // around the write, so it cannot be the forged 1999 value.
          assert.ok(
            marker.getTime() >= low.at.getTime() &&
              marker.getTime() <= high.at.getTime(),
            `the marker ${marker.toISOString()} is not database-authored`,
          );
          assert.equal(marker.getUTCFullYear() === 1999, false);
        });
      },
    );

    await t.test(
      'the dispatch boundary is write-once: it cannot be replaced or cleared',
      async () => {
        await withSchema(async (fixture) => {
          const { db } = fixture;
          const attempt = await openAttempt(fixture, fixture.outboxId);
          await markDispatch(db, attempt);
          const first = await sql<{ marker: Date }>`
            select dispatch_started_at as marker
            from integration_delivery_attempt where id = ${attempt}`.execute(
            db,
          );

          // A second mark, even with a different signal, is refused.
          const replaced = await message(() =>
            markDispatch(db, attempt, '2030-01-01T00:00:00Z'),
          );
          assert.match(
            replaced,
            /dispatch boundary is write-once and cannot be changed or cleared/,
          );
          // Clearing is refused by the same rule.
          const cleared = await message(() =>
            sql`update integration_delivery_attempt
                      set dispatch_started_at = null
                      where id = ${attempt}`.execute(db),
          );
          assert.match(
            cleared,
            /dispatch boundary is write-once and cannot be changed or cleared/,
          );

          const unchanged = await sql<{ marker: Date }>`
            select dispatch_started_at as marker
            from integration_delivery_attempt where id = ${attempt}`.execute(
            db,
          );
          assert.deepEqual(unchanged.rows, first.rows);
        });
      },
    );

    await t.test(
      'the dispatch boundary cannot first be recorded after settlement',
      async () => {
        await withSchema(async (fixture) => {
          const { db } = fixture;
          const attempt = await openAttempt(fixture, fixture.outboxId);
          await toDispatching(db, fixture.outboxId);
          await settle(db, attempt, 'succeeded', null);
          const refusal = await message(() => markDispatch(db, attempt));
          assert.match(
            refusal,
            /A settled integration delivery attempt is immutable/,
          );
        });
      },
    );

    await t.test(
      'a settlement may not introduce the dispatch boundary in the same statement',
      async () => {
        await withSchema(async (fixture) => {
          const { db } = fixture;
          const attempt = await openAttempt(fixture, fixture.outboxId);
          await toDispatching(db, fixture.outboxId);
          // This is the forgery that would let a recovery manufacture the
          // boundary state its own reason code requires.
          const refusal = await message(() =>
            sql`update integration_delivery_attempt
                      set dispatch_started_at = clock_timestamp(),
                          outcome = 'ambiguous',
                          completed_at = clock_timestamp(),
                          reason_code = 'lease_expired_uncertain'
                      where id = ${attempt}`.execute(db),
          );
          assert.match(
            refusal,
            /dispatch boundary must be recorded before settlement/,
          );
        });
      },
    );

    await t.test(
      'recording the dispatch boundary carries no settlement evidence and no identity change',
      async () => {
        await withSchema(async (fixture) => {
          const { db } = fixture;
          const attempt = await openAttempt(fixture, fixture.outboxId);
          const withReason = await message(() =>
            sql`update integration_delivery_attempt
                      set dispatch_started_at = clock_timestamp(),
                          reason_code = 'lease_expired_uncertain'
                      where id = ${attempt}`.execute(db),
          );
          assert.match(
            withReason,
            /dispatch boundary carries no settlement evidence/,
          );
          const withIdentity = await message(() =>
            sql`update integration_delivery_attempt
                      set dispatch_started_at = clock_timestamp(),
                          claim_token_digest = ${'b'.repeat(64)}
                      where id = ${attempt}`.execute(db),
          );
          assert.match(withIdentity, /claim identity is immutable/);
        });
      },
    );

    // -----------------------------------------------------------------
    // The claim lease
    // -----------------------------------------------------------------

    await t.test(
      'claim_expires_at may stay null through this transitional slice',
      async () => {
        await withSchema(async (fixture) => {
          const { db } = fixture;
          const attempt = await openAttempt(fixture, fixture.outboxId);
          const row = await sql<{ lease: Date | null }>`
            select claim_expires_at as lease
            from integration_delivery_attempt where id = ${attempt}`.execute(
            db,
          );
          assert.equal(row.rows[0]?.lease, null);
          // And a null lease does not obstruct an ordinary settlement.
          await toDispatching(db, fixture.outboxId);
          await settle(db, attempt, 'succeeded', null);
        });
      },
    );

    await t.test(
      'a non-null claim lease must fall after the attempt started',
      async () => {
        await withSchema(async (fixture) => {
          const { db } = fixture;
          const obligation = await fixture.newObligation();
          const refusal = await message(() =>
            openAttempt(fixture, obligation, {
              claimExpiresAt: '2000-01-01T00:00:00Z',
            }),
          );
          assert.match(refusal, /integration_attempt_lease_after_start/);

          // A lease after the guard-assigned start is accepted.
          const future = new Date(Date.now() + 3_600_000).toISOString();
          const accepted = await openAttempt(fixture, obligation, {
            claimExpiresAt: future,
          });
          const row = await sql<{ later: boolean }>`
            select claim_expires_at > started_at as later
            from integration_delivery_attempt where id = ${accepted}`.execute(
            db,
          );
          assert.deepEqual(row.rows, [{ later: true }]);
        });
      },
    );

    await t.test(
      'the claim lease is immutable: it can be neither extended nor introduced',
      async () => {
        await withSchema(async (fixture) => {
          const { db } = fixture;
          const future = new Date(Date.now() + 3_600_000).toISOString();
          const leased = await openAttempt(fixture, fixture.outboxId, {
            claimExpiresAt: future,
          });
          const extended = await message(() =>
            sql`update integration_delivery_attempt
                      set claim_expires_at = clock_timestamp() + interval '1 day'
                      where id = ${leased}`.execute(db),
          );
          assert.match(
            extended,
            /claim lease is immutable and cannot be extended/,
          );

          // Nor may a lease be introduced onto an attempt that had none.
          const obligation = await fixture.newObligation();
          const unleased = await openAttempt(fixture, obligation);
          const introduced = await message(() =>
            sql`update integration_delivery_attempt
                      set claim_expires_at = clock_timestamp() + interval '1 day'
                      where id = ${unleased}`.execute(db),
          );
          assert.match(
            introduced,
            /claim lease is immutable and cannot be extended/,
          );
        });
      },
    );

    await t.test(
      'an expired lease alone does not prohibit a legitimate completion',
      async () => {
        await withSchema(async (fixture) => {
          const { db } = fixture;
          // Constructed directly: started an hour ago, lease expired half an
          // hour ago. No sleep, and no recovery has run.
          const attempt = await openExpiredAttempt(fixture, fixture.outboxId);
          const expired = await sql<{ expired: boolean; open: boolean }>`
            select claim_expires_at < clock_timestamp() as expired,
                   completed_at is null as open
            from integration_delivery_attempt where id = ${attempt}`.execute(
            db,
          );
          assert.deepEqual(expired.rows, [{ expired: true, open: true }]);

          // The still-current claimant settles normally. Expiry authorizes
          // recovery; it does not invalidate a genuine completion.
          await toDispatching(db, fixture.outboxId);
          await settle(db, attempt, 'succeeded', null);
          const settled = await sql<{
            outcome: string;
            settled_after_expiry: boolean;
          }>`
            select outcome, completed_at > claim_expires_at as settled_after_expiry
            from integration_delivery_attempt where id = ${attempt}`.execute(
            db,
          );
          assert.deepEqual(settled.rows, [
            { outcome: 'succeeded', settled_after_expiry: true },
          ]);
        });
      },
    );

    await t.test(
      'no state changes merely because a lease has passed',
      async () => {
        await withSchema(async (fixture) => {
          const { db } = fixture;
          const attempt = await openExpiredAttempt(fixture, fixture.outboxId, {
            dispatched: true,
          });
          // Nothing in this slice reacts to time: the attempt stays open, the
          // obligation stays pending, and no reason code appears.
          const state = await sql<{
            open: boolean;
            reason_code: string | null;
            obligation_state: string;
          }>`
            select a.completed_at is null as open, a.reason_code,
                   o.state as obligation_state
            from integration_delivery_attempt a
            join integration_outbox o on o.id = a.integration_outbox_id
            where a.id = ${attempt}`.execute(db);
          assert.deepEqual(state.rows, [
            { open: true, reason_code: null, obligation_state: 'pending' },
          ]);
        });
      },
    );

    // -----------------------------------------------------------------
    // Rollback
    // -----------------------------------------------------------------

    await t.test(
      'rollback refuses while lease, boundary or reason evidence exists, then succeeds and reapplies',
      async () => {
        await withSchema(async (fixture) => {
          const { db } = fixture;
          const attempt = await openAttempt(fixture, fixture.outboxId);
          await markDispatch(db, attempt);
          await toDispatching(db, fixture.outboxId);
          await settle(
            db,
            attempt,
            'ambiguous',
            null,
            'lease_expired_uncertain',
          );

          const refusal = await message(() => down(db));
          assert.match(
            refusal,
            /Retained integration lease, dispatch-boundary or recovery-reason evidence prevents rollback/,
          );
          // The evidence is still there: the refusal changed nothing.
          const intact = await sql<{ reason_code: string }>`
            select reason_code from integration_delivery_attempt
            where id = ${attempt}`.execute(db);
          assert.deepEqual(intact.rows, [
            { reason_code: 'lease_expired_uncertain' },
          ]);

          // Privileged test cleanup, standing in for the reviewed safe-loss
          // rule the migration deliberately does not contain. Settling the
          // row back to an adapter-derived shape is the only way to reach a
          // rollback-eligible state without the migration erasing evidence
          // itself.
          await withGuardDisabled(db, async () => {
            await sql`update integration_delivery_attempt
                      set reason_code = null, dispatch_started_at = null,
                          claim_expires_at = null,
                          failure_category = 'destination_timeout'
                      where id = ${attempt}`.execute(db);
          });

          await down(db);
          // The pre-migration shape is restored: the three columns are gone
          // and the original settlement rule is back.
          const columns = await sql<{ present: string }>`
            select count(*)::text as present
            from information_schema.columns
            where table_schema = current_schema()
              and table_name = 'integration_delivery_attempt'
              and column_name in
                ('claim_expires_at', 'dispatch_started_at', 'reason_code')`.execute(
            db,
          );
          assert.deepEqual(columns.rows, [{ present: '0' }]);
          const index = await sql<{ present: string }>`
            select count(*)::text as present from pg_indexes
            where schemaname = current_schema()
              and indexname = 'integration_attempt_lease_expiry'`.execute(db);
          assert.deepEqual(index.rows, [{ present: '0' }]);
          const restored = await sql<{ definition: string }>`
            select pg_get_constraintdef(c.oid) as definition
            from pg_constraint c
            where c.conrelid = 'integration_delivery_attempt'::regclass
              and c.contype = 'c'
              and pg_get_constraintdef(c.oid) like '%failure_category IS NOT NULL%'`.execute(
            db,
          );
          assert.equal(restored.rows.length, 1);
          // The surviving evidence row was not deleted by rollback.
          const survivors = await sql<{ rows: string }>`
            select count(*)::text as rows
            from integration_delivery_attempt`.execute(db);
          assert.deepEqual(survivors.rows, [{ rows: '1' }]);

          // Reapply, and the new contract is available again.
          await up(db);
          const again = await sql<{ present: string }>`
            select count(*)::text as present
            from information_schema.columns
            where table_schema = current_schema()
              and table_name = 'integration_delivery_attempt'
              and column_name in
                ('claim_expires_at', 'dispatch_started_at', 'reason_code')`.execute(
            db,
          );
          assert.deepEqual(again.rows, [{ present: '3' }]);
        });
      },
    );

    await t.test(
      'rollback succeeds untouched where no new evidence was ever written',
      async () => {
        await withSchema(async (fixture) => {
          const { db } = fixture;
          const attempt = await openAttempt(fixture, fixture.outboxId);
          await toDispatching(db, fixture.outboxId);
          await settle(db, attempt, 'failed_permanent', 'destination_rejected');
          await down(db);
          await up(db);
          const row = await sql<{
            outcome: string;
            failure_category: string;
          }>`select outcome, failure_category
             from integration_delivery_attempt where id = ${attempt}`.execute(
            db,
          );
          assert.deepEqual(row.rows, [
            {
              outcome: 'failed_permanent',
              failure_category: 'destination_rejected',
            },
          ]);
        });
      },
    );
  },
);
