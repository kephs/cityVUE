import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`alter table service_definition_version add column geographic_eligibility_policy_reference varchar(200), add column unable_to_determine_behavior varchar(30) not null default 'block' check (unable_to_determine_behavior in ('block'));
    alter table location add column eligibility_policy_type varchar(40), add column eligibility_policy_reference varchar(200), add column eligibility_provider_key varchar(100), add column eligibility_provider_reference varchar(200), add column eligibility_reason_code varchar(100);
    alter table location add constraint location_eligibility_snapshot_consistency check ((eligibility_result is null and eligibility_policy_type is null and eligibility_provider_key is null and eligibility_reason_code is null and validated_at is null) or (eligibility_result is not null and eligibility_policy_type is not null and eligibility_provider_key is not null and eligibility_reason_code is not null and validated_at is not null));`.execute(
    db,
  );
}
export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`alter table location drop constraint if exists location_eligibility_snapshot_consistency, drop column if exists eligibility_reason_code, drop column if exists eligibility_provider_reference, drop column if exists eligibility_provider_key, drop column if exists eligibility_policy_reference, drop column if exists eligibility_policy_type;
    alter table service_definition_version drop column if exists unable_to_determine_behavior, drop column if exists geographic_eligibility_policy_reference;`.execute(
    db,
  );
}
