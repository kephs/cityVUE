import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { sql, type Kysely } from 'kysely';
import request from 'supertest';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import type { Permission } from '../../src/auth/auth.types.js';
import type { IssueProjection } from '../../src/admin/admin-issue.service.js';
import { ServiceRequestRepository } from '../../src/service-request/service-request.repository.js';
import { CatalogRepository } from '../../src/catalog/catalog.repository.js';
import { checkAdminIssueDiscovery } from './admin-issue-discovery-checks.js';
import {
  up,
  down,
} from '../../migrations/20261003000000-add-admin-issue-configuration.js';

function present<T>(value: T | null | undefined): T {
  assert.ok(value !== null && value !== undefined);
  return value;
}

export async function checkAdminIssues(
  t: TestContext,
  c: {
    app: INestApplication;
    db: Kysely<DatabaseSchema>;
    org: string;
    creator: string;
    logs: string[];
  },
) {
  const { db, app, org } = c,
    api = app.getHttpServer() as Server,
    path = '/api/v1/admin/issues';
  const requests = () =>
    db.selectFrom('service_request').selectAll().orderBy('id').execute();
  const versions = () =>
    db
      .selectFrom('service_definition_version')
      .selectAll()
      .orderBy('id')
      .execute();
  const previousRequests = await requests(),
    previousVersions = await versions();
  await t.test(
    'F056 migration apply rollback reapply preserves identity/history and grants',
    async () => {
      await db.transaction().execute(up);
      await db.transaction().execute(down);
      await db.transaction().execute(up);
      assert.deepEqual(await requests(), previousRequests);
      assert.deepEqual(await versions(), previousVersions);
      assert.equal(
        (
          await db
            .selectFrom('role_permission')
            .selectAll()
            .where('permission_key', '=', 'admin.issues.write')
            .execute()
        ).length,
        0,
      );
      const core = await db
        .selectFrom('service_definition')
        .select(['core_revision', 'display_order'])
        .execute();
      assert.ok(
        core.every((r) => r.core_revision === 1 && r.display_order === 0),
      );
    },
  );
  const actor = randomUUID(),
    role = randomUUID();
  const identity = await db
    .selectFrom('staff_identity')
    .select('entra_tenant_id')
    .where('id', '=', c.creator)
    .executeTakeFirstOrThrow();
  await db
    .insertInto('staff_identity')
    .values({
      id: actor,
      organization_id: org,
      entra_tenant_id: identity.entra_tenant_id,
      entra_object_id: actor,
      display_name: 'Fictional F056 administrator',
      active: true,
    })
    .execute();
  await db
    .insertInto('role')
    .values({
      id: role,
      organization_id: org,
      name: 'F056 isolated role',
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
  const grant = (permission_key: Permission) =>
    db
      .insertInto('role_permission')
      .values({ organization_id: org, role_id: role, permission_key })
      .execute();
  const clear = () =>
    db.deleteFrom('role_permission').where('role_id', '=', role).execute();
  const post = (body: object) =>
    request(api).post(path).set('Authorization', `Bearer ${actor}`).send(body);
  const patch = (id: string, body: object) =>
    request(api)
      .patch(`${path}/${id}`)
      .set('Authorization', `Bearer ${actor}`)
      .send(body);
  const get = () =>
    request(api).get(path).set('Authorization', `Bearer ${actor}`);
  const auditCount = async () =>
    (
      await sql<{
        n: number;
      }>`select count(*)::int as n from issue_configuration_audit`.execute(db)
    ).rows.at(0)?.n ?? 0;
  await grant('admin.configuration.read');
  const initial = (await get().expect(200)).body as {
    items: IssueProjection[];
  };
  const template = initial.items.find((i) => i.templateEligible);
  assert.ok(template, 'valid fixture template');
  const create = {
    templateId: template.id,
    name: 'Fictional F056 source',
    description: 'Synthetic configuration only',
    displayOrder: 0,
    requesterPolicy: 'IDENTIFIED_REQUIRED',
    defaultAssignment: null,
  };
  const body = (i: IssueProjection) => ({
    name: i.name,
    description: i.description,
    displayOrder: i.displayOrder,
    requesterPolicy: i.requesterPolicy,
    defaultAssignment: i.defaultAssignment
      ? { type: i.defaultAssignment.type, id: i.defaultAssignment.id }
      : null,
    active: i.active,
    expectedCoreRevision: i.coreRevision,
    expectedActionRevision: i.actionRevision,
    expectedPolicyRevision: i.policyRevision,
    expectedAssignmentRevision: i.assignmentRevision,
  });
  await t.test(
    'F056 HTTP 401 and independent permission matrix fail closed',
    async () => {
      await request(api).post(path).send(create).expect(401);
      for (const p of [
        null,
        'admin.configuration.read',
        'admin.issues.write',
        'admin.intake_settings.write',
        'admin.participation_areas.write',
        'analytics.service_participation.read',
        'service_request.assign',
      ] as const) {
        await clear();
        if (p) await grant(p);
        await post(create).expect(403);
        if (p !== 'admin.configuration.read') await get().expect(403);
        if (
          p &&
          p !== 'admin.configuration.read' &&
          p !== 'admin.issues.write'
        ) {
          await grant('admin.configuration.read');
          await post(create).expect(403);
        }
      }
      assert.equal(await auditCount(), 0);
      await clear();
      await grant('admin.configuration.read');
      await grant('admin.issues.write');
    },
  );
  let issue: IssueProjection;
  await t.test(
    'F056 creates inactive independent template copy, no operational grants or historical writes',
    async () => {
      issue = (
        (await post(create).expect(201)).body as { issue: IssueProjection }
      ).issue;
      assert.equal(issue.active, false);
      assert.equal(issue.policyRevision, 1);
      assert.equal(issue.assignmentRevision, 0);
      assert.equal(issue.coreRevision, 2);
      assert.equal(await auditCount(), 1);
      assert.deepEqual(await requests(), previousRequests);
      const original = await db
        .selectFrom('service_definition')
        .selectAll()
        .where('id', '=', template.id)
        .executeTakeFirstOrThrow();
      const made = await db
        .selectFrom('service_definition')
        .selectAll()
        .where('id', '=', issue.id)
        .executeTakeFirstOrThrow();
      assert.equal(made.category_id, original.category_id);
      assert.notEqual(made.service_key, original.service_key);
      assert.notEqual(
        made.current_published_version_id,
        original.current_published_version_id,
      );
      const oldQuestions = await db
        .selectFrom('question')
        .selectAll()
        .where(
          'service_definition_version_id',
          '=',
          present(original.current_published_version_id),
        )
        .orderBy('question_key')
        .execute();
      const newQuestions = await db
        .selectFrom('question')
        .selectAll()
        .where(
          'service_definition_version_id',
          '=',
          present(made.current_published_version_id),
        )
        .orderBy('question_key')
        .execute();
      assert.deepEqual(
        newQuestions.map((q) => q.question_key),
        oldQuestions.map((q) => q.question_key),
      );
      assert.ok(
        newQuestions.every((q) => !oldQuestions.some((o) => o.id === q.id)),
      );
      await request(api)
        .delete(`${path}/${issue.id}`)
        .set('Authorization', `Bearer ${actor}`)
        .expect(404);
    },
  );
  await t.test(
    'F056 strict DTO, state forgery and foreign template rejected',
    async () => {
      for (const field of [
        'active',
        'organizationId',
        'workflow',
        'sla',
        'privacyThreshold',
        'tracking',
        'requesterId',
      ])
        await post({ ...create, [field]: true }).expect(400);
      await post({ ...create, templateId: randomUUID() }).expect(400);
      await post({ ...create, requesterPolicy: 'FORGED' }).expect(400);
      await patch(randomUUID(), body(issue)).expect(404);
      await patch(issue.id, {
        ...body(issue),
        organizationId: randomUUID(),
      }).expect(400);
      assert.equal(await auditCount(), 1);
    },
  );
  await t.test(
    'F056 independent revisions, immutable rename publication, policy and activation transaction',
    async () => {
      const originalVersion = await db
        .selectFrom('service_definition')
        .select('current_published_version_id')
        .where('id', '=', issue.id)
        .executeTakeFirstOrThrow();
      issue = (
        (
          await patch(issue.id, {
            ...body(issue),
            name: '  Fictional F056 renamed  ',
            description: 'Updated fictional description',
            requesterPolicy: 'ANONYMOUS_ALLOWED',
            displayOrder: 4,
            active: true,
          }).expect(200)
        ).body as { issue: IssueProjection }
      ).issue;
      assert.equal(issue.name, 'Fictional F056 renamed');
      assert.equal(issue.coreRevision, 3);
      assert.equal(issue.policyRevision, 2);
      assert.equal(issue.assignmentRevision, 0);
      assert.equal(issue.actionRevision, 1);
      const historical = await db
        .selectFrom('service_definition_version')
        .select('name')
        .where('id', '=', present(originalVersion.current_published_version_id))
        .executeTakeFirstOrThrow();
      assert.equal(historical.name, create.name);
      const current = await db
        .selectFrom('service_definition')
        .select('current_published_version_id')
        .where('id', '=', issue.id)
        .executeTakeFirstOrThrow();
      assert.notEqual(
        current.current_published_version_id,
        originalVersion.current_published_version_id,
      );
      assert.deepEqual(await requests(), previousRequests);
    },
  );
  await t.test(
    'F056 no-op and every stale revision leave all revisions/audits unchanged',
    async () => {
      const before = await auditCount();
      const result = (await patch(issue.id, body(issue)).expect(200)).body as {
        changed: boolean;
        issue: IssueProjection;
      };
      assert.equal(result.changed, false);
      assert.deepEqual(result.issue, issue);
      for (const key of [
        'expectedCoreRevision',
        'expectedActionRevision',
        'expectedPolicyRevision',
        'expectedAssignmentRevision',
      ])
        await patch(issue.id, {
          ...body(issue),
          [key]:
            present((body(issue) as unknown as Record<string, number>)[key]) +
            1,
        }).expect(409);
      assert.equal(await auditCount(), before);
    },
  );
  await t.test(
    'F056 same revision concurrent writers have exactly one winner',
    async () => {
      const saved = body(issue);
      const result = await Promise.all([
        patch(issue.id, { ...saved, displayOrder: 5 }),
        patch(issue.id, { ...saved, displayOrder: 6 }),
      ]);
      assert.deepEqual(result.map((r) => r.status).sort(), [200, 409]);
      issue = (
        present(result.find((r) => r.status === 200)).body as {
          issue: IssueProjection;
        }
      ).issue;
    },
  );
  await t.test(
    'F056 inactive names reserved and create races database enforced',
    async () => {
      const duplicate = await post({
        ...create,
        name: 'FICTIONAL F056 RENAMED ',
      }).expect(400);
      assert.equal(
        (duplicate.body as { message: string }).message,
        'An Issue with this name already exists.',
      );
      const results = await Promise.all([
        post({ ...create, name: 'F056 race' }),
        post({ ...create, name: ' f056 RACE ' }),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 400]);
      const other = (
        present(results.find((r) => r.status === 201)).body as {
          issue: IssueProjection;
        }
      ).issue;
      await patch(other.id, {
        ...body(other),
        name: issue.name.toUpperCase(),
      }).expect(400);
      const results2 = await Promise.all([
        patch(other.id, { ...body(other), name: 'F056 rename race' }),
        patch(issue.id, { ...body(issue), name: ' f056 RENAME RACE ' }),
      ]);
      assert.deepEqual(results2.map((r) => r.status).sort(), [200, 400]);
      issue =
        (
          (await get().expect(200)).body as { items: IssueProjection[] }
        ).items.find((i) => i.id === issue.id) ?? issue;
    },
  );
  await t.test(
    'F056 invalid target rolls back preceding policy change',
    async () => {
      const before = await auditCount();
      await patch(issue.id, {
        ...body(issue),
        requesterPolicy:
          issue.requesterPolicy === 'ANONYMOUS_ALLOWED'
            ? 'IDENTIFIED_REQUIRED'
            : 'ANONYMOUS_ALLOWED',
        defaultAssignment: { type: 'staff', id: randomUUID() },
      }).expect(400);
      const current = (
        (await get().expect(200)).body as { items: IssueProjection[] }
      ).items.find((i) => i.id === issue.id);
      assert.deepEqual(current, issue);
      assert.equal(await auditCount(), before);
    },
  );
  await t.test(
    'F056 audit failure rolls back catalog/policy changes and version creation',
    async () => {
      const before = await versions();
      await sql`create function reject_f056_audit() returns trigger language plpgsql as $$ begin raise exception 'test audit unavailable'; end $$; create trigger reject_f056 before insert on issue_configuration_audit for each row execute function reject_f056_audit()`.execute(
        db,
      );
      try {
        await patch(issue.id, {
          ...body(issue),
          name: 'Must roll back',
          requesterPolicy: 'IDENTIFIED_REQUIRED',
        }).expect(500);
      } finally {
        await sql`drop trigger reject_f056 on issue_configuration_audit;drop function reject_f056_audit()`.execute(
          db,
        );
      }
      assert.deepEqual(await versions(), before);
      assert.deepEqual(
        (
          (await get().expect(200)).body as { items: IssueProjection[] }
        ).items.find((i) => i.id === issue.id),
        issue,
      );
    },
  );
  await t.test(
    'F056 deactivate reactivate retain history and only advance core revision',
    async () => {
      const before = issue;
      issue = (
        (await patch(issue.id, { ...body(issue), active: false }).expect(200))
          .body as { issue: IssueProjection }
      ).issue;
      assert.equal(issue.active, false);
      assert.equal(issue.policyRevision, before.policyRevision);
      assert.equal(issue.coreRevision, before.coreRevision + 1);
      issue = (
        (await patch(issue.id, { ...body(issue), active: true }).expect(200))
          .body as { issue: IssueProjection }
      ).issue;
      assert.equal(issue.active, true);
      assert.equal(issue.coreRevision, before.coreRevision + 2);
      assert.deepEqual(await requests(), previousRequests);
      for (const v of previousVersions)
        assert.deepEqual(
          (await versions()).find((x) => x.id === v.id),
          v,
        );
    },
  );
  await t.test(
    'F056 direct database name races cannot bypass normalization and inactive reservation',
    async () => {
      const rawCreate = (name: string) =>
        db.transaction().execute(async (trx) => {
          const id = randomUUID(),
            version = randomUUID();
          await sql`insert into service_definition(id,organization_id,category_id,service_key,status)
        select ${id},organization_id,category_id,${id},'inactive' from service_definition where id=${template.id} and organization_id=${org}`.execute(
            trx,
          );
          await sql`insert into service_definition_version(id,organization_id,service_definition_id,version_number,name,resident_description,icon_key,default_priority,location_policy,geographic_eligibility_mode,anonymous_reporting_policy,status,published_at)
        select ${version},${org},${id},1,${name},'Synthetic','test','medium','not_applicable','no_geographic_restriction','not_allowed','published',clock_timestamp()`.execute(
            trx,
          );
          await trx
            .updateTable('service_definition')
            .set({ current_published_version_id: version })
            .where('id', '=', id)
            .execute();
          return id;
        });
      const results = await Promise.allSettled([
        rawCreate('F056 direct race'),
        rawCreate(' F056 DIRECT RACE '),
      ]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      const failed = results.find((r) => r.status === 'rejected');
      assert.ok(failed?.status === 'rejected');
      assert.equal((failed.reason as { code: string }).code, '23505');
      assert.equal(
        (failed.reason as { constraint: string }).constraint,
        'issue_current_name_unique',
      );
    },
  );
  await t.test(
    'F056 separate Issues update independently and policy-only edit preserves core/action revisions',
    async () => {
      const other = (
        (await post({ ...create, name: 'F056 independent' }).expect(201))
          .body as { issue: IssueProjection }
      ).issue;
      const result = await Promise.all([
        patch(other.id, { ...body(other), displayOrder: 12 }),
        patch(issue.id, {
          ...body(issue),
          requesterPolicy: 'IDENTIFIED_REQUIRED',
        }),
      ]);
      assert.ok(result.every((r) => r.status === 200));
      const next = (present(result[1]).body as { issue: IssueProjection })
        .issue;
      assert.equal(next.coreRevision, issue.coreRevision);
      assert.equal(next.actionRevision, issue.actionRevision);
      assert.equal(next.policyRevision, issue.policyRevision + 1);
      issue = next;
      issue = (
        (
          await patch(issue.id, {
            ...body(issue),
            requesterPolicy: 'ANONYMOUS_ALLOWED',
          }).expect(200)
        ).body as { issue: IssueProjection }
      ).issue;
    },
  );
  await t.test(
    'F056 deactivation between pre-validation and transactional lock rejects stale creation',
    async () => {
      const repo = app.get(ServiceRequestRepository),
        catalog = app.get(CatalogRepository);
      const version = await db
        .selectFrom('service_definition')
        .select(['current_published_version_id', 'category_id'])
        .where('id', '=', issue.id)
        .executeTakeFirstOrThrow();
      assert.ok(
        (await catalog.listPublishedIssues(org, version.category_id)).some(
          (i) => i.id === issue.id,
        ),
      );
      let reached: () => void = () => undefined,
        release: () => void = () => undefined;
      const loaded = new Promise<void>((resolve) => {
          reached = resolve;
        }),
        resume = new Promise<void>((resolve) => {
          release = resolve;
        });
      const original = repo.loadSubmissionDefinition.bind(repo);
      repo.loadSubmissionDefinition = async (...args) => {
        const result = await original(...args);
        if (args[2] === issue.id) {
          reached();
          await resume;
        }
        return result;
      };
      const pending = request(api)
        .post('/api/v1/service-requests')
        .send({
          serviceDefinitionId: issue.id,
          serviceDefinitionVersionId: version.current_published_version_id,
          description: 'F056 never persisted',
          reportingIdentity: 'anonymous',
          answers: [],
        })
        .then((r) => r);
      try {
        await loaded;
        issue = (
          (await patch(issue.id, { ...body(issue), active: false }).expect(200))
            .body as { issue: IssueProjection }
        ).issue;
        release();
        assert.equal((await pending).status, 409);
        assert.ok(
          !(await catalog.listPublishedIssues(org, version.category_id)).some(
            (i) => i.id === issue.id,
          ),
        );
        assert.deepEqual(await requests(), previousRequests);
      } finally {
        release();
        repo.loadSubmissionDefinition = original;
      }
    },
  );
  await t.test(
    'F056 actual foreign Organization resources are unavailable and names remain independent',
    async () => {
      const foreign = await db
        .selectFrom('service_definition')
        .selectAll()
        .where('organization_id', '!=', org)
        .executeTakeFirstOrThrow();
      const foreignStaff = await db
        .selectFrom('staff_identity')
        .select('id')
        .where('organization_id', '=', foreign.organization_id)
        .executeTakeFirstOrThrow();
      const before = await auditCount();
      await post({ ...create, templateId: foreign.id }).expect(400);
      await patch(foreign.id, body(issue)).expect(404);
      await request(api)
        .get(`${path}/${foreign.id}/assignment-targets`)
        .set('Authorization', `Bearer ${actor}`)
        .expect(404);
      await patch(issue.id, {
        ...body(issue),
        defaultAssignment: { type: 'staff', id: foreignStaff.id },
      }).expect(400);
      assert.equal(await auditCount(), before);
      const copyName = 'F056 independent Organization name';
      const foreignVersion = randomUUID();
      await sql`insert into service_definition_version(id,organization_id,service_definition_id,version_number,name,resident_description,icon_key,default_priority,location_policy,geographic_eligibility_mode,anonymous_reporting_policy,status,published_at)
      select ${foreignVersion},organization_id,service_definition_id,99,${copyName},resident_description,icon_key,default_priority,location_policy,geographic_eligibility_mode,anonymous_reporting_policy,'published',clock_timestamp() from service_definition_version where service_definition_id=${foreign.id} order by version_number desc limit 1`.execute(
        db,
      );
      await db
        .updateTable('service_definition')
        .set({ current_published_version_id: foreignVersion })
        .where('id', '=', foreign.id)
        .execute();
      await post({ ...create, name: copyName }).expect(201);
      assert.deepEqual(
        await db
          .selectFrom('service_definition')
          .selectAll()
          .where('id', '=', foreign.id)
          .executeTakeFirstOrThrow(),
        {
          ...foreign,
          current_published_version_id: foreignVersion,
          current_display_name: copyName,
          core_revision: foreign.core_revision + 1,
          updated_at: (
            await db
              .selectFrom('service_definition')
              .select('updated_at')
              .where('id', '=', foreign.id)
              .executeTakeFirstOrThrow()
          ).updated_at,
        },
      );
    },
  );
  await t.test(
    'F056 eligible default set and clear affect only assignment revision and preserve existing requests',
    async () => {
      const result = await request(api)
        .get(`${path}/${issue.id}/assignment-targets`)
        .set('Authorization', `Bearer ${actor}`)
        .expect(200);
      const options = (
        result.body as {
          items: { type: 'staff' | 'role' | 'group'; id: string }[];
        }
      ).items;
      assert.ok(options.length > 0);
      const target = present(options[0]);
      const before = issue;
      issue = (
        (
          await patch(issue.id, {
            ...body(issue),
            defaultAssignment: { type: target.type, id: target.id },
          }).expect(200)
        ).body as { issue: IssueProjection }
      ).issue;
      assert.equal(issue.assignmentRevision, before.assignmentRevision + 1);
      assert.equal(issue.coreRevision, before.coreRevision);
      assert.equal(issue.policyRevision, before.policyRevision);
      assert.equal(issue.defaultAssignment?.id, target.id);
      issue = (
        (
          await patch(issue.id, {
            ...body(issue),
            defaultAssignment: null,
          }).expect(200)
        ).body as { issue: IssueProjection }
      ).issue;
      assert.equal(issue.assignmentRevision, before.assignmentRevision + 2);
      assert.equal(issue.coreRevision, before.coreRevision);
      assert.equal(issue.defaultAssignment, null);
      assert.deepEqual(await requests(), previousRequests);
    },
  );
  await t.test(
    'F056 audit is append-only and retained configuration blocks rollback',
    async () => {
      await assert.rejects(
        db.transaction().execute(down),
        /Retained Issue configuration/,
      );
      await assert.rejects(
        sql`update issue_configuration_audit set action='changed'`.execute(db),
        /append-only/,
      );
      await assert.rejects(
        sql`delete from issue_configuration_audit`.execute(db),
        /append-only/,
      );
      await assert.rejects(
        sql`truncate issue_configuration_audit`.execute(db),
        /append-only/,
      );
      assert.ok((await auditCount()) > 0);
    },
  );
  await checkAdminIssueDiscovery(t, {
    db,
    app,
    org,
    actor,
    logs: c.logs,
    templateId: template.id,
  });
  await t.test(
    'F056 normal logs exclude mutation bodies, selected identities and descriptions',
    () => {
      const logs = c.logs.join('\n');
      for (const sensitive of [
        create.description,
        'Updated fictional description',
        'Must roll back',
        'F056 never persisted',
        actor,
      ])
        assert.ok(!logs.includes(sensitive));
    },
  );
}
