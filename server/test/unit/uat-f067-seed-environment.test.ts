import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { commandFailure } from '../../src/common/logging/log-sanitization.js';
import { validateEnvironment } from '../../src/config/environment.js';

/**
 * F067 — the disposable development seed's configuration and diagnostics.
 *
 * The live run applied all sixty migrations and then lost the session at
 * `seed:development failed with status 1`. Offline, the cause reproduced: the
 * seed validates its own environment, the default tenant strategy is
 * `development`, and that strategy requires an explicit
 * `DEVELOPMENT_ORGANIZATION_ID` the harness never supplied.
 *
 * Nothing here contacts PostgreSQL, Docker or the network, and no process is
 * spawned: the subprocess runner is a recorder, and configuration is checked
 * with the real `validateEnvironment` against a synthetic URL it never dials.
 */

interface SeedEnvironment {
  ok: boolean;
  reasons: string[];
  env: Record<string, string> | null;
}
interface SubprocessVerdict {
  ok: boolean;
  kind: string;
  status?: number | null;
  message?: string;
}
interface CoreModule {
  UAT_DEVELOPMENT_ORGANIZATION_ID: string;
  buildSeedEnvironment: (input: unknown) => SeedEnvironment;
  classifySubprocessFailure: (
    step: string,
    result: unknown,
  ) => SubprocessVerdict;
}
interface SpawnLike {
  status: number | null;
  signal?: string | null;
  stdout?: string;
  stderr?: string;
  error?: { code?: string; message?: string };
}
interface EffectsModule {
  SEED_SCRIPT: string;
  TRACKING_FIXTURE_SCRIPT: string;
  runFixtureSubprocesses: (input: {
    url: string;
    nonce: string;
    role: string;
    inherited: Record<string, string | undefined>;
    run: (script: string, env: Record<string, string>) => SpawnLike;
  }) => void;
}

const scripts = resolve(__dirname, '../../../scripts');
const core = async () =>
  (await import(
    pathToFileURL(resolve(scripts, 'uat-f067-session-core.mjs')).href
  )) as CoreModule;
const effects = async () =>
  (await import(
    pathToFileURL(resolve(scripts, 'uat-f067-effects.mjs')).href
  )) as EffectsModule;

const ORGANIZATION = '10000000-0000-4000-8000-000000000001';
const PASSWORD = 'Synth3ticS3cret';
/** A synthetic disposable target. It is parsed, never connected to. */
const URL_STRING = `postgresql://reqro_test_user:${PASSWORD}@127.0.0.1:64471/reqro_f0592_test`;
const NONCE = 'a1'.repeat(16);
const ROLE = 'reqro_test_user';

const ok = (): SpawnLike => ({
  status: 0,
  signal: null,
  stdout: '',
  stderr: '',
});

function recorder(results: Record<string, SpawnLike> = {}) {
  const calls: { script: string; env: Record<string, string> }[] = [];
  return {
    calls,
    run: (script: string, env: Record<string, string>) => {
      calls.push({ script, env });
      return results[script] ?? ok();
    },
  };
}

// --- the proven failure mechanism ------------------------------------------

void test('F067 seed: the configuration the harness used to pass fails validation', () => {
  // Exactly what the old harness added to an environment with no tenant keys.
  assert.throws(
    () =>
      validateEnvironment({
        DATABASE_URL: URL_STRING,
        TEST_DATABASE_URL: URL_STRING,
      }),
    /development Organization resolution requires an explicit DEVELOPMENT_ORGANIZATION_ID/,
  );
});

void test('F067 seed: the built environment passes the real validateEnvironment', async () => {
  const { buildSeedEnvironment, UAT_DEVELOPMENT_ORGANIZATION_ID } =
    await core();
  assert.equal(UAT_DEVELOPMENT_ORGANIZATION_ID, ORGANIZATION);
  const built = buildSeedEnvironment({ url: URL_STRING, inherited: {} });
  assert.equal(built.ok, true, built.reasons.join('; '));
  assert.ok(built.env);
  const environment = validateEnvironment(built.env);
  assert.equal(environment.DEVELOPMENT_ORGANIZATION_ID, ORGANIZATION);
  assert.equal(environment.TENANT_RESOLUTION_STRATEGY, 'development');
  assert.equal(environment.CITYVUE_DEPLOYMENT_PROFILE, 'development');
  assert.equal(environment.NODE_ENV, 'development');
  assert.equal(environment.DATABASE_URL, URL_STRING);
});

