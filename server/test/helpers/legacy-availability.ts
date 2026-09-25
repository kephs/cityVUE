import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../../src/database/database.types.js';

/** Older suites deliberately exercise historical migration stages. Supply their
 * explicit dual-context fixture policy until the full F056.2B migration is tested.
 * This is test-only scaffolding, never a production default or runtime fallback. */
export async function legacyAvailabilityFixture(db: Kysely<DatabaseSchema>) {
  await sql`alter table service_definition add column availability text not null default 'INTERNAL_AND_EXTERNAL'`.execute(
    db,
  );
}
