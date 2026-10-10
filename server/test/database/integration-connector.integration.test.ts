import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';
import { up as catalogUp } from '../../migrations/20260902000000-create-organization-service-catalog.js';
import {
  up,
  down,
} from '../../migrations/20261020000000-add-integration-connector-registry.js';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import {
  NO_CAPABILITIES,
  type ConnectorCapabilities,
} from '../../src/integration/connector-capabilities.js';
import { connectorLifecycleStates } from '../../src/integration/delivery-contract.js';
import { toCapabilityColumns } from '../../src/integration/persistence/connector-metadata.js';

/**
 * F062.2B — connector metadata schema behaviour, proven against PostgreSQL.
 *
 * Everything asserted here is a database property, not an application one. The
 * repository produces bounded refusals, but the boundary is the schema: these
 * tests write SQL directly so a future refactor of the repository cannot make
 * a passing result depend on application code.
 */

const url = process.env.TEST_DATABASE_URL;

type Database = Kysely<DatabaseSchema>;

interface Fixture {
  readonly db: Database;
  readonly organizationA: string;
  readonly organizationB: string;
}

async function withSchema(
  run: (fixture: Fixture) => Promise<void>,
): Promise<void> {
  const schema = 'integration_connector_' + randomUUID().replaceAll('-', '');
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
    await up(db);
    // Two entirely synthetic Organizations. Explicit id and status because
    // OrganizationTable does not mark them Generated, matching the existing
    // database suites.
    const organizationA = randomUUID();
    const organizationB = randomUUID();
    await db
      .insertInto('organization')
      .values(
        [organizationA, organizationB].map((id, index) => ({
          id,
          name: 'F062.2B Synthetic ' + String(index),
          short_name: 'Test',
          slug: 'f0622b-' + id,
          status: 'active',
          default_business_timezone: 'America/New_York',
        })),
      )
      .execute();
    await run({ db, organizationA, organizationB });
  } finally {
    await db.destroy();
    await admin.query('drop schema "' + schema + '" cascade');
    await admin.end();
  }
}

/** Registers a connector together with the audit evidence the deferred
 * constraint requires, mirroring what the repository does in one transaction. */
async function register(
  db: Database,
  organizationId: string,
  connectorKey: string,
  capabilities: ConnectorCapabilities = NO_CAPABILITIES,
  credentialReference: string | null = null,
): Promise<string> {
  return db.transaction().execute(async (trx) => {
    const created = await trx
      .insertInto('integration_connector')
      .values({
        organization_id: organizationId,
        connector_key: connectorKey,
        connector_kind: 'loopback',
        credential_reference: credentialReference,
        ...toCapabilityColumns(capabilities),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('integration_connector_audit')
      .values({
        organization_id: organizationId,
        integration_connector_id: created.id,
        configuration_revision: created.configuration_revision,
        record_revision: created.record_revision,
        revision_advanced: true,
        change_category: 'registered',
        connector_key: created.connector_key,
        connector_kind: created.connector_kind,
        lifecycle_state: created.lifecycle_state,
        ...toCapabilityColumns(capabilities),
        credential_reference_present: credentialReference !== null,
        prior_configuration_revision: null,
        prior_record_revision: null,
        prior_lifecycle_state: null,
        actor: 'test-operator',
        correlation_id: randomUUID(),
      })
      .execute();
    return created.id;
  });
}

async function message(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected the database to refuse the operation');
}

test(
  'connector metadata is created, read and scoped to one Organization',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA, organizationB }) => {
      const id = await register(db, organizationA, 'loopback-one');

      const row = await db
        .selectFrom('integration_connector')
        .selectAll()
        .where('organization_id', '=', organizationA)
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      assert.equal(row.connector_key, 'loopback-one');
      assert.equal(row.lifecycle_state, 'configured');
      assert.equal(row.configuration_revision, 1);
      assert.equal(row.credential_reference, null);
      assert.equal(row.side_effect_risk, 'irreversible');
      assert.deepEqual(row.operations, []);

      // The same identity read under the other Organization returns nothing:
      // an Organization-scoped predicate cannot reach another tenant's row.
      assert.equal(
        await db
          .selectFrom('integration_connector')
          .selectAll()
          .where('organization_id', '=', organizationB)
          .where('id', '=', id)
          .executeTakeFirst(),
        undefined,
      );
    });
  },
);

