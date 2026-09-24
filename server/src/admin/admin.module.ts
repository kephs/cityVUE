import { Module } from '@nestjs/common';
import { AdminParticipationAreaController } from './admin-participation-area.controller.js';
import { AdminParticipationAreaService } from './admin-participation-area.service.js';
import { AdminConfigurationController } from './admin-configuration.controller.js';
import { AdminConfigurationService } from './admin-configuration.service.js';
import { AdminIntakeSettingsController } from './admin-intake-settings.controller.js';
import { AdminIntakeSettingsService } from './admin-intake-settings.service.js';
@Module({
  controllers: [
    AdminConfigurationController,
    AdminIntakeSettingsController,
    AdminParticipationAreaController,
  ],
  providers: [
    AdminConfigurationService,
    AdminIntakeSettingsService,
    AdminParticipationAreaService,
  ],
})
export class AdminModule {}
