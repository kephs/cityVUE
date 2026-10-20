import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  FIXTURE_PERMISSIONS,
  FIXTURE_REQUIREMENTS,
  evaluateCatalogPrerequisites,
  evaluateFixtureCensus,
  fixtureUpdateKeys,
  planFixtureWrites,
  trackingUatFixture,
  type FixtureSnapshot,
} from '../../src/database/uat-f067-tracking-fixture.js';

/**
 * F067 — the fixture staff identity's operational scope.
 *
 * `staffRequestScope` admits no request for a staff identity without an
 * active Department membership covering it, so a role carrying both tracking
 * permissions still reached neither fixture request. The fixture now writes
 * that one membership, and readiness measures the fixture identity's own
 * authority and reach rather than counting any grant in the Organization.
 *
 * Offline only: plans and verdicts are pure, and the SQL is checked
 * structurally. Nothing here contacts PostgreSQL or Docker.
 */

const SERVER_ROOT = resolve(__dirname, '../../..');
const source = (relative: string): string =>
  readFileSync(resolve(SERVER_ROOT, relative), 'utf8');
const FIXTURE_SOURCE = source('src/database/uat-f067-tracking-fixture.ts');
const EFFECTS_SOURCE = source('scripts/uat-f067-effects.mjs');
const SCOPE_SOURCE = source('src/service-request/staff-request-scope.ts');
/** Whitespace-insensitive comparison of SQL written in two files. */
const flat = (text: string): string => text.replace(/\s+/g, ' ');

