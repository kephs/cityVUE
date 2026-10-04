import { Module } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { ResidentExperienceRepository } from './resident-experience.repository.js';
import { PublicResidentExperienceController } from './resident-experience.public.controller.js';
import { PublicResidentExperienceService } from './resident-experience.public.service.js';
import { AdminResidentExperienceService } from './resident-experience.admin.service.js';
import { AdminResidentExperienceController } from './resident-experience.admin.controller.js';
import { AdminResidentReviewController } from './resident-experience.review.controller.js';
import { AdminResidentReviewService } from './resident-experience.review.service.js';

@Module({
  controllers: [
    PublicResidentExperienceController,
    AdminResidentExperienceController,
    AdminResidentReviewController,
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
  ],
})
export class ResidentExperienceModule {}
