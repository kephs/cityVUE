import { Module } from '@nestjs/common';
import { AdminConfigurationController } from './admin-configuration.controller.js';
import { AdminConfigurationService } from './admin-configuration.service.js';
import { AdminIntakeSettingsController } from './admin-intake-settings.controller.js';
import { AdminIntakeSettingsService } from './admin-intake-settings.service.js';
@Module({
  controllers: [AdminConfigurationController, AdminIntakeSettingsController],
  providers: [AdminConfigurationService, AdminIntakeSettingsService],
})
export class AdminModule {}