test(
  'connector keys are unique within an Organization and reusable across Organizations',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA, organizationB }) => {
      await register(db, organizationA, 'shared-key');

      assert.match(
        await message(() => register(db, organizationA, 'shared-key')),
        /integration_connector_organization_id_connector_key_key|duplicate key/i,
      );

      // Deliberately permitted: the key namespace is per Organization, so a
      // global key would be the cross-tenant coupling this design forbids.
      const other = await register(db, organizationB, 'shared-key');
      assert.ok(other);
      assert.equal(
        (
          await db
            .selectFrom('integration_connector')
            .select('organization_id')
            .where('connector_key', '=', 'shared-key')
            .execute()
        ).length,
        2,
      );
    });
  },
);

test(
  'a forged cross-tenant audit reference is refused by the database',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA, organizationB }) => {
      const id = await register(db, organizationA, 'loopback-one');

      // Organization B claiming A's connector. The composite foreign key makes
      // the pair (organization_id, connector_id) the referent, so this is not
      // merely rejected by a check — it is unrepresentable.
      assert.match(
        await message(() =>
          db
            .insertInto('integration_connector_audit')
            .values({
              organization_id: organizationB,
              integration_connector_id: id,
              configuration_revision: 1,
              record_revision: 1,
              revision_advanced: true,
              change_category: 'registered',
              connector_key: 'loopback-one',
              connector_kind: 'loopback',
              lifecycle_state: 'configured',
              ...toCapabilityColumns(NO_CAPABILITIES),
              credential_reference_present: false,
              prior_configuration_revision: null,
              prior_record_revision: null,
              prior_lifecycle_state: null,
              actor: 'attacker',
              correlation_id: randomUUID(),
            })
            .execute(),
        ),
        /audit requires its connector|foreign key/i,
      );
    });
  },
);

test(
  'the lifecycle vocabulary is closed and transitions fail closed',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA }) => {
      const id = await register(db, organizationA, 'loopback-one');

      // A state outside the vocabulary is refused. The BEFORE trigger reaches
      // it first, because an unknown state is also not a declared transition,
      // so either refusal is correct and both are accepted here. That the
      // CHECK constraint is independently closed over exactly F062.1's
      // vocabulary is proven directly from pg_constraint further below,
      // rather than inferred from which layer happens to fire first.
      assert.match(
        await message(() =>
          sql`update integration_connector set lifecycle_state = 'paused',
                configuration_revision = configuration_revision + 1,
                record_revision = record_revision + 1
              where id = ${id}`.execute(db),
        ),
        /lifecycle transition|violates check constraint/i,
      );

      // retired is terminal: the regression this slice must prevent.
      await transition(db, organizationA, id, 'retired', 1, 'configured');
      assert.match(
        await message(() =>
          transition(db, organizationA, id, 'active', 2, 'retired'),
        ),
        /retired integration connector cannot change state/i,
      );
    });
  },
);

test(
  'nothing returns to configured and unsupported transitions are refused',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA }) => {
      const id = await register(db, organizationA, 'loopback-one');
      await transition(db, organizationA, id, 'active', 1, 'configured');

      assert.match(
        await message(() =>
          transition(db, organizationA, id, 'configured', 2, 'active'),
        ),
        /cannot return to configured/i,
      );
      // active -> degraded is allowed; degraded -> active back again is too.
      await transition(db, organizationA, id, 'degraded', 2, 'active');
      await transition(db, organizationA, id, 'active', 3, 'degraded');
      // disabled -> degraded is not a declared transition.
      await transition(db, organizationA, id, 'disabled', 4, 'active');
      assert.match(
        await message(() =>
          transition(db, organizationA, id, 'degraded', 5, 'disabled'),
        ),
        /Unsupported integration connector lifecycle transition/i,
      );
      const row = await db
        .selectFrom('integration_connector')
        .select(['lifecycle_state', 'disabled_at'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      assert.equal(row.lifecycle_state, 'disabled');
      assert.notEqual(row.disabled_at, null);
    });
  },
);

