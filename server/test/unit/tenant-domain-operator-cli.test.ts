import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  assertConnectionIdentity,
  assertOperatorIdentityScheme,
  assertRuntimeMatchesTarget,
  operatorEnvironments,
  operatorFailure,
  operatorFailureCodes,
  OperatorRefusal,
  resolveOperatorTarget,
} from '../../src/config/operator-environment.js';

/** ADR-027 F060.3C-2b. The production operator gates, proven without a
 * database: every refusal below happens before a connection is opened. */
const ORGANIZATION = '10000000-0000-4000-8000-000000000001';
const CORRELATION = '20000000-0000-4000-8000-000000000002';
const REASON = 'Planned onboarding for the approved resident hostname';

const production = {
  REQRO_OPERATOR_ENVIRONMENT: 'production',
  REQRO_DEPLOYMENT_ENVIRONMENT: 'production',
  REQRO_OPERATOR_DATABASE: 'reqro_client_prod',
  REQRO_OPERATOR_DATABASE_USER: 'reqro_operator',
};

const testTarget = {
  REQRO_OPERATOR_ENVIRONMENT: 'test',
  REQRO_DEPLOYMENT_ENVIRONMENT: 'test',
  REQRO_OPERATOR_DATABASE: 'reqro_f0592_test',
  REQRO_OPERATOR_DATABASE_USER: 'reqro_test_user',
};

function refusalCode(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof OperatorRefusal, 'expected an OperatorRefusal');
    return error.code;
  }
  return assert.fail('expected a refusal');
}

test('the production target surface excludes development', () => {
  assert.deepEqual(operatorEnvironments, ['test', 'staging', 'production']);
  // The development CLI owns development and keeps its own local pin, so the
  // production entry point must never accept it as a target.
  assert.equal(
    refusalCode(() =>
      resolveOperatorTarget({
        ...production,
        REQRO_OPERATOR_ENVIRONMENT: 'development',
        REQRO_DEPLOYMENT_ENVIRONMENT: 'development',
      }),
    ),
    'environment_mismatch',
  );
});

test('an absent, unknown or mismatched target is refused', () => {
  for (const override of [
    { REQRO_OPERATOR_ENVIRONMENT: '' },
    { REQRO_OPERATOR_ENVIRONMENT: '  ' },
    { REQRO_OPERATOR_ENVIRONMENT: 'prod' },
    { REQRO_OPERATOR_ENVIRONMENT: 'PRODUCTION' },
    { REQRO_DEPLOYMENT_ENVIRONMENT: '' },
  ])
    assert.equal(
      refusalCode(() => resolveOperatorTarget({ ...production, ...override })),
      'environment_mismatch',
      JSON.stringify(override),
    );
});

test('the operator target must equal the infrastructure deployment marker', () => {
  // NODE_ENV cannot separate staging from production, so this equality is the
  // control that stops a staging command reaching production.
  assert.equal(
    refusalCode(() =>
      resolveOperatorTarget({
        ...production,
        REQRO_OPERATOR_ENVIRONMENT: 'staging',
      }),
    ),
    'environment_mismatch',
  );
  assert.equal(
    refusalCode(() =>
      resolveOperatorTarget({
        ...production,
        REQRO_DEPLOYMENT_ENVIRONMENT: 'staging',
      }),
    ),
    'environment_mismatch',
  );
});

test('a serving target refuses a development or test database and role', () => {
  for (const override of [
    { REQRO_OPERATOR_DATABASE: 'reqro_dev' },
    { REQRO_OPERATOR_DATABASE: 'reqro_f0592_test' },
    { REQRO_OPERATOR_DATABASE: 'client_dev_main' },
    { REQRO_OPERATOR_DATABASE_USER: 'reqro_dev_user' },
    { REQRO_OPERATOR_DATABASE_USER: 'reqro_test_user' },
    // Not a plain identifier, so it can never be a quoted or injected name.
    { REQRO_OPERATOR_DATABASE: 'reqro prod' },
    { REQRO_OPERATOR_DATABASE: 'reqro-prod' },
    { REQRO_OPERATOR_DATABASE_USER: 'Reqro_Operator' },
  ])
    assert.equal(
      refusalCode(() => resolveOperatorTarget({ ...production, ...override })),
      'database_mismatch',
      JSON.stringify(override),
    );
});

