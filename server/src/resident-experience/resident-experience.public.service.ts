import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from '../config/configuration.js';
import { PinoLoggerService } from '../common/logging/pino-logger.service.js';
import { ResidentExperienceRepository } from './resident-experience.repository.js';
import {
  projectPublishedResidentExperience,
  type PublicResidentExperienceDto,
} from './resident-experience.public.dto.js';

@Injectable()
export class PublicResidentExperienceService {
  private readonly organizationId: string;
  constructor(
    config: ConfigService<AppConfiguration, true>,
    private readonly repository: ResidentExperienceRepository,
    private readonly logger: PinoLoggerService,
  ) {
    // Same deployment-owned development context as anonymous catalog/alerts.
    // No Host, forwarded header, body or query value participates in resolution.
    this.organizationId = config.get('catalog.developmentOrganizationId', {
      infer: true,
    });
  }
  async getPublished(): Promise<PublicResidentExperienceDto> {
    try {
      const snapshot = await this.repository.getPublished(this.organizationId);
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
