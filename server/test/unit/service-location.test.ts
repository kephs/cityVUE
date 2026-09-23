import assert from 'node:assert/strict';
import test from 'node:test';
import { validate } from 'class-validator';
import { LocationInputDto } from '../../src/service-request/service-request.dto.js';
import {
  validServicePoint,
  pointInServiceBoundary,
} from '../../src/location-eligibility/service-location.domain.js';
import {
  syntheticServiceBoundary,
  SYNTHETIC_ORGANIZATION_A,
  SYNTHETIC_ORGANIZATION_B,
} from '../../src/geospatial/synthetic-geospatial.repository.js';
import { DevelopmentLocationEligibilityProvider } from '../../src/location-eligibility/development-location-eligibility.provider.js';
import { IntakeLocationController } from '../../src/location-eligibility/intake-location.controller.js';

test('F045 coordinates are numeric, paired, finite and bounded', async () => {
  for (const [lat, lon] of [
    [NaN, 0],
    [Infinity, 0],
    [91, 0],
    [0, -181],
    [undefined, 0],
    ['0', 0],
    [null, null],
  ])
    assert.equal(validServicePoint(lat, lon), false);
  assert.equal(validServicePoint(-12.345678, 123.456789), true);
  for (const values of [
    { latitude: 91 },
    { longitude: 181 },
    { latitude: '0' },
    { latitude: Infinity },
  ]) {
    assert.ok(
      (
        await validate(
          Object.assign(new LocationInputDto(), {
            enteredAddress: 'Fictional location',
            ...values,
          }),
        )
      ).length,
    );
  }
});

test('F045 fictional boundary includes edges and respects Organization scope', () => {
  const a = syntheticServiceBoundary(SYNTHETIC_ORGANIZATION_A);
  const b = syntheticServiceBoundary(SYNTHETIC_ORGANIZATION_B);
  assert.ok(a);
  assert.ok(b);
  assert.equal(pointInServiceBoundary(0, 0, a), true);
  assert.equal(pointInServiceBoundary(0, 0.07, a), true);
  assert.equal(pointInServiceBoundary(0.065, -0.07, a), true);
  assert.equal(pointInServiceBoundary(0, 0.070001, a), false);
  assert.equal(pointInServiceBoundary(0, 0, b), false);
  assert.equal(pointInServiceBoundary(0.25, 0.25, b), true);
  assert.equal(syntheticServiceBoundary('missing'), null);
});

test('F045 coordinate eligibility cannot be bypassed by a provider label or another Organization', async () => {
  const provider = new DevelopmentLocationEligibilityProvider();
  const input = {
    organizationId: SYNTHETIC_ORGANIZATION_A,
    policyType: 'city_boundary',
    policyReference: null,
    enteredAddress: 'DEV-ELIGIBLE',
    normalizedAddress: null,
    latitude: 0.25,
    longitude: 0.25,
    locationType: 'other',
    facilityReference: null,
    parkReference: null,
    parcelReference: null,
    assetReference: null,
  };
  assert.equal((await provider.evaluate(input)).result, 'ineligible');
  assert.equal(
    (
      await provider.evaluate({
        ...input,
        organizationId: SYNTHETIC_ORGANIZATION_B,
      })
    ).result,
    'eligible',
  );
  assert.equal(
    (await provider.evaluate({ ...input, organizationId: 'missing' })).result,
    'unable_to_determine',
  );
  assert.equal(
    (await provider.evaluate({ ...input, latitude: 0, longitude: 0 })).result,
    'eligible',
  );
  assert.equal(
    (await provider.evaluate({ ...input, latitude: NaN })).result,
    'unable_to_determine',
  );
  assert.equal(
    (await provider.evaluate({ ...input, policyType: 'park' })).result,
    'unable_to_determine',
  );
});

test('F045 public configuration is minimized and disabled outside development', async () => {
  let calls = 0;
  const query = {
    select: () => query,
    where: () => query,
    executeTakeFirst: async () => {
      calls++;
      return { id: SYNTHETIC_ORGANIZATION_A };
    },
  };
  const db = { client: { selectFrom: () => query } };
  const config = (environment: string, org = SYNTHETIC_ORGANIZATION_A) => ({
    get: (key: string) =>
      key === 'app.environment'
        ? environment
        : key === 'deployment.profile'
          ? 'development'
          : org,
  });
  const production = new IntakeLocationController(
    config('production') as never,
    db as never,
  );
  assert.deepEqual(await production.configuration(), {
    mode: 'unavailable',
    boundary: null,
    locations: [],
  });
  assert.equal(calls, 0);
  const safe = await new IntakeLocationController(
    config('development') as never,
    db as never,
  ).configuration();
  assert.deepEqual(Object.keys(safe).sort(), ['boundary', 'locations', 'mode']);
  assert.equal(safe.locations.length, 3);
  assert.equal(JSON.stringify(safe).includes('organizationId'), false);
  assert.equal(JSON.stringify(safe).includes('requests'), false);
  assert.equal(
    (
      await new IntakeLocationController(
        config('development', 'missing') as never,
        db as never,
      ).configuration()
    ).mode,
    'unavailable',
  );
});
