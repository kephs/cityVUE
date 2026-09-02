import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CreateServiceRequestService } from './create-service-request.service.js';
import {
  CreateServiceRequestDto,
  CreateServiceRequestResponseDto,
} from './service-request.dto.js';

@ApiTags('service requests')
@Controller('service-requests')
export class ServiceRequestController {
  constructor(private readonly createRequest: CreateServiceRequestService) {}
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
}
