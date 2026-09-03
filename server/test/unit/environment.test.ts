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
  assert.equal(environment.APP_NAME, 'cityvue-api');
  assert.equal(environment.DATABASE_POOL_MAX, 10);
  assert.equal(environment.CORS_ORIGINS, 'http://localhost:5173');
  assert.equal(environment.ENABLE_DEVELOPMENT_SERVICE_REQUEST_READS, false);
});

test('production rejects development-only canonical detail reads', () => {
  assert.throws(
    () =>
      validateEnvironment({
        ...validEnvironment,
        NODE_ENV: 'production',
        DATABASE_SSL_MODE: 'require',
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

test('configuration validation rejects disabled database TLS in production', () => {
  assert.throws(
    () =>
      validateEnvironment({
        ...validEnvironment,
        NODE_ENV: 'production',
        DATABASE_SSL_MODE: 'disable',
      }),
    /DATABASE_SSL_MODE cannot be disable in production/,
  );
});

test('configuration validation rejects wildcard CORS', () => {
  assert.throws(
    () => validateEnvironment({ ...validEnvironment, CORS_ORIGINS: '*' }),
    /CORS_ORIGINS/,
  );
});
