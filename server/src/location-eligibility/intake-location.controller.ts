import { Controller, Get, Header } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from '../config/configuration.js';
import { DatabaseService } from '../database/database.service.js';
import { ResidentTenant } from '../tenancy/resident-tenant.decorator.js';
import type { TenantContext } from '../tenancy/tenant-context.js';
import { syntheticServiceBoundary } from '../geospatial/synthetic-geospatial.repository.js';

@Controller('intake/location')
export class IntakeLocationController {
  constructor(
    private readonly config: ConfigService<AppConfiguration, true>,
    private readonly database: DatabaseService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  async configuration(@ResidentTenant() tenant: TenantContext) {
    const unavailable = { mode: 'unavailable', boundary: null, locations: [] };
    if (
      this.config.get('app.environment', { infer: true }) !== 'development' ||
      this.config.get('deployment.profile', { infer: true }) !== 'development'
    )
      return unavailable;
    // ADR-025: the resolved resident TenantContext, not a configuration read.
    // The development gate above is unchanged and still bounds this endpoint.
    const organizationId = tenant.organizationId;
    const active = await this.database.client
      .selectFrom('organization')
      .select('id')
      .where('id', '=', organizationId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    const boundary = active ? syntheticServiceBoundary(organizationId) : null;
    if (!boundary) return unavailable;
    const ring = boundary.geometry.coordinates[0];
    const first = ring[0],
      opposite = ring[2];
    if (!first || !opposite) return unavailable;
    const longitude = (first[0] + opposite[0]) / 2;
    const latitude = (first[1] + opposite[1]) / 2;
    return {
      mode: 'synthetic',
      boundary,
      locations: [
        {
          id: 'fictional-square',
          displayLabel: 'Fictional Civic Square (development)',
          latitude,
          longitude,
        },
        {
          id: 'fictional-path',
          displayLabel: 'Fictional Garden Path (development)',
          latitude: latitude + 0.01,
          longitude: longitude + 0.01,
        },
        {
          id: 'fictional-outside',
          displayLabel: 'Fictional Outside Point (development)',
          latitude: latitude + 0.15,
          longitude: longitude + 0.15,
        },
      ],
    };
  }
}
