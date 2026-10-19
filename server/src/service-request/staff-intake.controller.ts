import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
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
import { validSubmissionKey } from './submission-idempotency.js';

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
  // F066: optional here, so the published staff contract is unchanged. A
  // staff client that supplies a key gets the same at-most-once guarantee,
  // scoped to its own authenticated identity. A malformed key is refused
  // rather than ignored: silently dropping it would promise deduplication
  // that was not applied.
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Optional client-generated UUID. When supplied, retries carrying the same key return the original request instead of creating another.',
    schema: { type: 'string', format: 'uuid' },
  })
  create(
    @Body() input: CreateStaffServiceRequestDto,
    @CurrentStaff() access: StaffAccess,
    @Headers('idempotency-key') submissionKey: string | undefined,
  ) {
    if (submissionKey !== undefined && !validSubmissionKey(submissionKey))
      throw new BadRequestException(
        'The Idempotency-Key request header is malformed',
      );
    return this.createRequest.executeStaff(
      input,
      access,
      undefined,
      submissionKey,
    );
  }
}
