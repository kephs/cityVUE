import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CurrentStaff,
  RequireEntra,
  RequirePermission,
} from '../auth/auth.decorators.js';
import type { StaffAccess } from '../auth/auth.types.js';
import { StaffAccessGuard } from '../auth/staff-access.guard.js';
import { RequestOwnershipService } from './request-ownership.service.js';
import { targetTypes, type TargetType } from './ownership-targets.js';

export class OwnershipRevisionDto {
  @IsInt() @Min(1) @Max(2147483646) expectedRevision!: number;
}
export class OwnershipTargetDto extends OwnershipRevisionDto {
  @IsIn(targetTypes) targetType!: TargetType;
  @IsUUID() targetId!: string;
}
export class OwnershipTargetQueryDto {
  @IsIn(targetTypes) type!: TargetType;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}

@RequireEntra()
@UseGuards(StaffAccessGuard)
@Controller('staff/internal-service-requests')
export class RequestOwnershipController {
  constructor(private readonly ownership: RequestOwnershipService) {}

  @Get(':id/assignment-targets')
  @Header('Cache-Control', 'no-store')
  @RequirePermission('service_request.internal.update')
  targets(
    @Param('id') id: string,
    @Query() query: OwnershipTargetQueryDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.ownership.targets(id, access, query.type, query.search ?? '');
  }
  @Get(':id/watchers')
  @Header('Cache-Control', 'no-store')
  @RequirePermission('service_request.internal.read')
  watchers(@Param('id') id: string, @CurrentStaff() access: StaffAccess) {
    return this.ownership.watchers(id, access);
  }

  @Post(':id/assignment')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RequirePermission('service_request.internal.update')
  assign(
    @Param('id') id: string,
    @Body() input: OwnershipTargetDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.ownership.mutate(id, input, access, 'assign');
  }
  @Post(':id/assignment/remove')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RequirePermission('service_request.internal.update')
  unassign(
    @Param('id') id: string,
    @Body() input: OwnershipRevisionDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.ownership.mutate(id, input, access, 'unassign');
  }
  @Post(':id/watchers')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RequirePermission('service_request.internal.update')
  add(
    @Param('id') id: string,
    @Body() input: OwnershipTargetDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.ownership.mutate(id, input, access, 'add');
  }
  @Post(':id/watchers/remove')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RequirePermission('service_request.internal.update')
  remove(
    @Param('id') id: string,
    @Body() input: OwnershipTargetDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.ownership.mutate(id, input, access, 'remove');
  }
  @Post(':id/watch-self')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RequirePermission('service_request.internal.read')
  watch(
    @Param('id') id: string,
    @Body() input: OwnershipRevisionDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.ownership.mutate(id, input, access, 'watch');
  }
  @Post(':id/unwatch-self')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RequirePermission('service_request.internal.read')
  unwatch(
    @Param('id') id: string,
    @Body() input: OwnershipRevisionDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.ownership.mutate(id, input, access, 'unwatch');
  }
}
