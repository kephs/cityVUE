import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { StaffAccess } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';
import type { DatabaseSchema } from '../database/database.types.js';
import {
  assertInternalAccess,
  internalDepartment,
  internalDivision,
  internalRequestScope,
  internalRequestUuid,
} from './internal-request-scope.js';
import {
  assignmentProjection,
  eligibleTargets,
  targetCatalog,
  validateTarget,
  type OwnershipTarget,
  type TargetType,
} from './ownership-targets.js';

export interface OwnershipInput {
  expectedRevision: number;
  targetType?: TargetType;
  targetId?: string;
}
type Operation = 'assign' | 'unassign' | 'add' | 'remove' | 'watch' | 'unwatch';

export async function currentAssignment(
  db: Kysely<DatabaseSchema>,
  org: string,
  id: string,
) {
  const row = await db
    .selectFrom('service_request as request')
    .select(assignmentProjection(org).as('assignment'))
    .where('request.organization_id', '=', org)
    .where('request.id', '=', id)
    .executeTakeFirstOrThrow();
  return row.assignment;
}

/** Caller holds the request lock; both events and the route remain in this transaction. */
export async function clearIneligibleAssignment(
  db: Kysely<DatabaseSchema>,
  access: StaffAccess,
  id: string,
  departmentId: string,
  divisionId: string | null,
  revision: number,
) {
  const previous = await currentAssignment(db, access.organizationId, id);
  if (
    !previous ||
    (
      await eligibleTargets(
        db,
        access.organizationId,
        departmentId,
        divisionId,
        previous.type,
        '',
        previous.id,
      )
    ).length
  )
    return;
  await db
    .updateTable('service_request_assignment')
    .set({ ended_at: sql`clock_timestamp()` })
    .where('organization_id', '=', access.organizationId)
    .where('service_request_id', '=', id)
    .where('ended_at', 'is', null)
    .execute();
  await db
    .insertInto('request_operational_activity')
    .values({
      organization_id: access.organizationId,
      service_request_id: id,
      activity_type: 'request_unassigned',
      actor_type: 'staff',
      staff_identity_id: access.staffIdentityId,
      request_revision: revision,
      event_index: 1,
      from_target_type: previous.type,
      from_target_name: previous.displayName,
    })
    .execute();
}

@Injectable()
export class RequestOwnershipService {
  constructor(private readonly database: DatabaseService) {}

  private async parent(
    db: Kysely<DatabaseSchema>,
    access: StaffAccess,
    id: string,
    lock = false,
  ) {
    if (!internalRequestUuid.test(id)) throw new NotFoundException();
    let query = internalRequestScope(db, access)
      .select([
        'request.id',
        'request.revision',
        internalDepartment.as('departmentId'),
        internalDivision.as('divisionId'),
      ])
      .where('request.id', '=', id);
    if (lock)
      query = query.forUpdate('request').forShare(['category', 'organization']);
    const row = await query.executeTakeFirst();
    if (!row) throw new NotFoundException();
    return row;
  }

