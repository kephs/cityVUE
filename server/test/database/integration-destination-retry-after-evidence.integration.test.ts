import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';
import {
  applyIntegrationWorkerFunctions,
  applyIntegrationWorkerHardening,
  workerApiSchema,
} from '../helpers/integration-worker-functions.js';
import { up as catalogUp } from '../../migrations/20260902000000-create-organization-service-catalog.js';
import { up as connectorUp } from '../../migrations/20261020000000-add-integration-connector-registry.js';
import { up as outboxUp } from '../../migrations/20261021000000-add-integration-outbox.js';
import { up as attemptUp } from '../../migrations/20261022000000-add-integration-delivery-attempt.js';
import { up as leaseUp } from '../../migrations/20261024000000-add-integration-lease-recovery-evidence.js';
import { up as orderingUp } from '../../migrations/20261025000000-add-integration-ordering-retry-eligibility.js';
import { up as policyUp } from '../../migrations/20261027000000-add-integration-execution-policy-persistence.js';
import {
  down as retryAfterDown,
  up as retryAfterUp,
} from '../../migrations/20261028000000-add-integration-destination-retry-after-evidence.js';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import { NO_CAPABILITIES } from '../../src/integration/connector-capabilities.js';
import { toCapabilityColumns } from '../../src/integration/persistence/connector-metadata.js';
import {
  integrationFailureCategories,
  type IntegrationFailureCategory,
} from '../../src/integration/integration-envelope.js';
import { enqueueIntegrationIntent } from '../../src/integration/persistence/outbox.repository.js';
import type { EnqueueIntentInput } from '../../src/integration/persistence/outbox.js';

/**
 * F062.2D-2C-3B-2 — destination `Retry-After` evidence, proven against
 * PostgreSQL.
 *
 * **Persistence integrity only.** No worker function is changed here, no
 * lease is authored, no retry is scheduled, no value is clamped and no
 * recovery runs. Where a future 3C settlement would supply the delay, the
 * database is driven directly as that settlement would drive it, so what is
 * proven is the integrity of the evidence rather than the behaviour of any
 * caller. Driving the table directly creates no production authoring
 * authority: no function writes this column and no identity holds `EXECUTE`.
 *
 * **No sleeps anywhere.** Every assertion is a deterministic database
 * property.
 *
 * The numeric values below are **synthetic test fixtures and not policy
 * decisions.** They are small, obviously artificial and mutually distinct so a
 * mis-mapped column shows up as a wrong number rather than a passing test. All
 * thirteen numerical policies of F062.2D-2C-3-0 §26 remain unresolved, and
 * nothing in this file proposes a value for any of them.
 */

const url = process.env.TEST_DATABASE_URL;
type Database = Kysely<DatabaseSchema>;

const DIGEST = 'a'.repeat(64);
const SNAPSHOT = {
  supports_idempotency_key: false,
  supports_read_after_write: false,
  side_effect_risk: 'irreversible',
};

/** SYNTHETIC TEST FIXTURE — NOT A POLICY DECISION. */
const FIXTURE_RETRY_AFTER = 37;
/** A second, distinct synthetic delay. Also not policy. */
const FIXTURE_RETRY_AFTER_TWO = 59;

/**
 * The outcome each failure category may legally settle with, under
 * Migration 52's success/failure rules and Migration 54's settlement matrix.
 *
 * `destination_timeout` is `ambiguous` because
 * `integration_attempt_timeout_is_ambiguous` requires it, and only the two
 * transient categories may accompany `failed_transient` under
 * `integration_attempt_transient_category_shape`. Deriving the pairing here
 * rather than hardcoding one outcome keeps the enumeration below honest: a
 * refusal must come from the retry-after rule, never from a settlement-shape
 * rule the test tripped by accident.
 */
const OUTCOME_FOR: Readonly<Record<IntegrationFailureCategory, string>> = {
  destination_unavailable: 'failed_transient',
  destination_timeout: 'ambiguous',
  destination_rejected: 'failed_permanent',
  rate_limited: 'failed_transient',
  authentication_failed: 'failed_permanent',
  destination_unconfigured: 'failed_permanent',
  projection_failed: 'failed_permanent',
  contract_unsupported: 'failed_permanent',
  malformed_request: 'failed_permanent',
  internal_failure: 'failed_permanent',
};

