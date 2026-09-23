import { developmentIssueDefault } from './development-issue-default.js';
import type { TargetType } from '../service-request/ownership-targets.js';
import { setupDevelopmentOperationalTargets } from './development-operational-targets.js';
import 'reflect-metadata';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { databaseConnectionOptions } from '../config/database-tls.js';
import type { DatabaseSchema } from './database.types.js';
import { changeDevelopmentStaffGrants } from './development-staff-grants.js';
import {
  assertDevelopmentDatabaseUrl,
  developmentOrganization,
  developmentStaffEnvironment,
  developmentUuid,
  selectedDevelopmentPermissions,
  selectedDevelopmentScopes,
} from './development-staff-input.js';

async function run() {
  const [command, ...flags] = process.argv.slice(2);
  if (command === '--help' || flags.includes('--help')) {
    process.stdout.write(`F036 personal development staff tooling
Commands: inspect | provision | deprovision | setup-operations | issue-default
setup-operations explicitly creates/reuses fictional operational roles/teams and memberships for the selected existing scopes. It changes no permissions.
issue-default uses F048_ACTION=inspect|set|clear, F048_ISSUE_ID, and for mutations F048_EXPECTED_REVISION. Set additionally requires F048_TARGET_TYPE=staff|role|group and F048_TARGET_ID. Use inspect --dry-run before set/clear --dry-run, then --confirm. No HTTP configuration endpoint or grants are added.
Flags: --dry-run (read-only), --confirm (explicit write)
Set NODE_ENV=development, CITYVUE_DEPLOYMENT_PROFILE=development,
CITYVUE_ENABLE_EXTERNAL_IDENTITY=true and existing Entra settings.
F036_PERSONAL_ENTRA_TENANT_ID must explicitly match the configured personal tenant.
Only localhost:5432 / reqro_dev / reqro_dev_user is accepted.
Use inspect to find internal staff IDs; select F036_STAFF_ID explicitly.
Set F036_ORGANIZATION_ID to the existing fictional development Organization.
Set F036_SCOPES to JSON [{"departmentId":"<fictional-id>","divisionId":null}].
Choose F036_PERMISSIONS (comma-separated exact keys) OR F036_BUNDLE.
No .env file is loaded automatically. Keep personal inputs in ignored local configuration.
Deprovision removes selected F036 grants only; removing the final grant restores owned scopes.
Identity, requests, activity, catalog and unrelated roles are preserved.
`);
    return;
  }
  if (
    ![
      'inspect',
      'provision',
      'deprovision',
      'setup-operations',
      'issue-default',
    ].includes(command ?? '') ||
    flags.some((flag) => !['--dry-run', '--confirm'].includes(flag)) ||
    new Set(flags).size !== flags.length ||
    (flags.includes('--dry-run') && flags.includes('--confirm'))
  )
    throw new Error('Invalid command');
  const dryRun = flags.includes('--dry-run');
  if (command !== 'inspect' && !dryRun && !flags.includes('--confirm'))
    throw new Error('Explicit confirmation required');
  const env = developmentStaffEnvironment(process.env);
  const tenantId = env.ENTRA_TENANT_ID;
  if (!tenantId) throw new Error('Personal tenant required');
  const target = assertDevelopmentDatabaseUrl(env.DATABASE_URL);
  // Explicit connection fields; no URL query parameters or PG* target overrides.
  const db = new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool: new Pool({
        host: 'localhost',
        port: 5432,
        database: 'reqro_dev',
        user: 'reqro_dev_user',
        password: decodeURIComponent(target.password),
        ssl: databaseConnectionOptions({
          environment: env.NODE_ENV,
          url: env.DATABASE_URL,
          sslMode: env.DATABASE_SSL_MODE,
          caFile: env.DATABASE_SSL_CA_FILE,
        }).ssl,
        max: 1,
        connectionTimeoutMillis: 5000,
        statement_timeout: 30000,
        application_name: 'reqro-development-staff-provisioning',
        options: '-c search_path=public',
      }),
    }),
  });
  try {
    const identity = await sql<{
      database: string;
      role: string;
      port: number;
      address: string;
    }>`
      select current_database() as database, current_user as role,
        inet_server_port() as port, host(inet_server_addr()) as address`.execute(
      db,
    );
    const actual = identity.rows[0];
    if (
      actual?.database !== 'reqro_dev' ||
      actual.role !== 'reqro_dev_user' ||
      actual.port !== 5432 ||
      !['127.0.0.1', '::1'].includes(actual.address)
    )
      throw new Error('Unexpected actual database identity');
    if (command === 'inspect') {
      const candidates = await db.transaction().execute(async (trx) => {
        await sql`set transaction read only`.execute(trx);
        return trx
          .selectFrom('staff_identity as staff')
          .innerJoin(
            'organization as organization',
            'organization.id',
            'staff.organization_id',
          )
          .select(['staff.id', 'organization.name as organization'])
          .where('staff.entra_tenant_id', '=', tenantId)
          .where('staff.entra_object_id', 'is not', null)
          .where('staff.active', '=', true)
          .where('organization.id', '=', developmentOrganization.id)
          .where('organization.name', '=', developmentOrganization.name)
          .where('organization.slug', '=', developmentOrganization.slug)
          .where('organization.status', '=', 'active')
          .execute();
      });
      process.stdout.write(
        JSON.stringify(
          {
            profile: 'development',
            database: 'localhost:5432 / reqro_dev / reqro_dev_user',
            candidates,
            note: 'Internal staff IDs only. Explicit selection is required; no grants changed.',
          },
          null,
          2,
        ) + '\n',
      );
      return;
    }
    const staffId = process.env.F036_STAFF_ID ?? '';
    if (!developmentUuid.test(staffId))
      throw new Error('Explicit staff ID required');
    if (command === 'issue-default') {
      const action = process.env.F048_ACTION;
      if (!['inspect', 'set', 'clear'].includes(action ?? ''))
        throw new Error('Explicit F048_ACTION inspect, set or clear required');
      const revision = process.env.F048_EXPECTED_REVISION;
      if (action !== 'inspect' && !/^(0|[1-9][0-9]*)$/.test(revision ?? ''))
        throw new Error('Explicit configuration revision required');
      const result = await developmentIssueDefault(
        db,
        {
          tenantId,
          staffId,
          organizationId: process.env.F036_ORGANIZATION_ID ?? '',
          issueId: process.env.F048_ISSUE_ID ?? '',
          ...(action === 'inspect'
            ? {}
            : {
                input: {
                  expectedRevision: Number(revision),
                  target:
                    action === 'clear'
                      ? null
                      : {
                          type: process.env.F048_TARGET_TYPE as TargetType,
                          id: process.env.F048_TARGET_ID ?? '',
                        },
                },
              }),
        },
        dryRun,
      );
      process.stdout.write(
        JSON.stringify(
          {
            profile: 'development',
            database: 'localhost:5432 / reqro_dev / reqro_dev_user',
            ...result,
          },
          null,
          2,
        ) + '\n',
      );
      return;
    }
    if (command === 'setup-operations') {
      const result = await setupDevelopmentOperationalTargets(
        db,
        {
          tenantId,
          staffId,
          organizationId: process.env.F036_ORGANIZATION_ID ?? '',
          scopes: selectedDevelopmentScopes(process.env.F036_SCOPES),
        },
        dryRun,
      );
      process.stdout.write(
        JSON.stringify(
          {
            profile: 'development',
            database: 'localhost:5432 / reqro_dev / reqro_dev_user',
            ...result,
          },
          null,
          2,
        ) + '\n',
      );
      return;
    }
    const result = await changeDevelopmentStaffGrants(
      db,
      {
        tenantId: tenantId,
        staffId,
        organizationId: process.env.F036_ORGANIZATION_ID ?? '',
        scopes: selectedDevelopmentScopes(process.env.F036_SCOPES),
        permissions: selectedDevelopmentPermissions(
          process.env.F036_PERMISSIONS,
          process.env.F036_BUNDLE,
        ),
      },
      command as 'provision' | 'deprovision',
      dryRun,
    );
    process.stdout.write(
      JSON.stringify(
        {
          profile: 'development',
          database: 'localhost:5432 / reqro_dev / reqro_dev_user',
          ...result,
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    await db.destroy();
  }
}

run().catch(() => {
  // No driver/configuration error serialization: neither credentials nor identity input may leak.
  process.stderr.write(
    'Development staff command refused or failed. Check explicit profile, personal tenant, local database, principal, scopes, permissions and ownership. No partial transaction was committed.\n',
  );
  process.exitCode = 1;
});
