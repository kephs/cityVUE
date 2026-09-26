import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../database/database.types.js';
import type { Permission, StaffAccess } from '../auth/auth.types.js';
import { safeStaffName } from '../service-request/ownership-targets.js';
import {
  effectivePermissions,
  recognizedPermissions,
} from '../auth/effective-permissions.js';
import {
  accessPrerequisites,
  assertAccessAuthority,
  validateAccessDependencies,
  validateManagedPermissions,
} from './access-policy.js';

type Db = Kysely<DatabaseSchema>;
interface State {
  authorization_revision: string;
  bootstrap_established: boolean;
}
interface Owner {
  role_id: string;
  kind: 'operational' | 'administrator';
}
export type ProvisionOperation = 'bootstrap' | 'add-manager' | 'remove-manager';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validId(value: unknown): value is string {
  return typeof value === 'string' && uuid.test(value);
}
function revision(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9][0-9]{0,17})$/.test(value);
}

/** Organization-first matches existing F036/F027 and configuration locking. */
export async function lockAccessState(
  db: Db,
  organizationId: string,
): Promise<State> {
  const org = await db
    .selectFrom('organization')
    .select('status')
    .where('id', '=', organizationId)
    .forUpdate()
    .executeTakeFirst();
  if (org?.status !== 'active')
    throw new NotFoundException('Access configuration unavailable');
  const state = (
    await sql<State>`select authorization_revision::text,bootstrap_established from organization_access_state where organization_id=${organizationId} for update`.execute(
      db,
    )
  ).rows[0];
  if (!state)
    throw new ConflictException('Access foundation migration required');
  return state;
}
async function stateRead(db: Db, organizationId: string): Promise<State> {
  const state = (
    await sql<State>`select s.authorization_revision::text,s.bootstrap_established from organization_access_state s join organization o on o.id=s.organization_id and o.status='active' where s.organization_id=${organizationId}`.execute(
      db,
    )
  ).rows[0];
  if (!state) throw new NotFoundException('Access configuration unavailable');
  return state;
}
async function target(
  db: Db,
  organizationId: string,
  id: string,
  active: boolean,
) {
  let query = db
    .selectFrom('staff_identity as s')
    .select(['s.id', 's.active', safeStaffName.as('display_name')])
    .where('s.organization_id', '=', organizationId)
    .where('s.id', '=', id);
  if (active) query = query.where('s.active', '=', true);
  const staff = await query.executeTakeFirst();
  if (!staff) throw new NotFoundException('Staff access unavailable');
  return {
    id: staff.id,
    displayName: staff.display_name,
    active: staff.active,
  };
}
async function owner(
  db: Db,
  organizationId: string,
  id: string,
  kind: Owner['kind'],
) {
  return (
    await sql<Owner>`select role_id,kind from access_role_ownership where organization_id=${organizationId} and staff_identity_id=${id} and kind=${kind}`.execute(
      db,
    )
  ).rows[0];
}
async function contributions(
  db: Db,
  organizationId: string,
  id: string,
  roleId?: string,
) {
  const rows = (
    await sql<{
      permission_key: string;
      role_id: string;
    }>`select p.permission_key,r.id as role_id from staff_role_assignment a
    join role r on r.organization_id=a.organization_id and r.id=a.role_id and r.active
    join role_permission p on p.organization_id=r.organization_id and p.role_id=r.id
    where a.organization_id=${organizationId} and a.staff_identity_id=${id} and a.active`.execute(
      db,
    )
  ).rows;
  return {
    owned: recognizedPermissions(
      rows.filter((r) => r.role_id === roleId).map((r) => r.permission_key),
    ),
    locked: recognizedPermissions(
      rows.filter((r) => r.role_id !== roleId).map((r) => r.permission_key),
    ),
    effective: recognizedPermissions(rows.map((r) => r.permission_key)),
  };
}
async function currentActor(db: Db, access: StaffAccess, manage: boolean) {
  // Context is supplied only by the authentication boundary, never a command body.
  assertAccessAuthority(access, manage);
  const actor = await db
    .selectFrom('staff_identity')
    .select('id')
    .where('id', '=', access.staffIdentityId)
    .where('organization_id', '=', access.organizationId)
    .where('active', '=', true)
    .where('entra_tenant_id', '=', access.tenantId)
    .where('entra_object_id', '=', access.objectId)
    .executeTakeFirst();
  if (!actor) throw new ForbiddenException('Access denied');
  assertAccessAuthority(
    {
      ...access,
      permissions: await effectivePermissions(
        db,
        access.organizationId,
        access.staffIdentityId,
      ),
    },
    manage,
  );
}