test(
  'capability values are constrained and operations are closed and non-repeating',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA }) => {
      await register(db, organizationA, 'loopback-one');

      for (const [statement, pattern] of [
        [
          sql`insert into integration_connector (organization_id, connector_key, connector_kind, side_effect_risk)
              values (${organizationA}, 'bad-risk', 'loopback', 'catastrophic')`,
          /side_effect_risk/i,
        ],
        [
          sql`insert into integration_connector (organization_id, connector_key, connector_kind, supports_ordering)
              values (${organizationA}, 'bad-order', 'loopback', 'global')`,
          /supports_ordering/i,
        ],
        [
          sql`insert into integration_connector (organization_id, connector_key, connector_kind, connector_kind)
              values (${organizationA}, 'bad-kind', 'loopback', 'vueworks')`,
          /specified more than once|connector_kind/i,
        ],
        [
          sql`insert into integration_connector (organization_id, connector_key, connector_kind, operations)
              values (${organizationA}, 'bad-ops', 'loopback', array['notAnOperation'])`,
          /operations/i,
        ],
        [
          sql`insert into integration_connector (organization_id, connector_key, connector_kind, operations)
              values (${organizationA}, 'dup-ops', 'loopback', array['createRequest','createRequest'])`,
          /must not repeat/i,
        ],
        [
          sql`insert into integration_connector (organization_id, connector_key, connector_kind)
              values (${organizationA}, 'Bad_Key', 'loopback')`,
          /connector_key/i,
        ],
      ] as const)
        assert.match(await message(() => statement.execute(db)), pattern);
    });
  },
);

test(
  'a credential-shaped value cannot be stored as a credential reference',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA }) => {
      for (const secret of [
        'sk-0123456789abcdef0123456789abcdef0123',
        'https://vault.example/secret',
        'has whitespace',
      ])
        assert.match(
          await message(() =>
            sql`insert into integration_connector
                  (organization_id, connector_key, connector_kind, credential_reference)
                values (${organizationA}, 'cred-test', 'loopback', ${secret})`.execute(
              db,
            ),
          ),
          /credential_reference/i,
        );

      // A locator is accepted, and the audit records presence only.
      const id = await register(
        db,
        organizationA,
        'cred-ok',
        NO_CAPABILITIES,
        'reqro/integration/loopback',
      );
      const audit = await db
        .selectFrom('integration_connector_audit')
        .selectAll()
        .where('integration_connector_id', '=', id)
        .executeTakeFirstOrThrow();
      assert.equal(audit.credential_reference_present, true);
      assert.equal(
        Object.keys(audit).some((column) => column === 'credential_reference'),
        false,
        'the audit table must not carry the locator value',
      );
    });
  },
);

test(
  'the configuration revision starts at one, advances once, and refuses a stale write',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA }) => {
      const id = await register(db, organizationA, 'loopback-one');
      assert.equal(await revisionOf(db, id), 1);

      await transition(db, organizationA, id, 'active', 1, 'configured');
      assert.equal(await revisionOf(db, id), 2);

      // Skipping a revision is refused, so a caller cannot jump the sequence.
      assert.match(
        await message(() =>
          sql`update integration_connector
                set lifecycle_state = 'degraded', configuration_revision = 9
              where id = ${id}`.execute(db),
        ),
        /revision must advance exactly once/i,
      );

      // A stale expected revision matches no row: optimistic concurrency,
      // never last-write-wins.
      const stale = await db
        .updateTable('integration_connector')
        .set({
          lifecycle_state: 'degraded',
          configuration_revision: 3,
          record_revision: 3,
        })
        .where('id', '=', id)
        .where('record_revision', '=', 1)
        .executeTakeFirst();
      assert.equal(Number(stale.numUpdatedRows), 0);
      assert.equal(await revisionOf(db, id), 2);
    });
  },
);

test(
  'a change without matching audit evidence aborts at commit',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA }) => {
      const id = await register(db, organizationA, 'loopback-one');

      // The deferred constraint trigger is the control: the UPDATE itself
      // succeeds, and the transaction fails when evidence is found missing.
      assert.match(
        await message(() =>
          db.transaction().execute(async (trx) => {
            await trx
              .updateTable('integration_connector')
              .set({
                lifecycle_state: 'active',
                configuration_revision: 2,
                record_revision: 2,
              })
              .where('id', '=', id)
              .execute();
            await sql`set constraints all immediate`.execute(trx);
          }),
        ),
        /require matching audit evidence/i,
      );
      assert.equal(await revisionOf(db, id), 1);

      // An unaudited registration is refused for the same reason.
      assert.match(
        await message(() =>
          db.transaction().execute(async (trx) => {
            await trx
              .insertInto('integration_connector')
              .values({
                organization_id: organizationA,
                connector_key: 'unaudited',
                connector_kind: 'loopback',
              })
              .execute();
            await sql`set constraints all immediate`.execute(trx);
          }),
        ),
        /require matching audit evidence/i,
      );
    });
  },
);

