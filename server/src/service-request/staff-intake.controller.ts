import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentStaff,
  RequireEntra,
  RequirePermission,
} from '../auth/auth.decorators.js';
import type { StaffAccess } from '../auth/auth.types.js';
import { StaffAccessGuard } from '../auth/staff-access.guard.js';
import { CreateServiceRequestService } from './create-service-request.service.js';
import {
  CreateStaffServiceRequestDto,
  CreateServiceRequestResponseDto,
} from './service-request.dto.js';

@ApiTags('service requests')
@ApiBearerAuth()
@RequireEntra()
@RequirePermission('service_request.create')
@UseGuards(StaffAccessGuard)
@Controller('staff/service-requests')
export class StaffIntakeController {
  constructor(private readonly createRequest: CreateServiceRequestService) {}

  @Post()
  @ApiOperation({
    summary:
      'Create a staff-assisted public request or internal self-service request',
    description:
      'Requires service_request.create; INTERNAL additionally requires service_request.create_internal. Organization and submitter are server-derived. No internal read access is implied.',
  })
  @ApiCreatedResponse({ type: CreateServiceRequestResponseDto })
  create(
    @Body() input: CreateStaffServiceRequestDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.createRequest.executeStaff(input, access);
  }
}
