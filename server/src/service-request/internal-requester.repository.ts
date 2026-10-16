import { Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { RequesterAccess } from '../auth/auth.types.js';
import type { DatabaseSchema } from '../database/database.types.js';
import { communicationEligibility } from './request-communication-policy.js';
import { requesterCommunicationProjection } from './requester-communication.projection.js';
import {
  REQUESTER_UPDATE_PAGE_SIZE,
  requesterStatus,
} from './request-tracking.domain.js';
import { internalRequesterScope } from './internal-requester-scope.js';

/**
 * The newest update the service team addressed to this requester.
 *
 * Deliberately derived from requester-visible correspondence rather than
 * `service_request.updated_at`: that column also moves for internal routing and
 * assignment, so publishing it would let a requester infer staff activity they
 * are not entitled to see. Null when the request has no updates yet.
 */
const lastUpdateAt = sql<string | null>`(
  select max(message.created_at)::text from request_communication message
  where message.organization_id = request.organization_id
    and message.service_request_id = request.id
    and message.direction = 'outbound'
    and message.channel = 'portal'
    and message.delivery_state = 'recorded')`;

const serviceLocation = sql<string | null>`(
  select nullif(btrim(place.entered_address),'') from location place
  where place.organization_id = request.organization_id
    and place.service_request_id = request.id limit 1)`;

@Injectable()
export class InternalRequesterRepository {
  /** Bounded and deterministic. Ordering matches the detail read. */
  async list(
    trx: Transaction<DatabaseSchema>,
    access: RequesterAccess,
    page: number,
    pageSize: number,
  ) {
    const rows = await internalRequesterScope(trx, access)
      .innerJoin('service_definition_version as version', (join) =>
        join
          .onRef('version.id', '=', 'request.service_definition_version_id')
          .onRef('version.organization_id', '=', 'request.organization_id'),
      )
      .select([
        'request.id',
        'request.reference_number',
        'request.status',
        sql<string>`request.created_at::text`.as('submitted_at'),
        'version.name',
        'version.icon_key',
        lastUpdateAt.as('last_update_at'),
        serviceLocation.as('service_location'),
      ])
      .orderBy('request.created_at', 'desc')
      .orderBy('request.id', 'desc')
      .limit(pageSize + 1)
      .offset((page - 1) * pageSize)
      .execute();
    const visible = rows.slice(0, pageSize);
    return {
      items: visible.map((row) => ({
        id: row.id,
        reference: row.reference_number,
        issue: { name: row.name, icon: row.icon_key },
        status: requesterStatus(row.status),
        submittedAt: new Date(row.submitted_at).toISOString(),
        lastUpdateAt: row.last_update_at
          ? new Date(row.last_update_at).toISOString()
          : null,
        serviceLocation: row.service_location,
      })),
      page,
      pageSize,
      hasMore: rows.length > pageSize,
    };
  }

  /** Null when the request does not exist, is not internal, or is not theirs. */
  async detail(
    trx: Transaction<DatabaseSchema>,
    access: RequesterAccess,
    id: string,
  ) {
    const row = await internalRequesterScope(trx, access)
      .innerJoin('service_definition_version as version', (join) =>
        join
          .onRef('version.id', '=', 'request.service_definition_version_id')
          .onRef('version.organization_id', '=', 'request.organization_id'),
      )
      .select([
        'request.id',
        'request.reference_number',
        'request.status',
        'request.description',
        sql<string>`request.created_at::text`.as('submitted_at'),
        'version.name',
        'version.icon_key',
        lastUpdateAt.as('last_update_at'),
        serviceLocation.as('service_location'),
        communicationEligibility().as('eligibility'),
      ])
      .where('request.id', '=', id)
      .forShare(['request', 'organization'])
      .executeTakeFirst();
    if (!row) return null;
    // Re-evaluate the existing eligibility contract at read time rather than
    // trusting that the audience/attribution CHECK constraint still holds. A
    // request that is not eligible for requester-visible correspondence
    // returns no correspondence at all.
    const eligible = ['eligible', 'requester_inactive'].includes(
      row.eligibility,
    );
    const correspondence = eligible
      ? await trx
          .selectFrom('request_communication')
          .select([
            'id',
            'body',
            'direction',
            'channel',
            'delivery_state',
            sql<string>`created_at::text`.as('created_at'),
          ])
          .where('organization_id', '=', access.organizationId)
          .where('service_request_id', '=', row.id)
          .where('direction', '=', 'outbound')
          .where('channel', '=', 'portal')
          .where('delivery_state', '=', 'recorded')
          .orderBy('created_at', 'desc')
          .orderBy('id', 'desc')
          .limit(REQUESTER_UPDATE_PAGE_SIZE)
          .execute()
      : [];
    return {
      id: row.id,
      reference: row.reference_number,
      issue: { name: row.name, icon: row.icon_key },
      status: requesterStatus(row.status),
      submittedAt: new Date(row.submitted_at).toISOString(),
      lastUpdateAt: row.last_update_at
        ? new Date(row.last_update_at).toISOString()
        : null,
      serviceLocation: row.service_location,
      description: row.description,
      updates: correspondence.map((message) =>
        requesterCommunicationProjection({
          id: message.id,
          body: message.body,
          createdAt: new Date(message.created_at).toISOString(),
          direction: message.direction,
          channel: message.channel,
          deliveryState: message.delivery_state,
        }),
      ),
    };
  }
}
