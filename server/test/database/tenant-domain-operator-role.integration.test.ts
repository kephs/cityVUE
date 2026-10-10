import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import type {
  DnsPort,
  ServerAnswer,
} from '../../src/tenancy/tenant-domain-verifier.js';
import {
  activateTenantDomain,
  deactivateTenantDomain,
  inspectTenantDomain,
  issueTenantDomainChallenge,
  listTenantDomains,
  recordTenantDomainApproval,
  registerTenantDomain,
  revokeTenantDomainVerification,
  verifyTenantDomain,
} from '../../src/tenancy/tenant-domain.operations.js';
import {
  resolveDeploymentSchema,
  withoutConnectionOptions,
} from '../../src/config/operator-environment.js';
import {
  dockerAvailable,
  startControlledCluster,
  type ControlledCluster,
} from '../helpers/operator-role-cluster.js';

/**
 * ADR-027 F060.3C-2c-3. Proves the least-privilege platform-operator database
 * role empirically, against a disposable **PostgreSQL 17** cluster this suite
 * owns outright.
 *
 * Why a dedicated cluster. Every other database suite here runs as
 * `reqro_test_user`, which owns the objects it creates and cannot create
 * roles. An owner holds every privilege implicitly, so "the operator cannot
 * do X" is unprovable there: revoking from `PUBLIC` does not constrain an
 * owner. Genuine role separation needs three identities — a cluster
 * superuser that provisions, a non-superuser schema owner that migrates, and
 * a constrained role that owns nothing — which in turn needs a cluster the
 * test controls.
 *
 * **PostgreSQL 17 is authoritative** because `server/compose.yml` pins
 * `postgres:17-alpine`. The harness refuses any other major version, so a
 * developer's newer local server cannot silently become the evidence.
 *
 * If Docker is unavailable this suite **skips**. A skip is not a pass: the
 * role model is unproven until this runs.
 *
 * Nothing here touches a shared or developer database, no credential is read
 * from the environment, and the cluster is removed in `finally`.
 */

/** The measured minimal grant set. Every entry is ablated individually below,
 * so this list is a necessity claim backed by a failure, not a preference.
 *
 * `update (policy_version)` on the approval table is the one privilege that
 * exists only to satisfy `SELECT ... FOR SHARE`: PostgreSQL requires UPDATE on
 * at least one column of a row-locked table, and the audit guard locks the
 * approval it spends. It is proven inert below — the approval table's
 * immutability trigger refuses every UPDATE, and `check(policy_version=1)`
 * independently admits no other value. */
const MINIMAL_GRANTS: readonly (readonly [string, string])[] = [
  ['schema usage', 'usage on schema public'],
  ['tenant_domain select', 'select on public.tenant_domain'],
  ['tenant_domain insert', 'insert on public.tenant_domain'],
  ['tenant_domain update', 'update on public.tenant_domain'],
  ['audit select', 'select on public.tenant_domain_audit'],
  ['audit insert', 'insert on public.tenant_domain_audit'],
  ['approval select', 'select on public.tenant_domain_operator_approval'],
  ['approval insert', 'insert on public.tenant_domain_operator_approval'],
  // Authorized explicitly for F060.3C-2c-3, and only because PostgreSQL
  // requires UPDATE on at least one column of a row-locked table. Proven
  // below to confer no mutation authority whatsoever.
  [
    'approval row-lock column update',
    'update (policy_version) on public.tenant_domain_operator_approval',
  ],
  ['attempt insert', 'insert on public.tenant_domain_verification_attempt'],
  [
    'lock helper execute',
    'execute on function public.tenant_domain_lock_organization(uuid)',
  ],
];

/** Every trigger function on the control-plane surface. The operator needs
 * EXECUTE on none of them, which this suite proves rather than assumes. */
const TRIGGER_FUNCTION_COUNT = 7;

/** The approved control-plane surface. Every other relation in the schema must
 * expose nothing at all to the operator, which is asserted as a complement
 * rather than as a list of forbidden names. */
const APPROVED_TABLES = [
  'tenant_domain',
  'tenant_domain_audit',
  'tenant_domain_operator_approval',
  'tenant_domain_verification_attempt',
] as const;

/** The one approved column-level exception. */
const APPROVED_COLUMN_UPDATE = {
  table: 'tenant_domain_operator_approval',
  column: 'policy_version',
} as const;

const MIGRATION_48 = '20261018000000-harden-tenant-domain-functions.ts';

/** The hardening migration is applied as its own SQL text, unmodified. Other
 * suites rewrite `public.` to a disposable schema; here the application schema
 * genuinely *is* `public`, so the literal deployment spelling is exercised. */
async function migration48Sql(): Promise<string> {
  const source = await readFile(
    path.resolve(__dirname, '../../../migrations', MIGRATION_48),
    'utf8',
  );
  const pattern = new RegExp(
    'export async function up[\\s\\S]*?await sql`([\\s\\S]*?)`\\.execute',
  );
  const body = pattern.exec(source)?.[1];
  if (body === undefined) throw new Error('Migration 48 up() body not found');
  assert.match(body, /public\.tenant_domain_lock_organization/);
  return body;
}

function connect(
  cluster: ControlledCluster,
  role: { user: string; password: string },
  options?: string,
): Kysely<DatabaseSchema> {
  return new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool: new Pool(
        options === undefined
          ? { connectionString: cluster.url(role), max: 4 }
          : { connectionString: cluster.url(role), max: 4, options },
      ),
    }),
  });
}

const attribution = (identity: string) => ({
  operatorIdentity: identity,
  reason: 'F060.3C-2c-3 least-privilege operator role proof',
  correlationId: randomUUID(),
});

/** Answers from a fixed script, so database privileges are what is under test
 * rather than the network. */
function publishing(values: readonly string[]): DnsPort {
  const answer: ServerAnswer = {
    kind: 'answer',
    answer: { values: [...values], ttlSeconds: 300 },
  };
  return {
    authoritativeNameServers: () =>
      Promise.resolve(['ns1.example.gov', 'ns2.example.gov']),
    txtAt: () => Promise.resolve(answer),
  };
}

/** The first line of a failure, which is the part that names the privilege or
 * the guard that refused. */
function reason(error: unknown): string {
  return ((error as Error).message.split('\n')[0] ?? '').trim();
}

async function refuses(
  operation: () => Promise<unknown>,
  expected: RegExp,
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.match((error as Error).message, expected);
    return true;
  });
}

