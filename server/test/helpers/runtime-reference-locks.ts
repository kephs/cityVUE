import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../../src/database/database.types.js';

/**
 * Applies the Migration 49 runtime reference-lock helpers inside a disposable
 * per-test schema.
 *
 * ADR-027 F060.3C-2d qualifies every application object in those functions as
 * `public.*`, which is correct for the deployment where the application schema
 * is `public`. Database suites here run in an isolated schema instead, so the
 * migration SQL is applied with `public.` rewritten to that schema. The
 * security property the helpers provide — an owner-owned `SECURITY DEFINER`
 * lock with a pinned `search_path` — does not depend on the schema's name, and
 * the literal `public` spelling is asserted separately.
 *
 * Any suite that exercises a converted call site must apply this after its own
 * migrations, or the helper will not exist and the path will fail with
 * `function lock_... does not exist`. This mirrors
 * `applyFunctionHardening` for Migration 48, and exists for the same reason:
 * migrations are compiled into the test output only when a test imports them
 * statically, and Migration 49 is applied as text rather than imported.
 */
const MIGRATION = '20261019000000-harden-runtime-reference-locks.ts';

async function referenceLockSql(
  schema: string,
  section: 'up' | 'down',
): Promise<string> {
  // The TypeScript source, not the compiled output: this reads the migration's
  // SQL text to rewrite it. From dist-test/test/helpers that is three levels
  // up, where the compiled migrations are only two.
  const source = await readFile(
    path.resolve(__dirname, '../../../migrations', MIGRATION),
    'utf8',
  );
  const pattern = new RegExp(
    `export async function ${section}[\\s\\S]*?await sql\`([\\s\\S]*?)\`\\.execute`,
  );
  const body = pattern.exec(source)?.[1];
  if (body === undefined)
    throw new Error(`Migration 49 ${section}() body not found`);
  return body.replace(/\bpublic\./g, `${schema}.`);
}

/** The marker that separates the lock helpers from the access-revision
 * hardening inside Migration 49's `up()`. */
const REVISION_SECTION = '-- The revision pair, hardened.';

/**
 * Applies only the seven lock helpers and the Category identity invariant.
 *
 * Deliberately NOT the access-revision pair. Migration 49 hardens those with
 * `create or replace`, so applying the whole migration into a schema that has
 * not yet run migration 20261008 would CREATE them, and that migration's own
 * plain `create function` would then fail with "already exists with same
 * argument types". Several suites build a truncated schema, so the two parts
 * are applied independently.
 */
export async function applyRuntimeReferenceLocks(
  database: Kysely<DatabaseSchema>,
  schema: string,
): Promise<void> {
  const body = await referenceLockSql(schema, 'up');
  const at = body.indexOf(REVISION_SECTION);
  if (at < 0) throw new Error('Migration 49 revision section marker not found');
  await sql.raw(body.slice(0, at)).execute(database);
}

/** Applies only the access-revision hardening. Requires migration 20261008 to
 * have run already, because it replaces the functions that migration creates. */
export async function applyAccessRevisionHardening(
  database: Kysely<DatabaseSchema>,
  schema: string,
): Promise<void> {
  const body = await referenceLockSql(schema, 'up');
  const at = body.indexOf(REVISION_SECTION);
  if (at < 0) throw new Error('Migration 49 revision section marker not found');
  await sql.raw(body.slice(at)).execute(database);
}

export async function rollbackRuntimeReferenceLocks(
  database: Kysely<DatabaseSchema>,
  schema: string,
): Promise<void> {
  await sql.raw(await referenceLockSql(schema, 'down')).execute(database);
}