void test('F067 seed: removing any tenant setting reproduces a validation failure', async () => {
  const { buildSeedEnvironment } = await core();
  const built = buildSeedEnvironment({ url: URL_STRING, inherited: {} });
  assert.ok(built.env);
  const { DEVELOPMENT_ORGANIZATION_ID: _omitted, ...withoutOrganization } =
    built.env;
  void _omitted;
  assert.throws(
    () => validateEnvironment(withoutOrganization),
    /requires an explicit DEVELOPMENT_ORGANIZATION_ID/,
  );
  // An Organization that is not a v4 UUID is refused, not coerced.
  for (const invalid of ['not-a-uuid', '10000000-0000-1000-8000-000000000001'])
    assert.throws(
      () =>
        validateEnvironment({
          ...built.env,
          DEVELOPMENT_ORGANIZATION_ID: invalid,
        }),
      /Invalid server configuration/,
    );
  // And a registry strategy cannot be combined with it.
  assert.throws(
    () =>
      validateEnvironment({
        ...built.env,
        TENANT_RESOLUTION_STRATEGY: 'registry',
      }),
    /registry tenant resolution cannot be combined with DEVELOPMENT_ORGANIZATION_ID/,
  );
});

// --- isolation of the seed's target and tenant ------------------------------

void test('F067 seed: the database URL is exactly the session-owned disposable URL', async () => {
  const { buildSeedEnvironment } = await core();
  const built = buildSeedEnvironment({ url: URL_STRING, inherited: {} });
  assert.ok(built.env);
  assert.equal(built.env.DATABASE_URL, URL_STRING);
  assert.equal(built.env.TEST_DATABASE_URL, URL_STRING);
  // Only the settings it needs: no inherited value is copied into it.
  assert.deepEqual(Object.keys(built.env).sort(), [
    'CITYVUE_DEPLOYMENT_PROFILE',
    'DATABASE_URL',
    'DEVELOPMENT_ORGANIZATION_ID',
    'NODE_ENV',
    'REQRO_ENABLE_REQUESTER_INTAKE_TRACKING',
    'TENANT_RESOLUTION_STRATEGY',
    'TEST_DATABASE_URL',
  ]);
});

void test('F067 seed: port 5432, reqro_dev and any non-disposable target are refused', async () => {
  const { buildSeedEnvironment } = await core();
  const cases: [string, RegExp][] = [
    [`postgresql://u:${PASSWORD}@127.0.0.1:5432/reqro_f0592_test`, /port 5432/],
    [
      `postgresql://u:${PASSWORD}@127.0.0.1:64471/reqro_dev`,
      /persistent database reqro_dev/,
    ],
    [
      `postgresql://u:${PASSWORD}@localhost:5432/reqro_dev`,
      /host must be 127\.0\.0\.1/,
    ],
    [
      `postgresql://u:${PASSWORD}@10.0.0.5:64471/reqro_f0592_test`,
      /host must be 127\.0\.0\.1/,
    ],
    [
      `postgresql://u:${PASSWORD}@127.0.0.1:64471/other`,
      /must be reqro_f0592_test/,
    ],
    [
      `postgresql://u:${PASSWORD}@127.0.0.1:64471/reqro_f0592_test?host=/tmp`,
      /unexpected parameters/,
    ],
    [
      `mysql://u:${PASSWORD}@127.0.0.1:64471/reqro_f0592_test`,
      /not a PostgreSQL URL/,
    ],
    ['not a url', /not a valid URL/],
  ];
  for (const [url, reason] of cases) {
    const built = buildSeedEnvironment({ url, inherited: {} });
    assert.equal(built.ok, false, url);
    assert.equal(built.env, null);
    assert.ok(
      built.reasons.some((r) => reason.test(r)),
      `${url}: ${built.reasons.join('; ')}`,
    );
    // A refusal never echoes the password it was handed.
    assert.equal(built.reasons.join(' ').includes(PASSWORD), false);
  }
});

void test('F067 seed: a conflicting inherited tenant setting refuses rather than redirecting', async () => {
  const { buildSeedEnvironment } = await core();
  const conflicts: Record<string, string> = {
    DEVELOPMENT_ORGANIZATION_ID: '20000000-0000-4000-8000-000000000002',
    TENANT_RESOLUTION_STRATEGY: 'registry',
    CITYVUE_DEPLOYMENT_PROFILE: 'client',
    NODE_ENV: 'production',
    REQRO_ENABLE_REQUESTER_INTAKE_TRACKING: 'true',
  };
  for (const [key, value] of Object.entries(conflicts)) {
    const built = buildSeedEnvironment({
      url: URL_STRING,
      inherited: { [key]: value },
    });
    assert.equal(built.ok, false, key);
    assert.equal(built.env, null);
    assert.ok(
      built.reasons.some((r) => r.includes(`inherited ${key} conflicts`)),
      key,
    );
    // The conflicting value is not repeated back.
    assert.equal(built.reasons.join(' ').includes(value), false, key);
  }
  // An inherited value that already agrees is not a conflict.
  const agreeing = buildSeedEnvironment({
    url: URL_STRING,
    inherited: {
      DEVELOPMENT_ORGANIZATION_ID: ORGANIZATION,
      NODE_ENV: 'development',
    },
  });
  assert.equal(agreeing.ok, true);
});

