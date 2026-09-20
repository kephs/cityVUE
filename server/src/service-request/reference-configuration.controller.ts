import {
  Body,
  Controller,
  Get,
  Post,
  Header,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsString,
  Matches,
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
import { ReferenceConfigurationService } from './reference-configuration.service.js';
export class ReferenceConfigurationDto {
  @ApiProperty()
  @IsString()
  @MaxLength(12)
  @Matches(/^[A-Za-z0-9]*$/)
  prefix!: string;
  @ApiProperty({ enum: ['none', 'year', 'year_month'] })
  @IsIn(['none', 'year', 'year_month'])
  dateComponent!: string;
  @ApiProperty() @IsInt() @Min(4) @Max(12) sequenceWidth!: number;
  @ApiProperty({ enum: ['never', 'yearly', 'monthly'] })
  @IsIn(['never', 'yearly', 'monthly'])
  resetPolicy!: string;
  @ApiProperty({ enum: ['', '-'] }) @IsIn(['', '-']) separator!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(2147483646) expectedRevision!: number;
}
@ApiTags('reference configuration')
@ApiBearerAuth()
@RequireEntra()
@RequirePermission('service_request.reference.manage')
@UseGuards(StaffAccessGuard)
@Controller('staff/service-request-reference-configuration')
export class ReferenceConfigurationController {
  constructor(private readonly service: ReferenceConfigurationService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  get(@CurrentStaff() access: StaffAccess) {
    return this.service.get(access);
  }
  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  set(
    @Body() input: ReferenceConfigurationDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.service.set(input, access);
  }
}
