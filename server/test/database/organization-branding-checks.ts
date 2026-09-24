import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { sql, type Kysely } from 'kysely';
import request from 'supertest';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import type { StaffAccess } from '../../src/auth/auth.types.js';
import {
  up,
  down,
} from '../../migrations/20261001000000-add-organization-branding.js';
import { provisionBranding } from '../../src/database/organization-branding.js';
import { AdminConfigurationService } from '../../src/admin/admin-configuration.service.js';
export async function checkOrganizationBranding(
  t: TestContext,
  c: {
    app: INestApplication;
    db: Kysely<DatabaseSchema>;
    org: string;
    creator: string;
    otherStaff: string;
    logs: string[];
  },
) {
  const { db, org, app } = c;
  const service = app.get(AdminConfigurationService);
  const identity = await db
    .selectFrom('staff_identity')
    .select(['entra_tenant_id', 'entra_object_id'])
    .where('id', '=', c.creator)
    .executeTakeFirstOrThrow();
  const access: StaffAccess = {
    organizationId: org,
    staffIdentityId: c.creator,
    tenantId: identity.entra_tenant_id,
    objectId: identity.entra_object_id,
    displayName: 'Fictional',
    permissions: ['admin.configuration.read'],
    scopes: [],
    departmentIds: [],
    divisionIds: [],
    development: false,
  };
  const before = await db
    .selectFrom('service_request')
    .selectAll()
    .orderBy('id')
    .execute();
  const beforeOrg = await db
    .selectFrom('organization')
    .selectAll()
    .orderBy('id')
    .execute();
  const grants = await db
    .selectFrom('role_permission')
    .selectAll()
    .orderBy('role_id')
    .orderBy('permission_key')
    .execute();
  const audits = await db
    .selectFrom('participation_collection_audit')
    .selectAll()
    .orderBy('id')
    .execute();
  const input = {
    displayName: 'Fictional <script> Organization',
    tagline: 'Community Services',
    logoKey: 'example-organization',
  };
  await t.test(
    'F054 migration default, safe rollback/reapply and no unrelated changes',
    async () => {
      await db.transaction().execute(down);
      await db.transaction().execute(up);
      assert.deepEqual((await service.read(access)).branding, {
        mode: 'REQRO_DEFAULT',
        displayName: null,
        tagline: null,
        logoKey: null,
        revision: 1,
      });
      assert.deepEqual(
        await db.selectFrom('organization').selectAll().orderBy('id').execute(),
        beforeOrg,
      );
    },
  );
  await t.test(
    'F054 provisioning dry-run/no-op/clear and independent branding revision',
    async () => {
      assert.deepEqual(await provisionBranding(db, org, input, 1, true), {
        revision: 1,
        changed: true,
        dryRun: true,
      });
      assert.equal((await service.read(access)).branding.mode, 'REQRO_DEFAULT');
      assert.equal((await provisionBranding(db, org, input, 1)).revision, 2);
      assert.equal((await provisionBranding(db, org, input, 2)).changed, false);
      const one = await service.read(access),
        two = await service.read(access);
      assert.deepEqual(one.branding, two.branding);
      assert.deepEqual(one.branding, {
        mode: 'ORGANIZATION',
        ...input,
        revision: 2,
      });
      assert.deepEqual(Object.keys(one.branding).sort(), [
        'displayName',
        'logoKey',
        'mode',
        'revision',
        'tagline',
      ]);
      assert.deepEqual(
        await db.selectFrom('organization').selectAll().orderBy('id').execute(),
        beforeOrg,
      );
      await assert.rejects(
        () => provisionBranding(db, org, { ...input, displayName: 'Stale' }, 1),
        /Branding changed/,
      );
      assert.equal((await service.read(access)).branding.revision, 2);
    },
  );
  await t.test(
    'F054 cross-Organization isolation, unauthorized denial and no write route',
    async () => {
      const other = await db
        .selectFrom('staff_identity')
        .select('organization_id')
        .where('id', '=', c.otherStaff)
        .executeTakeFirstOrThrow();
      assert.equal(
        (
          await service.read({
            ...access,
            organizationId: other.organization_id,
          })
        ).branding.mode,
        'REQRO_DEFAULT',
      );
      await assert.rejects(() => service.read({ ...access, permissions: [] }));
      const api = app.getHttpServer() as Server;
      await request(api)
        .get('/api/v1/admin/configuration')
        .set('Authorization', `Bearer ${c.otherStaff}`)
        .expect(403);
      await request(api)
        .patch('/api/v1/admin/branding')
        .set('Authorization', `Bearer ${c.creator}`)
        .send(input)
        .expect(404);
    },
  );
  await t.test(
    'F054 concurrent provision, constraints, retained rollback and clear never reset revision',
    async () => {
      const results = await Promise.allSettled([
        provisionBranding(db, org, { ...input, tagline: 'First' }, 2),
        provisionBranding(db, org, { ...input, tagline: 'Second' }, 2),
      ]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
      for (const logo of ['../secret', 'https://example.test/logo.svg'])
        await assert.rejects(() =>
          db
            .updateTable('organization_branding')
            .set({ logo_key: logo })
            .where('organization_id', '=', org)
            .execute(),
        );
      await assert.rejects(() => db.transaction().execute(down));
      const row = await db
        .selectFrom('organization_branding')
        .selectAll()
        .where('organization_id', '=', org)
        .executeTakeFirstOrThrow();
      await db
        .updateTable('organization_branding')
        .set({ revision: 1 })
        .where('organization_id', '=', org)
        .execute();
      assert.equal(
        (await service.read(access)).branding.revision,
        row.revision,
      );
      const clear = await provisionBranding(
        db,
        org,
        { displayName: null, tagline: null, logoKey: null },
        row.revision,
      );
      assert.equal(clear.revision, row.revision + 1);
      assert.equal((await service.read(access)).branding.mode, 'REQRO_DEFAULT');
      await assert.rejects(() => db.transaction().execute(down));
      const nextOrg = (
        await sql<{
          id: string;
        }>`insert into organization(name,short_name,slug,status,default_business_timezone) values ('Fictional Branding New','FBN','fictional-branding-new','active','UTC') returning id`.execute(
          db,
        )
      ).rows[0];
      assert.ok(nextOrg);
      assert.equal(
        (
          await db
            .selectFrom('organization_branding')
            .select('revision')
            .where('organization_id', '=', nextOrg.id)
            .executeTakeFirstOrThrow()
        ).revision,
        1,
      );
    },
  );
  await t.test(
    'F054 preserves requests, existing grants, F053 audits and private logging',
    async () => {
      assert.deepEqual(
        await db
          .selectFrom('service_request')
          .selectAll()
          .orderBy('id')
          .execute(),
        before,
      );
      assert.deepEqual(
        await db
          .selectFrom('role_permission')
          .selectAll()
          .orderBy('role_id')
          .orderBy('permission_key')
          .execute(),
        grants,
      );
      assert.deepEqual(
        await db
          .selectFrom('participation_collection_audit')
          .selectAll()
          .orderBy('id')
          .execute(),
        audits,
      );
      assert.ok(!c.logs.join('\n').includes(input.displayName));
      assert.ok(!c.logs.join('\n').includes('example-organization'));
    },
  );
}
