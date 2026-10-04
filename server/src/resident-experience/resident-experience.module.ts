import { Module } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { ResidentExperienceRepository } from './resident-experience.repository.js';
import { PublicResidentExperienceController } from './resident-experience.public.controller.js';
import { PublicResidentExperienceService } from './resident-experience.public.service.js';
import { AdminResidentExperienceService } from './resident-experience.admin.service.js';
import { AdminResidentExperienceController } from './resident-experience.admin.controller.js';
import { AdminResidentReviewController } from './resident-experience.review.controller.js';
import { AdminResidentReviewService } from './resident-experience.review.service.js';
import { ResidentPublicationService } from './resident-experience.publication.service.js';
import { AdminResidentPublicationController } from './resident-experience.publication.controller.js';

@Module({
  controllers: [
    PublicResidentExperienceController,
    AdminResidentExperienceController,
    AdminResidentReviewController,
    AdminResidentPublicationController,
  ],
  providers: [
    {
      provide: ResidentExperienceRepository,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new ResidentExperienceRepository(() => database.client),
    },
    PublicResidentExperienceService,
    AdminResidentExperienceService,
    AdminResidentReviewService,
    ResidentPublicationService,
  ],
})
export class ResidentExperienceModule {}