const REQUEST_IDS = trackingUatFixture.requests.map((request) => request.id);
const complete: FixtureSnapshot = {
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
const ready = { ...FIXTURE_REQUIREMENTS };

interface HarnessModule {
  UAT_FIXTURE_STAFF_ID: string;
  UAT_FIXTURE_REQUEST_COUNT: number;
  evaluateFixtureReadiness: (counts: unknown) => {
    ok: boolean;
    reasons: string[];
  };
}
const harness = async () =>
  (await import(
    pathToFileURL(resolve(SERVER_ROOT, 'scripts/uat-f067-session-core.mjs'))
      .href
  )) as HarnessModule;
const harnessReady = { organizations: 1, serviceDefinitions: 1, ...ready };

// --- membership planning ----------------------------------------------------

void test('F067 scope: a missing Department membership is planned for creation', () => {
  const plan = planFixtureWrites({
    ...complete,
    membershipPresent: false,
    membershipActive: false,
    membershipMatches: false,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.createMembership, true);
  assert.equal(plan.reactivateMembership, false);
  assert.equal(plan.changed, true);
  // Nothing else is planned: the gap is closed without touching the grant.
  assert.equal(plan.grantPermissions.length, 0);
  assert.equal(plan.createAssignment, false);
  assert.equal(plan.referenceAllocations, 0);
});

void test('F067 scope: an active, correct membership changes nothing', () => {
  const plan = planFixtureWrites(complete);
  assert.equal(plan.ok, true);
  assert.equal(plan.createMembership, false);
  assert.equal(plan.reactivateMembership, false);
  assert.equal(plan.changed, false);
});

void test('F067 scope: an inactive membership is reactivated in place, never duplicated', () => {
  const plan = planFixtureWrites({ ...complete, membershipActive: false });
  assert.equal(plan.ok, true);
  // The primary key is occupied, so an insert would be refused.
  assert.equal(plan.createMembership, false);
  assert.equal(plan.reactivateMembership, true);
  assert.equal(plan.changed, true);
  assert.equal(plan.reactivateAssignment, false);
  assert.equal(plan.grantPermissions.length, 0);
  // After the update the snapshot reads active again: repetition settles.
  assert.equal(planFixtureWrites(complete).changed, false);
});

void test('F067 scope: a present membership is never planned for insertion', () => {
  for (const active of [true, false]) {
    const plan = planFixtureWrites({ ...complete, membershipActive: active });
    assert.equal(plan.createMembership, false, String(active));
  }
});

void test('F067 scope: a membership against another Organization is refused, not reactivated', () => {
  const plan = planFixtureWrites({
    ...complete,
    membershipActive: false,
    membershipMatches: false,
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.createMembership, false);
  assert.equal(plan.reactivateMembership, false);
  assert.equal(plan.changed, false);
  assert.ok(
    plan.reasons.some((reason) =>
      reason.includes('Department membership exists against another'),
    ),
    plan.reasons.join('; '),
  );
});

void test('F067 scope: an unexpected extra Department or Division membership is refused', () => {
  for (const extra of [1, 3]) {
    const plan = planFixtureWrites({
      ...complete,
      unexpectedMemberships: extra,
    });
    assert.equal(plan.ok, false, String(extra));
    assert.equal(plan.changed, false);
    assert.ok(
      plan.reasons.some((reason) => reason.includes('broader than planned')),
    );
  }
  // A malformed count is refused rather than read as zero.
  for (const value of [Number.NaN, -1, 0.5, undefined])
    assert.equal(
      planFixtureWrites({
        ...complete,
        unexpectedMemberships: value as unknown as number,
      }).ok,
      false,
      String(value),
    );
});

void test('F067 scope: an inactive staff identity is refused rather than adopted', () => {
  // The snapshot reports an inactive identity as not matching.
  const plan = planFixtureWrites({ ...complete, staffMatches: false });
  assert.equal(plan.ok, false);
  assert.equal(plan.createMembership, false);
  assert.ok(FIXTURE_SOURCE.includes('staff.active,'));
});

// --- Department derivation ------------------------------------------------

void test('F067 scope: the Department is derived from the fixture Category, never hardcoded', () => {
  const ok = {
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
  };
  // No Division is needed when the Category carries none.
  assert.deepEqual(evaluateCatalogPrerequisites(ok), { ok: true, reasons: [] });
  assert.equal(
    evaluateCatalogPrerequisites({
      ...ok,
      categoryDivisionId: '22000000-0000-4000-8000-000000000001',
    }).ok,
    false,
  );
  assert.equal(
    evaluateCatalogPrerequisites({ ...ok, categoryDivisionId: undefined }).ok,
    false,
    'an unread Division is not assumed to be absent',
  );
  // Read through the Service Definition's Category, and inserted from it.
  assert.ok(FIXTURE_SOURCE.includes("'category.department_id'"));
  assert.ok(
    FIXTURE_SOURCE.includes(
      'const departmentId = String(catalog.categoryDepartmentId);',
    ),
  );
  assert.ok(FIXTURE_SOURCE.includes('department_id: departmentId,'));
});

void test('F067 scope: no Division membership is ever written', () => {
  assert.ok(
    !FIXTURE_SOURCE.includes("insertInto('staff_division_membership')"),
  );
  assert.ok(
    !FIXTURE_SOURCE.includes("updateTable('staff_division_membership')"),
  );
});

void test('F067 scope: the membership is read by its real primary key, with no status predicate', () => {
  const read =
    /selectFrom\('staff_department_membership'\)[\s\S]{0,300}?executeTakeFirst\(\)/.exec(
      FIXTURE_SOURCE,
    );
  assert.ok(read, 'the membership read was not found');
  assert.ok(read[0].includes("'staff_identity_id', '=',"));
  assert.ok(read[0].includes("'department_id', '=', departmentId"));
  assert.ok(!read[0].includes("'active', '=', true"));
  assert.ok(!read[0].includes("'organization_id', '='"));
  // The schema's key is exactly the pair the read uses.
  const migration = source(
    'migrations/20260903010000-add-staff-assignment-workflow-foundation.ts',
  );
  assert.ok(
    migration.includes('primary key (staff_identity_id,department_id)'),
  );
});

void test('F067 scope: the membership write follows the target proof and precedes the census', () => {
  const refusal = FIXTURE_SOURCE.indexOf('if (refusal !== null) throw');
  const plan = FIXTURE_SOURCE.indexOf(
    'planFixtureWrites(await readSnapshot(trx))',
  );
  const insert = FIXTURE_SOURCE.indexOf(
    ".insertInto('staff_department_membership')",
  );
  const update = FIXTURE_SOURCE.indexOf(
    ".updateTable('staff_department_membership')",
  );
  const census = FIXTURE_SOURCE.lastIndexOf('await readCensus(trx)');
  assert.ok(refusal > 0 && plan > refusal && insert > plan);
  assert.ok(update > insert && census > update);
  // The reactivation is scoped to the fixture's own key and Organization.
  const scoped = FIXTURE_SOURCE.slice(update, update + 400);
  assert.ok(
    scoped.includes("'staff_identity_id', '=', trackingUatFixture.staffId"),
  );
  assert.ok(scoped.includes("'department_id', '=', departmentId"));
  assert.ok(scoped.includes("'organization_id', '=', organizationId"));
});

// --- readiness ----------------------------------------------------------------

void test('F067 scope: correct permissions and Department reach satisfy readiness', async () => {
  assert.deepEqual(evaluateFixtureCensus(ready), { ok: true, reasons: [] });
  const { evaluateFixtureReadiness } = await harness();
  assert.deepEqual(evaluateFixtureReadiness(harnessReady), {
    ok: true,
    reasons: [],
  });
});

void test('F067 scope: both permissions without Department access are insufficient', async () => {
  // The exact pre-correction state: the grant exists, the reach does not.
  const unreachable = { ...ready, trackingStaffScopedRequests: 0 };
  const fixture = evaluateFixtureCensus(unreachable);
  assert.equal(fixture.ok, false);
  assert.equal(fixture.reasons.length, 1);
  assert.ok(fixture.reasons[0]?.includes('trackingStaffScopedRequests'));
  const { evaluateFixtureReadiness } = await harness();
  const live = evaluateFixtureReadiness({
    ...harnessReady,
    trackingStaffScopedRequests: 0,
  });
  assert.equal(live.ok, false);
  assert.ok(
    live.reasons.some((r) => r.includes('trackingStaffScopedRequests')),
  );
  // Reaching only one of the two requests is still not ready.
  assert.equal(
    evaluateFixtureCensus({ ...ready, trackingStaffScopedRequests: 1 }).ok,
    false,
  );
  assert.equal(
    evaluateFixtureReadiness({
      ...harnessReady,
      trackingStaffScopedRequests: 1,
    }).ok,
    false,
  );
});

void test('F067 scope: a fixture identity lacking its own authority is not ready', async () => {
  // Inactive identity, a missing view or tracking.manage permission, an
  // inactive assignment or role and a foreign membership all yield 0 here.
  const { evaluateFixtureReadiness } = await harness();
  assert.equal(
    evaluateFixtureCensus({ ...ready, trackingStaffAuthorized: 0 }).ok,
    false,
  );
  assert.equal(
    evaluateFixtureReadiness({ ...harnessReady, trackingStaffAuthorized: 0 })
      .ok,
    false,
  );
  // Another staff member's grant keeps `trackingManageGrants` satisfied, which
  // is precisely why it can no longer carry readiness on its own.
  assert.equal(
    evaluateFixtureCensus({
      ...ready,
      trackingManageGrants: 5,
      trackingStaffAuthorized: 0,
    }).ok,
    false,
  );
});

void test('F067 scope: both censuses require view and tracking.manage on the fixture identity itself', () => {
  for (const text of [FIXTURE_SOURCE, EFFECTS_SOURCE]) {
    const sql = flat(text);
    assert.ok(
      sql.includes(
        "p.permission_key in ('service_request.view','service_request.tracking.manage'))=2",
      ),
    );
    assert.ok(sql.includes('a.active and role.active'));
    assert.ok(sql.includes("o.status='active'"));
    assert.ok(sql.includes('m.organization_id<>s.organization_id'));
  }
  // The two keys are exactly the fixture's permissions, no more.
  assert.deepEqual([...FIXTURE_PERMISSIONS].sort(), [
    'service_request.tracking.manage',
    'service_request.view',
  ]);
  // Bound to the fixture identity, never to whoever holds a grant.
  assert.ok(FIXTURE_SOURCE.includes('where s.id=${staffId}'));
  assert.ok(FIXTURE_SOURCE.includes('m.staff_identity_id=${staffId}'));
  assert.ok(EFFECTS_SOURCE.includes('[UAT_FIXTURE_STAFF_ID]'));
});

void test('F067 scope: both censuses apply the same Department and Division rule as staffRequestScope', () => {
  // The authorization rule itself.
  assert.ok(
    SCOPE_SOURCE.includes(
      'coalesce(request.routed_department_id, category.department_id)',
    ),
  );
  assert.ok(
    SCOPE_SOURCE.includes(
      'case when request.routed_department_id is null then category.division_id else request.routed_division_id end',
    ),
  );
  for (const text of [FIXTURE_SOURCE, EFFECTS_SOURCE]) {
    const sql = flat(text);
    assert.ok(
      sql.includes('coalesce(r.routed_department_id, c.department_id) in'),
    );
    assert.ok(
      sql.includes(
        'case when r.routed_department_id is null then c.division_id else r.routed_division_id end',
      ),
    );
    // Only active memberships count, as in `resolveRequestAuthority`.
    assert.ok(
      /staff_department_membership m where m\.organization_id=r\.organization_id and m\.staff_identity_id=[^ ]+ and m\.active/.test(
        sql,
      ),
    );
    assert.ok(
      /staff_division_membership m where m\.organization_id=r\.organization_id and m\.staff_identity_id=[^ ]+ and m\.active/.test(
        sql,
      ),
    );
    assert.ok(sql.includes("r.audience='public'"));
  }
});

void test('F067 scope: the harness and fixture agree on identity and request count', async () => {
  const { UAT_FIXTURE_STAFF_ID, UAT_FIXTURE_REQUEST_COUNT } = await harness();
  assert.equal(UAT_FIXTURE_STAFF_ID, trackingUatFixture.staffId);
  assert.equal(UAT_FIXTURE_REQUEST_COUNT, trackingUatFixture.requests.length);
  assert.equal(
    FIXTURE_REQUIREMENTS.trackingStaffScopedRequests,
    trackingUatFixture.requests.length,
  );
});

// --- boundaries -----------------------------------------------------------------

void test('F067 scope: the correction binds no Entra identity and issues no credential', () => {
  for (const forbidden of [
    'entra_tenant_id:',
    'entra_object_id: ${',
    'request_tracking_credential',
    'Bearer ',
  ]) {
    assert.ok(!FIXTURE_SOURCE.includes(forbidden), forbidden);
  }
  assert.ok(FIXTURE_SOURCE.includes('entra_object_id: null'));
  assert.ok(!EFFECTS_SOURCE.includes('request_tracking_credential'));
  assert.ok(!EFFECTS_SOURCE.includes('entra_object_id'));
  // F065 automatic issuance is not touched by either file.
  assert.ok(
    !/REQRO_ENABLE_REQUESTER_INTAKE_TRACKING\s*[:=]\s*['"]?true/.test(
      FIXTURE_SOURCE + EFFECTS_SOURCE,
    ),
  );
});

void test('F067 scope: no authorization or guard source is changed by the fixture', () => {
  for (const guarded of [
    'StaffAccessGuard',
    'staffRequestScope',
    'resolveRequestAuthority',
    'assertDevelopmentDatabaseUrl',
  ]) {
    assert.ok(
      !new RegExp(`import[^;]*${guarded}`, 's').test(FIXTURE_SOURCE),
      guarded,
    );
    assert.ok(!new RegExp(`${guarded}\\s*\\(`).test(FIXTURE_SOURCE), guarded);
  }
});
