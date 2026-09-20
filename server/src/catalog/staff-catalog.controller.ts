import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  UseGuards,
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
  ) {
    return this.catalog.getIssueForOrganization(access.organizationId, id);
  }
}
