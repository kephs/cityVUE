/**
 * F067 disposable migration runner — offline regression tests.
 *
 * The defect this replaces was invisible precisely because the phase had never
 * run: an `.mjs` script asked Kysely to import `.ts` migrations under Node 20,
 * which cannot work. So the sequence is exercised here against injected
 * effects, and the strongest assertions are the negative ones — a refused
 * target must leave `migrate` uncalled, which is what proves no statement
 * reached a database.
 *
 * The structural checks cover what a live run could violate silently: that the
 * runner is reachable only through `tsx`, that it reads one dedicated variable
 * and never `DATABASE_URL`, that it discovers all sixty migrations from source,
 * and that it leaves the persistent-database migration guards untouched.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DISPOSABLE_MIGRATION_NONCE_VARIABLE,
  DISPOSABLE_MIGRATION_ROLE_VARIABLE,
  DISPOSABLE_MIGRATION_URL_VARIABLE,
  evaluateMigrationCompleteness,
  runDisposableMigration,
  type DisposableMigrationEffects,
} from '../../src/database/uat-f067-disposable-migration.js';
import { FIXTURE_DATABASE } from '../../src/database/uat-f067-tracking-fixture.js';

const SERVER_ROOT = resolve(__dirname, '../../..');
const source = (relative: string): string =>
  readFileSync(resolve(SERVER_ROOT, relative), 'utf8');

/**
 * Comments removed, so a forbidden-identifier check tests what the file does
 * rather than what it explains. These files deliberately name the guards they
 * leave alone and the variable they refuse to read; naming a thing in prose is
 * not using it, and a check that cannot tell the difference would force the
 * explanations out of the code.
 */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const RUNNER = code(source('src/database/uat-f067-disposable-migration.ts'));
const CLI = code(source('src/database/uat-f067-disposable-migration-cli.ts'));
const EFFECTS = code(source('scripts/uat-f067-effects.mjs'));
const INTEGRATION_PATH =
  'test/database/uat-f067-tracking-fixture.integration.test.ts';
const INTEGRATION_RAW = source(INTEGRATION_PATH);
const INTEGRATION = code(INTEGRATION_RAW);

/**
 * The migrations that only work where `public` holds the tables. They create
 * `public`-qualified SECURITY DEFINER functions whose bodies read
 * `public.<table>` under a fixed `search_path`.
 */
const PUBLIC_QUALIFIED_MIGRATIONS = [
  '20261018000000-harden-tenant-domain-functions',
  '20261019000000-harden-runtime-reference-locks',
  '20261023000000-add-integration-worker-function-api',
  '20261026000000-harden-integration-worker-claim-dispatch-api',
];

const migrationNames = (directory: string, extension: string): string[] =>
  readdirSync(resolve(SERVER_ROOT, directory))
    .filter(
      (name) => name.endsWith(extension) && !name.endsWith(`.d${extension}`),
    )
    .map((name) => name.slice(0, -extension.length))
    .sort();

const NONCE = 'c1'.repeat(16);
const ROLE = 'reqro_test_user';
const URL_OK = `postgresql://${ROLE}:secret@127.0.0.1:49512/${FIXTURE_DATABASE}`;
const DECLARED = ['20260902000000-a', '20260902010000-b', '20260902020000-c'];

/** Injected effects with a call log, so order and absence are both provable. */
function effects(
  overrides: Partial<DisposableMigrationEffects> = {},
  log: string[] = [],
): DisposableMigrationEffects & { log: string[] } {
  return {
    log,
    readTargetFacts: async () => {
      log.push('readTargetFacts');
      return {
        url: URL_OK,
        sqlDatabase: FIXTURE_DATABASE,
        sqlUser: ROLE,
        sqlNonce: NONCE,
        expectedNonce: NONCE,
        expectedRole: ROLE,
      };
    },
    readDeclaredMigrations: async () => {
      log.push('readDeclaredMigrations');
      return [...DECLARED];
    },
    prepareExtensions: async () => {
      log.push('prepareExtensions');
    },
    migrate: async () => {
      log.push('migrate');
      return { applied: [...DECLARED], error: null };
    },
    ...overrides,
  };
}

// --- completeness verdict --------------------------------------------------

