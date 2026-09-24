import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentStaff,
  RequireEntra,
  RequirePermission,
} from '../auth/auth.decorators.js';
import type { StaffAccess } from '../auth/auth.types.js';
import { StaffAccessGuard } from '../auth/staff-access.guard.js';
import { RequestAnswerService } from './request-answer.service.js';

export class RequestAnswerQuery {}

@RequireEntra()
@RequirePermission('service_request.answers.read')
@UseGuards(StaffAccessGuard)
@Controller('staff/service-requests')
export class RequestAnswerController {
  constructor(private readonly answers: RequestAnswerService) {}

  @Get(':serviceRequestId/answers')
  @Header('Cache-Control', 'no-store')
  read(
    @Param('serviceRequestId') id: string,
    @CurrentStaff() access: StaffAccess,
    @Req() request: { id?: string },
    @Query() _query: RequestAnswerQuery,
  ) {
    void _query;
    return this.answers.read(id, access, request.id);
  }
}
