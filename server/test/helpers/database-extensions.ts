import type { Pool } from 'pg';

/** Shared test-database infrastructure, never owned by a disposable schema. */
export async function prepareDatabaseExtensions(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    // All test files/processes use the same database-scoped transaction lock.
    await client.query('select pg_advisory_xact_lock(20260902, 1)');
    await client.query(
      'create extension if not exists pgcrypto with schema public',
    );
    const result = await client.query<{ schema: string }>(
      `select n.nspname as schema from pg_extension e
       join pg_namespace n on n.oid = e.extnamespace
       where e.extname = 'pgcrypto'`,
    );
    if (result.rows[0]?.schema !== 'public') {
      throw new Error(
        'Test pgcrypto must be installed in the shared public schema',
      );
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
