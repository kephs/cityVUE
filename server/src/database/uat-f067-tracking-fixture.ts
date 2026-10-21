/**
 * F067 — synthetic resident-tracking fixtures for a disposable UAT database.
 *
 * `seed:development` provisions the Organization, catalog and development
 * staff, but it creates no Service Request, no resident-visible update and no
 * `service_request.tracking.manage` grant, so a seeded database cannot support
 * resident tracking UAT. This module supplies exactly those records.
 *
 * Three properties shape the design.
 *
 * **The destination is proven, not assumed.** Every write happens inside one
 * transaction that first reads the in-band disposable-instance nonce, the
 * database name and the role from the server itself and compares them with the
 * nonce this session injected through `docker run`. `reqro_dev` carries no such
 * setting, so the fixture cannot run against it even if `DATABASE_URL` names
 * it. `assertDevelopmentDatabaseUrl` is neither imported nor weakened; this is
 * a second, stricter gate for a different target.
 *
 * **The catalog is read, never invented.** The Service Definition, its
 * published version, the Category and the default priority all come from rows
 * `seed:development` created. Nothing here hardcodes a Category identifier or
 * a priority, so a catalog change cannot silently produce a mismatched
 * request. Reference numbers come from `allocateConfiguredReference`, the same
 * allocator the HTTP intake path uses, so the tenant's configured policy and
 * the per-period sequence are both honoured.
 *
 * **Repetition is planned, not retried.** A snapshot of what already exists is
 * turned into an explicit plan before any write, so a second run allocates no
 * reference, inserts nothing and reports `changed: false`. Partial state is
 * completed rather than duplicated, and a fixture row that exists with
 * unexpected content is refused instead of adopted or repaired.
 *
 * **Scope is granted, not just permission.** `staffRequestScope` admits no
 * request for a staff identity without an active Department membership, so the
 * fixture also writes the one membership covering its own requests, and
 * readiness measures that the fixture identity can actually reach them.
 *
 * No credential is issued, no Entra identity is bound and no authorization
 * guard is bypassed. The synthetic staff identity is created unauthenticated
 * on purpose: `StaffAccessGuard` admits the tracking controller only on a real
 * Entra token, so binding an identity is a separate, separately authorized
 * step and this module must not pretend otherwise.
 */
import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import type { DatabaseSchema } from './database.types.js';
import { lockAuthorizationWriter } from './authorization-writer-lock.js';
import { developmentOrganization } from './development-staff-input.js';
import { allocateConfiguredReference } from '../service-request/reference-policy.repository.js';

/** The disposable database this fixture is allowed to write to. Mirrors
 * `TEST_DATABASE` in the disposable cluster helper. */
export const FIXTURE_DATABASE = 'reqro_f0592_test';
/** Databases that must never be reached, named rather than merely excluded. */
export const FORBIDDEN_DATABASES = ['reqro_dev', 'reqro_bootstrap'] as const;
const LOOPBACK = ['127.0.0.1', 'localhost', '::1', '[::1]'];
/** The native cluster's port. A fixture that reached it would not be writing
 * to a disposable instance regardless of what the database were called. */
const NATIVE_POSTGRES_PORT = '5432';

/**
 * The minimum necessary grant for resident-tracking UAT, and nothing else.
 *
 * `RequestTrackingService.state` and `.change` both assert
 * `service_request.tracking.manage`, and both first call
 * `assertStaffRequestRead(access, 'public')`, which requires
 * `requestReadPermission.public` — `service_request.view`. The staff tracking
 * controller independently annotates `service_request.view`. Two keys are
 * therefore necessary and sufficient; no issuance, communication-authoring,
 * administrative or access-management permission is granted.
 */
export const FIXTURE_PERMISSIONS = [
  'service_request.view',
  'service_request.tracking.manage',
] as const;

/** The resident-visible projection filters on exactly these three values, so
 * the fixture writes them explicitly rather than relying on column defaults. */
export const RESIDENT_VISIBLE_UPDATE = {
  direction: 'outbound',
  channel: 'portal',
  deliveryState: 'recorded',
} as const;

/** The DB-level reference safety constraint, restated so an allocated
 * reference is validated before it is inserted. */
const SAFE_REFERENCE = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;
const MAX_REFERENCE_LENGTH = 48;

export interface FixtureUpdateSpec {
  readonly submissionKey: string;
  readonly body: string;
}
export interface FixtureRequestSpec {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly enteredAddress: string;
  readonly updates: readonly FixtureUpdateSpec[];
}

/**
 * Operator-only fixture manifest. Never imported by runtime authorization.
 *
 * The identifiers continue the `seed:development` allocation convention, and
 * the role identifier continues the `93000000-…` fixture-role series that
 * `mixedAccessFixture` started. Every value is fictional.
 */
