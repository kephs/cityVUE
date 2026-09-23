import {
  validateStaffListControls,
  type StaffListControls,
} from './staff-list-controls.js';
import { assignmentProjection, operationalView } from './ownership-targets.js';
import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import type { StaffAccess } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';
import {
  persistedRequestAudience,
  requestCapabilities,
} from './staff-request-policy.js';

import {
  assertInternalAccess,
  internalRequestUuid as uuid,
  internalDepartment,
  internalDivision,
} from './internal-request-scope.js';
import {
  assertStaffRequestRead,
  staffRequestReadScope,
  readableRequestAudiences,
  type StaffRequestAudienceFilter,
} from './staff-request-scope.js';

export function assertInternalReadAccess(
  access: StaffAccess | undefined,
): asserts access is StaffAccess {
  assertInternalAccess(access, 'service_request.internal.read');
}

export interface InternalRequestFilters extends StaffListControls {
  audience?: StaffRequestAudienceFilter;
  view?: string;
  search?: string;
  status?: string;
  departmentId?: string;
  divisionId?: string;
}
@Injectable()
export class InternalRequestRepository {
  constructor(private readonly database: DatabaseService) {}

  private scoped(
    access: StaffAccess | undefined,
    audience: StaffRequestAudienceFilter,
  ) {
    assertStaffRequestRead(access, audience);
    return staffRequestReadScope(
      this.database.client,
      access,
      audience,
    ).innerJoin('service_definition_version as version', (join) =>
      join
        .onRef('version.id', '=', 'request.service_definition_version_id')
        .onRef('version.organization_id', '=', 'request.organization_id'),
    );
  }

  private filtered(
    access: StaffAccess | undefined,
    filters: InternalRequestFilters = {},
    audience: StaffRequestAudienceFilter = 'internal',
  ) {
    const { assignment } = validateStaffListControls(filters);
    let query = this.scoped(access, audience);
    assertStaffRequestRead(access, audience);
    if (filters.audience && filters.audience !== 'all')
      query = query.where('request.audience', '=', filters.audience);
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
    if (assignment !== 'all')
      query = query.where(
        assignmentProjection(access.organizationId),
        assignment === 'assigned' ? 'is not' : 'is',
        null,
      );
    return query;
  }

  private projection(
    access: StaffAccess | undefined,
    filters: InternalRequestFilters = {},
    audience: StaffRequestAudienceFilter = 'internal',
  ) {
    assertStaffRequestRead(access, audience);
    return this.filtered(access, filters, audience)
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
    audience: StaffRequestAudienceFilter = 'internal',
  ) {
    const count = await this.filtered(access, filters, audience)
      .select(sql<number>`count(*)::integer`.as('total'))
      .executeTakeFirstOrThrow();
    const { sort, direction } = validateStaffListControls(filters);
    let query = this.projection(access, filters, audience);
    // These expressions are server-owned; browser values never become SQL identifiers.
    switch (sort) {
      case 'issue':
        query = query
          .orderBy('version.name', direction)
          .orderBy('request.reference_number', direction);
        break;
      case 'status':
        query = query.orderBy('request.status', direction);
        break;
      case 'department':
        query = query
          .orderBy('effective_department.name', direction)
          .orderBy('effective_division.name', (order) =>
            direction === 'asc'
              ? order.asc().nullsLast()
              : order.desc().nullsLast(),
          );
        break;
      case 'assignment': {
        assertStaffRequestRead(access, audience);
        const owner = assignmentProjection(access.organizationId);
        query = query
          .orderBy(sql<string>`(${owner})::jsonb ->> 'displayName'`, (order) =>
            direction === 'asc'
              ? order.asc().nullsLast()
              : order.desc().nullsLast(),
          )
          .orderBy(sql<string>`(${owner})::jsonb ->> 'type'`, (order) =>
            direction === 'asc'
              ? order.asc().nullsLast()
              : order.desc().nullsLast(),
          );
        break;
      }
      default:
        query = query.orderBy('request.created_at', direction);
    }
    const items = await query
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

  async workspaceOptions(
    access: StaffAccess | undefined,
    audience: StaffRequestAudienceFilter = 'internal',
  ) {
    assertStaffRequestRead(access, audience);
    const active = await this.database.client
      .selectFrom('organization')
      .select('id')
      .where('id', '=', access.organizationId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    const canUpdate =
      Boolean(active) &&
      access.permissions.includes('service_request.internal.update');
    const audiences =
      audience === 'all'
        ? { audiences: active ? readableRequestAudiences(access) : [] }
        : {};
    if (!active || !access.departmentIds.length)
      return {
        ...(audience === 'internal' ? { canUpdate: false } : {}),
        departments: [],
        divisions: [],
        ...audiences,
      };
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
    return {
      ...(audience === 'internal' ? { canUpdate } : {}),
      departments,
      divisions,
      ...audiences,
    };
  }

  async activity(
    access: StaffAccess | undefined,
    id: string,
    page: number,
    pageSize: number,
    audience: StaffRequestAudienceFilter = 'internal',
  ) {
    assertStaffRequestRead(access, audience);
    if (!uuid.test(id)) throw new NotFoundException();
    // One repeatable-read snapshot keeps request admission and history scope consistent.
    return this.database.client
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (trx) => {
        const parent = await staffRequestReadScope(trx, access, audience)
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

  async details(
    access: StaffAccess | undefined,
    id: string,
    audience: StaffRequestAudienceFilter = 'internal',
  ) {
    // Authorize even malformed lookups. No contacts, identities or activity joins.
    const query = this.projection(access, {}, audience);
    if (!uuid.test(id)) return undefined;
    const row = await query
      .select([
        'request.description',
        'request.revision',
        'request.intake_channel as intakeChannel',
      ])
      .where('request.id', '=', id)
      .executeTakeFirst();
    if (!row) return undefined;
    const { intakeChannel, ...safeRow } = row;
    return {
      ...safeRow,
      ...(audience === 'all' && access
        ? {
            intakeChannel,
            capabilities: requestCapabilities(
              access,
              persistedRequestAudience(row.audience),
              row.status,
            ),
          }
        : {}),
      canReadContact:
        access?.permissions.includes('service_request.contact.read') === true,
    };
  }
}
