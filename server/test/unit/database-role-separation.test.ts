import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  assertMigrationLoginSeparate,
  assertMigrationRoleAssumed,
  databaseRoleFailureCodes,
  DatabaseRoleRefusal,
  resolveMigrationConnection,
} from '../../src/config/database-roles.js';
import { resolveRuntimeConnection } from '../../src/config/runtime-connection.js';

/**
 * ADR-027 F060.3C-2d. The configuration half of role separation: the migration
 * credential is distinct from the runtime credential, neither can be mistaken
 * for the other, and the runtime cannot even read the migration one.
 *
 * Separating the roles in the database is only half the work. These assertions
 * cover the half the database cannot enforce.
 */
const SOURCE = path.resolve(__dirname, '../../../src');
const DIST = path.resolve(__dirname, '../../src');

/** Comments are prose and must not satisfy or trip a structural scan. */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function refusalCode(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    assert.ok(
      error instanceof DatabaseRoleRefusal,
      'expected a DatabaseRoleRefusal',
    );
    return error.code;
  }
  return assert.fail('expected a refusal');
}

const runtimeUrl = 'postgresql://reqro_runtime:secret@localhost:5432/reqro';
const migrationUrl = 'postgresql://reqro_migrate:secret@localhost:5432/reqro';

test('production refuses an absent migration credential', () => {
  // Fail closed: the migration command never falls back to the runtime
  // credential in a serving environment, because that would hand DDL
  // authority to the request-path identity.
  assert.equal(
    refusalCode(() =>
      resolveMigrationConnection({
        NODE_ENV: 'production',
        DATABASE_URL: runtimeUrl,
      }),
    ),
    'migration_url_missing',
  );
  // With the dedicated credential present it resolves, and reports that the
  // credential was explicit.
  const resolved = resolveMigrationConnection({
    NODE_ENV: 'production',
    DATABASE_URL: runtimeUrl,
    MIGRATION_DATABASE_URL: migrationUrl,
    REQRO_DEPLOYMENT_SCHEMA: 'public',
  });
  assert.equal(resolved.dedicatedCredential, true);
  assert.equal(resolved.url, migrationUrl);
  assert.equal(resolved.ownerRole, 'reqro_owner');
  assert.equal(resolved.connectionOptions, '-c search_path=public');
});

test('no serving environment or profile combination can fall back to the runtime credential', () => {
  // The guard this test exists for: keying the fallback on NODE_ENV alone
  // would leave a client-profile or staging deployment able to migrate with
  // the runtime credential. Every combination is enumerated rather than
  // reasoned about, so a future signal cannot quietly reopen the path.
  const nodeEnvironments = ['development', 'test', 'production', ''];
  const profiles = ['development', 'client', ''];
  const deploymentEnvironments = ['test', 'staging', 'production', ''];

  const fellBack: string[] = [];
  const refused: string[] = [];
  for (const NODE_ENV of nodeEnvironments)
    for (const CITYVUE_DEPLOYMENT_PROFILE of profiles)
      for (const REQRO_DEPLOYMENT_ENVIRONMENT of deploymentEnvironments) {
        const label = `${NODE_ENV || '(unset)'}/${
          CITYVUE_DEPLOYMENT_PROFILE || '(unset)'
        }/${REQRO_DEPLOYMENT_ENVIRONMENT || '(unset)'}`;
        // Only DATABASE_URL is present, so resolving at all means a fallback.
        const environment = {
          NODE_ENV,
          CITYVUE_DEPLOYMENT_PROFILE,
          REQRO_DEPLOYMENT_ENVIRONMENT,
          DATABASE_URL: runtimeUrl,
        };
        try {
          const resolved = resolveMigrationConnection(environment);
          assert.equal(resolved.url, runtimeUrl);
          assert.equal(resolved.dedicatedCredential, false);
          fellBack.push(label);
        } catch (error) {
          assert.ok(error instanceof DatabaseRoleRefusal);
          assert.equal(error.code, 'migration_url_missing');
          refused.push(label);
        }
      }

  // Every serving posture is refused: production runtime, a client profile, or
  // a staging/production deployment marker, in any combination.
  const serving = (label: string) =>
    label.startsWith('production/') ||
    label.includes('/client/') ||
    label.endsWith('/staging') ||
    label.endsWith('/production');
  assert.deepEqual(
    fellBack.filter(serving),
    [],
    'a serving combination fell back to the runtime credential',
  );
  assert.deepEqual(
    refused.filter((label) => !serving(label)),
    [],
    'a non-serving combination was refused the documented fallback',
  );
  // Both sets are non-empty, so the matrix actually exercised both outcomes.
  assert.ok(fellBack.length > 0 && refused.length > 0);
  assert.equal(fellBack.length + refused.length, 48);

  // And supplying the dedicated credential resolves in every posture.
  for (const NODE_ENV of nodeEnvironments)
    for (const CITYVUE_DEPLOYMENT_PROFILE of profiles)
      for (const REQRO_DEPLOYMENT_ENVIRONMENT of deploymentEnvironments) {
        const resolved = resolveMigrationConnection({
          NODE_ENV,
          CITYVUE_DEPLOYMENT_PROFILE,
          REQRO_DEPLOYMENT_ENVIRONMENT,
          DATABASE_URL: runtimeUrl,
          MIGRATION_DATABASE_URL: migrationUrl,
        });
        assert.equal(resolved.url, migrationUrl);
        assert.equal(resolved.dedicatedCredential, true);
      }
});