export const trackingUatFixture = {
  organizationId: developmentOrganization.id,
  /** Resolved from the catalog at run time; the key is what is fixed. */
  serviceKey: 'pothole',
  staffId: '90000000-0000-4000-8000-000000000067',
  staffDisplayName: 'Riley Tracking Operator',
  staffEmail: 'riley.tracking@example.test',
  roleId: '93000000-0000-4000-8000-000000000067',
  roleName: 'F067 resident tracking UAT fixture',
  description: JSON.stringify({
    source: 'F067_RESIDENT_TRACKING_UAT',
    version: 1,
    target: '90000000-0000-4000-8000-000000000067',
    permissions: [...FIXTURE_PERMISSIONS],
  }),
  requests: [
    {
      id: '70000000-0000-4000-8000-000000000067',
      label: 'with resident-visible updates',
      description:
        'Synthetic F067 UAT request: a pothole in the northbound lane near the ' +
        'fictional Example Avenue crossing. Development fixture data only.',
      enteredAddress: '100 Example Avenue, Development Test City',
      updates: [
        {
          submissionKey: '74000000-0000-4000-8000-000000000067',
          body:
            'Thank you for the report. A crew has been scheduled to inspect ' +
            'the roadway. This is synthetic development correspondence.',
        },
        {
          submissionKey: '74000000-0000-4000-8000-000000000068',
          body:
            'The inspection is complete and a repair has been added to the ' +
            'paving schedule. This is synthetic development correspondence.',
        },
      ],
    },
    {
      id: '70000000-0000-4000-8000-000000000068',
      label: 'without resident-visible updates',
      description:
        'Synthetic F067 UAT request: broken pavement on the fictional Example ' +
        'Park service road, reported with no correspondence yet. Development ' +
        'fixture data only.',
      enteredAddress: '200 Example Park Road, Development Test City',
      updates: [],
    },
  ],
} as const satisfies {
  organizationId: string;
  serviceKey: string;
  staffId: string;
  staffDisplayName: string;
  staffEmail: string;
  roleId: string;
  roleName: string;
  description: string;
  requests: readonly FixtureRequestSpec[];
};

/** Every resident-visible update the manifest declares, flattened to the keys
 * the snapshot and the plan use. */
export function fixtureUpdateKeys(): string[] {
  return trackingUatFixture.requests.flatMap((request) =>
    request.updates.map((update) => `${request.id}:${update.submissionKey}`),
  );
}

// --- destination verdict ---------------------------------------------------

export interface FixtureTargetFacts {
  /** The connection string. Never logged; only its structure is read. */
  readonly url: unknown;
  /** `current_database()`, read from the server. */
  readonly sqlDatabase: unknown;
  /** `current_user`, read from the server. */
  readonly sqlUser: unknown;
  /** `current_setting('reqro.disposable_nonce', true)`, read from the server. */
  readonly sqlNonce: unknown;
  /** The nonce this session injected out of band through `docker run`. */
  readonly expectedNonce: unknown;
  /** The disposable test role the cluster helper created. */
  readonly expectedRole: unknown;
}

/**
 * Refuses unless the connection provably reaches this session's disposable
 * instance. Returns the first refusal reason, or `null` to proceed.
 *
 * The nonce is the unforgeable part: it is a PostgreSQL server setting that
 * only `docker run -c reqro.disposable_nonce=…` could have placed, read back
 * in band. The host, port, database and role checks are cheap structural
 * guards in front of it, and an empty expectation is refused explicitly so it
 * cannot compare equal to an absent setting.
 */
export function evaluateFixtureTarget(
  facts: FixtureTargetFacts | null | undefined,
): string | null {
  if (facts === null || facts === undefined || typeof facts !== 'object')
    return 'no fixture target facts were supplied';
  const expectedNonce = facts.expectedNonce;
  const expectedRole = facts.expectedRole;
  if (typeof expectedNonce !== 'string' || expectedNonce.trim() === '')
    return 'the expected disposable-instance nonce is missing or empty';
  if (typeof expectedRole !== 'string' || expectedRole.trim() === '')
    return 'the expected disposable role is missing or empty';
  if (typeof facts.url !== 'string' || facts.url.trim() === '')
    return 'no database URL was supplied';
  let url: URL;
  try {
    url = new URL(facts.url);
  } catch {
    return 'the database URL could not be parsed';
  }
  if (!LOOPBACK.includes(url.hostname))
    return 'the database host must be loopback';
  if (url.port === NATIVE_POSTGRES_PORT || url.port === '')
    return 'the database port must be the disposable published port, not 5432';
  const named = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (FORBIDDEN_DATABASES.some((database) => database === named))
    return `the fixture refuses to write to the persistent database ${named}`;
  if (named !== FIXTURE_DATABASE)
    return `the URL database must be ${FIXTURE_DATABASE}, got ${named}`;
  if (decodeURIComponent(url.username) !== expectedRole)
    return 'the URL role is not the disposable test role';
  if (facts.sqlDatabase !== FIXTURE_DATABASE)
    return `the server reports a database other than ${FIXTURE_DATABASE}`;
  if (facts.sqlUser !== expectedRole)
    return 'the server reports a role other than the disposable test role';
  if (facts.sqlNonce === null || facts.sqlNonce === undefined)
    return 'the server exposes no disposable-instance nonce';
  if (typeof facts.sqlNonce !== 'string' || facts.sqlNonce.trim() === '')
    return 'the server reports an empty disposable-instance nonce';
  if (facts.sqlNonce !== expectedNonce)
    return 'the server nonce does not match this session';
  return null;
}

/** Validates an allocated reference against the database constraint before it
 * is used. A reference that cannot be inserted must fail here, where the
 * reason is legible, rather than as a constraint violation. */
export function evaluateAllocatedReference(reference: unknown): string | null {
  if (typeof reference !== 'string' || reference === '')
    return 'the allocator returned no reference number';
  if (reference.length > MAX_REFERENCE_LENGTH)
    return 'the allocated reference exceeds the stored reference length';
  if (!SAFE_REFERENCE.test(reference))
    return 'the allocated reference does not match the safe reference pattern';
  return null;
}

// --- catalog prerequisites -------------------------------------------------