test(
  'audit history answers what was authoritative at a revision, and is immutable',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA }) => {
      const id = await register(db, organizationA, 'loopback-one');

      // Revision 2 grants idempotency support. Revision 1 must keep saying it
      // did not: this is what F062.2A pinning depends on.
      await changeCapabilities(db, organizationA, id, 1, {
        ...NO_CAPABILITIES,
        supportsIdempotencyKey: true,
      });

      const atOne = await db
        .selectFrom('integration_connector_audit')
        .selectAll()
        .where('integration_connector_id', '=', id)
        .where('configuration_revision', '=', 1)
        .where('revision_advanced', '=', true)
        .executeTakeFirstOrThrow();
      const atTwo = await db
        .selectFrom('integration_connector_audit')
        .selectAll()
        .where('integration_connector_id', '=', id)
        .where('configuration_revision', '=', 2)
        .where('revision_advanced', '=', true)
        .executeTakeFirstOrThrow();
      assert.equal(atOne.supports_idempotency_key, false);
      assert.equal(atTwo.supports_idempotency_key, true);
      assert.equal(atOne.record_revision, 1);
      assert.equal(atTwo.record_revision, 2);
      assert.equal(atTwo.prior_configuration_revision, 1);
      assert.equal(atTwo.prior_record_revision, 1);

      // Historical rows are immutable to any ordinary write.
      assert.match(
        await message(() =>
          db
            .updateTable('integration_connector_audit')
            .set({ supports_idempotency_key: true })
            .where('id', '=', atOne.id)
            .execute(),
        ),
        /audit is append-only/i,
      );
      assert.match(
        await message(() =>
          db
            .deleteFrom('integration_connector_audit')
            .where('id', '=', atOne.id)
            .execute(),
        ),
        /audit is append-only/i,
      );
      assert.match(
        await message(() =>
          sql`truncate table integration_connector_audit`.execute(db),
        ),
        /audit is append-only/i,
      );
      // And a connector is retired, never deleted.
      assert.match(
        await message(() =>
          db.deleteFrom('integration_connector').where('id', '=', id).execute(),
        ),
        /retired, never deleted/i,
      );
    });
  },
);

test(
  'a credential rotation is audited without advancing the configuration revision',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA }) => {
      const id = await register(db, organizationA, 'loopback-one');

      await db.transaction().execute(async (trx) => {
        const updated = await trx
          .updateTable('integration_connector')
          .set({
            credential_reference: 'reqro/integration/rotated',
            record_revision: 2,
          })
          .where('id', '=', id)
          .where('record_revision', '=', 1)
          .returningAll()
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('integration_connector_audit')
          .values({
            organization_id: organizationA,
            integration_connector_id: id,
            configuration_revision: updated.configuration_revision,
            record_revision: updated.record_revision,
            revision_advanced: false,
            change_category: 'credential_reference_rotated',
            connector_key: updated.connector_key,
            connector_kind: updated.connector_kind,
            lifecycle_state: updated.lifecycle_state,
            ...toCapabilityColumns(NO_CAPABILITIES),
            credential_reference_present: true,
            prior_configuration_revision: 1,
            prior_record_revision: 1,
            prior_lifecycle_state: updated.lifecycle_state,
            actor: 'test-operator',
            correlation_id: randomUUID(),
          })
          .execute();
      });

      // Rotation changes no semantics, so the pinned revision is untouched.
      assert.equal(await revisionOf(db, id), 1);
      const rows = await db
        .selectFrom('integration_connector_audit')
        .select([
          'record_revision',
          'configuration_revision',
          'revision_advanced',
          'change_category',
        ])
        .where('integration_connector_id', '=', id)
        .orderBy('record_revision')
        .execute();
      // Ordered, unique mutation revisions; the configuration revision stays
      // at 1 across both, because only one of them changed semantics.
      assert.deepEqual(rows, [
        {
          record_revision: 1,
          configuration_revision: 1,
          revision_advanced: true,
          change_category: 'registered',
        },
        {
          record_revision: 2,
          configuration_revision: 1,
          revision_advanced: false,
          change_category: 'credential_reference_rotated',
        },
      ]);

      // Still exactly one authoritative snapshot for revision 1.
      assert.equal(
        (
          await db
            .selectFrom('integration_connector_audit')
            .select('id')
            .where('integration_connector_id', '=', id)
            .where('configuration_revision', '=', 1)
            .where('revision_advanced', '=', true)
            .execute()
        ).length,
        1,
      );

      // Rotating while also advancing the revision is refused.
      assert.match(
        await message(() =>
          sql`update integration_connector
                set credential_reference = 'reqro/integration/again',
                    configuration_revision = configuration_revision + 1,
                    record_revision = record_revision + 1
              where id = ${id}`.execute(db),
        ),
        /must not advance the configuration revision/i,
      );
      // And a mutation that does not advance the record revision is refused
      // outright, which is what closes the lost-update window.
      assert.match(
        await message(() =>
          sql`update integration_connector
                set credential_reference = 'reqro/integration/again'
              where id = ${id}`.execute(db),
        ),
        /record revision must advance exactly once/i,
      );
    });
  },
);

