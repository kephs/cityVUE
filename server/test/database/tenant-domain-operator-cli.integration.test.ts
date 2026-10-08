import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';
import { applyFunctionHardening } from '../helpers/tenant-domain-hardening.js';

/**
 * ADR-027 F060.3C-2b. Drives the production-capable operator command as a
 * real subprocess against the authorized disposable database, through its
 * gated `test` target, so the gates and the approval workflow are exercised
 * end to end rather than at the operations layer.
 */
const REQUESTER = 'dev:operator-a';
const APPROVER = 'dev:operator-b';
const THIRD_PARTY = 'dev:operator-c';
const REASON = 'F060.3C-2b synthetic production operator command evidence';
const ORGANIZATION = '10000000-0000-4000-8000-000000000001';

interface Invocation {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function resultCode(invocation: Invocation): string {
  assert.equal(invocation.status, 1, invocation.stderr || invocation.stdout);
  const parsed = JSON.parse(invocation.stderr.trim()) as Record<
    string,
    unknown
  >;
  return String(parsed.code);
}

function emitted(invocation: Invocation): Record<string, unknown> {
  assert.equal(invocation.status, 0, invocation.stderr || invocation.stdout);
  return JSON.parse(invocation.stdout.trim()) as Record<string, unknown>;
}

test(
  'ADR-027 F060.3C-2b production operator command against disposable PostgreSQL',
  { skip: !process.env.TEST_DATABASE_URL && 'TEST_DATABASE_URL missing' },
  async (t) => {
    const testUrl = process.env.TEST_DATABASE_URL;
    assert.ok(testUrl);
    const url = new URL(testUrl);
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
    assert.equal(url.pathname, '/reqro_f0592_test');
    assert.equal(decodeURIComponent(url.username), 'reqro_test_user');
    const admin = new Pool({ connectionString: testUrl });
    const schema = `operator_cli_${randomUUID().replaceAll('-', '')}`;
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

      // F060.3C-2c-3: the command pins the application schema on its own
      // connection from REQRO_DEPLOYMENT_SCHEMA, which is deployment owned.
      // The disposable schema is supplied through that same variable rather
      // than smuggled through the connection string, so there is exactly one
      // mechanism and it is not operator controlled: there is no `--schema`
      // flag and argv carries only the verb, operation and mode.

      db = new Kysely<DatabaseSchema>({
        dialect: new PostgresDialect({
          pool: new Pool({
            connectionString: testUrl,
            options: `-c search_path=${schema}`,
            max: 4,
          }),
        }),
      });
      const database = db;

      const folder = path.resolve(__dirname, '../../migrations');
      const migrations = (await readdir(folder))
        .filter((file) => file.endsWith('.js') && file < '20261018000000')
        .sort();
      assert.equal(migrations.length, 47);
      for (const file of migrations) {
        const migration = (await import(
          pathToFileURL(path.join(folder, file)).href
        )) as { up: (db: Kysely<DatabaseSchema>) => Promise<void> };
        await database.transaction().execute(migration.up);
      }
      await applyFunctionHardening(database, schema);

      await database
        .insertInto('organization')
        .values({
          id: ORGANIZATION,
          name: 'Synthetic operator command',
          short_name: 'Test',
          slug: ORGANIZATION,
          status: 'active',
          default_business_timezone: 'UTC',
        })
        .execute();

      const cli = path.resolve(
        __dirname,
        '../../src/database/tenant-domain-operator-cli.js',
      );

      /** The gated test target: a test environment marker, the authorized
       * disposable database and role, and the test runtime. */
      function operator(
        args: readonly string[],
        overrides: Record<string, string> = {},
      ): Invocation {
        const result = spawnSync(process.execPath, [cli, ...args], {
          encoding: 'utf8',
          env: {
            PATH: process.env.PATH ?? '',
            SystemRoot: process.env.SystemRoot ?? '',
            PGPASSWORD: process.env.PGPASSWORD ?? '',
            REQRO_OPERATOR_ENVIRONMENT: 'test',
            REQRO_DEPLOYMENT_ENVIRONMENT: 'test',
            REQRO_OPERATOR_DATABASE: 'reqro_f0592_test',
            REQRO_OPERATOR_DATABASE_USER: 'reqro_test_user',
            NODE_ENV: 'test',
            CITYVUE_DEPLOYMENT_PROFILE: 'development',
            DEVELOPMENT_ORGANIZATION_ID: ORGANIZATION,
            DATABASE_URL: testUrl,
            DATABASE_SSL_MODE: 'disable',
            REQRO_DEPLOYMENT_SCHEMA: schema,
            REQRO_OPERATOR_IDENTITY: REQUESTER,
            REQRO_OPERATOR_REASON: REASON,
            REQRO_OPERATOR_CORRELATION_ID: randomUUID(),
            REQRO_OPERATOR_ORGANIZATION_ID: ORGANIZATION,
            ...overrides,
          },
        });
        return {
          status: result.status,
          stdout: result.stdout,
          stderr: result.stderr,
        };
      }

      async function stateOf(hostname: string) {
        return database
          .selectFrom('tenant_domain')
          .select(['id', 'verification_state', 'active', 'revision'])
          .where('hostname', '=', hostname)
          .executeTakeFirst();
      }

      /** Drives a registered binding to verified and inactive with attributed
       * direct SQL, because a real TXT record cannot be published here. */
      async function driveToVerified(hostname: string): Promise<void> {
        for (const [set, action, prior] of [
          [
            `verification_state='pending',verification_method='dns_txt',
             verification_challenge='reqro-site-verification=v1.${'a'.repeat(43)}',
             verification_token_id=gen_random_uuid(),
             verification_requested_at=clock_timestamp(),
             verification_expires_at=clock_timestamp()+interval '14 days'`,
            'verification_requested',
            'unverified',
          ],
          [
            `verification_state='verified',verified_at=clock_timestamp(),
             verification_evidence='{"observed":"synthetic"}'::jsonb`,
            'verified',
            'pending',
          ],
        ] as const)
          await database.transaction().execute(async (trx) => {
            await sql`update tenant_domain set revision=revision+1, ${sql.raw(set)}
                where hostname=${hostname}`.execute(trx);
            await sql`insert into tenant_domain_audit(organization_id,tenant_domain_id,hostname,action,actor,
                attribution_version,operator_identity,reason,correlation_id,outcome,
                prior_revision,revision,prior_role,role,prior_verification_state,verification_state,prior_active,active)
              select d.organization_id,d.id,d.hostname,${action},${REQUESTER},
                2,${REQUESTER},${REASON},gen_random_uuid(),'applied',
                d.revision-1,d.revision,d.role,d.role,${prior},d.verification_state,d.active,d.active
              from tenant_domain d where d.hostname=${hostname}`.execute(trx);
          });
      }

      /** Registers through the command itself and returns the hostname. */
      async function registered(hostname: string): Promise<string> {
        const outcome = emitted(
          operator(['register', '--confirm'], {
            REQRO_OPERATOR_HOSTNAME: hostname,
            REQRO_OPERATOR_ROLE: 'public_alias',
          }),
        );
        assert.equal(outcome.mutation, 'executed');
        return hostname;
      }

      await t.test('the declared database and role are verified', async () => {
        const hostname = 'identity.example.gov';
        assert.equal(
          resultCode(
            operator(['register', '--dry-run'], {
              REQRO_OPERATOR_HOSTNAME: hostname,
              REQRO_OPERATOR_ROLE: 'public_alias',
              REQRO_OPERATOR_DATABASE: 'reqro_other_test',
            }),
          ),
          'database_mismatch',
        );
        assert.equal(
          resultCode(
            operator(['register', '--dry-run'], {
              REQRO_OPERATOR_HOSTNAME: hostname,
              REQRO_OPERATOR_ROLE: 'public_alias',
              REQRO_OPERATOR_DATABASE_USER: 'reqro_other_test_user',
            }),
          ),
          'database_mismatch',
        );
        assert.equal(await stateOf(hostname), undefined);
      });

      await t.test('a dry run makes no persistent write', async () => {
        const hostname = 'dry-run.example.gov';
        const plan = emitted(
          operator(['register', '--dry-run'], {
            REQRO_OPERATOR_HOSTNAME: hostname,
            REQRO_OPERATOR_ROLE: 'public_alias',
          }),
        );
        assert.equal(plan.mutation, 'not_executed');
        assert.equal(plan.commitEligibility, 'validated');
        assert.equal(plan.approvalRequired, false);
        assert.equal(
          (plan.outcome as Record<string, unknown>).applied,
          false,
          'the plan reports the mutation as not applied',
        );
        assert.equal(await stateOf(hostname), undefined);
        assert.equal(
          (
            await sql<{
              count: string;
            }>`select count(*)::text as count from tenant_domain_audit where hostname=${hostname}`.execute(
              database,
            )
          ).rows[0]?.count,
          '0',
        );
      });

      await t.test(
        'register, issue-challenge, verify and deactivate need no approval',
        async () => {
          const hostname = await registered('unapproved.example.gov');
          let current = await stateOf(hostname);
          assert.ok(current);
          assert.equal(current.verification_state, 'unverified');
          assert.equal(current.revision, 1);

          emitted(
            operator(['issue-challenge', '--confirm'], {
              REQRO_OPERATOR_HOSTNAME: hostname,
              REQRO_OPERATOR_EXPECTED_REVISION: '1',
            }),
          );
          current = await stateOf(hostname);
          assert.equal(current?.verification_state, 'pending');

          // No TXT record exists for a synthetic hostname, so verification
          // records a failed attempt and changes nothing. What matters here is
          // that no approval was demanded.
          const verification = emitted(
            operator(['verify', '--confirm'], {
              REQRO_OPERATOR_HOSTNAME: hostname,
              REQRO_OPERATOR_EXPECTED_REVISION: '2',
            }),
          );
          assert.equal(
            (verification.outcome as Record<string, unknown>).verified,
            false,
          );
          assert.ok(
            Number(
              (
                await sql<{ count: string }>`
                  select count(*)::text as count from tenant_domain_verification_attempt
                  where hostname=${hostname}`.execute(database)
              ).rows[0]?.count,
            ) > 0,
            'the attempt is recorded even though it failed',
          );

          // Deactivation stays immediate: an already-inactive binding is
          // refused for being inactive, never for lacking an approval.
          assert.equal(
            resultCode(
              operator(['deactivate', '--confirm'], {
                REQRO_OPERATOR_HOSTNAME: hostname,
                REQRO_OPERATOR_EXPECTED_REVISION: '2',
              }),
            ),
            'database_unavailable',
            'already inactive is refused by the operations layer, not by approval',
          );
        },
      );

      await t.test(
        'activation requires an approval that operator B records for operator A',
        async () => {
          const hostname = await registered('activation.example.gov');
          await driveToVerified(hostname);
          assert.equal((await stateOf(hostname))?.revision, 3);

          // No approval at all.
          assert.equal(
            resultCode(
              operator(['activate', '--confirm'], {
                REQRO_OPERATOR_HOSTNAME: hostname,
                REQRO_OPERATOR_EXPECTED_REVISION: '3',
              }),
            ),
            'approval_missing',
          );

          // Operator A may not approve their own request: approved_by is the
          // injected identity of whoever runs approve, so naming A as the
          // requester while running as A is refused.
          assert.equal(
            resultCode(
              operator(['approve', 'activate', '--confirm'], {
                REQRO_OPERATOR_HOSTNAME: hostname,
                REQRO_OPERATOR_EXPECTED_REVISION: '3',
                REQRO_OPERATOR_REQUESTER_IDENTITY: REQUESTER,
              }),
            ),
            'self_approval',
          );

          // Operator B records the approval for operator A.
          const approval = emitted(
            operator(['approve', 'activate', '--confirm'], {
              REQRO_OPERATOR_HOSTNAME: hostname,
              REQRO_OPERATOR_EXPECTED_REVISION: '3',
              REQRO_OPERATOR_IDENTITY: APPROVER,
              REQRO_OPERATOR_REQUESTER_IDENTITY: REQUESTER,
            }),
          );
          const approvalId = String(
            (approval.approval as Record<string, unknown>).id,
          );
          assert.match(approvalId, /^[0-9a-f-]{36}$/);

          // Neither the approver nor a third party may consume it.
          for (const [identity, expected] of [
            [APPROVER, 'self_approval'],
            [THIRD_PARTY, 'approval_context_mismatch'],
          ] as const)
            assert.equal(
              resultCode(
                operator(['activate', '--confirm'], {
                  REQRO_OPERATOR_HOSTNAME: hostname,
                  REQRO_OPERATOR_EXPECTED_REVISION: '3',
                  REQRO_OPERATOR_IDENTITY: identity,
                  REQRO_OPERATOR_APPROVAL_ID: approvalId,
                }),
              ),
              expected,
              identity,
            );

          // A stale revision is refused before the approval is consulted.
          assert.equal(
            resultCode(
              operator(['activate', '--confirm'], {
                REQRO_OPERATOR_HOSTNAME: hostname,
                REQRO_OPERATOR_EXPECTED_REVISION: '2',
                REQRO_OPERATOR_APPROVAL_ID: approvalId,
              }),
            ),
            'revision_stale',
          );

          // Operator A consumes it.
          const activated = emitted(
            operator(['activate', '--confirm'], {
              REQRO_OPERATOR_HOSTNAME: hostname,
              REQRO_OPERATOR_EXPECTED_REVISION: '3',
              REQRO_OPERATOR_APPROVAL_ID: approvalId,
            }),
          );
          assert.equal(
            (
              (activated.outcome as Record<string, unknown>).domain as Record<
                string,
                unknown
              >
            ).active,
            true,
          );
          const live = await stateOf(hostname);
          assert.ok(live);
          assert.equal(live.active, true);
          assert.equal(live.revision, 4);

          // One approval authorizes exactly one transition.
          emitted(
            operator(['deactivate', '--confirm'], {
              REQRO_OPERATOR_HOSTNAME: hostname,
              REQRO_OPERATOR_EXPECTED_REVISION: '4',
            }),
          );
          assert.equal(
            resultCode(
              operator(['activate', '--confirm'], {
                REQRO_OPERATOR_HOSTNAME: hostname,
                REQRO_OPERATOR_EXPECTED_REVISION: '5',
                REQRO_OPERATOR_APPROVAL_ID: approvalId,
              }),
            ),
            'approval_context_mismatch',
          );
        },
      );

      await t.test(
        'an approval for another binding or operation is refused',
        async () => {
          const hostname = await registered('bound.example.gov');
          const other = await registered('bound-other.example.gov');
          await driveToVerified(hostname);
          await driveToVerified(other);

          const forOther = String(
            (
              emitted(
                operator(['approve', 'activate', '--confirm'], {
                  REQRO_OPERATOR_HOSTNAME: other,
                  REQRO_OPERATOR_EXPECTED_REVISION: '3',
                  REQRO_OPERATOR_IDENTITY: APPROVER,
                  REQRO_OPERATOR_REQUESTER_IDENTITY: REQUESTER,
                }),
              ).approval as Record<string, unknown>
            ).id,
          );
          const forRevoke = String(
            (
              emitted(
                operator(['approve', 'revoke', '--confirm'], {
                  REQRO_OPERATOR_HOSTNAME: hostname,
                  REQRO_OPERATOR_EXPECTED_REVISION: '3',
                  REQRO_OPERATOR_IDENTITY: APPROVER,
                  REQRO_OPERATOR_REQUESTER_IDENTITY: REQUESTER,
                }),
              ).approval as Record<string, unknown>
            ).id,
          );

          // An approval for another binding, or one that does not exist, is
          // not reachable for this binding at all, so the guard reports it as
          // missing. One for the right binding but the wrong operation is
          // reachable and is refused on context.
          for (const [label, approvalId, expected] of [
            ['another binding', forOther, 'approval_missing'],
            ['absent', randomUUID(), 'approval_missing'],
            ['another operation', forRevoke, 'approval_context_mismatch'],
          ] as const)
            assert.equal(
              resultCode(
                operator(['activate', '--confirm'], {
                  REQRO_OPERATOR_HOSTNAME: hostname,
                  REQRO_OPERATOR_EXPECTED_REVISION: '3',
                  REQRO_OPERATOR_APPROVAL_ID: approvalId,
                }),
              ),
              expected,
              label,
            );
        },
      );

      await t.test(
        'revocation keeps its ordering rule and needs an approval',
        async () => {
          const hostname = await registered('revocation.example.gov');
          await driveToVerified(hostname);
          const activation = String(
            (
              emitted(
                operator(['approve', 'activate', '--confirm'], {
                  REQRO_OPERATOR_HOSTNAME: hostname,
                  REQRO_OPERATOR_EXPECTED_REVISION: '3',
                  REQRO_OPERATOR_IDENTITY: APPROVER,
                  REQRO_OPERATOR_REQUESTER_IDENTITY: REQUESTER,
                }),
              ).approval as Record<string, unknown>
            ).id,
          );
          emitted(
            operator(['activate', '--confirm'], {
              REQRO_OPERATOR_HOSTNAME: hostname,
              REQRO_OPERATOR_EXPECTED_REVISION: '3',
              REQRO_OPERATOR_APPROVAL_ID: activation,
            }),
          );

          // An active binding cannot be revoked, and no approval exists for
          // that combination either.
          assert.equal(
            resultCode(
              operator(['revoke', '--confirm'], {
                REQRO_OPERATOR_HOSTNAME: hostname,
                REQRO_OPERATOR_EXPECTED_REVISION: '4',
                REQRO_OPERATOR_APPROVAL_ID: randomUUID(),
              }),
            ),
            'database_unavailable',
            'the ordering rule is refused by the operations layer before approval',
          );
          assert.equal(
            resultCode(
              operator(['approve', 'revoke', '--confirm'], {
                REQRO_OPERATOR_HOSTNAME: hostname,
                REQRO_OPERATOR_EXPECTED_REVISION: '4',
                REQRO_OPERATOR_IDENTITY: APPROVER,
                REQRO_OPERATOR_REQUESTER_IDENTITY: REQUESTER,
              }),
            ),
            'database_unavailable',
          );

          emitted(
            operator(['deactivate', '--confirm'], {
              REQRO_OPERATOR_HOSTNAME: hostname,
              REQRO_OPERATOR_EXPECTED_REVISION: '4',
            }),
          );
          assert.equal(
            resultCode(
              operator(['revoke', '--confirm'], {
                REQRO_OPERATOR_HOSTNAME: hostname,
                REQRO_OPERATOR_EXPECTED_REVISION: '5',
                REQRO_OPERATOR_APPROVAL_ID: randomUUID(),
              }),
            ),
            'approval_missing',
          );

          const revocation = String(
            (
              emitted(
                operator(['approve', 'revoke', '--confirm'], {
                  REQRO_OPERATOR_HOSTNAME: hostname,
                  REQRO_OPERATOR_EXPECTED_REVISION: '5',
                  REQRO_OPERATOR_IDENTITY: APPROVER,
                  REQRO_OPERATOR_REQUESTER_IDENTITY: REQUESTER,
                }),
              ).approval as Record<string, unknown>
            ).id,
          );
          const revoked = emitted(
            operator(['revoke', '--confirm'], {
              REQRO_OPERATOR_HOSTNAME: hostname,
              REQRO_OPERATOR_EXPECTED_REVISION: '5',
              REQRO_OPERATOR_APPROVAL_ID: revocation,
            }),
          );
          assert.equal(
            (
              (revoked.outcome as Record<string, unknown>).domain as Record<
                string,
                unknown
              >
            ).verificationState,
            'unverified',
          );
        },
      );

      /** The two dry-run states an approval-required operation supports, and
       * the boundary between a plan and commit validation. */
      // A verified, inactive binding is the state both operations plan
      // against: activation requires it, and revocation's ordering rule
      // requires the binding to be inactive while still holding verification.
      for (const verb of ['activate', 'revoke'] as const)
        await t.test(
          `${verb} distinguishes a pre-approval plan from commit validation`,
          async () => {
            const hostname = await registered(`plan-${verb}.example.gov`);
            await driveToVerified(hostname);
            const before = await stateOf(hostname);
            assert.ok(before);
            assert.equal(before.revision, 3);

            // A. Pre-approval dry run: a plan, explicitly not commit
            // validated, with no approval in existence yet.
            const planned = emitted(
              operator([verb, '--dry-run'], {
                REQRO_OPERATOR_HOSTNAME: hostname,
                REQRO_OPERATOR_EXPECTED_REVISION: '3',
              }),
            );
            assert.equal(planned.mutation, 'not_executed');
            assert.equal(planned.approvalRequired, true);
            assert.equal(planned.approvalPresent, false);
            assert.equal(planned.commitEligibility, 'pending_approval');
            assert.match(String(planned.advisory), /not commit validated/);
            // It must not be readable as full commit eligibility.
            assert.notEqual(planned.commitEligibility, 'validated');
            assert.notEqual(planned.commitEligibility, 'committed');
            // And it must write nothing at all.
            assert.deepEqual(await stateOf(hostname), before);
            assert.equal(
              (
                await sql<{ count: string }>`
                  select count(*)::text as count from tenant_domain_operator_approval
                  where expected_hostname=${hostname}`.execute(database)
              ).rows[0]?.count,
              '0',
            );

            // B. Post-approval dry run: the real constraints run and roll back.
            const approvalId = String(
              (
                emitted(
                  operator(['approve', verb, '--confirm'], {
                    REQRO_OPERATOR_HOSTNAME: hostname,
                    REQRO_OPERATOR_EXPECTED_REVISION: '3',
                    REQRO_OPERATOR_IDENTITY: APPROVER,
                    REQRO_OPERATOR_REQUESTER_IDENTITY: REQUESTER,
                  }),
                ).approval as Record<string, unknown>
              ).id,
            );
            const validated = emitted(
              operator([verb, '--dry-run'], {
                REQRO_OPERATOR_HOSTNAME: hostname,
                REQRO_OPERATOR_EXPECTED_REVISION: '3',
                REQRO_OPERATOR_APPROVAL_ID: approvalId,
              }),
            );
            assert.equal(validated.mutation, 'not_executed');
            assert.equal(validated.approvalPresent, true);
            assert.equal(validated.commitEligibility, 'validated');
            assert.deepEqual(
              await stateOf(hostname),
              before,
              'commit validation still writes nothing',
            );
            // The rollback leaves the approval unspent.
            assert.equal(
              (
                await sql<{ consumed: boolean }>`
                  select tenant_domain_approval_consumed(${approvalId}::uuid) as consumed`.execute(
                  database,
                )
              ).rows[0]?.consumed,
              false,
              'a dry run must not consume the approval',
            );

            // The same still-valid approval then commits exactly once.
            const committed = emitted(
              operator([verb, '--confirm'], {
                REQRO_OPERATOR_HOSTNAME: hostname,
                REQRO_OPERATOR_EXPECTED_REVISION: '3',
                REQRO_OPERATOR_APPROVAL_ID: approvalId,
              }),
            );
            assert.equal(committed.mutation, 'executed');
            assert.equal(committed.commitEligibility, 'committed');
            assert.equal(
              (
                await sql<{ consumed: boolean }>`
                  select tenant_domain_approval_consumed(${approvalId}::uuid) as consumed`.execute(
                  database,
                )
              ).rows[0]?.consumed,
              true,
            );
            const after = await stateOf(hostname);
            assert.ok(after);
            assert.equal(after.revision, 4);

            // Confirming without an approval is still refused.
            assert.equal(
              resultCode(
                operator([verb, '--confirm'], {
                  REQRO_OPERATOR_HOSTNAME: hostname,
                  REQRO_OPERATOR_EXPECTED_REVISION: '4',
                }),
              ),
              'approval_missing',
            );
          },
        );

      await t.test(
        'verification never activates and output carries no secret',
        async () => {
          const hostname = await registered('separate.example.gov');
          await driveToVerified(hostname);
          const current = await stateOf(hostname);
          assert.ok(current);
          assert.equal(current.verification_state, 'verified');
          assert.equal(
            current.active,
            false,
            'reaching verified never makes a hostname resolvable',
          );

          const plan = operator(['deactivate', '--dry-run'], {
            REQRO_OPERATOR_HOSTNAME: hostname,
            REQRO_OPERATOR_EXPECTED_REVISION: '3',
          });
          for (const output of [plan.stdout, plan.stderr]) {
            assert.doesNotMatch(output, /reqro-site-verification/);
            assert.doesNotMatch(output, /postgresql:\/\//);
            assert.doesNotMatch(output, /search_path/);
            assert.doesNotMatch(output, /Synthetic operator command/);
          }
        },
      );
    } finally {
      await db?.destroy();
      if (created) await admin.query(`drop schema "${schema}" cascade`);
      await admin.end();
    }
  },
);