export interface FixtureCatalogFacts {
  readonly organizationStatus: unknown;
  readonly organizationName: unknown;
  readonly organizationSlug: unknown;
  readonly businessTimezone: unknown;
  readonly serviceDefinitionId: unknown;
  readonly versionId: unknown;
  readonly categoryId: unknown;
  readonly defaultPriority: unknown;
  readonly versionStatus: unknown;
  readonly trackingPolicyPresent: unknown;
  /** The Category's Department. The fixture requests are never routed, so
   * this is the Department `staffRequestScope` matches them against. */
  readonly categoryDepartmentId: unknown;
  /** The Category's Division, which must be null: a Division would require a
   * Division membership, and the fixture grants none. */
  readonly categoryDivisionId: unknown;
}
export interface Verdict {
  readonly ok: boolean;
  readonly reasons: readonly string[];
}

/**
 * Requires the seeded catalog the fixture builds on. Each reason names a
 * concrete missing prerequisite, because the operator's next action differs:
 * a missing catalog means `seed:development` has not run, while a missing
 * tracking policy means the F065 migration did not reach this database.
 */
export function evaluateCatalogPrerequisites(
  facts: FixtureCatalogFacts | null | undefined,
): Verdict {
  if (facts === null || facts === undefined || typeof facts !== 'object')
    return { ok: false, reasons: ['no catalog facts were supplied'] };
  const reasons: string[] = [];
  if (facts.organizationStatus !== 'active')
    reasons.push('the development Organization is not active');
  if (facts.organizationName !== developmentOrganization.name)
    reasons.push('the Organization name is not the seeded development name');
  if (facts.organizationSlug !== developmentOrganization.slug)
    reasons.push('the Organization slug is not the seeded development slug');
  if (
    typeof facts.businessTimezone !== 'string' ||
    facts.businessTimezone.trim() === ''
  )
    reasons.push('the Organization has no business timezone');
  const catalog = [
    ['serviceDefinitionId', 'Service Definition'],
    ['versionId', 'published Service Definition version'],
    ['categoryId', 'Category'],
  ] as const;
  for (const [key, label] of catalog) {
    const value = facts[key];
    if (typeof value !== 'string' || value.trim() === '')
      reasons.push(
        `the seeded ${label} for ${trackingUatFixture.serviceKey} is missing`,
      );
  }
  if (facts.versionStatus !== 'published')
    reasons.push(
      `the ${trackingUatFixture.serviceKey} Service Definition version is not published`,
    );
  if (
    typeof facts.defaultPriority !== 'string' ||
    facts.defaultPriority.trim() === ''
  )
    reasons.push('the Service Definition version has no default priority');
  if (facts.trackingPolicyPresent !== true)
    reasons.push(
      'the Organization has no request_tracking_policy row, so the F065 migration did not reach this database',
    );
  if (
    typeof facts.categoryDepartmentId !== 'string' ||
    facts.categoryDepartmentId.trim() === ''
  )
    reasons.push(
      `the ${trackingUatFixture.serviceKey} Category has no Department, so no staff scope can cover its requests`,
    );
  if (facts.categoryDivisionId !== null)
    reasons.push(
      `the ${trackingUatFixture.serviceKey} Category carries a Division, which would require a Division membership the fixture does not grant`,
    );
  return { ok: reasons.length === 0, reasons };
}

// --- idempotent plan -------------------------------------------------------

export interface FixtureSnapshot {
  readonly staffPresent: boolean;
  readonly staffMatches: boolean;
  readonly rolePresent: boolean;
  readonly roleMatches: boolean;
  readonly rolePermissions: readonly string[];
  /**
   * Read by the assignment's real primary key, `(staff_identity_id, role_id)`,
   * with no status predicate. Reading only active rows would report an
   * inactive assignment as absent and the plan would then attempt an insert
   * that the primary key refuses, so presence and activity are separate facts.
   */
  readonly assignmentPresent: boolean;
  readonly assignmentActive: boolean;
  readonly assignmentMatches: boolean;
  /**
   * The Department membership, read by its real primary key,
   * `(staff_identity_id, department_id)`, again with no status predicate.
   * `staffRequestScope` admits nothing for a staff identity without an active
   * membership, so the role grant alone never reaches a request.
   */
  readonly membershipPresent: boolean;
  readonly membershipActive: boolean;
  readonly membershipMatches: boolean;
  /** Any other Department or Division membership the fixture identity holds.
   * The fixture creates exactly one, so another means something else wrote it. */
  readonly unexpectedMemberships: number;
  readonly requestsPresent: readonly string[];
  readonly activityPresent: readonly string[];
  readonly operationalPresent: readonly string[];
  readonly locationPresent: readonly string[];
  readonly updatesPresent: readonly string[];
}
export interface FixturePlan {
  readonly ok: boolean;
  readonly reasons: readonly string[];
  readonly createStaff: boolean;
  readonly createRole: boolean;
  readonly grantPermissions: readonly string[];
  readonly createAssignment: boolean;
  /** An existing assignment that is merely inactive is reactivated in place. */
  readonly reactivateAssignment: boolean;
  readonly createMembership: boolean;
  /** Likewise for the Department membership. These two reactivations are the
   * only updates this fixture performs. */
  readonly reactivateMembership: boolean;
  readonly createRequests: readonly string[];
  readonly createActivity: readonly string[];
  readonly createOperational: readonly string[];
  readonly createLocation: readonly string[];
  readonly createUpdates: readonly string[];
  /** Exactly the number of references the run will allocate. A repeat run
   * must plan zero, which is what makes repetition observably free. */
  readonly referenceAllocations: number;
  readonly changed: boolean;
}

const stringList = (value: readonly string[] | undefined): string[] =>
  Array.isArray(value)
    ? value.filter((entry) => typeof entry === 'string')
    : [];

/**
 * Turns a snapshot into the exact set of writes to perform.
 *
 * An existing fixture row whose content does not match the manifest is a
 * refusal, not a repair: this fixture owns these identifiers, so unexpected
 * content means something else wrote them and overwriting it would destroy
 * evidence. A row that is simply absent is created, which is how a run
 * interrupted midway completes without duplicating anything.
 */
