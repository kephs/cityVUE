import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ResidentTenant } from '../tenancy/resident-tenant.decorator.js';
import type { TenantContext } from '../tenancy/tenant-context.js';
import { PublicResidentExperienceService } from './resident-experience.public.service.js';

@ApiTags('resident-experience')
@Controller('resident-experience')
export class PublicResidentExperienceController {
  constructor(private readonly experience: PublicResidentExperienceService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Read the published resident experience; no publication returns a null configuration',
  })
  getPublished(
    @ResidentTenant() tenant: TenantContext,
    @Query() query: Record<string, unknown>,
    @Req() request: Request,
  ) {
    if (
      Object.keys(query).length ||
      request.body !== undefined ||
      Number(request.headers['content-length'] ?? 0) > 0 ||
      request.headers['transfer-encoding'] !== undefined
    ) {
      throw new BadRequestException(
        'Resident experience does not accept selectors',
      );
    }
    return this.experience.getPublished(tenant.organizationId);
  }
}
