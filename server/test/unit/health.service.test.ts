import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from '../../src/config/configuration.js';
import type { DatabaseService } from '../../src/database/database.service.js';
import { HealthService } from '../../src/health/health.service.js';

function createConfig(): ConfigService<AppConfiguration, true> {
  return {
    get: (key: string) => {
      if (key === 'app.name') return 'cityvue-api';
      if (key === 'app.version') return '0.1.0';
      throw new Error(`Unexpected key ${key}`);
    },
  } as ConfigService<AppConfiguration, true>;
}

test('health service returns minimal liveness metadata', () => {
  const database = { status: async () => 'up' } as DatabaseService;
  const health = new HealthService(database, createConfig());

  assert.deepEqual(health.live(), {
    status: 'ok',
    service: 'cityvue-api',
    version: '0.1.0',
  });
});

test('health readiness reports an available database', async () => {
  const database = { status: async () => 'up' } as DatabaseService;
  const health = new HealthService(database, createConfig());

  assert.deepEqual(await health.ready(), {
    status: 'ok',
    service: 'cityvue-api',
    version: '0.1.0',
    database: 'up',
  });
});

test('health readiness returns null for an unavailable database', async () => {
  const database = { status: async () => 'down' } as DatabaseService;
  const health = new HealthService(database, createConfig());

  assert.equal(await health.ready(), null);
});
