import { Injectable } from '@nestjs/common';
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
