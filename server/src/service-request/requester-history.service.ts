import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { StaffAccess } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';
import {
  assertStaffRequestRead,
  requestUuid,
  staffRequestReadScope,
} from './staff-request-scope.js';

@Injectable()
export class RequesterHistoryService {
  constructor(private readonly database: DatabaseService) {}

  async read(
    id: string,
    access: StaffAccess | undefined,
    page = 1,
    pageSize = 25,
    correlationId?: string,
  ) {
    assertStaffRequestRead(access, 'public');
    if (!requestUuid.test(id)) throw new NotFoundException();
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 1000000 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    )
      throw new BadRequestException('Invalid history page');
    return this.database.client
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (trx) => {
        const parent = await staffRequestReadScope(trx, access, 'public')
          .select('request.requester_id')
          .where('request.id', '=', id)
          .where('request.reporting_identity', '=', 'identified')
          .executeTakeFirst();
        if (!parent?.requester_id) throw new NotFoundException();
        const base = () =>
          staffRequestReadScope(trx, access, 'public')
            .where('request.reporting_identity', '=', 'identified')
            .where('request.requester_id', '=', parent.requester_id);
        const count = await base()
          .select(sql<number>`count(*)::integer`.as('total'))
          .executeTakeFirstOrThrow();
        const categories = await base()
          .select(['category.name', sql<number>`count(*)::integer`.as('count')])
          .groupBy(['category.id', 'category.name'])
          .orderBy('category.name')
          .orderBy('category.id')
          .execute();
        const rows = await base()
          .innerJoin('service_definition_version as version', (join) =>
            join
              .onRef('version.id', '=', 'request.service_definition_version_id')
              .onRef('version.organization_id', '=', 'request.organization_id'),
          )
          .select([
            'request.id as serviceRequestId',
            'request.reference_number as referenceNumber',
            'version.name as issueName',
            'request.status',
            'request.created_at as createdAt',
          ])
          .orderBy('request.created_at', 'desc')
          .orderBy('request.id', 'desc')
          .limit(pageSize)
          .offset((page - 1) * pageSize)
          .execute();
        // Required audit commits before any projection leaves this service. No identity metadata or payload.
        await trx
          .insertInto('requester_history_audit')
          .values({
            organization_id: access.organizationId,
            service_request_id: id,
            staff_identity_id: access.staffIdentityId,
            action: 'history_viewed',
            correlation_id:
              correlationId && requestUuid.test(correlationId)
                ? correlationId
                : randomUUID(),
          })
          .execute();
        return {
          items: rows.map((row) => ({
            ...row,
            current: row.serviceRequestId === id,
          })),
          total: count.total,
          categories,
          page,
          pageSize,
          hasPreviousPage: page > 1,
          hasNextPage: page * pageSize < count.total,
        };
      });
  }
}
