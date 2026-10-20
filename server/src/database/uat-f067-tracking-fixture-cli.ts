/**
 * F067 UAT fixture CLI — disposable databases only.
 *
 * Invoked by the session orchestrator through its effects module, which passes
 * the disposable instance's URL, the nonce it injected through `docker run`
 * and the role the cluster helper created. The nonce and role are required
 * rather than defaulted: without them the fixture cannot prove its
 * destination, and a fixture that cannot prove its destination must not run.
 *
 * Nothing here prints a URL, a password or a credential. The census it writes
 * to stdout is counts only, so the orchestrator can parse it and a session
 * report can quote it safely.
 */
import 'reflect-metadata';
import process from 'node:process';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DatabaseSchema } from './database.types.js';
import { commandFailure } from '../common/logging/log-sanitization.js';
import { provisionTrackingUatFixture } from './uat-f067-tracking-fixture.js';

function required(name: string): string {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`Explicit ${name} is required`);
  return value;
}

async function run(): Promise<void> {
  const url = required('DATABASE_URL');
  const expectedNonce = required('REQRO_F067_UAT_DISPOSABLE_NONCE');
  const expectedRole = required('REQRO_F067_UAT_DISPOSABLE_ROLE');
  const database = new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: url, max: 2 }),
    }),
  });
  try {
    const report = await database.transaction().execute((trx) =>
      provisionTrackingUatFixture(trx, {
        url,
        expectedNonce,
        expectedRole,
      }),
    );
    process.stdout.write(
      `${JSON.stringify({
        changed: report.changed,
        census: report.census,
        references: report.references,
        staffAuthenticated: report.staffAuthenticated,
        credentialsIssued: report.credentialsIssued,
      })}\n`,
    );
  } finally {
    await database.destroy();
  }
}

run().catch((error: unknown) => {
  process.stderr.write(commandFailure('F067 UAT fixture failed', error));
  process.exitCode = 1;
});