void test('F067 migration completeness accepts a run that applied every declared migration', () => {
  assert.deepEqual(
    evaluateMigrationCompleteness({ declared: DECLARED, applied: DECLARED }),
    { ok: true, reasons: [] },
  );
  // Order is irrelevant; identity is not.
  assert.equal(
    evaluateMigrationCompleteness({
      declared: DECLARED,
      applied: [...DECLARED].reverse(),
    }).ok,
    true,
  );
});

void test('F067 a missing migration is refused and named', () => {
  const verdict = evaluateMigrationCompleteness({
    declared: DECLARED,
    applied: DECLARED.slice(0, 2),
  });
  assert.equal(verdict.ok, false);
  assert.ok(
    verdict.reasons.some((reason) => reason.includes(DECLARED[2] ?? '')),
  );
  assert.ok(verdict.reasons.some((reason) => reason.includes('not applied')));
});

void test('F067 four missing migrations are all named, not summarised away', () => {
  const declared = [...DECLARED, 'w', 'x', 'y', 'z'];
  const verdict = evaluateMigrationCompleteness({
    declared,
    applied: DECLARED,
  });
  assert.equal(verdict.ok, false);
  for (const name of ['w', 'x', 'y', 'z'])
    assert.ok(
      verdict.reasons.some((reason) => reason.includes(name)),
      name,
    );
});

void test('F067 an applied migration the repository does not declare is refused', () => {
  const verdict = evaluateMigrationCompleteness({
    declared: DECLARED,
    applied: [...DECLARED, 'undeclared-migration'],
  });
  assert.equal(verdict.ok, false);
  assert.ok(
    verdict.reasons.some((reason) => reason.includes('not declared')),
    verdict.reasons.join('; '),
  );
});

void test('F067 a framework error is a refusal even when every migration applied', () => {
  const verdict = evaluateMigrationCompleteness({
    declared: DECLARED,
    applied: DECLARED,
    error: 'relation already exists',
  });
  assert.equal(verdict.ok, false);
  assert.ok(
    verdict.reasons.some((reason) =>
      reason.includes('relation already exists'),
    ),
  );
});

void test('F067 an empty or unreadable inventory is refused rather than treated as complete', () => {
  assert.equal(
    evaluateMigrationCompleteness({ declared: [], applied: [] }).ok,
    false,
  );
  assert.equal(
    evaluateMigrationCompleteness({ declared: null, applied: DECLARED }).ok,
    false,
  );
  assert.equal(
    evaluateMigrationCompleteness({ declared: DECLARED, applied: null }).ok,
    false,
  );
  assert.equal(
    evaluateMigrationCompleteness({
      declared: undefined,
      applied: undefined,
    }).ok,
    false,
  );
});

// --- the sequence ----------------------------------------------------------

void test('F067 a verified target migrates, in order, and reports completeness', async () => {
  const log: string[] = [];
  const mock = effects({}, log);
  const result = await runDisposableMigration(mock);
  assert.equal(result.ok, true);
  assert.deepEqual(result.reasons, []);
  assert.deepEqual([...result.applied], DECLARED);
  assert.deepEqual([...result.declared], DECLARED);
  // The gate runs first and extensions only after it passes.
  assert.deepEqual(log, [
    'readTargetFacts',
    'readDeclaredMigrations',
    'prepareExtensions',
    'migrate',
  ]);
});