test('the development fallback is explicit, reported, and never silent', () => {
  // Local workflows and the disposable test database predate this split, so a
  // fallback exists outside production -- but it is surfaced rather than
  // hidden, so a degraded posture can be logged.
  for (const nodeEnvironment of ['development', 'test']) {
    const resolved = resolveMigrationConnection({
      NODE_ENV: nodeEnvironment,
      DATABASE_URL: runtimeUrl,
    });
    assert.equal(resolved.dedicatedCredential, false);
    assert.equal(resolved.url, runtimeUrl);
  }
  // And the dedicated credential still wins when both are present.
  const both = resolveMigrationConnection({
    NODE_ENV: 'development',
    DATABASE_URL: runtimeUrl,
    MIGRATION_DATABASE_URL: migrationUrl,
  });
  assert.equal(both.url, migrationUrl);
  assert.equal(both.dedicatedCredential, true);
});

test('the migration URL and owner role are validated, not trusted', () => {
  assert.equal(
    refusalCode(() =>
      resolveMigrationConnection({ NODE_ENV: 'development', DATABASE_URL: '' }),
    ),
    'migration_url_missing',
  );
  for (const invalid of ['not a url', 'mysql://host/db', 'localhost/db'])
    assert.equal(
      refusalCode(() =>
        resolveMigrationConnection({
          NODE_ENV: 'development',
          MIGRATION_DATABASE_URL: invalid,
        }),
      ),
      'migration_url_invalid',
      `must refuse ${invalid}`,
    );
  // The owner role becomes part of a SET ROLE statement, so anything that is
  // not a plain lower-case identifier is refused rather than escaped.
  for (const invalid of [
    'reqro owner',
    'reqro_owner; drop table category',
    '"ReqroOwner"',
    'REQRO_OWNER',
    'ab',
    '1owner',
    'owner-role',
  ])
    assert.equal(
      refusalCode(() =>
        resolveMigrationConnection({
          NODE_ENV: 'development',
          MIGRATION_DATABASE_URL: migrationUrl,
          REQRO_DATABASE_OWNER_ROLE: invalid,
        }),
      ),
      'owner_role_invalid',
      `must refuse ${invalid}`,
    );
  // A valid override is accepted.
  assert.equal(
    resolveMigrationConnection({
      NODE_ENV: 'development',
      MIGRATION_DATABASE_URL: migrationUrl,
      REQRO_DATABASE_OWNER_ROLE: 'reqro_schema_owner',
    }).ownerRole,
    'reqro_schema_owner',
  );
});