test(
  'ADR-027 F060.3C-2c-3 least-privilege operator role on PostgreSQL 17',
  {
    skip: !dockerAvailable() && 'Docker unavailable; the role proof is skipped',
  },
  async (t) => {
    const cluster = await startControlledCluster();
    const owner = connect(cluster, cluster.owner);
    const operator = connect(cluster, cluster.operator);
    const extra: Kysely<DatabaseSchema>[] = [];
    try {
      const organizationId = randomUUID();
      const inactiveOrganizationId = randomUUID();
      let hostnameSeq = 0;
      const nextHostname = () => {
        hostnameSeq += 1;
        return `operator-role-${String(hostnameSeq)}.example.gov`;
      };

      const grant = (clause: string) =>
        sql.raw(`grant ${clause} to ${cluster.operator.user}`).execute(owner);
      const revoke = (clause: string) =>
        sql
          .raw(`revoke ${clause} from ${cluster.operator.user}`)
          .execute(owner);

      /** The complete operator lifecycle: all seven verbs plus both read
       * paths, driven through the real operations module as the constrained
       * role. Reports the first failing verb, so a privilege requirement is
       * attributed to a verb rather than inferred. */
      async function lifecycle(
        session: Kysely<DatabaseSchema>,
        hostname: string,
      ): Promise<readonly string[]> {
        const completed: string[] = [];
        const step = async <T>(name: string, run: () => Promise<T>) => {
          try {
            const value = await run();
            completed.push(name);
            return value;
          } catch (error) {
            throw new Error(`${name}: ${reason(error)}`, { cause: error });
          }
        };
        const base = { organizationId, dryRun: false };
        const registered = await step('register', () =>
          registerTenantDomain(session, {
            ...base,
            attribution: attribution('dev:probe-operator'),
            hostname,
            role: 'public_alias',
          }),
        );
        const challenged = await step('issue-challenge', () =>
          issueTenantDomainChallenge(session, {
            ...base,
            attribution: attribution('dev:probe-operator'),
            hostname,
            expectedRevision: registered.domain.revision,
            lifetimeDays: 14,
          }),
        );
        assert.ok(challenged.challenge);
        const issued = challenged.challenge.value;
        const verified = await step('verify', () =>
          verifyTenantDomain(session, publishing([issued]), {
            ...base,
            attribution: attribution('dev:probe-operator'),
            hostname,
            expectedRevision: challenged.domain.revision,
          }),
        );
        assert.equal(verified.verified, true);
        const activation = await step('approve/activated', () =>
          recordTenantDomainApproval(session, {
            organizationId,
            hostname,
            expectedRevision: verified.domain.revision,
            operation: 'activated',
            requestedBy: 'dev:probe-operator',
            approvedBy: 'dev:probe-approver',
            reason: 'F060.3C-2c-3 least-privilege operator role proof',
            correlationId: randomUUID(),
          }),
        );
        const activated = await step('activate', () =>
          activateTenantDomain(session, {
            ...base,
            attribution: attribution('dev:probe-operator'),
            hostname,
            expectedRevision: verified.domain.revision,
            approvalId: activation.id,
          }),
        );
        assert.equal(activated.domain.resolvable, true);
        const deactivated = await step('deactivate', () =>
          deactivateTenantDomain(session, {
            ...base,
            attribution: attribution('dev:probe-operator'),
            hostname,
            expectedRevision: activated.domain.revision,
          }),
        );
        assert.equal(deactivated.domain.active, false);
        const revocation = await step('approve/verification_revoked', () =>
          recordTenantDomainApproval(session, {
            organizationId,
            hostname,
            expectedRevision: deactivated.domain.revision,
            operation: 'verification_revoked',
            requestedBy: 'dev:probe-operator',
            approvedBy: 'dev:probe-approver',
            reason: 'F060.3C-2c-3 least-privilege operator role proof',
            correlationId: randomUUID(),
          }),
        );
        const revoked = await step('revoke', () =>
          revokeTenantDomainVerification(session, {
            ...base,
            attribution: attribution('dev:probe-operator'),
            hostname,
            expectedRevision: deactivated.domain.revision,
            approvalId: revocation.id,
          }),
        );
        assert.equal(revoked.domain.verificationState, 'unverified');
        await step('list/inspect', async () => {
          await listTenantDomains(session, organizationId);
          const one = await inspectTenantDomain(
            session,
            organizationId,
            hostname,
          );
          assert.ok(one);
        });
        return completed;
      }

      await t.test(
        'the cluster is PostgreSQL 17, the version compose.yml pins',
        async () => {
          const version = await sql<{ major: number }>`
            select (current_setting('server_version_num')::int / 10000) as major
            `.execute(owner);
          assert.equal(version.rows[0]?.major, 17);
        },
      );

      await t.test(
        'the whole schema applies as a non-superuser owner, Migration 48 included, with its literal public qualification',
        async () => {
          const folder = path.resolve(__dirname, '../../migrations');
          const { readdir } = await import('node:fs/promises');
          const files = (await readdir(folder))
            .filter((file) => file.endsWith('.js'))
            .sort();
          assert.equal(files.length, 49);
          for (const file of files) {
            const migration = (await import(
              path
                .join(folder, file)
                .replace(/\\/g, '/')
                .replace(/^/, 'file:///')
            )) as { up: (db: Kysely<DatabaseSchema>) => Promise<void> };
            await owner.transaction().execute(migration.up);
          }
          await sql.raw(await migration48Sql()).execute(owner);
          const helper = await sql<{ secdef: boolean; config: string[] }>`
            select p.prosecdef as secdef, p.proconfig as config
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname = 'tenant_domain_lock_organization'`.execute(owner);
          assert.deepEqual(helper.rows, [
            { secdef: true, config: ['search_path=pg_catalog, pg_temp'] },
          ]);

          for (const [id, status] of [
            [organizationId, 'active'] as const,
            [inactiveOrganizationId, 'inactive'] as const,
          ])
            await owner
              .insertInto('organization')
              .values({
                id,
                name: `Synthetic operator-role organization ${status}`,
                short_name: 'Probe',
                slug: id,
                status,
                default_business_timezone: 'UTC',
              })
              .execute();
        },
      );

      await t.test(
        'the operator is a genuinely separate identity that owns nothing',
        async () => {
          const role = await sql<{
            rolsuper: boolean;
            rolcreatedb: boolean;
            rolcreaterole: boolean;
            rolinherit: boolean;
            rolbypassrls: boolean;
            memberships: string;
            owned: string;
          }>`
            select r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolinherit,
                   r.rolbypassrls,
                   (select count(*) from pg_auth_members m where m.member = r.oid) as memberships,
                   (select count(*) from pg_class c where c.relowner = r.oid) as owned
            from pg_roles r where r.rolname = ${cluster.operator.user}`.execute(
            owner,
          );
          assert.deepEqual(role.rows, [
            {
              rolsuper: false,
              rolcreatedb: false,
              rolcreaterole: false,
              rolinherit: false,
              rolbypassrls: false,
              memberships: '0',
              owned: '0',
            },
          ]);
          // Every control-plane table belongs to the schema owner, so the
          // operator's constraints are real rather than nominal.
          const tables = await sql<{ relname: string; owner: string }>`
            select c.relname, pg_get_userbyid(c.relowner) as owner
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r'
              and c.relname like 'tenant_domain%'
            order by c.relname`.execute(owner);
          assert.deepEqual(
            tables.rows.map((row) => row.owner),
            Array.from({ length: 4 }, () => cluster.owner.user),
          );
        },
      );

      await t.test(
        'PostgreSQL 17 already denies the ungranted operator every CREATE it would need to escape',
        async () => {
          const posture = await sql<{
            schema_create: boolean;
            schema_usage: boolean;
            db_create: boolean;
            db_connect: boolean;
            own_schema: string;
          }>`
            select has_schema_privilege(${cluster.operator.user}, 'public', 'CREATE') as schema_create,
                   has_schema_privilege(${cluster.operator.user}, 'public', 'USAGE') as schema_usage,
                   has_database_privilege(${cluster.operator.user}, ${cluster.database}, 'CREATE') as db_create,
                   has_database_privilege(${cluster.operator.user}, ${cluster.database}, 'CONNECT') as db_connect,
                   (select count(*) from pg_namespace where nspname = ${cluster.operator.user}) as own_schema
            `.execute(owner);
          // No CREATE on public (PostgreSQL 15 removed that default) and no
          // CREATE on the database, so the role cannot build a writable schema
          // its search_path would reach. `$user` stays empty for the same
          // reason, which is what makes the default `"$user", public` path safe
          // here rather than merely conventional.
          assert.deepEqual(posture.rows, [
            {
              schema_create: false,
              schema_usage: true,
              db_create: false,
              db_connect: true,
              own_schema: '0',
            },
          ]);
        },
      );

      await t.test(
        'with zero grants the operator reaches no control-plane object at all',
        async () => {
          const denied = [
            'select 1 from public.tenant_domain limit 1',
            'select 1 from public.tenant_domain_audit limit 1',
            'select 1 from public.tenant_domain_operator_approval limit 1',
            'select 1 from public.tenant_domain_verification_attempt limit 1',
            'select 1 from public.organization limit 1',
          ];
          for (const statement of denied)
            await refuses(
              () => sql.raw(statement).execute(operator),
              /permission denied for table/,
            );
          await refuses(
            () =>
              sql`select public.tenant_domain_lock_organization(${organizationId}::uuid)`.execute(
                operator,
              ),
            /permission denied for function/,
          );
        },
      );

      await t.test(
        'the operator path needs no sequence or identity privilege',
        async () => {
          const generated = await sql<{ relname: string }>`
            select c.relname
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            join pg_attribute a on a.attrelid = c.oid and a.attnum > 0
              and not a.attisdropped
            where n.nspname = 'public' and c.relname like 'tenant_domain%'
              and (a.attidentity <> ''
                or pg_get_serial_sequence('public.' || c.relname, a.attname) is not null)`.execute(
            owner,
          );
          assert.deepEqual(generated.rows, []);
        },
      );

      await t.test(
        'the minimal grant set executes all seven operator verbs',
        async () => {
          for (const [, clause] of MINIMAL_GRANTS) await grant(clause);
          const completed = await lifecycle(operator, nextHostname());
          assert.deepEqual(completed, [
            'register',
            'issue-challenge',
            'verify',
            'approve/activated',
            'activate',
            'deactivate',
            'approve/verification_revoked',
            'revoke',
            'list/inspect',
          ]);
        },
      );

      await t.test(
        'every table and function grant in the set is load bearing',
        async () => {
          // Collected rather than asserted one by one, so a grant that turns
          // out to be redundant is named instead of surfacing as a bare
          // "missing expected rejection". An earlier exploratory run reported
          // every ablation as load bearing only because the set it ablated was
          // already failing for an unrelated reason -- a vacuous pass, which is
          // worse than a failure.
          const verdicts: Record<string, boolean> = {};
          for (const [label, clause] of MINIMAL_GRANTS) {
            await revoke(clause);
            try {
              await lifecycle(operator, nextHostname());
              verdicts[label] = false;
            } catch (error) {
              assert.match((error as Error).message, /permission denied/);
              verdicts[label] = true;
            }
            await grant(clause);
          }
          // `usage on schema public` is the one entry a default PostgreSQL 17
          // database does not need: PUBLIC still holds schema USAGE, so
          // revoking the role's own grant changes nothing. It is kept in the
          // artifact because it becomes load bearing the moment a deployment
          // revokes USAGE from PUBLIC, which the next subtest proves, and
          // because an explicit grant is not a privilege expansion over a
          // privilege the role already holds implicitly.
          assert.deepEqual(verdicts, {
            'schema usage': false,
            'tenant_domain select': true,
            'tenant_domain insert': true,
            'tenant_domain update': true,
            'audit select': true,
            'audit insert': true,
            'approval select': true,
            'approval insert': true,
            'approval row-lock column update': true,
            'attempt insert': true,
            'lock helper execute': true,
          });
          // The set still works once every ablation has been restored.
          await lifecycle(operator, nextHostname());
        },
      );

      await t.test(
        'the explicit schema USAGE grant is what carries a deployment that revokes USAGE from PUBLIC',
        async () => {
          await sql
            .raw('revoke usage on schema public from public')
            .execute(owner);
          // Still working: the role holds USAGE in its own right.
          await lifecycle(operator, nextHostname());
          await revoke('usage on schema public');
          await refuses(
            () => lifecycle(operator, nextHostname()),
            /permission denied for schema public|does not exist/,
          );
          await grant('usage on schema public');
          await sql
            .raw('grant usage on schema public to public')
            .execute(owner);
        },
      );

      await t.test(
        'the approval row lock is the only reason UPDATE appears on the approval table, and it is the activate verb that needs it',
        async () => {
          await revoke(
            'update (policy_version) on public.tenant_domain_operator_approval',
          );
          await assert.rejects(
            () => lifecycle(operator, nextHostname()),
            (error: unknown) => {
              // Attributed to a verb: everything up to the approval is
              // reachable, and it is spending one that needs the row lock.
              assert.match(
                (error as Error).message,
                /^activate: .*permission denied for table tenant_domain_operator_approval/,
              );
              return true;
            },
          );
          await grant(
            'update (policy_version) on public.tenant_domain_operator_approval',
          );
        },
      );

      await t.test(
        'that column grant confers no table-level UPDATE and no authority over any approval field',
        async () => {
          const surface = await sql<{
            table_update: boolean;
            policy_version: boolean;
            approved_by: boolean;
            expires_at: boolean;
            requested_by: boolean;
          }>`
            select has_table_privilege(${cluster.operator.user}, 'public.tenant_domain_operator_approval', 'UPDATE') as table_update,
                   has_column_privilege(${cluster.operator.user}, 'public.tenant_domain_operator_approval', 'policy_version', 'UPDATE') as policy_version,
                   has_column_privilege(${cluster.operator.user}, 'public.tenant_domain_operator_approval', 'approved_by', 'UPDATE') as approved_by,
                   has_column_privilege(${cluster.operator.user}, 'public.tenant_domain_operator_approval', 'expires_at', 'UPDATE') as expires_at,
                   has_column_privilege(${cluster.operator.user}, 'public.tenant_domain_operator_approval', 'requested_by', 'UPDATE') as requested_by
            `.execute(owner);
          assert.deepEqual(surface.rows, [
            {
              table_update: false,
              policy_version: true,
              approved_by: false,
              expires_at: false,
              requested_by: false,
            },
          ]);

          const before = await sql<{
            rows: string;
            policy_v1: string;
            approvers: string;
          }>`
            select count(*) as rows,
                   count(*) filter (where policy_version = 1) as policy_v1,
                   count(*) filter (where approved_by = 'dev:probe-approver') as approvers
            from public.tenant_domain_operator_approval`.execute(owner);

          // The one column it may name is refused by the immutability trigger,
          // so the grant is inert rather than merely narrow. `policy_version`
          // additionally carries check(policy_version=1), so no other value is
          // representable even if that trigger were absent.
          for (const value of [1, 2])
            await refuses(
              () =>
                sql
                  .raw(
                    `update public.tenant_domain_operator_approval set policy_version=${String(value)}`,
                  )
                  .execute(operator),
              /Tenant domain operator approvals are immutable/,
            );
          // Every other field, and removal, stay out of reach at the privilege
          // layer, before any trigger runs.
          for (const statement of [
            "update public.tenant_domain_operator_approval set approved_by='dev:attacker'",
            "update public.tenant_domain_operator_approval set expires_at=now()+interval '30 days'",
            'delete from public.tenant_domain_operator_approval',
            'truncate public.tenant_domain_operator_approval',
          ])
            await refuses(
              () => sql.raw(statement).execute(operator),
              /permission denied for table tenant_domain_operator_approval/,
            );

          const after = await sql<{
            rows: string;
            policy_v1: string;
            approvers: string;
          }>`
            select count(*) as rows,
                   count(*) filter (where policy_version = 1) as policy_v1,
                   count(*) filter (where approved_by = 'dev:probe-approver') as approvers
            from public.tenant_domain_operator_approval`.execute(owner);
          assert.deepEqual(after.rows, before.rows);
          assert.ok(Number(after.rows[0]?.rows) > 0);
        },
      );

      await t.test(
        'the operator holds no Organization privilege, yet a binding still cannot name a missing Organization',
        async () => {
          const organizationSurface = await sql<{
            select: boolean;
            insert: boolean;
            update: boolean;
            delete: boolean;
          }>`
            select has_table_privilege(${cluster.operator.user}, 'public.organization', 'SELECT') as select,
                   has_table_privilege(${cluster.operator.user}, 'public.organization', 'INSERT') as insert,
                   has_table_privilege(${cluster.operator.user}, 'public.organization', 'UPDATE') as update,
                   has_table_privilege(${cluster.operator.user}, 'public.organization', 'DELETE') as delete
            `.execute(owner);
          assert.deepEqual(organizationSurface.rows, [
            { select: false, insert: false, update: false, delete: false },
          ]);
          // Referential integrity is enforced without the referencing role
          // holding any privilege on the parent, which is what lets the
          // Organization table leave the operator's surface entirely.
          await refuses(
            () =>
              registerTenantDomain(operator, {
                organizationId: randomUUID(),
                dryRun: false,
                attribution: attribution('dev:probe-operator'),
                hostname: nextHostname(),
                role: 'public_alias',
              }),
            /violates foreign key constraint|not an active servable target/,
          );
          // The active-status requirement still holds, through the helper.
          await refuses(
            () =>
              registerTenantDomain(operator, {
                organizationId: inactiveOrganizationId,
                dryRun: false,
                attribution: attribution('dev:probe-operator'),
                hostname: nextHostname(),
                role: 'public_alias',
              }),
            /not an active servable target/,
          );
        },
      );

      await t.test(
        'the function EXECUTE surface is exactly one function, and no trigger function needs EXECUTE',
        async () => {
          const executable = await sql<{ signature: string }>`
            select p.oid::regprocedure::text as signature
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and has_function_privilege(${cluster.operator.user}, p.oid, 'EXECUTE')
              and not exists (
                select 1 from pg_depend d
                where d.objid = p.oid and d.deptype = 'e')
              and p.proname like any (array['tenant_domain%', 'guard_tenant_domain%',
                'protect_tenant_domain%', 'verify_tenant_domain%'])
            order by 1`.execute(owner);
          // Before any revoke, trigger functions carry the default PUBLIC
          // EXECUTE, so the helper is the only one the role was *granted*.
          assert.ok(
            executable.rows.some((row) =>
              row.signature.startsWith('tenant_domain_lock_organization(uuid)'),
            ),
          );

          const triggers = await sql<{ signature: string }>`
            select p.oid::regprocedure::text as signature
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
              and (p.proname like 'guard_tenant_domain%'
                or p.proname like 'protect_tenant_domain%'
                or p.proname = 'verify_tenant_domain_audited')
            order by 1`.execute(owner);
          assert.equal(triggers.rows.length, TRIGGER_FUNCTION_COUNT);
          for (const { signature } of triggers.rows)
            await sql
              .raw(`revoke execute on function ${signature} from public`)
              .execute(owner);
          const remaining = await sql<{ granted: string }>`
            select count(*) filter (
              where has_function_privilege(${cluster.operator.user}, p.oid, 'EXECUTE')) as granted
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
              and (p.proname like 'guard_tenant_domain%'
                or p.proname like 'protect_tenant_domain%'
                or p.proname = 'verify_tenant_domain_audited')`.execute(owner);
          assert.deepEqual(remaining.rows, [{ granted: '0' }]);

          // The F060.3C-2c-2 open question, settled: firing a trigger does not
          // check EXECUTE on its function, so the grant artifact must not list
          // the trigger functions. Too few grants would break the operator
          // path; these would be surplus surface.
          await lifecycle(operator, nextHostname());

          for (const { signature } of triggers.rows)
            await sql
              .raw(`grant execute on function ${signature} to public`)
              .execute(owner);
        },
      );

      await t.test(
        'the control-plane tables stay append-only and undeletable for the operator',
        async () => {
          const contained: readonly (readonly [string, RegExp])[] = [
            ['delete from public.tenant_domain', /permission denied for table/],
            ['truncate public.tenant_domain', /permission denied for table/],
            [
              "update public.tenant_domain_audit set actor='dev:attacker'",
              /permission denied for table/,
            ],
            [
              'delete from public.tenant_domain_audit',
              /permission denied for table/,
            ],
            [
              'select 1 from public.tenant_domain_verification_attempt limit 1',
              /permission denied for table/,
            ],
            [
              'delete from public.tenant_domain_verification_attempt',
              /permission denied for table/,
            ],
            [
              'alter table public.tenant_domain add column probe int',
              /must be owner of table/,
            ],
            [
              'drop trigger tenant_domain_guard on public.tenant_domain',
              /must be owner of relation/,
            ],
            [
              'alter table public.tenant_domain disable trigger all',
              /must be owner of table/,
            ],
            [
              "create or replace function public.tenant_domain_lock_organization(uuid) returns boolean language sql as 'select true'",
              /permission denied for schema public/,
            ],
            [
              'create table public.probe(x int)',
              /permission denied for schema public/,
            ],
            ['create schema probe', /permission denied for database/],
          ];
          for (const [statement, expected] of contained)
            await refuses(() => sql.raw(statement).execute(operator), expected);
        },
      );

      await t.test(
        'the operator reaches no unrelated application domain',
        async () => {
          for (const table of [
            'service_request',
            'requester',
            'attachment',
            'staff_identity',
            'request_tracking_credential',
            'permission',
            'staff_role_assignment',
          ])
            await refuses(
              () =>
                sql
                  .raw(`select 1 from public.${table} limit 1`)
                  .execute(operator),
              /permission denied for table/,
            );
        },
      );

      await t.test(
        'the operator cannot widen its own authority, and a self-issued GRANT is a silent no-op rather than a grant',
        async () => {
          // PostgreSQL answers a GRANT from a role without grant options with a
          // warning rather than an error, so the statement "succeeding" proves
          // nothing. The catalog is what settles it.
          await sql
            .raw(
              `grant delete on public.tenant_domain to ${cluster.operator.user}`,
            )
            .execute(operator);
          await sql
            .raw(
              `grant update on public.tenant_domain_operator_approval to ${cluster.operator.user}`,
            )
            .execute(operator);
          const held = await sql<{
            tenant_domain_delete: boolean;
            approval_update: boolean;
          }>`
            select has_table_privilege(${cluster.operator.user}, 'public.tenant_domain', 'DELETE') as tenant_domain_delete,
                   has_table_privilege(${cluster.operator.user}, 'public.tenant_domain_operator_approval', 'UPDATE') as approval_update
            `.execute(owner);
          assert.deepEqual(held.rows, [
            { tenant_domain_delete: false, approval_update: false },
          ]);

          const refused: readonly (readonly [string, RegExp])[] = [
            [
              "set session_replication_role = 'replica'",
              /permission denied to set parameter/,
            ],
            [`set role ${cluster.owner.user}`, /permission denied to set role/],
            [
              `alter role ${cluster.operator.user} superuser`,
              /permission denied to alter role/,
            ],
            [
              `alter role ${cluster.operator.user} createrole`,
              /permission denied to alter role/,
            ],
            [
              'select rolpassword from pg_authid limit 1',
              /permission denied for table/,
            ],
            [
              'create extension if not exists hstore',
              /permission denied to create extension/,
            ],
            [
              "select pg_read_file('postgresql.conf')",
              /permission denied for function/,
            ],
            [
              "copy public.tenant_domain from program 'echo x'",
              /permission denied to COPY/,
            ],
            ['set log_statement = none', /permission denied to set parameter/],
            [
              `create role probe_escape login`,
              /permission denied to create role/,
            ],
          ];
          for (const [statement, expected] of refused)
            await refuses(() => sql.raw(statement).execute(operator), expected);

          const attributes = await sql<{
            rolsuper: boolean;
            rolcreaterole: boolean;
            rolbypassrls: boolean;
          }>`
            select rolsuper, rolcreaterole, rolbypassrls
            from pg_roles where rolname = ${cluster.operator.user}`.execute(
            owner,
          );
          assert.deepEqual(attributes.rows, [
            { rolsuper: false, rolcreaterole: false, rolbypassrls: false },
          ]);
        },
      );

      await t.test(
        'the unqualified helper call cannot be redirected, which is what the F060.3C-2c-2 acceptance was conditional on',
        async () => {
          // The sharpest available attack: pg_temp is the one schema this role
          // can write to, so it is listed first explicitly and a
          // same-signature decoy is planted there. PostgreSQL never consults
          // pg_temp for function or operator names, even when pg_temp is named
          // in the path, so the unqualified call cannot be hijacked.
          const hostile = connect(
            cluster,
            cluster.operator,
            '-c search_path=pg_temp,public',
          );
          extra.push(hostile);
          const path_ = await sql<{ path: string }>`
            select current_setting('search_path') as path`.execute(hostile);
          assert.equal(path_.rows[0]?.path, 'pg_temp,public');
          await sql
            .raw(
              "create function pg_temp.tenant_domain_lock_organization(uuid) returns boolean language sql as 'select true'",
            )
            .execute(hostile);
          // The decoy exists and would answer differently if it were reached.
          const decoy = await sql<{ verdict: boolean }>`
            select pg_temp.tenant_domain_lock_organization(${inactiveOrganizationId}::uuid) as verdict`.execute(
            hostile,
          );
          assert.deepEqual(decoy.rows, [{ verdict: true }]);
          const resolved = await sql<{
            schema: string;
            secdef: boolean;
            verdict: boolean;
          }>`
            select n.nspname as schema, p.prosecdef as secdef,
                   tenant_domain_lock_organization(${inactiveOrganizationId}::uuid) as verdict
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where p.oid = 'tenant_domain_lock_organization(uuid)'::regprocedure`.execute(
            hostile,
          );
          assert.deepEqual(resolved.rows, [
            { schema: 'public', secdef: true, verdict: false },
          ]);
          // Behaviourally, not only by resolution: the active-Organization
          // control still holds from the hostile session.
          await refuses(
            () =>
              registerTenantDomain(hostile, {
                organizationId: inactiveOrganizationId,
                dryRun: false,
                attribution: attribution('dev:probe-operator'),
                hostname: nextHostname(),
                role: 'public_alias',
              }),
            /not an active servable target/,
          );
          await lifecycle(hostile, nextHostname());
        },
      );

      await t.test(
        'a pg_temp relation decoy fails closed and writes nothing, and the operator path needs no TEMPORARY at all',
        async () => {
          // pg_temp *is* searched first for relations, so the application's own
          // unqualified table names are shadowable within the operator's own
          // session. That grants no authority and corrupts nothing: the
          // Migration 48 guards are schema qualified, so the mutation is
          // refused and the transaction rolls back.
          const shadow = connect(cluster, cluster.operator);
          extra.push(shadow);
          await sql
            .raw(
              'create temporary table tenant_domain as select * from public.tenant_domain where false',
            )
            .execute(shadow);
          const shadowed = nextHostname();
          await refuses(
            () =>
              registerTenantDomain(shadow, {
                organizationId,
                dryRun: false,
                attribution: attribution('dev:probe-operator'),
                hostname: shadowed,
                role: 'public_alias',
              }),
            /Tenant domain audit requires its binding/,
          );
          const written = await sql<{ registry: string; audit: string }>`
            select (select count(*) from public.tenant_domain
                      where hostname = ${shadowed}) as registry,
                   (select count(*) from public.tenant_domain_audit
                      where hostname = ${shadowed}) as audit`.execute(owner);
          assert.deepEqual(written.rows, [{ registry: '0', audit: '0' }]);

          // And the vector closes completely, at no cost: revoking TEMPORARY
          // leaves every verb working, because the operator path never creates
          // a temporary object.
          await sql
            .raw(`revoke temporary on database ${cluster.database} from public`)
            .execute(owner);
          const noTemp = connect(cluster, cluster.operator);
          extra.push(noTemp);
          for (const statement of [
            'create temporary table probe(x int)',
            "create function pg_temp.tenant_domain_lock_organization(uuid) returns boolean language sql as 'select true'",
          ])
            await refuses(
              () => sql.raw(statement).execute(noTemp),
              /permission denied to create temporary tables/,
            );
          await lifecycle(noTemp, nextHostname());
          await sql
            .raw(`grant temporary on database ${cluster.database} to public`)
            .execute(owner);
        },
      );

      await t.test(
        'no approval-row mutation of any kind reaches storage',
        async () => {
          // The authorized grant must not become mutation authority. Every
          // column other than the one the row lock requires is refused at the
          // privilege layer, and the one it does name is refused by the
          // immutability trigger.
          const columns = await sql<{ attname: string }>`
            select a.attname
            from pg_attribute a
            join pg_class c on c.oid = a.attrelid
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = ${cluster.schema}
              and c.relname = ${APPROVED_COLUMN_UPDATE.table}
              and a.attnum > 0 and not a.attisdropped
            order by a.attname`.execute(owner);
          assert.ok(columns.rows.length > 10);
          const updatable: string[] = [];
          for (const { attname } of columns.rows) {
            const granted = await sql<{ held: boolean }>`
              select has_column_privilege(
                ${cluster.operator.user},
                ${`${cluster.schema}.${APPROVED_COLUMN_UPDATE.table}`},
                ${attname}, 'UPDATE') as held`.execute(owner);
            if (granted.rows[0]?.held === true) updatable.push(attname);
          }
          // Exactly one column, named explicitly rather than counted.
          assert.deepEqual(updatable, [APPROVED_COLUMN_UPDATE.column]);
          // Named individually as well, so a future column rename cannot
          // quietly satisfy the assertion above.
          for (const column of [
            'requested_by',
            'approved_by',
            'expires_at',
            'approved_at',
            'operation',
            'expected_revision',
            'expected_hostname',
            'expected_role',
            'expected_verification_state',
            'expected_active',
            'organization_id',
            'tenant_domain_id',
            'correlation_id',
            'creation_txid',
            'reason',
            'id',
          ]) {
            const granted = await sql<{ held: boolean }>`
              select has_column_privilege(
                ${cluster.operator.user},
                ${`${cluster.schema}.${APPROVED_COLUMN_UPDATE.table}`},
                ${column}, 'UPDATE') as held`.execute(owner);
            assert.deepEqual(
              granted.rows,
              [{ held: false }],
              `${column} must not be updatable by the operator`,
            );
          }

          const before = await sql<{ digest: string }>`
            select md5(string_agg(t.row, '|' order by t.row)) as digest
            from (select tenant_domain_operator_approval::text as row
                  from tenant_domain_operator_approval) t`.execute(owner);

          // The one grantable column, refused by the immutability control --
          // including the no-op form, which a privilege check alone would
          // have allowed through.
          for (const statement of [
            'update tenant_domain_operator_approval set policy_version = policy_version',
            'update tenant_domain_operator_approval set policy_version = 1',
            'update tenant_domain_operator_approval set policy_version = 2',
            'update tenant_domain_operator_approval set policy_version = 1 where true',
          ])
            await refuses(
              () => sql.raw(statement).execute(operator),
              /Tenant domain operator approvals are immutable/,
            );
          // Everything else stops earlier still, at the privilege layer.
          for (const statement of [
            "update tenant_domain_operator_approval set approved_by = 'dev:attacker'",
            "update tenant_domain_operator_approval set requested_by = 'dev:attacker'",
            "update tenant_domain_operator_approval set expires_at = now() + interval '30 days'",
            "update tenant_domain_operator_approval set operation = 'activated'",
            'update tenant_domain_operator_approval set expected_revision = 1',
            'delete from tenant_domain_operator_approval',
            'truncate tenant_domain_operator_approval',
          ])
            await refuses(
              () => sql.raw(statement).execute(operator),
              /permission denied for table tenant_domain_operator_approval/,
            );

          // It cannot remove the control that refuses those updates, nor
          // rewrite the function behind it.
          for (const [statement, expected] of [
            [
              'alter table tenant_domain_operator_approval disable trigger all',
              /must be owner of table/,
            ],
            [
              'alter table tenant_domain_operator_approval disable trigger tenant_domain_approval_guard',
              /must be owner of (table|relation)/,
            ],
            [
              'drop trigger tenant_domain_approval_guard on tenant_domain_operator_approval',
              /must be owner of relation/,
            ],
            [
              'create or replace function guard_tenant_domain_approval() returns trigger language plpgsql as $$ begin return NEW; end $$',
              /permission denied for schema/,
            ],
            [
              'alter function guard_tenant_domain_approval() security definer',
              /must be owner of function/,
            ],
            [
              'drop function guard_tenant_domain_approval() cascade',
              /must be owner of function/,
            ],
          ] as const)
            await refuses(() => sql.raw(statement).execute(operator), expected);

          // Byte-for-byte unchanged: not a row count, the row contents.
          const after = await sql<{ digest: string }>`
            select md5(string_agg(t.row, '|' order by t.row)) as digest
            from (select tenant_domain_operator_approval::text as row
                  from tenant_domain_operator_approval) t`.execute(owner);
          assert.deepEqual(after.rows, before.rows);
          assert.ok(before.rows[0]?.digest);
        },
      );

      await t.test(
        'the seven verbs survive the full operator protocol: dry run, independent approval, dry run, confirm',
        async () => {
          const hostname = nextHostname();
          const base = { organizationId, dryRun: false };
          const operatorIdentity = 'dev:probe-operator';
          const approverIdentity = 'dev:probe-approver';

          const registered = await registerTenantDomain(operator, {
            ...base,
            attribution: attribution(operatorIdentity),
            hostname,
            role: 'public_alias',
          });
          const challenged = await issueTenantDomainChallenge(operator, {
            ...base,
            attribution: attribution(operatorIdentity),
            hostname,
            expectedRevision: registered.domain.revision,
            lifetimeDays: 14,
          });
          assert.ok(challenged.challenge);
          const verified = await verifyTenantDomain(
            operator,
            publishing([challenged.challenge.value]),
            {
              ...base,
              attribution: attribution(operatorIdentity),
              hostname,
              expectedRevision: challenged.domain.revision,
            },
          );
          assert.equal(verified.verified, true);
          const reviewed = verified.domain.revision;

          // Pre-approval dry run: everything checkable without an approval
          // passes, and the missing approval is what stops it.
          await refuses(
            () =>
              activateTenantDomain(operator, {
                ...base,
                dryRun: true,
                attribution: attribution(operatorIdentity),
                hostname,
                expectedRevision: reviewed,
                approvalId: randomUUID(),
              }),
            /requires an independent approval|does not match the mutation context/,
          );
          // Nothing was written by the attempt.
          const untouched = await inspectTenantDomain(
            operator,
            organizationId,
            hostname,
          );
          assert.ok(untouched);
          assert.equal(untouched.revision, reviewed);
          assert.equal(untouched.active, false);

          // An independent approver. The application refuses it first...
          await refuses(
            () =>
              recordTenantDomainApproval(operator, {
                organizationId,
                hostname,
                expectedRevision: reviewed,
                operation: 'activated',
                requestedBy: operatorIdentity,
                approvedBy: operatorIdentity,
                reason: 'F060.3C-2c-3 self approval attempt',
                correlationId: randomUUID(),
              }),
            /requires a different approver than the operator/,
          );
          // ...and the database refuses it independently, so the guarantee
          // does not rest on the application layer. Written as raw SQL by the
          // constrained role, which is exactly the authority an operator with
          // a psql session would have.
          const binding = await sql<{ id: string }>`
            select id from tenant_domain
            where organization_id = ${organizationId}::uuid
              and hostname = ${hostname}`.execute(operator);
          const bindingId = binding.rows[0]?.id;
          assert.ok(bindingId);
          await refuses(
            () =>
              sql`insert into tenant_domain_operator_approval
                    (organization_id, tenant_domain_id, operation,
                     expected_revision, expected_hostname, expected_role,
                     expected_verification_state, expected_active,
                     requested_by, approved_by, reason, correlation_id,
                     policy_version, expires_at)
                  values (${organizationId}::uuid, ${bindingId}::uuid,
                     'activated', ${reviewed}, ${hostname}, 'public_alias',
                     'verified', false, ${operatorIdentity},
                     ${operatorIdentity},
                     'F060.3C-2c-3 direct self approval attempt',
                     ${randomUUID()}::uuid, 1,
                     clock_timestamp() + interval '24 hours')`.execute(
                operator,
              ),
            /violates check constraint/,
          );
          const approval = await recordTenantDomainApproval(operator, {
            organizationId,
            hostname,
            expectedRevision: reviewed,
            operation: 'activated',
            requestedBy: operatorIdentity,
            approvedBy: approverIdentity,
            reason: 'F060.3C-2c-3 least-privilege operator role proof',
            correlationId: randomUUID(),
          });

          // Post-approval dry run: the real transaction runs every check,
          // including the deferred audit-evidence constraint, and is rolled
          // back. This is the step that needs the approval row lock.
          const planned = await activateTenantDomain(operator, {
            ...base,
            dryRun: true,
            attribution: attribution(operatorIdentity),
            hostname,
            expectedRevision: reviewed,
            approvalId: approval.id,
          });
          assert.equal(planned.applied, false);
          const stillInactive = await inspectTenantDomain(
            operator,
            organizationId,
            hostname,
          );
          assert.ok(stillInactive);
          assert.equal(stillInactive.revision, reviewed);
          assert.equal(stillInactive.active, false);
          // The dry run did not spend the approval.
          const unconsumed = await sql<{ consumed: boolean }>`
            select tenant_domain_approval_consumed(${approval.id}::uuid) as consumed`.execute(
            owner,
          );
          assert.deepEqual(unconsumed.rows, [{ consumed: false }]);

          // Confirm.
          const activated = await activateTenantDomain(operator, {
            ...base,
            attribution: attribution(operatorIdentity),
            hostname,
            expectedRevision: reviewed,
            approvalId: approval.id,
          });
          assert.equal(activated.applied, true);
          assert.equal(activated.domain.active, true);
          assert.equal(activated.domain.resolvable, true);

          // Consumed exactly once: the approval is spent, and spending it a
          // second time is refused rather than silently reapplied.
          const consumed = await sql<{ consumed: boolean; rows: string }>`
            select tenant_domain_approval_consumed(${approval.id}::uuid) as consumed,
                   (select count(*) from tenant_domain_audit
                      where approval_id = ${approval.id}::uuid) as rows`.execute(
            owner,
          );
          assert.deepEqual(consumed.rows, [{ consumed: true, rows: '1' }]);
          await refuses(
            () =>
              activateTenantDomain(operator, {
                ...base,
                attribution: attribution(operatorIdentity),
                hostname,
                expectedRevision: activated.domain.revision,
                approvalId: approval.id,
              }),
            /already active|does not match the mutation context|duplicate key/,
          );

          // Deactivate takes no approval; revoke takes its own.
          const deactivated = await deactivateTenantDomain(operator, {
            ...base,
            attribution: attribution(operatorIdentity),
            hostname,
            expectedRevision: activated.domain.revision,
          });
          assert.equal(deactivated.domain.active, false);
          const revocation = await recordTenantDomainApproval(operator, {
            organizationId,
            hostname,
            expectedRevision: deactivated.domain.revision,
            operation: 'verification_revoked',
            requestedBy: operatorIdentity,
            approvedBy: approverIdentity,
            reason: 'F060.3C-2c-3 least-privilege operator role proof',
            correlationId: randomUUID(),
          });
          const revoked = await revokeTenantDomainVerification(operator, {
            ...base,
            attribution: attribution(operatorIdentity),
            hostname,
            expectedRevision: deactivated.domain.revision,
            approvalId: revocation.id,
          });
          assert.equal(revoked.domain.verificationState, 'unverified');
          const spentOnce = await sql<{ rows: string }>`
            select count(*) as rows from tenant_domain_audit
            where approval_id = ${revocation.id}::uuid`.execute(owner);
          assert.deepEqual(spentOnce.rows, [{ rows: '1' }]);

          // Safe direction for a non-active Organization. The guarantee is
          // about which *direction* stays available: a hostname can always be
          // taken OUT of resolution, and nothing can be put IN.
          //
          // Both bindings are prepared while the Organization is still active,
          // because that is the only time an approval can be recorded --
          // recording one takes the Organization lock with the active
          // requirement, exactly like register and activate. The revocation
          // approval is therefore obtained in advance, which is also what a
          // real operator would have done before suspending a tenant.
          async function liveBinding(): Promise<{
            hostname: string;
            revision: number;
          }> {
            const name = nextHostname();
            const created = await registerTenantDomain(operator, {
              ...base,
              attribution: attribution(operatorIdentity),
              hostname: name,
              role: 'public_alias',
            });
            const issued = await issueTenantDomainChallenge(operator, {
              ...base,
              attribution: attribution(operatorIdentity),
              hostname: name,
              expectedRevision: created.domain.revision,
              lifetimeDays: 14,
            });
            assert.ok(issued.challenge);
            const proven = await verifyTenantDomain(
              operator,
              publishing([issued.challenge.value]),
              {
                ...base,
                attribution: attribution(operatorIdentity),
                hostname: name,
                expectedRevision: issued.domain.revision,
              },
            );
            const permission = await recordTenantDomainApproval(operator, {
              organizationId,
              hostname: name,
              expectedRevision: proven.domain.revision,
              operation: 'activated',
              requestedBy: operatorIdentity,
              approvedBy: approverIdentity,
              reason: 'F060.3C-2c-3 least-privilege operator role proof',
              correlationId: randomUUID(),
            });
            const live = await activateTenantDomain(operator, {
              ...base,
              attribution: attribution(operatorIdentity),
              hostname: name,
              expectedRevision: proven.domain.revision,
              approvalId: permission.id,
            });
            assert.equal(live.domain.resolvable, true);
            return { hostname: name, revision: live.domain.revision };
          }

          // One binding left active, to be deactivated after the flip.
          const toDeactivate = await liveBinding();
          // One binding deactivated now and given a revocation approval now,
          // to be revoked after the flip.
          const toRevoke = await liveBinding();
          const readyToRevoke = await deactivateTenantDomain(operator, {
            ...base,
            attribution: attribution(operatorIdentity),
            hostname: toRevoke.hostname,
            expectedRevision: toRevoke.revision,
          });
          const heldApproval = await recordTenantDomainApproval(operator, {
            organizationId,
            hostname: toRevoke.hostname,
            expectedRevision: readyToRevoke.domain.revision,
            operation: 'verification_revoked',
            requestedBy: operatorIdentity,
            approvedBy: approverIdentity,
            reason: 'F060.3C-2c-3 least-privilege operator role proof',
            correlationId: randomUUID(),
          });

          // Restored in `finally`, so a failure here cannot leave the
          // Organization inactive and cascade into unrelated subtests.
          await sql
            .raw(
              `update organization set status='inactive' where id='${organizationId}'`,
            )
            .execute(owner);
          try {
            const status = await sql<{ status: string }>`
              select status from organization
              where id = ${organizationId}::uuid`.execute(owner);
            assert.deepEqual(status.rows, [{ status: 'inactive' }]);

            // OUT stays available. Deactivation takes the Organization lock
            // without the active requirement, so a suspended tenant's
            // hostname can still be taken off the air.
            const stopped = await deactivateTenantDomain(operator, {
              ...base,
              attribution: attribution(operatorIdentity),
              hostname: toDeactivate.hostname,
              expectedRevision: toDeactivate.revision,
            });
            assert.equal(stopped.domain.active, false);
            assert.equal(stopped.domain.resolvable, false);

            // So does revocation, when its approval already exists.
            const stripped = await revokeTenantDomainVerification(operator, {
              ...base,
              attribution: attribution(operatorIdentity),
              hostname: toRevoke.hostname,
              expectedRevision: readyToRevoke.domain.revision,
              approvalId: heldApproval.id,
            });
            assert.equal(stripped.domain.verificationState, 'unverified');

            // IN is closed. Registering a hostname is refused...
            await refuses(
              () =>
                registerTenantDomain(operator, {
                  ...base,
                  attribution: attribution(operatorIdentity),
                  hostname: nextHostname(),
                  role: 'public_alias',
                }),
              /not an active servable target/,
            );
            // ...and so is obtaining any new approval, which is what stops a
            // suspended tenant being brought back without a deliberate
            // reactivation. Recorded because it also means a revocation that
            // has no approval yet cannot be completed while suspended.
            await refuses(
              () =>
                recordTenantDomainApproval(operator, {
                  organizationId,
                  hostname: toDeactivate.hostname,
                  expectedRevision: stopped.domain.revision,
                  operation: 'verification_revoked',
                  requestedBy: operatorIdentity,
                  approvedBy: approverIdentity,
                  reason: 'F060.3C-2c-3 approval while suspended',
                  correlationId: randomUUID(),
                }),
              /not an active servable target/,
            );
          } finally {
            await sql
              .raw(
                `update organization set status='active' where id='${organizationId}'`,
              )
              .execute(owner);
          }
        },
      );

      await t.test(
        'the deployment-owned connection pin overrides a hostile role default search_path',
        async () => {
          // The production resolver, not a hand-written options string: this
          // is the code path the operator CLI uses.
          const pin = resolveDeploymentSchema({
            REQRO_DEPLOYMENT_SCHEMA: cluster.schema,
          });
          assert.equal(pin.schema, cluster.schema);
          assert.equal(
            pin.connectionOptions,
            `-c search_path=${cluster.schema}`,
          );

          // 1. the role can change its own stored default, and 2. it is set
          // to a deliberately hostile value that omits the application schema.
          const setter = connect(cluster, cluster.operator);
          extra.push(setter);
          await sql
            .raw(
              `alter role ${cluster.operator.user} set search_path = pg_temp`,
            )
            .execute(setter);
          const stored = await sql<{ config: string[] | null }>`
            select rolconfig as config from pg_roles
            where rolname = ${cluster.operator.user}`.execute(owner);
          assert.deepEqual(stored.rows, [{ config: ['search_path=pg_temp'] }]);

          // 3. a fresh connection, 4. carrying the deployment-owned pin.
          const pinned = connect(
            cluster,
            cluster.operator,
            pin.connectionOptions,
          );
          extra.push(pinned);
          // 5. the effective path equals the deployment-owned schema.
          const effective = await sql<{ path: string }>`
            select current_setting('search_path') as path`.execute(pinned);
          assert.deepEqual(effective.rows, [{ path: cluster.schema }]);

          // 6. the unqualified helper resolves to the owner-created helper.
          const resolved = await sql<{
            schema: string;
            owner: string;
            secdef: boolean;
          }>`
            select n.nspname as schema, pg_get_userbyid(p.proowner) as owner,
                   p.prosecdef as secdef
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where p.oid = 'tenant_domain_lock_organization(uuid)'::regprocedure`.execute(
            pinned,
          );
          assert.deepEqual(resolved.rows, [
            {
              schema: cluster.schema,
              owner: cluster.owner.user,
              secdef: true,
            },
          ]);

          // 7. and every verb still works through the pin.
          await lifecycle(pinned, nextHostname());

          // An unpinned connection under the same hostile default is broken,
          // which is what makes the pin load bearing rather than cosmetic.
          const unpinned = connect(cluster, cluster.operator);
          extra.push(unpinned);
          await refuses(
            () => lifecycle(unpinned, nextHostname()),
            /does not exist/,
          );
          await sql
            .raw(`alter role ${cluster.operator.user} reset search_path`)
            .execute(setter);
        },
      );

      await t.test(
        'a search_path carried in the connection string cannot defeat the pin',
        async () => {
          // `databaseConnectionOptions` rejects TLS and host parameters in
          // DATABASE_URL but not `options`, which can carry its own
          // `-c search_path=`. Measured here rather than assumed: with both
          // present, `pg` lets the CONNECTION STRING win, so an explicit
          // `options` key alone is not a reliable pin.
          const pin = resolveDeploymentSchema({
            REQRO_DEPLOYMENT_SCHEMA: cluster.schema,
          });
          const smuggled = new URL(cluster.url(cluster.operator));
          smuggled.searchParams.set('options', '-c search_path=pg_temp');
          const defeated = new Kysely<DatabaseSchema>({
            dialect: new PostgresDialect({
              pool: new Pool({
                connectionString: smuggled.href,
                options: pin.connectionOptions,
                max: 1,
              }),
            }),
          });
          extra.push(defeated);
          const overridden = await sql<{ path: string }>`
            select current_setting('search_path') as path`.execute(defeated);
          assert.deepEqual(
            overridden.rows,
            [{ path: 'pg_temp' }],
            'pg no longer lets the connection string override options; the operator CLI sanitizer may be redundant',
          );

          // Which is why the operator path strips that parameter before the
          // pool is built. With the sanitizer applied the pin holds, and this
          // is the exact composition the CLI uses.
          const sanitized = withoutConnectionOptions(smuggled.href);
          assert.ok(!new URL(sanitized).searchParams.has('options'));
          const held = new Kysely<DatabaseSchema>({
            dialect: new PostgresDialect({
              pool: new Pool({
                connectionString: sanitized,
                options: pin.connectionOptions,
                max: 2,
              }),
            }),
          });
          extra.push(held);
          const effective = await sql<{ path: string }>`
            select current_setting('search_path') as path`.execute(held);
          assert.deepEqual(effective.rows, [{ path: cluster.schema }]);
          await lifecycle(held, nextHostname());
        },
      );

      await t.test(
        'the narrow production revokes hold: no TEMPORARY, and no CREATE on the application schema for PUBLIC',
        async () => {
          await sql
            .raw(`revoke temporary on database ${cluster.database} from public`)
            .execute(owner);
          await sql
            .raw(`revoke create on schema ${cluster.schema} from public`)
            .execute(owner);
          const hardened = connect(
            cluster,
            cluster.operator,
            resolveDeploymentSchema({ REQRO_DEPLOYMENT_SCHEMA: cluster.schema })
              .connectionOptions,
          );
          extra.push(hardened);
          // No TEMP at all, so pg_temp -- the one schema this role could
          // write to -- cannot be populated, and no competing same-signature
          // helper can exist anywhere.
          for (const statement of [
            'create temporary table probe(x int)',
            "create function pg_temp.tenant_domain_lock_organization(uuid) returns boolean language sql as 'select true'",
          ])
            await refuses(
              () => sql.raw(statement).execute(hardened),
              /permission denied to create temporary tables/,
            );
          // No CREATE on the application schema, and no schema of its own.
          const posture = await sql<{
            schema_create: boolean;
            db_create: boolean;
            db_temp: boolean;
            own_schema: string;
          }>`
            select has_schema_privilege(${cluster.operator.user}, ${cluster.schema}, 'CREATE') as schema_create,
                   has_database_privilege(${cluster.operator.user}, ${cluster.database}, 'CREATE') as db_create,
                   has_database_privilege(${cluster.operator.user}, ${cluster.database}, 'TEMPORARY') as db_temp,
                   (select count(*) from pg_namespace where nspname = ${cluster.operator.user}) as own_schema
            `.execute(owner);
          assert.deepEqual(posture.rows, [
            {
              schema_create: false,
              db_create: false,
              db_temp: false,
              own_schema: '0',
            },
          ]);
          // The whole protocol still runs under the hardened posture.
          await lifecycle(hardened, nextHostname());
          // TEMPORARY is restored because PUBLIC does hold it by default.
          // CREATE deliberately is NOT: PostgreSQL 15 removed PUBLIC's CREATE
          // on `public`, so re-granting it would leave the cluster wider than
          // the measured default -- which the artifact's own fail-closed check
          // caught when an earlier version of this subtest did exactly that.
          await sql
            .raw(`grant temporary on database ${cluster.database} to public`)
            .execute(owner);
        },
      );

      await t.test(
        'the final privilege posture is exactly the approved set and nothing else',
        async () => {
          // Asserted as a complement over every relation in the schema, so a
          // table added later is covered without being named here.
          const exposure = await sql<{
            relname: string;
            privilege: string;
          }>`
            select c.relname, p.privilege
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) as p(privilege)
            where n.nspname = ${cluster.schema}
              and c.relkind in ('r', 'p', 'v', 'm', 'f')
              and has_table_privilege(${cluster.operator.user}, c.oid, p.privilege)
            order by c.relname, p.privilege`.execute(owner);
          assert.deepEqual(
            exposure.rows,
            [
              { relname: 'tenant_domain', privilege: 'INSERT' },
              { relname: 'tenant_domain', privilege: 'SELECT' },
              { relname: 'tenant_domain', privilege: 'UPDATE' },
              { relname: 'tenant_domain_audit', privilege: 'INSERT' },
              { relname: 'tenant_domain_audit', privilege: 'SELECT' },
              {
                relname: 'tenant_domain_operator_approval',
                privilege: 'INSERT',
              },
              {
                relname: 'tenant_domain_operator_approval',
                privilege: 'SELECT',
              },
              {
                relname: 'tenant_domain_verification_attempt',
                privilege: 'INSERT',
              },
            ],
            'the operator table/privilege surface is not exactly the approved set',
          );
          assert.deepEqual(
            [...new Set(exposure.rows.map((row) => row.relname))].sort(),
            [...APPROVED_TABLES].sort(),
          );
          // No table-level UPDATE anywhere beyond the registry -- the guard
          // against the approval grant being widened by accident.
          const tableUpdate = await sql<{ relname: string }>`
            select c.relname from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = ${cluster.schema} and c.relkind = 'r'
              and has_table_privilege(${cluster.operator.user}, c.oid, 'UPDATE')
            order by 1`.execute(owner);
          assert.deepEqual(tableUpdate.rows, [{ relname: 'tenant_domain' }]);

          // Column-level exposure, complement again: only the one authorized
          // exception carries UPDATE outside the registry.
          const columnUpdate = await sql<{
            relname: string;
            attname: string;
          }>`
            select c.relname, a.attname
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            join pg_attribute a on a.attrelid = c.oid and a.attnum > 0
              and not a.attisdropped
            where n.nspname = ${cluster.schema} and c.relkind = 'r'
              and c.relname <> 'tenant_domain'
              and has_column_privilege(${cluster.operator.user}, c.oid, a.attnum, 'UPDATE')
            order by c.relname, a.attname`.execute(owner);
          assert.deepEqual(columnUpdate.rows, [
            {
              relname: APPROVED_COLUMN_UPDATE.table,
              attname: APPROVED_COLUMN_UPDATE.column,
            },
          ]);

          // Organization: zero direct privileges, at table and column scope.
          const organizationExposure = await sql<{ privilege: string }>`
            select p.privilege
            from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as p(privilege)
            where has_table_privilege(${cluster.operator.user},
              ${`${cluster.schema}.organization`}, p.privilege)`.execute(owner);
          assert.deepEqual(organizationExposure.rows, []);
          const organizationColumns = await sql<{ attname: string }>`
            select a.attname
            from pg_attribute a
            join pg_class c on c.oid = a.attrelid
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = ${cluster.schema} and c.relname = 'organization'
              and a.attnum > 0 and not a.attisdropped
              and (has_column_privilege(${cluster.operator.user}, c.oid, a.attnum, 'SELECT')
                or has_column_privilege(${cluster.operator.user}, c.oid, a.attnum, 'UPDATE')
                or has_column_privilege(${cluster.operator.user}, c.oid, a.attnum, 'INSERT'))`.execute(
            owner,
          );
          assert.deepEqual(organizationColumns.rows, []);

          // The function surface is exactly one DIRECT grant to the operator.
          //
          // Asserted on the ACL entries that name the role, not on
          // `has_function_privilege`: every function PostgreSQL creates
          // carries a default `EXECUTE` for `PUBLIC`, so effective privilege
          // would report the trigger functions too and say nothing about what
          // this role was granted. Subtest 13 already proves the operator
          // needs none of them -- the full lifecycle passes with `PUBLIC`'s
          // `EXECUTE` revoked from all seven and the operator holding none.
          const granted = await sql<{ signature: string }>`
            select p.oid::regprocedure::text as signature
            from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            cross join lateral aclexplode(p.proacl) a
            where n.nspname = ${cluster.schema}
              and a.privilege_type = 'EXECUTE'
              and a.grantee = (select r.oid from pg_roles r
                               where r.rolname = ${cluster.operator.user})
            order by 1`.execute(owner);
          assert.deepEqual(
            granted.rows,
            [{ signature: 'tenant_domain_lock_organization(uuid)' }],
            'the operator holds a direct EXECUTE grant on something other than the lock helper',
          );
          // Named individually too, so the complement above cannot pass by
          // accident: none of these carries an operator grant.
          for (const name of [
            'tenant_domain_approval_consumed',
            'tenant_domain_approval_live',
            'tenant_domain_challenge_live',
            'guard_tenant_domain',
            'guard_tenant_domain_approval',
            'guard_tenant_domain_attempt',
            'guard_tenant_domain_audit',
            'protect_tenant_domain_audit',
            'protect_tenant_domain_attempt',
            'verify_tenant_domain_audited',
          ]) {
            const direct = await sql<{ rows: string }>`
              select count(*) as rows
              from pg_proc p
              join pg_namespace n on n.oid = p.pronamespace
              cross join lateral aclexplode(p.proacl) a
              where n.nspname = ${cluster.schema} and p.proname = ${name}
                and a.grantee = (select r.oid from pg_roles r
                                 where r.rolname = ${cluster.operator.user})`.execute(
              owner,
            );
            assert.deepEqual(
              direct.rows,
              [{ rows: '0' }],
              `${name} must carry no direct operator grant`,
            );
          }

          // A future object is inaccessible: no default privileges exist, so a
          // table created later exposes nothing without a deliberate grant.
          const defaults = await sql<{ rows: string }>`
            select count(*) as rows from pg_default_acl`.execute(owner);
          assert.deepEqual(defaults.rows, [{ rows: '0' }]);
          await sql
            .raw(
              `create table ${cluster.schema}.future_object_probe(id uuid primary key)`,
            )
            .execute(owner);
          try {
            for (const statement of [
              'select 1 from future_object_probe limit 1',
              'insert into future_object_probe(id) values (gen_random_uuid())',
              'update future_object_probe set id = id',
              'delete from future_object_probe',
            ])
              await refuses(
                () => sql.raw(statement).execute(operator),
                /permission denied for table future_object_probe/,
              );
          } finally {
            await sql
              .raw(`drop table ${cluster.schema}.future_object_probe`)
              .execute(owner);
          }
        },
      );

      await t.test(
        'the shipped grant artifact alone establishes the whole posture',
        async () => {
          // Everything above proved an equivalent grant list. This proves the
          // file that would actually be deployed: every privilege is first
          // revoked, the role is confirmed to reach nothing, and then
          // deploy/database/operator-role.sql is applied by psql inside the
          // container as the schema owner.
          for (const [, clause] of MINIMAL_GRANTS) await revoke(clause);
          await sql
            .raw(`revoke usage on schema ${cluster.schema} from public`)
            .execute(owner);
          const stripped = connect(cluster, cluster.operator);
          extra.push(stripped);
          await refuses(
            () =>
              sql.raw('select 1 from tenant_domain limit 1').execute(stripped),
            /permission denied for schema|permission denied for table|does not exist/,
          );

          const artifact = path.resolve(
            __dirname,
            '../../../../deploy/database/operator-role.sql',
          );
          const applied = cluster.applySqlFile(artifact, {
            operator: cluster.operator.user,
            schema: cluster.schema,
          });
          assert.equal(
            applied.status,
            0,
            `the artifact failed to apply: ${applied.stderr || applied.stdout}`,
          );
          // Its own fail-closed assertions ran; a raised exception would have
          // aborted with a non-zero status above.
          assert.ok(!(applied.stdout + applied.stderr).includes('refusing:'));

          // Idempotent: applying it twice is not an error and does not widen
          // anything, which is what a provisioning rerun does.
          const again = cluster.applySqlFile(artifact, {
            operator: cluster.operator.user,
            schema: cluster.schema,
          });
          assert.equal(again.status, 0, again.stderr || again.stdout);

          // The posture the artifact leaves behind, asserted as a complement.
          const exposure = await sql<{ relname: string; privilege: string }>`
            select c.relname, p.privilege
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) as p(privilege)
            where n.nspname = ${cluster.schema}
              and c.relkind in ('r', 'p', 'v', 'm', 'f')
              and has_table_privilege(${cluster.operator.user}, c.oid, p.privilege)
            order by c.relname, p.privilege`.execute(owner);
          assert.deepEqual(exposure.rows, [
            { relname: 'tenant_domain', privilege: 'INSERT' },
            { relname: 'tenant_domain', privilege: 'SELECT' },
            { relname: 'tenant_domain', privilege: 'UPDATE' },
            { relname: 'tenant_domain_audit', privilege: 'INSERT' },
            { relname: 'tenant_domain_audit', privilege: 'SELECT' },
            { relname: 'tenant_domain_operator_approval', privilege: 'INSERT' },
            { relname: 'tenant_domain_operator_approval', privilege: 'SELECT' },
            {
              relname: 'tenant_domain_verification_attempt',
              privilege: 'INSERT',
            },
          ]);
          const columnUpdate = await sql<{
            relname: string;
            attname: string;
          }>`
            select c.relname, a.attname
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            join pg_attribute a on a.attrelid = c.oid and a.attnum > 0
              and not a.attisdropped
            where n.nspname = ${cluster.schema} and c.relkind = 'r'
              and c.relname <> 'tenant_domain'
              and has_column_privilege(${cluster.operator.user}, c.oid, a.attnum, 'UPDATE')
            order by c.relname, a.attname`.execute(owner);
          assert.deepEqual(columnUpdate.rows, [
            {
              relname: APPROVED_COLUMN_UPDATE.table,
              attname: APPROVED_COLUMN_UPDATE.column,
            },
          ]);
          const directExecute = await sql<{ signature: string }>`
            select p.oid::regprocedure::text as signature
            from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            cross join lateral aclexplode(p.proacl) a
            where n.nspname = ${cluster.schema}
              and a.privilege_type = 'EXECUTE'
              and a.grantee = (select r.oid from pg_roles r
                               where r.rolname = ${cluster.operator.user})
            order by 1`.execute(owner);
          assert.deepEqual(directExecute.rows, [
            { signature: 'tenant_domain_lock_organization(uuid)' },
          ]);

          // And the role the artifact provisioned runs the whole protocol.
          const provisioned = connect(
            cluster,
            cluster.operator,
            resolveDeploymentSchema({ REQRO_DEPLOYMENT_SCHEMA: cluster.schema })
              .connectionOptions,
          );
          extra.push(provisioned);
          await lifecycle(provisioned, nextHostname());
        },
      );

      await t.test(
        'the artifact refuses to leave a widened posture behind',
        async () => {
          // The fail-closed assertions are themselves load bearing, so they
          // are proven to fire rather than assumed: a table-level UPDATE on
          // the approval table is exactly the accident they exist to catch.
          const artifact = path.resolve(
            __dirname,
            '../../../../deploy/database/operator-role.sql',
          );
          await sql
            .raw(
              `grant update on ${cluster.schema}.tenant_domain_operator_approval to ${cluster.operator.user}`,
            )
            .execute(owner);
          try {
            const refused = cluster.applySqlFile(artifact, {
              operator: cluster.operator.user,
              schema: cluster.schema,
            });
            assert.notEqual(refused.status, 0);
            assert.match(
              refused.stderr + refused.stdout,
              /refusing: .*holds table-level UPDATE/,
            );
          } finally {
            await sql
              .raw(
                `revoke update on ${cluster.schema}.tenant_domain_operator_approval from ${cluster.operator.user}`,
              )
              .execute(owner);
            await sql
              .raw(
                `grant update (policy_version) on ${cluster.schema}.tenant_domain_operator_approval to ${cluster.operator.user}`,
              )
              .execute(owner);
            await sql
              .raw(`grant usage on schema ${cluster.schema} to public`)
              .execute(owner);
          }
        },
      );

      await t.test(
        'the operator can deny itself through its own default search_path, but only itself, and a pinned connection is immune',
        async () => {
          // A role may always set its own GUC defaults; this is the one
          // self-service change the constrained role retains. It is an
          // availability concern, not an escalation: nothing else is affected
          // and recovery needs a role with ALTER ROLE.
          const setter = connect(cluster, cluster.operator);
          extra.push(setter);
          await sql
            .raw(
              `alter role ${cluster.operator.user} set search_path = pg_temp`,
            )
            .execute(setter);
          const starved = connect(cluster, cluster.operator);
          extra.push(starved);
          await refuses(
            () => lifecycle(starved, nextHostname()),
            /function tenant_domain_lock_organization\(uuid\) does not exist/,
          );
          const pinned = connect(
            cluster,
            cluster.operator,
            '-c search_path=public',
          );
          extra.push(pinned);
          await lifecycle(pinned, nextHostname());
          await sql
            .raw(`alter role ${cluster.operator.user} reset search_path`)
            .execute(setter);
        },
      );
    } finally {
      for (const session of extra)
        await session.destroy().catch(() => undefined);
      await operator.destroy().catch(() => undefined);
      await owner.destroy().catch(() => undefined);
      await cluster.destroy();
    }
  },
);
