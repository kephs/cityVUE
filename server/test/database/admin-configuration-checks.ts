import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import request from 'supertest';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import type { StaffAccess } from '../../src/auth/auth.types.js';
import {
  up,
  down,
} from '../../migrations/20260929000000-add-admin-configuration-foundation.js';
import { AdminConfigurationService } from '../../src/admin/admin-configuration.service.js';
import { eligibleTargets } from '../../src/service-request/ownership-targets.js';
import { configureIssueDefault } from '../../src/service-request/issue-default-assignment.js';
import { setParticipationCollection } from '../../src/database/participation-configuration.js';

export async function checkAdminConfiguration(
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
  const { app, db, org } = c,
    api = app.getHttpServer() as Server,
    path = '/api/v1/admin/configuration',
    service = app.get(AdminConfigurationService);
  const priorRequests = await db
    .selectFrom('service_request')
    .selectAll()
    .orderBy('id')
    .execute();
  const priorGrants = await db
    .selectFrom('role_permission')
    .selectAll()
    .orderBy('role_id')
    .orderBy('permission_key')
    .execute();
  await t.test(
    'F052 migration apply/down/reapply preserves requests and grants; new revisions start at one',
    async () => {
      await db.transaction().execute(up);
      await db.transaction().execute(down);
      await db.transaction().execute(up);
      assert.deepEqual(
        await db
          .selectFrom('service_request')
          .selectAll()
          .orderBy('id')
          .execute(),
        priorRequests,
      );
      assert.deepEqual(
        await db
          .selectFrom('role_permission')
          .selectAll()
          .orderBy('role_id')
          .orderBy('permission_key')
          .execute(),
        priorGrants,
      );
      assert.ok(
        (
          await db.selectFrom('participation_area').select('revision').execute()
        ).every((r) => r.revision === 1),
      );
      assert.equal(
        (
          await db
            .selectFrom('role_permission')
            .where('permission_key', '=', 'admin.configuration.read')
            .selectAll()
            .execute()
        ).length,
        0,
      );
    },
  );
  const identity = await db
    .selectFrom('staff_identity')
    .select(['entra_tenant_id'])
    .where('id', '=', c.creator)
    .executeTakeFirstOrThrow();
  const actor = randomUUID(),
    role = randomUUID();
  const access: StaffAccess = {
    organizationId: org,
    staffIdentityId: actor,
    tenantId: identity.entra_tenant_id,
    objectId: actor,
    permissions: ['admin.configuration.read'],
    scopes: ['access_as_user'],
    departmentIds: [],
    divisionIds: [],
    displayName: 'Fictional configuration reader',
    development: false,
  };
  await db
    .insertInto('staff_identity')
    .values({
      id: actor,
      organization_id: org,
      entra_tenant_id: identity.entra_tenant_id,
      entra_object_id: actor,
      display_name: 'Fictional configuration reader',
      email: null,
      active: true,
    })
    .execute();
  await db
    .insertInto('role')
    .values({
      id: role,
      organization_id: org,
      name: 'Fictional F052 read role',
      description: null,
      active: true,
    })
    .execute();
  await db
    .insertInto('staff_role_assignment')
    .values({
      organization_id: org,
      staff_identity_id: actor,
      role_id: role,
      active: true,
    })
    .execute();
  await t.test(
    'F052 real guards deny absent tokens and analytics/operational permissions without admin; explicit grant alone permits configuration',
    async () => {
      await request(api).get(path).expect(401);
      await request(api)
        .get(path)
        .set('Authorization', `Bearer ${c.creator}`)
        .expect(403);
      await request(api)
        .get(path)
        .set('Authorization', `Bearer ${actor}`)
        .expect(403);
      await db
        .insertInto('role_permission')
        .values({
          organization_id: org,
          role_id: role,
          permission_key: 'admin.configuration.read',
        })
        .execute();
      await request(api)
        .get(path)
        .set('Authorization', `Bearer ${actor}`)
        .expect(200);
      await request(api)
        .get('/api/v1/staff/service-requests')
        .set('Authorization', `Bearer ${actor}`)
        .expect(403);
      await request(api)
        .get(
          '/api/v1/staff/analytics/service-participation?startDate=2020-01-01&endDate=2020-02-29',
        )
        .set('Authorization', `Bearer ${actor}`)
        .expect(403);
    },
  );
  await t.test(
    'F052 rejects Organization substitution and write methods; foreign configuration remains isolated',
    async () => {
      for (const query of [
        'organizationId',
        'organization',
        'tenantId',
        'unknown',
      ])
        await request(api)
          .get(`${path}?${query}=${randomUUID()}`)
          .set('Authorization', `Bearer ${actor}`)
          .expect(400);
      await request(api)
        .get(`/api/v1/organizations/${org}/admin/configuration`)
        .set('Authorization', `Bearer ${actor}`)
        .expect(404);
      for (const method of ['post', 'put', 'patch', 'delete'] as const) {
        const http = request(api);
        await http[method](path)
          .set('Authorization', `Bearer ${actor}`)
          .send({ enabled: false })
          .expect(404);
      }
      const foreign = await db
        .selectFrom('staff_identity')
        .select('organization_id')
        .where('id', '=', c.otherStaff)
        .executeTakeFirstOrThrow();
      const other = await service.read({
        ...access,
        organizationId: foreign.organization_id,
      });
      const foreignIssues = await db
        .selectFrom('service_definition')
        .select('service_key')
        .where('organization_id', '=', foreign.organization_id)
        .execute();
      assert.equal(other.issues.total, foreignIssues.length);
      assert.ok(
        other.issues.items.every((i) =>
          foreignIssues.some((f) => f.service_key === i.key),
        ),
      );
      await request(api)
        .get(path)
        .set('Authorization', `Bearer ${c.otherStaff}`)
        .expect(403);
      const ours = await service.read(access);
      const headerForgery = await request(api)
        .get(path)
        .set('Authorization', `Bearer ${actor}`)
        .set('X-Organization-Id', foreign.organization_id)
        .expect(200);
      assert.deepEqual(headerForgery.body, ours);
      assert.ok(
        other.participationAreas.items.every(
          (a) => !ours.participationAreas.items.some((b) => b.id === a.id),
        ),
      );
    },
  );
  await t.test(
    'F052 concurrent reads are coherent, bounded, safe and leave all resource revisions/configuration unchanged',
    async () => {
      const before = (
        await sql<{
          value: unknown;
        }>`select jsonb_build_object('org',(select to_jsonb(o) from organization o where id=${org}),'areas',(select jsonb_agg(a order by id) from participation_area a where organization_id=${org}),'policies',(select jsonb_agg(p order by service_definition_id) from issue_requester_identity_policy p where organization_id=${org}),'defaults',(select jsonb_agg(d order by service_definition_id) from issue_default_assignment d where organization_id=${org})) as value`.execute(
          db,
        )
      ).rows[0]?.value;
      const [one, two] = await Promise.all([
        service.read(access),
        service.read(access),
      ]);
      assert.deepEqual(one, two);
      assert.deepEqual(Object.keys(one).sort(), [
        'capabilities',
        'collection',
        'health',
        'issues',
        'participationAreas',
        'privacy',
      ]);
      assert.deepEqual(one.capabilities, { canWriteIntakeSettings: false });
      assert.equal(one.privacy.source, 'deployment_policy');
      assert.ok(!('revision' in one.privacy));
      assert.ok(one.issues.items.length <= 25);
      assert.ok(one.participationAreas.items.length <= 25);
      const text = JSON.stringify(one);
      for (const forbidden of [
        'entra_',
        'identity_subject',
        'requester_id',
        'requester_contact',
        'credential',
        'digest',
        'latitude',
        'longitude',
        'storage_key',
        'requester_geography_state',
      ])
        assert.ok(!text.includes(forbidden));
      assert.equal(
        (await service.read(access, 999999, 999999)).issues.items.length,
        0,
      );
      const response = await request(api)
        .get(path)
        .set('Authorization', `Bearer ${actor}`)
        .expect(200);
      assert.equal(response.headers['cache-control'], 'no-store');
      const after = (
        await sql<{
          value: unknown;
        }>`select jsonb_build_object('org',(select to_jsonb(o) from organization o where id=${org}),'areas',(select jsonb_agg(a order by id) from participation_area a where organization_id=${org}),'policies',(select jsonb_agg(p order by service_definition_id) from issue_requester_identity_policy p where organization_id=${org}),'defaults',(select jsonb_agg(d order by service_definition_id) from issue_default_assignment d where organization_id=${org})) as value`.execute(
          db,
        )
      ).rows[0]?.value;
      assert.deepEqual(after, before);
    },
  );
  await t.test(
    'F052 set-based default-target health matches F048 eligibility and safely warns on unavailable targets',
    async () => {
      const issue = await db
        .selectFrom('service_definition as i')
        .innerJoin('category as c', 'c.id', 'i.category_id')
        .select(['i.id', 'c.department_id', 'c.division_id'])
        .where('i.organization_id', '=', org)
        .where('i.status', '=', 'active')
        .where('c.status', '=', 'active')
        .executeTakeFirstOrThrow();
      const group = randomUUID();
      await db
        .insertInto('work_group')
        .values({
          id: group,
          organization_id: org,
          department_id: issue.department_id,
          division_id: issue.division_id,
          name: 'Fictional F052 assignment target',
          description: null,
          active: true,
        })
        .execute();
      const previous = await db
        .selectFrom('issue_default_assignment')
        .select('revision')
        .where('organization_id', '=', org)
        .where('service_definition_id', '=', issue.id)
        .executeTakeFirst();
      await db.transaction().execute((trx) =>
        configureIssueDefault(trx, org, issue.id, actor, {
          expectedRevision: previous?.revision ?? 0,
          target: { type: 'group', id: group },
        }),
      );
      const snapshot = await service.read(access);
      const defaults = await db
        .selectFrom('issue_default_assignment as a')
        .innerJoin('service_definition as i', 'i.id', 'a.service_definition_id')
        .innerJoin('category as c', 'c.id', 'i.category_id')
        .select([
          'i.service_key',
          'c.department_id',
          'c.division_id',
          'a.target_type',
          'a.staff_identity_id',
          'a.operational_role_id',
          'a.work_group_id',
        ])
        .where('a.organization_id', '=', org)
        .execute();
      for (const row of defaults) {
        if (!row.target_type) continue;
        const id =
          row.staff_identity_id ?? row.operational_role_id ?? row.work_group_id;
        if (!id) continue;
        const valid =
          (
            await eligibleTargets(
              db,
              org,
              row.department_id,
              row.division_id,
              row.target_type,
              '',
              id,
              'public',
            )
          ).length ||
          (
            await eligibleTargets(
              db,
              org,
              row.department_id,
              row.division_id,
              row.target_type,
              '',
              id,
              'internal',
            )
          ).length;
        assert.equal(
          snapshot.issues.items.find((i) => i.key === row.service_key)
            ?.defaultAssignment.state,
          valid ? 'configured' : 'unavailable',
        );
      }
      const target = await db
        .selectFrom('issue_default_assignment')
        .selectAll()
        .where('organization_id', '=', org)
        .where('target_type', 'is not', null)
        .executeTakeFirst();
      assert.ok(target, 'Disposable configured assignment fixture required');
      {
        const table =
          target.target_type === 'staff'
            ? 'staff_identity'
            : target.target_type === 'role'
              ? 'operational_role'
              : 'work_group';
        const id =
          target.staff_identity_id ??
          target.operational_role_id ??
          target.work_group_id;
        assert.ok(id);
        const old = await db
          .selectFrom(table)
          .select('active')
          .where('id', '=', id)
          .executeTakeFirstOrThrow();
        await db
          .updateTable(table)
          .set({ active: false })
          .where('id', '=', id)
          .execute();
        assert.ok(
          (await service.read(access)).health.some(
            (h) =>
              h.resource === 'Issue default assignment' &&
              h.severity === 'WARNING',
          ),
        );
        await db
          .updateTable(table)
          .set({ active: old.active })
          .where('id', '=', id)
          .execute();
      }
    },
  );
  await t.test(
    'F052 collection and individual area revisions advance only for their own meaningful changes; stale compare fails',
    async () => {
      const before = await service.read(access),
        a = before.participationAreas.items[0],
        b = before.participationAreas.items[1];
      assert.ok(a && b);
      await setParticipationCollection(db, org, !before.collection.enabled);
      let current = await service.read(access);
      assert.equal(current.collection.revision, before.collection.revision + 1);
      assert.equal(current.participationAreas.items[0]?.revision, a.revision);
      await setParticipationCollection(db, org, !before.collection.enabled);
      assert.equal(
        (await service.read(access)).collection.revision,
        current.collection.revision,
      );
      const result = await db
        .updateTable('participation_area')
        .set({ display_name: 'Fictional F052 revision sentinel' })
        .where('id', '=', a.id)
        .where('revision', '=', a.revision)
        .returning('revision')
        .executeTakeFirstOrThrow();
      assert.equal(result.revision, a.revision + 1);
      assert.equal(
        (
          await db
            .updateTable('participation_area')
            .set({ active: false })
            .where('id', '=', a.id)
            .where('revision', '=', a.revision)
            .executeTakeFirst()
        ).numUpdatedRows,
        0n,
      );
      current = await service.read(access);
      assert.equal(
        current.participationAreas.items.find((x) => x.id === b.id)?.revision,
        b.revision,
      );
      assert.deepEqual(current.issues, before.issues);
      assert.equal(current.collection.revision, before.collection.revision + 1);
      await db
        .updateTable('participation_area')
        .set({ display_name: 'Fictional F052 revision sentinel' })
        .where('id', '=', a.id)
        .execute();
      assert.equal(
        (await service.read(access)).participationAreas.items.find(
          (x) => x.id === a.id,
        )?.revision,
        a.revision + 1,
      );
      await assert.rejects(db.transaction().execute(down));
    },
  );
  await t.test(
    'F052 health safely distinguishes enabled/no areas, disabled/no areas and empty page configuration without repair',
    async () => {
      await db
        .updateTable('participation_area')
        .set({ active: false })
        .where('organization_id', '=', org)
        .execute();
      await db
        .updateTable('organization')
        .set({ service_participation_collection_enabled: true })
        .where('id', '=', org)
        .execute();
      assert.equal((await service.read(access)).health[0]?.severity, 'WARNING');
      await db
        .updateTable('organization')
        .set({ service_participation_collection_enabled: false })
        .where('id', '=', org)
        .execute();
      assert.equal((await service.read(access)).health[0]?.severity, 'OK');
      assert.deepEqual(
        await db
          .selectFrom('service_request')
          .selectAll()
          .orderBy('id')
          .execute(),
        priorRequests,
      );
    },
  );
  await t.test(
    'F052 admin-only HTTP identity cannot read Contact, Notes, Communications, attachments, tracking, history or geospatial data',
    async () => {
      const id = priorRequests[0]?.id;
      assert.ok(id);
      for (const endpoint of [
        `/api/v1/staff/public-service-requests/${id}/contact`,
        `/api/v1/staff/service-requests/${id}/notes`,
        `/api/v1/staff/service-requests/${id}/communications`,
        `/api/v1/staff/attachments/requests/${id}/evidence`,
        `/api/v1/staff/service-requests/${id}/requester-tracking`,
        `/api/v1/staff/service-requests/${id}/requester-history`,
        `/api/v1/staff/service-requests/${id}/assignment-targets`,
        '/api/v1/geospatial',
      ])
        await request(api)
          .get(endpoint)
          .set('Authorization', `Bearer ${actor}`)
          .expect(403);
    },
  );
  await t.test(
    'F052 revocation returns 403 and normal logs exclude configuration snapshots and identity values',
    async () => {
      await db
        .deleteFrom('role_permission')
        .where('role_id', '=', role)
        .where('permission_key', '=', 'admin.configuration.read')
        .execute();
      await request(api)
        .get(path)
        .set('Authorization', `Bearer ${actor}`)
        .expect(403);
      const logs = c.logs.join('\n');
      for (const value of [
        'Fictional F052 revision sentinel',
        'Fictional configuration reader',
        'identityPolicyRevision',
        'participation_collection_revision',
        `Bearer ${actor}`,
      ])
        assert.ok(!logs.includes(value));
    },
  );
}
