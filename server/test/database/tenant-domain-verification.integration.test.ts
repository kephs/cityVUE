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
import { TenantResolverService } from '../../src/tenancy/tenant-resolver.service.js';
import { TenantDomainRepository } from '../../src/tenancy/tenant-domain.repository.js';
import {
  activateTenantDomain,
  deactivateTenantDomain,
  issueTenantDomainChallenge,
  recordTenantDomainApproval,
  registerTenantDomain,
  revokeTenantDomainVerification,
  verifyTenantDomain,
} from '../../src/tenancy/tenant-domain.operations.js';
import { verificationRecordName } from '../../src/tenancy/tenant-domain-challenge.js';
import type {
  DnsPort,
  ServerAnswer,
} from '../../src/tenancy/tenant-domain-verifier.js';
import {
  up as up46,
  down as down46,
} from '../../migrations/20261016000000-add-tenant-domain-verification.js';
import { up as up47 } from '../../migrations/20261017000000-add-tenant-domain-operator-controls.js';

const MIGRATION = '20261016000000';
// ADR-027 F060.3C-2a. Every mutation carries version-2 structured
// attribution, and the two approval-bearing operations name a distinct
// approver. The dev: scheme marks this as synthetic development evidence.
const OPERATOR = 'dev:synthetic-operator';
const APPROVER = 'dev:synthetic-approver';
const attribution = () => ({
  operatorIdentity: OPERATOR,
  reason: 'F060.2 synthetic ownership verification evidence',
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

/** Answers from a fixed script, so database behavior is what is under test. */
function dnsPort(
  nameServers: string[],
  reply: (server: string, name: string) => ServerAnswer,
): DnsPort {
  return {
    authoritativeNameServers: () => Promise.resolve(nameServers),
    txtAt: (server, name) => Promise.resolve(reply(server, name)),
  };
}

function publishing(values: string[]): DnsPort {
  return dnsPort(['ns1.example.gov', 'ns2.example.gov'], () => ({
    kind: 'answer',
    answer: { values, ttlSeconds: 300 },
  }));
}

const silent: DnsPort = dnsPort(['ns1.example.gov', 'ns2.example.gov'], () => ({
  kind: 'absent',
}));

test(
  'ADR-025 Slice 1b-A disposable tenant-domain verification invariants',
  { skip: !process.env.TEST_DATABASE_URL && 'TEST_DATABASE_URL missing' },
  async (t) => {
    const testUrl = process.env.TEST_DATABASE_URL;
    assert.ok(testUrl);
    const url = new URL(testUrl);
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
    assert.equal(url.pathname, '/reqro_f0592_test');
    assert.equal(decodeURIComponent(url.username), 'reqro_test_user');
    const admin = new Pool({ connectionString: testUrl });
    const schema = `tenant_verify_${randomUUID().replaceAll('-', '')}`;
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
      assert.equal(earlier.length, 45);
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
            name: `Synthetic verification ${id}`,
            short_name: 'Test',
            slug: id,
            status: 'active',
            default_business_timezone: 'UTC',
          })
          .execute();

      await t.test(
        'migration 46 applies, rolls back and reapplies',
        async () => {
          await database.transaction().execute(up46);
          for (const table of [
            'tenant_domain',
            'tenant_domain_audit',
            'tenant_domain_verification_attempt',
          ])
            assert.equal(
              (
                await sql<{
                  count: string;
                }>`select count(*)::text as count from ${sql.table(table)}`.execute(
                  database,
                )
              ).rows[0]?.count,
              '0',
              `${table} must ship with no default data`,
            );
          await database.transaction().execute(down46);
          assert.equal(
            (
              await sql<{
                present: boolean;
              }>`select to_regclass('tenant_domain_verification_attempt') is not null as present`.execute(
                database,
              )
            ).rows[0]?.present,
            false,
          );
          await database.transaction().execute(up46);
        },
      );

      // ADR-027 F060.3C-2a. The operator path writes version-2 structured
      // attribution and consumes independent approvals, so the code under
      // test now requires Migration 47. It is applied after the rollback case
      // above, which must still exercise Migration 46 on its own.
      await database.transaction().execute(up47);
      // ADR-027 F060.3C-2c-2: every operator path now calls the Organization
      // lock helper, so the hardening must be present for the code under test.
      await applyFunctionHardening(database, schema);

      const selection = (hostname: string, expectedRevision: number) => ({
        organizationId: organizationA,
        hostname,
        attribution: attribution(),
        expectedRevision,
        dryRun: false,
      });

      /** Records an independent approval in its own transaction, which the
       * database requires: an approval committed by the transaction that
       * spends it is refused, so one operator cannot approve and apply
       * atomically. */
      async function approved(
        hostname: string,
        expectedRevision: number,
        operation: 'activated' | 'verification_revoked',
      ) {
        const approval = await recordTenantDomainApproval(database, {
          organizationId: organizationA,
          hostname,
          expectedRevision,
          operation,
          requestedBy: OPERATOR,
          approvedBy: APPROVER,
          reason: 'F060.3C-2a synthetic independent approval',
          correlationId: randomUUID(),
        });
        return {
          ...selection(hostname, expectedRevision),
          approvalId: approval.id,
        };
      }

      async function register(
        hostname: string,
        organizationId = organizationA,
      ) {
        return registerTenantDomain(database, {
          organizationId,
          hostname,
          role: 'public_alias',
          attribution: attribution(),
          dryRun: false,
        });
      }

      /** register -> challenge -> verify, leaving the binding verified and
       * still inactive. Returns the issued challenge value. */
      async function verified(hostname: string): Promise<string> {
        await register(hostname);
        const issued = await issueTenantDomainChallenge(database, {
          ...selection(hostname, 1),
          lifetimeDays: 14,
        });
        const value = issued.challenge?.value;
        assert.ok(value);
        const outcome = await verifyTenantDomain(
          database,
          publishing([value]),
          {
            ...selection(hostname, 2),
          },
        );
        assert.equal(outcome.verified, true);
        return value;
      }

      await t.test(
        'a challenge moves the binding to pending and inactive',
        async () => {
          const hostname = 'challenge.example.gov';
          await register(hostname);
          const issued = await issueTenantDomainChallenge(database, {
            ...selection(hostname, 1),
            lifetimeDays: 14,
          });

          assert.equal(issued.domain.verificationState, 'pending');
          assert.equal(issued.domain.active, false);
          assert.equal(issued.domain.resolvable, false);
          assert.equal(issued.domain.revision, 2);
          const challenge = issued.challenge;
          assert.ok(challenge);
          assert.equal(challenge.recordName, verificationRecordName(hostname));
          assert.equal(challenge.recordType, 'TXT');
          // The window is anchored by the database clock, not the caller's.
          const row = await sql<{
            anchored: boolean;
            within: boolean;
          }>`select verification_requested_at is not null as anchored,
             verification_expires_at <= verification_requested_at + interval '30 days' as within
           from tenant_domain where hostname=${hostname}`.execute(database);
          const window = row.rows[0];
          assert.ok(window);
          assert.equal(window.anchored, true);
          assert.equal(window.within, true);
        },
      );

      await t.test(
        'a replacement challenge invalidates the previous one',
        async () => {
          const hostname = 'replaced.example.gov';
          await register(hostname);
          const first = await issueTenantDomainChallenge(database, {
            ...selection(hostname, 1),
            lifetimeDays: 14,
          });
          const second = await issueTenantDomainChallenge(database, {
            ...selection(hostname, 2),
            lifetimeDays: 14,
          });
          const stale = first.challenge?.value;
          const live = second.challenge?.value;
          assert.ok(stale && live);
          assert.notEqual(stale, live);

          // Publishing only the old value no longer proves anything.
          const replayed = await verifyTenantDomain(
            database,
            publishing([stale]),
            selection(hostname, 3),
          );
          assert.equal(replayed.verified, false);
          assert.equal(replayed.result, 'value_mismatch');

          const accepted = await verifyTenantDomain(
            database,
            publishing([live]),
            {
              ...selection(hostname, 3),
            },
          );
          assert.equal(accepted.verified, true);
        },
      );

      await t.test(
        'a failed attempt is recorded without mutating registry state',
        async () => {
          const hostname = 'failing.example.gov';
          await register(hostname);
          await issueTenantDomainChallenge(database, {
            ...selection(hostname, 1),
            lifetimeDays: 14,
          });
          const before = await sql<{ revision: number; state: string }>`
          select revision, verification_state as state from tenant_domain where hostname=${hostname}`.execute(
            database,
          );

          const outcome = await verifyTenantDomain(database, silent, {
            ...selection(hostname, 2),
          });
          assert.equal(outcome.verified, false);
          assert.equal(outcome.result, 'no_record');

          const after = await sql<{ revision: number; state: string }>`
          select revision, verification_state as state from tenant_domain where hostname=${hostname}`.execute(
            database,
          );
          assert.deepEqual(after.rows, before.rows);
          // No audit row, because nothing transitioned.
          const audited = await sql<{ count: string }>`
          select count(*)::text as count from tenant_domain_audit a
          join tenant_domain d on d.id=a.tenant_domain_id
          where d.hostname=${hostname} and a.action='verified'`.execute(
            database,
          );
          assert.equal(audited.rows[0]?.count, '0');
          // The attempt itself persisted.
          const attempts = await sql<{ count: string; result: string }>`
          select count(*)::text as count, max(result) as result
          from tenant_domain_verification_attempt t
          join tenant_domain d on d.id=t.tenant_domain_id where d.hostname=${hostname}`.execute(
            database,
          );
          const attempt = attempts.rows[0];
          assert.ok(attempt);
          assert.equal(attempt.count, '1');
          assert.equal(attempt.result, 'no_record');
        },
      );

      await t.test('an expired challenge cannot verify', async () => {
        const hostname = 'expired.example.gov';
        await register(hostname);
        await issueTenantDomainChallenge(database, {
          ...selection(hostname, 1),
          lifetimeDays: 14,
        });
        // The window cannot be shrunk in place — the trigger only accepts a
        // pending->pending move that carries a genuinely new token — so this
        // issues a replacement challenge with a one-second window through a
        // properly audited transition, then lets it lapse.
        const value = `reqro-site-verification=v1.${'z'.repeat(43)}`;
        await database.transaction().execute(async (trx) => {
          await sql`update tenant_domain
              set verification_state='pending', verification_method='dns_txt',
                verification_challenge=${value},
                verification_token_id=gen_random_uuid(),
                verification_expires_at=clock_timestamp()+interval '1 second',
                revision=revision+1
              where organization_id=${organizationA}::uuid and hostname=${hostname}`.execute(
            trx,
          );
          // Carries version-2 attribution, which Migration 47 now requires of
          // every new audit row, including one written by raw SQL.
          await sql`insert into tenant_domain_audit(organization_id,tenant_domain_id,hostname,action,actor,
              attribution_version,operator_identity,reason,correlation_id,outcome,
              prior_revision,revision,prior_role,role,prior_verification_state,verification_state,prior_active,active)
            select d.organization_id,d.id,d.hostname,'verification_requested',${OPERATOR},
              2,${OPERATOR},'Synthetic replacement challenge with a lapsing window',gen_random_uuid(),'applied',
              d.revision-1,d.revision,d.role,d.role,'pending',d.verification_state,d.active,d.active
            from tenant_domain d
            where d.organization_id=${organizationA}::uuid and d.hostname=${hostname}`.execute(
            trx,
          );
        });
        await new Promise((resolve) => setTimeout(resolve, 1200));

        const outcome = await verifyTenantDomain(
          database,
          publishing([value]),
          {
            ...selection(hostname, 3),
          },
        );
        assert.equal(outcome.verified, false);
        assert.equal(outcome.result, 'challenge_expired');

        // The database refuses the transition even if application logic did not.
        await refuses(
          () =>
            sql`update tenant_domain set verification_state='verified',verified_at=clock_timestamp(),
                  verification_evidence='{}'::jsonb,revision=revision+1 where hostname=${hostname}`.execute(
              database,
            ),
          /challenge has expired/,
        );
      });

      await t.test(
        'the challenge window cannot exceed the approved maximum',
        async () => {
          const hostname = 'bounds.example.gov';
          await register(hostname);
          await refuses(
            () =>
              sql`update tenant_domain set verification_state='pending',verification_method='dns_txt',
                  verification_challenge='reqro-site-verification=v1.x',
                  verification_token_id=gen_random_uuid(),
                  verification_expires_at=clock_timestamp()+interval '31 days',
                  revision=revision+1 where hostname=${hostname}`.execute(
                database,
              ),
            /challenge lifetime is out of bounds/,
          );
        },
      );

      await t.test(
        'verification leaves the binding inactive and unresolvable',
        async () => {
          const hostname = 'inactive.example.gov';
          await verified(hostname);
          const row = await sql<{ state: string; active: boolean }>`
          select verification_state as state, active from tenant_domain where hostname=${hostname}`.execute(
            database,
          );
          const state = row.rows[0];
          assert.ok(state);
          assert.equal(state.state, 'verified');
          assert.equal(state.active, false);

          const resolver = new TenantResolverService(
            new TenantDomainRepository({ client: database } as never),
          );
          assert.equal(await resolver.resolve(hostname), null);
        },
      );

      await t.test('activation without verification is rejected', async () => {
        const hostname = 'unverified-activate.example.gov';
        await register(hostname);
        // An unverified binding cannot even be approved for activation, so
        // the verification precondition is proven to fire before any approval
        // is consulted.
        await refuses(
          () =>
            recordTenantDomainApproval(database, {
              organizationId: organizationA,
              hostname,
              expectedRevision: 1,
              operation: 'activated',
              requestedBy: OPERATOR,
              approvedBy: APPROVER,
              reason: 'F060.3C-2a synthetic independent approval',
              correlationId: randomUUID(),
            }),
          /Only a verified tenant domain can be approved for activation/,
        );
        await refuses(
          () =>
            activateTenantDomain(database, {
              ...selection(hostname, 1),
              approvalId: randomUUID(),
            }),
          /Only a verified tenant domain can be activated/,
        );
        await refuses(
          () =>
            sql`update tenant_domain set active=true,revision=revision+1 where hostname=${hostname}`.execute(
              database,
            ),
          /Only a verified tenant domain can be activated/,
        );
      });

      await t.test(
        'activation after verification makes the hostname resolvable',
        async () => {
          const hostname = 'activated.example.gov';
          await verified(hostname);
          const activated = await activateTenantDomain(
            database,
            await approved(hostname, 3, 'activated'),
          );

          assert.equal(activated.domain.active, true);
          assert.equal(activated.domain.resolvable, true);
          const resolver = new TenantResolverService(
            new TenantDomainRepository({ client: database } as never),
          );
          assert.ok(await resolver.resolve(hostname));
        },
      );

      await t.test(
        'revoking an active hostname is refused until it is deactivated',
        async () => {
          const hostname = 'revoke-order.example.gov';
          await verified(hostname);
          await activateTenantDomain(
            database,
            await approved(hostname, 3, 'activated'),
          );

          await refuses(
            () =>
              revokeTenantDomainVerification(database, {
                ...selection(hostname, 4),
                approvalId: randomUUID(),
              }),
            /Deactivate the tenant domain before revoking verification/,
          );
          await deactivateTenantDomain(database, selection(hostname, 4));
          const revoked = await revokeTenantDomainVerification(
            database,
            await approved(hostname, 5, 'verification_revoked'),
          );

          assert.equal(revoked.domain.verificationState, 'unverified');
          assert.equal(revoked.domain.active, false);
          const resolver = new TenantResolverService(
            new TenantDomainRepository({ client: database } as never),
          );
          assert.equal(await resolver.resolve(hostname), null);
        },
      );

      await t.test(
        'a challenge issued for one hostname cannot verify another',
        async () => {
          const mine = 'mine.example.gov';
          const theirs = 'theirs.example.gov';
          await register(mine);
          await register(theirs, organizationB);
          const issued = await issueTenantDomainChallenge(database, {
            ...selection(mine, 1),
            lifetimeDays: 14,
          });
          const value = issued.challenge?.value;
          assert.ok(value);
          await issueTenantDomainChallenge(database, {
            organizationId: organizationB,
            hostname: theirs,
            attribution: attribution(),
            expectedRevision: 1,
            lifetimeDays: 14,
            dryRun: false,
          });

          // Publishing my token under their name proves nothing.
          const outcome = await verifyTenantDomain(
            database,
            publishing([value]),
            {
              organizationId: organizationB,
              hostname: theirs,
              attribution: attribution(),
              expectedRevision: 2,
              dryRun: false,
            },
          );
          assert.equal(outcome.verified, false);
          assert.equal(outcome.result, 'value_mismatch');
        },
      );

      await t.test(
        'attempt evidence is append-only and bound to its binding',
        async () => {
          await refuses(
            () =>
              sql`update tenant_domain_verification_attempt set actor='rewritten'`.execute(
                database,
              ),
            /append-only/,
          );
          await refuses(
            () =>
              sql`delete from tenant_domain_verification_attempt`.execute(
                database,
              ),
            /append-only/,
          );
          await refuses(
            () =>
              sql`truncate tenant_domain_verification_attempt`.execute(
                database,
              ),
            /append-only/,
          );

          const binding = await sql<{
            id: string;
            revision: number;
            token: string;
          }>`
          select id, revision, verification_token_id as token from tenant_domain
          where hostname='activated.example.gov'`.execute(database);
          const row = binding.rows[0];
          assert.ok(row);
          // A record name not derived from the stored hostname is refused.
          await refuses(
            () =>
              sql`insert into tenant_domain_verification_attempt(organization_id,tenant_domain_id,hostname,
                  record_name,token_id,binding_revision,expected_challenge_hash,observed_value_count,
                  result,resolver_mode,name_servers,agreement_count,dnssec,actor,correlation_id,policy_version)
                values(${organizationA}::uuid,${row.id}::uuid,'activated.example.gov',
                  '_reqro-verify.attacker.example.com',${row.token}::uuid,${row.revision},
                  repeat('a',64),0,'no_record','authoritative','{}'::text[],0,
                  '{"validated":false}'::jsonb,'operator',gen_random_uuid(),1)`.execute(
                database,
              ),
            /not derived from the hostname/,
          );
          // So is evidence claiming cryptographic DNSSEC validation.
          await refuses(
            () =>
              sql`insert into tenant_domain_verification_attempt(organization_id,tenant_domain_id,hostname,
                  record_name,token_id,binding_revision,expected_challenge_hash,observed_value_count,
                  result,resolver_mode,name_servers,agreement_count,dnssec,actor,correlation_id,policy_version)
                values(${organizationA}::uuid,${row.id}::uuid,'activated.example.gov',
                  '_reqro-verify.activated.example.gov',${row.token}::uuid,${row.revision},
                  repeat('a',64),0,'no_record','authoritative','{}'::text[],0,
                  '{"validated":true}'::jsonb,'operator',gen_random_uuid(),1)`.execute(
                database,
              ),
            /violates check constraint/i,
          );
        },
      );

      await t.test(
        'concurrent verification attempts cannot both advance the revision',
        async () => {
          const hostname = 'concurrent.example.gov';
          await register(hostname);
          const issued = await issueTenantDomainChallenge(database, {
            ...selection(hostname, 1),
            lifetimeDays: 14,
          });
          const value = issued.challenge?.value;
          assert.ok(value);

          const outcomes = await Promise.allSettled([
            verifyTenantDomain(database, publishing([value]), {
              ...selection(hostname, 2),
            }),
            verifyTenantDomain(database, publishing([value]), {
              ...selection(hostname, 2),
            }),
          ]);
          const verifiedCount = outcomes.filter(
            (outcome) =>
              outcome.status === 'fulfilled' && outcome.value.verified,
          ).length;
          assert.equal(verifiedCount, 1);

          const row = await sql<{ revision: number }>`
          select revision from tenant_domain where hostname=${hostname}`.execute(
            database,
          );
          assert.equal(row.rows[0]?.revision, 3);
        },
      );

      await t.test(
        'audit integrity is preserved across the verification lifecycle',
        async () => {
          const actions = await sql<{ action: string }>`
          select a.action from tenant_domain_audit a
          join tenant_domain d on d.id=a.tenant_domain_id
          where d.hostname='revoke-order.example.gov' order by a.revision`.execute(
            database,
          );
          assert.deepEqual(
            actions.rows.map((entry) => entry.action),
            [
              'registered',
              'verification_requested',
              'verified',
              'activated',
              'deactivated',
              'verification_revoked',
            ],
          );
          await refuses(
            () =>
              sql`update tenant_domain_audit set actor='x'`.execute(database),
            /append-only/,
          );
        },
      );

      await t.test(
        'rollback refuses to discard retained verification evidence',
        async () => {
          await refuses(
            () => database.transaction().execute(down46),
            /Retained tenant domain verification evidence prevents rollback/,
          );
          assert.equal(
            (
              await sql<{
                present: boolean;
              }>`select to_regclass('tenant_domain_verification_attempt') is not null as present`.execute(
                database,
              )
            ).rows[0]?.present,
            true,
          );
        },
      );

      await t.test(
        'an oversized hostname cannot be registered at all',
        async () => {
          const label = 'a'.repeat(60);
          const oversized = [label, label, label, 'a'.repeat(57)].join('.');
          assert.equal(oversized.length, 240);
          await refuses(
            () => register(oversized),
            /tenant_domain_hostname_verifiable|violates check constraint/i,
          );
        },
      );
    } finally {
      if (db) await db.destroy();
      if (created) {
        assert.match(schema, /^tenant_verify_[a-f0-9]{32}$/);
        await admin.query(`drop schema "${schema}" cascade`);
      }
      await admin.end();
    }
  },
);
