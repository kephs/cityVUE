import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  HttpCode,
  Header,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
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
import { IssueActionService } from './issue-action.service.js';
export class IssueActionDto {
  @ApiProperty({ enum: ['internal_intake', 'external_redirect'] })
  @IsIn(['internal_intake', 'external_redirect'])
  actionType!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(2147483646) expectedRevision!: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  destination?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;
}
@ApiTags('catalog administration')
@ApiBearerAuth()
@RequireEntra()
@RequirePermission('catalog.issue_action.manage')
@UseGuards(StaffAccessGuard)
@Controller('staff/catalog/issues')
export class IssueActionController {
  constructor(private readonly service: IssueActionService) {}
  @Get(':id/action')
  @Header('Cache-Control', 'no-store')
  get(@Param('id') id: string, @CurrentStaff() access: StaffAccess) {
    return this.service.get(id, access);
  }
  @Post(':id/action')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  set(
    @Param('id') id: string,
    @Body() input: IssueActionDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.service.set(id, input, access);
  }
}
