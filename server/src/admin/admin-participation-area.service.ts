import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Selectable, Transaction } from 'kysely';
import type { StaffAccess } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';
import type { DatabaseSchema } from '../database/database.types.js';
import { requestUuid } from '../service-request/staff-request-scope.js';
import {
  areaName,
  assertAreaWrite,
  validateAreaChange,
  type AreaChange,
} from './admin-participation-area.domain.js';

type Area = Selectable<DatabaseSchema['participation_area']>;
const projection = (a: Area) => ({
  id: a.id,
  name: a.display_name,
  active: a.active,
  displayOrder: a.display_order,
  revision: a.revision,
});
const conflict = () =>
  new ConflictException(
    'This Participation Area changed. Refresh the latest configuration before trying again.',
  );

@Injectable()
export class AdminParticipationAreaService {
  constructor(private readonly database: DatabaseService) {}

  // Same Organization-first lock order as F053/intake. Serializes the final-active
  // invariant and create ordering, but does not create global revision conflicts.
  private async lock(trx: Transaction<DatabaseSchema>, org: string) {
    const row = await trx
      .selectFrom('organization')
      .select('service_participation_collection_enabled')
      .where('id', '=', org)
      .where('status', '=', 'active')
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw new ForbiddenException('Access denied');
    return row;
  }
  private async audit(
    trx: Transaction<DatabaseSchema>,
    access: StaffAccess,
    old: Area | null,
    row: Area,
    action: DatabaseSchema['participation_area_audit']['action'],
    correlation?: string,
  ) {
    await trx
      .insertInto('participation_area_audit')
      .values({
        organization_id: access.organizationId,
        staff_identity_id: access.staffIdentityId,
        area_id: row.id,
        action,
        prior_name: old?.display_name ?? null,
        name: row.display_name,
        prior_active: old?.active ?? null,
        active: row.active,
        prior_display_order: old?.display_order ?? null,
        display_order: row.display_order,
        prior_revision: old?.revision ?? null,
        revision: row.revision,
        correlation_id:
          correlation && requestUuid.test(correlation)
            ? correlation
            : randomUUID(),
      })
      .execute();
  }
  private duplicate(error: unknown): never {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === '23505' &&
      'constraint' in error &&
      [
        'participation_area_name_unique',
        'participation_area_organization_id_display_name_key',
      ].includes(String(error.constraint))
    )
      throw new BadRequestException({ code: 'PARTICIPATION_AREA_DUPLICATE' });
    throw error;
  }
  async create(
    access: StaffAccess | undefined,
    input: { displayName: string } | undefined,
    correlation?: string,
  ) {
    assertAreaWrite(access);
    if (!input || Object.keys(input).some((k) => k !== 'displayName'))
      throw new BadRequestException('Invalid Participation Area.');
    const name = areaName(input.displayName);
    try {
      return await this.database.client.transaction().execute(async (trx) => {
        await this.lock(trx, access.organizationId);
        const last = await trx
          .selectFrom('participation_area')
          .select('display_order')
          .where('organization_id', '=', access.organizationId)
          .orderBy('display_order', 'desc')
          .limit(1)
          .executeTakeFirst();
        if (last?.display_order === 2147483647)
          throw new BadRequestException(
            'Adjust the last display order before adding another Participation Area.',
          );
        const row = await trx
          .insertInto('participation_area')
          .values({
            organization_id: access.organizationId,
            display_name: name,
            active: true,
            display_order: last ? last.display_order + 1 : 0,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await this.audit(trx, access, null, row, 'created', correlation);
        return { area: projection(row), changed: true };
      });
    } catch (error) {
      this.duplicate(error);
    }
  }
  async change(
    access: StaffAccess | undefined,
    id: string,
    input: AreaChange | undefined,
    correlation?: string,
  ) {
    assertAreaWrite(access);
    validateAreaChange(input);
    if (!requestUuid.test(id))
      throw new NotFoundException('Participation Area not found.');
    try {
      return await this.database.client.transaction().execute(async (trx) => {
        const org = await this.lock(trx, access.organizationId);
        const old = await trx
          .selectFrom('participation_area')
          .selectAll()
          .where('organization_id', '=', access.organizationId)
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (!old) throw new NotFoundException('Participation Area not found.');
        if (old.revision !== input.expectedRevision) throw conflict();
        const next = {
          display_name:
            input.displayName === undefined
              ? old.display_name
              : areaName(input.displayName),
          active: input.active ?? old.active,
          display_order: input.displayOrder ?? old.display_order,
        };
        if (
          next.display_name === old.display_name &&
          next.active === old.active &&
          next.display_order === old.display_order
        )
          return { area: projection(old), changed: false };
        if (old.revision === 2147483647) throw conflict();
        if (
          old.active &&
          !next.active &&
          org.service_participation_collection_enabled
        ) {
          const another = await trx
            .selectFrom('participation_area')
            .select('id')
            .where('organization_id', '=', access.organizationId)
            .where('active', '=', true)
            .where('id', '!=', id)
            .limit(1)
            .executeTakeFirst();
          if (!another)
            throw new BadRequestException({
              code: 'PARTICIPATION_AREA_LAST_ACTIVE',
            });
        }
        const row = await trx
          .updateTable('participation_area')
          .set(next)
          .where('organization_id', '=', access.organizationId)
          .where('id', '=', id)
          .where('revision', '=', input.expectedRevision)
          .returningAll()
          .executeTakeFirst();
        if (!row) throw conflict();
        const action =
          input.displayName !== undefined
            ? 'renamed'
            : input.displayOrder !== undefined
              ? 'reordered'
              : next.active
                ? 'activated'
                : 'deactivated';
        await this.audit(trx, access, old, row, action, correlation);
        return { area: projection(row), changed: true };
      });
    } catch (error) {
      this.duplicate(error);
    }
  }
}
