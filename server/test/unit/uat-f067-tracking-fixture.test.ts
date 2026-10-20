/**
 * F067 UAT fixture — offline regression tests.
 *
 * Every decision the fixture makes is a pure function of facts it reads, so
 * the whole provisioning contract is exercised here without Docker, without
 * PostgreSQL and without writing a row: destination refusal, catalog
 * prerequisites, the idempotent plan, reference validation and the census that
 * gates readiness.
 *
 * What cannot be proven offline is proven structurally instead. The execution
 * body is read as text and asserted against: the destination verdict must come
 * before the first insert, the census after the last one, and no statement may
 * issue a credential, bind an Entra identity, update or delete. Those are the
 * properties a live run could violate silently, so they are checked where they
 * are visible.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  FIXTURE_DATABASE,
  FIXTURE_PERMISSIONS,
  FIXTURE_REQUIREMENTS,
  FORBIDDEN_DATABASES,
  RESIDENT_VISIBLE_UPDATE,
  evaluateAllocatedReference,
  evaluateCatalogPrerequisites,
  evaluateFixtureCensus,
  evaluateFixtureTarget,
  fixtureUpdateKeys,
  planFixtureWrites,
  trackingUatFixture,
  type FixtureSnapshot,
  type FixtureTargetFacts,
} from '../../src/database/uat-f067-tracking-fixture.js';

const SERVER_ROOT = resolve(__dirname, '../../..');
const source = (relative: string): string =>
  readFileSync(resolve(SERVER_ROOT, relative), 'utf8');
const FIXTURE_SOURCE = source('src/database/uat-f067-tracking-fixture.ts');
const CLI_SOURCE = source('src/database/uat-f067-tracking-fixture-cli.ts');

const NONCE = 'd3f4a1b2c3d4e5f60718293a4b5c6d7e';
const ROLE = 'reqro_test';
const URL_OK = `postgresql://${ROLE}:secret@127.0.0.1:49231/${FIXTURE_DATABASE}`;

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

const REQUEST_IDS = trackingUatFixture.requests.map((request) => request.id);

const emptySnapshot: FixtureSnapshot = {
  staffPresent: false,
  staffMatches: false,
  rolePresent: false,
  roleMatches: false,
  rolePermissions: [],
  assignmentPresent: false,
  assignmentActive: false,
  assignmentMatches: false,
  membershipPresent: false,
  membershipActive: false,
  membershipMatches: false,
  unexpectedMemberships: 0,
  requestsPresent: [],
  activityPresent: [],
  operationalPresent: [],
  locationPresent: [],
  updatesPresent: [],
};

const fullSnapshot: FixtureSnapshot = {
  staffPresent: true,
  staffMatches: true,
  rolePresent: true,
  roleMatches: true,
  rolePermissions: [...FIXTURE_PERMISSIONS],
  assignmentPresent: true,
  assignmentActive: true,
  assignmentMatches: true,
  membershipPresent: true,
  membershipActive: true,
  membershipMatches: true,
  unexpectedMemberships: 0,
  requestsPresent: REQUEST_IDS,
  activityPresent: REQUEST_IDS,
  operationalPresent: REQUEST_IDS,
  locationPresent: REQUEST_IDS,
  updatesPresent: fixtureUpdateKeys(),
};

const satisfiedCensus = { ...FIXTURE_REQUIREMENTS };

// --- manifest --------------------------------------------------------------

void test('F067 the manifest declares exactly one PUBLIC request with updates and one without', () => {
  assert.equal(trackingUatFixture.requests.length, 2);
  const withUpdates = trackingUatFixture.requests.filter(
    (request) => request.updates.length > 0,
  );
  const withoutUpdates = trackingUatFixture.requests.filter(
    (request) => request.updates.length === 0,
  );
  assert.equal(withUpdates.length, 1);
  assert.equal(withoutUpdates.length, 1);
  assert.ok(withUpdates[0] && withUpdates[0].updates.length >= 2);
});

void test('F067 every manifest identifier is a distinct, well-formed fixture UUID', () => {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const identifiers = [
    trackingUatFixture.organizationId,
    trackingUatFixture.staffId,
    trackingUatFixture.roleId,
    ...REQUEST_IDS,
    ...trackingUatFixture.requests.flatMap((request) =>
      request.updates.map((update) => update.submissionKey),
    ),
  ];
  for (const value of identifiers) assert.ok(uuid.test(value), value);
  assert.equal(new Set(identifiers).size, identifiers.length);
});

void test('F067 the fixture grants only the two permissions the tracking endpoint requires', () => {
  assert.deepEqual(
    [...FIXTURE_PERMISSIONS],
    ['service_request.view', 'service_request.tracking.manage'],
  );
  // The frozen integrity policy, read from the migration that owns it, so a
  // fabricated permission key cannot pass as manageable.
  const policy = source(
    'migrations/20261008000000-add-administrative-access-foundation.ts',
  );
  for (const key of FIXTURE_PERMISSIONS)
    assert.ok(policy.includes(`'${key}'`), key);
  for (const forbidden of [
    'admin.access.manage',
    'admin.access.read',
    'admin.configuration.read',
    'service_request.communication.create',
    'service_request.create',
  ])
    assert.ok(!FIXTURE_PERMISSIONS.some((key) => key === forbidden), forbidden);
});

void test('F067 resident-visible updates are written with the three values the projection filters on', () => {
  assert.deepEqual(RESIDENT_VISIBLE_UPDATE, {
    direction: 'outbound',
    channel: 'portal',
    deliveryState: 'recorded',
  });
  const repository = source(
    'src/service-request/request-tracking.repository.ts',
  );
  assert.ok(repository.includes("'direction', '=', 'outbound'"));
  assert.ok(repository.includes("'channel', '=', 'portal'"));
  assert.ok(repository.includes("'delivery_state', '=', 'recorded'"));
});

// --- destination identity --------------------------------------------------

void test('F067 a correct disposable destination is accepted', () => {
  assert.equal(evaluateFixtureTarget(target()), null);
  assert.equal(
    evaluateFixtureTarget(
      target({
        url: `postgresql://${ROLE}:s@localhost:5433/${FIXTURE_DATABASE}`,
      }),
    ),
    null,
  );
});

void test('F067 the fixture refuses the persistent development database by name', () => {
  for (const database of FORBIDDEN_DATABASES) {
    const refusal = evaluateFixtureTarget(
      target({
        url: `postgresql://${ROLE}:s@127.0.0.1:49231/${database}`,
        sqlDatabase: database,
      }),
    );
    assert.ok(refusal !== null);
    assert.ok(refusal.includes(database), refusal);
    assert.ok(refusal.includes('persistent'), refusal);
  }
  assert.ok(FORBIDDEN_DATABASES.includes('reqro_dev'));
});

void test('F067 the fixture refuses the native PostgreSQL port and non-loopback hosts', () => {
  const onNativePort = evaluateFixtureTarget(
    target({
      url: `postgresql://${ROLE}:s@127.0.0.1:5432/${FIXTURE_DATABASE}`,
    }),
  );
  assert.ok(onNativePort?.includes('5432'));
  const remote = evaluateFixtureTarget(
    target({
      url: `postgresql://${ROLE}:s@db.example.test:49231/${FIXTURE_DATABASE}`,
    }),
  );
  assert.ok(remote?.includes('loopback'));
  const noPort = evaluateFixtureTarget(
    target({ url: `postgresql://${ROLE}:s@127.0.0.1/${FIXTURE_DATABASE}` }),
  );
  assert.ok(noPort !== null);
});

void test('F067 a nonce mismatch, an absent nonce and an empty expectation are each refused', () => {
  assert.ok(
    evaluateFixtureTarget(target({ sqlNonce: 'f'.repeat(32) }))?.includes(
      'does not match',
    ),
  );
  assert.ok(
    evaluateFixtureTarget(target({ sqlNonce: null }))?.includes(
      'no disposable',
    ),
  );
  assert.ok(evaluateFixtureTarget(target({ sqlNonce: '   ' })) !== null);
  // An empty expectation must never compare equal to an absent setting.
  assert.ok(
    evaluateFixtureTarget(target({ expectedNonce: '', sqlNonce: '' })) !== null,
  );
  assert.ok(
    evaluateFixtureTarget(target({ expectedNonce: undefined })) !== null,
  );
  assert.ok(evaluateFixtureTarget(target({ expectedRole: '' })) !== null);
});

void test('F067 a server reporting a different database or role than the URL is refused', () => {
  assert.ok(
    evaluateFixtureTarget(target({ sqlDatabase: 'reqro_dev' })) !== null,
  );
  assert.ok(
    evaluateFixtureTarget(target({ sqlUser: 'reqro_dev_user' })) !== null,
  );
  assert.ok(
    evaluateFixtureTarget(
      target({
        url: `postgresql://postgres:s@127.0.0.1:49231/${FIXTURE_DATABASE}`,
      }),
    ) !== null,
  );
});

void test('F067 unusable destination facts are refused rather than assumed', () => {
  assert.ok(evaluateFixtureTarget(null) !== null);
  assert.ok(evaluateFixtureTarget(undefined) !== null);
  assert.ok(evaluateFixtureTarget(target({ url: 'not a url' })) !== null);
  assert.ok(evaluateFixtureTarget(target({ url: '' })) !== null);
  assert.ok(
    evaluateFixtureTarget(
      target({ url: `postgresql://${ROLE}:s@127.0.0.1:49231/` }),
    ) !== null,
  );
});

// --- catalog prerequisites -------------------------------------------------

const catalog = (overrides: Record<string, unknown> = {}) => ({
  organizationStatus: 'active',
  organizationName: 'CityVUE Development Municipality',
  organizationSlug: 'cityvue-development',
  businessTimezone: 'America/New_York',
  serviceDefinitionId: '40000000-0000-4000-8000-000000000001',
  versionId: '50000000-0000-4000-8000-000000000001',
  categoryId: '30000000-0000-4000-8000-000000000001',
  defaultPriority: 'medium',
  versionStatus: 'published',
  trackingPolicyPresent: true,
  categoryDepartmentId: '20000000-0000-4000-8000-000000000001',
  categoryDivisionId: null,
  ...overrides,
});

void test('F067 the seeded catalog satisfies the fixture prerequisites', () => {
  const verdict = evaluateCatalogPrerequisites(catalog());
  assert.deepEqual(verdict, { ok: true, reasons: [] });
});

void test('F067 each missing catalog prerequisite is named rather than summarised', () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ organizationStatus: 'suspended' }, 'not active'],
    [{ organizationName: 'Rockville' }, 'name'],
    [{ organizationSlug: 'rockville' }, 'slug'],
    [{ businessTimezone: '' }, 'timezone'],
    [{ serviceDefinitionId: null }, 'Service Definition'],
    [{ versionId: null }, 'version'],
    [{ categoryId: null }, 'Category'],
    [{ versionStatus: 'draft' }, 'not published'],
    [{ defaultPriority: null }, 'priority'],
    [{ trackingPolicyPresent: false }, 'request_tracking_policy'],
    [{ categoryDepartmentId: null }, 'no Department'],
    [{ categoryDepartmentId: '' }, 'no Department'],
    [
      { categoryDivisionId: '22000000-0000-4000-8000-000000000001' },
      'Division membership',
    ],
  ];
  for (const [override, fragment] of cases) {
    const verdict = evaluateCatalogPrerequisites(catalog(override));
    assert.equal(verdict.ok, false, JSON.stringify(override));
    assert.ok(
      verdict.reasons.some((reason) => reason.includes(fragment)),
      `${JSON.stringify(override)} -> ${verdict.reasons.join('; ')}`,
    );
  }
  assert.equal(evaluateCatalogPrerequisites(null).ok, false);
});

void test('F067 a missing tracking policy is reported as a migration gap, not a seed gap', () => {
  const verdict = evaluateCatalogPrerequisites(
    catalog({ trackingPolicyPresent: false }),
  );
  assert.ok(
    verdict.reasons.some((reason) => reason.includes('F065 migration')),
    verdict.reasons.join('; '),
  );
});

// --- planning and repetition ----------------------------------------------

void test('F067 an empty database plans every record and exactly two reference allocations', () => {
  const plan = planFixtureWrites(emptySnapshot);
  assert.equal(plan.ok, true);
  assert.equal(plan.changed, true);
  assert.equal(plan.createStaff, true);
  assert.equal(plan.createRole, true);
  assert.equal(plan.createAssignment, true);
  assert.equal(plan.createMembership, true);
  assert.equal(plan.reactivateMembership, false);
  assert.deepEqual([...plan.grantPermissions], [...FIXTURE_PERMISSIONS]);
  assert.deepEqual([...plan.createRequests], REQUEST_IDS);
  assert.deepEqual([...plan.createActivity], REQUEST_IDS);
  assert.deepEqual([...plan.createOperational], REQUEST_IDS);
  assert.deepEqual([...plan.createLocation], REQUEST_IDS);
  assert.equal(
    plan.createUpdates.length,
    FIXTURE_REQUIREMENTS.residentVisibleUpdates,
  );
  assert.equal(plan.referenceAllocations, 2);
});

void test('F067 a second run plans nothing and allocates no reference', () => {
  const plan = planFixtureWrites(fullSnapshot);
  assert.equal(plan.ok, true);
  assert.equal(plan.changed, false);
  assert.equal(plan.referenceAllocations, 0);
  assert.equal(plan.createStaff, false);
  assert.equal(plan.createRole, false);
  assert.equal(plan.createAssignment, false);
  assert.equal(plan.createMembership, false);
  assert.equal(plan.reactivateMembership, false);
  for (const list of [
    plan.grantPermissions,
    plan.createRequests,
    plan.createActivity,
    plan.createOperational,
    plan.createLocation,
    plan.createUpdates,
  ])
    assert.equal(list.length, 0);
});

void test('F067 a partially provisioned database is completed, not duplicated', () => {
  const first = REQUEST_IDS[0];
  assert.ok(first);
  const plan = planFixtureWrites({
    ...emptySnapshot,
    staffPresent: true,
    staffMatches: true,
    rolePresent: true,
    roleMatches: true,
    rolePermissions: ['service_request.view'],
    requestsPresent: [first],
    activityPresent: [first],
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.changed, true);
  assert.equal(plan.createStaff, false);
  assert.equal(plan.createRole, false);
  assert.equal(plan.createAssignment, true);
  // Only the one permission that is actually absent is granted.
  assert.deepEqual(
    [...plan.grantPermissions],
    ['service_request.tracking.manage'],
  );
  assert.deepEqual([...plan.createRequests], [REQUEST_IDS[1]]);
  assert.equal(plan.referenceAllocations, 1);
  assert.deepEqual([...plan.createActivity], [REQUEST_IDS[1]]);
  // The existing request is missing its location, so that row is still planned.
  assert.deepEqual([...plan.createLocation], REQUEST_IDS);
});

void test('F067 a missing resident-visible update is replanned without touching the others', () => {
  const keys = fixtureUpdateKeys();
  const kept = keys.slice(1);
  const plan = planFixtureWrites({ ...fullSnapshot, updatesPresent: kept });
  assert.equal(plan.changed, true);
  assert.deepEqual([...plan.createUpdates], [keys[0]]);
  assert.equal(plan.referenceAllocations, 0);
});

void test('F067 an existing fixture row with unexpected content is refused, never adopted or repaired', () => {
  const staff = planFixtureWrites({
    ...fullSnapshot,
    staffMatches: false,
  });
  assert.equal(staff.ok, false);
  assert.ok(staff.reasons.some((reason) => reason.includes('staff identity')));
  assert.ok(
    staff.reasons.some((reason) => reason.includes('no adoption or repair')),
  );
  const role = planFixtureWrites({ ...fullSnapshot, roleMatches: false });
  assert.equal(role.ok, false);
  assert.ok(role.reasons.some((reason) => reason.includes('fixture role')));
  // A refused plan must carry no writes at all.
  for (const plan of [staff, role]) {
    assert.equal(plan.changed, false);
    assert.equal(plan.referenceAllocations, 0);
    assert.equal(plan.createStaff, false);
    assert.equal(plan.createRequests.length, 0);
    assert.equal(plan.grantPermissions.length, 0);
  }
});

void test('F067 a fixture role carrying a permission outside the approved scope is refused', () => {
  const plan = planFixtureWrites({
    ...fullSnapshot,
    rolePermissions: [...FIXTURE_PERMISSIONS, 'admin.access.manage'],
  });
  assert.equal(plan.ok, false);
  assert.ok(
    plan.reasons.some((reason) =>
      reason.includes('outside the approved fixture scope'),
    ),
    plan.reasons.join('; '),
  );
  assert.equal(plan.changed, false);
});

void test('F067 an unusable snapshot plans nothing', () => {
  const plan = planFixtureWrites(null);
  assert.equal(plan.ok, false);
  assert.equal(plan.changed, false);
  assert.equal(plan.referenceAllocations, 0);
  assert.equal(planFixtureWrites(undefined).ok, false);
});

// --- reference validation --------------------------------------------------

void test('F067 a reference the database would reject is refused before it is inserted', () => {
  assert.equal(evaluateAllocatedReference('SR-202610-000001'), null);
  assert.equal(evaluateAllocatedReference('SR000001'), null);
  for (const invalid of [
    '',
    'sr-202610-000001',
    'SR 202610 000001',
    '-SR-000001',
    'SR--000001',
    'SR-202610-000001-',
    'SR_202610_000001',
    'SR-202610-00000#',
  ])
    assert.ok(evaluateAllocatedReference(invalid) !== null, invalid);
  assert.ok(evaluateAllocatedReference('A'.repeat(49)) !== null);
  assert.equal(evaluateAllocatedReference('A'.repeat(48)), null);
  for (const absent of [null, undefined, 42, {}])
    assert.ok(evaluateAllocatedReference(absent) !== null);
});

void test('F067 the reference pattern matches the database constraint it restates', () => {
  const migration = source(
    'migrations/20260919040000-configure-request-references.ts',
  );
  assert.ok(
    migration.includes("reference_number ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'"),
    'the migration constraint changed; the fixture validator must follow',
  );
  assert.ok(migration.includes('varchar(48)'));
});

// --- census and readiness --------------------------------------------------

void test('F067 the census requirements are derived from the manifest', () => {
  assert.deepEqual(FIXTURE_REQUIREMENTS, {
    publicRequestsWithUpdates: 1,
    publicRequestsWithoutUpdates: 1,
    residentVisibleUpdates: 2,
    trackingManageGrants: 1,
    staffIdentities: 1,
    trackingStaffAuthorized: 1,
    trackingStaffScopedRequests: 2,
  });
  assert.equal(fixtureUpdateKeys().length, 2);
});

void test('F067 a census meeting every requirement is accepted', () => {
  assert.deepEqual(evaluateFixtureCensus(satisfiedCensus), {
    ok: true,
    reasons: [],
  });
  assert.equal(
    evaluateFixtureCensus({ ...satisfiedCensus, residentVisibleUpdates: 9 }).ok,
    true,
  );
});

void test('F067 readiness is refused when any required record is short', () => {
  for (const key of Object.keys(FIXTURE_REQUIREMENTS)) {
    const verdict = evaluateFixtureCensus({ ...satisfiedCensus, [key]: 0 });
    assert.equal(verdict.ok, false, key);
    assert.ok(
      verdict.reasons.some((reason) => reason.includes(key)),
      `${key} -> ${verdict.reasons.join('; ')}`,
    );
  }
});

void test('F067 a missing tracking-manage grant alone refuses readiness', () => {
  const verdict = evaluateFixtureCensus({
    ...satisfiedCensus,
    trackingManageGrants: 0,
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reasons.length, 1);
  assert.ok(verdict.reasons[0]?.includes('trackingManageGrants'));
});

void test('F067 a malformed census is refused rather than coerced', () => {
  assert.equal(evaluateFixtureCensus(null).ok, false);
  assert.equal(evaluateFixtureCensus(undefined).ok, false);
  assert.equal(evaluateFixtureCensus({}).ok, false);
  for (const value of ['1', 1.5, -1, Number.NaN, null, undefined, {}])
    assert.equal(
      evaluateFixtureCensus({ ...satisfiedCensus, staffIdentities: value }).ok,
      false,
      JSON.stringify(value),
    );
});

// --- structure: what a live run must not do -------------------------------

void test('F067 the fixture issues no tracking credential and touches no credential table', () => {
  for (const forbidden of [
    'request_tracking_credential',
    'credential_digest',
    'requester-tracking',
    'trackingCredential',
    'issueCredential',
  ])
    assert.ok(!FIXTURE_SOURCE.includes(forbidden), forbidden);
  assert.ok(!CLI_SOURCE.includes('request_tracking_credential'));
  // The report states the absence positively rather than leaving it implied.
  assert.ok(FIXTURE_SOURCE.includes('credentialsIssued: 0'));
  assert.ok(FIXTURE_SOURCE.includes('staffAuthenticated: false'));
});

void test('F067 the synthetic staff identity is created unauthenticated and no Entra value is bound', () => {
  assert.ok(FIXTURE_SOURCE.includes('entra_object_id: null'));
  for (const forbidden of [
    'entra_tenant_id:',
    'ENTRA_TENANT_ID',
    'ENTRA_OBJECT_ID',
    'jwtVerify',
    'Bearer ',
  ])
    assert.ok(!FIXTURE_SOURCE.includes(forbidden), forbidden);
  // `StaffAccessGuard` is named in the header comment explaining why the
  // identity is left unbound. Explaining a guard is not touching one, so the
  // check is for an import or a use, not for the word.
  assert.ok(!/import[^;]*StaffAccessGuard/s.test(FIXTURE_SOURCE));
  assert.ok(!/StaffAccessGuard\s*[(.]/.test(FIXTURE_SOURCE));
  assert.ok(!CLI_SOURCE.includes('StaffAccessGuard'));
});

void test('F067 the fixture never deletes, truncates or alters, and updates only its own two activity flags', () => {
  for (const forbidden of [
    'deleteFrom(',
    'truncate',
    'drop table',
    'alter table',
  ])
    assert.ok(!FIXTURE_SOURCE.includes(forbidden), forbidden);
  // Exactly two updates exist: reactivating the fixture's own role assignment
  // and its own Department membership, which an insert cannot do because the
  // row already occupies the primary key. Each is scoped to that key and to
  // `active` alone, and no other column is ever set.
  const updates = FIXTURE_SOURCE.match(/\.updateTable\('([a-z_]+)'\)/g) ?? [];
  assert.deepEqual(updates, [
    ".updateTable('staff_role_assignment')",
    ".updateTable('staff_department_membership')",
  ]);
  const sets = FIXTURE_SOURCE.match(/\.set\(\{[^}]*\}\)/g) ?? [];
  assert.deepEqual(sets, ['.set({ active: true })', '.set({ active: true })']);
  assert.ok(
    !/\.set\(\{[^}]*permission/s.test(FIXTURE_SOURCE),
    'no update may touch a permission',
  );
});

void test('F067 the existing role assignment is read by its real primary key, with no status predicate', () => {
  // The primary key is (staff_identity_id, role_id). Reading only active rows
  // would report an inactive assignment as absent and the plan would then
  // attempt an insert the key refuses.
  const read =
    /selectFrom\('staff_role_assignment'\)[\s\S]{0,400}?executeTakeFirst\(\)/.exec(
      FIXTURE_SOURCE,
    );
  assert.ok(read, 'the assignment read was not found');
  assert.ok(read[0].includes("'staff_identity_id', '=',"));
  assert.ok(read[0].includes("'role_id', '=',"));
  assert.ok(
    !read[0].includes("'active', '=', true"),
    'the assignment read must not filter on active',
  );
  assert.ok(read[0].includes("'active'"), 'activity is selected as a fact');
});

void test('F067 an absent role assignment is created and an active one is left alone', () => {
  const absent = planFixtureWrites(emptySnapshot);
  assert.equal(absent.createAssignment, true);
  assert.equal(absent.reactivateAssignment, false);
  const active = planFixtureWrites(fullSnapshot);
  assert.equal(active.createAssignment, false);
  assert.equal(active.reactivateAssignment, false);
  assert.equal(active.changed, false);
});

void test('F067 an inactive role assignment is reactivated in place, never duplicated', () => {
  const plan = planFixtureWrites({
    ...fullSnapshot,
    assignmentPresent: true,
    assignmentActive: false,
  });
  assert.equal(plan.ok, true);
  // No insert: the primary key is already taken by the inactive row.
  assert.equal(plan.createAssignment, false);
  assert.equal(plan.reactivateAssignment, true);
  // Reactivation is a change, so the run must not report itself a no-op.
  assert.equal(plan.changed, true);
  // Nothing else is planned, and no permission is added.
  assert.equal(plan.grantPermissions.length, 0);
  assert.equal(plan.referenceAllocations, 0);
  assert.equal(plan.createRequests.length, 0);
  assert.equal(plan.createUpdates.length, 0);
  assert.equal(plan.createStaff, false);
  assert.equal(plan.createRole, false);
});

void test('F067 reactivating twice settles: the second plan is a no-op', () => {
  const inactive = planFixtureWrites({
    ...fullSnapshot,
    assignmentActive: false,
  });
  assert.equal(inactive.reactivateAssignment, true);
  // After the update the snapshot reads active again, so idempotency holds.
  const settled = planFixtureWrites({
    ...fullSnapshot,
    assignmentActive: true,
  });
  assert.equal(settled.reactivateAssignment, false);
  assert.equal(settled.changed, false);
});

void test('F067 an assignment belonging to another Organization is refused, not reactivated', () => {
  const plan = planFixtureWrites({
    ...fullSnapshot,
    assignmentActive: false,
    assignmentMatches: false,
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.reactivateAssignment, false);
  assert.equal(plan.createAssignment, false);
  assert.equal(plan.changed, false);
  assert.ok(
    plan.reasons.some((reason) => reason.includes('another Organization')),
    plan.reasons.join('; '),
  );
});

void test('F067 the destination is proven before the first write and the census read after the last', () => {
  const verdict = FIXTURE_SOURCE.indexOf('evaluateFixtureTarget(');
  const firstInsert = FIXTURE_SOURCE.indexOf('.insertInto(');
  const lastInsert = FIXTURE_SOURCE.lastIndexOf('.insertInto(');
  const census = FIXTURE_SOURCE.lastIndexOf('await readCensus(trx)');
  const refusalCall = FIXTURE_SOURCE.indexOf('if (refusal !== null) throw');
  assert.ok(verdict > 0 && firstInsert > 0 && census > 0 && refusalCall > 0);
  assert.ok(
    refusalCall < firstInsert,
    'the target refusal must precede any write',
  );
  assert.ok(
    census > lastInsert,
    'the census must be read after the last write',
  );
  assert.ok(
    FIXTURE_SOURCE.indexOf('evaluateCatalogPrerequisites(') < firstInsert,
    'prerequisites must be verified before any write',
  );
  assert.ok(
    FIXTURE_SOURCE.indexOf('planFixtureWrites(await readSnapshot(trx))') <
      firstInsert,
    'the plan must be fixed before any write',
  );
});

void test('F067 the fixture neither imports nor calls the development database pin', () => {
  // `assertDevelopmentDatabaseUrl` hard-pins reqro_dev. It is deliberately not
  // used here -- this fixture has a different, stricter target -- and it must
  // not be weakened or re-exported. It may be named in prose only.
  assert.ok(!/import[^;]*assertDevelopmentDatabaseUrl/s.test(FIXTURE_SOURCE));
  assert.ok(!/assertDevelopmentDatabaseUrl\s*\(/.test(FIXTURE_SOURCE));
  assert.ok(!CLI_SOURCE.includes('assertDevelopmentDatabaseUrl'));
  const pin = source('src/database/development-staff-input.ts');
  assert.ok(pin.includes('export function assertDevelopmentDatabaseUrl'));
});

void test('F067 the fixture reuses the existing reference allocator rather than formatting its own', () => {
  assert.ok(FIXTURE_SOURCE.includes('allocateConfiguredReference('));
  assert.ok(
    FIXTURE_SOURCE.includes(
      "from '../service-request/reference-policy.repository.js'",
    ),
  );
  // No hand-rolled sequence arithmetic or reference assembly.
  for (const forbidden of [
    'service_request_reference_sequence',
    'formatReferenceNumber(',
    'padStart(',
  ])
    assert.ok(!FIXTURE_SOURCE.includes(forbidden), forbidden);
});

void test('F067 the fixture derives the catalog instead of hardcoding Category or priority values', () => {
  for (const forbidden of [
    '20000000-0000-4000-8000',
    '22000000-0000-4000-8000',
    '30000000-0000-4000-8000',
    '40000000-0000-4000-8000',
    '50000000-0000-4000-8000',
    "priority: 'medium'",
  ])
    assert.ok(!FIXTURE_SOURCE.includes(forbidden), forbidden);
  assert.ok(FIXTURE_SOURCE.includes('current_published_version_id'));
  assert.ok(FIXTURE_SOURCE.includes('priority,'));
});

void test('F067 the requests are written PUBLIC, web-intake and with no staff requester', () => {
  assert.ok(FIXTURE_SOURCE.includes("audience: 'public'"));
  assert.ok(FIXTURE_SOURCE.includes("intake_channel: 'web'"));
  assert.ok(FIXTURE_SOURCE.includes('submitted_by_staff_identity_id: null'));
  assert.ok(FIXTURE_SOURCE.includes('requester_staff_identity_id: null'));
  assert.ok(FIXTURE_SOURCE.includes("reporting_identity: 'anonymous'"));
  assert.ok(!FIXTURE_SOURCE.includes("audience: 'internal'"));
  // The PUBLIC/requester CHECK constraint this satisfies.
  const migration = source(
    'migrations/20260919000000-add-request-audience-assisted-intake.ts',
  );
  assert.ok(migration.includes('request_public_requester_check'));
});

void test('F067 the lifecycle values written are ones the schema and the resident mapping accept', () => {
  assert.ok(FIXTURE_SOURCE.includes("status: 'open'"));
  assert.ok(
    FIXTURE_SOURCE.includes("activity_type: 'service_request_created'"),
  );
  assert.ok(FIXTURE_SOURCE.includes("activity_type: 'request_created'"));
  assert.ok(FIXTURE_SOURCE.includes("actor_type: 'anonymous_resident'"));
  assert.ok(FIXTURE_SOURCE.includes('request_revision: 1'));
  const lifecycle = source(
    'migrations/20260903010000-add-staff-assignment-workflow-foundation.ts',
  );
  assert.ok(
    lifecycle.includes(
      "status in ('open','in_progress','on_hold','closed','cancelled')",
    ),
  );
  const domain = source('src/service-request/request-tracking.domain.ts');
  assert.ok(domain.includes("case 'open':"));
});

void test('F067 the CLI requires the nonce and the disposable role and prints no connection string', () => {
  assert.ok(CLI_SOURCE.includes("required('DATABASE_URL')"));
  assert.ok(CLI_SOURCE.includes("required('REQRO_F067_UAT_DISPOSABLE_NONCE')"));
  assert.ok(CLI_SOURCE.includes("required('REQRO_F067_UAT_DISPOSABLE_ROLE')"));
  // Errors go through the sanitizer, and only counts reach stdout.
  assert.ok(CLI_SOURCE.includes('commandFailure('));
  assert.ok(!/stdout\.write\([^)]*url/s.test(CLI_SOURCE));
  assert.ok(!CLI_SOURCE.includes('console.log'));
  assert.ok(CLI_SOURCE.includes('census: report.census'));
});

interface HarnessModule {
  evaluateFixtureReadiness: (counts: unknown) => {
    ok: boolean;
    reasons: string[];
  };
}

void test('F067 the harness census and the fixture census agree on the readiness keys', async () => {
  const harness = (await import(
    pathToFileURL(resolve(SERVER_ROOT, 'scripts/uat-f067-session.mjs')).href
  )) as HarnessModule;
  const verdict = harness.evaluateFixtureReadiness({
    organizations: 1,
    serviceDefinitions: 1,
    ...satisfiedCensus,
  });
  assert.equal(verdict.ok, true);
  const short = harness.evaluateFixtureReadiness({
    organizations: 1,
    serviceDefinitions: 1,
    ...satisfiedCensus,
    trackingManageGrants: 0,
  });
  assert.equal(short.ok, false);
  assert.ok(
    short.reasons.some((reason) => reason.includes('trackingManageGrants')),
  );
});
