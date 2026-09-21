import { NotFoundException } from '@nestjs/common';
import type { ContactRequestAccessPolicy } from './request-contact.service.js';
import { staffRequestReadScope } from './staff-request-scope.js';

/** Matches PUBLIC detail identity and effective Department/Division scope.
 * Contact remains independently authorized and never appears in ordinary reads.
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
    return staffRequestReadScope(trx, access, 'public')
      .select('request.id')
      .where('request.id', '=', id)
      .forShare(['request', 'category', 'organization'])
      .executeTakeFirst();
  },
};
