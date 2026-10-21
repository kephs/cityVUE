import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import { workerApiSchema } from './integration-worker-functions.js';

export interface RegistrySchemaFact {
  name: string;
  oid: string;
  owner: string;
}
export interface RegistrySchemaReceipt {
  schema: string;
  owned: RegistrySchemaFact[];
}
export function registrySchemaNames(schema: string): [string, string] {
  if (!/^registry_e2e_[a-f0-9]{32}$/.test(schema))
    throw new Error('Invalid registry fixture schema');
  return [schema, workerApiSchema(schema)];
}
export function registryInventory(value: unknown): RegistrySchemaFact[] {
  if (!Array.isArray(value))
    throw new Error('Registry schema inventory missing or unreadable');
  const rows: RegistrySchemaFact[] = [];
  for (const item of value as unknown[]) {
    if (
      typeof item !== 'object' ||
      item === null ||
      !('name' in item) ||
      typeof item.name !== 'string' ||
      !item.name ||
      !('oid' in item) ||
      typeof item.oid !== 'string' ||
      !/^[1-9][0-9]*$/.test(item.oid) ||
      !('owner' in item) ||
      item.owner !== 'reqro_test_user'
    )
      throw new Error(
        'Malformed registry schema inventory or unexpected owner',
      );
    rows.push({ name: item.name, oid: item.oid, owner: item.owner });
  }
  if (
    new Set(rows.map((r) => r.name)).size !== rows.length ||
    new Set(rows.map((r) => r.oid)).size !== rows.length
  )
    throw new Error('Ambiguous registry schema inventory');
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
/** A successful CREATE SCHEMA transaction is the receipt; a familiar name or migration file is not evidence. */
export function registryCleanupTargets(
  receipt: RegistrySchemaReceipt,
  live: unknown,
): string[] {
  const names = registrySchemaNames(receipt.schema);
  const owned = registryInventory(receipt.owned),
    current = registryInventory(live);
  if (owned.length !== 2 || owned.some((r) => !names.includes(r.name)))
    throw new Error('Incomplete registry schema creation receipt');
  if (JSON.stringify(owned) !== JSON.stringify(current))
    throw new Error(
      'Registry schema ownership changed or unexpected schemas remain',
    );
  return [names[1], names[0]];
}
export async function registrySchemaInventory(db: Kysely<DatabaseSchema>) {
  const result =
    await sql<RegistrySchemaFact>`select nspname as name,oid::text as oid,pg_get_userbyid(nspowner) as owner from pg_namespace where nspname !~ '^pg_' and nspname not in ('public','information_schema') order by nspname`.execute(
      db,
    );
  return registryInventory(result.rows);
}
export async function createRegistrySchemas(
  db: Kysely<DatabaseSchema>,
  schema: string,
): Promise<RegistrySchemaReceipt> {
  const names = registrySchemaNames(schema);
  return db.transaction().execute(async (trx) => {
    if ((await registrySchemaInventory(trx)).length)
      throw new Error(
        'Registry fixture requires a clean schema baseline; existing schemas cannot be adopted',
      );
    // No IF NOT EXISTS: a collision rolls back both creations, never adopts an existing schema.
    for (const name of names)
      await sql`create schema ${sql.id(name)}`.execute(trx);
    const receipt = { schema, owned: await registrySchemaInventory(trx) };
    registryCleanupTargets(receipt, receipt.owned);
    return receipt;
  });
}
export async function cleanupRegistrySchemas(
  db: Kysely<DatabaseSchema>,
  receipt: RegistrySchemaReceipt,
) {
  await db.transaction().execute(async (trx) => {
    const targets = registryCleanupTargets(
      receipt,
      await registrySchemaInventory(trx),
    );
    // Only the two uniquely created and still identity-matching fixture namespaces.
    // All hardcoded-schema migrations are rewritten into this pair before execution.
    for (const name of targets)
      await sql`drop schema ${sql.id(name)} cascade`.execute(trx);
    if ((await registrySchemaInventory(trx)).length)
      throw new Error('Registry schema cleanup was incomplete');
  });
}