/** Internal foundation only: no controller, provider-subject projection or directory endpoint. */
export async function readAccessSnapshot(
  db: Db,
  access: StaffAccess,
  staffId: string,
) {
  if (!validId(staffId))
    throw new BadRequestException('Invalid staff reference');
  return db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (trx) => {
      await sql`set transaction read only`.execute(trx);
      await currentActor(trx, access, false);
      const state = await stateRead(trx, access.organizationId);
      const staff = await target(trx, access.organizationId, staffId, false);
      const ownership = await owner(
        trx,
        access.organizationId,
        staffId,
        'operational',
      );
      const grants = await contributions(
        trx,
        access.organizationId,
        staffId,
        ownership?.role_id,
      );
      const departments = await trx
        .selectFrom('staff_department_membership')
        .select('department_id')
        .where('organization_id', '=', access.organizationId)
        .where('staff_identity_id', '=', staffId)
        .where('active', '=', true)
        .execute();
      const divisions = await trx
        .selectFrom('staff_division_membership')
        .select(['department_id', 'division_id'])
        .where('organization_id', '=', access.organizationId)
        .where('staff_identity_id', '=', staffId)
        .where('active', '=', true)
        .execute();
      return {
        staff,
        ...grants,
        effective: staff.active ? grants.effective : [],
        authorizationRevision: state.authorization_revision,
        bootstrapEstablished: state.bootstrap_established,
        departmentIds: departments.map((d) => d.department_id).sort(),
        divisions,
      };
    });
}

async function writeChange(
  db: Db,
  input: {
    organizationId: string;
    staffId: string;
    kind: Owner['kind'];
    roleId?: string;
    before: string;
    desired: Permission[];
    current: Permission[];
    actorId: string | null;
    operation:
      | 'update_managed_access'
      | 'bootstrap_access_administration'
      | 'provision_access_administrator'
      | 'revoke_access_administrator';
    correlationId: string;
  },
) {
  const added = input.desired.filter((p) => !input.current.includes(p));
  const removed = input.current.filter((p) => !input.desired.includes(p));
  const roleId = input.roleId ?? randomUUID();
  if (!input.roleId) {
    await db
      .insertInto('role')
      .values({
        id: roleId,
        organization_id: input.organizationId,
        name: `f057-${input.kind}-${input.staffId}`,
        description: null,
        active: true,
      })
      .execute();
    await sql`insert into access_role_ownership(organization_id,staff_identity_id,role_id,kind,creation_txid)
      values(${input.organizationId},${input.staffId},${roleId},${input.kind},txid_current())`.execute(
      db,
    );
  }
  const id = randomUUID();
  await sql`insert into access_change_set(id,organization_id,target_staff_id,role_id,actor_staff_id,source,operation,correlation_id,before_revision,after_revision,mutation_txid)
    values(${id},${input.organizationId},${input.staffId},${roleId},${input.actorId},${input.actorId ? 'runtime' : 'controlled_provisioning'},${input.operation},${input.correlationId},${input.before}::bigint,${input.before}::bigint+1,txid_current())`.execute(
    db,
  );
  if (added.length || removed.length) {
    await sql`insert into access_permission_delta(change_set_id,permission_key,direction)
      select ${id}::uuid,key,'added' from unnest(${added}::text[]) key union all
      select ${id}::uuid,key,'removed' from unnest(${removed}::text[]) key`.execute(
      db,
    );
  }
  if (removed.length)
    await db
      .deleteFrom('role_permission')
      .where('organization_id', '=', input.organizationId)
      .where('role_id', '=', roleId)
      .where('permission_key', 'in', removed)
      .execute();
  if (added.length)
    await db
      .insertInto('role_permission')
      .values(
        added.map((permission_key) => ({
          organization_id: input.organizationId,
          role_id: roleId,
          permission_key,
        })),
      )
      .execute();
  if (!input.roleId)
    await db
      .insertInto('staff_role_assignment')
      .values({
        organization_id: input.organizationId,
        staff_identity_id: input.staffId,
        role_id: roleId,
        active: true,
      })
      .execute();
  if (input.operation === 'bootstrap_access_administration')
    await sql`update organization_access_state set bootstrap_established=true where organization_id=${input.organizationId}`.execute(
      db,
    );
  return {
    changeSetId: id,
    added,
    removed,
    authorizationRevision: (BigInt(input.before) + 1n).toString(),
  };
}

export async function changeManagedAccess(
  db: Db,
  access: StaffAccess,
  value: unknown,
) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('Invalid access command');
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (k) => !['staffId', 'expectedRevision', 'permissions'].includes(k),
    ) ||
    !validId(input.staffId) ||
    !revision(input.expectedRevision)
  )
    throw new BadRequestException('Invalid access command');
  const staffId = input.staffId,
    expected = input.expectedRevision,
    desired = validateManagedPermissions(input.permissions);
  if (staffId === access.staffIdentityId)
    throw new ForbiddenException('Self-edit is unavailable');
  return db.transaction().execute(async (trx) => {
    const state = await lockAccessState(trx, access.organizationId);
    await currentActor(trx, access, true);
    if (state.authorization_revision !== expected)
      throw new ConflictException('Access changed; refresh and review');
    await target(trx, access.organizationId, staffId, true);
    const ownership = await owner(
      trx,
      access.organizationId,
      staffId,
      'operational',
    );
    const grants = await contributions(
      trx,
      access.organizationId,
      staffId,
      ownership?.role_id,
    );
    if (JSON.stringify(desired) === JSON.stringify(grants.owned))
      return { changed: false, authorizationRevision: expected };
    validateAccessDependencies(desired, grants.locked);
    const result = await writeChange(trx, {
      organizationId: access.organizationId,
      staffId,
      kind: 'operational',
      ...(ownership ? { roleId: ownership.role_id } : {}),
      before: expected,
      desired,
      current: grants.owned,
      actorId: access.staffIdentityId,
      operation: 'update_managed_access',
      correlationId: randomUUID(),
    });
    return {
      changed: true,
      ...result,
      effective: recognizedPermissions([...grants.locked, ...desired]),
    };
  });
}