test('the gated test target may only reach a test database', () => {
  const resolved = resolveOperatorTarget(testTarget);
  assert.equal(resolved.environment, 'test');
  assert.equal(resolved.serving, false);
  assert.equal(
    refusalCode(() =>
      resolveOperatorTarget({
        ...testTarget,
        REQRO_OPERATOR_DATABASE: 'reqro_client_prod',
      }),
    ),
    'database_mismatch',
  );
});

test('a serving target requires production, a client profile and registry resolution', () => {
  const target = resolveOperatorTarget(production);
  assert.equal(target.serving, true);
  assert.doesNotThrow(() => {
    assertRuntimeMatchesTarget(target, {
      nodeEnvironment: 'production',
      deploymentProfile: 'client',
      tenantResolutionStrategy: 'registry',
    });
  });
  for (const runtime of [
    {
      nodeEnvironment: 'development',
      deploymentProfile: 'client',
      tenantResolutionStrategy: 'registry',
    },
    {
      nodeEnvironment: 'production',
      deploymentProfile: 'development',
      tenantResolutionStrategy: 'registry',
    },
    // A deployment that resolves tenants by configured development
    // Organization must not have hostnames registered or activated in it.
    {
      nodeEnvironment: 'production',
      deploymentProfile: 'client',
      tenantResolutionStrategy: 'development',
    },
  ])
    assert.equal(
      refusalCode(() => {
        assertRuntimeMatchesTarget(target, runtime);
      }),
      'environment_mismatch',
      JSON.stringify(runtime),
    );
});

test('the connection identity must be the declared database and role', () => {
  const target = resolveOperatorTarget(production);
  assert.doesNotThrow(() => {
    assertConnectionIdentity(target, {
      database: 'reqro_client_prod',
      user: 'reqro_operator',
      serverAddress: '10.4.1.9',
    });
  });
  for (const identity of [
    {
      database: 'reqro_other_prod',
      user: 'reqro_operator',
      serverAddress: '10.4.1.9',
    },
    {
      database: 'reqro_client_prod',
      user: 'reqro_dev_user',
      serverAddress: '10.4.1.9',
    },
    // A serving environment must not be pointed at a local database.
    {
      database: 'reqro_client_prod',
      user: 'reqro_operator',
      serverAddress: '127.0.0.1',
    },
    {
      database: 'reqro_client_prod',
      user: 'reqro_operator',
      serverAddress: '::1',
    },
  ])
    assert.equal(
      refusalCode(() => {
        assertConnectionIdentity(target, identity);
      }),
      'database_mismatch',
      JSON.stringify(identity),
    );
  // A null address means a local socket and is not safely distinguishable, so
  // it is deliberately not treated as evidence either way.
  assert.doesNotThrow(() => {
    assertConnectionIdentity(target, {
      database: 'reqro_client_prod',
      user: 'reqro_operator',
      serverAddress: null,
    });
  });
});

test('a serving environment refuses a development operator identity', () => {
  const serving = resolveOperatorTarget(production);
  const gated = resolveOperatorTarget(testTarget);
  assert.equal(
    refusalCode(() => {
      assertOperatorIdentityScheme(serving, 'dev:synthetic-operator');
    }),
    'attribution_invalid',
  );
  // Migration 47 accepts dev: so local evidence is self-labelling; the gated
  // test target may therefore still use it.
  assert.doesNotThrow(() => {
    assertOperatorIdentityScheme(gated, 'dev:synthetic-operator');
  });
  for (const identity of ['iam:user/alex', 'oidc:alex.taylor@example.gov'])
    assert.doesNotThrow(() => {
      assertOperatorIdentityScheme(serving, identity);
    }, identity);
  for (const identity of ['alex', 'entra:user/alex', ':alex', ''])
    assert.equal(
      refusalCode(() => {
        assertOperatorIdentityScheme(serving, identity);
      }),
      'attribution_invalid',
      JSON.stringify(identity),
    );
});

