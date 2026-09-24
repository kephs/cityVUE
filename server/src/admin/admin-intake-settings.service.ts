import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { StaffAccess } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';
import { setParticipationCollection } from '../database/participation-configuration.js';
import { requestUuid } from '../service-request/staff-request-scope.js';
import { assertConfigurationRead } from './admin-configuration.domain.js';

export function assertIntakeSettingsWrite(
  access: StaffAccess | undefined,
): asserts access is StaffAccess {
  assertConfigurationRead(access);
  if (!access.permissions.includes('admin.intake_settings.write'))
    throw new ForbiddenException('Access denied');
}

@Injectable()
export class AdminIntakeSettingsService {
  constructor(private readonly database: DatabaseService) {}
  async change(
    access: StaffAccess | undefined,
    input: { enabled: boolean; expectedRevision: number } | undefined,
    correlationId?: string,
  ) {
    assertIntakeSettingsWrite(access);
    if (
      !input ||
      typeof input.enabled !== 'boolean' ||
      !Number.isInteger(input.expectedRevision) ||
      input.expectedRevision < 1 ||
      input.expectedRevision > 2147483647 ||
      Object.keys(input).some(
        (k) => !['enabled', 'expectedRevision'].includes(k),
      )
    )
      throw new BadRequestException('Invalid collection setting');
    return this.database.client.transaction().execute(async (trx) => {
      const old = await trx
        .selectFrom('organization')
        .select([
          'service_participation_collection_enabled',
          'participation_collection_revision',
        ])
        .where('id', '=', access.organizationId)
        .where('status', '=', 'active')
        .forUpdate()
        .executeTakeFirst();
      if (!old) throw new ForbiddenException('Access denied');
      if (old.participation_collection_revision !== input.expectedRevision)
        throw new ConflictException(
          'Configuration changed since you opened this page. Refresh before saving.',
        );
      if (old.service_participation_collection_enabled === input.enabled)
        return {
          enabled: input.enabled,
          revision: old.participation_collection_revision,
          changed: false,
        };
      if (old.participation_collection_revision === 2147483647)
        throw new ConflictException(
          'Configuration cannot be changed. Contact your administrator.',
        );
      const updated = await setParticipationCollection(
        trx,
        access.organizationId,
        input.enabled,
      );
      await trx
        .insertInto('participation_collection_audit')
        .values({
          organization_id: access.organizationId,
          staff_identity_id: access.staffIdentityId,
          action: 'service_participation_collection_changed',
          prior_enabled: old.service_participation_collection_enabled,
          enabled: updated.service_participation_collection_enabled,
          prior_revision: old.participation_collection_revision,
          revision: updated.participation_collection_revision,
          correlation_id:
            correlationId && requestUuid.test(correlationId)
              ? correlationId
              : randomUUID(),
        })
        .execute();
      return {
        enabled: updated.service_participation_collection_enabled,
        revision: updated.participation_collection_revision,
        changed: true,
      };
    });
  }
}