  async targets(
    id: string,
    access: StaffAccess | undefined,
    type: TargetType,
    search: string,
  ) {
    assertInternalAccess(access, 'service_request.internal.update');
    return this.database.client
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (db) => {
        const parent = await this.parent(db, access, id);
        const rows = await eligibleTargets(
          db,
          access.organizationId,
          parent.departmentId,
          parent.divisionId,
          type,
          search,
        );
        return {
          items: rows.map(({ type, id, displayName }) => ({
            type,
            id,
            displayName,
          })),
          limit: 25,
        };
      });
  }

  async watchers(id: string, access: StaffAccess | undefined) {
    assertInternalAccess(access, 'service_request.internal.read');
    return this.database.client
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (db) => {
        await this.parent(db, access, id);
        const rows =
          await sql<OwnershipTarget>`select t.type,t.id,t.name as "displayName",t.active
        from service_request_watcher w join ${targetCatalog(access.organizationId)} t
          on t.type=w.target_type and t.id=coalesce(w.staff_identity_id,w.operational_role_id,w.work_group_id)
        where w.organization_id=${access.organizationId} and w.service_request_id=${id} order by w.created_at,w.id limit 100`.execute(
            db,
          );
        return {
          items: rows.rows,
          watchingSelf: rows.rows.some(
            (r) => r.type === 'staff' && r.id === access.staffIdentityId,
          ),
          limit: 100,
        };
      });
  }

  async mutate(
    id: string,
    input: OwnershipInput,
    access: StaffAccess | undefined,
    operation: Operation,
  ) {
    const self = operation === 'watch' || operation === 'unwatch';
    assertInternalAccess(
      access,
      self
        ? 'service_request.internal.read'
        : 'service_request.internal.update',
    );
    if (
      !Number.isInteger(input.expectedRevision) ||
      input.expectedRevision < 1 ||
      input.expectedRevision >= 2147483647
    )
      throw new BadRequestException('Invalid revision');
    const removing = operation === 'remove' || operation === 'unwatch';
    const assignment = operation === 'assign' || operation === 'unassign';
    const type = self ? 'staff' : (input.targetType ?? 'staff');
    const targetId = self ? access.staffIdentityId : (input.targetId ?? '');
    if (operation !== 'unassign')
      validateTarget(self ? type : input.targetType, targetId);
    return this.database.client.transaction().execute(async (db) => {
      const parent = await this.parent(db, access, id, true);
      if (parent.revision !== input.expectedRevision)
        throw new ConflictException('Request changed; refresh before retrying');
      const previous = await currentAssignment(db, access.organizationId, id);
      let target: OwnershipTarget | undefined;
      if (operation !== 'unassign') {
        // Lock the selected principal/team/role before rechecking its current eligibility.
        const table =
          type === 'staff'
            ? 'staff_identity'
            : type === 'role'
              ? 'operational_role'
              : 'work_group';
        const found = await db
          .selectFrom(table)
          .select('id')
          .where('organization_id', '=', access.organizationId)
          .where('id', '=', targetId)
          .forShare()
          .executeTakeFirst();
        if (!found) throw new NotFoundException();
        if (removing) {
          target = (
            await sql<OwnershipTarget>`select t.type,t.id,t.name as "displayName",t.active from ${targetCatalog(access.organizationId)} t where t.type=${type} and t.id=${targetId}`.execute(
              db,
            )
          ).rows[0];
        } else
          target = (
            await eligibleTargets(
              db,
              access.organizationId,
              parent.departmentId,
              parent.divisionId,
              type,
              '',
              targetId,
            )
          ).at(0);
        if (!target) throw new NotFoundException();
      }
      let activity:
        | 'request_assigned'
        | 'request_reassigned'
        | 'request_unassigned'
        | 'watcher_added'
        | 'watcher_removed';
      let from: OwnershipTarget | null = null,
        to: OwnershipTarget | null = null;
      if (assignment) {
        if (
          (!previous && !target) ||
          (target &&
            previous?.type === target.type &&
            previous.id === target.id)
        )
          throw new ConflictException('Assignment is already current');
        await db
          .updateTable('service_request_assignment')
          .set({ ended_at: sql`clock_timestamp()` })
          .where('organization_id', '=', access.organizationId)
          .where('service_request_id', '=', id)
          .where('ended_at', 'is', null)
          .execute();
        if (target)
          await db
            .insertInto('service_request_assignment')
            .values({
              id: randomUUID(),
              organization_id: access.organizationId,
              service_request_id: id,
              assignment_type:
                target.type === 'staff' ? 'individual' : target.type,
              staff_identity_id: target.type === 'staff' ? target.id : null,
              operational_role_id: target.type === 'role' ? target.id : null,
              work_group_id: target.type === 'group' ? target.id : null,
              department_id: null,
              assigned_by_actor_type: 'staff',
              assigned_by_staff_identity_id: access.staffIdentityId,
              ended_at: null,
              reason: null,
            })
            .execute();
        activity = target
          ? previous
            ? 'request_reassigned'
            : 'request_assigned'
          : 'request_unassigned';
        from = previous;
        to = target ?? null;
      } else {
        if (!target) throw new NotFoundException();
        const column =
          type === 'staff'
            ? 'staff_identity_id'
            : type === 'role'
              ? 'operational_role_id'
              : 'work_group_id';
        const existing = await db
          .selectFrom('service_request_watcher')
          .select('id')
          .where('organization_id', '=', access.organizationId)
          .where('service_request_id', '=', id)
          .where('target_type', '=', type)
          .where(column, '=', targetId)
          .executeTakeFirst();
        if (removing) {
          if (!existing)
            throw new ConflictException('Watcher is already removed');
          await db
            .deleteFrom('service_request_watcher')
            .where('organization_id', '=', access.organizationId)
            .where('id', '=', existing.id)
            .execute();
          activity = 'watcher_removed';
          from = target;
        } else {
          if (existing)
            throw new ConflictException('Target is already watching');
          const count = await db
            .selectFrom('service_request_watcher')
            .select(sql<number>`count(*)::integer`.as('total'))
            .where('organization_id', '=', access.organizationId)
            .where('service_request_id', '=', id)
            .executeTakeFirstOrThrow();
          if (count.total >= 100)
            throw new ConflictException('Watcher limit reached');
          await db
            .insertInto('service_request_watcher')
            .values({
              organization_id: access.organizationId,
              service_request_id: id,
              target_type: type,
              staff_identity_id: type === 'staff' ? targetId : null,
              operational_role_id: type === 'role' ? targetId : null,
              work_group_id: type === 'group' ? targetId : null,
              created_by_staff_identity_id: access.staffIdentityId,
            })
            .execute();
          activity = 'watcher_added';
          to = target;
        }
      }
      const row = await db
        .updateTable('service_request')
        .set({
          revision: parent.revision + 1,
          updated_at: sql`clock_timestamp()`,
        })
        .where('organization_id', '=', access.organizationId)
        .where('id', '=', id)
        .where('revision', '=', parent.revision)
        .returning(['revision', 'updated_at'])
        .executeTakeFirstOrThrow();
      await db
        .insertInto('request_operational_activity')
        .values({
          organization_id: access.organizationId,
          service_request_id: id,
          activity_type: activity,
          actor_type: 'staff',
          staff_identity_id: access.staffIdentityId,
          request_revision: row.revision,
          from_target_type: from?.type ?? null,
          from_target_name: from?.displayName ?? null,
          to_target_type: to?.type ?? null,
          to_target_name: to?.displayName ?? null,
        })
        .execute();
      // Existing audit taxonomy is retained; safe command metadata contains no target names or narratives.
      await db
        .insertInto('activity')
        .values({
          id: randomUUID(),
          organization_id: access.organizationId,
          service_request_id: id,
          activity_type: assignment
            ? activity === 'request_unassigned'
              ? 'service_request_unassigned'
              : activity === 'request_assigned'
                ? 'service_request_assigned'
                : 'service_request_reassigned'
            : activity,
          actor_type: 'staff',
          staff_identity_id: access.staffIdentityId,
          actor_reference: null,
          metadata: {
            policy: 'F037',
            action: operation,
            changedField: assignment ? 'assignment' : 'watchers',
            revision: row.revision,
          },
        })
        .execute();
      return {
        serviceRequestId: id,
        revision: row.revision,
        updatedAt: row.updated_at,
      };
    });
  }
}