test('the failure line carries a closed code and no error detail', () => {
  const emitted = operatorFailure(
    new OperatorRefusal('approval_expired', 'the approval has expired'),
    'database_unavailable',
  );
  const parsed = JSON.parse(emitted) as Record<string, unknown>;
  assert.equal(parsed.code, 'approval_expired');
  assert.ok(
    (operatorFailureCodes as readonly string[]).includes('approval_expired'),
  );
  // The message must never survive into the output.
  assert.doesNotMatch(emitted, /has expired/);
  assert.doesNotMatch(emitted, /select |insert |update |postgres/i);
  // An unclassified error takes the caller's fallback, not a misleading code.
  assert.equal(
    (
      JSON.parse(
        operatorFailure(
          new Error('relation "x" does not exist'),
          'database_unavailable',
        ),
      ) as Record<string, unknown>
    ).code,
    'database_unavailable',
  );
  assert.doesNotMatch(
    operatorFailure(
      new Error('password authentication failed for user "x"'),
      'database_unavailable',
    ),
    /password|authentication failed|user "x"/,
  );
});

/** Source assertions over the production entry point. These guard the
 * structural absences, which no runtime test can prove. */
const cli = readFileSync(
  resolve(__dirname, '../../../src/database/tenant-domain-operator-cli.ts'),
  'utf8',
);

/** Comments are prose and must not satisfy or trip a structural assertion:
 * the forbidden-token scan is about what the code can reach, and the file's
 * own documentation naturally names the things it excludes. */
const cliCode = cli
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Identifier-only view: string literals are stripped too, so the usage text
 * can name the options it refuses without tripping a scan for code that
 * would implement them. */
const cliIdentifiers = cliCode.replace(/'(?:[^'\\]|\\.)*'/g, "''");

test('the production verb surface is exactly the approved set', () => {
  const declared = /const OPERATIONS = \[([\s\S]*?)\] as const;/.exec(cli);
  const block = declared?.[1];
  assert.ok(block);
  assert.deepEqual(
    [...block.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]),
    [
      'register',
      'issue-challenge',
      'verify',
      'activate',
      'deactivate',
      'revoke',
      'approve',
    ],
  );
});

test('there is no discovery, onboarding, raw-SQL or database-url surface', () => {
  for (const forbidden of [
    // No listing or discovery capability: the hostname namespace is global,
    // so the command must never become a cross-tenant browsing tool. The
    // exact verb surface is asserted separately.
    'listTenantDomains',
    'discover',
    // No aggregate capability that could take a hostname live in one step.
    'onboard',
    // No raw statement path and no connection override.
    'executeQuery',
    'sql.raw',
    'databaseUrl',
    'connectionString',
  ])
    assert.ok(
      !cliIdentifiers.includes(forbidden),
      `the production operator command must not contain ${forbidden}`,
    );
  // The connection comes only from the validated environment, never from
  // arguments: argv is read solely for the verb, the approved operation and
  // the mode.
  assert.deepEqual(
    [
      ...new Set(
        [...cliCode.matchAll(/process\.argv[^\n]*/g)].map((m) => m[0]),
      ),
    ],
    ['process.argv.slice(2);'],
  );
  assert.deepEqual(
    [
      ...new Set(
        [...cliCode.matchAll(/environment\.DATABASE_[A-Z_]+/g)].map(
          (m) => m[0],
        ),
      ),
    ].sort(),
    [
      'environment.DATABASE_CONNECTION_TIMEOUT_MS',
      'environment.DATABASE_SSL_CA_FILE',
      'environment.DATABASE_SSL_MODE',
      'environment.DATABASE_STATEMENT_TIMEOUT_MS',
      'environment.DATABASE_URL',
    ],
  );
  assert.ok(!/args\.(find|filter|some|map|reduce)/.test(cliCode));
  // Its only raw SQL is the pre-mutation connection identity assertion.
  assert.deepEqual(
    [...cliCode.matchAll(/sql<[^>]*>`([\s\S]*?)`/g)].map((match) =>
      (match[1] ?? '').replace(/\s+/g, ' ').trim(),
    ),
    [
      'select current_database() as database, current_user as user, inet_server_addr()::text as address',
    ],
  );
});

