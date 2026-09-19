import { ForbiddenException, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { StaffAccess } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Only guard-resolved StaffAccess may be supplied; never accept client scope. */
export function assertInternalReadAccess(
  access: StaffAccess | undefined,
): asserts access is StaffAccess {
  if (
    !access ||
    access.development ||
    !access.tenantId ||
    !access.objectId ||
    !uuid.test(access.organizationId) ||
    !uuid.test(access.staffIdentityId) ||
    !access.permissions.includes('service_request.internal.read')
  ) {
    throw new ForbiddenException('Access denied');
  }
}

@Injectable()
export class InternalRequestRepository {
  constructor(private readonly database: DatabaseService) {}

  private scoped(access: StaffAccess | undefined) {
    assertInternalReadAccess(access);
    return this.database.client
      .selectFrom('service_request as request')
      .innerJoin(
        'organization as organization',
        'organization.id',
        'request.organization_id',
      )
      .innerJoin('category as category', (join) =>
        join
          .onRef('category.id', '=', 'request.category_id')
          .onRef('category.organization_id', '=', 'request.organization_id'),
      )
      .innerJoin('service_definition_version as version', (join) =>
        join
          .onRef('version.id', '=', 'request.service_definition_version_id')
          .onRef('version.organization_id', '=', 'request.organization_id'),
      )
      .where('request.organization_id', '=', access.organizationId)
      .where('organization.status', '=', 'active')
      .where('request.audience', '=', 'internal')
      .where((eb) =>
        access.departmentIds.length
          ? eb('category.department_id', 'in', access.departmentIds)
          : sql<boolean>`false`,
      )
      .where((eb) =>
        access.divisionIds.length
          ? eb.or([
              eb('category.division_id', 'is', null),
              eb('category.division_id', 'in', access.divisionIds),
            ])
          : eb('category.division_id', 'is', null),
      );
  }

  private projection(access: StaffAccess | undefined) {
    return this.scoped(access).select([
      'request.id as serviceRequestId',
      'request.reference_number as referenceNumber',
      'request.audience',
      'request.status',
      'request.priority',
      'request.created_at as createdAt',
      'request.updated_at as updatedAt',
      'version.name as issueName',
      'category.id as categoryId',
      'category.department_id as departmentId',
      'category.division_id as divisionId',
    ]);
  }

  async list(access: StaffAccess | undefined, page: number, pageSize: number) {
    const count = await this.scoped(access)
      .select(sql<number>`count(*)::integer`.as('total'))
      .executeTakeFirstOrThrow();
    const items = await this.projection(access)
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

  async details(access: StaffAccess | undefined, id: string) {
    // Authorize even malformed lookups. No contacts, identities or activity joins.
    const query = this.projection(access);
    if (!uuid.test(id)) return undefined;
    return query
      .select('request.description')
      .where('request.id', '=', id)
      .executeTakeFirst();
  }
}
