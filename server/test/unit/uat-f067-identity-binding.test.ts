import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  BINDING_TARGET,
  canonicalGuid,
  evaluateBindingIdentity,
  executeIdentityBinding,
  maskGuid,
  planIdentityBinding,
  type BindingIdentity,
  type BindingSnapshot,
  type BindingStore,
  type GuardedState,
} from '../../src/database/uat-f067-identity-binding.js';
import {
  FIXTURE_DATABASE,
  FIXTURE_PERMISSIONS,
  trackingUatFixture,
  type FixtureTargetFacts,
} from '../../src/database/uat-f067-tracking-fixture.js';

/**
 * F067 — guarded disposable staff identity binding, proven offline.
 *
 * Every identifier below is fictional. The store is a test double that counts
 * writes, so each refusal path is shown to write nothing. Nothing here
 * contacts PostgreSQL, Docker, Entra or the network, and no token exists.
 */

const SERVER_ROOT = resolve(__dirname, '../../..');
const source = (relative: string): string =>
  readFileSync(resolve(SERVER_ROOT, relative), 'utf8');
const BINDING_SOURCE = source('src/database/uat-f067-identity-binding.ts');
const CLI_SOURCE = source('src/database/uat-f067-identity-binding-cli.ts');

const TENANT = '11111111-2222-4333-8444-555555555555';
const OBJECT = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const OTHER_OBJECT = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const NONCE = 'd3f4a1b2c3d4e5f60718293a4b5c6d7e';
const ROLE = 'reqro_test_user';
const URL_OK = `postgresql://${ROLE}:secret@127.0.0.1:49231/${FIXTURE_DATABASE}`;
const DEPARTMENT = '20000000-0000-4000-8000-000000000001';
const MIGRATIONS = ['20260902000000-a', '20261031000000-b'];
const IDENTITY: BindingIdentity = { tenantId: TENANT, objectId: OBJECT };

const target = (
  overrides: Partial<FixtureTargetFacts> = {},
): FixtureTargetFacts => ({
  url: URL_OK,
  sqlDatabase: FIXTURE_DATABASE,
  sqlUser: ROLE,
  sqlNonce: NONCE,
  expectedNonce: NONCE,
  expectedRole: ROLE,
  ...overrides,
});

const ready: BindingSnapshot = {
  staffPresent: true,
  staffActive: true,
  staffOrganizationId: BINDING_TARGET.organizationId,
  organizationActive: true,
  boundTenantId: null,
  boundObjectId: null,
  assignmentActive: true,
  effectivePermissions: [...FIXTURE_PERMISSIONS],
  requestDepartmentIds: [DEPARTMENT],
  activeDepartmentIds: [DEPARTMENT],
  otherMemberships: 0,
  pairBoundElsewhere: 0,
  appliedMigrations: [...MIGRATIONS],
};

const guarded: GuardedState = {
  staffRow: '{"a":true}',
  roleAssignments: 3,
  rolePermissions: 14,
  departmentMemberships: 3,
  divisionMemberships: 2,
  trackingCredentials: 0,
  boundStaff: 0,
};

/** A store double. Only `bind` writes, and every call is counted. */
function store(
  options: {
    target?: Partial<FixtureTargetFacts>;
    snapshot?: Partial<BindingSnapshot>;
    updated?: number;
    afterGuarded?: Partial<GuardedState>;
    readBack?: Partial<BindingSnapshot>;
  } = {},
) {
  const calls: string[] = [];
  let bound = false;
  const double: BindingStore = {
    readTarget: () => {
      calls.push('readTarget');
      return Promise.resolve(target(options.target));
    },
    lock: () => {
      calls.push('lock');
      return Promise.resolve();
    },
    readSnapshot: () => {
      calls.push('readSnapshot');
      return Promise.resolve(
        bound
          ? {
              ...ready,
              boundTenantId: TENANT,
              boundObjectId: OBJECT,
              ...options.readBack,
            }
          : { ...ready, ...options.snapshot },
      );
    },
    readGuardedState: () => {
      calls.push('readGuardedState');
      return Promise.resolve(
        bound
          ? { ...guarded, boundStaff: 1, ...options.afterGuarded }
          : guarded,
      );
    },
    bind: () => {
      calls.push('bind');
      const updated = options.updated ?? 1;
      if (updated === 1) bound = true;
      return Promise.resolve(updated);
    },
  };
  return { double, calls, writes: () => calls.filter((c) => c === 'bind') };
}