test(
  'an update that changes nothing is refused rather than writing a revision',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA }) => {
      const id = await register(db, organizationA, 'loopback-one');
      assert.match(
        await message(() =>
          sql`update integration_connector set connector_key = connector_key
              where id = ${id}`.execute(db),
        ),
        /changes nothing/i,
      );
      assert.match(
        await message(() =>
          sql`update integration_connector set connector_key = 'renamed'
              where id = ${id}`.execute(db),
        ),
        /identity is immutable/i,
      );
    });
  },
);

test(
  'the lifecycle check constraint admits exactly the F062.1 vocabulary',
  { skip: !url },
  async () => {
    await withSchema(async ({ db }) => {
      const definition = await sql<{ def: string }>`
        select pg_get_constraintdef(c.oid) as def
          from pg_constraint c
          join pg_class t on t.oid = c.conrelid
         where t.relname = 'integration_connector'
           and pg_get_constraintdef(c.oid) like '%lifecycle_state%'
           and c.contype = 'c'`.execute(db);
      const stated = definition.rows
        .map((row) => row.def)
        .join(' ')
        .match(/'[a-z_]+'::character varying/g)
        ?.map((literal) => literal.slice(1, literal.indexOf("'", 1)));
      assert.deepEqual(
        [...new Set(stated)].sort(),
        [...connectorLifecycleStates].sort(),
        'the SQL lifecycle vocabulary must equal F062.1 connectorLifecycleStates',
      );
    });
  },
);

test(
  'the migration applies, rolls back while empty, and reapplies',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA }) => {
      // Rollback is refused while evidence exists.
      const id = await register(db, organizationA, 'loopback-one');
      assert.match(
        await message(() => down(db)),
        /Retained integration connector evidence prevents rollback/i,
      );
      assert.equal(await revisionOf(db, id), 1);

      // Evidence can only be removed by a privileged path: the owner drops the
      // append-only trigger deliberately. That is the "explicitly proven safe
      // deletion" case, and it is not reachable by any ordinary write above.
      await sql`alter table integration_connector_audit disable trigger integration_connector_audit_immutable`.execute(
        db,
      );
      await sql`delete from integration_connector_audit`.execute(db);
      await sql`alter table integration_connector_audit enable trigger integration_connector_audit_immutable`.execute(
        db,
      );
      await sql`alter table integration_connector disable trigger integration_connector_guard`.execute(
        db,
      );
      await sql`delete from integration_connector`.execute(db);
      await sql`alter table integration_connector enable trigger integration_connector_guard`.execute(
        db,
      );

      await down(db);
      assert.equal(await tableExists(db, 'integration_connector'), false);
      assert.equal(await tableExists(db, 'integration_connector_audit'), false);

      await up(db);
      assert.equal(await tableExists(db, 'integration_connector'), true);
      // Reapplied schema is usable, so apply -> rollback -> reapply is safe.
      const again = await register(db, organizationA, 'loopback-one');
      assert.ok(again);
    });
  },
);

// ---------------------------------------------------------------------------
// Concurrency: record_revision is the mutation token, so nothing is lost
// ---------------------------------------------------------------------------

