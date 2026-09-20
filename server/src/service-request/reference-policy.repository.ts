import { ConflictException } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { DatabaseSchema } from '../database/database.types.js';
import {
  type ReferencePolicy,
  referencePeriod,
  formatReferenceNumber,
} from './reference-policy.domain.js';
export async function lockReferencePolicy(
  trx: Transaction<DatabaseSchema>,
  organizationId: string,
) {
  await trx
    .insertInto('service_request_reference_config')
    .values({ organization_id: organizationId })
    .onConflict((oc) => oc.column('organization_id').doNothing())
    .execute();
  return trx
    .selectFrom('service_request_reference_config')
    .selectAll()
    .where('organization_id', '=', organizationId)
    .forUpdate()
    .executeTakeFirstOrThrow();
}
export function policyFromRow(row: {
  prefix: string;
  date_component: string;
  sequence_width: number;
  reset_policy: string;
  separator: string;
}): ReferencePolicy {
  return {
    prefix: row.prefix,
    dateComponent: row.date_component,
    sequenceWidth: row.sequence_width,
    resetPolicy: row.reset_policy,
    separator: row.separator,
  };
}
export async function allocateConfiguredReference(
  trx: Transaction<DatabaseSchema>,
  organizationId: string,
  now: Date,
  zone: string,
): Promise<string> {
  const policy = policyFromRow(await lockReferencePolicy(trx, organizationId));
  const period = referencePeriod(policy, now, zone);
  const result = await sql<{
    last_value: string;
  }>`insert into service_request_reference_sequence(organization_id,period_key,last_value)
    values (${organizationId},${period},1)
    on conflict(organization_id,period_key) do update set last_value=service_request_reference_sequence.last_value+1,updated_at=now()
    where service_request_reference_sequence.last_value < 9223372036854775807
    returning last_value`.execute(trx);
  const value = result.rows[0]?.last_value;
  if (!value) throw new ConflictException('Reference capacity exhausted');
  const reference = formatReferenceNumber(policy, period, BigInt(value));
  // Defense against out-of-band imports. Config updates already reject conflicting history.
  if (
    await trx
      .selectFrom('service_request')
      .select('id')
      .where('organization_id', '=', organizationId)
      .where('reference_number', '=', reference)
      .executeTakeFirst()
  )
    throw new ConflictException(
      'Reference configuration requires administrative review',
    );
  return reference;
}
