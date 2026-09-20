import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentStaff,
  RequireEntra,
  RequirePermission,
} from '../auth/auth.decorators.js';
import type { StaffAccess } from '../auth/auth.types.js';
import { StaffAccessGuard } from '../auth/staff-access.guard.js';
import {
  internalContactPolicy,
  RequestContactService,
} from './request-contact.service.js';

export class RequestContactQueryDto {}

@ApiTags('service requests')
@ApiBearerAuth()
@RequireEntra()
@RequirePermission('service_request.internal.read')
@UseGuards(StaffAccessGuard)
@Controller('staff/internal-service-requests')
export class RequestContactController {
  constructor(private readonly contacts: RequestContactService) {}

  @Get(':serviceRequestId/contact')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Read structured requester contact with separate permission and durable security audit',
  })
  contact(
    @Param('serviceRequestId') id: string,
    @Query() _query: RequestContactQueryDto,
    @CurrentStaff() access: StaffAccess,
    @Req() request: { id?: string },
  ) {
    return this.contacts.read(id, access, internalContactPolicy, request.id);
  }
}