void test('F067 a refused target applies nothing at all', async () => {
  const cases: [string, Partial<DisposableMigrationEffects>, string][] = [
    [
      'the persistent development database',
      {
        readTargetFacts: async () => ({
          url: `postgresql://${ROLE}:s@127.0.0.1:49512/reqro_dev`,
          sqlDatabase: 'reqro_dev',
          sqlUser: ROLE,
          sqlNonce: NONCE,
          expectedNonce: NONCE,
          expectedRole: ROLE,
        }),
      },
      'reqro_dev',
    ],
    [
      'the native PostgreSQL port',
      {
        readTargetFacts: async () => ({
          url: `postgresql://${ROLE}:s@127.0.0.1:5432/${FIXTURE_DATABASE}`,
          sqlDatabase: FIXTURE_DATABASE,
          sqlUser: ROLE,
          sqlNonce: NONCE,
          expectedNonce: NONCE,
          expectedRole: ROLE,
        }),
      },
      '5432',
    ],
    [
      'a nonce that is not this session',
      {
        readTargetFacts: async () => ({
          url: URL_OK,
          sqlDatabase: FIXTURE_DATABASE,
          sqlUser: ROLE,
          sqlNonce: 'd2'.repeat(16),
          expectedNonce: NONCE,
          expectedRole: ROLE,
        }),
      },
      'nonce',
    ],
    [
      'a server exposing no nonce at all',
      {
        readTargetFacts: async () => ({
          url: URL_OK,
          sqlDatabase: FIXTURE_DATABASE,
          sqlUser: ROLE,
          sqlNonce: null,
          expectedNonce: NONCE,
          expectedRole: ROLE,
        }),
      },
      'nonce',
    ],
    [
      'a non-loopback host',
      {
        readTargetFacts: async () => ({
          url: `postgresql://${ROLE}:s@db.example.test:49512/${FIXTURE_DATABASE}`,
          sqlDatabase: FIXTURE_DATABASE,
          sqlUser: ROLE,
          sqlNonce: NONCE,
          expectedNonce: NONCE,
          expectedRole: ROLE,
        }),
      },
      'loopback',
    ],
  ];
  for (const [label, override, fragment] of cases) {
    const log: string[] = [];
    const result = await runDisposableMigration(effects(override, log));
    assert.equal(result.ok, false, label);
    assert.ok(
      result.reasons.some((reason) => reason.includes(fragment)),
      `${label} -> ${result.reasons.join('; ')}`,
    );
    assert.ok(
      result.reasons.some((reason) => reason.includes('refused')),
      label,
    );
    // The proof: neither extensions nor migration were reached. The overriding
    // target reader does not log, so the only possible entries would be the
    // steps that follow the gate.
    assert.ok(!log.includes('readDeclaredMigrations'), label);
    assert.ok(!log.includes('prepareExtensions'), label);
    assert.ok(!log.includes('migrate'), label);
    assert.equal(result.applied.length, 0, label);
    assert.equal(result.declared.length, 0, label);
  }
});

void test('F067 an unreadable target is a refusal, not an assumption', async () => {
  const log: string[] = [];
  const result = await runDisposableMigration(
    effects(
      {
        readTargetFacts: () => {
          log.push('readTargetFacts');
          return Promise.reject(new Error('connection terminated'));
        },
      },
      log,
    ),
  );
  assert.equal(result.ok, false);
  assert.ok(
    result.reasons.some((reason) => reason.includes('could not be read')),
  );
  assert.deepEqual(log, ['readTargetFacts']);
});

void test('F067 an unreadable migration inventory stops before any write', async () => {
  const log: string[] = [];
  const result = await runDisposableMigration(
    effects(
      {
        readDeclaredMigrations: () => {
          log.push('readDeclaredMigrations');
          return Promise.reject(new Error('ENOENT: migrations'));
        },
      },
      log,
    ),
  );
  assert.equal(result.ok, false);
  assert.ok(
    result.reasons.some((reason) =>
      reason.includes('inventory could not be read'),
    ),
  );
  assert.deepEqual(log, ['readTargetFacts', 'readDeclaredMigrations']);
});

void test('F067 failing extension preparation stops before migrating', async () => {
  const log: string[] = [];
  const result = await runDisposableMigration(
    effects(
      {
        prepareExtensions: () => {
          log.push('prepareExtensions');
          return Promise.reject(new Error('pgcrypto unavailable'));
        },
      },
      log,
    ),
  );
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((reason) => reason.includes('extensions')));
  assert.ok(!log.includes('migrate'));
});

