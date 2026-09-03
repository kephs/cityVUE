import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
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
    description: 'Reference or concurrent persistence conflict',
  })
  create(@Body() input: CreateServiceRequestDto) {
    return this.createRequest.execute(input);
  }
  @Get()
  @ApiOperation({
    summary: 'Development-only canonical staff service request list',
    description:
      'Not a production authorization boundary. Requires the explicit development read gate and backend-controlled Organization context.',
  })
  @ApiOkResponse({ type: ServiceRequestListResponseDto })
  @ApiNotFoundResponse({ description: 'Development reads are unavailable' })
  list(@Query() query: ListServiceRequestsQueryDto) {
    return this.listRequests.execute(query);
  }
  @Get(':serviceRequestId')
  @ApiOperation({
    summary: 'Development-only canonical service request details',
  })
  @ApiOkResponse({ type: ServiceRequestDetailsResponseDto })
  @ApiNotFoundResponse({
    description:
      'Unavailable, invalid, missing, or outside the configured Organization',
  })
  details(@Param('serviceRequestId') id: string) {
    return this.getDetails.execute(id);
  }
  @Post(':serviceRequestId/assignment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Development-only staff assignment action' })
  @ApiOkResponse({ type: StaffMutationResponseDto })
  assignment(
    @Param('serviceRequestId') id: string,
    @Body() input: AssignmentActionDto,
  ) {
    return this.staffActions.assign(id, input);
  }

  @Post(':serviceRequestId/workflow')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Development-only controlled workflow action' })
  @ApiOkResponse({ type: StaffMutationResponseDto })
  workflow(
    @Param('serviceRequestId') id: string,
    @Body() input: WorkflowActionDto,
  ) {
    return this.staffActions.workflow(id, input);
  }
}
