import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { EvaluateLocationEligibilityService } from '../../src/location-eligibility/evaluate-location-eligibility.service.js';
import { DevelopmentLocationEligibilityProvider } from '../../src/location-eligibility/development-location-eligibility.provider.js';

const logger = { logger: { info: () => undefined } };
const config = { get: () => 100 };
const input = {
  organizationId: '10000000-0000-4000-8000-000000000001',
  policyType: 'city_boundary',
  policyReference: 'development-boundary',
  unableToDetermineBehavior: 'block',
  enteredAddress: 'DEV-ELIGIBLE',
  locationType: 'entered_address',
};
test('development provider returns only deterministic normalized test results', async () => {
  const provider = new DevelopmentLocationEligibilityProvider();
  assert.equal(
    (
      await provider.evaluate({
        ...input,
        normalizedAddress: null,
        latitude: null,
        longitude: null,
        facilityReference: null,
        parkReference: null,
        parcelReference: null,
        assetReference: null,
      })
    ).result,
    'eligible',
  );
  assert.equal(
    (
      await provider.evaluate({
        ...input,
        enteredAddress: 'DEV-INELIGIBLE',
        normalizedAddress: null,
        latitude: null,
        longitude: null,
        facilityReference: null,
        parkReference: null,
        parcelReference: null,
        assetReference: null,
      })
    ).result,
    'ineligible',
  );
});
test('no geographic restriction skips the provider', async () => {
  const provider = {
    evaluate: async () => {
      throw new Error('must not run');
    },
  };
  const service = new EvaluateLocationEligibilityService(
    config as never,
    provider,
    logger as never,
  );
  assert.equal(
    await service.execute({
      ...input,
      policyType: 'no_geographic_restriction',
    }),
    null,
  );
});
test('eligible proceeds while ineligible and undetermined return distinct safe codes', async () => {
  const eligible = new EvaluateLocationEligibilityService(
    config as never,
    new DevelopmentLocationEligibilityProvider(),
    logger as never,
  );
  assert.equal((await eligible.execute(input))?.result, 'eligible');
  for (const [address, code] of [
    ['DEV-INELIGIBLE', 'LOCATION_INELIGIBLE'],
    ['DEV-UNABLE', 'LOCATION_ELIGIBILITY_UNDETERMINED'],
  ] as const)
    await assert.rejects(
      () => eligible.execute({ ...input, enteredAddress: address }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        (error.getResponse() as { code?: string }).code === code,
    );
});
test('provider failure and timeout normalize to temporary-unavailable semantics', async () => {
  for (const provider of [
    {
      evaluate: async () => {
        throw new Error('secret provider failure');
      },
    },
    { evaluate: () => new Promise<never>(() => undefined) },
  ]) {
    const service = new EvaluateLocationEligibilityService(
      config as never,
      provider,
      logger as never,
    );
    await assert.rejects(
      () => service.execute(input),
      (error: unknown) =>
        error instanceof BadRequestException &&
        (error.getResponse() as { code?: string }).code ===
          'LOCATION_ELIGIBILITY_UNAVAILABLE',
    );
  }
});
