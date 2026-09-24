import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { AppConfiguration } from '../config/configuration.js';
import type { StaffAccess } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';
import {
  assertStaffRequestPermission,
  assertStaffRequestRead,
  staffRequestReadScope,
  requestUuid,
} from './staff-request-scope.js';
import {
  participationPeriod,
  participationThreshold,
  suppressParticipation,
} from './participation.domain.js';

@Injectable()
export class ParticipationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService<AppConfiguration, true>,
  ) {}
  async areas(organizationId?: string) {
    const org =
      organizationId ??
      this.config.get('catalog.developmentOrganizationId', { infer: true });
    if (!org) return { collectionEnabled: false, items: [] };
    const organization = await this.database.client
      .selectFrom('organization')
      .select('service_participation_collection_enabled')
      .where('id', '=', org)
      .where('status', '=', 'active')
      .executeTakeFirst();
    if (!organization?.service_participation_collection_enabled)
      return { collectionEnabled: false, items: [] };
    return {
      collectionEnabled: true,
      items: await this.database.client
        .selectFrom('participation_area as area')
        .innerJoin('organization', 'organization.id', 'area.organization_id')
        .select(['area.id', 'area.display_name as label'])
        .where('area.organization_id', '=', org)
        .where('organization.status', '=', 'active')
        .where('area.active', '=', true)
        .orderBy('area.display_order')
        .orderBy('area.display_name')
        .orderBy('area.id')
        .execute(),
    };
  }
  async read(
    access: StaffAccess | undefined,
    startDate: string,
    endDate: string,
    correlation?: string,
  ) {
    assertStaffRequestPermission(
      access,
      'analytics.service_participation.read',
    );
    assertStaffRequestRead(access, 'public');
    const period = participationPeriod(startDate, endDate);
    const threshold = participationThreshold(
      this.config.get('participation', { infer: true })?.suppressionThreshold ??
        5,
    );
    return this.database.client
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (trx) => {
        const buckets = await staffRequestReadScope(trx, access, 'public')
          .select([
            'request.requester_geography_state as state',
            'request.participation_area_id as areaId',
            sql<number>`count(*)::integer`.as('count'),
          ])
          .where(
            sql<boolean>`request.created_at >= ${period.from} and request.created_at < ${period.until}`,
          )
          .groupBy([
            'request.requester_geography_state',
            'request.participation_area_id',
          ])
          .execute();
        // Catalog reveals configured areas only, never existence of inaccessible requests.
        const areas = await trx
          .selectFrom('participation_area')
          .select(['id', 'display_name as label'])
          .where('organization_id', '=', access.organizationId)
          .orderBy('display_order')
          .orderBy('display_name')
          .orderBy('id')
          .execute();
        const countFor = (state: string, id: string | null = null) =>
          buckets.find((b) => b.state === state && b.areaId === id)?.count ?? 0;
        await trx
          .insertInto('service_participation_audit')
          .values({
            organization_id: access.organizationId,
            staff_identity_id: access.staffIdentityId,
            action: 'participation_read',
            start_date: startDate,
            end_date: endDate,
            threshold,
            correlation_id:
              correlation && requestUuid.test(correlation)
                ? correlation
                : randomUUID(),
          })
          .execute();
        return {
          period: { startDate, endDate, timeZone: 'UTC' },
          suppressionThreshold: threshold,
          areas: areas.map((a) => ({
            areaId: a.id,
            label: a.label,
            ...suppressParticipation(countFor('PROVIDED', a.id), threshold),
          })),
          declined: suppressParticipation(countFor('DECLINED'), threshold),
          notCollected: suppressParticipation(
            countFor('NOT_COLLECTED'),
            threshold,
          ),
        };
      });
  }
}
