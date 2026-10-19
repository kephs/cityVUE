import { requestTransaction, lockRequestRow } from './request-authorization.js';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import type { AppConfiguration } from '../config/configuration.js';
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
import { lockStaff } from '../database/reference-locks.js';

@Injectable()
export class RequestTrackingService {
  /**
   * F065. OFF unless the environment says exactly 'true', so a missing or
   * unrecognized value never activates it, no client or tenant can override
   * it, and applying the migration does not switch it on.
   *
   * The flag gates automatic intake issuance and credential expiry together,
   * so a disabled rollout behaves exactly as it did before this feature: no
   * credential is minted at intake, and staff issuance stays non-expiring.
   */
  readonly intakeIssuanceEnabled: boolean;
  constructor(
    private readonly database: DatabaseService,
    private readonly repository: RequestTrackingRepository,
    config: ConfigService<AppConfiguration, true>,
  ) {
    // Validated configuration supplies a real boolean: `configuration()`
    // derives it from an exact 'true', so a missing or malformed environment
    // value arrives here as false.
    this.intakeIssuanceEnabled = config.get(
      'requesterTracking.intakeIssuanceEnabled',
      { infer: true },
    );
  }

  private async parent(
    trx: Transaction<DatabaseSchema>,
    access: StaffAccess,
    id: string,
    write: boolean,
  ) {
    if (!requestUuid.test(id)) throw new NotFoundException();
    await lockRequestRow(trx, access.organizationId, id, write);
    let query = staffRequestReadScope(trx, access, 'public')
      .select('request.id')
      .where('request.id', '=', id);
    query = write
      ? query.forUpdate('request').forShare(['category', 'organization'])
      : query.forShare(['request', 'category', 'organization']);
    if (!(await query.executeTakeFirst())) throw new NotFoundException();
    // F060.3C-2d: actor liveness is asserted by the owner-owned helper, which
    // carries the same active predicate this site already required.
    if (!(await lockStaff(trx, access.organizationId, access.staffIdentityId)))
      throw new ForbiddenException();
  }
  async state(id: string, access: StaffAccess | undefined) {
    assertStaffRequestRead(access, 'public');
    assertStaffRequestPermission(access, TRACKING_MANAGE);
    return requestTransaction(
      this.database.client,
      access,
      [TRACKING_MANAGE],
      async (trx, access) => {
        await this.parent(trx, access, id, false);
        return this.repository.state(trx, access.organizationId, id);
      },
    );
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
    return requestTransaction(
      this.database.client,
      access,
      [TRACKING_MANAGE],
      async (trx, access) => {
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
            .set({
              status: 'revoked',
              revoked_at: sql<Date>`clock_timestamp()`,
            })
            .where('organization_id', '=', access.organizationId)
            .where('id', '=', current.version ?? '')
            .execute();
        let credential: string | undefined;
        let expiresAt: string | undefined;
        let version = current.version;
        if (operation !== 'revoke') {
          const generated = generateTrackingCredential();
          // F065: an issued or rotated staff credential takes the tenant's
          // current lifetime policy, preserving staff issuer attribution and
          // leaving the revoked row above untouched as history.
          const lifetime = this.intakeIssuanceEnabled
            ? await this.repository.lifetimeDays(trx, access.organizationId)
            : null;
          const row = await trx
            .insertInto('request_tracking_credential')
            .values({
              organization_id: access.organizationId,
              service_request_id: id,
              credential_digest: generated.digest,
              status: 'active',
              created_by_staff_identity_id: access.staffIdentityId,
              issuer_type: 'staff',
              expires_at: lifetime
                ? sql<Date>`clock_timestamp() + make_interval(days => ${sql.lit(lifetime)})`
                : null,
              revoked_at: null,
            })
            .returning([
              'id',
              sql<string | null>`expires_at::text`.as('expires_at'),
            ])
            .executeTakeFirstOrThrow();
          version = row.id;
          credential = generated.credential;
          if (row.expires_at)
            expiresAt = new Date(row.expires_at).toISOString();
        }
        const action = {
          issue: 'issued',
          rotate: 'rotated',
          revoke: 'revoked',
        }[operation];
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
          ...(expiresAt ? { expiresAt } : {}),
        };
      },
    );
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
