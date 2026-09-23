import { Controller, Get, Header, Query, Req, UseGuards } from '@nestjs/common';
import { IsString, Matches } from 'class-validator';
import {
  CurrentStaff,
  RequireEntra,
  RequirePermission,
} from '../auth/auth.decorators.js';
import { StaffAccessGuard } from '../auth/staff-access.guard.js';
import type { StaffAccess } from '../auth/auth.types.js';
import { assertStaffRequestPermission } from './staff-request-scope.js';
import { ParticipationService } from './participation.service.js';

export class ParticipationPeriodDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate!: string;
}
@Controller('intake/participation-areas')
export class ParticipationAreaController {
  constructor(private readonly service: ParticipationService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  areas() {
    return this.service.areas();
  }
}
@RequireEntra()
@RequirePermission('service_request.create')
@UseGuards(StaffAccessGuard)
@Controller('staff/participation-areas')
export class StaffParticipationAreaController {
  constructor(private readonly service: ParticipationService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  areas(@CurrentStaff() access: StaffAccess) {
    assertStaffRequestPermission(access, 'service_request.create');
    return this.service.areas(access.organizationId);
  }
}
@RequireEntra()
@RequirePermission('analytics.service_participation.read')
@UseGuards(StaffAccessGuard)
@Controller('staff/analytics/service-participation')
export class ParticipationAnalyticsController {
  constructor(private readonly service: ParticipationService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  read(
    @CurrentStaff() access: StaffAccess,
    @Query() query: ParticipationPeriodDto,
    @Req() req: { id?: string },
  ) {
    return this.service.read(access, query.startDate, query.endDate, req.id);
  }
}