test(
  'two credential rotations from the same record revision: one wins, one is refused',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA }) => {
      const id = await register(db, organizationA, 'loopback-one');
      assert.deepEqual(await revisions(db, id), {
        configuration: 1,
        record: 1,
      });

      // Both start from record revision 1, as two operators would. Run in
      // parallel: whichever commits first advances the token, and the other's
      // predicate then matches nothing.
      const [first, second] = await Promise.all([
        rotate(db, organizationA, id, 1, 'reqro/integration/first'),
        rotate(db, organizationA, id, 1, 'reqro/integration/second'),
      ]);

      // Exactly one applied. This is the assertion that would have failed
      // before record_revision existed: with a predicate on the unchanged
      // configuration_revision, both rotations matched and the later silently
      // overwrote the earlier.
      assert.equal(
        [first, second].filter((applied) => applied).length,
        1,
        'exactly one rotation must apply',
      );

      const stored = await db
        .selectFrom('integration_connector')
        .select([
          'credential_reference',
          'record_revision',
          'configuration_revision',
        ])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      // The surviving value is the winner's, and the token advanced once only.
      assert.equal(
        stored.credential_reference,
        first ? 'reqro/integration/first' : 'reqro/integration/second',
      );
      assert.equal(stored.record_revision, 2);
      assert.equal(stored.configuration_revision, 1);

      // One accepted mutation, one audit row beyond registration. The loser
      // left no evidence because it changed nothing.
      assert.equal(await auditCount(db, id), 2);

      // A retry still using the stale token is refused rather than applied.
      assert.equal(
        await rotate(db, organizationA, id, 1, 'reqro/integration/third'),
        false,
      );
      assert.equal(await revisionOf(db, id), 1);
    });
  },
);

test(
  'a credential rotation racing a semantic update: the stale participant is refused',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA }) => {
      const id = await register(db, organizationA, 'loopback-one');

      const [rotated, promoted] = await Promise.all([
        rotate(db, organizationA, id, 1, 'reqro/integration/rotated'),
        promote(db, organizationA, id, 1),
      ]);

      assert.equal(
        [rotated, promoted].filter((applied) => applied).length,
        1,
        'exactly one of the two mutations must apply',
      );

      const stored = await db
        .selectFrom('integration_connector')
        .select([
          'credential_reference',
          'lifecycle_state',
          'record_revision',
          'configuration_revision',
        ])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      assert.equal(stored.record_revision, 2);

      if (rotated) {
        // The rotation won: the lifecycle change did not leak through, and the
        // semantic revision is untouched.
        assert.equal(stored.credential_reference, 'reqro/integration/rotated');
        assert.equal(stored.lifecycle_state, 'configured');
        assert.equal(stored.configuration_revision, 1);
      } else {
        // The promotion won: the new credential reference did not leak
        // through, and the semantic revision advanced.
        assert.equal(stored.credential_reference, null);
        assert.equal(stored.lifecycle_state, 'active');
        assert.equal(stored.configuration_revision, 2);
      }
      assert.equal(await auditCount(db, id), 2);
    });
  },
);

test(
  'a rotation advances only the record revision; a semantic change advances both',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA }) => {
      const id = await register(db, organizationA, 'loopback-one');
      assert.deepEqual(await revisions(db, id), {
        configuration: 1,
        record: 1,
      });

      // C: rotation moves the token, not the pin.
      assert.equal(
        await rotate(db, organizationA, id, 1, 'reqro/integration/one'),
        true,
      );
      assert.deepEqual(await revisions(db, id), {
        configuration: 1,
        record: 2,
      });

      // D: a semantic change moves both.
      assert.equal(await promote(db, organizationA, id, 2), true);
      assert.deepEqual(await revisions(db, id), {
        configuration: 2,
        record: 3,
      });

      // A second rotation moves only the token again, from its new value.
      assert.equal(
        await rotate(db, organizationA, id, 3, 'reqro/integration/two'),
        true,
      );
      assert.deepEqual(await revisions(db, id), {
        configuration: 2,
        record: 4,
      });

      // The pin still resolves to the semantics it pinned, unaffected by the
      // rotations that happened around it.
      const atTwo = await db
        .selectFrom('integration_connector_audit')
        .select(['lifecycle_state', 'record_revision'])
        .where('integration_connector_id', '=', id)
        .where('configuration_revision', '=', 2)
        .where('revision_advanced', '=', true)
        .executeTakeFirstOrThrow();
      assert.equal(atTwo.lifecycle_state, 'active');
      assert.equal(atTwo.record_revision, 3);
    });
  },
);

