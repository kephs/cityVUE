import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Permission, StaffAccess } from '../auth/auth.types.js';
import type { Transaction } from 'kysely';
import type { DatabaseSchema } from '../database/database.types.js';
import { DatabaseService } from '../database/database.service.js';
import {
  assertInternalAccess,
  internalRequestScope,
  internalRequestUuid,
} from './internal-request-scope.js';

export interface RequestContactProjection {
  name: string | null;
  email: string | null;
}

/** Server-owned policy, never a browser-supplied audience or authorization flag. */
export interface ContactRequestAccessPolicy {
  permission: Permission;
  resolve(
    trx: Transaction<DatabaseSchema>,
    access: StaffAccess,
    id: string,
  ): Promise<{ id: string } | undefined>;
}

export const internalContactPolicy: ContactRequestAccessPolicy = {
  permission: 'service_request.internal.read',
  resolve: (trx, access, id) =>
    internalRequestScope(trx, access)
      .select('request.id')
      .where('request.id', '=', id)
      .forShare(['request', 'category', 'organization'])
      .executeTakeFirst(),
};

/** Structured requester data only. Staff submitter and service location are separate. */
@Injectable()
export class RequestContactService {
  constructor(private readonly database: DatabaseService) {}

  async read(
    id: string,
    access: StaffAccess | undefined,
    policy: ContactRequestAccessPolicy,
    correlationId?: string,
  ): Promise<RequestContactProjection> {
    assertInternalAccess(access, policy.permission);
    assertInternalAccess(access, 'service_request.contact.read');
    if (!internalRequestUuid.test(id)) throw new NotFoundException();
    return this.database.client.transaction().execute(async (trx) => {
      // Shared request/classification locks prevent routing across the checked scope before disclosure commits.
      const parent = await policy.resolve(trx, access, id);
      if (parent?.id !== id) throw new NotFoundException();
      const contact = await trx
        .selectFrom('requester_contact')
        .select(['name', 'email'])
        .where('organization_id', '=', access.organizationId)
        .where('service_request_id', '=', id)
        .executeTakeFirst();
      // Await the transaction commit before returning anything, including the no-contact state.
      await trx
        .insertInto('activity')
        .values({
          id: randomUUID(),
          organization_id: access.organizationId,
          service_request_id: id,
          activity_type: 'service_request_contact_viewed',
          actor_type: 'staff',
          actor_reference: null,
          staff_identity_id: access.staffIdentityId,
          metadata: {
            policy: 'F039',
            action: 'contact_viewed',
            correlationId:
              correlationId && internalRequestUuid.test(correlationId)
                ? correlationId
                : randomUUID(),
          },
        })
        .execute();
      return { name: contact?.name ?? null, email: contact?.email ?? null };
    });
  }
}
