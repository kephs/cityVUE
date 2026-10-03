import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Transaction } from 'kysely';
import type { DatabaseSchema } from '../database/database.types.js';
import type { StaffAccess, Permission } from '../auth/auth.types.js';
import { authorizeRequestTransaction } from '../service-request/request-authorization.js';
import { requestUuid } from '../service-request/staff-request-scope.js';
import {
  classifyResidentChanges,
  validateResidentSnapshot,
  type ResidentChanges,
} from './resident-experience.domain.js';
import type { ResidentExperienceRepository } from './resident-experience.repository.js';

/** Policies check approved permissions against fresh transaction authority and actual changes.
 * The default still denies every save; Slice 3 supplies an explicit protected policy.
 * This is dependency injection, not an environment flag or development bypass.
 */
export type ResidentDraftPolicy = (
  access: StaffAccess,
  changes: ResidentChanges,
  trx: Transaction<DatabaseSchema>,
) => Promise<void>;
const denyDraftSave: ResidentDraftPolicy = () =>
  Promise.reject(
    new ForbiddenException('Resident experience writes are not enabled'),
  );

// Internal command, constructed by the protected Admin service with its explicit policy.
export class ResidentExperienceService {
  constructor(
    private readonly repository: ResidentExperienceRepository,
    private readonly authorizeSave: ResidentDraftPolicy = denyDraftSave,
    private readonly requiredPermissions: readonly Permission[] = [],
  ) {}

  async saveDraft(access: StaffAccess, input: unknown, correlationId: string) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new BadRequestException('Invalid draft command');
    const command = input as Record<string, unknown>;
    if (
      Object.keys(command).length !== 2 ||
      !Object.hasOwn(command, 'snapshot') ||
      !Object.hasOwn(command, 'expectedRevision') ||
      typeof command.expectedRevision !== 'number' ||
      !Number.isInteger(command.expectedRevision) ||
      command.expectedRevision < 1 ||
      command.expectedRevision >= 2147483647 ||
      !requestUuid.test(correlationId)
    )
      throw new BadRequestException('Invalid draft command');
    const expectedRevision = command.expectedRevision;
    const snapshot = validateResidentSnapshot(command.snapshot);
    return this.repository.database
      .transaction()
      .setIsolationLevel('read committed')
      .execute(async (trx) => {
        const currentAccess = await authorizeRequestTransaction(
          trx,
          access,
          this.requiredPermissions,
        );
        const organizationId = currentAccess.organizationId;
        const resource = await trx
          .selectFrom('organization_resident_experience')
          .selectAll()
          .where('organization_id', '=', organizationId)
          .forUpdate()
          .executeTakeFirst();
        if (!resource)
          throw new ForbiddenException('Resident experience unavailable');
        if (resource.revision !== expectedRevision)
          throw new ConflictException(
            'Resident experience changed. Refresh before saving.',
          );
        const before = resource.draft_revision_id
          ? await this.repository.loadRevision(
              trx,
              organizationId,
              resource.draft_revision_id,
            )
          : null;
        const changes = classifyResidentChanges(before, snapshot);
        await this.authorizeSave(currentAccess, changes, trx);
        if (before && changes.changedFields.length === 0)
          return {
            revision: resource.revision,
            draftRevisionId: resource.draft_revision_id,
            changed: false,
          };
        const revisionId = randomUUID(),
          revision = resource.revision + 1;
        await this.repository.insertRevision(
          trx,
          {
            organizationId,
            actorId: currentAccess.staffIdentityId,
            revisionId,
            resourceRevision: revision,
          },
          snapshot,
        );
        await trx
          .updateTable('organization_resident_experience')
          .set({ revision, draft_revision_id: revisionId })
          .where('organization_id', '=', organizationId)
          .where('revision', '=', expectedRevision)
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('resident_experience_event')
          .values({
            id: randomUUID(),
            organization_id: organizationId,
            actor_id: currentAccess.staffIdentityId,
            operation: 'draft_saved',
            prior_revision_id: resource.draft_revision_id,
            new_revision_id: revisionId,
            prior_resource_revision: resource.revision,
            resource_revision: revision,
            changed_fields: changes.changedFields,
            consequential: changes.consequential,
            reasons: changes.reasons,
            correlation_id: correlationId,
          })
          .execute();
        return { revision, draftRevisionId: revisionId, changed: true };
      });
  }
}