export function planFixtureWrites(
  snapshot: FixtureSnapshot | null | undefined,
): FixturePlan {
  const empty = {
    createStaff: false,
    createRole: false,
    grantPermissions: [] as readonly string[],
    createAssignment: false,
    reactivateAssignment: false,
    createMembership: false,
    reactivateMembership: false,
    createRequests: [] as readonly string[],
    createActivity: [] as readonly string[],
    createOperational: [] as readonly string[],
    createLocation: [] as readonly string[],
    createUpdates: [] as readonly string[],
    referenceAllocations: 0,
    changed: false,
  };
  if (
    snapshot === null ||
    snapshot === undefined ||
    typeof snapshot !== 'object'
  )
    return {
      ...empty,
      ok: false,
      reasons: ['no fixture snapshot was supplied'],
    };
  const reasons: string[] = [];
  if (snapshot.staffPresent && !snapshot.staffMatches)
    reasons.push(
      'the synthetic staff identity exists with unexpected content; no adoption or repair is permitted',
    );
  if (snapshot.rolePresent && !snapshot.roleMatches)
    reasons.push(
      'the fixture role exists with unexpected content; no adoption or repair is permitted',
    );
  const held = stringList(snapshot.rolePermissions);
  const unexpected = held.filter(
    (key) => !FIXTURE_PERMISSIONS.some((allowed) => allowed === key),
  );
  if (unexpected.length)
    reasons.push(
      `the fixture role holds ${String(unexpected.length)} permission(s) outside the approved fixture scope`,
    );
  if (snapshot.assignmentPresent && !snapshot.assignmentMatches)
    reasons.push(
      'the fixture role assignment exists against another Organization; no adoption or repair is permitted',
    );
  if (snapshot.membershipPresent && !snapshot.membershipMatches)
    reasons.push(
      'the fixture Department membership exists against another Organization; no adoption or repair is permitted',
    );
  if (
    typeof snapshot.unexpectedMemberships !== 'number' ||
    !Number.isInteger(snapshot.unexpectedMemberships) ||
    snapshot.unexpectedMemberships !== 0
  )
    reasons.push(
      'the synthetic staff identity holds a Department or Division membership the fixture did not create; its scope would be broader than planned',
    );
  if (reasons.length) return { ...empty, ok: false, reasons };

  const ids = trackingUatFixture.requests.map((request) => request.id);
  const missing = (existing: readonly string[]): string[] =>
    ids.filter((id) => !existing.includes(id));
  const createRequests = missing(stringList(snapshot.requestsPresent));
  const grantPermissions = FIXTURE_PERMISSIONS.filter(
    (key) => !held.includes(key),
  );
  const presentUpdates = stringList(snapshot.updatesPresent);
  const createUpdates = fixtureUpdateKeys().filter(
    (key) => !presentUpdates.includes(key),
  );
  const createActivity = missing(stringList(snapshot.activityPresent));
  const createOperational = missing(stringList(snapshot.operationalPresent));
  const createLocation = missing(stringList(snapshot.locationPresent));
  const createStaff = !snapshot.staffPresent;
  const createRole = !snapshot.rolePresent;
  // The assignment's primary key is `(staff_identity_id, role_id)`, so an
  // inactive row occupies the key an insert would need. It is reactivated in
  // place instead, which keeps the grant exactly as narrow as it was.
  const createAssignment = !snapshot.assignmentPresent;
  const reactivateAssignment =
    snapshot.assignmentPresent && !snapshot.assignmentActive;
  // The membership's primary key is `(staff_identity_id, department_id)`; the
  // same reasoning applies, and the update touches `active` alone.
  const createMembership = !snapshot.membershipPresent;
  const reactivateMembership =
    snapshot.membershipPresent && !snapshot.membershipActive;
  return {
    ok: true,
    reasons: [],
    createStaff,
    createRole,
    grantPermissions,
    createAssignment,
    reactivateAssignment,
    createMembership,
    reactivateMembership,
    createRequests,
    createActivity,
    createOperational,
    createLocation,
    createUpdates,
    referenceAllocations: createRequests.length,
    changed:
      createStaff ||
      createRole ||
      createAssignment ||
      reactivateAssignment ||
      createMembership ||
      reactivateMembership ||
      grantPermissions.length > 0 ||
      createRequests.length > 0 ||
      createActivity.length > 0 ||
      createOperational.length > 0 ||
      createLocation.length > 0 ||
      createUpdates.length > 0,
  };
}

// --- census ----------------------------------------------------------------

/**
 * What must exist before a session may report itself ready for resident
 * tracking UAT. Derived from the manifest, so adding a request or an update to
 * the manifest raises the requirement rather than leaving it stale.
 */
export const FIXTURE_REQUIREMENTS = {
  publicRequestsWithUpdates: trackingUatFixture.requests.filter(
    (request) => request.updates.length > 0,
  ).length,
  publicRequestsWithoutUpdates: trackingUatFixture.requests.filter(
    (request) => request.updates.length === 0,
  ).length,
  residentVisibleUpdates: fixtureUpdateKeys().length,
  trackingManageGrants: 1,
  staffIdentities: 1,
  /**
   * 1 when the fixture's own staff identity is active in the Organization and
   * effectively holds both `FIXTURE_PERMISSIONS` through an active assignment
   * to an active role, and holds no membership in another Organization.
   * Another staff member's grant never satisfies it.
   */
  trackingStaffAuthorized: 1,
  /**
   * The fixture's PUBLIC requests that the fixture staff identity's own
   * active memberships bring into `staffRequestScope`. A role grant without a
   * covering Department membership reaches none of them, which is exactly the
   * gap this count closes.
   */
  trackingStaffScopedRequests: trackingUatFixture.requests.length,
} as const;