const run = (
  double: BindingStore,
  overrides: Partial<Parameters<typeof executeIdentityBinding>[1]> = {},
) =>
  executeIdentityBinding(double, {
    mode: 'confirm',
    tenantId: TENANT,
    objectId: OBJECT,
    expectedTenantId: TENANT,
    expectedMigrations: MIGRATIONS,
    ...overrides,
  });

// --- target and identity --------------------------------------------------------

void test('F067 bind: the only target is the fixture staff identity in the fixture Organization', () => {
  assert.equal(BINDING_TARGET.staffId, trackingUatFixture.staffId);
  assert.equal(
    BINDING_TARGET.organizationId,
    trackingUatFixture.organizationId,
  );
  assert.equal(BINDING_TARGET.staffId, '90000000-0000-4000-8000-000000000067');
  assert.equal(
    BINDING_TARGET.organizationId,
    '10000000-0000-4000-8000-000000000001',
  );
});

void test('F067 bind: a correct identity is accepted and canonicalised', () => {
  const verdict = evaluateBindingIdentity({
    tenantId: TENANT.toUpperCase(),
    objectId: OBJECT,
    expectedTenantId: TENANT,
  });
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.identity, IDENTITY);
  assert.equal(canonicalGuid(` ${TENANT}`), null);
  assert.equal(canonicalGuid(`{${TENANT}}`), null);
  assert.equal(canonicalGuid('00000000-0000-0000-0000-000000000000'), null);
});

void test('F067 bind: a missing, malformed or mismatched identity is refused without echoing it', () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ tenantId: undefined }, /tenant ID is missing/],
    [{ objectId: undefined }, /object ID is missing/],
    [{ objectId: 'not-a-guid' }, /object ID is missing or not a GUID/],
    [{ objectId: 'user@example.test' }, /object ID is missing or not a GUID/],
    [{ tenantId: OTHER_OBJECT }, /does not match the tenant the API/],
    [{ expectedTenantId: undefined }, /configured Entra tenant is missing/],
    [{ objectId: TENANT }, /cannot equal the tenant ID/],
  ];
  for (const [override, reason] of cases) {
    const verdict = evaluateBindingIdentity({
      tenantId: TENANT,
      objectId: OBJECT,
      expectedTenantId: TENANT,
      ...override,
    });
    assert.equal(verdict.ok, false, JSON.stringify(override));
    assert.equal(verdict.identity, null);
    assert.ok(
      verdict.reasons.some((r) => reason.test(r)),
      verdict.reasons.join('; '),
    );
    for (const value of [TENANT, OBJECT, OTHER_OBJECT, 'user@example.test'])
      assert.equal(verdict.reasons.join(' ').includes(value), false);
  }
});

void test('F067 bind: identifiers are masked in every report', () => {
  assert.equal(maskGuid(OBJECT), '6666…aaaa');
  assert.equal(maskGuid(null), '(none)');
});

// --- the plan ---------------------------------------------------------------------

void test('F067 bind: an unbound, exactly-scoped fixture identity plans a bind', () => {
  assert.deepEqual(planIdentityBinding(ready, IDENTITY, MIGRATIONS), {
    ok: true,
    reasons: [],
    action: 'bind',
  });
});

void test('F067 bind: an identical existing binding is already bound, never rebound', () => {
  const plan = planIdentityBinding(
    { ...ready, boundTenantId: TENANT, boundObjectId: OBJECT },
    IDENTITY,
    MIGRATIONS,
  );
  assert.deepEqual(plan, { ok: true, reasons: [], action: 'already-bound' });
});

