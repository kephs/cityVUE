import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import { provisionAccessReader } from '../../src/access/access-foundation.js';

test('Reader selection rejects malformed references and state before database access', async () => {
  const valid = {
    organizationId: '10000000-0000-4000-8000-000000000001',
    staffId: '10000000-0000-4000-8000-000000000002',
    expectedRevision: '0',
    expectedBootstrap: false,
    operation: 'grant-reader' as const,
    dryRun: true,
  };
  for (const override of [
    { organizationId: 'invalid' },
    { staffId: 'invalid' },
    { expectedRevision: '-1' },
    { expectedRevision: '1.5' },
  ])
    await assert.rejects(
      provisionAccessReader({} as Kysely<DatabaseSchema>, {
        ...valid,
        ...override,
      }),
      /Invalid explicit Reader selection/,
    );
});
test('Personal Reader opt-in cannot authorize manager provisioning', () => {
  const result = spawnSync(
    process.execPath,
    [
      path.resolve(__dirname, '../../src/database/access-administrator-cli.js'),
      'bootstrap',
      '--confirm',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'development',
        CITYVUE_DEPLOYMENT_PROFILE: 'development',
        F057_PERSONAL_READER_UAT: 'true',
        F057_SYNTHETIC_ONLY: 'false',
        DATABASE_URL: 'PRIVATE_SENTINEL',
      },
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Access provisioning failed/);
  assert.ok(!result.stderr.includes('PRIVATE_SENTINEL'));
});
test('Reader CLI requires explicit local opt-in and sanitizes rejection', () => {
  for (const operation of ['grant-reader', 'remove-reader']) {
    const result = spawnSync(
      process.execPath,
      [
        path.resolve(
          __dirname,
          '../../src/database/access-administrator-cli.js',
        ),
        operation,
        '--confirm',
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: 'production',
          F057_PERSONAL_READER_UAT: 'true',
          DATABASE_URL: 'PRIVATE_SENTINEL',
        },
      },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.ok(!result.stderr.includes('PRIVATE_SENTINEL'));
  }
});