export type FixtureCensusKey = keyof typeof FIXTURE_REQUIREMENTS;

/**
 * Refuses unless the live counts meet every requirement. This runs after the
 * writes, inside the same transaction, so a partial provisioning rolls back
 * instead of reporting a ready session.
 */
export function evaluateFixtureCensus(
  counts: Partial<Record<FixtureCensusKey, unknown>> | null | undefined,
): Verdict {
  if (counts === null || counts === undefined || typeof counts !== 'object')
    return { ok: false, reasons: ['no fixture census was supplied'] };
  const reasons: string[] = [];
  for (const [key, minimum] of Object.entries(FIXTURE_REQUIREMENTS)) {
    const value = counts[key as FixtureCensusKey];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
      reasons.push(`the ${key} count is missing or not a non-negative integer`);
    else if (value < minimum)
      reasons.push(
        `expected at least ${String(minimum)} ${key}, got ${String(value)}`,
      );
  }
  return { ok: reasons.length === 0, reasons };
}

// --- execution -------------------------------------------------------------
// Everything above decides; everything below reads and writes. The writes are
// driven entirely by the plan, so the decisions are provable offline.

type Trx = Transaction<DatabaseSchema>;

/** Reads the destination facts from the server itself. Never returns the URL. */
export async function readTargetFacts(
  trx: Trx,
  url: string,
  expectedNonce: string,
  expectedRole: string,
): Promise<FixtureTargetFacts> {
  const probe = await sql<{
    database: string;
    role: string;
    nonce: string | null;
  }>`select current_database() as database, current_user as role, current_setting('reqro.disposable_nonce', true) as nonce`.execute(
    trx,
  );
  const row = probe.rows[0];
  return {
    url,
    sqlDatabase: row?.database ?? null,
    sqlUser: row?.role ?? null,
    sqlNonce: row?.nonce ?? null,
    expectedNonce,
    expectedRole,
  };
}

/**
 * The Department and Division of the fixture's Category, read through the
 * same Service Definition the requests are written against. Both the
 * prerequisites and the snapshot use it, so the membership the plan checks is
 * the one the requests will actually need.
 */
async function readCategoryScope(
  trx: Trx,
): Promise<{ departmentId: string | null; divisionId: string | null }> {
  const row = await trx
    .selectFrom('service_definition as definition')
    .innerJoin('category', (join) =>
      join
        .onRef('category.id', '=', 'definition.category_id')
        .onRef('category.organization_id', '=', 'definition.organization_id'),
    )
    .select(['category.department_id', 'category.division_id'])
    .where('definition.organization_id', '=', trackingUatFixture.organizationId)
    .where('definition.service_key', '=', trackingUatFixture.serviceKey)
    .executeTakeFirst();
  return {
    departmentId: row?.department_id ?? null,
    divisionId: row?.division_id ?? null,
  };
}

async function readCatalog(trx: Trx): Promise<FixtureCatalogFacts> {
  const organization = await trx
    .selectFrom('organization')
    .select(['status', 'name', 'slug', 'default_business_timezone'])
    .where('id', '=', trackingUatFixture.organizationId)
    .executeTakeFirst();
  // The published version is whichever row the Service Definition points at,
  // which is the same notion the runtime catalog uses. Its status is then
  // asserted rather than assumed, so a definition pointing at a draft is a
  // legible prerequisite failure instead of a mismatched request.
  const version = await trx
    .selectFrom('service_definition as definition')
    .innerJoin('service_definition_version as version', (join) =>
      join
        .onRef('version.id', '=', 'definition.current_published_version_id')
        .onRef('version.organization_id', '=', 'definition.organization_id'),
    )
    .select([
      'definition.id as service_definition_id',
      'definition.category_id as category_id',
      'version.id as version_id',
      'version.status as version_status',
      'version.default_priority as default_priority',
    ])
    .where('definition.organization_id', '=', trackingUatFixture.organizationId)
    .where('definition.service_key', '=', trackingUatFixture.serviceKey)
    .executeTakeFirst();
  const policy = await trx
    .selectFrom('request_tracking_policy')
    .select('organization_id')
    .where('organization_id', '=', trackingUatFixture.organizationId)
    .executeTakeFirst();
  const scope = await readCategoryScope(trx);
  return {
    organizationStatus: organization?.status ?? null,
    organizationName: organization?.name ?? null,
    organizationSlug: organization?.slug ?? null,
    businessTimezone: organization?.default_business_timezone ?? null,
    serviceDefinitionId: version?.service_definition_id ?? null,
    versionId: version?.version_id ?? null,
    categoryId: version?.category_id ?? null,
    defaultPriority: version?.default_priority ?? null,
    versionStatus: version?.version_status ?? null,
    trackingPolicyPresent: policy !== undefined,
    categoryDepartmentId: scope.departmentId,
    categoryDivisionId: scope.divisionId,
  };
}

