/**
 * F067 disposable staff identity binding CLI — disposable databases only.
 *
 * Invoked by the session orchestrator through its effects module, never by
 * application startup. `--plan` reads and reports; `--confirm` may write, and
 * only when `REQRO_F067_UAT_BIND_AUTHORIZED` is exactly 'true', which is
 * checked before any connection is opened. The session's own authorization
 * switch is deliberately not sufficient.
 *
 * The Entra tenant and object ID arrive on stdin as one JSON object, so they
 * never appear in a command line, a shell history or a persistent environment
 * file. The expected tenant comes from the API's own `ENTRA_TENANT_ID`, and the
 * expected migrations from the session record. Output is masked identifiers
 * and an action only; errors go through the sanitizer.
 */
import 'reflect-metadata';
import process from 'node:process';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DatabaseSchema } from './database.types.js';
import { commandFailure } from '../common/logging/log-sanitization.js';
import {
  createBindingStore,
  executeIdentityBinding,
  type BindingMode,
} from './uat-f067-identity-binding.js';

const BIND_AUTHORIZATION = 'REQRO_F067_UAT_BIND_AUTHORIZED';

function required(name: string): string {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`Explicit ${name} is required`);
  return value;
}

/** The mode, or null. Exactly one flag; anything else is refused. */
function readMode(argv: readonly string[]): BindingMode | null {
  if (argv.length !== 1) return null;
  if (argv[0] === '--plan') return 'plan';
  if (argv[0] === '--confirm') return 'confirm';
  return null;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin as AsyncIterable<Buffer | string>)
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function run(): Promise<void> {
  const mode = readMode(process.argv.slice(2));
  if (mode === null) {
    process.stderr.write('usage: --plan | --confirm\n');
    process.exitCode = 2;
    return;
  }
  if (mode === 'confirm' && process.env[BIND_AUTHORIZATION] !== 'true') {
    process.stderr.write(
      `--confirm requires ${BIND_AUTHORIZATION}=true; nothing was read or written\n`,
    );
    process.exitCode = 3;
    return;
  }
  const url = required('DATABASE_URL');
  const expectedNonce = required('REQRO_F067_UAT_DISPOSABLE_NONCE');
  const expectedRole = required('REQRO_F067_UAT_DISPOSABLE_ROLE');
  const expectedTenantId = required('ENTRA_TENANT_ID');
  const migrations: unknown = JSON.parse(
    required('REQRO_F067_UAT_EXPECTED_MIGRATIONS'),
  );
  if (
    !Array.isArray(migrations) ||
    !migrations.every((name) => typeof name === 'string')
  )
    throw new Error('The expected migration inventory is malformed');
  const input: unknown = JSON.parse(await readStdin());
  const identity =
    input !== null && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : {};

  const database = new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: url, max: 1 }),
    }),
  });
  try {
    const report = await database.transaction().execute((trx) =>
      executeIdentityBinding(
        createBindingStore(trx, { url, expectedNonce, expectedRole }),
        {
          mode,
          tenantId: identity.tenantId,
          objectId: identity.objectId,
          expectedTenantId,
          expectedMigrations: migrations,
        },
      ),
    );
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally {
    await database.destroy();
  }
}

run().catch((error: unknown) => {
  // A refusal is a fixed sentence this module wrote, carrying no identifier,
  // so the operator sees why. Anything else goes through the sanitizer.
  const message = error instanceof Error ? error.message : '';
  process.stderr.write(
    /^Binding (target |identity )?refused: /.test(message)
      ? `${JSON.stringify({ refused: message })}\n`
      : commandFailure('F067 identity binding failed', error),
  );
  process.exitCode = 1;
});