export interface ProvisionInput {
  organizationId: string;
  staffId: string;
  expectedRevision: string;
  expectedBootstrap: boolean;
  operation: ProvisionOperation;
  dryRun: boolean;
}
/** Operator-only; the CLI validates local environment. Never imported by an HTTP module. */
export async function provisionAccessAdministrator(
  db: Db,
  input: ProvisionInput,
) {
  if (
    !validId(input.organizationId) ||
    !validId(input.staffId) ||
    !revision(input.expectedRevision) ||
    typeof input.expectedBootstrap !== 'boolean' ||
    typeof input.dryRun !== 'boolean' ||
    !['bootstrap', 'add-manager', 'remove-manager'].includes(input.operation)
  )
    throw new BadRequestException('Invalid explicit provisioning selection');
  return db
    .transaction()
    .setIsolationLevel(input.dryRun ? 'repeatable read' : 'read committed')
    .execute(async (trx) => {
      if (input.dryRun) await sql`set transaction read only`.execute(trx);
      const state = input.dryRun
        ? await stateRead(trx, input.organizationId)
        : await lockAccessState(trx, input.organizationId);
      if (
        state.authorization_revision !== input.expectedRevision ||
        state.bootstrap_established !== input.expectedBootstrap
      )
        throw new ConflictException('Access changed; preview again');
      await target(trx, input.organizationId, input.staffId, true);
      const ownership = await owner(
        trx,
        input.organizationId,
        input.staffId,
        'administrator',
      );
      const grants = await contributions(
        trx,
        input.organizationId,
        input.staffId,
        ownership?.role_id,
      );
      if (input.operation === 'bootstrap' && state.bootstrap_established) {
        const initial = (
          await sql<{
            target_staff_id: string;
          }>`select target_staff_id from access_change_set
        where organization_id=${input.organizationId} and operation='bootstrap_access_administration'
        order by after_revision limit 1`.execute(trx)
        ).rows[0];
        if (
          initial?.target_staff_id !== input.staffId ||
          !accessPrerequisites.every((p) => grants.effective.includes(p))
        )
          throw new ConflictException(
            'Bootstrap already established; use add-manager',
          );
      }
      if (input.operation !== 'bootstrap' && !state.bootstrap_established)
        throw new ConflictException('Explicit bootstrap required');
      const desired: Permission[] =
        input.operation === 'remove-manager'
          ? []
          : [
              ...new Set([
                ...grants.owned,
                ...accessPrerequisites.filter(
                  (p) => !grants.effective.includes(p),
                ),
              ]),
            ].sort();
      const establish = !state.bootstrap_established;
      const changed =
        establish || JSON.stringify(desired) !== JSON.stringify(grants.owned);
      const finalEffective = recognizedPermissions([
        ...grants.locked,
        ...desired,
      ]);
      const remainsManager = accessPrerequisites.every((p) =>
        finalEffective.includes(p),
      );
      if (
        state.bootstrap_established &&
        !remainsManager &&
        accessPrerequisites.every((p) => grants.effective.includes(p))
      ) {
        const count = (
          await sql<{
            n: string;
          }>`select effective_access_managers(${input.organizationId})::text n`.execute(
            trx,
          )
        ).rows[0];
        if (!count || BigInt(count.n) <= 1n)
          throw new ConflictException(
            'Retain at least one Access Administrator',
          );
      }
      const preview = {
        dryRun: input.dryRun,
        changed,
        operation: input.operation,
        organizationId: input.organizationId,
        targetReference: `staff-…${input.staffId.slice(-6)}`,
        bootstrapEstablished: state.bootstrap_established,
        authorizationRevision: state.authorization_revision,
        added: desired.filter((p) => !grants.owned.includes(p)),
        removed: grants.owned.filter((p) => !desired.includes(p)),
        createsProvisioningRole: changed && !ownership,
        remainsAccessAdministrator: remainsManager,
      };
      if (input.dryRun || !changed) return preview;
      const result = await writeChange(trx, {
        organizationId: input.organizationId,
        staffId: input.staffId,
        kind: 'administrator',
        ...(ownership ? { roleId: ownership.role_id } : {}),
        before: state.authorization_revision,
        desired,
        current: grants.owned,
        actorId: null,
        operation: establish
          ? 'bootstrap_access_administration'
          : input.operation === 'remove-manager'
            ? 'revoke_access_administrator'
            : 'provision_access_administrator',
        correlationId: randomUUID(),
      });
      return { ...preview, ...result };
    });
}
