import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../../src/database/database.types.js';

/**
 * Applies the Migration 48 tenant-domain function hardening inside a
 * disposable per-test schema.
 *
 * ADR-027 F060.3C-2c-2 qualifies every application object in those functions
 * as `public.*`, which is correct for the deployment where the application
 * schema is `public`. Every database suite here instead runs in an isolated
 * schema, so the migration SQL is applied with `public.` rewritten to that
 * schema. The security property the hardening provides — qualified references
 * plus a pinned function-local `search_path`, so `pg_temp` cannot redirect
 * relation or composite-type resolution — does not depend on the schema's
 * name.
 *
 * What this rewrite deliberately does **not** prove is the literal `public`
 * spelling, or anything about production privileges. Those are asserted
 * separately against the migration source, and the real privilege proof
 * belongs to F060.3C-2c-3.
 *
 * Every operator path calls the Organization lock helper, so any suite that
 * exercises `tenant-domain.operations.ts` must apply this after its own
 * migrations or the helper will not exist.
 */
const MIGRATION = '20261018000000-harden-tenant-domain-functions.ts';

async function hardeningSql(
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
    throw new Error(`Migration 48 ${section}() body not found`);
  return body.replace(/\bpublic\./g, `${schema}.`);
}

export async function applyFunctionHardening(
  database: Kysely<DatabaseSchema>,
  schema: string,
): Promise<void> {
  await sql.raw(await hardeningSql(schema, 'up')).execute(database);
}

export async function rollbackFunctionHardening(
  database: Kysely<DatabaseSchema>,
  schema: string,
): Promise<void> {
  await sql.raw(await hardeningSql(schema, 'down')).execute(database);
}
