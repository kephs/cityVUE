import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StaffAccess } from '../auth/auth.types.js';
import type { AppConfiguration } from '../config/configuration.js';
import { AiModelRegistry } from './ai-model-registry.js';
import type { AiGenerationRequest, AiModelDescriptor } from './ai.types.js';

@Injectable()
export class AiPolicyService {
  constructor(
    private readonly config: ConfigService<AppConfiguration, true>,
    private readonly registry: AiModelRegistry,
  ) {}

  assertWorkspaceAccess(staff: StaffAccess): void {
    if (
      staff.development ||
      !staff.tenantId ||
      !staff.objectId ||
      !staff.organizationId ||
      !staff.staffIdentityId ||
      !staff.permissions.includes('ai.workspace.access')
    ) {
      throw new ForbiddenException();
    }
  }

  assertAdministrationAccess(staff: StaffAccess): void {
    this.assertWorkspaceAccess(staff);
    if (!staff.permissions.includes('ai.administration.access')) {
      throw new ForbiddenException();
    }
  }

  status(staff: StaffAccess) {
    this.assertWorkspaceAccess(staff);
    return {
      enabled: this.config.get('ai.enabled', false, { infer: true }),
      chatEnabled: false as const,
      availability: 'unavailable' as const,
    };
  }

  models(staff: StaffAccess): AiModelDescriptor[] {
    if (!this.status(staff).enabled) throw new ServiceUnavailableException();
    // Explicit public projection: future registry internals must not become API data.
    return this.registry.list().map((model) => ({
      id: model.id,
      displayName: model.displayName,
      providerId: model.providerId,
      description: model.description,
      enabled: model.enabled,
      availability: model.availability,
      capabilities: [...model.capabilities],
      classificationPolicyId: model.classificationPolicyId,
    }));
  }

  authorizeGeneration(
    request: AiGenerationRequest,
    staff: StaffAccess,
  ): AiModelDescriptor {
    const models = this.models(staff);
    const model = models.find(
      (candidate) => candidate.id === request.selection.modelId,
    );
    if (
      !model ||
      !model.enabled ||
      model.availability !== 'available' ||
      !model.capabilities.includes('text-generation') ||
      !model.classificationPolicyId
    ) {
      throw new ForbiddenException();
    }
    // Hard stop even if a registry entry/config is accidentally enabled.
    // Future approvals, quotas and classification checks belong before this boundary.
    throw new ServiceUnavailableException();
  }
}
