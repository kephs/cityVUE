import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  UseGuards,
  Query,
  ForbiddenException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CurrentStaff,
  RequireEntra,
  RequirePermission,
} from '../auth/auth.decorators.js';
import type { StaffAccess } from '../auth/auth.types.js';
import { StaffAccessGuard } from '../auth/staff-access.guard.js';
import { CatalogService } from './catalog.service.js';
import { IsIn, IsOptional } from 'class-validator';
class StaffCatalogQuery {
  @IsOptional() @IsIn(['public', 'internal']) audience?: 'public' | 'internal';
}
@ApiTags('staff catalog')
@ApiBearerAuth()
@RequireEntra()
@RequirePermission('service_request.create')
@UseGuards(StaffAccessGuard)
@Controller('staff/catalog/issues')
export class StaffCatalogController {
  constructor(private readonly catalog: CatalogService) {}
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentStaff() access: StaffAccess,
    @Query() query: StaffCatalogQuery,
  ) {
    if (
      query.audience === 'internal' &&
      !access.permissions.includes('service_request.create_internal')
    )
      throw new ForbiddenException('Access denied');
    return this.catalog.getIssueForOrganization(
      access.organizationId,
      id,
      query.audience === 'internal' ? 'internal' : 'external',
    );
  }
}
