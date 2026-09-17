import { Controller, Get, Header, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RequireEntra, RequirePermission } from '../auth/auth.decorators.js';
import { GEOSPATIAL_READ_PERMISSION } from '../auth/auth.types.js';
import { StaffAccessGuard } from '../auth/staff-access.guard.js';
import type { AuthenticatedGeospatialRequest } from './geospatial-authorization.service.js';
import { GeospatialReadService } from './geospatial-read.service.js';
import {
  projectGeospatialMapData,
  type GeospatialMapData,
} from './geospatial.types.js';

@ApiTags('Geospatial')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Staff authentication required' })
@ApiForbiddenResponse({ description: 'Access denied' })
@RequireEntra()
@RequirePermission(GEOSPATIAL_READ_PERMISSION)
@UseGuards(StaffAccessGuard)
@Controller('geospatial')
export class GeospatialController {
  constructor(
    private readonly geospatial: GeospatialReadService<GeospatialMapData>,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiQuery({
    name: 'organizationId',
    required: false,
    description: 'Optional consistency hint; never grants access',
  })
  @ApiOkResponse({
    description: 'Organization-scoped neutral Polygon and Point GeoJSON subset',
  })
  async getMapData(
    @Req() request: AuthenticatedGeospatialRequest,
    @Query('organizationId') requestedOrganizationId?: string,
  ): Promise<GeospatialMapData> {
    const data = await this.geospatial.read(request, requestedOrganizationId);
    // Explicit projection prevents a future provider from exposing extra fields.
    return projectGeospatialMapData(
      data,
      request.staffAccess?.organizationId ?? '',
    );
  }
}
