/**
 * F067 — guarded binding of one Entra development identity to the fixture's
 * synthetic staff identity, on a disposable UAT database only.
 *
 * `StaffAccessGuard` admits the staff tracking endpoints only on a real Entra
 * token, and `StaffAuthorizationService.resolve` maps that token to a staff row
 * by `(entra_tenant_id, entra_object_id)`. The fixture deliberately creates its
 * staff identity unbound. This module performs the one separately authorized
 * step that binds it, and nothing else:
 *
 * - **The destination is proven first**, with the fixture's own in-band nonce
 *   gate (`evaluateFixtureTarget`), before any read that could inform a write.
 * - **The target is fixed.** Only the fixture's Organization and staff
 *   identity can ever be bound; neither is an input.
 * - **The identity is explicit.** Tenant and object ID are supplied by the
 *   operator from the Entra directory and validated as GUIDs; the tenant must
 *   equal the API's configured tenant. Nothing is derived from a name, email,
 *   UPN or token claim, and no token is read or minted here.
 * - **The target must already be exactly the fixture**: active, in its active
 *   Organization, with exactly the fixture's two effective permissions and
 *   exactly one active Department membership covering its requests.
 * - **The write is conditional and counted.** One `update` sets only the two
 *   identity columns, only while both are null, and must affect exactly one
 *   row; anything else rolls the transaction back. An identical existing
 *   binding is reported as already bound and performs no update.
 *
 * No role, permission, membership, request or tracking credential is written.
 */
import { sql, type RawBuilder, type Transaction } from 'kysely';
import type { DatabaseSchema } from './database.types.js';
import { lockAuthorizationWriter } from './authorization-writer-lock.js';
import {
  FIXTURE_PERMISSIONS,
  evaluateFixtureTarget,
  readTargetFacts,
  trackingUatFixture,
  type FixtureTargetFacts,
  type Verdict,
} from './uat-f067-tracking-fixture.js';

/** The only staff identity this module may ever bind. Not an input. */
export const BINDING_TARGET = Object.freeze({
  organizationId: trackingUatFixture.organizationId,
  staffId: trackingUatFixture.staffId,
  roleId: trackingUatFixture.roleId,
});

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_GUID = '00000000-0000-0000-0000-000000000000';

/** A canonical lowercase GUID, or null. Braces and whitespace are refused. */
export function canonicalGuid(value: unknown): string | null {
  if (typeof value !== 'string' || !GUID.test(value)) return null;
  const lowered = value.toLowerCase();
  return lowered === NIL_GUID ? null : lowered;
}

/** Enough of an identifier to recognise it, never the whole of it. */
export function maskGuid(value: string | null | undefined): string {
  return typeof value === 'string' && value.length >= 8
    ? `${value.slice(0, 4)}…${value.slice(-4)}`
    : '(none)';
}

export interface BindingIdentity {
  readonly tenantId: string;
  readonly objectId: string;
}

/**
 * Validates the operator's identity input against the API's configured
 * tenant. Both values are required; a tenant other than the configured one is
 * refused because a token from it could never pass `EntraTokenService` anyway,
 * and binding it would only manufacture a misleading row.
 */
export function evaluateBindingIdentity(input: {
  readonly tenantId: unknown;
  readonly objectId: unknown;
  readonly expectedTenantId: unknown;
}): Verdict & { identity: BindingIdentity | null } {
  const reasons: string[] = [];
  const expected = canonicalGuid(input.expectedTenantId);
  const tenantId = canonicalGuid(input.tenantId);
  const objectId = canonicalGuid(input.objectId);
  if (expected === null)
    reasons.push(
      'the configured Entra tenant is missing or not a GUID, so no binding can be checked against it',
    );
  if (tenantId === null)
    reasons.push('the Entra tenant ID is missing or not a GUID');
  if (objectId === null)
    reasons.push('the Entra user object ID is missing or not a GUID');
  if (expected !== null && tenantId !== null && tenantId !== expected)
    reasons.push(
      'the Entra tenant ID does not match the tenant the API is configured to accept',
    );
  if (tenantId !== null && objectId !== null && tenantId === objectId)
    reasons.push('the Entra object ID cannot equal the tenant ID');
  if (reasons.length || tenantId === null || objectId === null)
    return { ok: false, reasons, identity: null };
  return { ok: true, reasons: [], identity: { tenantId, objectId } };
}

