import {
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
import { emptyDepartmentQuery } from './admin-department.domain.js';
import { AdminDepartmentService } from './admin-department.service.js';

@RequireEntra()
@RequirePermission('admin.configuration.read')
@UseGuards(StaffAccessGuard)
@Controller('admin/departments')
export class AdminDepartmentController {
  constructor(private readonly service: AdminDepartmentService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentStaff() access: StaffAccess,
    @Query() query: Record<string, unknown>,
  ) {
    return this.service.list(access, query);
  }
  @Get(':departmentId')
  @Header('Cache-Control', 'no-store')
  detail(
    @CurrentStaff() access: StaffAccess,
    @Param('departmentId') id: string,
    @Query() query: Record<string, unknown>,
  ) {
    emptyDepartmentQuery(query);
    return this.service.detail(access, id);
  }
  @Get(':departmentId/divisions')
  @Header('Cache-Control', 'no-store')
  divisions(
    @CurrentStaff() access: StaffAccess,
    @Param('departmentId') id: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.service.list(access, query, 'divisions', id);
  }
  @Get(':departmentId/categories')
  @Header('Cache-Control', 'no-store')
  categories(
    @CurrentStaff() access: StaffAccess,
    @Param('departmentId') id: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.service.list(access, query, 'categories', id);
  }
}
