import assert from 'node:assert/strict';
import test from 'node:test';
import { validateEnvironment } from '../../src/config/environment.js';
import {
  parsePublicHostnames,
  servingStartupFailure,
  validateServingEnvironment,
} from '../../src/config/serving-environment.js';

const production = {
  NODE_ENV: 'production',
  CITYVUE_DEPLOYMENT_PROFILE: 'client',
  DATABASE_URL: 'postgresql://localhost/fictional_serving_test',
  DATABASE_SSL_MODE: 'verify-full',
  TENANT_RESOLUTION_STRATEGY: 'registry',
  TENANT_HOST_SOURCE: 'forwarded',
  TENANT_TRUSTED_PROXY_CIDRS: '127.0.0.1,::1',
  REQRO_PUBLIC_HOSTNAMES: 'requests.example.gov,report.example.gov',
  CORS_ORIGINS: 'https://requests.example.gov,https://report.example.gov',
};

test('production HTTP configuration accepts exact approved HTTPS origins and explicit peers', () => {
  const result = validateServingEnvironment(production);
  assert.equal(result.CORS_ORIGINS, production.CORS_ORIGINS);
  assert.equal(result.TENANT_HOST_SOURCE, 'forwarded');
  assert.equal(result.DEVELOPMENT_ORGANIZATION_ID, undefined);
  assert.doesNotThrow(() =>
    validateServingEnvironment({
      ...production,
      TENANT_TRUSTED_PROXY_CIDRS: '10.20.30.0/24,2001:db8::/64',
    }),
  );
});

for (const [name, setting] of Object.entries({
  'missing proxy': { TENANT_TRUSTED_PROXY_CIDRS: undefined },
  'empty proxy': { TENANT_TRUSTED_PROXY_CIDRS: '' },
  'empty proxy member': { TENANT_TRUSTED_PROXY_CIDRS: '127.0.0.1,' },
  'all IPv4 peers': { TENANT_TRUSTED_PROXY_CIDRS: '0.0.0.0/0' },
  'all IPv6 peers': { TENANT_TRUSTED_PROXY_CIDRS: '::/0' },
  'invalid proxy': { TENANT_TRUSTED_PROXY_CIDRS: 'not-a-peer' },
  'development Organization': {
    DEVELOPMENT_ORGANIZATION_ID: '10000000-0000-4000-8000-000000000001',
  },
  'development strategy': { TENANT_RESOLUTION_STRATEGY: 'development' },
  'unknown strategy': { TENANT_RESOLUTION_STRATEGY: 'unknown' },
  'direct host source': {
    TENANT_HOST_SOURCE: 'direct',
    TENANT_TRUSTED_PROXY_CIDRS: '',
  },
  'missing host source': {
    TENANT_HOST_SOURCE: undefined,
    TENANT_TRUSTED_PROXY_CIDRS: '',
  },
  'unknown host source': { TENANT_HOST_SOURCE: 'unknown' },
  'development profile': { CITYVUE_DEPLOYMENT_PROFILE: 'development' },
  'missing inventory': { REQRO_PUBLIC_HOSTNAMES: undefined },
  'missing CORS': { CORS_ORIGINS: undefined },
  'localhost CORS': { CORS_ORIGINS: 'https://localhost' },
  'wildcard CORS': { CORS_ORIGINS: '*' },
  'wildcard subdomain CORS': { CORS_ORIGINS: 'https://*.example.gov' },
  'insecure CORS': { CORS_ORIGINS: 'http://requests.example.gov' },
  'unrelated tenant CORS': { CORS_ORIGINS: 'https://other.example.gov' },
  'origin path': { CORS_ORIGINS: 'https://requests.example.gov/path' },
  'origin trailing slash': { CORS_ORIGINS: 'https://requests.example.gov/' },
  'origin credentials': {
    CORS_ORIGINS: 'https://fictional:private@requests.example.gov',
  },
  'origin query': {
    CORS_ORIGINS: 'https://requests.example.gov?private=value',
  },
  'origin fragment': { CORS_ORIGINS: 'https://requests.example.gov#value' },
  'origin custom port': { CORS_ORIGINS: 'https://requests.example.gov:8443' },
  'origin empty member': { CORS_ORIGINS: 'https://requests.example.gov,' },
  'origin duplicate': {
    CORS_ORIGINS: 'https://requests.example.gov,https://requests.example.gov',
  },
})) {
  test(`production HTTP configuration rejects ${name}`, () => {
    assert.throws(
      () => validateServingEnvironment({ ...production, ...setting }),
      /Invalid .*configuration/,
    );
  });
}

