import { NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import type { ContactRequestAccessPolicy } from './request-contact.service.js';

/** Matches existing PUBLIC detail UUID and category Department/Division scope.
 * This policy selects only an authorized parent; it never changes PUBLIC reads.
 */
export const publicContactPolicy: ContactRequestAccessPolicy = {
  permission: 'service_request.view',
  resolve: (trx, access, id) => {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      throw new NotFoundException();
    return trx
      .selectFrom('service_request as request')
      .innerJoin('organization', 'organization.id', 'request.organization_id')
      .innerJoin('category', (join) =>
        join
          .onRef('category.id', '=', 'request.category_id')
          .onRef('category.organization_id', '=', 'request.organization_id'),
      )
      .innerJoin('department', (join) =>
        join
          .onRef('department.id', '=', 'category.department_id')
          .onRef('department.organization_id', '=', 'request.organization_id'),
      )
      .select('request.id')
      .where('request.id', '=', id)
      .where('request.organization_id', '=', access.organizationId)
      .where('organization.status', '=', 'active')
      .where('request.audience', '=', 'public')
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
      )
      .forShare(['request', 'category', 'organization'])
      .executeTakeFirst();
  },
};
