import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  CurrentRequester,
  RequireRequesterIdentity,
} from '../auth/auth.decorators.js';
import type { RequesterAccess } from '../auth/auth.types.js';
import { RequesterAccessGuard } from '../auth/requester-access.guard.js';
import {
  InternalRequesterService,
  REQUESTER_LIST_PAGE_SIZE,
  REQUESTER_LIST_PAGE_SIZE_MAXIMUM,
} from './internal-requester.service.js';

export class InternalRequesterListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(REQUESTER_LIST_PAGE_SIZE_MAXIMUM)
  pageSize?: number;
}

/**
 * F064.1: the authenticated requester's own internal requests.
 *
 * Admission establishes identity only; every read proves ownership in SQL, so
 * no staff permission is consulted and none is granted. This controller never
 * accepts an organization, requester or audience value from the caller.
 */
@ApiTags('service requests')
@ApiBearerAuth()
@RequireRequesterIdentity()
@UseGuards(RequesterAccessGuard)
@Controller('my/internal-service-requests')
export class InternalRequesterController {
  constructor(private readonly requests: InternalRequesterService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'List the authenticated requester’s own INTERNAL requests, bounded and ownership-scoped',
  })
  list(
    @Query() query: InternalRequesterListQueryDto,
    @CurrentRequester() access: RequesterAccess,
  ) {
    return this.requests.list(
      access,
      query.page ?? 1,
      query.pageSize ?? REQUESTER_LIST_PAGE_SIZE,
    );
  }

  @Get(':serviceRequestId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Read one owned INTERNAL request with requester-visible service team updates',
  })
  detail(
    @Param('serviceRequestId') id: string,
    @CurrentRequester() access: RequesterAccess,
  ) {
    return this.requests.detail(id, access);
  }
}
