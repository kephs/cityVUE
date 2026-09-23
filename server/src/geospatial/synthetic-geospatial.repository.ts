import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from '../config/configuration.js';
import type { GeospatialReadRepository } from './geospatial-read.service.js';
import {
  projectGeospatialMapData,
  type GeospatialMapData,
} from './geospatial.types.js';

// SYNTHETIC TEST DATA near 0°N, 0°E. Never a production GIS fallback.
export const SYNTHETIC_ORGANIZATION_A = '10000000-0000-4000-8000-000000000001';
export const SYNTHETIC_ORGANIZATION_B = '20000000-0000-4000-8000-000000000002';

const fixtures: Record<string, GeospatialMapData> = {
  [SYNTHETIC_ORGANIZATION_A]: {
    organizationId: SYNTHETIC_ORGANIZATION_A,
    boundary: {
      type: 'Feature',
      properties: { id: 'sample-area-a', name: 'Fictional service area A' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-0.07, -0.065],
            [0.07, -0.065],
            [0.07, 0.065],
            [-0.07, 0.065],
            [-0.07, -0.065],
          ],
        ],
      },
    },
    requests: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            id: 'fictional-a-1',
            title: 'Sample lighting concern',
            category: 'Lighting',
            status: 'New',
          },
          geometry: { type: 'Point', coordinates: [-0.035, 0.025] },
        },
        {
          type: 'Feature',
          properties: {
            id: 'fictional-a-2',
            title: 'Sample path repair',
            category: 'Parks',
            status: 'In progress',
          },
          geometry: { type: 'Point', coordinates: [0.025, 0.035] },
        },
      ],
    },
  },
  [SYNTHETIC_ORGANIZATION_B]: {
    organizationId: SYNTHETIC_ORGANIZATION_B,
    boundary: {
      type: 'Feature',
      properties: { id: 'sample-area-b', name: 'Fictional service area B' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0.2, 0.2],
            [0.3, 0.2],
            [0.3, 0.3],
            [0.2, 0.3],
            [0.2, 0.2],
          ],
        ],
      },
    },
    requests: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            id: 'fictional-b-1',
            title: 'Sample sign concern',
            category: 'Streets',
            status: 'New',
          },
          geometry: { type: 'Point', coordinates: [0.25, 0.25] },
        },
      ],
    },
  },
};

// Shared fictional geometry only; never expose staff request features to intake.
export function syntheticServiceBoundary(organizationId: string) {
  const fixture = fixtures[organizationId];
  return fixture
    ? projectGeospatialMapData(fixture, organizationId).boundary
    : null;
}

@Injectable()
export class SyntheticGeospatialRepository implements GeospatialReadRepository<GeospatialMapData> {
  constructor(private readonly config: ConfigService<AppConfiguration, true>) {}

  getMapData(organizationId: string): Promise<GeospatialMapData> {
    if (
      this.config.get('app.environment', { infer: true }) === 'production' ||
      this.config.get('deployment.profile', { infer: true }) !== 'development'
    )
      return Promise.reject(new ServiceUnavailableException());
    const fixture = fixtures[organizationId];
    if (!fixture) return Promise.reject(new NotFoundException());
    return Promise.resolve(projectGeospatialMapData(fixture, organizationId));
  }
}
