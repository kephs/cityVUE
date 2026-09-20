import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentStaff,
  RequireEntra,
  RequirePermission,
} from '../auth/auth.decorators.js';
import type { StaffAccess } from '../auth/auth.types.js';
import { StaffAccessGuard } from '../auth/staff-access.guard.js';
import { RequestContactQueryDto } from './request-contact.controller.js';
import { RequestContactService } from './request-contact.service.js';
import { publicContactPolicy } from './public-request-contact.policy.js';

@ApiTags('service requests')
@ApiBearerAuth()
@RequireEntra()
@RequirePermission('service_request.view')
@UseGuards(StaffAccessGuard)
@Controller('staff/public-service-requests')
export class PublicRequestContactController {
  constructor(private readonly contacts: RequestContactService) {}

  @Get(':serviceRequestId/contact')
  @ApiOperation({
    summary:
      'Read PUBLIC requester contact with independent request/contact authorization and durable audit',
  })
  contact(
    @Param('serviceRequestId') id: string,
    @Query() _query: RequestContactQueryDto,
    @CurrentStaff() access: StaffAccess,
    @Req() request: { id?: string },
  ) {
    return this.contacts.read(id, access, publicContactPolicy, request.id);
  }
}
