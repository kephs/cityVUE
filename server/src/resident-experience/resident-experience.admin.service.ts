import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { StaffAccess } from '../auth/auth.types.js';
import { assertConfigurationRead } from '../admin/admin-configuration.domain.js';
import { requestTransaction } from '../service-request/request-authorization.js';
import { ResidentExperienceRepository } from './resident-experience.repository.js';
import {
  ResidentExperienceService,
  type ResidentDraftPolicy,
} from './resident-experience.service.js';
import {
  classifyResidentChanges,
  type ResidentChanges,
} from './resident-experience.domain.js';
import { projectPublishedResidentExperience } from './resident-experience.public.dto.js';
import {
  residentAssets,
  residentActionIcons,
  residentBenefitIcons,
  residentRoutes,
  residentThemes,
  residentTones,
} from './resident-experience.policy.js';

export function assertResidentDraftWrite(
  access: StaffAccess,
  changes?: ResidentChanges,
): void {
  assertConfigurationRead(access);
  if (
    !access.permissions.includes('resident_experience.write') ||
    (changes?.consequential &&
      !access.permissions.includes('resident_experience.contact.manage'))
  )
    throw new ForbiddenException('Access denied');
}
export const residentDraftPolicy: ResidentDraftPolicy = (access, changes) => {
  assertResidentDraftWrite(access, changes);
  return Promise.resolve();
};

@Injectable()
export class AdminResidentExperienceService {
  constructor(private readonly repository: ResidentExperienceRepository) {}

  private read<T>(
    access: StaffAccess,
    project: (value: {
      revision: number;
      draft: Awaited<
        ReturnType<ResidentExperienceRepository['loadRevision']>
      > | null;
      hasPublication: boolean;
      consequential: boolean;
      access: StaffAccess;
    }) => T,
  ) {
    assertConfigurationRead(access);
    return requestTransaction(
      this.repository.database,
      access,
      ['admin.configuration.read'],
      async (trx, fresh) => {
        const resource = await trx
          .selectFrom('organization_resident_experience')
          .select(['revision', 'draft_revision_id', 'published_revision_id'])
          .where('organization_id', '=', fresh.organizationId)
          .forShare()
          .executeTakeFirst();
        if (!resource)
          throw new NotFoundException('Resident experience unavailable');
        const draft = resource.draft_revision_id
          ? await this.repository.loadRevision(
              trx,
              fresh.organizationId,
              resource.draft_revision_id,
            )
          : null;
        const published = resource.published_revision_id
          ? await this.repository.loadRevision(
              trx,
              fresh.organizationId,
              resource.published_revision_id,
            )
          : null;
        return project({
          revision: resource.revision,
          draft,
          hasPublication: !!published,
          consequential: draft
            ? classifyResidentChanges(published, draft).consequential
            : false,
          access: fresh,
        });
      },
    );
  }
  summary(access: StaffAccess) {
    return this.read(access, ({ access: fresh, ...value }) => ({
      ...value,
      capabilities: {
        canWrite: fresh.permissions.includes('resident_experience.write'),
        canManageContacts:
          fresh.permissions.includes('resident_experience.write') &&
          fresh.permissions.includes('resident_experience.contact.manage'),
      },
      registry: {
        assets: Object.fromEntries(
          Object.entries(residentAssets).map(([key, asset]) => [
            key,
            { role: asset.role },
          ]),
        ),
        actionIcons: residentActionIcons,
        benefitIcons: residentBenefitIcons,
        routes: residentRoutes,
        themes: residentThemes,
        tones: residentTones,
      },
    }));
  }
  preview(access: StaffAccess) {
    return this.read(access, ({ revision, draft }) => ({
      revision,
      unpublished: true,
      presentation: draft
        ? projectPublishedResidentExperience(draft)
        : { schemaVersion: 1 as const, configuration: null },
    }));
  }
  async save(access: StaffAccess, input: unknown, correlationId: string) {
    assertResidentDraftWrite(access);
    const result = await new ResidentExperienceService(
      this.repository,
      residentDraftPolicy,
      ['admin.configuration.read', 'resident_experience.write'],
    ).saveDraft(access, input, correlationId);
    return { revision: result.revision, changed: result.changed };
  }
}