test(
  'audit history records one unique ordered record revision per accepted mutation',
  { skip: !url },
  async () => {
    await withSchema(async ({ db, organizationA }) => {
      const id = await register(db, organizationA, 'loopback-one');
      assert.equal(await rotate(db, organizationA, id, 1, 'reqro/one'), true);
      assert.equal(await promote(db, organizationA, id, 2), true);
      assert.equal(await rotate(db, organizationA, id, 3, 'reqro/two'), true);

      const rows = await db
        .selectFrom('integration_connector_audit')
        .select([
          'record_revision',
          'prior_record_revision',
          'configuration_revision',
          'revision_advanced',
          'change_category',
        ])
        .where('integration_connector_id', '=', id)
        .orderBy('record_revision')
        .execute();
      assert.deepEqual(rows, [
        {
          record_revision: 1,
          prior_record_revision: null,
          configuration_revision: 1,
          revision_advanced: true,
          change_category: 'registered',
        },
        {
          record_revision: 2,
          prior_record_revision: 1,
          configuration_revision: 1,
          revision_advanced: false,
          change_category: 'credential_reference_rotated',
        },
        {
          record_revision: 3,
          prior_record_revision: 2,
          configuration_revision: 2,
          revision_advanced: true,
          change_category: 'lifecycle_changed',
        },
        {
          record_revision: 4,
          prior_record_revision: 3,
          configuration_revision: 2,
          revision_advanced: false,
          change_category: 'credential_reference_rotated',
        },
      ]);

      // Exactly one authoritative semantic snapshot per configuration
      // revision, even though four mutations occurred.
      const semantic = await db
        .selectFrom('integration_connector_audit')
        .select(['configuration_revision', 'record_revision'])
        .where('integration_connector_id', '=', id)
        .where('revision_advanced', '=', true)
        .orderBy('configuration_revision')
        .execute();
      assert.deepEqual(semantic, [
        { configuration_revision: 1, record_revision: 1 },
        { configuration_revision: 2, record_revision: 3 },
      ]);

      // Uniqueness is structural, not merely observed.
      assert.match(
        await message(() =>
          db
            .insertInto('integration_connector_audit')
            .values({
              organization_id: organizationA,
              integration_connector_id: id,
              record_revision: 4,
              configuration_revision: 2,
              prior_record_revision: 3,
              revision_advanced: false,
              change_category: 'credential_reference_rotated',
              connector_key: 'loopback-one',
              connector_kind: 'loopback',
              lifecycle_state: 'active',
              ...toCapabilityColumns(NO_CAPABILITIES),
              credential_reference_present: true,
              prior_configuration_revision: 2,
              prior_lifecycle_state: 'active',
              actor: 'duplicate',
              correlation_id: randomUUID(),
            })
            .execute(),
        ),
        /duplicate key|record_revision/i,
      );
    });
  },
);

async function revisions(
  db: Database,
  id: string,
): Promise<{ configuration: number; record: number }> {
  const row = await db
    .selectFrom('integration_connector')
    .select(['configuration_revision', 'record_revision'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  return {
    configuration: row.configuration_revision,
    record: row.record_revision,
  };
}

async function auditCount(db: Database, id: string): Promise<number> {
  const rows = await db
    .selectFrom('integration_connector_audit')
    .select('record_revision')
    .where('integration_connector_id', '=', id)
    .execute();
  return rows.length;
}

/**
 * One credential rotation, as the repository performs it: predicated on the
 * expected record revision, with audit evidence in the same transaction.
 * Returns whether it applied. A rotation that matches no row writes no audit,
 * so the deferred constraint is never triggered for a no-op.
 */
async function rotate(
  db: Database,
  organizationId: string,
  id: string,
  expectedRecordRevision: number,
  credentialReference: string,
): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    const updated = await trx
      .updateTable('integration_connector')
      .set({
        credential_reference: credentialReference,
        record_revision: expectedRecordRevision + 1,
      })
      .where('organization_id', '=', organizationId)
      .where('id', '=', id)
      .where('record_revision', '=', expectedRecordRevision)
      .returningAll()
      .executeTakeFirst();
    if (!updated) return false;
    await trx
      .insertInto('integration_connector_audit')
      .values({
        organization_id: organizationId,
        integration_connector_id: id,
        record_revision: updated.record_revision,
        configuration_revision: updated.configuration_revision,
        prior_record_revision: expectedRecordRevision,
        revision_advanced: false,
        change_category: 'credential_reference_rotated',
        connector_key: updated.connector_key,
        connector_kind: updated.connector_kind,
        lifecycle_state: updated.lifecycle_state,
        ...toCapabilityColumns(NO_CAPABILITIES),
        credential_reference_present: true,
        prior_configuration_revision: updated.configuration_revision,
        prior_lifecycle_state: updated.lifecycle_state,
        actor: 'test-operator',
        correlation_id: randomUUID(),
      })
      .execute();
    return true;
  });
}

/** One semantic mutation (configured -> active), returning whether it
 * applied, so a race can be observed without either side throwing. */