/** Everything the plan needs, read inside the binding transaction. */
export interface BindingSnapshot {
  readonly staffPresent: boolean;
  readonly staffActive: boolean;
  readonly staffOrganizationId: string | null;
  readonly organizationActive: boolean;
  readonly boundTenantId: string | null;
  readonly boundObjectId: string | null;
  /** The fixture role assignment and its role are both active. */
  readonly assignmentActive: boolean;
  /** Effective permissions, by the `effectivePermissionContributions` rule. */
  readonly effectivePermissions: readonly string[];
  /** The Department the fixture's PUBLIC requests are scoped to. */
  readonly requestDepartmentIds: readonly string[];
  readonly activeDepartmentIds: readonly string[];
  /** Any other Department membership (any state) plus any Division membership. */
  readonly otherMemberships: number;
  /** Other staff rows already holding the requested pair. */
  readonly pairBoundElsewhere: number;
  readonly appliedMigrations: readonly string[];
}

export type BindingAction = 'bind' | 'already-bound';

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length &&
  [...a].sort().join('\n') === [...b].sort().join('\n');

/**
 * Turns a snapshot into `bind`, `already-bound` or a refusal. Pure, so every
 * refusal is provable without a database. A refusal never plans a write.
 */
export function planIdentityBinding(
  snapshot: BindingSnapshot | null | undefined,
  identity: BindingIdentity,
  expectedMigrations: readonly string[],
): Verdict & { action: BindingAction | null } {
  if (snapshot === null || snapshot === undefined)
    return {
      ok: false,
      reasons: ['no binding snapshot was supplied'],
      action: null,
    };
  const reasons: string[] = [];
  if (!snapshot.staffPresent)
    reasons.push('the fixture staff identity does not exist');
  else {
    if (!snapshot.staffActive)
      reasons.push('the fixture staff identity is not active');
    if (snapshot.staffOrganizationId !== BINDING_TARGET.organizationId)
      reasons.push(
        'the fixture staff identity does not belong to the fixture Organization',
      );
  }
  if (!snapshot.organizationActive)
    reasons.push('the fixture Organization is not active');
  if (!snapshot.assignmentActive)
    reasons.push('the fixture role assignment or its role is not active');
  // Exactly the fixture's two permissions: missing either is refused, and so
  // is anything extra, because binding must never hand a person more authority
  // than the reviewed fixture grants.
  const permissions = [...new Set(snapshot.effectivePermissions)];
  for (const key of FIXTURE_PERMISSIONS)
    if (!permissions.includes(key))
      reasons.push(
        `the fixture staff identity does not effectively hold ${key}`,
      );
  const extra = permissions.filter(
    (key) => !FIXTURE_PERMISSIONS.some((allowed) => allowed === key),
  );
  if (extra.length)
    reasons.push(
      `the fixture staff identity effectively holds ${String(extra.length)} permission(s) outside the fixture grant`,
    );
  const departments = [...new Set(snapshot.requestDepartmentIds)];
  if (departments.length !== 1)
    reasons.push(
      'the fixture requests do not resolve to exactly one Department, so the expected scope is unknown',
    );
  else if (!sameSet(snapshot.activeDepartmentIds, departments))
    reasons.push(
      "the fixture staff identity's active Department membership is not exactly the fixture requests' Department",
    );
  if (snapshot.otherMemberships !== 0)
    reasons.push(
      'the fixture staff identity holds another Department or Division membership; its scope is broader than reviewed',
    );
  if (
    expectedMigrations.length === 0 ||
    !sameSet(snapshot.appliedMigrations, expectedMigrations)
  )
    reasons.push(
      'the applied migrations do not match the inventory this session recorded',
    );
  if (snapshot.pairBoundElsewhere !== 0)
    reasons.push(
      'this Entra identity is already bound to another staff identity; binding it again would be ambiguous',
    );

  const tenant = snapshot.boundTenantId;
  const object = snapshot.boundObjectId;
  let action: BindingAction | null = null;
  if (tenant === null && object === null) action = 'bind';
  else if (tenant === identity.tenantId && object === identity.objectId)
    action = 'already-bound';
  else
    reasons.push(
      'the fixture staff identity is already bound to a different Entra identity; it is never overwritten',
    );

  return reasons.length
    ? { ok: false, reasons, action: null }
    : { ok: true, reasons: [], action };
}

/** Rows the binding must leave exactly as they were. */
export interface GuardedState {
  readonly staffRow: string;
  readonly roleAssignments: number;
  readonly rolePermissions: number;
  readonly departmentMemberships: number;
  readonly divisionMemberships: number;
  readonly trackingCredentials: number;
  readonly boundStaff: number;
}

/** The database operations the executor needs, and nothing more. */
export interface BindingStore {
  readTarget(): Promise<FixtureTargetFacts>;
  lock(): Promise<void>;
  readSnapshot(identity: BindingIdentity): Promise<BindingSnapshot>;
  readGuardedState(): Promise<GuardedState>;
  /** Returns the number of rows the conditional update changed. */
  bind(identity: BindingIdentity): Promise<number>;
}