test('both connections strip a search_path carried in the URL', () => {
  // F060.3C-2c-3 measured that a connection-string `options` parameter
  // overrides an explicit `options` key, so the pin is only reliable once the
  // parameter is removed.
  const smuggled = `${migrationUrl}?options=-c%20search_path%3Dpg_temp`;
  assert.equal(
    resolveMigrationConnection({
      NODE_ENV: 'development',
      MIGRATION_DATABASE_URL: smuggled,
    }).url,
    migrationUrl,
  );
  const runtime = resolveRuntimeConnection(
    `${runtimeUrl}?application_name=x&options=-c%20search_path%3Devil`,
    { REQRO_DEPLOYMENT_SCHEMA: 'public' },
  );
  assert.equal(runtime.url, `${runtimeUrl}?application_name=x`);
  assert.equal(runtime.connectionOptions, '-c search_path=public');
  assert.equal(runtime.schema, 'public');
});

test('role assumption is asserted on both identities', () => {
  // current_user decides ownership; session_user carries the audit trail.
  assertMigrationRoleAssumed(
    { currentUser: 'reqro_owner', sessionUser: 'reqro_migrate' },
    { ownerRole: 'reqro_owner', loginRole: 'reqro_migrate' },
  );
  // The role was not assumed at all.
  assert.equal(
    refusalCode(() => {
      assertMigrationRoleAssumed(
        { currentUser: 'reqro_migrate', sessionUser: 'reqro_migrate' },
        { ownerRole: 'reqro_owner', loginRole: 'reqro_migrate' },
      );
    }),
    'role_assumption_failed',
  );
  // The session identity changed, so the audit trail would be wrong.
  assert.equal(
    refusalCode(() => {
      assertMigrationRoleAssumed(
        { currentUser: 'reqro_owner', sessionUser: 'reqro_owner' },
        { ownerRole: 'reqro_owner', loginRole: 'reqro_migrate' },
      );
    }),
    'identity_mismatch',
  );
  // A migration credential that IS the owner would make SET ROLE meaningless
  // and reintroduce standing DDL authority on a login.
  assert.equal(
    refusalCode(() => {
      assertMigrationLoginSeparate('reqro_owner', 'reqro_owner');
    }),
    'identity_mismatch',
  );
  assertMigrationLoginSeparate('reqro_migrate', 'reqro_owner');
});

test('the failure codes are a closed, sanitized set', () => {
  // Mirrors the operator module: an infrastructure job log can alert on a code
  // without the message ever carrying detail.
  assert.deepEqual([...databaseRoleFailureCodes].sort(), [
    'identity_mismatch',
    'migration_url_invalid',
    'migration_url_missing',
    'owner_role_invalid',
    'role_assumption_failed',
  ]);
  const refusal = new DatabaseRoleRefusal('identity_mismatch', 'detail');
  assert.equal(refusal.name, 'DatabaseRoleRefusal');
  assert.equal(refusal.code, 'identity_mismatch');
});

test('the runtime never reads the migration credential', () => {
  // Structural, over the built runtime graph, rather than by convention. This
  // is the assertion that keeps the two credentials from converging again.
  const entry = path.join(DIST, 'main.js');
  assert.ok(existsSync(entry), 'the built runtime entry point must exist');
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (file === undefined || seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, 'utf8').matchAll(
      /require\(["'](\.[^"']+)["']\)/g,
    )) {
      let target = path.resolve(path.dirname(file), match[1] ?? '');
      if (existsSync(target) && statSync(target).isDirectory())
        target = path.join(target, 'index.js');
      if (!target.endsWith('.js')) target += '.js';
      queue.push(target);
    }
  }
  const offenders: string[] = [];
  for (const file of seen) {
    if (!file.startsWith(DIST)) continue;
    const source = path
      .join(SOURCE, path.relative(DIST, file))
      .replace(/\.js$/, '.ts');
    if (!existsSync(source)) continue;
    // Comments are prose and must not trip a structural assertion: the
    // runtime connection module's own documentation explains why it must
    // not read this variable, which is not the same as reading it.
    const code = stripComments(readFileSync(source, 'utf8'));
    if (code.includes('MIGRATION_DATABASE_URL'))
      offenders.push(path.relative(SOURCE, source).replace(/\\/g, '/'));
  }
  assert.deepEqual(
    offenders,
    [],
    'a runtime module reads MIGRATION_DATABASE_URL; the credentials must stay separate',
  );
});

