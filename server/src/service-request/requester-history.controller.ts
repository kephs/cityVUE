import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  CurrentStaff,
  RequireEntra,
  RequirePermission,
} from '../auth/auth.decorators.js';
import type { StaffAccess } from '../auth/auth.types.js';
import { StaffAccessGuard } from '../auth/staff-access.guard.js';
import { RequesterHistoryService } from './requester-history.service.js';

export class RequesterHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

@ApiTags('service requests')
@ApiBearerAuth()
@RequireEntra()
@RequirePermission('service_request.view')
@UseGuards(StaffAccessGuard)
@Controller('staff/service-requests/:serviceRequestId/requester-history')
export class RequesterHistoryController {
  constructor(private readonly history: RequesterHistoryService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  read(
    @Param('serviceRequestId') id: string,
    @Query() query: RequesterHistoryQueryDto,
    @CurrentStaff() access: StaffAccess,
    @Req() request: { id?: string },
  ) {
    return this.history.read(
      id,
      access,
      query.page ?? 1,
      query.pageSize ?? 25,
      request.id,
    );
  }
}