void test('F067 bind: every unfit target refuses with a reason and plans nothing', () => {
  const cases: [Partial<BindingSnapshot>, RegExp][] = [
    [{ staffPresent: false }, /does not exist/],
    [{ staffActive: false }, /is not active/],
    [
      { staffOrganizationId: '10000000-0000-4000-8000-000000000002' },
      /does not belong to the fixture Organization/,
    ],
    [{ organizationActive: false }, /Organization is not active/],
    [{ assignmentActive: false }, /role assignment or its role is not active/],
    [
      { effectivePermissions: ['service_request.tracking.manage'] },
      /does not effectively hold service_request\.view/,
    ],
    [
      { effectivePermissions: ['service_request.view'] },
      /does not effectively hold service_request\.tracking\.manage/,
    ],
    [
      {
        effectivePermissions: [
          ...FIXTURE_PERMISSIONS,
          'service_request.assign',
        ],
      },
      /outside the fixture grant/,
    ],
    [
      { activeDepartmentIds: [] },
      /active Department membership is not exactly/,
    ],
    [
      { activeDepartmentIds: ['20000000-0000-4000-8000-000000000003'] },
      /active Department membership is not exactly/,
    ],
    [
      {
        requestDepartmentIds: [
          DEPARTMENT,
          '20000000-0000-4000-8000-000000000003',
        ],
      },
      /exactly one Department/,
    ],
    [{ requestDepartmentIds: [] }, /exactly one Department/],
    [{ otherMemberships: 1 }, /broader than reviewed/],
    [{ appliedMigrations: MIGRATIONS.slice(1) }, /applied migrations/],
    [{ pairBoundElsewhere: 1 }, /already bound to another staff identity/],
    [
      { boundTenantId: TENANT, boundObjectId: OTHER_OBJECT },
      /already bound to a different Entra identity/,
    ],
    [
      { boundTenantId: TENANT, boundObjectId: null },
      /already bound to a different Entra identity/,
    ],
  ];
  for (const [override, reason] of cases) {
    const plan = planIdentityBinding(
      { ...ready, ...override },
      IDENTITY,
      MIGRATIONS,
    );
    assert.equal(plan.ok, false, JSON.stringify(override));
    assert.equal(plan.action, null);
    assert.ok(
      plan.reasons.some((r) => reason.test(r)),
      plan.reasons.join('; '),
    );
  }
  assert.equal(planIdentityBinding(ready, IDENTITY, []).ok, false);
  assert.equal(planIdentityBinding(null, IDENTITY, MIGRATIONS).ok, false);
});

// --- the executor: refusals write nothing ------------------------------------------

void test('F067 bind: a persistent, native-port or foreign-nonce target writes nothing', async () => {
  const targets: Partial<FixtureTargetFacts>[] = [
    { url: `postgresql://${ROLE}:s@127.0.0.1:49231/reqro_dev` },
    { url: `postgresql://${ROLE}:s@127.0.0.1:5432/${FIXTURE_DATABASE}` },
    { url: `postgresql://${ROLE}:s@10.0.0.5:49231/${FIXTURE_DATABASE}` },
    { sqlNonce: 'f'.repeat(32) },
    { sqlNonce: null },
    { expectedNonce: '' },
    { sqlDatabase: 'reqro_dev' },
    { sqlUser: 'reqro_dev_user' },
  ];
  for (const override of targets) {
    const { double, calls, writes } = store({ target: override });
    await assert.rejects(run(double), /Binding target refused/);
    assert.deepEqual(calls, ['readTarget'], JSON.stringify(override));
    assert.equal(writes().length, 0);
  }
});

void test('F067 bind: a refused identity takes no lock and writes nothing', async () => {
  for (const override of [
    { objectId: undefined },
    { tenantId: OTHER_OBJECT },
    { expectedTenantId: '' },
  ]) {
    const { double, calls, writes } = store();
    await assert.rejects(run(double, override), /Binding identity refused/);
    assert.deepEqual(calls, ['readTarget']);
    assert.equal(writes().length, 0);
  }
});

void test('F067 bind: an unfit target row is refused under the lock and writes nothing', async () => {
  for (const snapshot of [
    { staffActive: false },
    { activeDepartmentIds: [] },
    { effectivePermissions: ['service_request.view'] },
    { pairBoundElsewhere: 1 },
    { boundTenantId: TENANT, boundObjectId: OTHER_OBJECT },
  ]) {
    const { double, calls, writes } = store({ snapshot });
    await assert.rejects(run(double), /Binding refused/);
    assert.deepEqual(calls, [
      'readTarget',
      'lock',
      'readGuardedState',
      'readSnapshot',
    ]);
    assert.equal(writes().length, 0);
  }
});