test('the direct import allowlist excludes all application data', () => {
  const imports = [
    ...new Set([...cli.matchAll(/from '([^']+)'/g)].map((m) => m[1])),
  ].sort();
  assert.deepEqual(imports, [
    '../config/database-tls.js',
    '../config/environment.js',
    '../config/operator-environment.js',
    '../tenancy/tenant-domain-challenge.js',
    '../tenancy/tenant-domain-verifier.js',
    '../tenancy/tenant-domain.js',
    '../tenancy/tenant-domain.operations.js',
    './database.types.js',
    'kysely',
    'pg',
  ]);
  for (const forbidden of [
    'service-request',
    'attachment',
    'requester',
    'tracking',
    'resident-experience',
    'access/',
    'notification',
    '/ai/',
    '@nestjs',
    'controller',
    '.module',
  ])
    assert.ok(
      !imports.some((path) => path.includes(forbidden)),
      `the production operator command must not import ${forbidden}`,
    );
});

test('the operator-target module reaches no tables of its own', () => {
  const module = readFileSync(
    resolve(__dirname, '../../../src/config/operator-environment.ts'),
    'utf8',
  );
  for (const forbidden of [
    'selectFrom',
    'insertInto',
    'updateTable',
    'deleteFrom',
    'sql`',
  ])
    assert.ok(
      !module.includes(forbidden),
      `the operator target model must not query: ${forbidden}`,
    );
});

/** Spawns the compiled production command. Every case below refuses before a
 * database connection is opened, so these stay pure unit tests. */
function invoke(
  args: readonly string[],
  environment: Record<string, string>,
): { code: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    [
      resolve(__dirname, '../../src/database/tenant-domain-operator-cli.js'),
      ...args,
    ],
    {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        SystemRoot: process.env.SystemRoot ?? '',
        NODE_ENV: 'production',
        CITYVUE_DEPLOYMENT_PROFILE: 'client',
        DATABASE_URL:
          'postgresql://operator:placeholder@db.example.test:5432/reqro_client_prod',
        DATABASE_SSL_MODE: 'verify-full',
        TENANT_RESOLUTION_STRATEGY: 'registry',
        ...production,
        ...environment,
      },
    },
  );
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

const attribution = {
  REQRO_OPERATOR_IDENTITY: 'iam:user/alex',
  REQRO_OPERATOR_REASON: REASON,
  REQRO_OPERATOR_CORRELATION_ID: CORRELATION,
  REQRO_OPERATOR_ORGANIZATION_ID: ORGANIZATION,
  REQRO_OPERATOR_HOSTNAME: 'requests.example.gov',
  REQRO_OPERATOR_EXPECTED_REVISION: '3',
};

function invokedCode(
  args: readonly string[],
  environment: Record<string, string>,
): string {
  const result = invoke(args, environment);
  assert.equal(result.code, 1, result.stderr);
  const parsed = JSON.parse(result.stderr.trim()) as Record<string, unknown>;
  return String(parsed.code);
}

test('an unknown or absent verb and mode is refused', () => {
  for (const args of [
    [],
    ['list'],
    ['onboard', '--confirm'],
    ['activate'],
    ['activate', '--force'],
  ])
    assert.equal(
      invokedCode(args, attribution),
      'operation_invalid',
      JSON.stringify(args),
    );
});

test('each attribution field is individually required', () => {
  for (const key of [
    'REQRO_OPERATOR_IDENTITY',
    'REQRO_OPERATOR_REASON',
    'REQRO_OPERATOR_CORRELATION_ID',
  ])
    assert.equal(
      invokedCode(['deactivate', '--dry-run'], { ...attribution, [key]: '' }),
      'attribution_invalid',
      key,
    );
  for (const key of [
    'REQRO_OPERATOR_ORGANIZATION_ID',
    'REQRO_OPERATOR_HOSTNAME',
  ])
    assert.equal(
      invokedCode(['deactivate', '--dry-run'], { ...attribution, [key]: '' }),
      'operation_invalid',
      key,
    );
  assert.equal(
    invokedCode(['deactivate', '--dry-run'], {
      ...attribution,
      REQRO_OPERATOR_EXPECTED_REVISION: '',
    }),
    'revision_stale',
  );
});