async function readSnapshot(trx: Trx): Promise<FixtureSnapshot> {
  const organizationId = trackingUatFixture.organizationId;
  const ids = trackingUatFixture.requests.map((request) => request.id);
  const staff = await trx
    .selectFrom('staff_identity')
    .select(['display_name', 'email', 'active', 'organization_id'])
    .where('id', '=', trackingUatFixture.staffId)
    .executeTakeFirst();
  const role = await trx
    .selectFrom('role')
    .select(['name', 'description', 'active', 'organization_id'])
    .where('id', '=', trackingUatFixture.roleId)
    .executeTakeFirst();
  const permissions = await trx
    .selectFrom('role_permission')
    .select('permission_key')
    .where('organization_id', '=', organizationId)
    .where('role_id', '=', trackingUatFixture.roleId)
    .execute();
  // By the real primary key, `(staff_identity_id, role_id)`, and with no
  // status predicate: an inactive row still occupies that key.
  const assignment = await trx
    .selectFrom('staff_role_assignment')
    .select(['role_id', 'active', 'organization_id'])
    .where('staff_identity_id', '=', trackingUatFixture.staffId)
    .where('role_id', '=', trackingUatFixture.roleId)
    .executeTakeFirst();
  // By the membership's real primary key, `(staff_identity_id, department_id)`,
  // with no status or Organization predicate, so an inactive or misplaced row
  // is seen rather than mistaken for an absent one.
  const { departmentId } = await readCategoryScope(trx);
  const membership = departmentId
    ? await trx
        .selectFrom('staff_department_membership')
        .select(['active', 'organization_id'])
        .where('staff_identity_id', '=', trackingUatFixture.staffId)
        .where('department_id', '=', departmentId)
        .executeTakeFirst()
    : undefined;
  let others = trx
    .selectFrom('staff_department_membership')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('staff_identity_id', '=', trackingUatFixture.staffId);
  if (departmentId) others = others.where('department_id', '<>', departmentId);
  const otherDepartments = await others.executeTakeFirst();
  const divisions = await trx
    .selectFrom('staff_division_membership')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('staff_identity_id', '=', trackingUatFixture.staffId)
    .executeTakeFirst();
  const requests = await trx
    .selectFrom('service_request')
    .select('id')
    .where('organization_id', '=', organizationId)
    .where('id', 'in', ids)
    .execute();
  const activity = await trx
    .selectFrom('activity')
    .select('service_request_id')
    .where('organization_id', '=', organizationId)
    .where('service_request_id', 'in', ids)
    .where('activity_type', '=', 'service_request_created')
    .execute();
  const operational = await trx
    .selectFrom('request_operational_activity')
    .select('service_request_id')
    .where('organization_id', '=', organizationId)
    .where('service_request_id', 'in', ids)
    .where('activity_type', '=', 'request_created')
    .execute();
  const location = await trx
    .selectFrom('location')
    .select('service_request_id')
    .where('organization_id', '=', organizationId)
    .where('service_request_id', 'in', ids)
    .execute();
  const updates = await trx
    .selectFrom('request_communication')
    .select(['service_request_id', 'submission_key'])
    .where('organization_id', '=', organizationId)
    .where('service_request_id', 'in', ids)
    .where('author_staff_identity_id', '=', trackingUatFixture.staffId)
    .execute();
  return {
    staffPresent: staff !== undefined,
    staffMatches:
      staff?.organization_id === organizationId &&
      staff.display_name === trackingUatFixture.staffDisplayName &&
      staff.email === trackingUatFixture.staffEmail &&
      staff.active,
    rolePresent: role !== undefined,
    roleMatches:
      role?.organization_id === organizationId &&
      role.name === trackingUatFixture.roleName &&
      role.description === trackingUatFixture.description &&
      role.active,
    rolePermissions: permissions.map((row) => row.permission_key),
    assignmentPresent: assignment !== undefined,
    assignmentActive: assignment?.active === true,
    assignmentMatches: assignment?.organization_id === organizationId,
    membershipPresent: membership !== undefined,
    membershipActive: membership?.active === true,
    membershipMatches: membership?.organization_id === organizationId,
    unexpectedMemberships: (otherDepartments?.n ?? 0) + (divisions?.n ?? 0),
    requestsPresent: requests.map((row) => row.id),
    activityPresent: activity.map((row) => row.service_request_id),
    operationalPresent: operational.map((row) => row.service_request_id),
    locationPresent: location.map((row) => row.service_request_id),
    updatesPresent: updates.map(
      (row) => `${row.service_request_id}:${row.submission_key}`,
    ),
  };
}

/**
 * Readiness is measured with the rules authorization itself applies, for the
 * fixture's own staff identity only. Effective permissions mirror
 * `effectivePermissionContributions`: an active assignment to an active role.
 * Request scope mirrors `staffRequestScope`: the request's Department,
 * `coalesce(routed_department_id, category.department_id)`, must be one of the
 * identity's active memberships, and its Division must be null or one of its
 * active Division memberships. The session harness measures the same two facts
 * independently in `uat-f067-effects.mjs`.
 */
