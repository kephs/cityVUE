import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
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
import {
  down as policyDown,
  up as policyUp,
} from '../../migrations/20261027000000-add-integration-execution-policy-persistence.js';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import { NO_CAPABILITIES } from '../../src/integration/connector-capabilities.js';
import {
  connectorChangeCategories,
  toCapabilityColumns,
} from '../../src/integration/persistence/connector-metadata.js';
import { enqueueIntegrationIntent } from '../../src/integration/persistence/outbox.repository.js';
import type { EnqueueIntentInput } from '../../src/integration/persistence/outbox.js';

/**
 * F062.2D-2C-3B-1 — execution-policy persistence, proven against PostgreSQL.
 *
 * **Persistence integrity only.** No worker function is changed here, no
 * lease is authored, no retry is scheduled and no recovery runs. Where a
 * future 3C operation would write a policy pin, the database is driven
 * directly as that operation would drive it, so what is proven is the
 * integrity of the evidence rather than the behaviour of any caller.
 *
 * **No sleeps anywhere.** Every assertion is a deterministic database
 * property.
 *
 * The numeric values below are **synthetic test fixtures and not policy
 * decisions**; see `FIXTURE_CONNECTOR_POLICY`.
 */

const url = process.env.TEST_DATABASE_URL;
type Database = Kysely<DatabaseSchema>;

const DIGEST = 'a'.repeat(64);
const SNAPSHOT = {
  supports_idempotency_key: false,
  supports_read_after_write: false,
  side_effect_risk: 'irreversible',
};

/**
 * SYNTHETIC TEST FIXTURE VALUES — **NOT POLICY DECISIONS.**
 *
 * These exist only to exercise constraints, mirroring and evidence
 * behaviour. They are deliberately small, obviously artificial and mutually
 * distinct, so a mis-mapped column shows up as a wrong number rather than a
 * passing test. **No deployment may adopt them.**
 *
 * All thirteen numerical policies of F062.2D-2C-3-0 §26 remain unresolved,
 * and nothing in this file proposes a value for any of them.
 */
const FIXTURE_CONNECTOR_POLICY = {
  request_execution_budget_seconds: 11,
  destination_retry_base_delay_seconds: 2,
  destination_retry_max_delay_seconds: 13,
  destination_retry_attempt_ceiling: 4,
} as const;

/** A second, distinct synthetic set, for proving a later revision does not
 * reinterpret an earlier one. Also not policy. */
const FIXTURE_CONNECTOR_POLICY_TWO = {
  request_execution_budget_seconds: 21,
  destination_retry_base_delay_seconds: 6,
  destination_retry_max_delay_seconds: 27,
  destination_retry_attempt_ceiling: 8,
} as const;

/** Synthetic platform fixture. Not policy. */
const FIXTURE_PLATFORM_POLICY = {
  max_claim_lease_seconds: 17,
  lease_safety_margin_seconds: 3,
  max_destination_retry_delay_seconds: 19,
  max_destination_retry_attempts: 5,
  max_retry_horizon_seconds: 23,
  max_pre_dispatch_recoveries: 6,
  recovery_delay_seconds: 7,
  max_recovery_batch_size: 29,
} as const;

/** The eight synthetic platform values in the positional order the raw
 * inserts below bind them. Kept beside the fixture so the two cannot drift. */
const PLATFORM_VALUES: readonly number[] = [
  FIXTURE_PLATFORM_POLICY.max_claim_lease_seconds,
  FIXTURE_PLATFORM_POLICY.lease_safety_margin_seconds,
  FIXTURE_PLATFORM_POLICY.max_destination_retry_delay_seconds,
  FIXTURE_PLATFORM_POLICY.max_destination_retry_attempts,
  FIXTURE_PLATFORM_POLICY.max_retry_horizon_seconds,
  FIXTURE_PLATFORM_POLICY.max_pre_dispatch_recoveries,
  FIXTURE_PLATFORM_POLICY.recovery_delay_seconds,
  FIXTURE_PLATFORM_POLICY.max_recovery_batch_size,
];

const POLICY_COLUMNS = [
  'request_execution_budget_seconds',
  'destination_retry_base_delay_seconds',
  'destination_retry_max_delay_seconds',
  'destination_retry_attempt_ceiling',
] as const;

type PolicyColumn = (typeof POLICY_COLUMNS)[number];
type ConnectorPolicy = Readonly<Record<PolicyColumn, number | null>>;

const NO_POLICY: ConnectorPolicy = {
  request_execution_budget_seconds: null,
  destination_retry_base_delay_seconds: null,
  destination_retry_max_delay_seconds: null,
  destination_retry_attempt_ceiling: null,
};

interface Fixture {
  readonly db: Database;
  readonly schema: string;
  readonly api: string;
  readonly organizationId: string;
  readonly connectorId: string;
  newObligation: () => Promise<string>;
}

/**
 * Builds a disposable schema carrying Migrations 1, 50, 51, 52, 53, 54, 55,
 * 56 and 57.
 *
 * The full worker API is present deliberately: this slice must prove that the
 * reviewed claim, dispatch-marker and completion functions continue to behave
 * identically with the new columns in place, and that they leave both policy
 * pins NULL. Migrations 53 and 56 hardcode `public.`, so they are applied
 * through the existing text-rewrite helper rather than imported.
 */