void test('F067 seed: F065 issuance is stated OFF and no identity setting is supplied', async () => {
  const { buildSeedEnvironment } = await core();
  const built = buildSeedEnvironment({ url: URL_STRING, inherited: {} });
  assert.ok(built.env);
  assert.equal(built.env.REQRO_ENABLE_REQUESTER_INTAKE_TRACKING, 'false');
  assert.equal(
    validateEnvironment(built.env).REQRO_ENABLE_REQUESTER_INTAKE_TRACKING,
    false,
  );
  // No Entra, external-identity or development-bypass setting is introduced.
  for (const key of Object.keys(built.env))
    assert.equal(
      /ENTRA|EXTERNAL_IDENTITY|AUTH|BYPASS|DEVELOPMENT_SERVICE_REQUEST_READS/.test(
        key,
      ),
      false,
      key,
    );
});

// --- subprocess ordering ------------------------------------------------------

void test('F067 seed: the seed receives the disposable settings and runs before the fixture', async () => {
  const { runFixtureSubprocesses, SEED_SCRIPT, TRACKING_FIXTURE_SCRIPT } =
    await effects();
  const r = recorder();
  runFixtureSubprocesses({
    url: URL_STRING,
    nonce: NONCE,
    role: ROLE,
    inherited: {},
    run: r.run,
  });
  assert.deepEqual(
    r.calls.map((c) => c.script),
    [SEED_SCRIPT, TRACKING_FIXTURE_SCRIPT],
  );
  const [seed, fixture] = r.calls;
  assert.ok(seed && fixture);
  assert.equal(seed.env.DEVELOPMENT_ORGANIZATION_ID, ORGANIZATION);
  assert.equal(seed.env.TENANT_RESOLUTION_STRATEGY, 'development');
  assert.equal(seed.env.DATABASE_URL, URL_STRING);
  assert.equal(fixture.env.DATABASE_URL, URL_STRING);
  assert.equal(fixture.env.REQRO_F067_UAT_DISPOSABLE_NONCE, NONCE);
  assert.equal(fixture.env.REQRO_F067_UAT_DISPOSABLE_ROLE, ROLE);
});

void test('F067 seed: a refused seed environment starts no subprocess at all', async () => {
  const { runFixtureSubprocesses } = await effects();
  const r = recorder();
  assert.throws(() => {
    runFixtureSubprocesses({
      url: URL_STRING,
      nonce: NONCE,
      role: ROLE,
      inherited: {
        DEVELOPMENT_ORGANIZATION_ID: '20000000-0000-4000-8000-000000000002',
      },
      run: r.run,
    });
  }, /seed:development was not started/);
  assert.equal(r.calls.length, 0);
});