for (const setting of [
  'ENABLE_DEVELOPMENT_ATTACHMENTS',
  'ENABLE_DEVELOPMENT_SERVICE_REQUEST_READS',
  'ENABLE_DEVELOPMENT_STAFF_ACTIONS',
  'ENABLE_DEVELOPMENT_LOCATION_ELIGIBILITY',
  'CITYVUE_ENABLE_EXTERNAL_IDENTITY',
  'AI_TEST_EXECUTION_ENABLED',
]) {
  test(`production HTTP configuration preserves refusal of ${setting}`, () => {
    assert.throws(
      () => validateServingEnvironment({ ...production, [setting]: 'true' }),
      /Invalid server configuration/,
    );
  });
}

test('production HTTP configuration preserves refusal of the development location provider', () => {
  assert.throws(() =>
    validateServingEnvironment({
      ...production,
      LOCATION_ELIGIBILITY_PROVIDER: 'development',
    }),
  );
});

test('hostname inventory uses the existing canonical hostname grammar without fallback', () => {
  assert.deepEqual(
    parsePublicHostnames(' requests.example.gov , xn--bcher-kva.example '),
    ['requests.example.gov', 'xn--bcher-kva.example'],
  );
  for (const value of [
    undefined,
    '',
    ',',
    'localhost',
    'a.localhost',
    'a.local',
    '127.0.0.1',
    '[::1]',
    '*.example.gov',
    'https://requests.example.gov',
    'requests.example.gov:443',
    'Requests.example.gov',
    'requests.example.gov.',
    'requests.example.gov,',
    'requests.example.gov,requests.example.gov',
    'requests.example.gov\r\nx-private: value',
    'x'.repeat(16385),
    Array.from(
      { length: 65 },
      (_, index) => `host${String(index)}.example.gov`,
    ).join(','),
  ]) {
    assert.throws(() => parsePublicHostnames(value), /REQRO_PUBLIC_HOSTNAMES/);
  }
});

test('new serving errors are bounded and do not echo supplied values', () => {
  for (const setting of [
    { REQRO_PUBLIC_HOSTNAMES: 'sensitive-marker/invalid' },
    { CORS_ORIGINS: 'https://sensitive-marker@requests.example.gov' },
  ]) {
    assert.throws(
      () => validateServingEnvironment({ ...production, ...setting }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.length < 250);
        assert.doesNotMatch(error.message, /sensitive-marker/);
        return true;
      },
    );
  }
});

test('startup diagnostics expose only fixed serving requirements, never arbitrary error messages', () => {
  try {
    validateServingEnvironment({
      ...production,
      REQRO_PUBLIC_HOSTNAMES: 'sensitive-marker/invalid',
    });
    assert.fail('unsafe inventory must be rejected');
  } catch (error) {
    const output = servingStartupFailure(error);
    assert.match(
      output,
      /REQRO_PUBLIC_HOSTNAMES requires canonical public DNS hostnames/,
    );
    assert.doesNotMatch(output, /sensitive-marker|stack/);
  }
  for (const error of [
    new Error('sensitive-marker'),
    new Error('Invalid production serving configuration: sensitive-marker'),
    { message: 'sensitive-marker' },
  ]) {
    assert.doesNotMatch(
      servingStartupFailure(error),
      /sensitive-marker|requirement/,
    );
  }
});

test('local development and test retain direct-host and localhost configuration', () => {
  for (const NODE_ENV of ['development', 'test']) {
    const result = validateServingEnvironment({
      NODE_ENV,
      DATABASE_URL: production.DATABASE_URL,
      DEVELOPMENT_ORGANIZATION_ID: '10000000-0000-4000-8000-000000000001',
    });
    assert.equal(result.TENANT_HOST_SOURCE, 'direct');
    assert.equal(result.CORS_ORIGINS, 'http://localhost:5173');
  }
});

test('non-serving environment validation does not acquire HTTP serving prerequisites', () => {
  const {
    REQRO_PUBLIC_HOSTNAMES: _hosts,
    CORS_ORIGINS: _origins,
    ...input
  } = production;
  void _hosts;
  void _origins;
  assert.doesNotThrow(() =>
    validateEnvironment({
      ...input,
      TENANT_HOST_SOURCE: 'direct',
      TENANT_TRUSTED_PROXY_CIDRS: '',
    }),
  );
});
