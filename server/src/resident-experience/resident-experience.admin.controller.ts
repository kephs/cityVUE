import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
  Header,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  CurrentStaff,
  RequireEntra,
  RequirePermission,
} from '../auth/auth.decorators.js';
import type { StaffAccess } from '../auth/auth.types.js';
import { StaffAccessGuard } from '../auth/staff-access.guard.js';
import { AdminResidentExperienceService } from './resident-experience.admin.service.js';

function noSelectors(query: Record<string, unknown>, request?: Request) {
  if (
    Object.keys(query).length ||
    (request &&
      (request.body !== undefined ||
        Number(request.headers['content-length'] ?? 0) > 0 ||
        request.headers['transfer-encoding'] !== undefined))
  )
    throw new BadRequestException(
      'Resident experience does not accept selectors',
    );
}
@RequireEntra()
@RequirePermission('admin.configuration.read')
@UseGuards(StaffAccessGuard)
@Controller('admin/resident-experience')
export class AdminResidentExperienceController {
  constructor(private readonly service: AdminResidentExperienceService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  summary(
    @CurrentStaff() access: StaffAccess,
    @Query() query: Record<string, unknown>,
    @Req() request: Request,
  ) {
    noSelectors(query, request);
    return this.service.summary(access);
  }
  @Get('preview')
  @Header('Cache-Control', 'no-store')
  preview(
    @CurrentStaff() access: StaffAccess,
    @Query() query: Record<string, unknown>,
    @Req() request: Request,
  ) {
    noSelectors(query, request);
    return this.service.preview(access);
  }
  @Put('draft')
  @Header('Cache-Control', 'no-store')
  save(
    @CurrentStaff() access: StaffAccess,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
    @Req() request: Request,
  ) {
    noSelectors(query);
    return this.service.save(
      access,
      body,
      typeof request.id === 'string' ? request.id : '',
    );
  }
}