interface Fixture {
  readonly db: Database;
  readonly schema: string;
  readonly api: string;
  readonly organizationId: string;
  readonly connectorId: string;
  newObligation(): Promise<string>;
}

/**
 * A disposable schema carrying every migration this slice depends on.
 *
 * Migrations 53 and 56 hardcode `public.`, so they arrive through the
 * existing text-rewrite helper rather than an import. Migrations 57 and 58
 * hardcode nothing and are imported directly.
 *
 * `applyRetryAfterMigration: false` stops at Migration 57, which is what the
 * apply/rollback/reapply and guard-restore proofs need.
 */
async function withSchema(
  run: (fixture: Fixture) => Promise<void>,
  options: { readonly applyRetryAfterMigration?: boolean } = {},
): Promise<void> {
  const schema = 'integration_retry_after_' + randomUUID().replaceAll('-', '');
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
    await applyIntegrationWorkerFunctions(db, schema);
    await leaseUp(db);
    await orderingUp(db);
    await applyIntegrationWorkerHardening(db, schema);
    await policyUp(db);
    if (options.applyRetryAfterMigration !== false) await retryAfterUp(db);
    const organizationId = randomUUID();
    await db
      .insertInto('organization')
      .values({
        id: organizationId,
        name: 'F062.2D-2C-3B-2 Synthetic',
        short_name: 'Test',
        slug: 'f0622d2c3b2-' + organizationId,
        status: 'active',
        default_business_timezone: 'America/New_York',
      })
      .execute();
    const connectorId = await registerConnector(db, organizationId);
    await run({
      db,
      schema,
      api: workerApiSchema(schema),
      organizationId,
      connectorId,
      newObligation: () => enqueue(db, organizationId, connectorId),
    });
  } finally {
    await db.destroy();
    await admin.query('drop schema "' + schema + '" cascade');
    await admin.end();
  }
}

/** Registers a connector and advances it to `active` through a reviewed
 * lifecycle edge, which a claim requires. */
