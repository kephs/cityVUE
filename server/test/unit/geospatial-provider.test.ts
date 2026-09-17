import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  SyntheticGeospatialRepository,
  SYNTHETIC_ORGANIZATION_A,
  SYNTHETIC_ORGANIZATION_B,
} from '../../src/geospatial/synthetic-geospatial.repository.js';
import { projectGeospatialMapData } from '../../src/geospatial/geospatial.types.js';

function repository(environment: string, profile: string) {
  return new SyntheticGeospatialRepository(
    new ConfigService({ app: { environment }, deployment: { profile } }),
  );
}

test('synthetic provider returns separate, narrow Organization data snapshots', async () => {
  const subject = repository('test', 'development');
  const a = await subject.getMapData(SYNTHETIC_ORGANIZATION_A);
  const b = await subject.getMapData(SYNTHETIC_ORGANIZATION_B);
  assert.equal(a.organizationId, SYNTHETIC_ORGANIZATION_A);
  assert.equal(b.organizationId, SYNTHETIC_ORGANIZATION_B);
  assert.equal(a.boundary.geometry.type, 'Polygon');
  assert.equal(a.requests.features[0]?.geometry.type, 'Point');
  assert.notDeepEqual(a.requests.features, b.requests.features);
  a.requests.features[0].properties.title = 'changed';
  assert.notEqual(
    (await subject.getMapData(SYNTHETIC_ORGANIZATION_A)).requests.features[0]
      ?.properties.title,
    'changed',
  );
  await assert.rejects(
    subject.getMapData('30000000-0000-4000-8000-000000000003'),
    NotFoundException,
  );
});

test('synthetic provider fails closed in production or client profile', async () => {
  for (const [environment, profile] of [
    ['production', 'development'],
    ['test', 'client'],
    ['production', 'client'],
  ] as const) {
    await assert.rejects(
      repository(environment, profile).getMapData(SYNTHETIC_ORGANIZATION_A),
      ServiceUnavailableException,
    );
  }
});

test('response projection rejects unsupported geometry and removes provider extras', async () => {
  const data = await repository('test', 'development').getMapData(
    SYNTHETIC_ORGANIZATION_A,
  );
  const extra = {
    ...data,
    secret: 'NOT_PUBLIC',
    boundary: {
      ...data.boundary,
      properties: { ...data.boundary.properties, internal: 'NOT_PUBLIC' },
    },
  };
  assert.deepEqual(
    projectGeospatialMapData(extra, SYNTHETIC_ORGANIZATION_A),
    data,
  );
  assert.throws(() =>
    projectGeospatialMapData(
      { ...data, organizationId: SYNTHETIC_ORGANIZATION_B },
      SYNTHETIC_ORGANIZATION_A,
    ),
  );
  assert.throws(() =>
    projectGeospatialMapData(
      {
        ...data,
        requests: {
          type: 'FeatureCollection',
          features: [
            {
              ...data.requests.features[0],
              geometry: {
                type: 'LineString',
                coordinates: [
                  [0, 0],
                  [1, 1],
                ],
              },
            },
          ],
        },
      },
      SYNTHETIC_ORGANIZATION_A,
    ),
  );
});
