import {
  BadRequestException,
  Body,
  Patch,
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
import { changeManagedAccess } from '../access/access-foundation.js';
import { accessError } from '../access/access-errors.js';
import { assertAccessAuthority } from '../access/access-policy.js';
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
  @Patch('principals/:staffId')
  @Header('Cache-Control', 'no-store')
  change(
    @CurrentStaff() access: StaffAccess,
    @Param('staffId') staffId: string,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
  ) {
    assertAccessAuthority(access, true);
    empty(query);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw accessError('ACCESS_COMMAND_INVALID');
    const input = body as Record<string, unknown>;
    if (
      Object.keys(input).some(
        (key) =>
          !['expectedAuthorizationRevision', 'managedPermissionKeys'].includes(
            key,
          ),
      )
    )
      throw accessError('ACCESS_COMMAND_INVALID');
    return changeManagedAccess(this.database.client, access, {
      staffId,
      expectedRevision: input.expectedAuthorizationRevision,
      permissions: input.managedPermissionKeys,
    });
  }
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
