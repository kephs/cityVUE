import { Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { DatabaseSchema } from '../database/database.types.js';
import { requesterStatus } from './request-tracking.domain.js';

@Injectable()
export class RequestTrackingRepository {
  async state(
    trx: Transaction<DatabaseSchema>,
    organizationId: string,
    requestId: string,
  ) {
    const row = await trx
      .selectFrom('request_tracking_credential')
      .select(['id', 'status'])
      .where('organization_id', '=', organizationId)
      .where('service_request_id', '=', requestId)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirst();
    return { status: row?.status ?? 'not_issued', version: row?.id ?? null };
  }

  async resolve(trx: Transaction<DatabaseSchema>, digest: string) {
    // Lookup supplies the trusted tenant/request pair; no caller-supplied reference or Organization.
    const token = await trx
      .selectFrom('request_tracking_credential as token')
      .innerJoin('service_request as request', (j) =>
        j
          .onRef('request.id', '=', 'token.service_request_id')
          .onRef('request.organization_id', '=', 'token.organization_id'),
      )
      .innerJoin('organization', 'organization.id', 'request.organization_id')
      .select(['token.organization_id', 'token.service_request_id'])
      .where('token.credential_digest', '=', digest)
      .where('token.status', '=', 'active')
      .where('request.audience', '=', 'public')
      .where('organization.status', '=', 'active')
      .executeTakeFirst();
    if (!token) return null;
    // Match management lock order: parent first, credential second. Recheck after locking.
    const parent = await trx
      .selectFrom('service_request as r')
      .innerJoin('organization as o', 'o.id', 'r.organization_id')
      .select('r.id')
      .where('r.organization_id', '=', token.organization_id)
      .where('r.id', '=', token.service_request_id)
      .where('r.audience', '=', 'public')
      .where('o.status', '=', 'active')
      .forShare(['r', 'o'])
      .executeTakeFirst();
    if (!parent) return null;
    const active = await trx
      .selectFrom('request_tracking_credential')
      .select('id')
      .where('organization_id', '=', token.organization_id)
      .where('service_request_id', '=', token.service_request_id)
      .where('credential_digest', '=', digest)
      .where('status', '=', 'active')
      .forShare()
      .executeTakeFirst();
    if (!active) return null;
    const row = await trx
      .selectFrom('service_request as r')
      .innerJoin('service_definition_version as v', (j) =>
        j
          .onRef('v.id', '=', 'r.service_definition_version_id')
          .onRef('v.organization_id', '=', 'r.organization_id'),
      )
      .select([
        'r.reference_number',
        'r.status',
        sql<string>`r.created_at::text`.as('submitted_at'),
        'r.description',
        'v.name',
        'v.icon_key',
        sql<
          string | null
        >`(select nullif(btrim(l.entered_address),'') from location l where l.organization_id=r.organization_id and l.service_request_id=r.id limit 1)`.as(
          'service_location',
        ),
      ])
      .where('r.organization_id', '=', token.organization_id)
      .where('r.id', '=', token.service_request_id)
      .executeTakeFirstOrThrow();
    return {
      reference: row.reference_number,
      issue: { name: row.name, icon: row.icon_key },
      status: requesterStatus(row.status),
      submittedAt: new Date(row.submitted_at).toISOString(),
      serviceLocation: row.service_location,
      description: row.description,
    };
  }
}