async function readCensus(trx: Trx): Promise<Record<FixtureCensusKey, number>> {
  const organizationId = trackingUatFixture.organizationId;
  const staffId = trackingUatFixture.staffId;
  const requestIds = sql.join(
    trackingUatFixture.requests.map((request) => request.id),
  );
  const counts = await sql<{
    with_updates: number;
    without_updates: number;
    updates: number;
    grants: number;
    staff: number;
    staff_authorized: number;
    scoped_requests: number;
  }>`
    select
      (select count(*)::int from service_request r where r.organization_id=${organizationId}
        and r.audience='public'
        and exists(select 1 from request_communication m where m.organization_id=r.organization_id
          and m.service_request_id=r.id and m.direction='outbound' and m.channel='portal'
          and m.delivery_state='recorded')) as with_updates,
      (select count(*)::int from service_request r where r.organization_id=${organizationId}
        and r.audience='public'
        and not exists(select 1 from request_communication m where m.organization_id=r.organization_id
          and m.service_request_id=r.id and m.direction='outbound' and m.channel='portal'
          and m.delivery_state='recorded')) as without_updates,
      (select count(*)::int from request_communication m where m.organization_id=${organizationId}
        and m.direction='outbound' and m.channel='portal' and m.delivery_state='recorded') as updates,
      (select count(*)::int from staff_role_assignment a
        join role_permission p on p.organization_id=a.organization_id and p.role_id=a.role_id
        join role on role.organization_id=a.organization_id and role.id=a.role_id
        where a.organization_id=${organizationId} and a.active and role.active
          and p.permission_key='service_request.tracking.manage') as grants,
      (select count(*)::int from staff_identity s where s.organization_id=${organizationId}
        and s.id=${trackingUatFixture.staffId} and s.active) as staff,
      (select count(*)::int from staff_identity s
        join organization o on o.id=s.organization_id
        where s.id=${staffId} and s.organization_id=${organizationId} and s.active
          and o.status='active'
          and (select count(distinct p.permission_key) from staff_role_assignment a
            join role on role.organization_id=a.organization_id and role.id=a.role_id
            join role_permission p on p.organization_id=a.organization_id and p.role_id=a.role_id
            where a.organization_id=s.organization_id and a.staff_identity_id=s.id
              and a.active and role.active
              and p.permission_key in ('service_request.view','service_request.tracking.manage'))=2
          and not exists(select 1 from staff_department_membership m
            where m.staff_identity_id=s.id and m.organization_id<>s.organization_id)
          and not exists(select 1 from staff_division_membership m
            where m.staff_identity_id=s.id and m.organization_id<>s.organization_id)) as staff_authorized,
      (select count(*)::int from service_request r
        join category c on c.organization_id=r.organization_id and c.id=r.category_id
        where r.organization_id=${organizationId} and r.audience='public' and r.id in (${requestIds})
          and coalesce(r.routed_department_id, c.department_id) in (
            select m.department_id from staff_department_membership m
            where m.organization_id=r.organization_id and m.staff_identity_id=${staffId} and m.active)
          and ((case when r.routed_department_id is null then c.division_id else r.routed_division_id end) is null
            or (case when r.routed_department_id is null then c.division_id else r.routed_division_id end) in (
              select m.division_id from staff_division_membership m
              where m.organization_id=r.organization_id and m.staff_identity_id=${staffId} and m.active))) as scoped_requests
  `.execute(trx);
  const row = counts.rows[0];
  // Each column is cast to `int` in SQL, so the driver returns a number.
  // `count(*)` alone would arrive as a string from int8.
  return {
    publicRequestsWithUpdates: row?.with_updates ?? 0,
    publicRequestsWithoutUpdates: row?.without_updates ?? 0,
    residentVisibleUpdates: row?.updates ?? 0,
    trackingManageGrants: row?.grants ?? 0,
    staffIdentities: row?.staff ?? 0,
    trackingStaffAuthorized: row?.staff_authorized ?? 0,
    trackingStaffScopedRequests: row?.scoped_requests ?? 0,
  };
}

export interface FixtureReport {
  readonly changed: boolean;
  readonly plan: FixturePlan;
  readonly census: Record<FixtureCensusKey, number>;
  /** Allocated references, safe to print: a reference is not a credential. */
  readonly references: Readonly<Record<string, string>>;
  readonly staffAuthenticated: false;
  readonly credentialsIssued: 0;
}

/**
 * Provisions the F067 UAT fixtures inside one transaction.
 *
 * Order matters. The destination is proven first, so no later statement can
 * run against the wrong database. The catalog is read next, because every
 * request derives its Category, version and priority from it. The snapshot and
 * plan come before any write, so repetition is decided rather than discovered
 * through conflict handling. The census is read last and refused if short,
 * which rolls the whole transaction back rather than leaving half a fixture.
 */