test('a development identity is refused in a serving environment', () => {
  assert.equal(
    invokedCode(['deactivate', '--dry-run'], {
      ...attribution,
      REQRO_OPERATOR_IDENTITY: 'dev:synthetic-operator',
    }),
    'attribution_invalid',
  );
});

test('an approval-required confirm demands an approval; a dry run does not', () => {
  for (const verb of ['activate', 'revoke']) {
    // Committing without an approval is refused before any database work.
    assert.equal(
      invokedCode([verb, '--confirm'], attribution),
      'approval_missing',
      `${verb} --confirm`,
    );
    // A dry run without one is a supported pre-approval plan, so it passes
    // input validation and fails later, on the unreachable database.
    assert.equal(
      invokedCode([verb, '--dry-run'], attribution),
      'database_unavailable',
      `${verb} --dry-run`,
    );
  }
});

test('the approval identifier is accepted only when consuming an approval', () => {
  for (const verb of ['register', 'issue-challenge', 'verify', 'deactivate'])
    assert.equal(
      invokedCode([verb, '--dry-run'], {
        ...attribution,
        REQRO_OPERATOR_ROLE: 'public_alias',
        REQRO_OPERATOR_APPROVAL_ID: CORRELATION,
      }),
      'operation_invalid',
      verb,
    );
});

test('the requester identity is accepted only when recording an approval', () => {
  for (const verb of ['register', 'verify', 'activate', 'deactivate', 'revoke'])
    assert.equal(
      invokedCode([verb, '--dry-run'], {
        ...attribution,
        REQRO_OPERATOR_ROLE: 'public_alias',
        REQRO_OPERATOR_REQUESTER_IDENTITY: 'iam:user/sam',
      }),
      'operation_invalid',
      verb,
    );
});

test('approve names the operation it authorizes and has no dry run', () => {
  for (const args of [
    ['approve', '--confirm'],
    ['approve', 'register', '--confirm'],
    ['approve', 'activate', '--dry-run'],
    ['approve', 'activate'],
  ])
    assert.equal(
      invokedCode(args, {
        ...attribution,
        REQRO_OPERATOR_REQUESTER_IDENTITY: 'iam:user/sam',
      }),
      'operation_invalid',
      JSON.stringify(args),
    );
});

test('the environment gates refuse before any database work', () => {
  assert.equal(
    invokedCode(['deactivate', '--dry-run'], {
      ...attribution,
      REQRO_OPERATOR_ENVIRONMENT: 'staging',
    }),
    'environment_mismatch',
  );
  assert.equal(
    invokedCode(['deactivate', '--dry-run'], {
      ...attribution,
      TENANT_RESOLUTION_STRATEGY: 'development',
      DEVELOPMENT_ORGANIZATION_ID: ORGANIZATION,
    }),
    'environment_mismatch',
  );
  assert.equal(
    invokedCode(['deactivate', '--dry-run'], {
      ...attribution,
      REQRO_OPERATOR_DATABASE: 'reqro_dev',
    }),
    'database_mismatch',
  );
});

test('the help text names no credential and the command never echoes one', () => {
  const help = invoke(['--help'], attribution);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /REQRO_OPERATOR_ENVIRONMENT/);
  // The help states the option does not exist, which is useful; what it must
  // never carry is a credential or a connection string.
  assert.match(help.stdout, /no --database-url option/);
  assert.doesNotMatch(help.stdout, /placeholder|password|postgresql:\/\//);
  // A refusal path must not echo the configured connection string either.
  const refused = invoke(['list'], attribution);
  for (const output of [refused.stdout, refused.stderr]) {
    assert.doesNotMatch(output, /placeholder/);
    assert.doesNotMatch(output, /db\.example\.test/);
    assert.doesNotMatch(output, /postgresql:\/\//);
  }
});
