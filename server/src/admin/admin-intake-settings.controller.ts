import {
  Body,
  Controller,
  Header,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsInt, Max, Min } from 'class-validator';
import {
  CurrentStaff,
  RequireEntra,
  RequirePermission,
} from '../auth/auth.decorators.js';
import type { StaffAccess } from '../auth/auth.types.js';
import { StaffAccessGuard } from '../auth/staff-access.guard.js';
import { AdminIntakeSettingsService } from './admin-intake-settings.service.js';

export class CollectionChangeDto {
  @IsBoolean()
  enabled!: boolean;
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedRevision!: number;
}
export class CollectionChangeQueryDto {}

@RequireEntra()
@RequirePermission('admin.configuration.read')
@UseGuards(StaffAccessGuard)
@Controller('admin/intake-settings/service-participation')
export class AdminIntakeSettingsController {
  constructor(private readonly service: AdminIntakeSettingsService) {}
  @Patch()
  @Header('Cache-Control', 'no-store')
  change(
    @CurrentStaff() access: StaffAccess,
    @Body() body: CollectionChangeDto,
    @Query() query: CollectionChangeQueryDto,
    @Req() req: { id?: string },
  ) {
    void query;
    return this.service.change(access, body, req.id);
  }
}