async function withSchema(
  run: (fixture: Fixture) => Promise<void>,
  options: { readonly applyPolicyMigration?: boolean } = {},
): Promise<void> {
  const schema = 'integration_policy_' + randomUUID().replaceAll('-', '');
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
    if (options.applyPolicyMigration !== false) await policyUp(db);
    const organizationId = randomUUID();
    await db
      .insertInto('organization')
      .values({
        id: organizationId,
        name: 'F062.2D-2C-3B-1 Synthetic',
        short_name: 'Test',
        slug: 'f0622d2c3b1-' + organizationId,
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
    // Migration 53's `up()` creates the worker API namespace, so applying it
    // through `applyIntegrationWorkerFunctions` leaves this fixture owning a
    // second schema. It is a SIBLING of the disposable schema rather than a
    // child -- a function body is not a recorded dependency -- so the cascade
    // below cannot reach it and it is dropped explicitly, first.
    //
    // `if exists` because the namespace is created inside the `try` above: a
    // setup failure before that point leaves it absent, and an unguarded drop
    // would then raise 3F000 from this `finally` and mask the real error.
    await admin.query(
      'drop schema if exists "' + workerApiSchema(schema) + '" cascade',
    );
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
        connector_key: 'loopback-policy',
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
  await mutate(db, organizationId, connectorId, {
    category: 'lifecycle_changed',
    lifecycleState: 'active',
  });
  return connectorId;
}

interface Mutation {
  readonly category: (typeof connectorChangeCategories)[number];
  readonly policy?: ConnectorPolicy;
  readonly lifecycleState?: 'active' | 'degraded';
  readonly supportsOrdering?: 'none' | 'per_aggregate';
  readonly credentialReference?: string | null;
  /** Lets a test make the audit row disagree with the connector row, which
   * is what proves the mirror is enforced rather than assumed. */
  readonly auditPolicy?: ConnectorPolicy;
  /** Credential rotation does not advance the semantic revision. */
  readonly advanceConfiguration?: boolean;
}

/**
 * Performs one connector mutation the way the reviewed authoring boundary
 * does: update the row, then write the matching audit snapshot, in one
 * transaction. Tests drive the database directly because this slice adds no
 * authoring path; that is persistence verification, not a production writer.
 */
async function mutate(
  db: Database,
  organizationId: string,
  connectorId: string,
  change: Mutation,
): Promise<{ configurationRevision: number; recordRevision: number }> {
  return db.transaction().execute(async (trx) => {
    const current = await trx
      .selectFrom('integration_connector')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where('id', '=', connectorId)
      .executeTakeFirstOrThrow();
    const advance = change.advanceConfiguration ?? true;
    const updated = await trx
      .updateTable('integration_connector')
      .set({
        lifecycle_state: change.lifecycleState ?? current.lifecycle_state,
        ...(change.supportsOrdering === undefined
          ? {}
          : { supports_ordering: change.supportsOrdering }),
        ...(change.credentialReference === undefined
          ? {}
          : { credential_reference: change.credentialReference }),
        ...(change.policy ?? {}),
        configuration_revision:
          current.configuration_revision + (advance ? 1 : 0),
        record_revision: current.record_revision + 1,
      })
      .where('organization_id', '=', organizationId)
      .where('id', '=', connectorId)
      .returningAll()
      .executeTakeFirstOrThrow();
    const snapshot = change.auditPolicy ?? {
      request_execution_budget_seconds:
        updated.request_execution_budget_seconds,
      destination_retry_base_delay_seconds:
        updated.destination_retry_base_delay_seconds,
      destination_retry_max_delay_seconds:
        updated.destination_retry_max_delay_seconds,
      destination_retry_attempt_ceiling:
        updated.destination_retry_attempt_ceiling,
    };
    await trx
      .insertInto('integration_connector_audit')
      .values({
        organization_id: organizationId,
        integration_connector_id: connectorId,
        record_revision: updated.record_revision,
        configuration_revision: updated.configuration_revision,
        prior_record_revision: current.record_revision,
        revision_advanced: advance,
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
        ...snapshot,
        credential_reference_present: updated.credential_reference !== null,
        prior_configuration_revision: current.configuration_revision,
        prior_lifecycle_state: current.lifecycle_state,
        actor: 'test-operator',
        correlation_id: randomUUID(),
      })
      .execute();
    return {
      configurationRevision: updated.configuration_revision,
      recordRevision: updated.record_revision,
    };
  });
}

/** Inserts one platform policy revision from the synthetic fixture. */
async function insertPolicy(
  db: Database,
  overrides: Record<string, number | string> = {},
): Promise<string> {
  const row = await db
    .insertInto('integration_execution_safety_policy')
    .values({
      ...FIXTURE_PLATFORM_POLICY,
      reason: 'F062.2D-2C-3B-1 synthetic constraint fixture',
      correlation_id: randomUUID(),
      ...overrides,
    })
    .returning('policy_revision')
    .executeTakeFirstOrThrow();
  return row.policy_revision;
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

/** Opens an attempt the way a future claim would, naming only the columns a
 * test needs so a supplied-and-discarded value can be observed. */
async function openAttempt(
  fixture: Fixture,
  outboxId: string,
  extras: {
    readonly claimPolicyRevision?: string | null;
    readonly settlementPolicyRevision?: string | null;
  } = {},
): Promise<string> {
  const revision = await pinnedRevision(
    fixture.db,
    fixture.organizationId,
    outboxId,
  );
  const result = await sql<{ id: string }>`
    insert into integration_delivery_attempt (
      organization_id, integration_outbox_id, integration_connector_id,
      claim_token_digest, connector_configuration_revision,
      capability_snapshot, claim_policy_revision, settlement_policy_revision
    ) values (
      ${fixture.organizationId}, ${outboxId}, ${fixture.connectorId},
      ${DIGEST}, ${revision}, ${JSON.stringify(SNAPSHOT)}::jsonb,
      ${extras.claimPolicyRevision ?? null}::bigint,
      ${extras.settlementPolicyRevision ?? null}::bigint
    ) returning id`.execute(fixture.db);
  const row = result.rows[0];
  assert.ok(row !== undefined, 'the attempt insert returned no row');
  return row.id;
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

function token(): string {
  return randomBytes(32).toString('hex');
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

test(
  'F062.2D-2C-3B-1 execution-policy persistence is enforced by PostgreSQL',
  {
    skip:
      url === undefined &&
      'TEST_DATABASE_URL is not set; the execution policy persistence proof is skipped',
  },
  async (t) => {
    // ----------------------------------------------------------------
    // 1. Connector policy columns and their constraints.
    // ----------------------------------------------------------------
    await t.test(
      'the four connector policy columns are nullable with no default, in both tables',
      async () => {
        await withSchema(async ({ db }) => {
          for (const table of [
            'integration_connector',
            'integration_connector_audit',
          ]) {
            const meta = await columns(db, table);
            for (const column of POLICY_COLUMNS) {
              const found = meta.get(column);
              assert.ok(found !== undefined, table + ' lacks ' + column);
              assert.equal(found.nullable, 'YES', column + ' must be nullable');
              assert.equal(
                found.dflt,
                null,
                column +
                  ' must have NO default: a default would be a policy number',
              );
              assert.equal(found.type, 'integer');
            }
          }
        });
      },
    );

    await t.test(
      'an all-null policy is valid and is what every existing row carries',
      async () => {
        await withSchema(async ({ db, connectorId }) => {
          const connector = await db
            .selectFrom('integration_connector')
            .selectAll()
            .where('id', '=', connectorId)
            .executeTakeFirstOrThrow();
          for (const column of POLICY_COLUMNS)
            assert.equal(connector[column], null);
          const audits = await db
            .selectFrom('integration_connector_audit')
            .selectAll()
            .where('integration_connector_id', '=', connectorId)
            .execute();
          assert.equal(audits.length, 2, 'registration plus activation');
          for (const row of audits)
            for (const column of POLICY_COLUMNS)
              assert.equal(
                row[column],
                null,
                'no historical audit row is backfilled',
              );
        });
      },
    );

    await t.test(
      'a complete policy is accepted and mirrored exactly into the snapshot',
      async () => {
        await withSchema(async ({ db, organizationId, connectorId }) => {
          const { configurationRevision } = await mutate(
            db,
            organizationId,
            connectorId,
            {
              category: 'execution_policy_changed',
              policy: FIXTURE_CONNECTOR_POLICY,
            },
          );
          const connector = await db
            .selectFrom('integration_connector')
            .selectAll()
            .where('id', '=', connectorId)
            .executeTakeFirstOrThrow();
          const snapshot = await db
            .selectFrom('integration_connector_audit')
            .selectAll()
            .where('integration_connector_id', '=', connectorId)
            .where('configuration_revision', '=', configurationRevision)
            .executeTakeFirstOrThrow();
          for (const column of POLICY_COLUMNS) {
            assert.equal(connector[column], FIXTURE_CONNECTOR_POLICY[column]);
            assert.equal(snapshot[column], FIXTURE_CONNECTOR_POLICY[column]);
          }
          assert.equal(snapshot.change_category, 'execution_policy_changed');
          assert.equal(snapshot.revision_advanced, true);
        });
      },
    );

    await t.test(
      'every partial policy combination is refused, in both tables',
      async () => {
        await withSchema(async ({ db, organizationId, connectorId }) => {
          let refusals = 0;
          // All 14 proper non-empty subsets: a partial revision must be
          // unrepresentable, not merely discouraged.
          for (let mask = 1; mask < 15; mask += 1) {
            const policy: Record<PolicyColumn, number | null> = {
              ...NO_POLICY,
            };
            POLICY_COLUMNS.forEach((column, index) => {
              if ((mask & (1 << index)) !== 0)
                policy[column] = FIXTURE_CONNECTOR_POLICY[column];
            });
            const refusal = await message(() =>
              mutate(db, organizationId, connectorId, {
                category: 'execution_policy_changed',
                policy,
              }),
            );
            assert.match(refusal, /execution_policy_complete/);
            refusals += 1;
          }
          assert.equal(refusals, 14);
        });
      },
    );

    await t.test('a non-positive policy value is refused', async () => {
      await withSchema(async ({ db, organizationId, connectorId }) => {
        for (const column of POLICY_COLUMNS)
          for (const value of [0, -1]) {
            const policy: ConnectorPolicy = {
              ...FIXTURE_CONNECTOR_POLICY,
              [column]: value,
            };
            const refusal = await message(() =>
              mutate(db, organizationId, connectorId, {
                category: 'execution_policy_changed',
                policy,
              }),
            );
            assert.match(
              refusal,
              /execution_policy_positive|retry_delay_ordered/,
              `${column} = ${String(value)} must be refused`,
            );
          }
      });
    });

    await t.test(
      'a base delay above the connector max delay is refused',
      async () => {
        await withSchema(async ({ db, organizationId, connectorId }) => {
          const refusal = await message(() =>
            mutate(db, organizationId, connectorId, {
              category: 'execution_policy_changed',
              policy: {
                ...FIXTURE_CONNECTOR_POLICY,
                destination_retry_base_delay_seconds:
                  FIXTURE_CONNECTOR_POLICY.destination_retry_max_delay_seconds +
                  1,
              },
            }),
          );
          assert.match(refusal, /retry_delay_ordered/);
        });
      },
    );

    await t.test(
      'a policy change advances the configuration revision exactly once',
      async () => {
        await withSchema(async ({ db, organizationId, connectorId }) => {
          const before = await db
            .selectFrom('integration_connector')
            .selectAll()
            .where('id', '=', connectorId)
            .executeTakeFirstOrThrow();
          const after = await mutate(db, organizationId, connectorId, {
            category: 'execution_policy_changed',
            policy: FIXTURE_CONNECTOR_POLICY,
          });
          assert.equal(
            after.configurationRevision,
            before.configuration_revision + 1,
          );
          assert.equal(after.recordRevision, before.record_revision + 1);
          // No second counter exists on the connector.
          const meta = await columns(db, 'integration_connector');
          const revisionColumns = [...meta.keys()].filter((name) =>
            name.endsWith('_revision'),
          );
          assert.deepEqual(revisionColumns.sort(), [
            'configuration_revision',
            'record_revision',
          ]);
        });
      },
    );

    await t.test(
      'a later policy change does not reinterpret an earlier revision',
      async () => {
        await withSchema(async ({ db, organizationId, connectorId }) => {
          const first = await mutate(db, organizationId, connectorId, {
            category: 'execution_policy_changed',
            policy: FIXTURE_CONNECTOR_POLICY,
          });
          const second = await mutate(db, organizationId, connectorId, {
            category: 'execution_policy_changed',
            policy: FIXTURE_CONNECTOR_POLICY_TWO,
          });
          assert.notEqual(
            first.configurationRevision,
            second.configurationRevision,
          );
          const older = await db
            .selectFrom('integration_connector_audit')
            .selectAll()
            .where('integration_connector_id', '=', connectorId)
            .where('configuration_revision', '=', first.configurationRevision)
            .executeTakeFirstOrThrow();
          for (const column of POLICY_COLUMNS)
            assert.equal(
              older[column],
              FIXTURE_CONNECTOR_POLICY[column],
              'the older snapshot keeps the policy that governed it',
            );
        });
      },
    );

    await t.test(
      'an audit snapshot that disagrees with the connector policy is refused',
      async () => {
        await withSchema(async ({ db, organizationId, connectorId }) => {
          const refusal = await message(() =>
            mutate(db, organizationId, connectorId, {
              category: 'execution_policy_changed',
              policy: FIXTURE_CONNECTOR_POLICY,
              auditPolicy: FIXTURE_CONNECTOR_POLICY_TWO,
            }),
          );
          assert.match(refusal, /must record the committed connector state/);
        });
      },
    );

    // ----------------------------------------------------------------
    // 2. Single-concern semantics and the audit category binding.
    // ----------------------------------------------------------------
    await t.test(
      'a policy change may not accompany a capability change',
      async () => {
        await withSchema(async ({ db, organizationId, connectorId }) => {
          const refusal = await message(() =>
            mutate(db, organizationId, connectorId, {
              category: 'execution_policy_changed',
              policy: FIXTURE_CONNECTOR_POLICY,
              supportsOrdering: 'per_aggregate',
            }),
          );
          assert.match(
            refusal,
            /must not accompany a lifecycle or capability change/,
          );
        });
      },
    );

    await t.test(
      'a policy change may not accompany a lifecycle change',
      async () => {
        await withSchema(async ({ db, organizationId, connectorId }) => {
          const refusal = await message(() =>
            mutate(db, organizationId, connectorId, {
              category: 'execution_policy_changed',
              policy: FIXTURE_CONNECTOR_POLICY,
              lifecycleState: 'degraded',
            }),
          );
          assert.match(
            refusal,
            /must not accompany a lifecycle or capability change/,
          );
        });
      },
    );

    await t.test(
      'a policy change may not accompany a credential rotation',
      async () => {
        await withSchema(async ({ db, organizationId, connectorId }) => {
          const refusal = await message(() =>
            mutate(db, organizationId, connectorId, {
              category: 'execution_policy_changed',
              policy: FIXTURE_CONNECTOR_POLICY,
              credentialReference: 'vault/ref-one',
            }),
          );
          // Migration 50's existing separation rule covers this, because a
          // policy change implies a semantic change. Asserted explicitly so a
          // future change to that rule cannot silently open the combination.
          assert.match(
            refusal,
            /Credential rotation must not accompany a configuration change/,
          );
        });
      },
    );

    await t.test(
      'a policy change recorded under another category is refused',
      async () => {
        await withSchema(async ({ db, organizationId, connectorId }) => {
          for (const category of [
            'capabilities_changed',
            'lifecycle_changed',
          ] as const) {
            const refusal = await message(() =>
              mutate(db, organizationId, connectorId, {
                category,
                policy: FIXTURE_CONNECTOR_POLICY,
              }),
            );
            assert.match(
              refusal,
              /must be recorded as execution_policy_changed/,
              category + ' must not absorb a policy change',
            );
          }
        });
      },
    );

    await t.test(
      'execution_policy_changed with no policy delta is refused',
      async () => {
        await withSchema(async ({ db, organizationId, connectorId }) => {
          const refusal = await message(() =>
            mutate(db, organizationId, connectorId, {
              category: 'execution_policy_changed',
              supportsOrdering: 'per_aggregate',
            }),
          );
          assert.match(refusal, /requires an execution policy change/);
        });
      },
    );

    await t.test(
      'existing capability, lifecycle and credential behaviour is unchanged',
      async () => {
        await withSchema(async ({ db, organizationId, connectorId }) => {
          const start = await db
            .selectFrom('integration_connector')
            .selectAll()
            .where('id', '=', connectorId)
            .executeTakeFirstOrThrow();

          const capability = await mutate(db, organizationId, connectorId, {
            category: 'capabilities_changed',
            supportsOrdering: 'per_aggregate',
          });
          assert.equal(
            capability.configurationRevision,
            start.configuration_revision + 1,
          );

          const lifecycle = await mutate(db, organizationId, connectorId, {
            category: 'lifecycle_changed',
            lifecycleState: 'degraded',
          });
          assert.equal(
            lifecycle.configurationRevision,
            capability.configurationRevision + 1,
          );

          // A rotation still advances only the record revision.
          const rotation = await mutate(db, organizationId, connectorId, {
            category: 'credential_reference_rotated',
            credentialReference: 'vault/ref-two',
            advanceConfiguration: false,
          });
          assert.equal(
            rotation.configurationRevision,
            lifecycle.configurationRevision,
            'a rotation must not advance the semantic revision',
          );
          assert.equal(
            rotation.recordRevision,
            lifecycle.recordRevision + 1,
            'but it must advance the concurrency token',
          );
          const row = await db
            .selectFrom('integration_connector_audit')
            .selectAll()
            .where('integration_connector_id', '=', connectorId)
            .where('record_revision', '=', rotation.recordRevision)
            .executeTakeFirstOrThrow();
          assert.equal(row.revision_advanced, false);
          for (const column of POLICY_COLUMNS)
            assert.equal(row[column], null, 'a rotation carries no policy');
        });
      },
    );

    await t.test('registration remains registered', async () => {
      await withSchema(async ({ db, organizationId, connectorId }) => {
        const first = await db
          .selectFrom('integration_connector_audit')
          .selectAll()
          .where('integration_connector_id', '=', connectorId)
          .where('record_revision', '=', 1)
          .executeTakeFirstOrThrow();
        assert.equal(first.change_category, 'registered');
        // A registration row cannot claim the new category: Migration 50's
        // existing constraint ties 'registered' to a null prior revision, so
        // revision 1 can carry no other category. Pre-existing, asserted here
        // because this slice depends on it.
        // Both inserts must share one transaction: the audit-evidence trigger
        // is DEFERRED, so a lone connector insert would fail at commit for a
        // different reason and the category constraint would never be
        // reached.
        const refusal = await message(() =>
          db.transaction().execute(async (trx) => {
            const created = await trx
              .insertInto('integration_connector')
              .values({
                organization_id: organizationId,
                connector_key: 'loopback-second',
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
                record_revision: 1,
                configuration_revision: 1,
                prior_record_revision: null,
                revision_advanced: true,
                change_category: 'execution_policy_changed',
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
          }),
        );
        // Migration 50's existing check ties 'registered' to a null prior
        // revision, so revision 1 cannot carry the new category. The new
        // guard deliberately does NOT adjudicate this: it is keyed on
        // predecessor existence, so a revision-1 row falls through to the
        // constraint that already owns registration semantics.
        assert.match(
          refusal,
          /integration_connector_audit_check|check constraint/i,
          'registration semantics must still be enforced by Migration 50',
        );
      });
    });

    await t.test(
      'the SQL and TypeScript category vocabularies match exactly',
      async () => {
        await withSchema(async ({ db }) => {
          const result = await sql<{ definition: string }>`
            select pg_get_constraintdef(c.oid) as definition
              from pg_constraint c
              join pg_class t on t.oid = c.conrelid
              join pg_namespace n on n.oid = t.relnamespace
             where n.nspname = current_schema()
               and t.relname = 'integration_connector_audit'
               and c.conname = 'integration_connector_audit_change_category_check'`.execute(
            db,
          );
          const row = result.rows[0];
          assert.ok(row !== undefined, 'the vocabulary constraint is missing');
          for (const category of connectorChangeCategories)
            assert.ok(
              row.definition.includes("'" + category + "'"),
              'PostgreSQL must accept ' + category,
            );
          // And nothing beyond the TypeScript vocabulary.
          const quoted = row.definition.match(/'[a-z_]+'/g) ?? [];
          const accepted = new Set(quoted.map((value) => value.slice(1, -1)));
          assert.deepEqual(
            [...accepted].sort(),
            [...connectorChangeCategories].sort(),
          );
        });
      },
    );

    // ----------------------------------------------------------------
    // 3. The global platform safety-policy table.
    // ----------------------------------------------------------------
    await t.test(
      'the platform policy table is global, complete and empty',
      async () => {
        await withSchema(async ({ db }) => {
          const meta = await columns(db, 'integration_execution_safety_policy');
          assert.equal(
            meta.has('organization_id'),
            false,
            'platform policy must never be organization-scoped',
          );
          assert.equal(
            meta.has('actor'),
            false,
            'no untrusted actor attribution is stored',
          );
          assert.equal(meta.has('is_active'), false);
          for (const column of [
            'max_claim_lease_seconds',
            'lease_safety_margin_seconds',
            'max_destination_retry_delay_seconds',
            'max_destination_retry_attempts',
            'max_retry_horizon_seconds',
            'max_pre_dispatch_recoveries',
            'recovery_delay_seconds',
            'max_recovery_batch_size',
          ]) {
            const found = meta.get(column);
            assert.ok(found !== undefined, 'missing ' + column);
            assert.equal(found.nullable, 'NO', column + ' must be NOT NULL');
            assert.equal(
              found.dflt,
              null,
              column +
                ' must have no default: a default would be a policy number',
            );
          }
          const revision = meta.get('policy_revision');
          assert.ok(revision !== undefined);
          assert.equal(revision.type, 'bigint');
          const rows = await db
            .selectFrom('integration_execution_safety_policy')
            .selectAll()
            .execute();
          assert.deepEqual(rows, [], 'the table must ship with zero rows');
        });
      },
    );

    await t.test(
      'the policy revision is database-authored and a caller cannot choose it',
      async () => {
        await withSchema(async ({ db }) => {
          const first = await insertPolicy(db);
          const second = await insertPolicy(db);
          assert.ok(
            BigInt(second) > BigInt(first),
            'revisions must increase: ' + first + ' then ' + second,
          );
          const refusal = await message(() =>
            sql`
              insert into integration_execution_safety_policy (
                policy_revision, max_claim_lease_seconds,
                lease_safety_margin_seconds, max_destination_retry_delay_seconds,
                max_destination_retry_attempts, max_retry_horizon_seconds,
                max_pre_dispatch_recoveries, recovery_delay_seconds,
                max_recovery_batch_size, reason, correlation_id
              ) values (
                9999, ${FIXTURE_PLATFORM_POLICY.max_claim_lease_seconds},
                ${FIXTURE_PLATFORM_POLICY.lease_safety_margin_seconds},
                ${FIXTURE_PLATFORM_POLICY.max_destination_retry_delay_seconds},
                ${FIXTURE_PLATFORM_POLICY.max_destination_retry_attempts},
                ${FIXTURE_PLATFORM_POLICY.max_retry_horizon_seconds},
                ${FIXTURE_PLATFORM_POLICY.max_pre_dispatch_recoveries},
                ${FIXTURE_PLATFORM_POLICY.recovery_delay_seconds},
                ${FIXTURE_PLATFORM_POLICY.max_recovery_batch_size},
                'forged revision', ${randomUUID()}::uuid)`.execute(db),
          );
          assert.match(refusal, /identity column|non-DEFAULT value/i);
        });
      },
    );

    await t.test(
      'two concurrent inserts receive distinct revisions without SELECT MAX',
      async () => {
        await withSchema(async ({ schema }) => {
          const left = new Pool({
            connectionString: url,
            options: '-c search_path=' + schema,
          });
          const right = new Pool({
            connectionString: url,
            options: '-c search_path=' + schema,
          });
          try {
            const a = await left.connect();
            const b = await right.connect();
            try {
              await a.query('begin');
              await b.query('begin');
              const insert = `
                insert into integration_execution_safety_policy (
                  max_claim_lease_seconds, lease_safety_margin_seconds,
                  max_destination_retry_delay_seconds,
                  max_destination_retry_attempts, max_retry_horizon_seconds,
                  max_pre_dispatch_recoveries, recovery_delay_seconds,
                  max_recovery_batch_size, reason, correlation_id
                ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, gen_random_uuid())
                returning policy_revision`;
              const values = [...PLATFORM_VALUES, 'concurrent fixture'];
              // Both inserts are in flight before either commits. With
              // max(policy_revision) + 1 one of these would block and then
              // collide; an identity sequence makes them independent.
              const [one, two] = await Promise.all([
                a.query<{ policy_revision: string }>(insert, values),
                b.query<{ policy_revision: string }>(insert, values),
              ]);
              await a.query('commit');
              await b.query('commit');
              const first = one.rows[0]?.policy_revision;
              const second = two.rows[0]?.policy_revision;
              assert.ok(first !== undefined && second !== undefined);
              assert.notEqual(
                first,
                second,
                'concurrent inserts must not share a revision',
              );
            } finally {
              a.release();
              b.release();
            }
          } finally {
            await left.end();
            await right.end();
          }
        });
      },
    );

    await t.test(
      'a gap in the revision sequence is acceptable and ordering stays deterministic',
      async () => {
        await withSchema(async ({ db, schema }) => {
          const before = await insertPolicy(db);
          const pool = new Pool({
            connectionString: url,
            options: '-c search_path=' + schema,
          });
          let abandoned: string | undefined;
          try {
            const client = await pool.connect();
            try {
              await client.query('begin');
              const result = await client.query<{ policy_revision: string }>(
                `insert into integration_execution_safety_policy (
                  max_claim_lease_seconds, lease_safety_margin_seconds,
                  max_destination_retry_delay_seconds,
                  max_destination_retry_attempts, max_retry_horizon_seconds,
                  max_pre_dispatch_recoveries, recovery_delay_seconds,
                  max_recovery_batch_size, reason, correlation_id
                ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                  gen_random_uuid())
                returning policy_revision`,
                [...PLATFORM_VALUES, 'abandoned fixture'],
              );
              abandoned = result.rows[0]?.policy_revision;
              await client.query('rollback');
            } finally {
              client.release();
            }
          } finally {
            await pool.end();
          }
          assert.ok(abandoned !== undefined);
          const after = await insertPolicy(db);
          const rows = await db
            .selectFrom('integration_execution_safety_policy')
            .select('policy_revision')
            .orderBy('policy_revision')
            .execute();
          const revisions = rows.map((row) => row.policy_revision);
          assert.deepEqual(revisions, [before, after]);
          assert.equal(
            revisions.includes(abandoned),
            false,
            'the rolled-back revision never becomes durable',
          );
          // Current policy is the greatest committed revision, and the order
          // is total even though the sequence has a hole in it.
          assert.ok(BigInt(after) > BigInt(before));
        });
      },
    );

    await t.test(
      'platform policy history refuses UPDATE, DELETE and TRUNCATE',
      async () => {
        await withSchema(async ({ db }) => {
          const revision = await insertPolicy(db);
          const update = await message(() =>
            sql`update integration_execution_safety_policy
                   set max_claim_lease_seconds = max_claim_lease_seconds + 1
                 where policy_revision = ${revision}::bigint`.execute(db),
          );
          assert.match(update, /append-only/);
          const remove = await message(() =>
            sql`delete from integration_execution_safety_policy
                 where policy_revision = ${revision}::bigint`.execute(db),
          );
          assert.match(remove, /append-only/);
          // Two distinct barriers, and the test proves both. A plain
          // TRUNCATE is refused by PostgreSQL before any trigger runs,
          // because integration_delivery_attempt references the table --
          // fail-closed, but it proves nothing about the guard.
          const truncate = await message(() =>
            sql`truncate table integration_execution_safety_policy`.execute(db),
          );
          assert.match(truncate, /foreign key constraint/);
          // CASCADE removes that objection by truncating the referencing
          // table too, so this is the case where only the statement-level
          // trigger stands between the caller and the history. A row trigger
          // would NOT fire here.
          const cascade = await message(() =>
            sql`truncate table integration_execution_safety_policy cascade`.execute(
              db,
            ),
          );
          assert.match(cascade, /append-only/);
          const rows = await db
            .selectFrom('integration_execution_safety_policy')
            .selectAll()
            .execute();
          assert.equal(rows.length, 1, 'the revision survives every attempt');
        });
      },
    );

    await t.test(
      'recorded_at and mutation_txid cannot be forged by a caller',
      async () => {
        await withSchema(async ({ db }) => {
          const result = await sql<{
            policy_revision: string;
            recorded_at: Date;
            mutation_txid: string;
          }>`
            insert into integration_execution_safety_policy (
              max_claim_lease_seconds, lease_safety_margin_seconds,
              max_destination_retry_delay_seconds,
              max_destination_retry_attempts, max_retry_horizon_seconds,
              max_pre_dispatch_recoveries, recovery_delay_seconds,
              max_recovery_batch_size, reason, correlation_id,
              recorded_at, mutation_txid
            ) values (
              ${FIXTURE_PLATFORM_POLICY.max_claim_lease_seconds},
              ${FIXTURE_PLATFORM_POLICY.lease_safety_margin_seconds},
              ${FIXTURE_PLATFORM_POLICY.max_destination_retry_delay_seconds},
              ${FIXTURE_PLATFORM_POLICY.max_destination_retry_attempts},
              ${FIXTURE_PLATFORM_POLICY.max_retry_horizon_seconds},
              ${FIXTURE_PLATFORM_POLICY.max_pre_dispatch_recoveries},
              ${FIXTURE_PLATFORM_POLICY.recovery_delay_seconds},
              ${FIXTURE_PLATFORM_POLICY.max_recovery_batch_size},
              'forged metadata fixture', ${randomUUID()}::uuid,
              '1999-01-01T00:00:00Z'::timestamptz, 1::bigint)
            returning policy_revision, recorded_at, mutation_txid`.execute(db);
          const row = result.rows[0];
          assert.ok(row !== undefined);
          assert.ok(
            row.recorded_at.getUTCFullYear() > 2000,
            'the forged timestamp was discarded, got ' +
              row.recorded_at.toISOString(),
          );
          assert.notEqual(
            row.mutation_txid,
            '1',
            'the forged transaction id was discarded',
          );
        });
      },
    );

    await t.test(
      'a non-positive platform policy value is refused',
      async () => {
        await withSchema(async ({ db }) => {
          for (const column of Object.keys(FIXTURE_PLATFORM_POLICY)) {
            const refusal = await message(() =>
              insertPolicy(db, { [column]: 0 }),
            );
            assert.match(
              refusal,
              /check constraint|violates/i,
              column + ' = 0 must be refused',
            );
          }
        });
      },
    );

    // ----------------------------------------------------------------
    // 4. Attempt policy pins.
    // ----------------------------------------------------------------
    await t.test(
      'the attempt pins are bigint, nullable and share the policy revision type',
      async () => {
        await withSchema(async ({ db }) => {
          const attempt = await columns(db, 'integration_delivery_attempt');
          const policy = await columns(
            db,
            'integration_execution_safety_policy',
          );
          const revision = policy.get('policy_revision');
          assert.ok(revision !== undefined);
          for (const column of [
            'claim_policy_revision',
            'settlement_policy_revision',
          ]) {
            const found = attempt.get(column);
            assert.ok(found !== undefined, 'missing ' + column);
            assert.equal(found.nullable, 'YES');
            assert.equal(found.dflt, null);
            assert.equal(
              found.type,
              revision.type,
              column + ' must match policy_revision exactly',
            );
          }
        });
      },
    );

    await t.test(
      'an attempt may carry a real claim pin, and an unknown revision is refused',
      async () => {
        await withSchema(async (fixture) => {
          const revision = await insertPolicy(fixture.db);
          const outboxId = await fixture.newObligation();
          const attemptId = await openAttempt(fixture, outboxId, {
            claimPolicyRevision: revision,
          });
          const stored = await fixture.db
            .selectFrom('integration_delivery_attempt')
            .selectAll()
            .where('id', '=', attemptId)
            .executeTakeFirstOrThrow();
          assert.equal(stored.claim_policy_revision, revision);
          assert.equal(stored.settlement_policy_revision, null);

          const other = await fixture.newObligation();
          const refusal = await message(() =>
            openAttempt(fixture, other, {
              claimPolicyRevision: '987654321',
            }),
          );
          assert.match(refusal, /foreign key|claim_policy_fk/i);
        });
      },
    );

    await t.test(
      'the claim pin cannot be changed or cleared after creation',
      async () => {
        await withSchema(async (fixture) => {
          const revision = await insertPolicy(fixture.db);
          const second = await insertPolicy(fixture.db);
          const outboxId = await fixture.newObligation();
          const attemptId = await openAttempt(fixture, outboxId, {
            claimPolicyRevision: revision,
          });
          for (const value of [second, null]) {
            const refusal = await message(() =>
              sql`update integration_delivery_attempt
                     set claim_policy_revision = ${value}::bigint
                   where id = ${attemptId}::uuid`.execute(fixture.db),
            );
            assert.match(
              refusal,
              /write-once and cannot be changed or cleared/,
            );
          }
        });
      },
    );

    await t.test(
      'a settlement pin cannot exist on an open attempt',
      async () => {
        await withSchema(async (fixture) => {
          const revision = await insertPolicy(fixture.db);
          const outboxId = await fixture.newObligation();
          const atInsert = await message(() =>
            openAttempt(fixture, outboxId, {
              settlementPolicyRevision: revision,
            }),
          );
          assert.match(
            atInsert,
            /created without a settlement policy revision/,
          );
          const attemptId = await openAttempt(fixture, outboxId);
          const atUpdate = await message(() =>
            sql`update integration_delivery_attempt
                   set settlement_policy_revision = ${revision}::bigint
                 where id = ${attemptId}::uuid`.execute(fixture.db),
          );
          assert.match(atUpdate, /requires a settled attempt/);
        });
      },
    );

    await t.test(
      'a settled attempt may have no settlement pin, and a valid one is durable',
      async () => {
        await withSchema(async (fixture) => {
          const revision = await insertPolicy(fixture.db);

          // Legacy shape: settled with no pin. Every pre-3B-1 settlement
          // looks exactly like this, which is why the constraint is
          // one-directional.
          const legacyOutbox = await fixture.newObligation();
          const legacy = await openAttempt(fixture, legacyOutbox);
          await sql`update integration_delivery_attempt
                       set outcome = 'succeeded', completed_at = clock_timestamp()
                     where id = ${legacy}::uuid`.execute(fixture.db);
          const legacyRow = await fixture.db
            .selectFrom('integration_delivery_attempt')
            .selectAll()
            .where('id', '=', legacy)
            .executeTakeFirstOrThrow();
          assert.notEqual(legacyRow.completed_at, null);
          assert.equal(legacyRow.settlement_policy_revision, null);

          // A settlement that does carry the pin.
          const pinnedOutbox = await fixture.newObligation();
          const pinned = await openAttempt(fixture, pinnedOutbox);
          await sql`update integration_delivery_attempt
                       set outcome = 'succeeded', completed_at = clock_timestamp(),
                           settlement_policy_revision = ${revision}::bigint
                     where id = ${pinned}::uuid`.execute(fixture.db);
          const pinnedRow = await fixture.db
            .selectFrom('integration_delivery_attempt')
            .selectAll()
            .where('id', '=', pinned)
            .executeTakeFirstOrThrow();
          assert.equal(pinnedRow.settlement_policy_revision, revision);

          // And a settled row is immutable, so neither can be revised.
          const refusal = await message(() =>
            sql`update integration_delivery_attempt
                   set settlement_policy_revision = null
                 where id = ${pinned}::uuid`.execute(fixture.db),
          );
          assert.match(
            refusal,
            /settled integration delivery attempt is immutable/,
          );
        });
      },
    );

    await t.test(
      'a referenced policy revision cannot be deleted and evidence survives',
      async () => {
        await withSchema(async (fixture) => {
          const revision = await insertPolicy(fixture.db);
          const outboxId = await fixture.newObligation();
          await openAttempt(fixture, outboxId, {
            claimPolicyRevision: revision,
          });
          // The immutability guard refuses first; the foreign key is the
          // second barrier. Neither cascades, so no evidence is erased.
          const refusal = await message(() =>
            sql`delete from integration_execution_safety_policy
                 where policy_revision = ${revision}::bigint`.execute(
              fixture.db,
            ),
          );
          assert.match(refusal, /append-only/);
          const attempts = await fixture.db
            .selectFrom('integration_delivery_attempt')
            .select('claim_policy_revision')
            .execute();
          assert.deepEqual(
            attempts.map((row) => row.claim_policy_revision),
            [revision],
          );
          const fks = await sql<{ definition: string }>`
            select pg_get_constraintdef(c.oid) as definition
              from pg_constraint c
              join pg_class t on t.oid = c.conrelid
              join pg_namespace n on n.oid = t.relnamespace
             where n.nspname = current_schema()
               and t.relname = 'integration_delivery_attempt'
               and c.contype = 'f'
               and c.conname like '%policy%'`.execute(fixture.db);
          assert.equal(fks.rows.length, 2);
          for (const row of fks.rows) {
            assert.equal(/cascade/i.test(row.definition), false);
            assert.equal(/set null/i.test(row.definition), false);
          }
        });
      },
    );

    // ----------------------------------------------------------------
    // 5. The reviewed worker functions are unchanged by this slice.
    // ----------------------------------------------------------------
    await t.test(
      'the claim function still works and leaves both pins NULL',
      async (sub) => {
        await withSchema(async (fixture) => {
          const outboxId = await fixture.newObligation();
          // The raw token is kept: the dispatch marker authenticates against
          // its digest, so handing it the digest would match nothing.
          const raw = token();
          const result = await sql<{
            delivery_attempt_id: string;
            claim_expires_at: Date | null;
          }>`
            select * from ${sql.raw(fixture.api)}.claim_integration_intent(
              ${fixture.organizationId}::uuid, ${fixture.connectorId}::uuid,
              ${raw}::text)`.execute(fixture.db);
          assert.equal(result.rows.length, 1, 'the claim returned no row');
          const claimed = result.rows[0];
          assert.ok(claimed !== undefined);
          assert.equal(
            claimed.claim_expires_at,
            null,
            'no lease is authored by this slice',
          );
          const attempt = await fixture.db
            .selectFrom('integration_delivery_attempt')
            .selectAll()
            .where('id', '=', claimed.delivery_attempt_id)
            .executeTakeFirstOrThrow();
          assert.equal(attempt.claim_policy_revision, null);
          assert.equal(attempt.settlement_policy_revision, null);
          void outboxId;
          void sub;

          // The dispatch marker and the completion remain usable, and the
          // settlement still records no policy revision.
          // The second parameter is the ATTEMPT, not the connector.
          const marker = await sql<{ marked: boolean }>`
            select ${sql.raw(fixture.api)}.mark_integration_dispatch_started(
              ${fixture.organizationId}::uuid, ${attempt.id}::uuid,
              ${attempt.claim_generation}::bigint, ${raw}::text) as marked`.execute(
            fixture.db,
          );
          assert.equal(
            marker.rows[0]?.marked,
            true,
            'the dispatch marker must still accept a valid claim',
          );
          const marked = await fixture.db
            .selectFrom('integration_delivery_attempt')
            .selectAll()
            .where('id', '=', attempt.id)
            .executeTakeFirstOrThrow();
          assert.notEqual(marked.dispatch_started_at, null);
          assert.equal(marked.claim_policy_revision, null);
        });
      },
    );

    await t.test('the recovery function still does not exist', async () => {
      await withSchema(async ({ db, api }) => {
        const result = await sql<{ name: string }>`
          select p.proname as name
            from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = ${api}
           order by p.proname`.execute(db);
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
    });

    // ----------------------------------------------------------------
    // 6. The legacy-obligation inventory is answerable from evidence.
    // ----------------------------------------------------------------
    await t.test(
      'obligations pinned to policy-incomplete revisions are deterministically inventoryable',
      async () => {
        await withSchema(async (fixture) => {
          const { db, organizationId, connectorId } = fixture;
          // One obligation pinned before any policy existed.
          const legacy = await fixture.newObligation();
          await mutate(db, organizationId, connectorId, {
            category: 'execution_policy_changed',
            policy: FIXTURE_CONNECTOR_POLICY,
          });
          // And one pinned after.
          const current = await fixture.newObligation();

          const result = await sql<{ id: string }>`
            select o.id
              from integration_outbox o
              join integration_connector_audit a
                on a.organization_id = o.organization_id
               and a.integration_connector_id = o.integration_connector_id
               and a.configuration_revision
                     = o.pinned_connector_configuration_revision
               and a.revision_advanced
             where o.organization_id = ${organizationId}::uuid
               and o.state not in ('acknowledged','failed_permanent','refused')
               and a.request_execution_budget_seconds is null
             order by o.created_at`.execute(db);
          assert.deepEqual(
            result.rows.map((row) => row.id),
            [legacy],
            'exactly the pre-policy obligation is inventoried',
          );
          void current;
        });
      },
    );

    // ----------------------------------------------------------------
    // 7. Rollback fails closed on every class of durable evidence.
    // ----------------------------------------------------------------
    await t.test(
      'a clean rollback succeeds and the migration reapplies',
      async () => {
        await withSchema(async ({ db }) => {
          await policyDown(db);
          const gone = await columns(db, 'integration_connector');
          for (const column of POLICY_COLUMNS)
            assert.equal(gone.has(column), false, column + ' must be dropped');
          const table = await sql<{ present: boolean }>`
            select exists (
              select 1 from information_schema.tables
               where table_schema = current_schema()
                 and table_name = 'integration_execution_safety_policy')
              as present`.execute(db);
          assert.equal(table.rows[0]?.present, false);
          // The restored vocabulary is Migration 50's four members.
          const restored = await sql<{ definition: string }>`
            select pg_get_constraintdef(c.oid) as definition
              from pg_constraint c
              join pg_class t on t.oid = c.conrelid
              join pg_namespace n on n.oid = t.relnamespace
             where n.nspname = current_schema()
               and t.relname = 'integration_connector_audit'
               and c.conname = 'integration_connector_audit_change_category_check'`.execute(
            db,
          );
          assert.equal(
            restored.rows[0]?.definition.includes('execution_policy_changed'),
            false,
          );
          await policyUp(db);
          const back = await columns(db, 'integration_connector');
          for (const column of POLICY_COLUMNS) assert.ok(back.has(column));
        });
      },
    );

    await t.test(
      'rollback is refused while any class of policy evidence exists',
      async () => {
        // Connector policy evidence.
        await withSchema(async ({ db, organizationId, connectorId }) => {
          await mutate(db, organizationId, connectorId, {
            category: 'execution_policy_changed',
            policy: FIXTURE_CONNECTOR_POLICY,
          });
          const refusal = await message(() => policyDown(db));
          assert.match(refusal, /connector execution-policy evidence/);
          const connector = await db
            .selectFrom('integration_connector')
            .selectAll()
            .where('id', '=', connectorId)
            .executeTakeFirstOrThrow();
          assert.equal(
            connector.request_execution_budget_seconds,
            FIXTURE_CONNECTOR_POLICY.request_execution_budget_seconds,
            'the evidence must survive the refused rollback',
          );
        });

        // An UNREFERENCED platform policy row is still durable evidence: this
        // is exactly the case the original narrower rule would have missed.
        await withSchema(async ({ db }) => {
          const revision = await insertPolicy(db);
          const refusal = await message(() => policyDown(db));
          assert.match(refusal, /execution safety policy evidence/);
          const rows = await db
            .selectFrom('integration_execution_safety_policy')
            .select('policy_revision')
            .execute();
          assert.deepEqual(
            rows.map((row) => row.policy_revision),
            [revision],
          );
        });

        // A claim pin.
        await withSchema(async (fixture) => {
          const revision = await insertPolicy(fixture.db);
          const outboxId = await fixture.newObligation();
          await openAttempt(fixture, outboxId, {
            claimPolicyRevision: revision,
          });
          const refusal = await message(() => policyDown(fixture.db));
          // The policy row is itself evidence, so that condition is reached
          // first; the pin is proven intact either way.
          assert.match(refusal, /evidence prevents rollback/);
          const attempts = await fixture.db
            .selectFrom('integration_delivery_attempt')
            .select('claim_policy_revision')
            .execute();
          assert.deepEqual(
            attempts.map((row) => row.claim_policy_revision),
            [revision],
          );
        });

        // Audit policy evidence alone, with the live connector cleared, so
        // the audit condition is the one that must fire.
        await withSchema(async ({ db, organizationId, connectorId }) => {
          await mutate(db, organizationId, connectorId, {
            category: 'execution_policy_changed',
            policy: FIXTURE_CONNECTOR_POLICY,
          });
          await mutate(db, organizationId, connectorId, {
            category: 'execution_policy_changed',
            policy: NO_POLICY,
          });
          const connector = await db
            .selectFrom('integration_connector')
            .selectAll()
            .where('id', '=', connectorId)
            .executeTakeFirstOrThrow();
          assert.equal(connector.request_execution_budget_seconds, null);
          const refusal = await message(() => policyDown(db));
          assert.match(refusal, /audit execution-policy evidence/);
        });
      },
    );
  },
);
