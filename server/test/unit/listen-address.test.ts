import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import test from 'node:test';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { validateEnvironment } from '../../src/config/environment.js';
import {
  LOOPBACK_LISTEN_HOST,
  listenApplication,
  resolveListenHost,
} from '../../src/config/listen-address.js';
import { validateServingEnvironment } from '../../src/config/serving-environment.js';

/**
 * SEC-002 — the API listener binds IPv4 loopback outside production.
 *
 * The listener is exercised through `listenApplication`, the function
 * `main.ts` calls. Most cases use an application double that records its
 * `listen` arguments; one starts an empty Nest application on an ephemeral
 * loopback port to prove the real socket address. No case binds a wildcard
 * address, and nothing contacts PostgreSQL, Docker, Entra or the network.
 */

const SERVER_ROOT = resolve(__dirname, '../../..');
const source = (relative: string): string =>
  readFileSync(resolve(SERVER_ROOT, relative), 'utf8');
const MAIN_SOURCE = source('src/main.ts');
const POLICY_SOURCE = source('src/config/listen-address.ts');

function recordingApp(): {
  app: Pick<INestApplication, 'listen'>;
  calls: unknown[][];
} {
  const calls: unknown[][] = [];
  return {
    calls,
    app: {
      listen: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve();
      },
    },
  };
}

const development = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://cityvue:placeholder@localhost:5432/cityvue',
  DEVELOPMENT_ORGANIZATION_ID: '10000000-0000-4000-8000-000000000001',
};

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

test('the loopback listener is IPv4 loopback, never a wildcard', () => {
  assert.equal(LOOPBACK_LISTEN_HOST, '127.0.0.1');
});

test('development listens on 127.0.0.1 with the configured port', async () => {
  const { app, calls } = recordingApp();
  const listening = await listenApplication(app, {
    port: 3001,
    environment: 'development',
  });
  assert.deepEqual(calls, [[3001, '127.0.0.1']]);
  assert.deepEqual(listening, { port: 3001, host: '127.0.0.1' });
});

test('test listens on 127.0.0.1', async () => {
  const { app, calls } = recordingApp();
  await listenApplication(app, { port: 3000, environment: 'test' });
  assert.deepEqual(calls, [[3000, '127.0.0.1']]);
});

test('the Nest listening socket is bound to 127.0.0.1 in development', async () => {
  @Module({})
  class EmptyModule {}
  const app = await NestFactory.create(EmptyModule, { logger: false });
  try {
    const listening = await listenApplication(app, {
      port: 0,
      environment: 'development',
    });
    const address = (
      app.getHttpServer() as { address(): AddressInfo | string | null }
    ).address();
    assert.ok(address !== null && typeof address === 'object');
    assert.equal(address.address, '127.0.0.1');
    assert.equal(address.family, 'IPv4');
    assert.equal(listening.host, '127.0.0.1');
  } finally {
    await app.close();
  }
});

test('missing or unrecognised environments fail closed to loopback', async () => {
  const environments: unknown[] = [
    undefined,
    null,
    '',
    'staging',
    'Production',
    'PRODUCTION',
    ' production',
    'production ',
    'prod',
    0,
    true,
    {},
  ];
  for (const [index, environment] of environments.entries()) {
    assert.equal(
      resolveListenHost(environment),
      '127.0.0.1',
      `environment case ${String(index)}`,
    );
    const { app, calls } = recordingApp();
    await listenApplication(app, { port: 3000, environment });
    assert.deepEqual(calls, [[3000, '127.0.0.1']]);
  }
});

test('wildcard and non-loopback addresses cannot be configured outside production', async () => {
  // No listener-address setting exists. Values that look like one, whether in
  // the environment slot or the process environment, never leave loopback.
  for (const environment of ['0.0.0.0', '::', '[::]', '192.168.1.10', '::1']) {
    assert.equal(resolveListenHost(environment), '127.0.0.1', environment);
  }
  const saved = {
    HOST: process.env.HOST,
    LISTEN_HOST: process.env.LISTEN_HOST,
    BIND_HOST: process.env.BIND_HOST,
  };
  process.env.HOST = '0.0.0.0';
  process.env.LISTEN_HOST = '::';
  process.env.BIND_HOST = '0.0.0.0';
  try {
    const { app, calls } = recordingApp();
    await listenApplication(app, { port: 3001, environment: 'development' });
    assert.deepEqual(calls, [[3001, '127.0.0.1']]);
  } finally {
    for (const [name, value] of Object.entries(saved))
      if (value === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = value;
  }
  assert.equal(POLICY_SOURCE.includes('process.env'), false);
});

test('production keeps its existing listen(port) call with no host', async () => {
  const { app, calls } = recordingApp();
  const listening = await listenApplication(app, {
    port: 3000,
    environment: 'production',
  });
  assert.deepEqual(calls, [[3000]]);
  assert.equal(calls[0]?.length, 1);
  assert.deepEqual(listening, { port: 3000 });
});

test('validated profiles select the listener from NODE_ENV', () => {
  // Production serving requires the client profile; it keeps its listener.
  const served = validateServingEnvironment(production);
  assert.equal(served.CITYVUE_DEPLOYMENT_PROFILE, 'client');
  assert.equal(resolveListenHost(served.NODE_ENV), undefined);

  const local = validateEnvironment(development);
  assert.equal(local.CITYVUE_DEPLOYMENT_PROFILE, 'development');
  assert.equal(resolveListenHost(local.NODE_ENV), '127.0.0.1');

  // NODE_ENV defaults to development, so an absent value is loopback.
  const defaulted = validateEnvironment({
    DATABASE_URL: development.DATABASE_URL,
    DEVELOPMENT_ORGANIZATION_ID: development.DEVELOPMENT_ORGANIZATION_ID,
  });
  assert.equal(defaulted.NODE_ENV, 'development');
  assert.equal(resolveListenHost(defaulted.NODE_ENV), '127.0.0.1');

  // A production profile cannot be paired with the development profile.
  assert.throws(
    () =>
      validateEnvironment({
        ...production,
        CITYVUE_DEPLOYMENT_PROFILE: 'development',
      }),
    /production requires an explicit client deployment profile/,
  );
});

test('an invalid NODE_ENV is refused before any listener is chosen', () => {
  for (const NODE_ENV of ['staging', 'Production', ''])
    assert.throws(() => validateEnvironment({ ...development, NODE_ENV }));
});

test('main.ts listens only through the listener policy', () => {
  assert.match(MAIN_SOURCE, /await listenApplication\(app, \{/);
  assert.match(
    MAIN_SOURCE,
    /environment: config\.get\('app\.environment', \{ infer: true \}\)/,
  );
  assert.equal(MAIN_SOURCE.includes('.listen('), false);
});

test('the listener policy reads no CORS, Entra, database or tracking setting', () => {
  for (const pattern of [/CORS/i, /ENTRA/i, /DATABASE/i, /TRACKING/i, /staff/i])
    assert.equal(pattern.test(POLICY_SOURCE), false, String(pattern));
  assert.equal(POLICY_SOURCE.includes('process.env'), false);
  const imports = POLICY_SOURCE.match(/^import .*$/gm) ?? [];
  assert.deepEqual(imports, [
    "import type { INestApplication } from '@nestjs/common';",
  ]);
});
