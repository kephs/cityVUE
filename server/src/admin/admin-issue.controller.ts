import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  CurrentStaff,
  RequireEntra,
  RequirePermission,
} from '../auth/auth.decorators.js';
import type { StaffAccess } from '../auth/auth.types.js';
import { StaffAccessGuard } from '../auth/staff-access.guard.js';
import { AdminIssueService } from './admin-issue.service.js';
import { configurationPage } from './admin-configuration.domain.js';
import type { IssueFields } from './admin-issue.domain.js';

export class IssueFieldsDto implements IssueFields {
  @IsString() name!: string;
  @IsString() description!: string;
  @IsInt() @Min(0) @Max(2147483647) displayOrder!: number;
  @IsIn(['IDENTIFIED_REQUIRED', 'ANONYMOUS_ALLOWED'])
  requesterPolicy!: IssueFields['requesterPolicy'];
  @ValidateIf((_o, v: unknown) => v !== null)
  @IsObject()
  defaultAssignment!: IssueFields['defaultAssignment'];
}
export class IssueCreateDto extends IssueFieldsDto {
  @IsUUID('4') templateId!: string;
}
export class IssueChangeDto extends IssueFieldsDto {
  @IsBoolean() active!: boolean;
  @IsInt() @Min(1) @Max(2147483646) expectedCoreRevision!: number;
  @IsInt() @Min(1) @Max(2147483646) expectedActionRevision!: number;
  @IsInt() @Min(0) @Max(2147483646) expectedPolicyRevision!: number;
  @IsInt() @Min(0) @Max(2147483646) expectedAssignmentRevision!: number;
}
export class IssueListQuery {
  @IsOptional() @IsString() page?: string;
}
export class IssueTargetQuery {
  @IsOptional() @IsString() search?: string;
}
export class IssueEmptyQuery {}
@RequireEntra()
@RequirePermission('admin.configuration.read')
@UseGuards(StaffAccessGuard)
@Controller('admin/issues')
export class AdminIssueController {
  constructor(private readonly service: AdminIssueService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  list(@CurrentStaff() access: StaffAccess, @Query() query: IssueListQuery) {
    return this.service.list(access, configurationPage(query.page));
  }
  @Get(':id/assignment-targets')
  @Header('Cache-Control', 'no-store')
  targets(
    @CurrentStaff() access: StaffAccess,
    @Param('id') id: string,
    @Query() query: IssueTargetQuery,
  ) {
    return this.service.targets(access, id, query.search);
  }
  @Post()
  @Header('Cache-Control', 'no-store')
  create(
    @CurrentStaff() access: StaffAccess,
    @Body() body: IssueCreateDto,
    @Query() query: IssueEmptyQuery,
    @Req() req: { id?: string },
  ) {
    void query;
    return this.service.create(access, body, req.id);
  }
  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  change(
    @CurrentStaff() access: StaffAccess,
    @Param('id') id: string,
    @Body() body: IssueChangeDto,
    @Query() query: IssueEmptyQuery,
    @Req() req: { id?: string },
  ) {
    void query;
    return this.service.change(access, id, body, req.id);
  }
}
