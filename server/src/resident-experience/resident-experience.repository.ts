import { NotFoundException } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { DatabaseSchema } from '../database/database.types.js';
import { requestUuid } from '../service-request/staff-request-scope.js';
import {
  validateResidentSnapshot,
  type ResidentSnapshot,
} from './resident-experience.domain.js';

type Db = Kysely<DatabaseSchema>;
/** Internal persistence only. Never register directly as a public/admin API provider. */
export class ResidentExperienceRepository {
  constructor(private readonly client: Db | (() => Db)) {}

  get database(): Db {
    return typeof this.client === 'function' ? this.client() : this.client;
  }

  /** Anonymous reads select only the published pointer, in one coherent snapshot. */
  async getPublished(organizationId: string): Promise<ResidentSnapshot | null> {
    if (!requestUuid.test(organizationId)) throw new NotFoundException();
    return this.database
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (trx) => {
        await sql`set transaction read only`.execute(trx);
        const resource = await trx
          .selectFrom('organization_resident_experience as r')
          .innerJoin('organization as o', 'o.id', 'r.organization_id')
          .select('r.published_revision_id')
          .where('r.organization_id', '=', organizationId)
          .where('o.status', '=', 'active')
          .executeTakeFirst();
        if (!resource) throw new NotFoundException();
        if (!resource.published_revision_id) return null;
        return this.loadRevision(
          trx,
          organizationId,
          resource.published_revision_id,
        );
      });
  }

  async getResource(organizationId: string, db: Db = this.database) {
    if (!requestUuid.test(organizationId)) throw new NotFoundException();
    return db
      .selectFrom('organization_resident_experience as r')
      .innerJoin('organization as o', 'o.id', 'r.organization_id')
      .select([
        'r.organization_id',
        'r.revision',
        'r.draft_revision_id',
        'r.published_revision_id',
      ])
      .where('r.organization_id', '=', organizationId)
      .where('o.status', '=', 'active')
      .executeTakeFirst();
  }

  async getRevision(organizationId: string, revisionId: string) {
    return this.database
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (trx) => {
        await sql`set transaction read only`.execute(trx);
        if (!(await this.getResource(organizationId, trx)))
          throw new NotFoundException();
        return this.loadRevision(trx, organizationId, revisionId);
      });
  }

  /** Caller must supply a transaction for a coherent parent/children snapshot. */
  async loadRevision(
    trx: Transaction<DatabaseSchema>,
    organizationId: string,
    revisionId: string,
  ): Promise<ResidentSnapshot> {
    if (!requestUuid.test(organizationId) || !requestUuid.test(revisionId))
      throw new NotFoundException();
    const revision = await trx
      .selectFrom('resident_experience_revision')
      .select(['schema_version', 'presentation'])
      .where('organization_id', '=', organizationId)
      .where('id', '=', revisionId)
      .executeTakeFirst();
    if (!revision) throw new NotFoundException();
    const actions = await trx
      .selectFrom('resident_experience_action')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where('revision_id', '=', revisionId)
      .orderBy('display_order')
      .orderBy('logical_id')
      .execute();
    const benefits = await trx
      .selectFrom('resident_experience_benefit')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where('revision_id', '=', revisionId)
      .orderBy('display_order')
      .orderBy('logical_id')
      .execute();
    const contacts = await trx
      .selectFrom('resident_experience_contact')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where('revision_id', '=', revisionId)
      .orderBy('logical_id')
      .execute();
    return validateResidentSnapshot({
      schemaVersion: revision.schema_version,
      presentation: revision.presentation,
      actions: actions.map((a) => ({
        id: a.logical_id,
        enabled: a.enabled,
        order: a.display_order,
        iconKey: a.icon_key,
        title: a.title,
        description: a.description,
        ctaLabel: a.cta_label,
        actionType: a.action_type,
        target: a.target,
        contactId: a.contact_id,
        tone: a.tone,
      })),
      benefits: benefits.map((b) => ({
        id: b.logical_id,
        enabled: b.enabled,
        order: b.display_order,
        iconKey: b.icon_key,
        title: b.title,
        description: b.description,
      })),
      contacts: contacts.map((c) => ({
        id: c.logical_id,
        kind: c.kind,
        classification: c.classification,
        displayValue: c.display_value,
        phoneTarget: c.phone_target,
        guidance: c.guidance,
      })),
    });
  }

  async insertRevision(
    trx: Transaction<DatabaseSchema>,
    context: {
      organizationId: string;
      actorId: string;
      revisionId: string;
      resourceRevision: number;
    },
    snapshot: ResidentSnapshot,
  ) {
    const { organizationId, actorId, revisionId, resourceRevision } = context;
    await trx
      .insertInto('resident_experience_revision')
      .values({
        id: revisionId,
        organization_id: organizationId,
        resource_revision: resourceRevision,
        schema_version: snapshot.schemaVersion,
        presentation: JSON.stringify(snapshot.presentation),
        created_by: actorId,
      })
      .execute();
    const ownership = {
      organization_id: organizationId,
      revision_id: revisionId,
    };
    if (snapshot.contacts.length)
      await trx
        .insertInto('resident_experience_contact')
        .values(
          snapshot.contacts.map((c) => ({
            ...ownership,
            logical_id: c.id,
            kind: c.kind,
            classification: c.classification,
            display_value: c.displayValue,
            phone_target: c.phoneTarget,
            guidance: c.guidance,
          })),
        )
        .execute();
    if (snapshot.actions.length)
      await trx
        .insertInto('resident_experience_action')
        .values(
          snapshot.actions.map((a) => ({
            ...ownership,
            logical_id: a.id,
            enabled: a.enabled,
            display_order: a.order,
            icon_key: a.iconKey,
            title: a.title,
            description: a.description,
            cta_label: a.ctaLabel,
            action_type: a.actionType,
            target: a.target,
            contact_id: a.contactId,
            tone: a.tone,
          })),
        )
        .execute();
    if (snapshot.benefits.length)
      await trx
        .insertInto('resident_experience_benefit')
        .values(
          snapshot.benefits.map((b) => ({
            ...ownership,
            logical_id: b.id,
            enabled: b.enabled,
            display_order: b.order,
            icon_key: b.iconKey,
            title: b.title,
            description: b.description,
          })),
        )
        .execute();
  }
}