void test('F067 bind: plan mode and an invalid mode never write', async () => {
  const planned = store();
  const report = await run(planned.double, { mode: 'plan' });
  assert.equal(report.action, 'planned');
  assert.equal(report.changed, false);
  assert.equal(planned.writes().length, 0);
  const invalid = store();
  await assert.rejects(
    run(invalid.double, {
      mode: 'force' as unknown as 'plan',
    }),
    /mode must be plan or confirm/,
  );
  assert.equal(invalid.calls.length, 0);
});

void test('F067 bind: confirm binds exactly once and reports masked identifiers only', async () => {
  const { double, calls, writes } = store();
  const report = await run(double);
  assert.deepEqual(report, {
    action: 'bound',
    changed: true,
    staffId: BINDING_TARGET.staffId,
    tenant: maskGuid(TENANT),
    object: maskGuid(OBJECT),
    credentialsIssued: 0,
  });
  assert.equal(writes().length, 1);
  // Proven, locked and planned before the write; read back after it.
  assert.deepEqual(calls, [
    'readTarget',
    'lock',
    'readGuardedState',
    'readSnapshot',
    'bind',
    'readSnapshot',
    'readGuardedState',
  ]);
  const text = JSON.stringify(report);
  assert.equal(text.includes(TENANT), false);
  assert.equal(text.includes(OBJECT), false);
});

void test('F067 bind: an identical binding is a verified no-op in both modes', async () => {
  for (const mode of ['plan', 'confirm'] as const) {
    const { double, writes } = store({
      snapshot: { boundTenantId: TENANT, boundObjectId: OBJECT },
    });
    const report = await run(double, { mode });
    assert.equal(report.action, 'already-bound');
    assert.equal(report.changed, false);
    assert.equal(writes().length, 0, mode);
  }
});

void test('F067 bind: a stale or concurrent conditional update fails closed', async () => {
  for (const updated of [0, 2]) {
    const { double } = store({ updated });
    await assert.rejects(
      run(double),
      new RegExp(`changed ${String(updated)} row\\(s\\)`),
    );
  }
});

void test('F067 bind: a write that disturbs anything else, or fails to read back, is refused', async () => {
  for (const afterGuarded of [
    { roleAssignments: 4 },
    { rolePermissions: 15 },
    { departmentMemberships: 4 },
    { divisionMemberships: 3 },
    { trackingCredentials: 1 },
    { staffRow: '{"a":false}' },
    { boundStaff: 2 },
  ]) {
    const { double } = store({ afterGuarded });
    await assert.rejects(
      run(double),
      /disturbed/,
      JSON.stringify(afterGuarded),
    );
  }
  const { double } = store({ readBack: { boundObjectId: OTHER_OBJECT } });
  await assert.rejects(run(double), /does not read back/);
});

// --- structure ----------------------------------------------------------------------

void test('F067 bind: the only write sets exactly the two identity columns, conditionally', () => {
  assert.deepEqual(BINDING_SOURCE.match(/\.updateTable\('[a-z_]+'\)/g), [
    ".updateTable('staff_identity')",
  ]);
  const sets = BINDING_SOURCE.match(/\.set\(\{[^}]*\}\)/g) ?? [];
  assert.equal(sets.length, 1);
  const keys = [...sets[0].matchAll(/([a-z_]+):/g)].map((m) => m[1]);
  assert.deepEqual(keys, ['entra_tenant_id', 'entra_object_id']);
  const update = BINDING_SOURCE.slice(
    BINDING_SOURCE.indexOf(".updateTable('staff_identity')"),
  ).slice(0, 700);
  for (const predicate of [
    "where('id', '=', staffId)",
    "where('organization_id', '=', organizationId)",
    "where('active', '=', true)",
    "where('entra_tenant_id', 'is', null)",
    "where('entra_object_id', 'is', null)",
    'numUpdatedRows',
  ])
    assert.ok(update.includes(predicate), predicate);
  for (const forbidden of [
    'insertInto(',
    'deleteFrom(',
    'truncate',
    'alter table',
    'drop ',
  ])
    assert.ok(!BINDING_SOURCE.includes(forbidden), forbidden);
});

