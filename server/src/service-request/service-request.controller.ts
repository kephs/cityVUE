import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
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
import {
  CreateServiceRequestDto,
  CreateServiceRequestResponseDto,
  ServiceRequestDetailsResponseDto,
} from './service-request.dto.js';

@ApiTags('service requests')
@Controller('service-requests')
export class ServiceRequestController {
  constructor(
    private readonly createRequest: CreateServiceRequestService,
    private readonly getDetails: GetServiceRequestDetailsService,
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
}
