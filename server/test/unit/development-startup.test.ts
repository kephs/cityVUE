import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('configured development compiler initializes the complete Nest application', () => {
  const root = path.resolve(__dirname, '../../..');
  const manifest = JSON.parse(
    readFileSync(path.join(root, 'package.json'), 'utf8'),
  ) as { scripts: { dev: string } };
  const [runtime, script, ...args] = manifest.scripts.dev.split(' ');
  assert.equal(runtime, 'node');
  assert.ok(script);
  // Isolate dotenv discovery and supply fictional settings; no DB connection,
  // real identity, listening port, or long-running watch process is needed.
  const cwd = mkdtempSync(path.join(tmpdir(), 'cityvue-dev-startup-'));
  try {
    const result = spawnSync(
      process.execPath,
      [path.join(root, script), ...args, '--check'],
      {
        cwd,
        encoding: 'utf8',
        timeout: 60000,
        env: {
          PATH: process.env.PATH ?? '',
          SYSTEMROOT: process.env.SYSTEMROOT ?? '',
          NODE_ENV: 'test',
          CITYVUE_DEPLOYMENT_PROFILE: 'development',
          DATABASE_URL: 'postgresql://example:placeholder@localhost/test',
          LOG_LEVEL: 'silent',
        },
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /Development application initialization passed/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
