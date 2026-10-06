import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PinoLoggerService } from '../common/logging/pino-logger.service.js';
import { ResidentExperienceRepository } from './resident-experience.repository.js';
import {
  projectPublishedResidentExperience,
  type PublicResidentExperienceDto,
} from './resident-experience.public.dto.js';

@Injectable()
export class PublicResidentExperienceService {
  constructor(
    private readonly repository: ResidentExperienceRepository,
    private readonly logger: PinoLoggerService,
  ) {}
  /** ADR-025. Organization comes from the resolved resident TenantContext,
   * which the middleware derives server-side from the trusted request host.
   * No Host, forwarded header, body or query value reaches this service, and
   * no configuration fallback remains. */
  async getPublished(
    organizationId: string,
  ): Promise<PublicResidentExperienceDto> {
    try {
      const snapshot = await this.repository.getPublished(organizationId);
      return snapshot === null
        ? { schemaVersion: 1, configuration: null }
        : projectPublishedResidentExperience(snapshot);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.warn('Resident experience unavailable');
      throw new ServiceUnavailableException('Resident experience unavailable');
    }
  }
}
