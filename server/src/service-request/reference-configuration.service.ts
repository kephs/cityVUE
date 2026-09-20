import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { StaffAccess } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';
import type { DatabaseSchema } from '../database/database.types.js';
import type { ReferenceConfigurationDto } from './reference-configuration.controller.js';
import {
  defaultReferencePolicy,
  historicalComponents,
  referencePeriod,
  formatReferenceNumber,
  validateReferencePolicy,
  type ReferencePolicy,
} from './reference-policy.domain.js';
import {
  lockReferencePolicy,
  policyFromRow,
} from './reference-policy.repository.js';
@Injectable()
export class ReferenceConfigurationService {
  constructor(private readonly database: DatabaseService) {}
  private async authorize(
    trx: Transaction<DatabaseSchema>,
    access: StaffAccess | undefined,
  ) {
    if (
      !access ||
      access.development ||
      !access.tenantId ||
      !access.objectId ||
      !access.permissions.includes('service_request.reference.manage') ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        access.organizationId,
      )
    )
      throw new ForbiddenException('Access denied');
    const org = await trx
      .selectFrom('organization')
      .select(['id', 'default_business_timezone'])
      .where('id', '=', access.organizationId)
      .where('status', '=', 'active')
      .forShare()
      .executeTakeFirst();
    if (!org) throw new ForbiddenException('Access denied');
    return org;
  }
  private receipt(
    policy: ReferencePolicy,
    revision: number,
    zone: string,
    now: Date,
  ) {
    return {
      ...policy,
      revision,
      exampleReference: formatReferenceNumber(
        policy,
        referencePeriod(policy, now, zone),
        1n,
      ),
    };
  }
  async get(access: StaffAccess | undefined, now = new Date()) {
    return this.database.client.transaction().execute(async (trx) => {
      const org = await this.authorize(trx, access);
      const row = await trx
        .selectFrom('service_request_reference_config')
        .selectAll()
        .where('organization_id', '=', org.id)
        .executeTakeFirst();
      return this.receipt(
        row ? policyFromRow(row) : defaultReferencePolicy,
        row?.revision ?? 1,
        org.default_business_timezone,
        now,
      );
    });
  }
  async set(
    input: ReferenceConfigurationDto,
    access: StaffAccess | undefined,
    now = new Date(),
  ) {
    return this.database.client.transaction().execute(async (trx) => {
      const org = await this.authorize(trx, access);
      const policy = validateReferencePolicy(input);
      const row = await lockReferencePolicy(trx, org.id);
      if (row.revision !== input.expectedRevision)
        throw new ConflictException(
          'Reference configuration changed; refresh before retrying',
        );
      // Administrative changes may inspect historical data; normal allocation never scans it.
      const counters = await trx
        .selectFrom('service_request_reference_sequence')
        .select(['period_key', 'last_value'])
        .where('organization_id', '=', org.id)
        .execute();
      const byPeriod = new Map(
        counters.map((c) => [c.period_key, BigInt(c.last_value)]),
      );
      let cursor: string | undefined;
      for (;;) {
        let query = trx
          .selectFrom('service_request')
          .select(['id', 'reference_number'])
          .where('organization_id', '=', org.id)
          .orderBy('id')
          .limit(500);
        if (cursor) query = query.where('id', '>', cursor);
        const history = await query.execute();
        for (const historical of history) {
          const match = historicalComponents(
            policy,
            historical.reference_number,
          );
          if (match && match.value > (byPeriod.get(match.period) ?? 0n))
            throw new BadRequestException(
              'Reference configuration conflicts with issued references',
            );
        }
        if (history.length < 500) break;
        cursor = history.at(-1)?.id;
        if (!cursor)
          throw new Error('Historical reference page missing cursor');
      }
      await trx
        .updateTable('service_request_reference_config')
        .set({
          prefix: policy.prefix,
          date_component: policy.dateComponent,
          sequence_width: policy.sequenceWidth,
          reset_policy: policy.resetPolicy,
          separator: policy.separator,
          revision: row.revision + 1,
          updated_at: sql`now()`,
        })
        .where('organization_id', '=', org.id)
        .execute();
      return this.receipt(
        policy,
        row.revision + 1,
        org.default_business_timezone,
        now,
      );
    });
  }
}
