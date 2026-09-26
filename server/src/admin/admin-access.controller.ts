import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentStaff,
  RequireEntra,
  RequirePermission,
} from '../auth/auth.decorators.js';
import type { StaffAccess } from '../auth/auth.types.js';
import { StaffAccessGuard } from '../auth/staff-access.guard.js';
import { DatabaseService } from '../database/database.service.js';
import {
  accessDetail,
  accessHistory,
  accessRead,
  accessScopes,
  listAccess,
  permissionCatalog,
} from '../access/access-discovery.js';
function empty(query: Record<string, unknown>) {
  if (Object.keys(query).length)
    throw new BadRequestException('Invalid access discovery query');
}
@RequireEntra()
@RequirePermission('admin.configuration.read')
@UseGuards(StaffAccessGuard)
@Controller('admin/access')
export class AdminAccessController {
  constructor(private readonly database: DatabaseService) {}
  @Get('principals')
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentStaff() access: StaffAccess,
    @Query() query: Record<string, unknown>,
  ) {
    return listAccess(this.database.client, access, query);
  }
  @Get('permissions')
  @Header('Cache-Control', 'no-store')
  permissions(
    @CurrentStaff() access: StaffAccess,
    @Query() query: Record<string, unknown>,
  ) {
    empty(query);
    return accessRead(this.database.client, access, () =>
      Promise.resolve({
        items: permissionCatalog,
      }),
    );
  }
  @Get('scopes')
  @Header('Cache-Control', 'no-store')
  scopes(
    @CurrentStaff() access: StaffAccess,
    @Query() query: Record<string, unknown>,
  ) {
    empty(query);
    return accessScopes(this.database.client, access);
  }
  @Get('principals/:id')
  @Header('Cache-Control', 'no-store')
  detail(
    @CurrentStaff() access: StaffAccess,
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
  ) {
    empty(query);
    return accessDetail(this.database.client, access, id);
  }
  @Get('principals/:id/history')
  @Header('Cache-Control', 'no-store')
  history(
    @CurrentStaff() access: StaffAccess,
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
  ) {
    return accessHistory(this.database.client, access, id, query);
  }
}
