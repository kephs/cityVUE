import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CurrentStaff,
  RequireAnyPermission,
  RequireEntra,
} from '../auth/auth.decorators.js';
import type { StaffAccess } from '../auth/auth.types.js';
import { StaffAccessGuard } from '../auth/staff-access.guard.js';
import { COMMUNICATION_BODY_MAXIMUM } from './request-communication.domain.js';
import { RequestCommunicationService } from './request-communication.service.js';

export class CreateRequestCommunicationDto {
  @ApiProperty({ maxLength: COMMUNICATION_BODY_MAXIMUM })
  @IsString()
  @MaxLength(COMMUNICATION_BODY_MAXIMUM)
  body!: string;
}
export class RequestCommunicationsQueryDto {
  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(256)
  cursor?: string;
}
export class CreateRequestCommunicationQueryDto {}

@ApiTags('service requests')
@ApiBearerAuth()
@RequireEntra()
@RequireAnyPermission('service_request.view')
@UseGuards(StaffAccessGuard)
@Controller('staff/service-requests/:serviceRequestId/communications')
export class RequestCommunicationController {
  constructor(private readonly communications: RequestCommunicationService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Param('serviceRequestId') id: string,
    @Query() query: RequestCommunicationsQueryDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.communications.list(
      id,
      access,
      query.pageSize ?? 25,
      query.cursor,
    );
  }
  @Post()
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @Header('Cache-Control', 'no-store')
  create(
    @Param('serviceRequestId') id: string,
    @Body() input: CreateRequestCommunicationDto,
    @Query() _query: CreateRequestCommunicationQueryDto,
    @CurrentStaff() access: StaffAccess,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: { id?: string },
  ) {
    return this.communications.create(id, access, input.body, key, request.id);
  }
}
