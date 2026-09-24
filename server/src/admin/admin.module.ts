import { Module } from '@nestjs/common';
import { AdminConfigurationController } from './admin-configuration.controller.js';
import { AdminConfigurationService } from './admin-configuration.service.js';
@Module({
  controllers: [AdminConfigurationController],
  providers: [AdminConfigurationService],
})
export class AdminModule {}
