import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import {
  staffSortKeys,
  staffSortDirections,
  staffAssignmentFilters,
} from './staff-list-controls.js';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { staffSearchMaxLength } from './staff-live-search.js';
import {
  CurrentStaff,
  RequireAnyPermission,
  RequireEntra,
} from '../auth/auth.decorators.js';
import type { StaffAccess } from '../auth/auth.types.js';
import { StaffAccessGuard } from '../auth/staff-access.guard.js';
import { InternalRequestRepository } from './internal-request.repository.js';
import {
  InternalActivityQueryDto,
  InternalRequestListQueryDto,
} from './internal-request.controller.js';
import type { StaffRequestAudienceFilter } from './staff-request-scope.js';
import { InternalRequestMutationsService } from './internal-request-mutations.service.js';
import { InternalRoutingDto } from './internal-request-mutations.controller.js';
import { RequestOwnershipService } from './request-ownership.service.js';
import {
  OwnershipRevisionDto,
  OwnershipTargetDto,
  OwnershipTargetQueryDto,
} from './request-ownership.controller.js';
import { WorkflowActionDto } from './service-request.dto.js';

export class StaffRequestListQueryDto extends InternalRequestListQueryDto {
  @ApiPropertyOptional({
    maxLength: staffSearchMaxLength,
    description:
      'Literal case-insensitive search of reference, Issue and displayed Service Location; trim; empty or at least 2 characters.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(staffSearchMaxLength)
  q?: string;
  @ApiPropertyOptional({ enum: staffSortKeys, default: 'created' })
  @IsOptional()
  @IsIn(staffSortKeys)
  sort?: string;
  @ApiPropertyOptional({ enum: staffSortDirections, default: 'desc' })
  @IsOptional()
  @IsIn(staffSortDirections)
  direction?: string;
  @ApiPropertyOptional({ enum: staffAssignmentFilters, default: 'all' })
  @IsOptional()
  @IsIn(staffAssignmentFilters)
  assignment?: string;
  @ApiPropertyOptional({ enum: ['all', 'public', 'internal'], default: 'all' })
  @IsOptional()
  @IsIn(['all', 'public', 'internal'])
  audience?: StaffRequestAudienceFilter;
}

export class StaffRequestTargetQueryDto extends OwnershipTargetQueryDto {
  @IsOptional() @IsIn(['assignment', 'watchers']) purpose?:
    'assignment' | 'watchers';
}

@ApiTags('service requests')
@ApiBearerAuth()
@RequireEntra()
@RequireAnyPermission('service_request.view', 'service_request.internal.read')
@UseGuards(StaffAccessGuard)
@Controller('staff/service-requests')
export class StaffRequestController {
  constructor(
    private readonly repository: InternalRequestRepository,
    private readonly mutations: InternalRequestMutationsService,
    private readonly ownership: RequestOwnershipService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Query() query: StaffRequestListQueryDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.repository.list(
      access,
      query.page ?? 1,
      query.pageSize ?? 25,
      query,
      'all',
    );
  }

  @Get('workspace-options')
  @Header('Cache-Control', 'no-store')
  options(@CurrentStaff() access: StaffAccess) {
    return this.repository.workspaceOptions(access, 'all');
  }

  @Get(':serviceRequestId/activity')
  @Header('Cache-Control', 'no-store')
  activity(
    @Param('serviceRequestId') id: string,
    @Query() query: InternalActivityQueryDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.repository.activity(
      access,
      id,
      query.page ?? 1,
      query.pageSize ?? 25,
      'all',
    );
  }

  @Get(':serviceRequestId')
  @Header('Cache-Control', 'no-store')
  async details(
    @Param('serviceRequestId') id: string,
    @CurrentStaff() access: StaffAccess,
  ) {
    // No browser audience selector: authorization is part of the persisted-row query.
    const result = await this.repository.details(access, id, 'all');
    if (!result) throw new NotFoundException();
    return result;
  }

  @Post(':serviceRequestId/workflow')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  workflow(
    @Param('serviceRequestId') id: string,
    @Body() input: WorkflowActionDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.mutations.workflow(id, input, access, 'all');
  }

  @Post(':serviceRequestId/routing')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  route(
    @Param('serviceRequestId') id: string,
    @Body() input: InternalRoutingDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.mutations.route(id, input, access, 'all');
  }

  @Get(':serviceRequestId/assignment-targets')
  @Header('Cache-Control', 'no-store')
  targets(
    @Param('serviceRequestId') id: string,
    @Query() query: StaffRequestTargetQueryDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.ownership.targets(
      id,
      access,
      query.type,
      query.search ?? '',
      'all',
      query.purpose ?? 'assignment',
    );
  }

  @Get(':serviceRequestId/watchers')
  @Header('Cache-Control', 'no-store')
  watchers(
    @Param('serviceRequestId') id: string,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.ownership.watchers(id, access, 'all');
  }

  @Post(':serviceRequestId/assignment')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  assign(
    @Param('serviceRequestId') id: string,
    @Body() input: OwnershipTargetDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.ownership.mutate(id, input, access, 'assign', 'all');
  }

  @Post(':serviceRequestId/assignment/remove')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  unassign(
    @Param('serviceRequestId') id: string,
    @Body() input: OwnershipRevisionDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.ownership.mutate(id, input, access, 'unassign', 'all');
  }

  @Post(':serviceRequestId/watchers')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  addWatcher(
    @Param('serviceRequestId') id: string,
    @Body() input: OwnershipTargetDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.ownership.mutate(id, input, access, 'add', 'all');
  }

  @Post(':serviceRequestId/watchers/remove')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  removeWatcher(
    @Param('serviceRequestId') id: string,
    @Body() input: OwnershipTargetDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.ownership.mutate(id, input, access, 'remove', 'all');
  }

  @Post(':serviceRequestId/watch-self')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  watchSelf(
    @Param('serviceRequestId') id: string,
    @Body() input: OwnershipRevisionDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.ownership.mutate(id, input, access, 'watch', 'all');
  }

  @Post(':serviceRequestId/unwatch-self')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  unwatchSelf(
    @Param('serviceRequestId') id: string,
    @Body() input: OwnershipRevisionDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.ownership.mutate(id, input, access, 'unwatch', 'all');
  }
}
