import { Module } from '@nestjs/common';
import { AdminIssueController } from './admin-issue.controller.js';
import { AdminIssueService } from './admin-issue.service.js';
import { AdminParticipationAreaController } from './admin-participation-area.controller.js';
import { AdminParticipationAreaService } from './admin-participation-area.service.js';
import { AdminConfigurationController } from './admin-configuration.controller.js';
import { AdminConfigurationService } from './admin-configuration.service.js';
import { AdminIntakeSettingsController } from './admin-intake-settings.controller.js';
import { AdminIntakeSettingsService } from './admin-intake-settings.service.js';
@Module({
  controllers: [
    AdminIssueController,
    AdminConfigurationController,
    AdminIntakeSettingsController,
    AdminParticipationAreaController,
  ],
  providers: [
    AdminIssueService,
    AdminConfigurationService,
    AdminIntakeSettingsService,
    AdminParticipationAreaService,
  ],
})
export class AdminModule {}