void test('F067 bind: no token, guard, credential or F065 path is touched', () => {
  for (const text of [BINDING_SOURCE, CLI_SOURCE]) {
    for (const forbidden of [
      'jwtVerify',
      'Bearer ',
      'requester-tracking/issue',
      'generateTrackingCredential',
      'REQRO_ENABLE_REQUESTER_INTAKE_TRACKING',
      'insertInto',
    ])
      assert.ok(!text.includes(forbidden), forbidden);
    assert.ok(
      !/import[^;]*(StaffAccessGuard|EntraTokenService|StaffAuthorizationService)/s.test(
        text,
      ),
    );
  }
  // Credentials are counted to prove none appear, never written.
  assert.ok(
    BINDING_SOURCE.includes('count(*)::int from request_tracking_credential'),
  );
  assert.ok(BINDING_SOURCE.includes('credentialsIssued: 0'));
});

void test('F067 bind: the CLI takes the identity from stdin and checks its switch before connecting', () => {
  assert.ok(CLI_SOURCE.includes('await readStdin()'));
  assert.ok(!/process\.env\[?['.]?ENTRA_OBJECT/.test(CLI_SOURCE));
  assert.ok(!/argv[^;]*objectId/.test(CLI_SOURCE));
  const gate = CLI_SOURCE.indexOf("process.env[BIND_AUTHORIZATION] !== 'true'");
  const connect = CLI_SOURCE.indexOf('new Kysely');
  assert.ok(gate > 0 && connect > gate, 'the switch is checked first');
  assert.ok(CLI_SOURCE.includes("'REQRO_F067_UAT_BIND_AUTHORIZED'"));
  assert.ok(CLI_SOURCE.includes('commandFailure('));
  assert.ok(!CLI_SOURCE.includes('console.'));
});

void test('F067 bind: no real tenant or object identifier is committed in the binding sources', () => {
  const allowed = new Set(
    [
      trackingUatFixture.organizationId,
      trackingUatFixture.staffId,
      trackingUatFixture.roleId,
      '00000000-0000-0000-0000-000000000000',
    ].map((value) => value.toLowerCase()),
  );
  for (const text of [BINDING_SOURCE, CLI_SOURCE]) {
    const found = (
      text.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      ) ?? []
    )
      .map((value) => value.toLowerCase())
      .filter((value) => !allowed.has(value));
    assert.deepEqual(found, []);
  }
});

// --- harness core verdicts -----------------------------------------------------------

interface CoreModule {
  BIND_AUTHORIZATION_ENV: string;
  evaluateAppliedMigrations: (input: unknown) => {
    ok: boolean;
    reasons: string[];
  };
  parseIcaclsEntries: (
    text: string,
    path: string,
  ) => { principal: string; inherited: boolean; deny: boolean }[];
  evaluateSecretAcl: (facts: unknown) => { ok: boolean; reasons: string[] };
  parseBindingInput: (text: unknown) => {
    ok: boolean;
    reasons: string[];
    input?: { tenantId: string; objectId: string };
  };
}
const core = async () =>
  (await import(
    pathToFileURL(resolve(SERVER_ROOT, 'scripts/uat-f067-session-core.mjs'))
      .href
  )) as CoreModule;

const INVENTORY = [
  '20261030000000-add-requester-intake-tracking-issuance',
  '20261031000000-add-submission-idempotency',
];

void test('F067 bind: the live migration history must equal the recorded inventory', async () => {
  const { evaluateAppliedMigrations } = await core();
  const ok = { required: INVENTORY, expected: INVENTORY, applied: INVENTORY };
  assert.deepEqual(evaluateAppliedMigrations(ok), { ok: true, reasons: [] });
  for (const bad of [
    { ...ok, applied: INVENTORY.slice(1) },
    { ...ok, applied: [...INVENTORY, '20261101000000-extra'] },
    { ...ok, applied: null },
    { ...ok, expected: null },
    { ...ok, expected: INVENTORY.slice(1) },
  ])
    assert.equal(evaluateAppliedMigrations(bad).ok, false, JSON.stringify(bad));
});

const FILE = 'C:\\Users\\Example User\\worktree one\\server\\.env.uat';

void test('F067 bind: icacls output is parsed by exact path, even with spaces', async () => {
  const { parseIcaclsEntries } = await core();
  const text = [
    `${FILE} NT AUTHORITY\\SYSTEM:(F)`,
    '                                                 BUILTIN\\Administrators:(F)',
    '                                                 HOST\\owner:(F)',
    '                                                 HOST\\CodexSandboxUsers:(I)(RX)',
    '',
    'Successfully processed 1 files; Failed processing 0 files',
  ].join('\r\n');
  assert.deepEqual(parseIcaclsEntries(text, FILE), [
    { principal: 'NT AUTHORITY\\SYSTEM', inherited: false, deny: false },
    { principal: 'BUILTIN\\Administrators', inherited: false, deny: false },
    { principal: 'HOST\\owner', inherited: false, deny: false },
    { principal: 'HOST\\CodexSandboxUsers', inherited: true, deny: false },
  ]);
});

void test('F067 bind: the secret ACL must name only the owner, SYSTEM and Administrators, explicitly', async () => {
  const { evaluateSecretAcl } = await core();
  const entry = (principal: string, inherited = false) => ({
    principal,
    inherited,
    deny: false,
  });
  const base = [
    entry('NT AUTHORITY\\SYSTEM'),
    entry('BUILTIN\\Administrators'),
    entry('HOST\\owner'),
  ];
  const facts = (entries: unknown[]) => ({
    platform: 'windows',
    owner: 'HOST\\owner',
    entries,
  });
  assert.deepEqual(evaluateSecretAcl(facts(base)), { ok: true, reasons: [] });
  const refused: [unknown[], RegExp][] = [
    [[...base, entry('HOST\\CodexSandboxUsers', true)], /inherits an entry/],
    [
      [...base, entry('BUILTIN\\Users')],
      /not the owner, SYSTEM or Administrators/,
    ],
    [[...base, entry('Everyone')], /not the owner, SYSTEM or Administrators/],
    [
      [entry('NT AUTHORITY\\SYSTEM', true), ...base.slice(1)],
      /inherits an entry/,
    ],
    [base.slice(0, 2), /grants nothing to its owner/],
    [[], /no readable entries/],
  ];
  for (const [entries, reason] of refused) {
    const verdict = evaluateSecretAcl(facts(entries));
    assert.equal(verdict.ok, false);
    assert.ok(
      verdict.reasons.some((r) => reason.test(r)),
      verdict.reasons.join('; '),
    );
  }
  assert.equal(evaluateSecretAcl(null).ok, false);
  assert.equal(
    evaluateSecretAcl({ platform: 'posix', mode: 0o100600 }).ok,
    true,
  );
  assert.equal(
    evaluateSecretAcl({ platform: 'posix', mode: 0o100640 }).ok,
    false,
  );
  assert.equal(
    evaluateSecretAcl({ platform: 'posix', mode: 0o100604 }).ok,
    false,
  );
});

void test('F067 bind: identity input is parsed from JSON or two lines, and never echoed', async () => {
  const { parseBindingInput } = await core();
  const json = parseBindingInput(
    JSON.stringify({ tenantId: TENANT, objectId: OBJECT }),
  );
  assert.deepEqual(json.input, { tenantId: TENANT, objectId: OBJECT });
  const lines = parseBindingInput(`${TENANT}\r\n${OBJECT}\r\n`);
  assert.deepEqual(lines.input, { tenantId: TENANT, objectId: OBJECT });
  for (const bad of [
    '',
    TENANT,
    `${TENANT}\nnot-a-guid`,
    '{"tenantId":1}',
    '{not json',
    `${TENANT}\n${OBJECT}\n${OBJECT}`,
  ]) {
    const verdict = parseBindingInput(bad);
    assert.equal(verdict.ok, false, bad);
    for (const value of [TENANT, OBJECT])
      assert.equal(verdict.reasons.join(' ').includes(value), false);
  }
});

// --- the subprocess boundary ---------------------------------------------------------

interface EffectsModule {
  BINDING_SCRIPT: string;
  runIdentityBindingSubprocess: (input: Record<string, unknown>) => {
    ok: boolean;
    reason?: string;
    report?: Record<string, unknown>;
  };
}
const effectsModule = async () =>
  (await import(
    pathToFileURL(resolve(SERVER_ROOT, 'scripts/uat-f067-effects.mjs')).href
  )) as EffectsModule;

interface Spawned {
  script: string;
  env: Record<string, string>;
  args: string[];
  stdin: string;
}
const recorder = (result: Record<string, unknown>) => {
  const spawned: Spawned[] = [];
  return {
    spawned,
    run: (
      script: string,
      env: Record<string, string>,
      args: string[],
      stdin: string,
    ) => {
      spawned.push({ script, env, args, stdin });
      return result;
    },
  };
};
const subprocessInput = (
  run: unknown,
  overrides: Record<string, unknown> = {},
) => ({
  url: URL_OK,
  nonce: NONCE,
  role: ROLE,
  mode: 'confirm',
  input: { tenantId: TENANT, objectId: OBJECT },
  migrations: MIGRATIONS,
  expectedTenantId: TENANT,
  bindAuthorized: true,
  run,
  ...overrides,
});

void test('F067 bind: the identity travels on stdin only, never in env or arguments', async () => {
  const { runIdentityBindingSubprocess, BINDING_SCRIPT } =
    await effectsModule();
  const r = recorder({
    status: 0,
    stdout: `${JSON.stringify({ action: 'bound', changed: true })}\n`,
    stderr: '',
  });
  const outcome = runIdentityBindingSubprocess(subprocessInput(r.run));
  assert.equal(outcome.ok, true);
  const [call] = r.spawned;
  assert.ok(call);
  assert.equal(call.script, BINDING_SCRIPT);
  assert.deepEqual(call.args, ['--confirm']);
  assert.deepEqual(JSON.parse(call.stdin), {
    tenantId: TENANT,
    objectId: OBJECT,
  });
  const exposed = JSON.stringify({ env: call.env, args: call.args });
  assert.equal(exposed.includes(OBJECT), false);
  assert.equal(call.env.ENTRA_TENANT_ID, TENANT);
  assert.equal(call.env.REQRO_F067_UAT_BIND_AUTHORIZED, 'true');
  assert.deepEqual(
    JSON.parse(call.env.REQRO_F067_UAT_EXPECTED_MIGRATIONS ?? ''),
    MIGRATIONS,
  );
});

void test('F067 bind: the child switch is true only for an authorized confirm', async () => {
  const { runIdentityBindingSubprocess } = await effectsModule();
  for (const [overrides, expected, args] of [
    [{ mode: 'plan' }, '', ['--plan']],
    [{ mode: 'confirm', bindAuthorized: false }, '', ['--confirm']],
    [{ mode: 'plan', bindAuthorized: true }, '', ['--plan']],
  ] as const) {
    const r = recorder({
      status: 0,
      stdout: '{"action":"planned"}',
      stderr: '',
    });
    runIdentityBindingSubprocess(subprocessInput(r.run, overrides));
    const [first] = r.spawned;
    assert.ok(first);
    assert.equal(first.env.REQRO_F067_UAT_BIND_AUTHORIZED, expected);
    assert.deepEqual(first.args, [...args]);
  }
});

void test('F067 bind: subprocess failures are reported safely and never as success', async () => {
  const { runIdentityBindingSubprocess } = await effectsModule();
  const refused = recorder({
    status: 1,
    stdout: '',
    stderr: `${URL_OK}\n${JSON.stringify({ refused: 'Binding refused: the fixture staff identity is not active' })}\n`,
  });
  const a = runIdentityBindingSubprocess(subprocessInput(refused.run));
  assert.equal(a.ok, false);
  assert.equal(
    a.reason,
    'Binding refused: the fixture staff identity is not active',
  );
  for (const result of [
    { status: 1, stdout: '', stderr: `connect ${URL_OK}` },
    { status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT' } },
    { status: 0, stdout: 'not json', stderr: '' },
  ]) {
    const r = recorder(result);
    const outcome = runIdentityBindingSubprocess(subprocessInput(r.run));
    assert.equal(outcome.ok, false, JSON.stringify(result));
    for (const leak of ['secret', 'postgresql://', OBJECT])
      assert.equal(String(outcome.reason).includes(leak), false, leak);
  }
});
