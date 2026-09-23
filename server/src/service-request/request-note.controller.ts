import { ValidateNested } from 'class-validator';
import { AttachmentClaimDto } from '../attachments/attachment.controller.js';
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
import { NOTE_BODY_MAXIMUM } from './request-note.domain.js';
import { RequestNoteService } from './request-note.service.js';

export class CreateRequestNoteDto {
  @ApiProperty({ maxLength: NOTE_BODY_MAXIMUM })
  @IsString()
  @MaxLength(NOTE_BODY_MAXIMUM)
  body!: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => AttachmentClaimDto)
  attachments?: AttachmentClaimDto;
}
export class RequestNotesQueryDto {
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
export class CreateRequestNoteQueryDto {}

@ApiTags('service requests')
@ApiBearerAuth()
@RequireEntra()
@RequireAnyPermission('service_request.view', 'service_request.internal.read')
@UseGuards(StaffAccessGuard)
@Controller('staff/service-requests/:serviceRequestId/notes')
export class RequestNoteController {
  constructor(private readonly notes: RequestNoteService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Param('serviceRequestId') id: string,
    @Query() query: RequestNotesQueryDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.notes.list(id, access, query.pageSize ?? 25, query.cursor);
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
    @Body() input: CreateRequestNoteDto,
    @Query() _query: CreateRequestNoteQueryDto,
    @CurrentStaff() access: StaffAccess,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: { id?: string },
  ) {
    return this.notes.create(
      id,
      access,
      input.body,
      key,
      request.id,
      input.attachments,
    );
  }
}
