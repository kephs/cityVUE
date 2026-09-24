import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { sql, type Kysely } from 'kysely';
import request from 'supertest';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import {
  up,
  down,
} from '../../migrations/20261004000000-protect-dynamic-questions-answers.js';
import { AdminIssueService } from '../../src/admin/admin-issue.service.js';
import { RequestAnswerService } from '../../src/service-request/request-answer.service.js';
import type { StaffAccess } from '../../src/auth/auth.types.js';

function required<T>(value: T | null | undefined): T {
  assert.ok(value !== null && value !== undefined);
  return value;
}
export async function checkDynamicQuestions(
  t: TestContext,
  c: {
    db: Kysely<DatabaseSchema>;
    app: INestApplication;
    org: string;
    actor: string;
    role: string;
  },
) {
  const { db, app, org, actor, role } = c,
    api = app.getHttpServer() as Server;
  const original = await db
    .selectFrom('answer')
    .selectAll()
    .orderBy('id')
    .execute();
  await t.test(
    'F056.2A migration apply rollback reapply preserves historical answers and grants nothing',
    async () => {
      await db.transaction().execute(up);
      await db.transaction().execute(down);
      assert.deepEqual(
        await db.selectFrom('answer').selectAll().orderBy('id').execute(),
        original,
      );
      await db.transaction().execute(up);
      assert.equal(
        (
          await db
            .selectFrom('role_permission')
            .selectAll()
            .where('permission_key', '=', 'service_request.answers.read')
            .execute()
        ).length,
        0,
      );
    },
  );
  const current = await db
    .selectFrom('service_definition')
    .selectAll()
    .where('organization_id', '=', org)
    .where('status', '=', 'active')
    .where('action_type', '=', 'internal_intake')
    .executeTakeFirstOrThrow();
  const version = required(current.current_published_version_id);
  const issueService = app.get(AdminIssueService);
  const staff = await db
    .selectFrom('staff_identity')
    .selectAll()
    .where('id', '=', actor)
    .executeTakeFirstOrThrow();
  const access: StaffAccess = {
    organizationId: org,
    staffIdentityId: actor,
    tenantId: staff.entra_tenant_id,
    objectId: staff.entra_object_id,
    displayName: 'Fictional author',
    scopes: [],
    departmentIds: [],
    divisionIds: [],
    development: false,
    permissions: ['admin.configuration.read', 'admin.issues.write'],
  };
  let issue = (await issueService.detail(access, current.id)).issue;
  const payload = () => ({
    name: issue.name,
    description: issue.description,
    displayOrder: issue.displayOrder,
    active: issue.active,
    requesterPolicy: issue.requesterPolicy,
    defaultAssignment: issue.defaultAssignment
      ? { type: issue.defaultAssignment.type, id: issue.defaultAssignment.id }
      : null,
    expectedCoreRevision: issue.coreRevision,
    expectedActionRevision: issue.actionRevision,
    expectedPolicyRevision: issue.policyRevision,
    expectedAssignmentRevision: issue.assignmentRevision,
  });
  const wire = (qs: NonNullable<typeof issue.questions>) =>
    qs.map(({ key, prompt, help, type, required, order, options }) => ({
      key,
      prompt,
      help,
      type,
      required,
      order,
      options,
    }));
  await t.test(
    'F056.2A atomic authoring publishes new child identities and rejects stale schema saves',
    async () => {
      const before = payload();
      const next = [
        ...wire(issue.questions),
        {
          key: null,
          prompt: 'Fictional protected response',
          help: 'Synthetic help',
          type: 'single_select',
          required: false,
          order: 100,
          options: [
            { key: null, label: 'Choice A', order: 0 },
            { key: null, label: 'Choice B', order: 1 },
          ],
        },
      ];
      const replies = await Promise.all([
        request(api)
          .patch(`/api/v1/admin/issues/${current.id}`)
          .set('Authorization', `Bearer ${actor}`)
          .send({ ...before, questions: next }),
        request(api)
          .patch(`/api/v1/admin/issues/${current.id}`)
          .set('Authorization', `Bearer ${actor}`)
          .send({ ...before, questions: next }),
      ]);
      assert.deepEqual(replies.map((r) => r.status).sort(), [200, 409]);
      issue = (await issueService.detail(access, current.id)).issue;
      assert.equal(issue.coreRevision, before.expectedCoreRevision + 1);
      assert.ok(
        issue.questions.some(
          (q) => q.prompt === 'Fictional protected response',
        ),
      );
      assert.equal(
        (
          await db
            .selectFrom('service_definition_version')
            .select('id')
            .where('id', '=', version)
            .execute()
        ).length,
        1,
      );
      const unchanged = await request(api)
        .patch(`/api/v1/admin/issues/${current.id}`)
        .set('Authorization', `Bearer ${actor}`)
        .send({ ...payload(), questions: wire(issue.questions) })
        .expect(200);
      assert.equal((unchanged.body as { changed: boolean }).changed, false);
    },
  );
  const latest = (
    await db
      .selectFrom('service_definition')
      .select('current_published_version_id')
      .where('id', '=', current.id)
      .executeTakeFirstOrThrow()
  ).current_published_version_id;
  assert.ok(latest);
  const q = await db
    .selectFrom('question')
    .selectAll()
    .where('service_definition_version_id', '=', latest)
    .where('label', '=', 'Fictional protected response')
    .executeTakeFirstOrThrow();
  const o = await db
    .selectFrom('question_option')
    .selectAll()
    .where('question_id', '=', q.id)
    .executeTakeFirstOrThrow();
  await t.test(
    'F056.2A database rejects published child update delete insert and reparent',
    async () => {
      await assert.rejects(
        db
          .updateTable('question')
          .set({ label: 'Forbidden' })
          .where('id', '=', q.id)
          .execute(),
      );
      await assert.rejects(
        db.deleteFrom('question').where('id', '=', q.id).execute(),
      );
      await assert.rejects(
        db
          .insertInto('question')
          .values({
            ...q,
            id: randomUUID(),
            question_key: randomUUID(),
            display_order: 1000,
          })
          .execute(),
      );
      await assert.rejects(
        db
          .updateTable('question_option')
          .set({ label: 'Forbidden' })
          .where('id', '=', o.id)
          .execute(),
      );
      await assert.rejects(
        db.deleteFrom('question_option').where('id', '=', o.id).execute(),
      );
      await assert.rejects(
        db
          .insertInto('question_option')
          .values({
            ...o,
            id: randomUUID(),
            option_key: randomUUID(),
            display_order: 1000,
          })
          .execute(),
      );
      await assert.rejects(
        db
          .updateTable('question')
          .set({ service_definition_version_id: version })
          .where('id', '=', q.id)
          .execute(),
      );
    },
  );
  await t.test(
    'F056.2A protected endpoint denies missing permission without metadata and with no-store',
    async () => {
      const response = await request(api)
        .get(`/api/v1/staff/service-requests/${randomUUID()}/answers`)
        .set('Authorization', `Bearer ${actor}`)
        .expect(403);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal('answers' in response.body, false);
      const legacy = await db
        .selectFrom('service_request')
        .select('id')
        .where('organization_id', '=', org)
        .where('audience', '=', 'public')
        .executeTakeFirstOrThrow();
      await db
        .insertInto('role_permission')
        .values({
          organization_id: org,
          role_id: role,
          permission_key: 'service_request.answers.read',
        })
        .execute();
      await request(api)
        .get(`/api/v1/staff/service-requests/${legacy.id}/answers`)
        .set('Authorization', `Bearer ${actor}`)
        .expect(403);
      await db
        .deleteFrom('role_permission')
        .where('role_id', '=', role)
        .where('permission_key', '=', 'service_request.answers.read')
        .execute();
    },
  );
  await t.test(
    'F056.2A answers immutable and historical values unchanged',
    async () => {
      if (original.length) {
        await assert.rejects(
          db
            .updateTable('answer')
            .set({ question_label: 'Forbidden' })
            .where('id', '=', required(original[0]).id)
            .execute(),
        );
        await assert.rejects(
          db
            .deleteFrom('answer')
            .where('id', '=', required(original[0]).id)
            .execute(),
        );
      }
      const rows = (
        await sql<
          Record<string, unknown>
        >`select to_jsonb(a)-'catalog_version_id' as record from answer a order by id`.execute(
          db,
        )
      ).rows;
      assert.equal(rows.length, original.length);
      // compare through PostgreSQL JSON representations to avoid driver timestamp differences.
      for (const row of original) {
        const after = await db
          .selectFrom('answer')
          .selectAll()
          .where('id', '=', row.id)
          .executeTakeFirstOrThrow();
        for (const key of Object.keys(row) as (keyof typeof row)[])
          assert.deepEqual(after[key], row[key]);
      }
    },
  );
  await t.test(
    'F056.2A parent scope plus separate permission, audit commit, failure and no alternate disclosure',
    async () => {
      const parent = await db
        .selectFrom('service_request')
        .selectAll()
        .where('organization_id', '=', org)
        .where('audience', '=', 'public')
        .executeTakeFirstOrThrow();
      await sql`insert into staff_department_membership(organization_id,staff_identity_id,department_id)
      select ${org},${actor},id from department where organization_id=${org} on conflict do nothing`.execute(
        db,
      );
      await sql`insert into staff_division_membership(organization_id,staff_identity_id,department_id,division_id)
      select ${org},${actor},department_id,id from division where organization_id=${org} and department_id is not null on conflict do nothing`.execute(
        db,
      );
      const grant = async (permission: string) =>
        sql`insert into role_permission(organization_id,role_id,permission_key) values(${org},${role},${permission}) on conflict do nothing`.execute(
          db,
        );
      await grant('service_request.view');
      const root = `/api/v1/staff/service-requests/${parent.id}`;
      const legacy = await request(api)
        .get(`/api/v1/service-requests/${parent.id}`)
        .set('Authorization', `Bearer ${actor}`)
        .expect(200);
      assert.equal('answers' in legacy.body, false);
      assert.equal(
        (legacy.body as { canReadAnswers: boolean }).canReadAnswers,
        false,
      );
      await request(api)
        .get(`${root}/answers`)
        .set('Authorization', `Bearer ${actor}`)
        .expect(403);
      await grant('service_request.answers.read');
      const count = async () =>
        (
          await sql<{
            n: number;
          }>`select count(*)::int as n from request_answer_read_audit`.execute(
            db,
          )
        ).rows[0]?.n ?? 0;
      const before = await count();
      const response = await request(api)
        .get(`${root}/answers`)
        .set('Authorization', `Bearer ${actor}`)
        .expect(200);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal(await count(), before + 1);
      assert.ok(
        Array.isArray((response.body as { answers: unknown[] }).answers),
      );
      const audit = (
        await sql<
          Record<string, unknown>
        >`select * from request_answer_read_audit order by occurred_at desc limit 1`.execute(
          db,
        )
      ).rows[0];
      assert.ok(audit);
      assert.deepEqual(
        Object.keys(audit).sort(),
        [
          'id',
          'organization_id',
          'service_request_id',
          'staff_identity_id',
          'correlation_id',
          'action',
          'occurred_at',
        ].sort(),
      );
      for (const path of [`/api/v1/service-requests/${parent.id}`, root]) {
        const ordinary = await request(api)
          .get(path)
          .set('Authorization', `Bearer ${actor}`)
          .expect(200);
        assert.equal('answers' in ordinary.body, false);
      }
      const foreign = await db
        .selectFrom('service_request')
        .select('id')
        .where('organization_id', '!=', org)
        .executeTakeFirstOrThrow();
      await request(api)
        .get(`/api/v1/staff/service-requests/${foreign.id}/answers`)
        .set('Authorization', `Bearer ${actor}`)
        .expect(404);
      const internal = await db
        .selectFrom('service_request')
        .select('id')
        .where('organization_id', '=', org)
        .where('audience', '=', 'internal')
        .executeTakeFirstOrThrow();
      await request(api)
        .get(`/api/v1/staff/service-requests/${internal.id}/answers`)
        .set('Authorization', `Bearer ${actor}`)
        .expect(404);
      await grant('service_request.internal.read');
      await request(api)
        .get(`/api/v1/staff/service-requests/${internal.id}/answers`)
        .set('Authorization', `Bearer ${actor}`)
        .expect(200);
      await sql`create function deny_answer_audit() returns trigger language plpgsql as $$ begin raise exception 'Synthetic audit failure'; end $$;
      create trigger fail_answer_audit before insert on request_answer_read_audit for each row execute function deny_answer_audit()`.execute(
        db,
      );
      const failedCount = await count();
      try {
        const denied = await request(api)
          .get(`${root}/answers`)
          .set('Authorization', `Bearer ${actor}`)
          .expect(500);
        assert.equal('answers' in denied.body, false);
        assert.equal(denied.headers['cache-control'], 'no-store');
        assert.equal(await count(), failedCount);
      } finally {
        await sql`drop trigger fail_answer_audit on request_answer_read_audit; drop function deny_answer_audit()`.execute(
          db,
        );
      }
      await assert.rejects(db.transaction().execute(down));
    },
  );
  await t.test(
    'F056.2A draft child mutation and publication serialize at the version boundary',
    async () => {
      const draft = randomUUID();
      await sql`insert into service_definition_version select * from jsonb_populate_record(null::service_definition_version,
      (select to_jsonb(v)||jsonb_build_object('id',${draft}::text,'status','draft','published_at',null,'version_number',5000) from service_definition_version v where id=${latest}))`.execute(
        db,
      );
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>((r) => {
          release = r;
        }),
        reached = new Promise<void>((r) => {
          entered = r;
        });
      const child = db.transaction().execute(async (trx) => {
        await trx
          .insertInto('question')
          .values({
            ...q,
            id: randomUUID(),
            service_definition_version_id: draft,
            question_key: randomUUID(),
          })
          .execute();
        entered();
        await gate;
      });
      await reached;
      let published = false;
      const publish = db
        .updateTable('service_definition_version')
        .set({ status: 'published', published_at: new Date() })
        .where('id', '=', draft)
        .execute()
        .then(() => {
          published = true;
        });
      try {
        await new Promise((r) => setTimeout(r, 30));
        assert.equal(published, false);
      } finally {
        release();
      }
      await child;
      await publish;
      await assert.rejects(
        db
          .insertInto('question')
          .values({
            ...q,
            id: randomUUID(),
            service_definition_version_id: draft,
            question_key: randomUUID(),
            display_order: 222,
          })
          .execute(),
      );
    },
  );
  await t.test(
    'F056.2A maximum question fixture submits and reads historical snapshots after publication',
    async () => {
      const schema = Array.from({ length: 25 }, (_, i) => ({
        key: null,
        prompt: `Synthetic question ${String(i + 1)}`,
        help: '',
        type: 'long_text',
        required: true,
        order: i,
        options: [],
      }));
      const started = performance.now();
      const changed = await request(api)
        .patch(`/api/v1/admin/issues/${current.id}`)
        .set('Authorization', `Bearer ${actor}`)
        .send({ ...payload(), questions: schema })
        .expect(200);
      issue = (changed.body as { issue: typeof issue }).issue;
      const catalog = await request(api)
        .get(`/api/v1/catalog/issues/${current.id}`)
        .expect(200);
      assert.equal(
        (catalog.body as { questions: unknown[] }).questions.length,
        25,
      );
      // Use the authoritative stable pointer, not assumptions about projection naming.
      const stable = await db
        .selectFrom('service_definition')
        .select('current_published_version_id')
        .where('id', '=', current.id)
        .executeTakeFirstOrThrow();
      const v = await db
        .selectFrom('service_definition_version')
        .selectAll()
        .where('id', '=', required(stable.current_published_version_id))
        .executeTakeFirstOrThrow();
      const qs = await db
        .selectFrom('question')
        .select(['id', 'label'])
        .where('service_definition_version_id', '=', v.id)
        .orderBy('display_order')
        .execute();
      assert.equal(qs.length, 25);
      const input = {
        serviceDefinitionId: current.id,
        serviceDefinitionVersionId: v.id,
        description: 'Synthetic maximum schema request',
        reportingIdentity: 'identified',
        contact: { name: 'Fictional requester' },
        answers: qs.map((q) => ({
          questionId: q.id,
          value: 'Synthetic bounded response',
        })),
        ...(v.location_policy === 'not_applicable'
          ? {}
          : { location: { enteredAddress: 'Fictional test location' } }),
      };
      const snapshot = async () =>
        (
          await sql<{ state: unknown }>`select jsonb_build_object(
      'requests',(select count(*) from service_request),'answers',(select count(*) from answer),
      'contact',(select count(*) from requester_contact),'location',(select count(*) from location),
      'activity',(select count(*) from activity),'operational',(select count(*) from request_operational_activity),
      'assignment',(select count(*) from service_request_assignment)) as state`.execute(
            db,
          )
        ).rows[0]?.state;
      const before = await snapshot();
      await request(api)
        .post('/api/v1/service-requests')
        .send({ ...input, answers: [] })
        .expect(400);
      await request(api)
        .post('/api/v1/service-requests')
        .send({ ...input, answers: [...input.answers, input.answers[0]] })
        .expect(400);
      await request(api)
        .post('/api/v1/service-requests')
        .send({
          ...input,
          answers: [{ questionId: randomUUID(), value: 'Unknown' }],
        })
        .expect(400);
      await request(api)
        .post('/api/v1/service-requests')
        .send({
          ...input,
          answers: [
            ...input.answers.slice(1),
            { questionId: required(qs[0]).id, value: 'x'.repeat(2001) },
          ],
        })
        .expect(400);
      assert.deepEqual(await snapshot(), before);
      // Each long answer is individually valid; only the aggregate limit rejects this.
      await request(api)
        .post('/api/v1/service-requests')
        .send({
          ...input,
          answers: qs.map((question) => ({
            questionId: question.id,
            value: 'x'.repeat(1400),
          })),
        })
        .expect(400);
      assert.deepEqual(await snapshot(), before);
      await sql`create function deny_answer_insert() returns trigger language plpgsql as $$ begin raise exception 'Synthetic answer failure'; end $$;
      create trigger fail_answer_insert before insert on answer for each row execute function deny_answer_insert()`.execute(
        db,
      );
      try {
        await request(api)
          .post('/api/v1/service-requests')
          .send(input)
          .expect(500);
        assert.deepEqual(await snapshot(), before);
      } finally {
        await sql`drop trigger fail_answer_insert on answer;drop function deny_answer_insert()`.execute(
          db,
        );
      }
      const created = await request(api)
        .post('/api/v1/service-requests')
        .send(input)
        .expect(201);
      const read = await request(api)
        .get(
          `/api/v1/staff/service-requests/${(created.body as { id: string }).id}/answers`,
        )
        .set('Authorization', `Bearer ${actor}`)
        .expect(200);
      assert.equal((read.body as { answers: unknown[] }).answers.length, 25);
      const renamed = wire(issue.questions);
      required(renamed[0]).prompt = 'Changed current wording';
      const versionCount = await db
        .selectFrom('service_definition_version')
        .select('id')
        .execute();
      await sql`create function deny_question_audit() returns trigger language plpgsql as $$ begin raise exception 'Synthetic schema audit failure'; end $$;
      create trigger fail_question_audit before insert on issue_configuration_audit for each row execute function deny_question_audit()`.execute(
        db,
      );
      try {
        await request(api)
          .patch(`/api/v1/admin/issues/${current.id}`)
          .set('Authorization', `Bearer ${actor}`)
          .send({ ...payload(), questions: renamed })
          .expect(500);
        assert.equal(
          (
            await db
              .selectFrom('service_definition_version')
              .select('id')
              .execute()
          ).length,
          versionCount.length,
        );
        assert.equal(
          (await issueService.detail(access, current.id)).issue.coreRevision,
          issue.coreRevision,
        );
      } finally {
        await sql`drop trigger fail_question_audit on issue_configuration_audit;drop function deny_question_audit()`.execute(
          db,
        );
      }
      const edited = await request(api)
        .patch(`/api/v1/admin/issues/${current.id}`)
        .set('Authorization', `Bearer ${actor}`)
        .send({ ...payload(), questions: renamed })
        .expect(200);
      issue = (edited.body as { issue: typeof issue }).issue;
      await request(api)
        .post('/api/v1/service-requests')
        .send(input)
        .expect(409);
      const historical = await request(api)
        .get(
          `/api/v1/staff/service-requests/${(created.body as { id: string }).id}/answers`,
        )
        .set('Authorization', `Bearer ${actor}`)
        .expect(200);
      assert.deepEqual(historical.body, read.body);
      const answer = await db
        .selectFrom('answer')
        .selectAll()
        .where('service_request_id', '=', (created.body as { id: string }).id)
        .executeTakeFirstOrThrow();
      await assert.rejects(
        db
          .insertInto('answer')
          .values({
            ...answer,
            id: randomUUID(),
            question_id: q.id,
            option_key: null,
          })
          .execute(),
      );
      await assert.rejects(
        db
          .insertInto('answer')
          .values({ ...answer, id: randomUUID() })
          .execute(),
      );
      t.diagnostic(
        `F056.2A maximum schema publication/submission/historical read sequence: ${String(Math.round(performance.now() - started))} ms (development test, not production benchmark)`,
      );
    },
  );
  // Referenced here to ensure the real provider is present in the HTTP test application.
  assert.ok(app.get(RequestAnswerService));
}
