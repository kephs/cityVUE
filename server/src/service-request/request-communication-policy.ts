import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';

export type CommunicationEligibility =
  'eligible' | 'anonymous' | 'requester_inactive' | 'unavailable';

/** Evaluate only inside an authorized parent query using its trusted `request` alias.
 * Writes hold the F058.1 Organization/access-state barrier before evaluation.
 * No recipient identifier or directory information is projected to the browser.
 */
export function communicationEligibility() {
  return sql<CommunicationEligibility>`case
    when request.audience = 'public' then
      case when request.reporting_identity = 'anonymous' then 'anonymous' else 'eligible' end
    when request.audience = 'internal'
      and request.reporting_identity = 'identified'
      and request.requester_staff_identity_id = request.submitted_by_staff_identity_id
      then coalesce((select case when requester.active then 'eligible' else 'requester_inactive' end
        from staff_identity requester
        where requester.organization_id = request.organization_id
          and requester.id = request.requester_staff_identity_id), 'unavailable')
    else 'unavailable' end`;
}

export function assertCommunicationEligibility(
  eligibility: CommunicationEligibility,
  create: boolean,
) {
  if (eligibility === 'unavailable') throw new NotFoundException();
  if (create && eligibility !== 'eligible')
    throw new ForbiddenException('Requester communication is unavailable');
}
