import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { CurrentStaff, RequirePermission } from '../auth/auth.decorators.js';
import { StaffAccessGuard } from '../auth/staff-access.guard.js';
import type { Permission, StaffAccess } from '../auth/auth.types.js';
// Resident intake takes Organization from the trusted host; every guarded
// route below takes it from verified staff identity. The two never mix.
import { ResidentTenant } from '../tenancy/resident-tenant.decorator.js';
import type { TenantContext } from '../tenancy/tenant-context.js';
import { CreateServiceRequestService } from './create-service-request.service.js';
import { GetServiceRequestDetailsService } from './get-service-request-details.service.js';
import { ListServiceRequestsService } from './list-service-requests.service.js';
import {
  CreateServiceRequestDto,
  CreateServiceRequestResponseDto,
  ServiceRequestDetailsResponseDto,
  ListServiceRequestsQueryDto,
  ServiceRequestListResponseDto,
  AssignmentActionDto,
  WorkflowActionDto,
  StaffMutationResponseDto,
} from './service-request.dto.js';
import { StaffActionsService } from './staff-actions.service.js';
import { validSubmissionKey } from './submission-idempotency.js';

@ApiTags('service requests')
@Controller('service-requests')
export class ServiceRequestController {
  constructor(
    private readonly createRequest: CreateServiceRequestService,
    private readonly getDetails: GetServiceRequestDetailsService,
    private readonly listRequests: ListServiceRequestsService,
    private readonly staffActions: StaffActionsService,
  ) {}
  @Post()
  @HttpCode(HttpStatus.CREATED)
  // F065: this response may carry a one-time tracking credential, so it is
  // never cached and never referred onward.
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({ summary: 'Create a canonical resident service request' })
  @ApiCreatedResponse({ type: CreateServiceRequestResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid answers, requester policy, or location policy',
  })
  @ApiNotFoundResponse({
    description:
      'Published catalog version not found in the configured Organization',
  })
  @ApiConflictResponse({
    description:
      'Reference or concurrent persistence conflict, a submission key reused for a different payload, a closed retry window, or an earlier submission with this key still in progress',
  })
  // F066: required, so no resident submission can reach the creation path
  // without an idempotency scope. A missing or malformed key is refused here
  // rather than defaulted, because a server-generated key would make every
  // retry look like a new submission -- which is the duplicate this prevents.
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Client-generated UUID. Reuse it for safe retries of the same submission; generate a new one for a new submission.',
    schema: { type: 'string', format: 'uuid' },
  })
  create(
    @ResidentTenant() tenant: TenantContext,
    @Body() input: CreateServiceRequestDto,
    @Headers('idempotency-key') submissionKey: string | undefined,
  ) {
    if (!validSubmissionKey(submissionKey))
      throw new BadRequestException(
        'A valid Idempotency-Key request header is required',
      );
    return this.createRequest.execute(
      tenant.organizationId,
      input,
      undefined,
      submissionKey,
    );
  }
  @Get()
  @UseGuards(StaffAccessGuard)
  @RequirePermission('service_request.view')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Development-only canonical staff service request list',
    description:
      'Not a production authorization boundary. Requires the explicit development read gate and backend-controlled Organization context.',
  })
  @ApiOkResponse({ type: ServiceRequestListResponseDto })
  @ApiNotFoundResponse({ description: 'Development reads are unavailable' })
  list(
    @Query() query: ListServiceRequestsQueryDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.listRequests.execute(query, access);
  }
  @Get(':serviceRequestId')
  @UseGuards(StaffAccessGuard)
  @RequirePermission('service_request.view')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Development-only canonical service request details',
  })
  @ApiOkResponse({ type: ServiceRequestDetailsResponseDto })
  @ApiNotFoundResponse({
    description:
      'Unavailable, invalid, missing, or outside the configured Organization',
  })
  details(
    @Param('serviceRequestId') id: string,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.getDetails.execute(id, access);
  }
  @Post(':serviceRequestId/assignment')
  @UseGuards(StaffAccessGuard)
  @RequirePermission('service_request.assign')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Development-only staff assignment action' })
  @ApiOkResponse({ type: StaffMutationResponseDto })
  assignment(
    @Param('serviceRequestId') id: string,
    @Body() input: AssignmentActionDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.staffActions.assign(id, input, access);
  }

  @Post(':serviceRequestId/workflow')
  @HttpCode(HttpStatus.OK)
  @UseGuards(StaffAccessGuard)
  @RequirePermission('service_request.view')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Development-only controlled workflow action' })
  @ApiOkResponse({ type: StaffMutationResponseDto })
  workflow(
    @Param('serviceRequestId') id: string,
    @Body() input: WorkflowActionDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    const permission = `service_request.${input.action}` as Permission;
    if (!access.development && !access.permissions.includes(permission))
      throw new ForbiddenException('Access denied');
    return this.staffActions.workflow(id, input, access);
  }
}