export async function provisionTrackingUatFixture(
  trx: Trx,
  options: {
    readonly url: string;
    readonly expectedNonce: string;
    readonly expectedRole: string;
    readonly now?: Date;
  },
): Promise<FixtureReport> {
  const refusal = evaluateFixtureTarget(
    await readTargetFacts(
      trx,
      options.url,
      options.expectedNonce,
      options.expectedRole,
    ),
  );
  if (refusal !== null) throw new Error(`Fixture target refused: ${refusal}`);

  const organizationId = trackingUatFixture.organizationId;
  const catalog = await readCatalog(trx);
  const prerequisites = evaluateCatalogPrerequisites(catalog);
  if (!prerequisites.ok)
    throw new Error(
      `Fixture prerequisites are missing: ${prerequisites.reasons.join('; ')}`,
    );
  const serviceDefinitionId = String(catalog.serviceDefinitionId);
  const versionId = String(catalog.versionId);
  const categoryId = String(catalog.categoryId);
  const priority = String(catalog.defaultPriority);
  const zone = String(catalog.businessTimezone);
  const departmentId = String(catalog.categoryDepartmentId);

  await lockAuthorizationWriter(trx, organizationId);
  const plan = planFixtureWrites(await readSnapshot(trx));
  if (!plan.ok)
    throw new Error(`Fixture plan refused: ${plan.reasons.join('; ')}`);

  if (plan.createStaff)
    await trx
      .insertInto('staff_identity')
      .values({
        id: trackingUatFixture.staffId,
        organization_id: organizationId,
        // Deliberately unbound: this identity is not authenticated and must
        // not be presented as such. Binding Entra is a separate authorization.
        entra_object_id: null,
        display_name: trackingUatFixture.staffDisplayName,
        email: trackingUatFixture.staffEmail,
        active: true,
      })
      .execute();
  if (plan.createRole)
    await trx
      .insertInto('role')
      .values({
        id: trackingUatFixture.roleId,
        organization_id: organizationId,
        name: trackingUatFixture.roleName,
        description: trackingUatFixture.description,
        active: true,
      })
      .execute();
  if (plan.grantPermissions.length) {
    await trx
      .insertInto('permission')
      .values(
        plan.grantPermissions.map((permission_key) => ({ permission_key })),
      )
      .onConflict((oc) => oc.column('permission_key').doNothing())
      .execute();
    await trx
      .insertInto('role_permission')
      .values(
        plan.grantPermissions.map((permission_key) => ({
          organization_id: organizationId,
          role_id: trackingUatFixture.roleId,
          permission_key,
        })),
      )
      .execute();
  }
  if (plan.createAssignment)
    await trx
      .insertInto('staff_role_assignment')
      .values({
        organization_id: organizationId,
        staff_identity_id: trackingUatFixture.staffId,
        role_id: trackingUatFixture.roleId,
        active: true,
      })
      .execute();
  else if (plan.reactivateAssignment)
    // Scoped to this one primary key and to the `active` column alone. The
    // role's permissions are not touched, so reactivation cannot broaden the
    // grant; it restores exactly the assignment the fixture already owned.
    await trx
      .updateTable('staff_role_assignment')
      .set({ active: true })
      .where('staff_identity_id', '=', trackingUatFixture.staffId)
      .where('role_id', '=', trackingUatFixture.roleId)
      .where('organization_id', '=', organizationId)
      .execute();
  // The one Department membership that brings the fixture's own requests into
  // `staffRequestScope`. No Division membership is written: the prerequisites
  // already refused a Category that carries a Division.
  if (plan.createMembership)
    await trx
      .insertInto('staff_department_membership')
      .values({
        organization_id: organizationId,
        staff_identity_id: trackingUatFixture.staffId,
        department_id: departmentId,
        active: true,
      })
      .execute();
  else if (plan.reactivateMembership)
    // Scoped to this one primary key and to `active` alone, exactly like the
    // assignment above: no other membership or Department is touched.
    await trx
      .updateTable('staff_department_membership')
      .set({ active: true })
      .where('staff_identity_id', '=', trackingUatFixture.staffId)
      .where('department_id', '=', departmentId)
      .where('organization_id', '=', organizationId)
      .execute();

  const references: Record<string, string> = {};
  const now = options.now ?? new Date();
  for (const request of trackingUatFixture.requests) {
    if (plan.createRequests.includes(request.id)) {
      const reference = await allocateConfiguredReference(
        trx,
        organizationId,
        now,
        zone,
      );
      const invalid = evaluateAllocatedReference(reference);
      if (invalid !== null)
        throw new Error(`Allocated reference refused: ${invalid}`);
      references[request.id] = reference;
      await trx
        .insertInto('service_request')
        .values({
          id: request.id,
          organization_id: organizationId,
          reference_number: reference,
          service_definition_id: serviceDefinitionId,
          service_definition_version_id: versionId,
          category_id: categoryId,
          status: 'open',
          priority,
          description: request.description,
          reporting_identity: 'anonymous',
          audience: 'public',
          intake_channel: 'web',
          submitted_by_staff_identity_id: null,
          requester_staff_identity_id: null,
        })
        .execute();
    }
    if (plan.createLocation.includes(request.id))
      await trx
        .insertInto('location')
        .values({
          id: randomUUID(),
          organization_id: organizationId,
          service_request_id: request.id,
          entered_address: request.enteredAddress,
          normalized_address: null,
          latitude: null,
          longitude: null,
          location_type: 'entered_address',
        })
        .execute();
    if (plan.createActivity.includes(request.id))
      await trx
        .insertInto('activity')
        .values({
          id: randomUUID(),
          organization_id: organizationId,
          service_request_id: request.id,
          activity_type: 'service_request_created',
          actor_type: 'anonymous_resident',
          actor_reference: null,
          staff_identity_id: null,
          metadata: {
            audience: 'public',
            intakeChannel: 'web',
            source: 'F067_RESIDENT_TRACKING_UAT',
          },
        })
        .execute();
    if (plan.createOperational.includes(request.id))
      await trx
        .insertInto('request_operational_activity')
        .values({
          organization_id: organizationId,
          service_request_id: request.id,
          activity_type: 'request_created',
          actor_type: 'anonymous_resident',
          staff_identity_id: null,
          request_revision: 1,
          intake_channel: 'web',
        })
        .execute();
    const pending = request.updates.filter((update) =>
      plan.createUpdates.includes(`${request.id}:${update.submissionKey}`),
    );
    if (pending.length)
      await trx
        .insertInto('request_communication')
        .values(
          pending.map((update, index) => ({
            organization_id: organizationId,
            service_request_id: request.id,
            author_staff_identity_id: trackingUatFixture.staffId,
            author_display_name: trackingUatFixture.staffDisplayName,
            submission_key: update.submissionKey,
            body: update.body,
            // Written explicitly rather than defaulted, because the resident
            // projection filters on exactly these three values.
            direction: RESIDENT_VISIBLE_UPDATE.direction,
            channel: RESIDENT_VISIBLE_UPDATE.channel,
            delivery_state: RESIDENT_VISIBLE_UPDATE.deliveryState,
            // Ordered so the newest update is unambiguous in the timeline.
            created_at: new Date(now.getTime() + index * 1000),
          })),
        )
        .execute();
  }

  const census = await readCensus(trx);
  const verdict = evaluateFixtureCensus(census);
  if (!verdict.ok)
    throw new Error(
      `Fixture provisioning is incomplete: ${verdict.reasons.join('; ')}`,
    );
  return {
    changed: plan.changed,
    plan,
    census,
    references,
    staffAuthenticated: false,
    credentialsIssued: 0,
  };
}

/** Read-only census for status reporting. */
export async function censusTrackingUatFixture(
  trx: Trx,
): Promise<Record<FixtureCensusKey, number>> {
  return readCensus(trx);
}
