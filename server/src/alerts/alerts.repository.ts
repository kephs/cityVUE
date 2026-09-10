import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class AlertsRepository {
  constructor(private readonly database: DatabaseService) {}
  listActive(organizationId: string, now: Date) {
    return this.database.client
      .selectFrom('resident_alert')
      .select([
        'id',
        'type',
        'severity',
        'title',
        'message',
        'link_url',
        'link_label',
        'starts_at',
        'expires_at',
        'published_at',
        'updated_at',
      ])
      .where('organization_id', '=', organizationId)
      .where('is_active', '=', true)
      .where('deactivated_at', 'is', null)
      .where('published_at', '<=', now)
      .where('starts_at', '<=', now)
      .where((eb) =>
        eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', now)]),
      )
      .orderBy(
        sql<number>`case severity when 'critical' then 0 when 'warning' then 1 when 'advisory' then 2 else 3 end`,
      )
      .orderBy('published_at', 'desc')
      .orderBy('id')
      .execute();
  }
}
