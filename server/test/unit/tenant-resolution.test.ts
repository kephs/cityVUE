import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { assertServableTenantStrategy } from '../../src/bootstrap.js';
import { configuration } from '../../src/config/configuration.js';
import { validateEnvironment } from '../../src/config/environment.js';

const organizationId = '10000000-0000-4000-8000-000000000001';
const development = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://cityvue:placeholder@localhost:5432/cityvue',
  DEVELOPMENT_ORGANIZATION_ID: organizationId,
};
const client = {
  NODE_ENV: 'production',
  CITYVUE_DEPLOYMENT_PROFILE: 'client',
  DATABASE_URL: 'postgresql://cityvue:placeholder@localhost:5432/cityvue',
  DATABASE_SSL_MODE: 'verify-full',
  TENANT_RESOLUTION_STRATEGY: 'registry',
};

test('tenant resolution defaults to the development strategy', () => {
  const environment = validateEnvironment(development);

  assert.equal(environment.TENANT_RESOLUTION_STRATEGY, 'development');
  assert.equal(environment.DEVELOPMENT_ORGANIZATION_ID, organizationId);
});

test('development strategy requires an explicit development Organization', () => {
  const { DEVELOPMENT_ORGANIZATION_ID: _omitted, ...withoutOrganization } =
    development;
  void _omitted;

  assert.throws(
    () => validateEnvironment(withoutOrganization),
    /development Organization resolution requires an explicit DEVELOPMENT_ORGANIZATION_ID/,
  );
});

test('development strategy is rejected in production and in a client profile', () => {
  assert.throws(
    () =>
      validateEnvironment({
        ...development,
        NODE_ENV: 'production',
        CITYVUE_DEPLOYMENT_PROFILE: 'client',
        DATABASE_SSL_MODE: 'verify-full',
      }),
    /development Organization resolution cannot be used in production/,
  );
  assert.throws(
    () =>
      validateEnvironment({
        ...development,
        CITYVUE_DEPLOYMENT_PROFILE: 'client',
      }),
    /development Organization resolution requires an explicit development deployment profile/,
  );
});

test('registry strategy is accepted configuration state for a client deployment', () => {
  const environment = validateEnvironment(client);

  assert.equal(environment.TENANT_RESOLUTION_STRATEGY, 'registry');
  assert.equal(environment.DEVELOPMENT_ORGANIZATION_ID, undefined);
});

test('registry strategy rejects a lingering development Organization', () => {
  assert.throws(
    () =>
      validateEnvironment({
        ...client,
        DEVELOPMENT_ORGANIZATION_ID: organizationId,
      }),
    /registry tenant resolution cannot be combined with DEVELOPMENT_ORGANIZATION_ID/,
  );
});

test('an unknown tenant resolution strategy is rejected', () => {
  assert.throws(() =>
    validateEnvironment({
      ...development,
      TENANT_RESOLUTION_STRATEGY: 'hostname',
    }),
  );
});

test('the API refuses to serve under the unimplemented registry resolver', () => {
  assert.doesNotThrow(() => {
    assertServableTenantStrategy('development');
  });
  assert.throws(() => {
    assertServableTenantStrategy('registry');
  }, /registry tenant resolution is not implemented/);
});

test('configuration exposes the strategy and never substitutes a fixture Organization', () => {
  const previous = {
    strategy: process.env.TENANT_RESOLUTION_STRATEGY,
    organization: process.env.DEVELOPMENT_ORGANIZATION_ID,
  };
  try {
    delete process.env.TENANT_RESOLUTION_STRATEGY;
    delete process.env.DEVELOPMENT_ORGANIZATION_ID;
    const absent = configuration();
    assert.equal(absent.tenancy.resolutionStrategy, 'development');
    assert.equal(absent.catalog.developmentOrganizationId, '');

    process.env.TENANT_RESOLUTION_STRATEGY = 'registry';
    assert.equal(configuration().tenancy.resolutionStrategy, 'registry');

    process.env.TENANT_RESOLUTION_STRATEGY = 'development';
    process.env.DEVELOPMENT_ORGANIZATION_ID = organizationId;
    assert.equal(
      configuration().catalog.developmentOrganizationId,
      organizationId,
    );
  } finally {
    if (previous.strategy === undefined)
      delete process.env.TENANT_RESOLUTION_STRATEGY;
    else process.env.TENANT_RESOLUTION_STRATEGY = previous.strategy;
    if (previous.organization === undefined)
      delete process.env.DEVELOPMENT_ORGANIZATION_ID;
    else process.env.DEVELOPMENT_ORGANIZATION_ID = previous.organization;
  }
});

test('no hardcoded fixture Organization remains in the emitted configuration modules', () => {
  for (const emitted of [
    '../../src/config/configuration.js',
    '../../src/config/environment.js',
  ])
    assert.doesNotMatch(
      readFileSync(resolve(__dirname, emitted), 'utf8'),
      /10000000-0000-4000-8000-000000000001/,
      `${emitted} must not carry the development fixture Organization`,
    );
});
