import assert from 'node:assert/strict';
import test from 'node:test';
import { validateEnvironment } from '../../src/config/environment.js';
import { developmentGeospatialGrantInput } from '../../src/database/development-geospatial-grant.js';

const tenant = '30000000-0000-4000-8000-000000000003';
const oid = '40000000-0000-4000-8000-000000000004';
const organization = '10000000-0000-4000-8000-000000000001';
const base = {
  NODE_ENV: 'development',
  CITYVUE_DEPLOYMENT_PROFILE: 'development',
  CITYVUE_ENABLE_EXTERNAL_IDENTITY: 'true',
  DATABASE_URL: 'postgresql://example:placeholder@localhost/test',
  ENTRA_TENANT_ID: tenant,
  ENTRA_API_CLIENT_ID: '50000000-0000-4000-8000-000000000005',
  ENTRA_EXPECTED_AUDIENCE: 'api://fictional',
};
const input = {
  F027_ENTRA_OBJECT_ID: oid,
  F027_ORGANIZATION_ID: organization,
  F027_GRANT_GEOSPATIAL_READ: 'true',
};

test('provisioning needs explicit, valid identity, Organization and grant choice', () => {
  const env = validateEnvironment(base);
  assert.deepEqual(developmentGeospatialGrantInput(env, input), {
    tenantId: tenant,
    objectId: oid,
    organizationId: organization,
    grant: true,
  });
  assert.equal(
    developmentGeospatialGrantInput(env, {
      ...input,
      F027_GRANT_GEOSPATIAL_READ: 'false',
    }).grant,
    false,
  );
  for (const invalid of [
    { ...input, F027_ENTRA_OBJECT_ID: 'browser-role' },
    { ...input, F027_ORGANIZATION_ID: undefined },
    { ...input, F027_GRANT_GEOSPATIAL_READ: undefined },
    { ...input, F027_GRANT_GEOSPATIAL_READ: 'yes' },
  ])
    assert.throws(() => developmentGeospatialGrantInput(env, invalid));
});

test('provisioning rejects production, client and missing external identity opt-in', () => {
  for (const overrides of [
    {
      NODE_ENV: 'production',
      CITYVUE_DEPLOYMENT_PROFILE: 'client',
      CITYVUE_ENABLE_EXTERNAL_IDENTITY: 'false',
      DATABASE_SSL_MODE: 'verify-full',
    },
    {
      CITYVUE_DEPLOYMENT_PROFILE: 'client',
      CITYVUE_ENABLE_EXTERNAL_IDENTITY: 'false',
    },
  ]) {
    const env = validateEnvironment({ ...base, ...overrides });
    assert.throws(
      () => developmentGeospatialGrantInput(env, input),
      /provisioning is unavailable/,
    );
  }
  assert.throws(
    () =>
      validateEnvironment({
        ...base,
        CITYVUE_ENABLE_EXTERNAL_IDENTITY: 'false',
      }),
    /external identity opt-in/,
  );
});
