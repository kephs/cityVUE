import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import { applyFunctionHardening } from './tenant-domain-hardening.js';
import {
  applyRuntimeReferenceLocks,
  applyAccessRevisionHardening,
} from './runtime-reference-locks.js';
import {
  applyIntegrationWorkerFunctions,
  applyIntegrationWorkerHardening,
} from './integration-worker-functions.js';
import { registrySchemaNames } from './registry-schema-lifecycle.js';

export const registryRewrittenMigrations = [
  '20261018000000-harden-tenant-domain-functions',
  '20261019000000-harden-runtime-reference-locks',
  '20261023000000-add-integration-worker-function-api',
  '20261026000000-harden-integration-worker-claim-dispatch-api',
] as const;
export interface RegistryMigrationStep {
  name: string;
  mode: 'compiled' | 'rewritten';
}
/** Source inventory determines completeness; compiled output alone omits text-applied migrations. */
export function registryMigrationPlan(
  source: readonly string[],
  compiled: readonly string[],
): RegistryMigrationStep[] {
  const names = source
    .map((file) => {
      if (!/^[0-9]{14}-[a-z0-9-]+\.ts$/.test(file))
        throw new Error('Malformed migration source inventory');
      return file.slice(0, -3);
    })
    .sort();
  if (!names.length || new Set(names).size !== names.length)
    throw new Error('Incomplete or duplicate migration source inventory');
  for (const name of registryRewrittenMigrations)
    if (!names.includes(name))
      throw new Error('Required rewritten migration missing');
  if (
    new Set(compiled).size !== compiled.length ||
    compiled.some(
      (file) => !file.endsWith('.js') || !names.includes(file.slice(0, -3)),
    )
  )
    throw new Error('Malformed or stale compiled migration inventory');
  return names.map((name) => {
    const rewritten = (
      registryRewrittenMigrations as readonly string[]
    ).includes(name);
    if (!rewritten && !compiled.includes(name + '.js'))
      throw new Error('Required compiled migration missing: ' + name);
    return { name, mode: rewritten ? 'rewritten' : 'compiled' };
  });
}
export function assertRegistryMigrationCompletion(
  plan: readonly RegistryMigrationStep[],
  applied: readonly string[],
) {
  if (
    !plan.length ||
    plan.length !== applied.length ||
    new Set(applied).size !== applied.length ||
    plan.some((step, i) => step.name !== applied[i])
  )
    throw new Error(
      'Registry migration execution receipt is incomplete or malformed',
    );
}
export async function applyRegistryMigrations(
  database: Kysely<DatabaseSchema>,
  schema: string,
): Promise<string[]> {
  registrySchemaNames(schema);
  const sourceFolder = path.resolve(__dirname, '../../../migrations');
  const compiledFolder = path.resolve(__dirname, '../../migrations');
  const plan = registryMigrationPlan(
    (await readdir(sourceFolder)).filter((f) => f.endsWith('.ts')),
    (await readdir(compiledFolder)).filter((f) => f.endsWith('.js')),
  );
  const applied: string[] = [];
  for (const step of plan) {
    await database.transaction().execute(async (trx) => {
      switch (step.name) {
        case registryRewrittenMigrations[0]:
          await applyFunctionHardening(trx, schema);
          break;
        case registryRewrittenMigrations[1]:
          await applyRuntimeReferenceLocks(trx, schema);
          await applyAccessRevisionHardening(trx, schema);
          break;
        case registryRewrittenMigrations[2]:
          await applyIntegrationWorkerFunctions(trx, schema);
          break;
        case registryRewrittenMigrations[3]:
          await applyIntegrationWorkerHardening(trx, schema);
          break;
        default: {
          const migration = (await import(
            pathToFileURL(path.join(compiledFolder, step.name + '.js')).href
          )) as { up: (db: Kysely<DatabaseSchema>) => Promise<void> };
          await migration.up(trx);
        }
      }
    });
    // Recorded only after the transaction commits; no fabricated kysely_migration history.
    applied.push(step.name);
  }
  assertRegistryMigrationCompletion(plan, applied);
  return applied;
}