async function registerConnector(
  db: Database,
  organizationId: string,
): Promise<string> {
  const connectorId = await db.transaction().execute(async (trx) => {
    const created = await trx
      .insertInto('integration_connector')
      .values({
        organization_id: organizationId,
        connector_key: 'loopback-retry-after',
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
  // The lifecycle edge to `active`, which a claim requires. The audit row
  // mirrors the STORED row rather than the values this test supplied, because
  // the guard compares every mirrored column against committed connector
  // state and a literal would drift the moment a column is added.
  await db.transaction().execute(async (trx) => {
    const current = await trx
      .selectFrom('integration_connector')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where('id', '=', connectorId)
      .executeTakeFirstOrThrow();
    const updated = await trx
      .updateTable('integration_connector')
      .set({
        lifecycle_state: 'active',
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
        change_category: 'lifecycle_changed',
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
        request_execution_budget_seconds:
          updated.request_execution_budget_seconds,
        destination_retry_base_delay_seconds:
          updated.destination_retry_base_delay_seconds,
        destination_retry_max_delay_seconds:
          updated.destination_retry_max_delay_seconds,
        destination_retry_attempt_ceiling:
          updated.destination_retry_attempt_ceiling,
        credential_reference_present: updated.credential_reference !== null,
        prior_configuration_revision: current.configuration_revision,
        prior_lifecycle_state: current.lifecycle_state,
        actor: 'test-operator',
        correlation_id: randomUUID(),
      })
      .execute();
  });
  return connectorId;
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

async function pinnedRevision(
  db: Database,
  organizationId: string,
  outboxId: string,
): Promise<number> {
  const row = await db
    .selectFrom('integration_outbox')
    .select('pinned_connector_configuration_revision')
    .where('organization_id', '=', organizationId)
    .where('id', '=', outboxId)
    .executeTakeFirstOrThrow();
  return row.pinned_connector_configuration_revision;
}

/** Opens an attempt the way a claim would, optionally supplying the retry
 * evidence so the creation-time refusal can be observed. */
async function openAttempt(
  fixture: Fixture,
  outboxId: string,
  extras: { readonly retryAfterSeconds?: number | null } = {},
): Promise<string> {
  const revision = await pinnedRevision(
    fixture.db,
    fixture.organizationId,
    outboxId,
  );
  // The column is named ONLY when a test supplies it, so this helper also
  // works before Migration 58 has applied -- which the no-backfill proof
  // needs, because it creates its rows first and migrates afterwards.
  const result =
    extras.retryAfterSeconds === undefined
      ? await sql<{ id: string }>`
    insert into integration_delivery_attempt (
      organization_id, integration_outbox_id, integration_connector_id,
      claim_token_digest, connector_configuration_revision,
      capability_snapshot
    ) values (
      ${fixture.organizationId}, ${outboxId}, ${fixture.connectorId},
      ${DIGEST}, ${revision}, ${JSON.stringify(SNAPSHOT)}::jsonb
    ) returning id`.execute(fixture.db)
      : await sql<{ id: string }>`
    insert into integration_delivery_attempt (
      organization_id, integration_outbox_id, integration_connector_id,
      claim_token_digest, connector_configuration_revision,
      capability_snapshot, destination_retry_after_seconds
    ) values (
      ${fixture.organizationId}, ${outboxId}, ${fixture.connectorId},
      ${DIGEST}, ${revision}, ${JSON.stringify(SNAPSHOT)}::jsonb,
      ${extras.retryAfterSeconds}::integer
    ) returning id`.execute(fixture.db);
  const row = result.rows[0];
  assert.ok(row !== undefined, 'the attempt insert returned no row');
  return row.id;
}

/** Settles an open attempt exactly as a future 3C completion would, with the
 * delay supplied as a separate bound parameter. */
async function settle(
  db: Database,
  attemptId: string,
  outcome: string,
  failureCategory: string | null,
  retryAfterSeconds: number | null,
): Promise<void> {
  await sql`update integration_delivery_attempt
               set outcome = ${outcome}::varchar(18),
                   completed_at = clock_timestamp(),
                   failure_category = ${failureCategory}::varchar(28),
                   destination_retry_after_seconds =
                     ${retryAfterSeconds}::integer
             where id = ${attemptId}::uuid`.execute(db);
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

/** Column metadata, SCOPED TO THE DISPOSABLE SCHEMA. An unscoped
 * `information_schema` query would read another schema's identically named
 * table and make this proof meaningless. */
async function columns(
  db: Database,
  table: string,
): Promise<
  Map<string, { nullable: string; dflt: string | null; type: string }>
> {
  const result = await sql<{
    column_name: string;
    is_nullable: string;
    column_default: string | null;
    data_type: string;
  }>`
    select column_name, is_nullable, column_default, data_type
      from information_schema.columns
     where table_schema = current_schema()
       and table_name = ${table}`.execute(db);
  return new Map(
    result.rows.map((row) => [
      row.column_name,
      {
        nullable: row.is_nullable,
        dflt: row.column_default,
        type: row.data_type,
      },
    ]),
  );
}

/** The live source of the attempt guard, scoped to the disposable schema. */
async function guardDefinition(db: Database): Promise<string> {
  const result = await sql<{ def: string }>`
    select pg_get_functiondef(p.oid) as def
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = current_schema()
       and p.proname = 'guard_integration_delivery_attempt'`.execute(db);
  const row = result.rows[0];
  assert.ok(row !== undefined, 'the attempt guard must exist');
  return row.def;
}

test(
  'F062.2D-2C-3B-2 destination retry-after evidence is enforced by PostgreSQL',
  {
    skip:
      url === undefined &&
      'TEST_DATABASE_URL is not set; the destination retry-after evidence proof is skipped',
  },
  async (t) => {
    // ----------------------------------------------------------------
    // 1. Column shape.
    // ----------------------------------------------------------------
    await t.test(
      'the column is a nullable integer with no default',
      async () => {
        await withSchema(async (fixture) => {
          const attempt = (
            await columns(fixture.db, 'integration_delivery_attempt')
          ).get('destination_retry_after_seconds');
          assert.ok(attempt !== undefined, 'the column must exist');
          assert.equal(attempt.type, 'integer');
          assert.equal(attempt.nullable, 'YES');
          // NO DEFAULT, deliberately: a default would be a policy number
          // chosen by a migration. Asserted, not merely intended.
          assert.equal(attempt.dflt, null);
        });
      },
    );

    await t.test(
      'the evidence is not mirrored onto the connector or its audit snapshot',
      async () => {
        await withSchema(async (fixture) => {
          for (const table of [
            'integration_connector',
            'integration_connector_audit',
            'integration_outbox',
          ]) {
            const found = (await columns(fixture.db, table)).get(
              'destination_retry_after_seconds',
            );
            assert.equal(
              found,
              undefined,
              `${table} must not carry destination retry evidence`,
            );
          }
        });
      },
    );

    // ----------------------------------------------------------------
    // 2. The accepted shape.
    // ----------------------------------------------------------------
    await t.test(
      'a rate_limited settlement may carry a non-negative delay, and zero is legal',
      async () => {
        await withSchema(async (fixture) => {
          for (const value of [FIXTURE_RETRY_AFTER, 0]) {
            const outbox = await fixture.newObligation();
            const attempt = await openAttempt(fixture, outbox);
            await settle(
              fixture.db,
              attempt,
              'failed_transient',
              'rate_limited',
              value,
            );
            const row = await fixture.db
              .selectFrom('integration_delivery_attempt')
              .selectAll()
              .where('id', '=', attempt)
              .executeTakeFirstOrThrow();
            assert.equal(row.destination_retry_after_seconds, value);
            assert.notEqual(row.completed_at, null);
          }
        });
      },
    );

    await t.test(
      'a rate_limited settlement may legitimately carry no delay at all',
      async () => {
        await withSchema(async (fixture) => {
          const outbox = await fixture.newObligation();
          const attempt = await openAttempt(fixture, outbox);
          await settle(
            fixture.db,
            attempt,
            'failed_transient',
            'rate_limited',
            null,
          );
          const row = await fixture.db
            .selectFrom('integration_delivery_attempt')
            .selectAll()
            .where('id', '=', attempt)
            .executeTakeFirstOrThrow();
          // Not every rate-limited response states a rate. 3B-0 §18's
          // parking recommendation exists precisely for this row.
          assert.equal(row.destination_retry_after_seconds, null);
        });
      },
    );

    // ----------------------------------------------------------------
    // 3. The refusals. This is the security surface.
    // ----------------------------------------------------------------
    await t.test('a negative delay is refused', async () => {
      await withSchema(async (fixture) => {
        const outbox = await fixture.newObligation();
        const attempt = await openAttempt(fixture, outbox);
        const refusal = await message(() =>
          settle(fixture.db, attempt, 'failed_transient', 'rate_limited', -1),
        );
        assert.match(refusal, /retry_after_nonnegative/);
      });
    });

    await t.test(
      'every failure category other than rate_limited refuses the evidence',
      async () => {
        await withSchema(async (fixture) => {
          const others = integrationFailureCategories.filter(
            (category) => category !== 'rate_limited',
          );
          // Enumerated, not sampled: nine categories, asserted to be nine so
          // a future taxonomy change cannot quietly shrink this proof.
          assert.equal(others.length, 9);
          for (const category of others) {
            const outbox = await fixture.newObligation();
            const attempt = await openAttempt(fixture, outbox);
            const refusal = await message(() =>
              settle(
                fixture.db,
                attempt,
                OUTCOME_FOR[category],
                category,
                FIXTURE_RETRY_AFTER,
              ),
            );
            // The GUARD raises first, which is why the message is its own
            // rather than a constraint name. The table constraint is proven
            // independently below, with triggers disabled.
            assert.match(
              refusal,
              /legal only for a rate_limited settlement/,
              `${category} must be refused by the retry-after rule`,
            );
            // And the same settlement without the evidence is legal, which
            // proves the refusal came from the retry-after rule rather than
            // from a settlement-shape rule this test tripped by accident.
            await settle(
              fixture.db,
              attempt,
              OUTCOME_FOR[category],
              category,
              null,
            );
          }
        });
      },
    );

    await t.test(
      'a SUCCESSFUL settlement refuses the evidence, and is not admitted by unknown',
      async () => {
        await withSchema(async (fixture) => {
          const outbox = await fixture.newObligation();
          const attempt = await openAttempt(fixture, outbox);
          // THE THREE-VALUED-LOGIC PROOF. A success has a NULL
          // failure_category under Migration 52. Written as
          // `failure_category = 'rate_limited'` the constraint would
          // evaluate to NULL here, and PostgreSQL satisfies a CHECK on true
          // OR NULL -- so the evidence would be admitted onto a success by
          // *unknown*. `is not distinct from` is two-valued, so it is
          // refused like any other wrong category.
          const refusal = await message(() =>
            settle(fixture.db, attempt, 'succeeded', null, FIXTURE_RETRY_AFTER),
          );
          assert.match(refusal, /legal only for a rate_limited settlement/);
          // The constraint really is the null-safe form.
          const definition = await sql<{ def: string }>`
            select pg_get_constraintdef(c.oid) as def
              from pg_constraint c
              join pg_class t on t.oid = c.conrelid
              join pg_namespace n on n.oid = t.relnamespace
             where n.nspname = current_schema()
               and c.conname = 'integration_attempt_retry_after_rate_limited'
            `.execute(fixture.db);
          const row = definition.rows[0];
          assert.ok(row !== undefined, 'the constraint must exist');
          // PostgreSQL normalises `is not distinct from` to
          // `NOT (... IS DISTINCT FROM ...)`, so the stored form is matched
          // rather than the written one. What matters is that the
          // comparison is two-valued at all.
          assert.match(row.def, /NOT \(.*IS DISTINCT FROM/is);
          assert.doesNotMatch(
            row.def,
            /\(failure_category\)::text = /i,
            'a three-valued equality must not gate the constraint',
          );
        });
      },
    );

    await t.test(
      'the table constraints refuse independently of the guard',
      async () => {
        await withSchema(async (fixture) => {
          // DEFENCE IN DEPTH, proven rather than argued. The guard raises
          // first in every path above, so those assertions alone would still
          // pass if the table constraints were absent or three-valued.
          // Disabling the guard in this disposable schema leaves the
          // constraints as the only barrier, which is exactly the state a
          // future guard regression would create.
          const attempts: string[] = [];
          for (let index = 0; index < 3; index += 1) {
            const outbox = await fixture.newObligation();
            attempts.push(await openAttempt(fixture, outbox));
          }
          await sql`alter table integration_delivery_attempt
                      disable trigger user`.execute(fixture.db);
          try {
            // A wrong category.
            const wrongCategory = await message(() =>
              sql`update integration_delivery_attempt
                       set outcome = 'failed_transient',
                           completed_at = clock_timestamp(),
                           failure_category = 'destination_unavailable',
                           destination_retry_after_seconds =
                             ${FIXTURE_RETRY_AFTER}::integer
                     where id = ${attempts[0]}::uuid`.execute(fixture.db),
            );
            assert.match(wrongCategory, /retry_after_rate_limited/);

            // A NULL category, i.e. a success. THIS is the case a
            // three-valued `=` would have admitted by *unknown*.
            const nullCategory = await message(() =>
              sql`update integration_delivery_attempt
                       set outcome = 'succeeded',
                           completed_at = clock_timestamp(),
                           destination_retry_after_seconds =
                             ${FIXTURE_RETRY_AFTER}::integer
                     where id = ${attempts[1]}::uuid`.execute(fixture.db),
            );
            assert.match(nullCategory, /retry_after_rate_limited/);

            // And an open attempt. It violates BOTH new constraints at
            // once -- it is unsettled, and an open row's category is NULL
            // under Migration 52 -- and PostgreSQL reports whichever it
            // evaluates first, which is not ordered. Either name proves the
            // point; what must not happen is acceptance.
            const stillOpen = await message(() =>
              sql`update integration_delivery_attempt
                       set destination_retry_after_seconds =
                             ${FIXTURE_RETRY_AFTER}::integer
                     where id = ${attempts[2]}::uuid`.execute(fixture.db),
            );
            assert.match(
              stillOpen,
              /retry_after_(settled|rate_limited)/,
              'an open attempt must not accept destination retry evidence',
            );
          } finally {
            await sql`alter table integration_delivery_attempt
                        enable trigger user`.execute(fixture.db);
          }
        });
      },
    );

    await t.test(
      'the evidence is refused at creation, because an attempt is created open',
      async () => {
        await withSchema(async (fixture) => {
          const outbox = await fixture.newObligation();
          const refusal = await message(() =>
            openAttempt(fixture, outbox, {
              retryAfterSeconds: FIXTURE_RETRY_AFTER,
            }),
          );
          assert.match(refusal, /created without destination retry evidence/);
        });
      },
    );

    await t.test(
      'the evidence is refused on the dispatch-boundary update, while the attempt is open',
      async () => {
        await withSchema(async (fixture) => {
          const outbox = await fixture.newObligation();
          const attempt = await openAttempt(fixture, outbox);
          const refusal = await message(() =>
            sql`update integration_delivery_attempt
                   set dispatch_started_at = clock_timestamp(),
                       destination_retry_after_seconds =
                         ${FIXTURE_RETRY_AFTER}::integer
                 where id = ${attempt}::uuid`.execute(fixture.db),
          );
          assert.match(refusal, /requires a settled attempt/);
          // The boundary itself is still recordable without the evidence.
          await sql`update integration_delivery_attempt
                       set dispatch_started_at = clock_timestamp()
                     where id = ${attempt}::uuid`.execute(fixture.db);
          const row = await fixture.db
            .selectFrom('integration_delivery_attempt')
            .selectAll()
            .where('id', '=', attempt)
            .executeTakeFirstOrThrow();
          assert.notEqual(row.dispatch_started_at, null);
          assert.equal(row.destination_retry_after_seconds, null);
        });
      },
    );

    await t.test(
      'settled evidence can be neither changed nor cleared',
      async () => {
        await withSchema(async (fixture) => {
          const outbox = await fixture.newObligation();
          const attempt = await openAttempt(fixture, outbox);
          await settle(
            fixture.db,
            attempt,
            'failed_transient',
            'rate_limited',
            FIXTURE_RETRY_AFTER,
          );
          for (const next of [FIXTURE_RETRY_AFTER_TWO, null]) {
            const refusal = await message(() =>
              sql`update integration_delivery_attempt
                     set destination_retry_after_seconds = ${next}::integer
                   where id = ${attempt}::uuid`.execute(fixture.db),
            );
            assert.match(
              refusal,
              /settled integration delivery attempt is immutable/,
            );
          }
          const row = await fixture.db
            .selectFrom('integration_delivery_attempt')
            .selectAll()
            .where('id', '=', attempt)
            .executeTakeFirstOrThrow();
          assert.equal(
            row.destination_retry_after_seconds,
            FIXTURE_RETRY_AFTER,
          );
        });
      },
    );

    // ----------------------------------------------------------------
    // 4. Nothing is backfilled, and nothing else moved.
    // ----------------------------------------------------------------
    await t.test(
      'existing attempts keep NULL and the platform policy table stays empty',
      async () => {
        await withSchema(
          async (fixture) => {
            // Rows that exist BEFORE Migration 58 applies: one open, one
            // settled as rate_limited -- the shape most likely to be
            // wrongly backfilled.
            const openOutbox = await fixture.newObligation();
            const openId = await openAttempt(fixture, openOutbox);
            const settledOutbox = await fixture.newObligation();
            const settledId = await openAttempt(fixture, settledOutbox);
            await sql`update integration_delivery_attempt
                         set outcome = 'failed_transient',
                             completed_at = clock_timestamp(),
                             failure_category = 'rate_limited'
                       where id = ${settledId}::uuid`.execute(fixture.db);

            await retryAfterUp(fixture.db);

            const rows = await fixture.db
              .selectFrom('integration_delivery_attempt')
              .selectAll()
              .where('id', 'in', [openId, settledId])
              .execute();
            assert.equal(rows.length, 2);
            for (const row of rows)
              // NULL is the true statement that the destination stated no
              // retry floor for this attempt. No value is fabricated.
              assert.equal(row.destination_retry_after_seconds, null);

            const policies = await fixture.db
              .selectFrom('integration_execution_safety_policy')
              .selectAll()
              .execute();
            assert.deepEqual(policies, [], 'no platform policy row is created');

            const connector = await fixture.db
              .selectFrom('integration_connector')
              .selectAll()
              .where('id', '=', fixture.connectorId)
              .executeTakeFirstOrThrow();
            for (const column of [
              connector.request_execution_budget_seconds,
              connector.destination_retry_base_delay_seconds,
              connector.destination_retry_max_delay_seconds,
              connector.destination_retry_attempt_ceiling,
            ])
              assert.equal(column, null, 'connector policy is untouched');
          },
          { applyRetryAfterMigration: false },
        );
      },
    );

    // ----------------------------------------------------------------
    // 5. Anti-activation: the column is unwritable by anything shipped.
    // ----------------------------------------------------------------
    await t.test(
      'the completion function signature is unchanged and cannot carry the delay',
      async () => {
        await withSchema(async (fixture) => {
          const result = await sql<{ args: string }>`
            select pg_get_function_identity_arguments(p.oid) as args
              from pg_proc p
              join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = ${fixture.api}
               and p.proname = 'complete_integration_attempt'`.execute(
            fixture.db,
          );
          assert.equal(result.rows.length, 1, 'exactly one overload may exist');
          const row = result.rows[0];
          assert.ok(row !== undefined);
          // The F062.2D-2C-3-0 §27.3 frozen signature, unchanged. The eighth
          // parameter that would carry the delay is 3C's reviewed change.
          assert.equal(
            row.args,
            'target_organization uuid, target_obligation uuid, ' +
              'target_attempt uuid, expected_claim_generation bigint, ' +
              'raw_claim_token text, attempt_outcome character varying, ' +
              'attempt_failure_category character varying',
          );
          assert.equal(
            row.args.includes('integer'),
            false,
            'no parameter could carry the delay',
          );
        });
      },
    );

    await t.test(
      'the worker function inventory is unchanged and no recovery function exists',
      async () => {
        await withSchema(async (fixture) => {
          const result = await sql<{ name: string }>`
            select p.proname as name
              from pg_proc p
              join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = ${fixture.api}
             order by p.proname`.execute(fixture.db);
          assert.deepEqual(
            result.rows.map((row) => row.name),
            [
              'claim_integration_intent',
              'complete_integration_attempt',
              'mark_integration_dispatch_started',
            ],
            'no recovery function may exist yet',
          );
        });
      },
    );

    await t.test(
      'the new column carries no column-level grant of its own',
      async () => {
        await withSchema(async (fixture) => {
          const acl = await sql<{ attname: string }>`
            select a.attname
              from pg_attribute a
              join pg_class c on c.oid = a.attrelid
              join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = current_schema()
               and c.relname = 'integration_delivery_attempt'
               and a.attacl is not null
             order by a.attname`.execute(fixture.db);
          assert.deepEqual(acl.rows, []);
        });
      },
    );

    // ----------------------------------------------------------------
    // 6. Guard preservation and rollback.
    // ----------------------------------------------------------------
    await t.test(
      'Migration 58 preserves every clause of the Migration 57 guard, and down() restores it verbatim',
      async () => {
        await withSchema(
          async (fixture) => {
            const before = await guardDefinition(fixture.db);

            await retryAfterUp(fixture.db);
            const after = await guardDefinition(fixture.db);
            assert.notEqual(before, after, 'the guard must have been extended');

            // Clause-by-clause preservation: every line of the Migration 57
            // definition survives, in order, in the extended one.
            const originals = before
              .split('\n')
              .map((line) => line.trimEnd())
              .filter((line) => line.trim().length > 0);
            const extended = after.split('\n').map((line) => line.trimEnd());
            let cursor = 0;
            let preserved = 0;
            for (const line of originals) {
              const at = extended.indexOf(line, cursor);
              assert.notEqual(at, -1, `a guard clause was dropped: ${line}`);
              cursor = at + 1;
              preserved += 1;
            }
            assert.equal(preserved, originals.length);
            assert.ok(
              extended.length > originals.length,
              'the extension must add clauses',
            );

            // And the restore is byte-identical, not merely equivalent.
            await retryAfterDown(fixture.db);
            assert.equal(await guardDefinition(fixture.db), before);
          },
          { applyRetryAfterMigration: false },
        );
      },
    );

    await t.test(
      'the migration applies, rolls back cleanly and reapplies',
      async () => {
        await withSchema(
          async (fixture) => {
            const present = async (): Promise<boolean> =>
              (await columns(fixture.db, 'integration_delivery_attempt')).has(
                'destination_retry_after_seconds',
              );
            assert.equal(await present(), false);
            await retryAfterUp(fixture.db);
            assert.equal(await present(), true);
            // Legal only from the pristine post-apply state, where it
            // destroys nothing.
            await retryAfterDown(fixture.db);
            assert.equal(await present(), false);
            await retryAfterUp(fixture.db);
            assert.equal(await present(), true);

            // The three constraints come back with it.
            const constraints = await sql<{ conname: string }>`
              select c.conname
                from pg_constraint c
                join pg_class t on t.oid = c.conrelid
                join pg_namespace n on n.oid = t.relnamespace
               where n.nspname = current_schema()
                 and t.relname = 'integration_delivery_attempt'
                 and c.conname like 'integration_attempt_retry_after%'
               order by c.conname`.execute(fixture.db);
            assert.deepEqual(
              constraints.rows.map((row) => row.conname),
              [
                'integration_attempt_retry_after_nonnegative',
                'integration_attempt_retry_after_rate_limited',
                'integration_attempt_retry_after_settled',
              ],
            );
          },
          { applyRetryAfterMigration: false },
        );
      },
    );

    await t.test(
      'rollback is refused while evidence exists, and the evidence survives the refusal',
      async () => {
        // In its own disposable schema, so the test cannot defeat its own
        // point by cleaning up the evidence it exists to protect.
        await withSchema(async (fixture) => {
          const outbox = await fixture.newObligation();
          const attempt = await openAttempt(fixture, outbox);
          await settle(
            fixture.db,
            attempt,
            'failed_transient',
            'rate_limited',
            FIXTURE_RETRY_AFTER,
          );

          const refusal = await message(() => retryAfterDown(fixture.db));
          assert.match(
            refusal,
            /Retained integration destination retry evidence prevents rollback/,
          );

          // Nothing was deleted, nulled or rewritten to make it succeed.
          const row = await fixture.db
            .selectFrom('integration_delivery_attempt')
            .selectAll()
            .where('id', '=', attempt)
            .executeTakeFirstOrThrow();
          assert.equal(
            row.destination_retry_after_seconds,
            FIXTURE_RETRY_AFTER,
          );
          assert.equal(
            (await columns(fixture.db, 'integration_delivery_attempt')).has(
              'destination_retry_after_seconds',
            ),
            true,
            'the column survives the refusal',
          );
        });
      },
    );

    await t.test(
      'ZERO is retained evidence too, and also refuses rollback',
      async () => {
        await withSchema(async (fixture) => {
          const outbox = await fixture.newObligation();
          const attempt = await openAttempt(fixture, outbox);
          // Zero is a real instruction from the destination, not an absence.
          // A refusal keyed on truthiness rather than NULL would miss it.
          await settle(
            fixture.db,
            attempt,
            'failed_transient',
            'rate_limited',
            0,
          );
          const refusal = await message(() => retryAfterDown(fixture.db));
          assert.match(
            refusal,
            /Retained integration destination retry evidence prevents rollback/,
          );
        });
      },
    );
  },
);