async function promote(
  db: Database,
  organizationId: string,
  id: string,
  expectedRecordRevision: number,
): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    const current = await trx
      .selectFrom('integration_connector')
      .select(['configuration_revision', 'lifecycle_state'])
      .where('organization_id', '=', organizationId)
      .where('id', '=', id)
      .where('record_revision', '=', expectedRecordRevision)
      .executeTakeFirst();
    if (!current) return false;
    const updated = await trx
      .updateTable('integration_connector')
      .set({
        lifecycle_state: 'active',
        configuration_revision: current.configuration_revision + 1,
        record_revision: expectedRecordRevision + 1,
      })
      .where('organization_id', '=', organizationId)
      .where('id', '=', id)
      .where('record_revision', '=', expectedRecordRevision)
      .returningAll()
      .executeTakeFirst();
    if (!updated) return false;
    await trx
      .insertInto('integration_connector_audit')
      .values({
        organization_id: organizationId,
        integration_connector_id: id,
        record_revision: updated.record_revision,
        configuration_revision: updated.configuration_revision,
        prior_record_revision: expectedRecordRevision,
        revision_advanced: true,
        change_category: 'lifecycle_changed',
        connector_key: updated.connector_key,
        connector_kind: updated.connector_kind,
        lifecycle_state: updated.lifecycle_state,
        ...toCapabilityColumns(NO_CAPABILITIES),
        credential_reference_present: updated.credential_reference !== null,
        prior_configuration_revision: current.configuration_revision,
        prior_lifecycle_state: current.lifecycle_state,
        actor: 'test-operator',
        correlation_id: randomUUID(),
      })
      .execute();
    return true;
  });
}

async function revisionOf(db: Database, id: string): Promise<number> {
  const row = await db
    .selectFrom('integration_connector')
    .select('configuration_revision')
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  return row.configuration_revision;
}

async function tableExists(db: Database, name: string): Promise<boolean> {
  const result = await sql<{ present: boolean }>`
    select to_regclass(${name}) is not null as present`.execute(db);
  return result.rows[0]?.present === true;
}

/** A lifecycle change plus its audit evidence, in one transaction. */
async function transition(
  db: Database,
  organizationId: string,
  id: string,
  next: (typeof connectorLifecycleStates)[number],
  expectedRecordRevision: number,
  prior: (typeof connectorLifecycleStates)[number],
  expectedConfigurationRevision = expectedRecordRevision,
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const updated = await trx
      .updateTable('integration_connector')
      .set({
        lifecycle_state: next,
        configuration_revision: expectedConfigurationRevision + 1,
        record_revision: expectedRecordRevision + 1,
      })
      .where('organization_id', '=', organizationId)
      .where('id', '=', id)
      .where('record_revision', '=', expectedRecordRevision)
      .returningAll()
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('integration_connector_audit')
      .values({
        organization_id: organizationId,
        integration_connector_id: id,
        configuration_revision: updated.configuration_revision,
        record_revision: updated.record_revision,
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
        credential_reference_present: updated.credential_reference !== null,
        prior_configuration_revision: expectedConfigurationRevision,
        prior_record_revision: expectedRecordRevision,
        prior_lifecycle_state: prior,
        actor: 'test-operator',
        correlation_id: randomUUID(),
      })
      .execute();
  });
}

async function changeCapabilities(
  db: Database,
  organizationId: string,
  id: string,
  expectedRecordRevision: number,
  capabilities: ConnectorCapabilities,
  expectedConfigurationRevision = expectedRecordRevision,
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const updated = await trx
      .updateTable('integration_connector')
      .set({
        ...toCapabilityColumns(capabilities),
        configuration_revision: expectedConfigurationRevision + 1,
        record_revision: expectedRecordRevision + 1,
      })
      .where('organization_id', '=', organizationId)
      .where('id', '=', id)
      .where('record_revision', '=', expectedRecordRevision)
      .returningAll()
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('integration_connector_audit')
      .values({
        organization_id: organizationId,
        integration_connector_id: id,
        configuration_revision: updated.configuration_revision,
        record_revision: updated.record_revision,
        revision_advanced: true,
        change_category: 'capabilities_changed',
        connector_key: updated.connector_key,
        connector_kind: updated.connector_kind,
        lifecycle_state: updated.lifecycle_state,
        ...toCapabilityColumns(capabilities),
        credential_reference_present: updated.credential_reference !== null,
        prior_configuration_revision: expectedConfigurationRevision,
        prior_record_revision: expectedRecordRevision,
        prior_lifecycle_state: updated.lifecycle_state,
        actor: 'test-operator',
        correlation_id: randomUUID(),
      })
      .execute();
  });
}
