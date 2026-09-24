import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentStaff,
  RequireEntra,
  RequirePermission,
} from '../auth/auth.decorators.js';
import type { StaffAccess } from '../auth/auth.types.js';
import { StaffAccessGuard } from '../auth/staff-access.guard.js';
import { AdminConfigurationService } from './admin-configuration.service.js';
import { configurationPage } from './admin-configuration.domain.js';

@RequireEntra()
@RequirePermission('admin.configuration.read')
@UseGuards(StaffAccessGuard)
@Controller('admin/configuration')
export class AdminConfigurationController {
  constructor(private readonly service: AdminConfigurationService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  read(
    @CurrentStaff() access: StaffAccess,
    @Query() query: Record<string, string>,
  ) {
    if (Object.keys(query).some((k) => !['issuePage', 'areaPage'].includes(k)))
      throw new BadRequestException('Invalid configuration query');
    return this.service.read(
      access,
      configurationPage(query.issuePage),
      configurationPage(query.areaPage),
    );
  }
}
