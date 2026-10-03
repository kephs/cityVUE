import { Module } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { ResidentExperienceRepository } from './resident-experience.repository.js';
import { PublicResidentExperienceController } from './resident-experience.public.controller.js';
import { PublicResidentExperienceService } from './resident-experience.public.service.js';

@Module({
  controllers: [PublicResidentExperienceController],
  providers: [
    {
      provide: ResidentExperienceRepository,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) =>
        new ResidentExperienceRepository(() => database.client),
    },
    PublicResidentExperienceService,
  ],
})
export class ResidentExperienceModule {}