void test('F067 a thrown migration failure is reported, never swallowed', async () => {
  const result = await runDisposableMigration(
    effects({
      migrate: () =>
        Promise.reject(new Error('syntax error at or near "creat"')),
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(
    result.reasons.some((reason) => reason.includes('execution failed')),
  );
  assert.ok(result.reasons.some((reason) => reason.includes('syntax error')));
  assert.equal(result.applied.length, 0);
});

void test('F067 a silently partial migration is refused', async () => {
  const result = await runDisposableMigration(
    effects({
      migrate: async () => ({ applied: DECLARED.slice(0, 1), error: null }),
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((reason) => reason.includes('not applied')));
  // The partial list is still reported, so an operator can see how far it got.
  assert.deepEqual([...result.applied], DECLARED.slice(0, 1));
});

void test('F067 a reported framework error is refused even with a full applied list', async () => {
  const result = await runDisposableMigration(
    effects({
      migrate: async () => ({
        applied: [...DECLARED],
        error: 'deadlock detected',
      }),
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(
    result.reasons.some((reason) => reason.includes('deadlock detected')),
  );
});

void test('F067 a malformed migration result is refused rather than coerced to success', async () => {
  const result = await runDisposableMigration(
    effects({
      migrate: async () =>
        ({ applied: undefined, error: null }) as unknown as {
          applied: readonly string[];
          error: string | null;
        },
    }),
  );
  assert.equal(result.ok, false);
});

void test('F067 a connection string inside a failure message is redacted', async () => {
  const result = await runDisposableMigration(
    effects({
      migrate: () =>
        Promise.reject(
          new Error(`could not connect to ${URL_OK} after 3 attempts`),
        ),
    }),
  );
  assert.equal(result.ok, false);
  const text = result.reasons.join(' ');
  assert.ok(!text.includes('secret'));
  assert.ok(!text.includes(URL_OK));
  assert.ok(text.includes('[redacted-url]'));
});

// --- structure: the mechanism itself --------------------------------------

void test('F067 the runner takes its target from one dedicated variable and never DATABASE_URL', () => {
  assert.equal(
    DISPOSABLE_MIGRATION_URL_VARIABLE,
    'REQRO_F067_UAT_DATABASE_URL',
  );
  assert.equal(
    DISPOSABLE_MIGRATION_NONCE_VARIABLE,
    'REQRO_F067_UAT_DISPOSABLE_NONCE',
  );
  assert.equal(
    DISPOSABLE_MIGRATION_ROLE_VARIABLE,
    'REQRO_F067_UAT_DISPOSABLE_ROLE',
  );
  assert.ok(CLI.includes('required(DISPOSABLE_MIGRATION_URL_VARIABLE)'));
  // No implicit fallback is possible. The runtime variable is never read as a
  // bare name, and no dotenv loader is imported, so a populated `server/.env`
  // cannot redirect this. Note the dedicated variable's own name ends in
  // DATABASE_URL, so the check is for the exact runtime token.
  assert.ok(!/process\.env\.DATABASE_URL\b/.test(CLI));
  assert.ok(!/(['"`])DATABASE_URL\1/.test(CLI));
  assert.ok(!CLI.includes('dotenv'));
  // Every environment read in the CLI goes through the three constants.
  assert.deepEqual(CLI.match(/required\([A-Z_]+\)/g)?.sort(), [
    'required(DISPOSABLE_MIGRATION_NONCE_VARIABLE)',
    'required(DISPOSABLE_MIGRATION_ROLE_VARIABLE)',
    'required(DISPOSABLE_MIGRATION_URL_VARIABLE)',
  ]);
  // The decision module itself reads no environment at all.
  assert.ok(!RUNNER.includes('process.env'));
});

void test('F067 the runner discovers migrations from source, so all sixty are reachable', () => {
  const declared = readdirSync(resolve(SERVER_ROOT, 'migrations')).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.d.ts'),
  );
  assert.equal(declared.length, 60);
  // The source directory, resolved from the working directory, exactly as the
  // application's own migration CLI resolves it.
  assert.ok(CLI.includes("path.resolve(process.cwd(), 'migrations')"));
  assert.ok(
    source('src/database/migration-cli.ts').includes(
      "path.resolve(process.cwd(), 'migrations')",
    ),
  );
  assert.ok(CLI.includes('FileMigrationProvider'));
  // dist-test holds only what some test imports, so it is never the source of
  // truth for completeness.
  assert.ok(!CLI.includes('dist-test'));
});

void test('F067 the orchestrator runs migrations through tsx, not in-process from .mjs', () => {
  assert.ok(
    EFFECTS.includes('src/database/uat-f067-disposable-migration-cli.ts'),
  );
  assert.ok(EFFECTS.includes('REQRO_F067_UAT_DATABASE_URL: url'));
  assert.ok(EFFECTS.includes('REQRO_F067_UAT_DISPOSABLE_NONCE: nonce'));
  assert.ok(EFFECTS.includes("'tsx', 'dist', 'cli.mjs'"));
  // The broken in-process mechanism is gone.
  assert.ok(!EFFECTS.includes('FileMigrationProvider'));
  assert.ok(!EFFECTS.includes('Migrator'));
  // And no persistent database is ever named as a target.
  assert.ok(!EFFECTS.includes('reqro_dev'));
});

void test('F067 the persistent-database migration guards are left untouched', () => {
  // The application CLI assumes a dedicated owner role and proves the login
  // and owner are distinct. A disposable cluster has one generated role, so
  // this runner does not reuse that CLI rather than relaxing its assertions.
  const roles = source('src/config/database-roles.ts');
  assert.ok(roles.includes('export function assertMigrationLoginSeparate'));
  assert.ok(roles.includes('export function assertMigrationRoleAssumed'));
  for (const text of [RUNNER, CLI])
    for (const forbidden of [
      'assertMigrationLoginSeparate',
      'assertMigrationRoleAssumed',
      'resolveMigrationConnection',
      'set role',
      'MIGRATION_DATABASE_URL',
      'REQRO_DATABASE_OWNER_ROLE',
    ])
      assert.ok(!text.includes(forbidden), forbidden);
  // It also does not import the application migration CLI or re-export it.
  assert.ok(!CLI.includes('migration-cli'));
});

void test('F067 extension preparation matches the disposable test infrastructure', () => {
  // Restated in the CLI because `src` must not import from `test`; the build
  // config excludes `test` entirely. This keeps the two in agreement.
  const helper = source('test/helpers/database-extensions.ts');
  for (const statement of [
    'pg_advisory_xact_lock(20260902, 1)',
    'create extension if not exists pgcrypto with schema public',
    "where e.extname = 'pgcrypto'",
  ]) {
    assert.ok(helper.includes(statement), `helper: ${statement}`);
    assert.ok(CLI.includes(statement), `cli: ${statement}`);
  }
  assert.ok(
    CLI.includes('Test pgcrypto must be installed in the shared public schema'),
  );
  assert.ok(!CLI.includes("from '../../test/"));
});

// --- shared-inventory regression safeguards -------------------------------

void test('F067 the public-qualified migrations never reach the shared compiled inventory', () => {
  // The regression: `dist-test/migrations` is the shared
  // FileMigrationProvider root for every schema-isolated suite. Emitting the
  // four into it made eleven suites fail — `type "public.tenant_domain" does
  // not exist` from a per-test schema, then
  // `function "tenant_domain_lock_organization" already exists` once a second
  // schema applied them.
  const compiled = migrationNames('dist-test/migrations', '.js');
  for (const excluded of PUBLIC_QUALIFIED_MIGRATIONS)
    assert.ok(!compiled.includes(excluded), excluded);
  // The established contract: the shared build carries fewer migrations than
  // the repository declares, and exactly these four are the difference.
  const declared = migrationNames('migrations', '.ts');
  assert.equal(declared.length, 60);
  assert.deepEqual(
    declared.filter((name) => !compiled.includes(name)),
    [...PUBLIC_QUALIFIED_MIGRATIONS].sort(),
  );
  assert.equal(compiled.length, 56);
});

void test('F067 no test imports a public-qualified migration into the shared build', () => {
  // A TypeScript migration reaches the test build only when some test
  // references it, so the safeguard is an absence of imports anywhere under
  // test/, not just in the F067 file.
  const offenders: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(resolve(SERVER_ROOT, directory), {
      withFileTypes: true,
    })) {
      const next = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (entry.name.endsWith('.ts')) {
        const text = source(next);
        for (const excluded of PUBLIC_QUALIFIED_MIGRATIONS)
          if (new RegExp(`from\\s+['"][^'"]*${excluded}`).test(text))
            offenders.push(`${next} -> ${excluded}`);
      }
    }
  };
  walk('test');
  assert.deepEqual(offenders, []);
});

void test('F067 completeness is measured from source and still requires all sixty', () => {
  // The F067 requirement is never lowered to the shared build's 56.
  assert.ok(INTEGRATION.includes('SOURCE_MIGRATION_FOLDER'));
  assert.ok(INTEGRATION.includes('assert.equal(declared.length, 60)'));
  assert.ok(INTEGRATION.includes('assert.equal(report.declaredCount, 60)'));
  assert.ok(INTEGRATION.includes('assert.equal(report.appliedCount, 60)'));
  assert.ok(!/\b56\b/.test(INTEGRATION), 'no 56-migration expectation');
  // Completeness is not taken from the shared compiled directory.
  assert.ok(
    !/const compiled[\s\S]{0,200}assert\.deepEqual\(\s*compiled,\s*declared/.test(
      INTEGRATION,
    ),
  );
  // The source directory is the authoritative inventory for the launcher.
  assert.ok(CLI.includes("path.resolve(process.cwd(), 'migrations')"));
  assert.ok(!CLI.includes('dist-test'));
});

void test('F067 a missing public-qualified migration fails the real-inventory verdict', () => {
  // Against the actual sixty names, not a synthetic list.
  const declared = migrationNames('migrations', '.ts');
  for (const dropped of PUBLIC_QUALIFIED_MIGRATIONS) {
    const verdict = evaluateMigrationCompleteness({
      declared,
      applied: declared.filter((name) => name !== dropped),
    });
    assert.equal(verdict.ok, false, dropped);
    assert.ok(
      verdict.reasons.some((reason) => reason.includes(dropped)),
      dropped,
    );
  }
  // And the complete set passes.
  assert.deepEqual(
    evaluateMigrationCompleteness({ declared, applied: declared }),
    { ok: true, reasons: [] },
  );
});

void test('F067 the schema-isolated suites keep their migration discovery contract', () => {
  // They load the compiled directory, which must remain the 56-migration set.
  const f066 = source(
    'test/database/submission-idempotency.integration.test.ts',
  );
  assert.ok(
    f066.includes(
      "migrationFolder: path.resolve(__dirname, '../../migrations')",
    ),
  );
  assert.ok(f066.includes('migrationTableSchema: schema'));
  // Their own schema isolation is unchanged.
  assert.ok(f066.includes('options: `-c search_path=${schema}`'));
  // And the F067 test no longer drives a compiled in-process migrator at all,
  // so it cannot reintroduce the coupling.
  assert.ok(!INTEGRATION.includes('new Migrator('));
  assert.ok(!INTEGRATION.includes('FileMigrationProvider'));
});

void test('F067 the integration test targets only the verified disposable public schema', () => {
  assert.ok(INTEGRATION.includes("const schema = 'public'"));
  // The disposable identity gate precedes every write.
  const gate = INTEGRATION.indexOf('evaluateFixtureTarget(');
  const firstWrite = INTEGRATION.indexOf('.insertInto(');
  assert.ok(gate > 0 && firstWrite > 0 && gate < firstWrite);
  assert.ok(INTEGRATION.includes('REQRO_DISPOSABLE_NONCE'));
  // It never names a persistent database as a target, only as a refusal case.
  assert.ok(INTEGRATION.includes("'/reqro_dev'"));
  assert.ok(
    !INTEGRATION.includes('search_path='),
    'no per-test schema isolation',
  );
});

void test('F067 the integration test cannot drop the public schema', () => {
  // Dropping it would remove the shared pgcrypto installation and the schema
  // itself from a database other suites still hold connections to.
  assert.ok(!/drop\s+schema/i.test(INTEGRATION_RAW));
  assert.ok(!/drop\s+database/i.test(INTEGRATION_RAW));
  assert.ok(!/drop\s+owned/i.test(INTEGRATION_RAW));
  assert.ok(!/truncate/i.test(INTEGRATION_RAW));
});

void test('F067 no application runtime or authorization module is reached', () => {
  // The two new src modules are database tooling. They import no controller,
  // guard, module or Nest provider, so no runtime or authorization behaviour
  // can change through them.
  for (const text of [RUNNER, CLI])
    for (const forbidden of [
      '.controller',
      '.guard',
      '.module',
      'auth.decorators',
      'staff-access',
      '@nestjs/common',
      'NestFactory',
    ])
      assert.ok(!text.includes(forbidden), forbidden);
  // The integration test exercises the tracking repository read path, which
  // is a read, and asserts no credential exists rather than creating one.
  assert.ok(INTEGRATION.includes('RequestTrackingRepository'));
  assert.ok(!INTEGRATION.includes('requester-tracking/issue'));
  assert.ok(!INTEGRATION.includes("insertInto('request_tracking_credential"));
});

void test('F067 the migration runner issues no credential and bypasses no guard', () => {
  for (const text of [RUNNER, CLI])
    for (const forbidden of [
      'request_tracking_credential',
      'credential_digest',
      'StaffAccessGuard',
      'jwtVerify',
      'Bearer ',
      'entra_object_id',
      'REQRO_ENABLE_REQUESTER_INTAKE_TRACKING',
    ])
      assert.ok(!text.includes(forbidden), forbidden);
});