export type BindingMode = 'plan' | 'confirm';

export interface BindingReport {
  readonly action: 'planned' | 'bound' | 'already-bound';
  readonly changed: boolean;
  readonly staffId: string;
  readonly tenant: string;
  readonly object: string;
  readonly credentialsIssued: 0;
}

/**
 * Proves the destination, validates the identity, locks the Organization's
 * authorization writers, plans, and only under `confirm` performs the single
 * conditional update. Any refusal or surprise throws, which rolls back the
 * caller's transaction; a refusal before the update has written nothing.
 */
export async function executeIdentityBinding(
  store: BindingStore,
  options: {
    readonly mode: BindingMode;
    readonly tenantId: unknown;
    readonly objectId: unknown;
    readonly expectedTenantId: unknown;
    readonly expectedMigrations: readonly string[];
  },
): Promise<BindingReport> {
  // Re-checked at run time: the CLI and tests are not the only callers.
  const mode: unknown = options.mode;
  if (mode !== 'plan' && mode !== 'confirm')
    throw new Error('Binding refused: the mode must be plan or confirm');
  const refusal = evaluateFixtureTarget(await store.readTarget());
  if (refusal !== null) throw new Error(`Binding target refused: ${refusal}`);
  const checked = evaluateBindingIdentity(options);
  if (!checked.ok || checked.identity === null)
    throw new Error(`Binding identity refused: ${checked.reasons.join('; ')}`);
  const identity = checked.identity;

  await store.lock();
  const before = await store.readGuardedState();
  const plan = planIdentityBinding(
    await store.readSnapshot(identity),
    identity,
    options.expectedMigrations,
  );
  if (!plan.ok) throw new Error(`Binding refused: ${plan.reasons.join('; ')}`);

  const report = (action: BindingReport['action'], changed: boolean) => ({
    action,
    changed,
    staffId: BINDING_TARGET.staffId,
    tenant: maskGuid(identity.tenantId),
    object: maskGuid(identity.objectId),
    credentialsIssued: 0 as const,
  });
  if (plan.action === 'already-bound') return report('already-bound', false);
  if (options.mode !== 'confirm') return report('planned', false);

  const updated = await store.bind(identity);
  if (updated !== 1)
    throw new Error(
      `Binding refused: the conditional update changed ${String(updated)} row(s), so the target changed underneath it`,
    );
  // Re-read inside the same transaction: the row must now read back as this
  // identity, and nothing else the binding must preserve may have moved.
  const settled = planIdentityBinding(
    await store.readSnapshot(identity),
    identity,
    options.expectedMigrations,
  );
  if (!settled.ok || settled.action !== 'already-bound')
    throw new Error('Binding refused: the bound row does not read back');
  const after = await store.readGuardedState();
  const moved = (Object.keys(before) as (keyof GuardedState)[]).filter(
    (key) => key !== 'boundStaff' && before[key] !== after[key],
  );
  if (moved.length || after.boundStaff !== before.boundStaff + 1)
    throw new Error(
      `Binding refused: the update disturbed ${moved.length ? moved.join(', ') : 'the bound-staff count'}`,
    );
  return report('bound', true);
}

// --- the PostgreSQL store ----------------------------------------------------

type Trx = Transaction<DatabaseSchema>;

