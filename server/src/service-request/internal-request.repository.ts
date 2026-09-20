import { assignmentProjection, operationalView } from './ownership-targets.js';
import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import type { StaffAccess } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';

import {
  assertInternalAccess,
  internalRequestScope,
  internalRequestUuid as uuid,
  internalDepartment,
  internalDivision,
} from './internal-request-scope.js';

export function assertInternalReadAccess(
  access: StaffAccess | undefined,
): asserts access is StaffAccess {
  assertInternalAccess(access, 'service_request.internal.read');
}

export interface InternalRequestFilters {
  view?: string;
  search?: string;
  status?: string;
  departmentId?: string;
  divisionId?: string;
}
@Injectable()
export class InternalRequestRepository {
  constructor(private readonly database: DatabaseService) {}

  private scoped(access: StaffAccess | undefined) {
    assertInternalReadAccess(access);
    return internalRequestScope(this.database.client, access).innerJoin(
      'service_definition_version as version',
      (join) =>
        join
          .onRef('version.id', '=', 'request.service_definition_version_id')
          .onRef('version.organization_id', '=', 'request.organization_id'),
    );
  }

  private filtered(
    access: StaffAccess | undefined,
    filters: InternalRequestFilters = {},
  ) {
    let query = this.scoped(access);
    assertInternalReadAccess(access);
    if (filters.view)
      query = query.where(
        operationalView(
          filters.view,
          access.organizationId,
          access.staffIdentityId,
        ),
      );
    if (filters.status)
      query = query.where('request.status', '=', filters.status);
    if (filters.departmentId)
      query = query.where(internalDepartment, '=', filters.departmentId);
    if (filters.divisionId)
      query = query.where(internalDivision, '=', filters.divisionId);
    const search = filters.search?.trim();
    if (search)
      query = query.where(
        'request.reference_number',
        '=',
        search.toUpperCase(),
      );
    return query;
  }

  private projection(
    access: StaffAccess | undefined,
    filters: InternalRequestFilters = {},
  ) {
    assertInternalReadAccess(access);
    return this.filtered(access, filters)
      .innerJoin('department as effective_department', (join) =>
        join
          .onRef(
            'effective_department.organization_id',
            '=',
            'request.organization_id',
          )
          .on('effective_department.id', '=', internalDepartment),
      )
      .leftJoin('division as effective_division', (join) =>
        join
          .onRef(
            'effective_division.organization_id',
            '=',
            'request.organization_id',
          )
          .on('effective_division.id', '=', internalDivision),
      )
      .select([
        assignmentProjection(access.organizationId).as('assignment'),
        'effective_department.name as departmentName',
        'effective_division.name as divisionName',
        'request.id as serviceRequestId',
        'request.reference_number as referenceNumber',
        'request.audience',
        'request.status',
        'request.priority',
        'request.created_at as createdAt',
        'request.updated_at as updatedAt',
        'version.name as issueName',
        'version.icon_key as issueIcon',
        'category.name as categoryName',
        sql<
          string | null
        >`(select coalesce(nullif(btrim(l.normalized_address), ''), nullif(btrim(l.entered_address), '')) from location l where l.organization_id=request.organization_id and l.service_request_id=request.id limit 1)`.as(
          'serviceLocation',
        ),
        'category.id as categoryId',
        internalDepartment.as('departmentId'),
        internalDivision.as('divisionId'),
      ]);
  }

  async list(
    access: StaffAccess | undefined,
    page: number,
    pageSize: number,
    filters: InternalRequestFilters = {},
  ) {
    const count = await this.filtered(access, filters)
      .select(sql<number>`count(*)::integer`.as('total'))
      .executeTakeFirstOrThrow();
    const items = await this.projection(access, filters)
      .orderBy('request.created_at', 'desc')
      .orderBy('request.id', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .execute();
    return {
      items,
      total: count.total,
      page,
      pageSize,
      hasPreviousPage: page > 1,
      hasNextPage: page * pageSize < count.total,
    };
  }

  async workspaceOptions(access: StaffAccess | undefined) {
    assertInternalReadAccess(access);
    const active = await this.database.client
      .selectFrom('organization')
      .select('id')
      .where('id', '=', access.organizationId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    const canUpdate =
      Boolean(active) &&
      access.permissions.includes('service_request.internal.update');
    if (!active || !access.departmentIds.length)
      return { canUpdate: false, departments: [], divisions: [] };
    const departments = await this.database.client
      .selectFrom('department')
      .select(['id', 'name'])
      .where('organization_id', '=', access.organizationId)
      .where('id', 'in', access.departmentIds)
      .where('status', '=', 'active')
      .orderBy('name')
      .orderBy('id')
      .execute();
    const divisions =
      access.divisionIds.length && departments.length
        ? await this.database.client
            .selectFrom('division')
            .select(['id', 'name', 'department_id as departmentId'])
            .where('organization_id', '=', access.organizationId)
            .where('id', 'in', access.divisionIds)
            .where(
              'department_id',
              'in',
              departments.map((d) => d.id),
            )
            .where('status', '=', 'active')
            .orderBy('name')
            .orderBy('id')
            .execute()
        : [];
    return { canUpdate, departments, divisions };
  }

  async activity(
    access: StaffAccess | undefined,
    id: string,
    page: number,
    pageSize: number,
  ) {
    assertInternalReadAccess(access);
    if (!uuid.test(id)) throw new NotFoundException();
    // One repeatable-read snapshot keeps request admission and history scope consistent.
    return this.database.client
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (trx) => {
        const parent = await internalRequestScope(trx, access)
          .select('request.id')
          .where('request.id', '=', id)
          .executeTakeFirst();
        if (!parent) throw new NotFoundException();
        const rows = await trx
          .selectFrom('request_operational_activity')
          .select([
            'id',
            'activity_type as type',
            'occurred_at as occurredAt',
            'actor_type as actorType',
            'from_status as fromStatus',
            'to_status as toStatus',
            'from_department_name as fromDepartment',
            'from_division_name as fromDivision',
            'to_department_name as toDepartment',
            'to_division_name as toDivision',
            'narrative',
            'intake_channel as intakeChannel',
            'from_target_type as fromTargetType',
            'from_target_name as fromTargetName',
            'to_target_type as toTargetType',
            'to_target_name as toTargetName',
          ])
          .where('organization_id', '=', access.organizationId)
          .where('service_request_id', '=', id)
          .orderBy('occurred_at', 'desc')
          .orderBy('id', 'desc')
          .limit(pageSize + 1)
          .offset((page - 1) * pageSize)
          .execute();
        return {
          items: rows.slice(0, pageSize).map(({ actorType, ...row }) => ({
            ...row,
            actorDisplay:
              actorType === 'staff'
                ? 'Staff member'
                : actorType === 'system'
                  ? 'System'
                  : 'Resident',
          })),
          page,
          pageSize,
          hasPreviousPage: page > 1,
          hasNextPage: rows.length > pageSize,
        };
      });
  }

  async details(access: StaffAccess | undefined, id: string) {
    // Authorize even malformed lookups. No contacts, identities or activity joins.
    const query = this.projection(access);
    if (!uuid.test(id)) return undefined;
    return query
      .select(['request.description', 'request.revision'])
      .where('request.id', '=', id)
      .executeTakeFirst();
  }
}
