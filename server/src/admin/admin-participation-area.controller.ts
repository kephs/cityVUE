import {
  Body,
  Controller,
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
  IsInt,
  IsString,
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
import { AdminParticipationAreaService } from './admin-participation-area.service.js';

export class AreaCreateDto {
  @IsString() displayName!: string;
}
export class AreaChangeDto {
  @IsInt() @Min(1) @Max(2147483647) expectedRevision!: number;
  @ValidateIf((_o, value: unknown) => value !== undefined)
  @IsString()
  displayName?: string;
  @ValidateIf((_o, value: unknown) => value !== undefined)
  @IsBoolean()
  active?: boolean;
  @ValidateIf((_o, value: unknown) => value !== undefined)
  @IsInt()
  @Min(-2147483648)
  @Max(2147483647)
  displayOrder?: number;
}
export class AreaQueryDto {}
@RequireEntra()
@RequirePermission('admin.configuration.read')
@UseGuards(StaffAccessGuard)
@Controller('admin/participation-areas')
export class AdminParticipationAreaController {
  constructor(private readonly service: AdminParticipationAreaService) {}
  @Post()
  @Header('Cache-Control', 'no-store')
  create(
    @CurrentStaff() access: StaffAccess,
    @Body() body: AreaCreateDto,
    @Query() query: AreaQueryDto,
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
    @Body() body: AreaChangeDto,
    @Query() query: AreaQueryDto,
    @Req() req: { id?: string },
  ) {
    void query;
    return this.service.change(access, id, body, req.id);
  }
}