test('the migration command assumes the owner role before applying anything', () => {
  const cli = readFileSync(
    path.join(SOURCE, 'database/migration-cli.ts'),
    'utf8',
  );
  // The dedicated credential, not the runtime one.
  assert.match(cli, /resolveMigrationConnection\(process\.env\)/);
  assert.ok(!cli.includes('environment.DATABASE_URL'));
  // The role is assumed and then proven, before any migration runs.
  assert.match(cli, /set role \$\{migration\.ownerRole\}/);
  assert.match(cli, /assertMigrationRoleAssumed/);
  assert.match(cli, /assertMigrationLoginSeparate/);
  const assumeAt = cli.indexOf('await assumeOwnerRole(');
  const migrateAt = cli.indexOf('migrator.migrateToLatest()');
  assert.ok(assumeAt > 0 && migrateAt > 0 && assumeAt < migrateAt);
  // A single connection, so no un-assumed connection can run DDL.
  assert.match(cli, /max: 1,/);
  // And the schema is pinned.
  assert.match(cli, /options: migration\.connectionOptions/);
  // A fallback is announced, never silent.
  assert.match(cli, /!migration\.dedicatedCredential/);
  assert.match(cli, /MIGRATION_DATABASE_URL is unset/);
});

test('only the migration path performs SET ROLE', () => {
  // Runtime code must never assume another role.
  const entry = path.join(DIST, 'main.js');
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (file === undefined || seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, 'utf8').matchAll(
      /require\(["'](\.[^"']+)["']\)/g,
    )) {
      let target = path.resolve(path.dirname(file), match[1] ?? '');
      if (existsSync(target) && statSync(target).isDirectory())
        target = path.join(target, 'index.js');
      if (!target.endsWith('.js')) target += '.js';
      queue.push(target);
    }
  }
  const offenders: string[] = [];
  for (const file of seen) {
    if (!file.startsWith(DIST)) continue;
    const source = path
      .join(SOURCE, path.relative(DIST, file))
      .replace(/\.js$/, '.ts');
    if (!existsSync(source)) continue;
    const code = stripComments(readFileSync(source, 'utf8'));
    if (/\bset\s+role\b/i.test(code))
      offenders.push(path.relative(SOURCE, source).replace(/\\/g, '/'));
  }
  assert.deepEqual(
    offenders,
    [],
    'a runtime module performs SET ROLE; only the migration command may assume the owner role',
  );
});

test('the provisioning artifacts contain no secret and no blanket grant', () => {
  const deploy = path.resolve(__dirname, '../../../../deploy/database');
  for (const name of ['bootstrap-roles.sql', 'runtime-role.sql']) {
    const file = path.join(deploy, name);
    assert.ok(existsSync(file), `${name} must exist`);
    const text = readFileSync(file, 'utf8');
    const executable = text
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    // No secret material, and no password is ever set.
    assert.ok(
      !/\bpassword\b/i.test(executable),
      `${name} must set no password`,
    );
    // No blanket privilege.
    for (const forbidden of [
      'grant all',
      'on all tables',
      'on all functions',
      'revoke all on database',
      'alter default privileges',
    ])
      assert.ok(
        !executable.toLowerCase().includes(forbidden),
        `${name} must not contain "${forbidden}"`,
      );
  }
  // The runtime artifact must not grant the owner-only or operator-only
  // functions, and must not touch the operator's reviewed definition.
  const runtime = readFileSync(path.join(deploy, 'runtime-role.sql'), 'utf8');
  const executable = runtime
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  // Only real GRANT statements are scanned. An earlier version matched the
  // substring "grant" inside "a.grantee" in the fail-closed block and
  // reported a false positive.
  const grants = executable
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => /^grant\s/i.test(statement));
  for (const forbidden of [
    'advance_access_revision',
    'invalidate_access_revision',
    'tenant_domain_lock_organization',
    'tenant_domain_audit',
    'tenant_domain_operator_approval',
    'tenant_domain_verification_attempt',
  ])
    assert.ok(
      !grants.some((statement) => statement.includes(forbidden)),
      `runtime-role.sql must not grant ${forbidden}`,
    );
  // Category and access state carry column-scoped UPDATE only.
  assert.match(executable, /grant update \(id\) on :"schema"\.category/);
  assert.match(
    executable,
    /grant update \(bootstrap_established\) on :"schema"\.organization_access_state/,
  );
  assert.ok(!/grant[^;]*update on :"schema"\.category/i.test(executable));
});
