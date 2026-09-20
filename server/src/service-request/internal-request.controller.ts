import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CurrentStaff,
  RequireEntra,
  RequirePermission,
} from '../auth/auth.decorators.js';
import type { StaffAccess } from '../auth/auth.types.js';
import { StaffAccessGuard } from '../auth/staff-access.guard.js';
import { InternalRequestRepository } from './internal-request.repository.js';

export class InternalRequestListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['open', 'in_progress', 'on_hold', 'closed', 'cancelled'])
  status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') departmentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') divisionId?: string;
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page?: number;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
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
@RequirePermission('service_request.internal.read')
@UseGuards(StaffAccessGuard)
@Controller('staff/internal-service-requests')
export class InternalRequestController {
  constructor(private readonly repository: InternalRequestRepository) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'List authorized internal requests without contact information',
  })
  list(
    @Query() query: InternalRequestListQueryDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.repository.list(
      access,
      query.page ?? 1,
      query.pageSize ?? 25,
      query,
    );
  }

  @Get('workspace-options')
  @Header('Cache-Control', 'no-store')
  options(@CurrentStaff() access: StaffAccess) {
    return this.repository.workspaceOptions(access);
  }

  @Get(':serviceRequestId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Read an authorized internal request without contact information',
  })
  async details(
    @Param('serviceRequestId') id: string,
    @Query() _query: InternalRequestListQueryDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    const result = await this.repository.details(access, id);
    if (!result) throw new NotFoundException();
    return result;
  }
}