/** The real store, over one transaction. Every write goes through `bind`. */
export function createBindingStore(
  trx: Trx,
  target: {
    readonly url: string;
    readonly expectedNonce: string;
    readonly expectedRole: string;
  },
): BindingStore {
  const { organizationId, staffId, roleId } = BINDING_TARGET;
  const requestIds = trackingUatFixture.requests.map((request) => request.id);
  const count = async (query: RawBuilder<{ n: number }>) =>
    (await query.execute(trx)).rows[0]?.n ?? 0;
  return {
    readTarget: () =>
      readTargetFacts(
        trx,
        target.url,
        target.expectedNonce,
        target.expectedRole,
      ),
    lock: () => lockAuthorizationWriter(trx, organizationId),
    readSnapshot: async (identity) => {
      const staff = await trx
        .selectFrom('staff_identity as s')
        .leftJoin('organization as o', 'o.id', 's.organization_id')
        .select([
          's.active',
          's.organization_id',
          's.entra_tenant_id',
          's.entra_object_id',
          'o.status',
        ])
        .where('s.id', '=', staffId)
        .executeTakeFirst();
      const assignment = await trx
        .selectFrom('staff_role_assignment as a')
        .innerJoin('role', 'role.id', 'a.role_id')
        .select(['a.active as assignment_active', 'role.active as role_active'])
        .where('a.organization_id', '=', organizationId)
        .where('a.staff_identity_id', '=', staffId)
        .where('a.role_id', '=', roleId)
        .executeTakeFirst();
      const permissions = await trx
        .selectFrom('staff_role_assignment as a')
        .innerJoin('role', 'role.id', 'a.role_id')
        .innerJoin('role_permission as p', 'p.role_id', 'role.id')
        .select('p.permission_key')
        .where('a.organization_id', '=', organizationId)
        .where('a.staff_identity_id', '=', staffId)
        .where('a.active', '=', true)
        .where('role.active', '=', true)
        .execute();
      const requestDepartments = await sql<{ department_id: string }>`
        select distinct coalesce(r.routed_department_id, c.department_id) as department_id
        from service_request r
        join category c on c.organization_id = r.organization_id and c.id = r.category_id
        where r.organization_id = ${organizationId} and r.audience = 'public'
          and r.id in (${sql.join(requestIds)})`.execute(trx);
      const memberships = await trx
        .selectFrom('staff_department_membership')
        .select(['department_id', 'active', 'organization_id'])
        .where('staff_identity_id', '=', staffId)
        .execute();
      const required = requestDepartments.rows.map((row) => row.department_id);
      const active = memberships
        .filter((row) => row.active && row.organization_id === organizationId)
        .map((row) => row.department_id);
      const divisions = await count(
        sql<{
          n: number;
        }>`select count(*)::int as n from staff_division_membership where staff_identity_id = ${staffId}`,
      );
      const pair = await count(
        sql<{
          n: number;
        }>`select count(*)::int as n from staff_identity where entra_tenant_id = ${identity.tenantId} and entra_object_id = ${identity.objectId} and id <> ${staffId}`,
      );
      const migrations = await sql<{
        name: string;
      }>`select name from kysely_migration order by name`.execute(trx);
      return {
        staffPresent: staff !== undefined,
        staffActive: staff?.active === true,
        staffOrganizationId: staff?.organization_id ?? null,
        organizationActive: staff?.status === 'active',
        boundTenantId: staff?.entra_tenant_id ?? null,
        boundObjectId: staff?.entra_object_id ?? null,
        assignmentActive:
          assignment?.assignment_active === true && assignment.role_active,
        effectivePermissions: permissions.map((row) => row.permission_key),
        requestDepartmentIds: required,
        activeDepartmentIds: active,
        otherMemberships:
          memberships.filter(
            (row) =>
              !(required.length === 1 && row.department_id === required[0]) ||
              row.organization_id !== organizationId,
          ).length + divisions,
        pairBoundElsewhere: pair,
        appliedMigrations: migrations.rows.map((row) => row.name),
      };
    },
    readGuardedState: async () => {
      const row = await sql<{
        staff_row: string;
        assignments: number;
        permissions: number;
        departments: number;
        divisions: number;
        credentials: number;
        bound: number;
      }>`select
        (select coalesce(json_build_object('o', organization_id, 'n', display_name, 'e', email, 'a', active)::text, '')
          from staff_identity where id = ${staffId}) as staff_row,
        (select count(*)::int from staff_role_assignment) as assignments,
        (select count(*)::int from role_permission) as permissions,
        (select count(*)::int from staff_department_membership) as departments,
        (select count(*)::int from staff_division_membership) as divisions,
        (select count(*)::int from request_tracking_credential) as credentials,
        (select count(*)::int from staff_identity where entra_object_id is not null) as bound
      `.execute(trx);
      const state = row.rows[0];
      return {
        staffRow: state?.staff_row ?? '',
        roleAssignments: state?.assignments ?? 0,
        rolePermissions: state?.permissions ?? 0,
        departmentMemberships: state?.departments ?? 0,
        divisionMemberships: state?.divisions ?? 0,
        trackingCredentials: state?.credentials ?? 0,
        boundStaff: state?.bound ?? 0,
      };
    },
    // The only write. Conditional on the exact row and on both identity
    // columns still being null, so a concurrent or stale binding changes zero
    // rows and the executor refuses rather than overwriting it.
    bind: async (identity) => {
      const result = await trx
        .updateTable('staff_identity')
        .set({
          entra_tenant_id: identity.tenantId,
          entra_object_id: identity.objectId,
        })
        .where('id', '=', staffId)
        .where('organization_id', '=', organizationId)
        .where('active', '=', true)
        .where('entra_tenant_id', 'is', null)
        .where('entra_object_id', 'is', null)
        .executeTakeFirst();
      return Number(result.numUpdatedRows);
    },
  };
}
