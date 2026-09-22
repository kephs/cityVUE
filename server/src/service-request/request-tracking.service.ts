import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import type { StaffAccess } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';
import type { DatabaseSchema } from '../database/database.types.js';
import {
  assertStaffRequestRead,
  assertStaffRequestPermission,
  requestUuid,
  staffRequestReadScope,
} from './staff-request-scope.js';
import {
  generateTrackingCredential,
  trackingDigest,
  validTrackingCredential,
  TRACKING_MANAGE,
} from './request-tracking.domain.js';
import { RequestTrackingRepository } from './request-tracking.repository.js';

@Injectable()
export class RequestTrackingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly repository: RequestTrackingRepository,
  ) {}

  private async parent(
    trx: Transaction<DatabaseSchema>,
    access: StaffAccess,
    id: string,
    write: boolean,
  ) {
    if (!requestUuid.test(id)) throw new NotFoundException();
    let query = staffRequestReadScope(trx, access, 'public')
      .select('request.id')
      .where('request.id', '=', id);
    query = write
      ? query.forUpdate('request').forShare(['category', 'organization'])
      : query.forShare(['request', 'category', 'organization']);
    if (!(await query.executeTakeFirst())) throw new NotFoundException();
    if (
      !(await trx
        .selectFrom('staff_identity')
        .select('id')
        .where('organization_id', '=', access.organizationId)
        .where('id', '=', access.staffIdentityId)
        .where('active', '=', true)
        .forShare()
        .executeTakeFirst())
    )
      throw new ForbiddenException();
  }
  async state(id: string, access: StaffAccess | undefined) {
    assertStaffRequestRead(access, 'public');
    assertStaffRequestPermission(access, TRACKING_MANAGE);
    return this.database.client.transaction().execute(async (trx) => {
      await this.parent(trx, access, id, false);
      return this.repository.state(trx, access.organizationId, id);
    });
  }
  async change(
    id: string,
    access: StaffAccess | undefined,
    operation: 'issue' | 'rotate' | 'revoke',
    expectedVersion: string | null,
    correlationId?: string,
  ) {
    assertStaffRequestRead(access, 'public');
    assertStaffRequestPermission(access, TRACKING_MANAGE);
    return this.database.client.transaction().execute(async (trx) => {
      await this.parent(trx, access, id, true);
      const current = await this.repository.state(
        trx,
        access.organizationId,
        id,
      );
      if (
        current.version !== expectedVersion ||
        (operation === 'issue'
          ? current.status === 'active'
          : current.status !== 'active')
      )
        throw new ConflictException();
      if (current.status === 'active')
        await trx
          .updateTable('request_tracking_credential')
          .set({ status: 'revoked', revoked_at: sql<Date>`clock_timestamp()` })
          .where('organization_id', '=', access.organizationId)
          .where('id', '=', current.version ?? '')
          .execute();
      let credential: string | undefined;
      let version = current.version;
      if (operation !== 'revoke') {
        const generated = generateTrackingCredential();
        const row = await trx
          .insertInto('request_tracking_credential')
          .values({
            organization_id: access.organizationId,
            service_request_id: id,
            credential_digest: generated.digest,
            status: 'active',
            created_by_staff_identity_id: access.staffIdentityId,
            revoked_at: null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        version = row.id;
        credential = generated.credential;
      }
      const action = { issue: 'issued', rotate: 'rotated', revoke: 'revoked' }[
        operation
      ];
      await trx
        .insertInto('activity')
        .values({
          id: randomUUID(),
          organization_id: access.organizationId,
          service_request_id: id,
          activity_type: `requester_tracking_${action}`,
          actor_type: 'staff',
          actor_reference: null,
          staff_identity_id: access.staffIdentityId,
          metadata: {
            policy: 'F044',
            action: `tracking_${action}`,
            correlationId:
              correlationId && requestUuid.test(correlationId)
                ? correlationId
                : randomUUID(),
          },
        })
        .execute();
      return {
        status: operation === 'revoke' ? 'revoked' : 'active',
        version,
        ...(credential ? { credential } : {}),
      };
    });
  }
  async track(credential: unknown) {
    if (!validTrackingCredential(credential)) throw new NotFoundException();
    const projection = await this.database.client
      .transaction()
      .execute((trx) =>
        this.repository.resolve(trx, trackingDigest(credential)),
      );
    if (!projection) throw new NotFoundException();
    return projection;
  }
}
