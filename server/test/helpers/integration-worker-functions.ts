import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../../src/database/database.types.js';

/**
 * Applies the Migration 53 integration worker function API inside a
 * disposable per-test schema.
 *
 * F062.2D-1 §9 requires a `SECURITY DEFINER` function to qualify every
 * application object and to pin its `search_path`. The reviewed F062.2D-2B
 * contract is `pg_catalog, public, pg_temp`: `pg_catalog` **first**, so nothing
 * can shadow a built-in; the trusted application schema `public` **second**,
 * so the accepted F062.2C and F062.2D-2A trigger guards still resolve while
 * running inside these definer functions; and `pg_temp` **last**, so a
 * session-local decoy relation is never resolved first. **`public` is safe in
 * a definer path only while effective `CREATE` on it remains denied to every
 * untrusted execution principal**, which
 * `test/database/database-role-separation.integration.test.ts` proves for
 * `PUBLIC`, the runtime, the operator, the function owner and the migration
 * login without an explicit privileged `SET ROLE`. The pin therefore names the
 * deployment's schema literally, and it spells `public`.
 *
 * Database suites here run in an isolated schema instead, so the migration
 * SQL is applied with `public.` rewritten to that schema and the fixed
 * `reqro_integration_api` namespace rewritten to a per-schema one, which also
 * keeps concurrent suites from colliding on a single global namespace.
 *
 * The security properties do not depend on either name: the rewrite
 * substitutes only the application schema's *name*, so **this helper
 * preserves the reviewed function `search_path` contract** — `pg_catalog`
 * still first, the trusted application schema still second, `pg_temp` still
 * last — together with the qualification itself, the definer declaration and
 * the `PUBLIC` revoke. **The literal `public.` spelling and the literal
 * `reqro_integration_api` name are asserted separately**, against the
 * migration source, in
 * `test/unit/worker-function-api-contract.test.ts`.
 *
 * This mirrors `runtime-reference-locks.ts` for Migration 49 and exists for
 * the same reason: migrations are compiled into the test output only when a
 * test imports them statically, and a migration that hardcodes `public.` must
 * be applied as text rather than imported.
 *
 * The `reqro_integration_function_owner` role is absent in this harness, so
 * the migration's ownership path is skipped and the functions belong to the
 * test role. Ownership, the membership edge and the privilege ceiling are
 * proven where they are real, on a provisioned PostgreSQL 17 cluster, by
 * `database-role-separation.integration.test.ts`.
 */
const MIGRATION = '20261023000000-add-integration-worker-function-api.ts';
/** F062.2D-2C-3A. Migration 56 hardcodes `public.` for the same reason
 * Migration 53 does, so it is applied as text through the same rewrite. */
const HARDENING =
  '20261026000000-harden-integration-worker-claim-dispatch-api.ts';

/** The per-schema replacement for the fixed deployment namespace. Kept short
 * because PostgreSQL identifiers are limited to 63 bytes. */
export function workerApiSchema(schema: string): string {
  return `${schema}_api`;
}

/**
 * The migration's SQL text, rewritten for a disposable schema.
 *
 * Exported so a test can assert against what is actually executed rather than
 * only against the source.
 */
export async function workerFunctionSql(
  schema: string,
  section: 'up' | 'down',
): Promise<string> {
  return rewritten(MIGRATION, schema, section);
}

/**
 * F062.2D-2C-3A. Migration 56's SQL text, rewritten for a disposable schema.
 *
 * Exported for the same reason as `workerFunctionSql`: a test can then assert
 * against what is actually executed rather than only against the source.
 */
export async function workerHardeningSql(
  schema: string,
  section: 'up' | 'down',
): Promise<string> {
  return rewritten(HARDENING, schema, section);
}

async function rewritten(
  file: string,
  schema: string,
  section: 'up' | 'down',
): Promise<string> {
  // The TypeScript source, not the compiled output: this reads the migration's
  // SQL text to rewrite it. From dist-test/test/helpers that is three levels
  // up, where the compiled migrations are only two.
  const source = await readFile(
    path.resolve(__dirname, '../../../migrations', file),
    'utf8',
  );
  const pattern = new RegExp(
    `export async function ${section}[\\s\\S]*?await sql\`([\\s\\S]*?)\`\\.execute`,
  );
  const body = pattern.exec(source)?.[1];
  if (body === undefined)
    throw new Error(`${file} ${section}() body not found`);
  return (
    body
      .replace(/\breqro_integration_api\b/g, workerApiSchema(schema))
      // The pinned path's application-schema entry. It is there so the nested
      // F062.2C and F062.2D-2A integrity guards can resolve their deliberately
      // unqualified references; see the migration header. `pg_catalog` stays
      // first and `pg_temp` stays last, which is what the decoy test proves.
      .replace(
        /search_path = pg_catalog, public, pg_temp/g,
        `search_path = pg_catalog, ${schema}, pg_temp`,
      )
      .replace(/\bpublic\./g, `${schema}.`)
  );
}

/** Applies `up()`. Requires Migration 52 to have run in the same schema. */
export async function applyIntegrationWorkerFunctions(
  database: Kysely<DatabaseSchema>,
  schema: string,
): Promise<void> {
  await sql.raw(await workerFunctionSql(schema, 'up')).execute(database);
}

/** Applies `down()`, including its refusal while an unsettled claim exists. */
export async function rollbackIntegrationWorkerFunctions(
  database: Kysely<DatabaseSchema>,
  schema: string,
): Promise<void> {
  await sql.raw(await workerFunctionSql(schema, 'down')).execute(database);
}

/** F062.2D-2C-3A. Applies Migration 56's `up()`. Requires Migrations 53, 54
 * and 55 to have run in the same schema. */
export async function applyIntegrationWorkerHardening(
  database: Kysely<DatabaseSchema>,
  schema: string,
): Promise<void> {
  await sql.raw(await workerHardeningSql(schema, 'up')).execute(database);
}

/** F062.2D-2C-3A. Applies Migration 56's `down()`, restoring the Migration 53
 * claim function verbatim and removing the dispatch marker. */
export async function rollbackIntegrationWorkerHardening(
  database: Kysely<DatabaseSchema>,
  schema: string,
): Promise<void> {
  await sql.raw(await workerHardeningSql(schema, 'down')).execute(database);
}
