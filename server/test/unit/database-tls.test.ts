import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { rootCertificates, type ConnectionOptions } from 'node:tls';
import test from 'node:test';
import { Client, type PoolConfig } from 'pg';
import type { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from '../../src/config/configuration.js';
import type { PinoLoggerService } from '../../src/common/logging/pino-logger.service.js';
import { DatabaseService } from '../../src/database/database.service.js';
import { databaseConnectionOptions } from '../../src/config/database-tls.js';
import { validateEnvironment } from '../../src/config/environment.js';

const url = 'postgresql://localhost/cityvue_tls_test';
const production = {
  NODE_ENV: 'production',
  DATABASE_URL: url,
  DATABASE_SSL_MODE: 'verify-full',
};

function effectiveTls(options: PoolConfig): false | ConnectionOptions {
  // pg's effective parsed configuration is not exposed by @types/pg.
  return (
    new Client(options) as unknown as {
      connectionParameters: { ssl: false | ConnectionOptions };
    }
  ).connectionParameters.ssl;
}

test('production validation and effective pg options require certificate verification', () => {
  const env = validateEnvironment(production);
  const tls = effectiveTls(
    databaseConnectionOptions({
      environment: env.NODE_ENV,
      url: env.DATABASE_URL,
      sslMode: env.DATABASE_SSL_MODE,
    }),
  );
  assert.ok(tls);
  assert.equal(tls.rejectUnauthorized, true);
  assert.equal(tls.checkServerIdentity, undefined); // retain Node hostname verification
  assert.equal(tls.ca, undefined); // retain Node default trust
});

test('production rejects disabled/unverified modes and defaults', () => {
  for (const mode of ['disable', 'require', undefined]) {
    assert.throws(
      () => validateEnvironment({ ...production, DATABASE_SSL_MODE: mode }),
      /must be verify-full in production/,
    );
  }
});

test('URL overrides are rejected before pg can replace TLS or read certificate files', () => {
  const overrides = [
    'sslmode=disable',
    'sslmode=no-verify',
    'sslmode=require',
    'sslmode=prefer',
    'sslmode=verify-ca',
    'sslmode=verify-full',
    'ssl=0',
    'ssl=false',
    'ssl=true',
    'ssl=no-verify',
    'sslcert=missing',
    'sslkey=missing',
    'sslrootcert=missing',
    'sslnegotiation=direct',
    'uselibpqcompat=true',
    'sslmode=verify-full&sslmode=disable',
    '%73slmode=disable',
    'SSLMODE=disable',
    'tls=anything',
    'host=%2Ftmp',
    'hostaddr=localhost',
    'sslmode=',
  ];
  for (const override of overrides) {
    for (const environment of ['production', 'development', 'test']) {
      assert.throws(
        () =>
          validateEnvironment({
            ...production,
            NODE_ENV: environment,
            DATABASE_URL: `${url}?${override}`,
          }),
        /must not contain TLS or host override/,
      );
    }
  }
  assert.throws(
    () =>
      validateEnvironment({
        ...production,
        DATABASE_URL: 'postgresql://%2Ftmp/cityvue',
      }),
    /TCP host/,
  );
});

test('non-TLS query settings retain verified effective TLS', () => {
  const tls = effectiveTls(
    databaseConnectionOptions({
      environment: 'production',
      url: `${url}?application_name=tls-test`,
      sslMode: 'verify-full',
    }),
  );
  assert.ok(tls);
  assert.equal(tls.rejectUnauthorized, true);
});

test('development/test keep explicit plaintext Docker support but never unverified TLS', () => {
  for (const environment of ['development', 'test']) {
    const env = validateEnvironment({
      NODE_ENV: environment,
      DATABASE_URL: url,
    });
    assert.equal(
      effectiveTls(
        databaseConnectionOptions({
          environment,
          url,
          sslMode: env.DATABASE_SSL_MODE,
        }),
      ),
      false,
    );
    assert.throws(
      () =>
        validateEnvironment({
          NODE_ENV: environment,
          DATABASE_URL: url,
          DATABASE_SSL_MODE: 'require',
        }),
      /unverified TLS is unsupported/,
    );
  }
});

test('CA file is validated, server-only, and retains verification', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cityvue-tls-test-'));
  const caFile = join(directory, 'ca.pem');
  try {
    // Public trust anchor already bundled with Node; no certificate stored in Git.
    assert.ok(rootCertificates[0]);
    writeFileSync(caFile, rootCertificates[0]);
    const env = validateEnvironment({
      ...production,
      DATABASE_SSL_CA_FILE: caFile,
    });
    const tls = effectiveTls(
      databaseConnectionOptions({
        environment: env.NODE_ENV,
        url,
        sslMode: env.DATABASE_SSL_MODE,
        caFile: env.DATABASE_SSL_CA_FILE,
      }),
    );
    assert.ok(tls);
    assert.equal(tls.rejectUnauthorized, true);
    assert.equal(tls.ca, rootCertificates[0]);
    assert.equal(tls.checkServerIdentity, undefined);
    writeFileSync(caFile, 'INVALID_CA_SENTINEL');
    assert.throws(
      () =>
        validateEnvironment({ ...production, DATABASE_SSL_CA_FILE: caFile }),
      /readable PEM CA certificate bundle/,
    );
    assert.throws(
      () =>
        validateEnvironment({
          ...production,
          DATABASE_SSL_CA_FILE: join(directory, 'missing.pem'),
        }),
      /readable PEM CA certificate bundle/,
    );
    assert.throws(
      () =>
        validateEnvironment({
          NODE_ENV: 'test',
          DATABASE_URL: url,
          DATABASE_SSL_CA_FILE: caFile,
        }),
      /requires DATABASE_SSL_MODE=verify-full/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('configuration errors never echo URL credentials or CA contents', () => {
  for (const input of [
    { ...production, DATABASE_URL: 'not-a-url-CREDENTIAL_SENTINEL' },
    {
      ...production,
      DATABASE_URL:
        'postgresql://user:CREDENTIAL_SENTINEL@localhost/db?sslmode=disable',
    },
    { ...production, DATABASE_SSL_CA_FILE: 'CREDENTIAL_SENTINEL' },
  ]) {
    assert.throws(
      () => validateEnvironment(input),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message.includes('CREDENTIAL_SENTINEL'), false);
        return true;
      },
    );
  }
});

test('API pool consumes shared TLS policy and rejects URL overrides', async () => {
  const values: Record<string, unknown> = {
    'app.environment': 'production',
    'database.url': url,
    'database.sslMode': 'verify-full',
    'database.poolMax': 1,
  };
  const config = {
    get: (key: string) => values[key],
  } as unknown as ConfigService<AppConfiguration, true>;
  const logger = {
    logger: {
      error() {
        assert.fail('Unexpected database error in connection-free test');
      },
    },
  } as unknown as PinoLoggerService;
  const service = new DatabaseService(config, logger);
  try {
    const options = (service as unknown as { pool: { options: PoolConfig } })
      .pool.options;
    const tls = effectiveTls(options);
    assert.ok(tls);
    assert.equal(tls.rejectUnauthorized, true);
  } finally {
    await service.onApplicationShutdown();
  }
  values['database.url'] = `${url}?sslmode=disable`;
  assert.throws(
    () => new DatabaseService(config, logger),
    /must not contain TLS or host override/,
  );
});

test('migration CLI rejects unsafe TLS before attempting any connection', () => {
  const script = join(__dirname, '../../src/database/migration-cli.js');
  for (const settings of [
    { DATABASE_SSL_MODE: 'require', DATABASE_URL: url },
    {
      DATABASE_SSL_MODE: 'verify-full',
      DATABASE_URL: `${url}?sslmode=no-verify`,
    },
  ]) {
    const result = spawnSync(process.execPath, [script, 'status'], {
      env: {
        SystemRoot: process.env.SystemRoot,
        NODE_ENV: 'production',
        ...settings,
      },
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid server configuration/);
    assert.doesNotMatch(result.stderr, /ECONNREFUSED/);
  }
});
