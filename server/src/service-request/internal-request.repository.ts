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
      internalDepartment.as('departmentId'),
      internalDivision.as('divisionId'),
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
      .select(['request.description', 'request.revision'])
      .where('request.id', '=', id)
      .executeTakeFirst();
  }
}