void test('F067 seed: a failed seed prevents the tracking fixture from running', async () => {
  const { runFixtureSubprocesses, SEED_SCRIPT } = await effects();
  const failures: SpawnLike[] = [
    { status: 1, signal: null, stderr: '' },
    { status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT' } },
    { status: null, signal: null, error: { code: 'ENOENT' } },
    { status: null, signal: 'SIGKILL' },
  ];
  for (const failure of failures) {
    const r = recorder({ [SEED_SCRIPT]: failure });
    assert.throws(() => {
      runFixtureSubprocesses({
        url: URL_STRING,
        nonce: NONCE,
        role: ROLE,
        inherited: {},
        run: r.run,
      });
    }, /seed:development/);
    assert.deepEqual(
      r.calls.map((c) => c.script),
      [SEED_SCRIPT],
      JSON.stringify(failure),
    );
  }
});

void test('F067 seed: a failed tracking fixture is still a failure', async () => {
  const { runFixtureSubprocesses, TRACKING_FIXTURE_SCRIPT } = await effects();
  const r = recorder({ [TRACKING_FIXTURE_SCRIPT]: { status: 2, stderr: '' } });
  assert.throws(() => {
    runFixtureSubprocesses({
      url: URL_STRING,
      nonce: NONCE,
      role: ROLE,
      inherited: {},
      run: r.run,
    });
  }, /the F067 tracking fixture failed \(status 2/);
});

// --- sanitized diagnostics ------------------------------------------------------

void test('F067 seed: failures are classified and the exit status is preserved', async () => {
  const { classifySubprocessFailure } = await core();
  assert.deepEqual(classifySubprocessFailure('seed:development', ok()), {
    ok: true,
    kind: 'success',
  });
  const nonzero = classifySubprocessFailure('seed:development', {
    status: 1,
    stderr: '',
  });
  assert.equal(nonzero.ok, false);
  assert.equal(nonzero.kind, 'subprocess-failure');
  assert.equal(nonzero.status, 1);
  assert.match(nonzero.message ?? '', /status 1/);
  assert.match(nonzero.message ?? '', /no sanitized diagnostic/);

  const timeout = classifySubprocessFailure('seed:development', {
    status: null,
    signal: 'SIGTERM',
    error: { code: 'ETIMEDOUT', message: `connect ${URL_STRING}` },
  });
  assert.equal(timeout.kind, 'timeout');
  assert.match(
    timeout.message ?? '',
    /timed out and was terminated with SIGTERM/,
  );

  const spawn = classifySubprocessFailure('seed:development', {
    status: null,
    error: { code: 'ENOENT', message: `spawn ${URL_STRING}` },
  });
  assert.equal(spawn.kind, 'spawn-failure');
  assert.match(spawn.message ?? '', /could not be started \(ENOENT\)/);

  const killed = classifySubprocessFailure('seed:development', {
    status: null,
    signal: 'SIGKILL',
  });
  assert.equal(killed.kind, 'terminated');
  assert.match(killed.message ?? '', /SIGKILL/);

  for (const verdict of [nonzero, timeout, spawn, killed])
    assert.equal((verdict.message ?? '').includes(PASSWORD), false);
});

void test('F067 seed: the real configuration failure line is classified without leaking', async () => {
  const { classifySubprocessFailure } = await core();
  let error: unknown;
  try {
    validateEnvironment({ DATABASE_URL: URL_STRING });
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof Error);
  // The exact bytes the seed writes to stderr when it refuses.
  const stderr = commandFailure('Development seed failed', error);
  const verdict = classifySubprocessFailure('seed:development', {
    status: 1,
    stderr,
  });
  assert.equal(verdict.kind, 'configuration-invalid');
  assert.equal(verdict.status, 1);
  assert.match(
    verdict.message ?? '',
    /refused its configuration \(status 1, errorName=Error, errorCode=unknown\)/,
  );
  assert.match(verdict.message ?? '', /DEVELOPMENT_ORGANIZATION_ID/);
  assert.equal((verdict.message ?? '').includes(PASSWORD), false);
  assert.equal((verdict.message ?? '').includes('postgresql://'), false);
});

void test('F067 seed: raw stderr, URLs, SQL and tokens never reach the diagnostic', async () => {
  const { classifySubprocessFailure } = await core();
  const hostile = [
    `error: connect ${URL_STRING}`,
    "insert into staff_identity values ('secret-param')",
    'Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.payload.sig',
  ].join('\n');
  const cases = [
    // Unstructured output only.
    hostile,
    // A structured line whose fields are not the allowlisted shape.
    `${hostile}\n${JSON.stringify({ errorName: URL_STRING, errorCode: 'Bearer eyJ.x.y', classification: 'other' })}`,
    // A structured last line that is oversized.
    `${hostile}\n${JSON.stringify({ errorName: 'Error', pad: 'x'.repeat(5000) })}`,
    // A JSON value that is not an object.
    `${hostile}\n["${URL_STRING}"]`,
  ];
  for (const stderr of cases) {
    const verdict = classifySubprocessFailure('seed:development', {
      status: 1,
      stdout: hostile,
      stderr,
    });
    assert.equal(verdict.kind, 'subprocess-failure');
    const message = verdict.message ?? '';
    for (const leak of [
      PASSWORD,
      'postgresql://',
      'secret-param',
      'insert into',
      'Bearer',
      'eyJ',
    ])
      assert.equal(message.includes(leak), false, `${leak} in ${message}`);
  }
  // A well-formed PostgreSQL error code survives, because it is safe to show.
  const coded = classifySubprocessFailure('seed:development', {
    status: 1,
    stderr: `${hostile}\n${JSON.stringify({ errorName: 'DatabaseError', errorCode: '42501' })}`,
  });
  assert.match(coded.message ?? '', /errorName=DatabaseError, errorCode=42501/);
});
