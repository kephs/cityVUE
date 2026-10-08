import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';
import { applyFunctionHardening } from '../helpers/tenant-domain-hardening.js';
import {
  activateTenantDomain,
  deactivateTenantDomain,
  recordTenantDomainApproval,
  revokeTenantDomainVerification,
} from '../../src/tenancy/tenant-domain.operations.js';
import {
  up as up47,
  down as down47,
} from '../../migrations/20261017000000-add-tenant-domain-operator-controls.js';

const MIGRATION = '20261017000000';
/** The legacy free-text operator reference, written before Migration 47 and
 * never rewritten. */
const LEGACY_ACTOR = 'ops';
const OPERATOR = 'dev:synthetic-operator';
const APPROVER = 'dev:synthetic-approver';
const THIRD_PARTY = 'dev:synthetic-bystander';
const REASON = 'F060.3C-2a synthetic operator control evidence';

const attribution = () => ({
  operatorIdentity: OPERATOR,
  reason: REASON,
  correlationId: randomUUID(),
});

async function refuses(
  action: () => Promise<unknown>,
  expected: RegExp,
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.match((error as Error).message, expected);
    return true;
  });
}

test(
  'ADR-027 F060.3C-2a disposable operator attribution and approval invariants',
  { skip: !process.env.TEST_DATABASE_URL && 'TEST_DATABASE_URL missing' },
  async (t) => {
    const testUrl = process.env.TEST_DATABASE_URL;
    assert.ok(testUrl);
    const url = new URL(testUrl);
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
    assert.equal(url.pathname, '/reqro_f0592_test');
    assert.equal(decodeURIComponent(url.username), 'reqro_test_user');
    const admin = new Pool({ connectionString: testUrl });
    const schema = `tenant_operator_${randomUUID().replaceAll('-', '')}`;
    let db: Kysely<DatabaseSchema> | undefined,
      created = false;
    try {
      assert.deepEqual(
        (await admin.query('select current_database() db,current_user usr'))
          .rows,
        [{ db: 'reqro_f0592_test', usr: 'reqro_test_user' }],
      );
      await prepareDatabaseExtensions(admin);
      await admin.query(`create schema "${schema}"`);
      created = true;
      db = new Kysely<DatabaseSchema>({
        dialect: new PostgresDialect({
          pool: new Pool({
            connectionString: testUrl,
            options: `-c search_path=${schema}`,
            max: 8,
          }),
        }),
      });
      const database = db;

      const folder = path.resolve(__dirname, '../../migrations');
      const earlier = (await readdir(folder))
        .filter((file) => file.endsWith('.js') && file < MIGRATION)
        .sort();
      assert.equal(earlier.length, 46);
      for (const file of earlier) {
        const migration = (await import(
          pathToFileURL(path.join(folder, file)).href
        )) as { up: (db: Kysely<DatabaseSchema>) => Promise<void> };
        await database.transaction().execute(migration.up);
      }

      const organizationA = randomUUID();
      const organizationB = randomUUID();
      for (const id of [organizationA, organizationB])
        await database
          .insertInto('organization')
          .values({
            id,
            name: `Synthetic operator controls ${id}`,
            short_name: 'Test',
            slug: id,
            status: 'active',
            default_business_timezone: 'UTC',
          })
          .execute();

      /**
       * Writes a binding and its audit trail with the pre-Migration-47 column
       * set, which is what genuine legacy evidence looks like.
       *
       * Only valid **before** Migration 47: afterwards the column default is
       * 2 and the guard requires complete attribution, so this same insert is
       * refused. That refusal is the versioning boundary working, and it is
       * asserted directly below.
       */
      async function legacyBinding(
        organizationId: string,
        hostname: string,
        role = 'public_alias',
      ): Promise<string> {
        const id = randomUUID();
        await database.transaction().execute(async (trx) => {
          await sql`insert into tenant_domain(id,organization_id,hostname,role)
            values(${id}::uuid,${organizationId}::uuid,${hostname},${role})`.execute(
            trx,
          );
          await sql`insert into tenant_domain_audit(organization_id,tenant_domain_id,hostname,action,actor,
              prior_revision,revision,prior_role,role,prior_verification_state,verification_state,prior_active,active)
            select d.organization_id,d.id,d.hostname,'registered',${LEGACY_ACTOR},
              null,d.revision,null,d.role,null,d.verification_state,null,d.active
            from tenant_domain d where d.id=${id}::uuid`.execute(trx);
        });
        return id;
      }

      /** The post-Migration-47 equivalent: the same registration, carrying
       * the version-2 attribution every new audit row must now have. */
      async function registerBinding(
        organizationId: string,
        hostname: string,
        role = 'public_alias',
      ): Promise<string> {
        const id = randomUUID();
        await database.transaction().execute(async (trx) => {
          await sql`insert into tenant_domain(id,organization_id,hostname,role)
            values(${id}::uuid,${organizationId}::uuid,${hostname},${role})`.execute(
            trx,
          );
          await sql`insert into tenant_domain_audit(organization_id,tenant_domain_id,hostname,action,actor,
              attribution_version,operator_identity,reason,correlation_id,outcome,
              prior_revision,revision,prior_role,role,prior_verification_state,verification_state,prior_active,active)
            select d.organization_id,d.id,d.hostname,'registered',${OPERATOR},
              2,${OPERATOR},${REASON},gen_random_uuid(),'applied',
              null,d.revision,null,d.role,null,d.verification_state,null,d.active
            from tenant_domain d where d.id=${id}::uuid`.execute(trx);
        });
        return id;
      }

      const legacyHostname = 'legacy.example.gov';
      const legacyId = await legacyBinding(organizationA, legacyHostname);

      await t.test(
        'migration 47 applies, rolls back and reapplies over legacy evidence',
        async () => {
          await database.transaction().execute(up47);
          const present = await sql<{ column_name: string }>`
            select column_name from information_schema.columns
            where table_schema=${schema} and table_name='tenant_domain_audit'
              and column_name in ('attribution_version','operator_identity','reason','correlation_id','outcome','approval_id')
            order by column_name`.execute(database);
          assert.deepEqual(
            present.rows.map((row) => row.column_name),
            [
              'approval_id',
              'attribution_version',
              'correlation_id',
              'operator_identity',
              'outcome',
              'reason',
            ],
          );
          assert.equal(
            (
              await sql<{ present: boolean }>`
                select to_regclass(${`${schema}.tenant_domain_operator_approval`}) is not null as present`.execute(
                database,
              )
            ).rows[0]?.present,
            true,
          );
          assert.equal(
            (
              await sql<{
                count: string;
              }>`select count(*)::text as count from tenant_domain_operator_approval`.execute(
                database,
              )
            ).rows[0]?.count,
            '0',
            'no approval is seeded',
          );

          // Retained legacy rows must not block rollback: only post-cutover
          // evidence does.
          await database.transaction().execute(down47);
          assert.equal(
            (
              await sql<{ present: boolean }>`
                select to_regclass(${`${schema}.tenant_domain_operator_approval`}) is not null as present`.execute(
                database,
              )
            ).rows[0]?.present,
            false,
          );
          const legacy = await sql<{ actor: string }>`
            select actor from tenant_domain_audit where tenant_domain_id=${legacyId}::uuid`.execute(
            database,
          );
          assert.deepEqual(
            legacy.rows.map((row) => row.actor),
            [LEGACY_ACTOR],
            'legacy evidence survives rollback unchanged',
          );
          await database.transaction().execute(up47);
        },
      );

      // ADR-027 F060.3C-2c-2: the operator paths exercised below call the
      // Organization lock helper, so the hardening is applied once Migration
      // 47 has settled.
      await applyFunctionHardening(database, schema);

      await t.test(
        'legacy audit rows are preserved exactly as recorded',
        async () => {
          const row = await sql<{
            actor: string;
            attribution_version: number;
            operator_identity: string | null;
            reason: string | null;
            correlation_id: string | null;
            outcome: string | null;
            approval_id: string | null;
          }>`select actor,attribution_version,operator_identity,reason,correlation_id,outcome,approval_id
            from tenant_domain_audit where tenant_domain_id=${legacyId}::uuid`.execute(
            database,
          );
          assert.deepEqual(row.rows, [
            {
              actor: LEGACY_ACTOR,
              attribution_version: 1,
              operator_identity: null,
              reason: null,
              correlation_id: null,
              outcome: null,
              approval_id: null,
            },
          ]);

          // The same legacy-shaped insert is now refused, which is the
          // versioning boundary: version 1 is retained history and is closed
          // to new writes.
          await refuses(
            () => legacyBinding(organizationA, 'legacy-reprise.example.gov'),
            /records applied mutations only|requires current operator attribution|attribution_complete/,
          );
        },
      );

      /** Forces the lifecycle forward with direct SQL under the real
       * controls, so the operator controls themselves are what is tested. */
      async function advance(
        organizationId: string,
        id: string,
        set: string,
        action: 'verification_requested' | 'verified',
      ): Promise<void> {
        await database.transaction().execute(async (trx) => {
          const before = await trx
            .selectFrom('tenant_domain')
            .select(['role', 'verification_state', 'active', 'revision'])
            .where('organization_id', '=', organizationId)
            .where('id', '=', id)
            .forUpdate()
            .executeTakeFirstOrThrow();
          await sql`update tenant_domain set revision=revision+1, ${sql.raw(set)}
              where organization_id=${organizationId}::uuid and id=${id}::uuid`.execute(
            trx,
          );
          const after = await trx
            .selectFrom('tenant_domain')
            .select([
              'hostname',
              'role',
              'verification_state',
              'active',
              'revision',
            ])
            .where('organization_id', '=', organizationId)
            .where('id', '=', id)
            .executeTakeFirstOrThrow();
          await trx
            .insertInto('tenant_domain_audit')
            .values({
              organization_id: organizationId,
              tenant_domain_id: id,
              hostname: after.hostname,
              action,
              actor: OPERATOR,
              attribution_version: 2,
              operator_identity: OPERATOR,
              reason: REASON,
              correlation_id: randomUUID(),
              outcome: 'applied',
              prior_revision: before.revision,
              revision: after.revision,
              prior_role: before.role,
              role: after.role,
              prior_verification_state: before.verification_state,
              verification_state: after.verification_state,
              prior_active: before.active,
              active: after.active,
              evidence: null,
            })
            .execute();
        });
      }

      /** Registers a binding and drives it to verified + inactive, which is
       * the state both approvable operations act on. */
      async function verifiedBinding(
        organizationId: string,
        hostname: string,
      ): Promise<string> {
        const id = await registerBinding(organizationId, hostname);
        await advance(
          organizationId,
          id,
          `verification_state='pending',verification_method='dns_txt',
            verification_challenge='reqro-site-verification=v1.${'a'.repeat(43)}',
            verification_token_id=gen_random_uuid(),
            verification_requested_at=clock_timestamp(),
            verification_expires_at=clock_timestamp()+interval '14 days'`,
          'verification_requested',
        );
        await advance(
          organizationId,
          id,
          `verification_state='verified',verified_at=clock_timestamp(),
            verification_evidence='{"observed":"synthetic"}'::jsonb`,
          'verified',
        );
        return id;
      }

      async function approve(
        organizationId: string,
        hostname: string,
        expectedRevision: number,
        operation: 'activated' | 'verification_revoked',
        approvedBy = APPROVER,
      ): Promise<string> {
        const approval = await recordTenantDomainApproval(database, {
          organizationId,
          hostname,
          expectedRevision,
          operation,
          requestedBy: OPERATOR,
          approvedBy,
          reason: REASON,
          correlationId: randomUUID(),
        });
        return approval.id;
      }

      const selection = (
        organizationId: string,
        hostname: string,
        expectedRevision: number,
      ) => ({
        organizationId,
        hostname,
        expectedRevision,
        attribution: attribution(),
        dryRun: false,
      });

      await t.test(
        'structured attribution is mandatory, bounded and un-skippable',
        async () => {
          const hostname = 'attribution.example.gov';
          const id = await verifiedBinding(organizationA, hostname);

          /**
           * One genuine challenge-replacement transition whose attribution
           * columns vary. The mutation itself is always valid and needs no
           * approval, so attribution is the only control that can refuse it,
           * and every refusal rolls the transaction back and leaves the
           * binding at the same revision for the next case.
           */
          const mutate = (
            actor: string,
            version: number,
            columns: string,
            values: string,
          ) =>
            database.transaction().execute(async (trx) => {
              await sql`update tenant_domain set active=false,revision=revision+1
                  where id=${id}::uuid`.execute(trx);
              await sql`insert into tenant_domain_audit(organization_id,tenant_domain_id,hostname,action,actor,
                  attribution_version${sql.raw(columns ? ',' + columns : '')},
                  prior_revision,revision,prior_role,role,
                  prior_verification_state,verification_state,prior_active,active)
                select d.organization_id,d.id,d.hostname,'deactivated',${actor},
                  ${version}${sql.raw(values ? ',' + values : '')},
                  d.revision-1,d.revision,d.role,d.role,
                  d.verification_state,d.verification_state,true,d.active
                from tenant_domain d where d.id=${id}::uuid`.execute(trx);
            });

          const identity = `'${OPERATOR}'`;
          const reason = `'${REASON}'`;
          const all = 'operator_identity,reason,correlation_id,outcome';
          const complete = `${identity},${reason},gen_random_uuid(),'applied'`;

          // The binding must be active for 'deactivated' to mirror state, so
          // activate it once through the real approved path first.
          const approval = await approve(
            organizationA,
            hostname,
            3,
            'activated',
          );
          await activateTenantDomain(database, {
            ...selection(organizationA, hostname, 3),
            approvalId: approval,
          });

          // A new row cannot claim the retired legacy version.
          await refuses(
            () => mutate(LEGACY_ACTOR, 1, '', ''),
            /requires current operator attribution/,
          );
          // Each structured field is individually mandatory.
          await refuses(
            () =>
              mutate(
                OPERATOR,
                2,
                'reason,correlation_id,outcome',
                `${reason},gen_random_uuid(),'applied'`,
              ),
            /attribution_complete/,
          );
          await refuses(
            () =>
              mutate(
                OPERATOR,
                2,
                'operator_identity,correlation_id,outcome',
                `${identity},gen_random_uuid(),'applied'`,
              ),
            /attribution_complete/,
          );
          await refuses(
            () =>
              mutate(
                OPERATOR,
                2,
                'operator_identity,reason,outcome',
                `${identity},${reason},'applied'`,
              ),
            /attribution_complete/,
          );
          await refuses(
            () =>
              mutate(
                OPERATOR,
                2,
                all,
                complete.replace("'applied'", "'refused'"),
              ),
            /audit_outcome|records applied mutations only/,
          );
          // A bare UUID carries no scheme and is a staff-identity shape, so it
          // can never stand in for an infrastructure operator.
          await refuses(
            () =>
              mutate(
                '11111111-1111-4111-8111-111111111111',
                2,
                all,
                complete.replace(
                  identity,
                  "'11111111-1111-4111-8111-111111111111'",
                ),
              ),
            /audit_operator_identity/,
          );
          // A pasted secret is refused rather than written into the audit.
          await refuses(
            () =>
              mutate(
                'dev:A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6',
                2,
                all,
                complete.replace(
                  identity,
                  "'dev:A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6'",
                ),
              ),
            /audit_operator_identity/,
          );
          await refuses(
            () =>
              mutate(OPERATOR, 2, all, complete.replace(reason, "'too short'")),
            /audit_reason/,
          );
          // The retained legacy column cannot disagree with the structured one.
          await refuses(
            () => mutate('someone-else', 2, all, complete),
            /audit_actor_agrees/,
          );
          // The same transition with complete attribution is accepted, so the
          // refusals above are the attribution controls and not a broken
          // fixture.
          await mutate(OPERATOR, 2, all, complete);
          assert.equal(
            (
              await sql<{ active: boolean }>`
                select active from tenant_domain where id=${id}::uuid`.execute(
                database,
              )
            ).rows[0]?.active,
            false,
          );
        },
      );

      await t.test(
        'the database refuses an approval that names one identity for both roles',
        async () => {
          const hostname = 'self-approval.example.gov';
          const id = await verifiedBinding(organizationA, hostname);
          await refuses(
            () =>
              sql`insert into tenant_domain_operator_approval(organization_id,tenant_domain_id,operation,
                  expected_revision,expected_hostname,expected_role,expected_verification_state,expected_active,
                  requested_by,approved_by,reason,correlation_id,policy_version)
                select d.organization_id,d.id,'activated',d.revision,d.hostname,d.role,d.verification_state,d.active,
                  ${OPERATOR},${OPERATOR},${REASON},gen_random_uuid(),1
                from tenant_domain d where d.id=${id}::uuid`.execute(database),
            /operator_approval_check|requested_by/,
          );
          await refuses(
            () => approve(organizationA, hostname, 3, 'activated', OPERATOR),
            /requires a different approver/,
          );
        },
      );

      await t.test(
        'an approval cannot describe a state the binding is not in',
        async () => {
          const hostname = 'approval-context.example.gov';
          const id = await verifiedBinding(organizationA, hostname);
          await refuses(
            () => approve(organizationA, hostname, 2, 'activated'),
            /revision has moved/,
          );
          await refuses(
            () =>
              sql`insert into tenant_domain_operator_approval(organization_id,tenant_domain_id,operation,
                  expected_revision,expected_hostname,expected_role,expected_verification_state,expected_active,
                  requested_by,approved_by,reason,correlation_id,policy_version)
                select d.organization_id,d.id,'activated',d.revision,d.hostname,d.role,'verified',true,
                  ${OPERATOR},${APPROVER},${REASON},gen_random_uuid(),1
                from tenant_domain d where d.id=${id}::uuid`.execute(database),
            /operator_approval_check|must record the committed binding state/,
          );
        },
      );

      await t.test('activation requires an independent approval', async () => {
        const hostname = 'activation.example.gov';
        await verifiedBinding(organizationA, hostname);

        // No approval at all.
        await refuses(
          () =>
            activateTenantDomain(database, {
              ...selection(organizationA, hostname, 3),
              approvalId: randomUUID(),
            }),
          /requires an independent approval/,
        );
        // Direct SQL cannot write the activation without one either.
        await refuses(
          () =>
            database.transaction().execute(async (trx) => {
              await sql`update tenant_domain set active=true,revision=revision+1
                  where hostname=${hostname}`.execute(trx);
              await sql`insert into tenant_domain_audit(organization_id,tenant_domain_id,hostname,action,actor,
                  attribution_version,operator_identity,reason,correlation_id,outcome,
                  prior_revision,revision,prior_role,role,
                  prior_verification_state,verification_state,prior_active,active)
                select d.organization_id,d.id,d.hostname,'activated',${OPERATOR},
                  2,${OPERATOR},${REASON},gen_random_uuid(),'applied',
                  d.revision-1,d.revision,d.role,d.role,d.verification_state,d.verification_state,false,d.active
                from tenant_domain d where d.hostname=${hostname}`.execute(trx);
            }),
          // The trigger reaches this before the approval-scope check
          // constraint is evaluated, so the clearer message is what surfaces.
          /requires an independent approval|audit_approval_scope/,
        );
        // And an unattributed direct write fails the deferred audit invariant.
        await refuses(
          () =>
            sql`update tenant_domain set active=true,revision=revision+1
                where hostname=${hostname}`.execute(database),
          /matching attributed operator audit evidence/,
        );

        const approval = await approve(organizationA, hostname, 3, 'activated');
        const activated = await activateTenantDomain(database, {
          ...selection(organizationA, hostname, 3),
          approvalId: approval,
        });
        assert.equal(activated.domain.active, true);
        assert.equal(activated.domain.resolvable, true);

        // The exact approval is recorded as consumed by the committed row.
        const consumed = await sql<{ approval_id: string; consumed: boolean }>`
          select a.approval_id, tenant_domain_approval_consumed(a.approval_id) as consumed
          from tenant_domain_audit a
          where a.hostname=${hostname} and a.action='activated'`.execute(
          database,
        );
        assert.deepEqual(consumed.rows, [
          { approval_id: approval, consumed: true },
        ]);

        // Single use is a unique partial index, so two mutations can never
        // both commit against one approval even under concurrency.
        const index = await sql<{ definition: string }>`
          select indexdef as definition from pg_indexes
          where schemaname=${schema} and indexname='tenant_domain_approval_single_use'`.execute(
          database,
        );
        assert.match(
          index.rows[0]?.definition ?? '',
          /CREATE UNIQUE INDEX .* ON .*tenant_domain_audit .*approval_id.*WHERE .*approval_id IS NOT NULL/is,
        );
        // Replaying the spent approval is refused; the binding has moved on,
        // so exact-context binding refuses it before the index is reached.
        await refuses(
          () =>
            activateTenantDomain(database, {
              ...selection(organizationA, hostname, 4),
              approvalId: approval,
            }),
          /already active|does not match the mutation context/,
        );
      });

      await t.test(
        'deactivation is immediate and takes no approval',
        async () => {
          const hostname = 'deactivation.example.gov';
          await verifiedBinding(organizationA, hostname);
          const approval = await approve(
            organizationA,
            hostname,
            3,
            'activated',
          );
          await activateTenantDomain(database, {
            ...selection(organizationA, hostname, 3),
            approvalId: approval,
          });

          const deactivated = await deactivateTenantDomain(
            database,
            selection(organizationA, hostname, 4),
          );
          assert.equal(deactivated.domain.active, false);
          const row = await sql<{ approval_id: string | null }>`
            select approval_id from tenant_domain_audit
            where hostname=${hostname} and action='deactivated'`.execute(
            database,
          );
          assert.deepEqual(row.rows, [{ approval_id: null }]);
        },
      );

      await t.test(
        'revocation keeps its ordering rule and requires an approval',
        async () => {
          const hostname = 'revocation.example.gov';
          await verifiedBinding(organizationA, hostname);
          const activation = await approve(
            organizationA,
            hostname,
            3,
            'activated',
          );
          await activateTenantDomain(database, {
            ...selection(organizationA, hostname, 3),
            approvalId: activation,
          });

          // An active hostname is deactivated first; there is no combined
          // revoke-active mutation, and no approval exists for one.
          await refuses(
            () =>
              revokeTenantDomainVerification(database, {
                ...selection(organizationA, hostname, 4),
                approvalId: randomUUID(),
              }),
            /Deactivate the tenant domain before revoking verification/,
          );
          await refuses(
            () => approve(organizationA, hostname, 4, 'verification_revoked'),
            /Deactivate the tenant domain before approving/,
          );
          await refuses(
            () =>
              sql`update tenant_domain set verification_state='unverified',revision=revision+1
                  where hostname=${hostname}`.execute(database),
            /An active tenant domain cannot lose verification/,
          );

          await deactivateTenantDomain(
            database,
            selection(organizationA, hostname, 4),
          );
          await refuses(
            () =>
              revokeTenantDomainVerification(database, {
                ...selection(organizationA, hostname, 5),
                approvalId: randomUUID(),
              }),
            /requires an independent approval/,
          );
          const revocation = await approve(
            organizationA,
            hostname,
            5,
            'verification_revoked',
          );
          const revoked = await revokeTenantDomainVerification(database, {
            ...selection(organizationA, hostname, 5),
            approvalId: revocation,
          });
          assert.equal(revoked.domain.verificationState, 'unverified');
          assert.equal(revoked.domain.active, false);
        },
      );

      await t.test(
        'an approval is bound to one Organization, binding and operation',
        async () => {
          const hostname = 'bound.example.gov';
          const other = 'bound-other.example.gov';
          const foreign = 'bound-foreign.example.gov';
          await verifiedBinding(organizationA, hostname);
          await verifiedBinding(organizationA, other);
          await verifiedBinding(organizationB, foreign);

          const otherBinding = await approve(
            organizationA,
            other,
            3,
            'activated',
          );
          const foreignBinding = await approve(
            organizationB,
            foreign,
            3,
            'activated',
          );
          const wrongOperation = await approve(
            organizationA,
            hostname,
            3,
            'verification_revoked',
          );

          for (const [label, approvalId, expected] of [
            ['another binding', otherBinding, /foreign key|approval/i],
            ['another Organization', foreignBinding, /foreign key|approval/i],
            [
              'another operation',
              wrongOperation,
              /authorizes a different operation/,
            ],
          ] as const)
            await refuses(
              () =>
                activateTenantDomain(database, {
                  ...selection(organizationA, hostname, 3),
                  approvalId,
                }),
              expected,
            ).catch((error: unknown) => {
              throw new Error(
                `${label} was not refused as expected: ${String(error)}`,
              );
            });
        },
      );

      await t.test(
        'the approver may not apply the change, and only the named operator may',
        async () => {
          const hostname = 'separation.example.gov';
          await verifiedBinding(organizationA, hostname);
          const approval = await approve(
            organizationA,
            hostname,
            3,
            'activated',
          );

          for (const [identity, expected] of [
            [APPROVER, /cannot be self-approved/],
            [THIRD_PARTY, /names a different operator/],
          ] as const)
            await refuses(
              () =>
                activateTenantDomain(database, {
                  ...selection(organizationA, hostname, 3),
                  approvalId: approval,
                  attribution: {
                    operatorIdentity: identity,
                    reason: REASON,
                    correlationId: randomUUID(),
                  },
                }),
              expected,
            );

          // The named operator still succeeds, so the refusals above are the
          // separation rule and not a broken fixture.
          const applied = await activateTenantDomain(database, {
            ...selection(organizationA, hostname, 3),
            approvalId: approval,
          });
          assert.equal(applied.domain.active, true);
        },
      );

      await t.test(
        'an approval committed by the consuming transaction is refused',
        async () => {
          const hostname = 'same-transaction.example.gov';
          const id = await verifiedBinding(organizationA, hostname);
          await refuses(
            () =>
              database.transaction().execute(async (trx) => {
                const approval = await sql<{ id: string }>`
                  insert into tenant_domain_operator_approval(organization_id,tenant_domain_id,operation,
                      expected_revision,expected_hostname,expected_role,expected_verification_state,expected_active,
                      requested_by,approved_by,reason,correlation_id,policy_version)
                    select d.organization_id,d.id,'activated',d.revision,d.hostname,d.role,d.verification_state,d.active,
                      ${OPERATOR},${APPROVER},${REASON},gen_random_uuid(),1
                    from tenant_domain d where d.id=${id}::uuid
                    returning id`.execute(trx);
                const approvalId = approval.rows[0]?.id;
                assert.ok(approvalId);
                await sql`update tenant_domain set active=true,revision=revision+1
                    where id=${id}::uuid`.execute(trx);
                await sql`insert into tenant_domain_audit(organization_id,tenant_domain_id,hostname,action,actor,
                    attribution_version,operator_identity,reason,correlation_id,outcome,approval_id,
                    prior_revision,revision,prior_role,role,
                    prior_verification_state,verification_state,prior_active,active)
                  select d.organization_id,d.id,d.hostname,'activated',${OPERATOR},
                    2,${OPERATOR},${REASON},gen_random_uuid(),'applied',${approvalId}::uuid,
                    d.revision-1,d.revision,d.role,d.role,d.verification_state,d.verification_state,false,d.active
                  from tenant_domain d where d.id=${id}::uuid`.execute(trx);
              }),
            /must be independently committed/,
          );
        },
      );

      await t.test(
        'the approval window is database derived and fails closed',
        async () => {
          const hostname = 'window.example.gov';
          await verifiedBinding(organizationA, hostname);
          const approval = await approve(
            organizationA,
            hostname,
            3,
            'activated',
          );
          const row = await sql<{
            exact: boolean;
            live_now: boolean;
            live_at_expiry: boolean;
            live_after: boolean;
          }>`
            select expires_at = approved_at + interval '24 hours' as exact,
              tenant_domain_approval_live(approved_at,expires_at,clock_timestamp()) as live_now,
              tenant_domain_approval_live(approved_at,expires_at,expires_at) as live_at_expiry,
              tenant_domain_approval_live(approved_at,expires_at,expires_at + interval '1 second') as live_after
            from tenant_domain_operator_approval where id=${approval}::uuid`.execute(
            database,
          );
          assert.deepEqual(row.rows, [
            {
              exact: true,
              live_now: true,
              live_at_expiry: false,
              live_after: false,
            },
          ]);
          // A caller cannot backdate or widen the window.
          await refuses(
            () =>
              sql`update tenant_domain_operator_approval
                  set expires_at=expires_at+interval '1 day' where id=${approval}::uuid`.execute(
                database,
              ),
            /immutable/,
          );
        },
      );

      await t.test('approval evidence is immutable', async () => {
        const hostname = 'immutable.example.gov';
        await verifiedBinding(organizationA, hostname);
        const approval = await approve(organizationA, hostname, 3, 'activated');
        for (const [statement, pattern] of [
          [
            sql`update tenant_domain_operator_approval set reason='rewritten' where id=${approval}::uuid`,
            /immutable/,
          ],
          [
            sql`delete from tenant_domain_operator_approval where id=${approval}::uuid`,
            /immutable/,
          ],
          [
            sql`truncate tenant_domain_operator_approval`,
            // PostgreSQL refuses this for the audit foreign key before any
            // truncate trigger runs; the trigger stays as the backstop.
            /immutable|cannot truncate a table referenced in a foreign key/,
          ],
        ] as const)
          await refuses(() => statement.execute(database), pattern);
      });

      await t.test(
        'rollback refuses retained post-cutover evidence',
        async () => {
          // Both kinds of evidence now exist, and neither may be discarded or
          // downgraded to legacy attribution by a rollback.
          assert.ok(
            Number(
              (
                await sql<{ count: string }>`
                  select count(*)::text as count from tenant_domain_operator_approval`.execute(
                  database,
                )
              ).rows[0]?.count,
            ) > 0,
          );
          assert.ok(
            Number(
              (
                await sql<{ count: string }>`
                  select count(*)::text as count from tenant_domain_audit where attribution_version=2`.execute(
                  database,
                )
              ).rows[0]?.count,
            ) > 0,
          );
          await refuses(
            () => database.transaction().execute(down47),
            /Retained operator attribution or approval evidence prevents rollback/,
          );
        },
      );
    } finally {
      await db?.destroy();
      if (created) await admin.query(`drop schema "${schema}" cascade`);
      await admin.end();
    }
  },
);
