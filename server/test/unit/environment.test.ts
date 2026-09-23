import assert from 'node:assert/strict';
import test from 'node:test';
import { validateEnvironment } from '../../src/config/environment.js';

const validEnvironment = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://cityvue:placeholder@localhost:5432/cityvue',
};

test('configuration validation applies safe platform defaults', () => {
  const environment = validateEnvironment(validEnvironment);

  assert.equal(environment.PORT, 3000);
  assert.equal(environment.CITYVUE_DEPLOYMENT_PROFILE, 'development');
  assert.equal(environment.CITYVUE_ENABLE_EXTERNAL_IDENTITY, false);
  assert.equal(environment.APP_NAME, 'cityvue-api');
  assert.equal(environment.DATABASE_POOL_MAX, 10);
  assert.equal(environment.CORS_ORIGINS, 'http://localhost:5173');
  assert.equal(environment.ENABLE_DEVELOPMENT_SERVICE_REQUEST_READS, false);
  assert.equal(environment.ENABLE_DEVELOPMENT_STAFF_ACTIONS, false);
  assert.equal(environment.LOCATION_ELIGIBILITY_PROVIDER, 'disabled');
  assert.equal(environment.ENABLE_DEVELOPMENT_LOCATION_ELIGIBILITY, false);
});

test('production requires an explicit client deployment profile', () => {
  assert.throws(
    () =>
      validateEnvironment({
        ...validEnvironment,
        NODE_ENV: 'production',
        DATABASE_SSL_MODE: 'verify-full',
      }),
    /explicit client deployment profile/,
  );
});

test('development requires explicit opt-in before enabling external Entra identity', () => {
  const entra = {
    ENTRA_TENANT_ID: '11111111-1111-4111-8111-111111111111',
    ENTRA_API_CLIENT_ID: '22222222-2222-4222-8222-222222222222',
    ENTRA_EXPECTED_AUDIENCE: 'api://22222222-2222-4222-8222-222222222222',
  };
  assert.throws(
    () => validateEnvironment({ ...validEnvironment, ...entra }),
    /explicit external identity opt-in/,
  );
  assert.equal(
    validateEnvironment({
      ...validEnvironment,
      ...entra,
      CITYVUE_ENABLE_EXTERNAL_IDENTITY: 'true',
    }).ENTRA_TENANT_ID,
    entra.ENTRA_TENANT_ID,
  );
});

test('client profile rejects development providers and access gates', () => {
  for (const setting of [
    { ENABLE_DEVELOPMENT_STAFF_ACTIONS: 'true' },
    { ENABLE_DEVELOPMENT_SERVICE_REQUEST_READS: 'true' },
    { ENABLE_DEVELOPMENT_LOCATION_ELIGIBILITY: 'true' },
    { LOCATION_ELIGIBILITY_PROVIDER: 'development' },
  ]) {
    assert.throws(
      () =>
        validateEnvironment({
          ...validEnvironment,
          CITYVUE_DEPLOYMENT_PROFILE: 'client',
          ...setting,
        }),
      /development providers and access gates cannot be enabled in a client profile/,
    );
  }
});

test('deployment profile rejects unknown selection and development opt-in in client profile', () => {
  assert.throws(() =>
    validateEnvironment({
      ...validEnvironment,
      CITYVUE_DEPLOYMENT_PROFILE: 'other',
    }),
  );
  assert.throws(
    () =>
      validateEnvironment({
        ...validEnvironment,
        CITYVUE_DEPLOYMENT_PROFILE: 'client',
        CITYVUE_ENABLE_EXTERNAL_IDENTITY: 'true',
      }),
    /development external identity opt-in is not valid in a client profile/,
  );
});

test('external identity opt-in requires Entra configuration', () => {
  assert.throws(
    () =>
      validateEnvironment({
        ...validEnvironment,
        CITYVUE_ENABLE_EXTERNAL_IDENTITY: 'true',
      }),
    /external identity opt-in requires complete Entra configuration/,
  );
});

test('production rejects development-only staff actions', () => {
  assert.throws(
    () =>
      validateEnvironment({
        ...validEnvironment,
        NODE_ENV: 'production',
        DATABASE_SSL_MODE: 'verify-full',
        ENABLE_DEVELOPMENT_STAFF_ACTIONS: 'true',
      }),
    /development staff actions cannot be enabled in production/,
  );
});

test('production rejects the deterministic development location provider', () => {
  assert.throws(
    () =>
      validateEnvironment({
        ...validEnvironment,
        NODE_ENV: 'production',
        DATABASE_SSL_MODE: 'verify-full',
        LOCATION_ELIGIBILITY_PROVIDER: 'development',
        ENABLE_DEVELOPMENT_LOCATION_ELIGIBILITY: 'true',
      }),
    /development location eligibility cannot be enabled in production/,
  );
});

test('production rejects development-only canonical detail reads', () => {
  assert.throws(
    () =>
      validateEnvironment({
        ...validEnvironment,
        NODE_ENV: 'production',
        DATABASE_SSL_MODE: 'verify-full',
        ENABLE_DEVELOPMENT_SERVICE_REQUEST_READS: 'true',
      }),
    /development service request reads cannot be enabled in production/,
  );
});

test('configuration validation rejects a missing database URL', () => {
  assert.throws(
    () => validateEnvironment({ NODE_ENV: 'development' }),
    /DATABASE_URL.*required/,
  );
});

test('Entra configuration is explicit and all-or-nothing', () => {
  assert.throws(() =>
    validateEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://cityvue:test@localhost/cityvue',
      ENTRA_TENANT_ID: '11111111-1111-4111-8111-111111111111',
    }),
  );
  const configured = validateEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://cityvue:test@localhost/cityvue',
    ENTRA_TENANT_ID: '11111111-1111-4111-8111-111111111111',
    ENTRA_API_CLIENT_ID: '22222222-2222-4222-8222-222222222222',
    ENTRA_EXPECTED_AUDIENCE: 'api://22222222-2222-4222-8222-222222222222',
  });
  assert.equal(configured.ENTRA_REQUIRED_SCOPE, 'access_as_user');
});

test('configuration validation rejects disabled database TLS in production', () => {
  assert.throws(
    () =>
      validateEnvironment({
        ...validEnvironment,
        NODE_ENV: 'production',
        DATABASE_SSL_MODE: 'disable',
      }),
    /DATABASE_SSL_MODE must be verify-full in production/,
  );
});

test('configuration validation rejects wildcard CORS', () => {
  assert.throws(
    () => validateEnvironment({ ...validEnvironment, CORS_ORIGINS: '*' }),
    /CORS_ORIGINS/,
  );
});

test('F046 attachment processing is opt-in and prohibited in production or client profiles', () => {
  assert.equal(
    validateEnvironment(validEnvironment).ENABLE_DEVELOPMENT_ATTACHMENTS,
    false,
  );
  assert.equal(
    validateEnvironment({
      ...validEnvironment,
      ENABLE_DEVELOPMENT_ATTACHMENTS: 'true',
    }).ENABLE_DEVELOPMENT_ATTACHMENTS,
    true,
  );
  for (const extra of [
    { NODE_ENV: 'production', CITYVUE_DEPLOYMENT_PROFILE: 'client' },
    { CITYVUE_DEPLOYMENT_PROFILE: 'client' },
  ])
    assert.throws(
      () =>
        validateEnvironment({
          ...validEnvironment,
          ...extra,
          ENABLE_DEVELOPMENT_ATTACHMENTS: 'true',
        }),
      /development attachments/,
    );
});
