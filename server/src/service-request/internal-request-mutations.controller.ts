import {
  Body,
  Controller,
  Header,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import {
  CurrentStaff,
  RequireEntra,
  RequirePermission,
} from '../auth/auth.decorators.js';
import type { StaffAccess } from '../auth/auth.types.js';
import { StaffAccessGuard } from '../auth/staff-access.guard.js';
import { WorkflowActionDto } from './service-request.dto.js';
import { InternalRequestMutationsService } from './internal-request-mutations.service.js';

export class InternalRoutingDto {
  @ApiProperty({ minimum: 1, maximum: 2147483646 })
  @IsInt()
  @Min(1)
  @Max(2147483646)
  expectedRevision!: number;
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  departmentId!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  divisionId?: string | null;
}

@ApiTags('service requests')
@ApiBearerAuth()
@RequireEntra()
@RequirePermission('service_request.internal.update')
@UseGuards(StaffAccessGuard)
@Controller('staff/internal-service-requests')
export class InternalRequestMutationsController {
  constructor(private readonly mutations: InternalRequestMutationsService) {}
  @Post(':serviceRequestId/workflow')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Apply a controlled INTERNAL workflow action; requires internal.update',
  })
  workflow(
    @Param('serviceRequestId') id: string,
    @Body() input: WorkflowActionDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.mutations.workflow(id, input, access);
  }
  @Post(':serviceRequestId/routing')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Route an INTERNAL request within authorized current and target scopes',
  })
  route(
    @Param('serviceRequestId') id: string,
    @Body() input: InternalRoutingDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.mutations.route(id, input, access);
  }
}
