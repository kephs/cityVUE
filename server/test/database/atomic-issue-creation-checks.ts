import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { sql, type Kysely } from 'kysely';
import request from 'supertest';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import type { IssueProjection } from '../../src/admin/admin-issue.service.js';
import { reviewedCreation } from './issue-creation-fixture.js';

export async function checkAtomicIssueCreation(
  t: TestContext,
  c: {
    db: Kysely<DatabaseSchema>;
    app: INestApplication;
    org: string;
    actor: string;
    role: string;
  },
) {
  const { db, org, actor, role } = c,
    api = c.app.getHttpServer() as Server,
    path = '/api/v1/admin/issues';
  const category = await db
    .selectFrom('category')
    .selectAll()
    .where('organization_id', '=', org)
    .where('status', '=', 'active')
    .executeTakeFirstOrThrow();
  for (const permission of [
    'admin.configuration.read',
    'admin.issues.write',
    'catalog.issue_action.manage',
  ] as const)
    await db
      .insertInto('role_permission')
      .values({
        organization_id: org,
        role_id: role,
        permission_key: permission,
      })
      .onConflict((x) => x.doNothing())
      .execute();
  await sql`insert into staff_department_membership(organization_id,staff_identity_id,department_id,active) values(${org},${actor},${category.department_id},true) on conflict(staff_identity_id,department_id) do update set active=true`.execute(
    db,
  );
  if (category.division_id)
    await sql`insert into staff_division_membership(organization_id,staff_identity_id,department_id,division_id,active) values(${org},${actor},${category.department_id},${category.division_id},true) on conflict(staff_identity_id,division_id) do update set active=true`.execute(
      db,
    );
  const post = (body: object) =>
    request(api).post(path).set('Authorization', `Bearer ${actor}`).send(body);
  const get = (suffix: string) =>
    request(api)
      .get(`${path}/creation/${suffix}`)
      .set('Authorization', `Bearer ${actor}`);
  const base = () => ({
    categoryId: category.id,
    name: `F056.5 atomic ${randomUUID()}`,
    description: 'Fictional atomic configuration',
    defaultPriority: 'high',
    locationPolicy: 'required',
    geographicEligibilityMode: 'no_geographic_restriction',
    availability: 'EXTERNAL_ONLY',
    handling: { actionType: 'internal_intake' },
    requesterPolicy: 'IDENTIFIED_REQUIRED',
    defaultAssignment: null,
    displayOrder: 0,
    questions: [] as unknown[],
  });
  const redirect = {
    actionType: 'external_redirect',
    destination: 'https://example.org/service?synthetic=atomic',
    message: 'Use the external service.',
    label: 'Continue',
  };
  const question = (type = 'short_text') => ({
    key: null,
    prompt: 'Fictional question',
    help: type === 'information' ? '' : 'Optional help',
    type,
    required: type !== 'information',
    order: 0,
    options: [],
  });
  const tables = [
    'service_definition',
    'service_definition_version',
    'question',
    'question_option',
    'issue_requester_identity_policy',
    'issue_requester_identity_audit',
    'issue_default_assignment',
    'issue_default_assignment_audit',
    'issue_action_history',
    'issue_action_audit',
    'issue_configuration_audit',
    'service_request',
    'answer',
  ];
  const fingerprint = async () =>
    Promise.all(
      tables.map(
        async (table) =>
          (
            await sql<{
              hash: string | null;
            }>`select md5(string_agg(h,'' order by h)) as hash from (select md5(row_to_json(t)::text) h from ${sql.table(table)} t) x`.execute(
              db,
            )
          ).rows[0]?.hash,
      ),
    );
  const reject = async (body: object, status = 400) => {
    const before = await fingerprint();
    await post(body).expect(status);
    assert.deepEqual(await fingerprint(), before);
  };
  let made: IssueProjection;
  await t.test(
    'F056.5 blank complete creation initializes neutral fields and independent revisions',
    async () => {
      const body = base();
      made = ((await post(body).expect(201)).body as { issue: IssueProjection })
        .issue;
      assert.equal(made.active, false);
      assert.equal(made.coreRevision, 2);
      assert.equal(made.actionRevision, 1);
      assert.equal(made.policyRevision, 1);
      assert.equal(made.assignmentRevision, 0);
      assert.deepEqual(made.questions, []);
      assert.ok(made.catalogVersionId);
      const version = await db
        .selectFrom('service_definition_version')
        .selectAll()
        .where('id', '=', made.catalogVersionId)
        .executeTakeFirstOrThrow();
      assert.equal(version.default_priority, 'high');
      assert.equal(version.location_policy, 'required');
      assert.equal(
        version.geographic_eligibility_mode,
        'no_geographic_restriction',
      );
      assert.equal(version.geographic_eligibility_policy_reference, null);
      assert.equal(version.icon_key, 'file-earmark-text');
      assert.deepEqual(version.aliases, []);
      assert.deepEqual(version.keywords, []);
      assert.equal(version.routing_metadata, null);
      assert.equal(version.unable_to_determine_behavior, 'block');
      assert.equal(version.version_number, 1);
    },
  );
  await t.test(
    'F056.5 every Availability/Handling combination uses existing matrix atomically',
    async () => {
      for (const availability of [
        'INTERNAL_ONLY',
        'INTERNAL_AND_EXTERNAL',
        'EXTERNAL_ONLY',
      ]) {
        await post({ ...base(), availability }).expect(201);
        if (availability !== 'EXTERNAL_ONLY')
          await reject({ ...base(), availability, handling: redirect });
        else {
          const issue = (
            (
              await post({
                ...base(),
                availability,
                handling: redirect,
              }).expect(201)
            ).body as { issue: IssueProjection }
          ).issue;
          assert.equal(issue.actionType, 'external_redirect');
          assert.equal(issue.actionRevision, 2);
          assert.equal(issue.coreRevision, 2);
          const history = (
            await sql<{
              action_revision: number;
            }>`select action_revision from issue_action_history where issue_id=${issue.id}`.execute(
              db,
            )
          ).rows;
          assert.equal(history.length, 1);
          assert.equal(history[0]?.action_revision, 2);
          const audit = (
            await sql<{
              destination_hostname: string;
            }>`select destination_hostname from issue_action_audit where issue_id=${issue.id}`.execute(
              db,
            )
          ).rows[0];
          assert.ok(audit);
          assert.equal(audit.destination_hostname, 'example.org');
        }
      }
    },
  );
  await t.test(
    'F056.5 required decisions, strict fields, unsupported geography and contradictory handoff reject without artifacts',
    async () => {
      for (const key of [
        'categoryId',
        'defaultPriority',
        'locationPolicy',
        'geographicEligibilityMode',
        'availability',
        'handling',
        'questions',
      ]) {
        const body: Record<string, unknown> = base();
        await reject(
          Object.fromEntries(
            Object.entries(body).filter(([field]) => field !== key),
          ),
        );
      }
      for (const extra of [
        { defaultPriority: 'normal' },
        { locationPolicy: 'sometimes' },
        { geographicEligibilityMode: 'city_boundary' },
        {
          geographicEligibilityMode: 'service_area',
          locationPolicy: 'optional',
        },
        { organizationId: org },
        { actorId: actor },
        { iconKey: 'arbitrary' },
        { geographicEligibilityPolicyReference: 'invented' },
        { expectedSourceVersion: randomUUID() },
        {
          handling: {
            actionType: 'internal_intake',
            destination: 'https://example.org',
          },
        },
        {
          handling: {
            actionType: 'external_redirect',
            destination: 'https://example.org',
          },
        },
        { handling: { ...redirect, destination: 'http://localhost' } },
      ])
        await reject({ ...base(), ...extra });
    },
  );
  await t.test(
    'F056.5 redirect requires existing action permission and Category scope before any creation',
    async () => {
      await db
        .deleteFrom('role_permission')
        .where('role_id', '=', role)
        .where('permission_key', '=', 'catalog.issue_action.manage')
        .execute();
      try {
        await reject({ ...base(), handling: redirect }, 403);
        await post(base()).expect(201);
      } finally {
        await db
          .insertInto('role_permission')
          .values({
            organization_id: org,
            role_id: role,
            permission_key: 'catalog.issue_action.manage',
          })
          .execute();
      }
      await db
        .updateTable('staff_department_membership')
        .set({ active: false })
        .where('staff_identity_id', '=', actor)
        .where('department_id', '=', category.department_id)
        .execute();
      try {
        await reject({ ...base(), handling: redirect }, 403);
      } finally {
        await db
          .updateTable('staff_department_membership')
          .set({ active: true })
          .where('staff_identity_id', '=', actor)
          .where('department_id', '=', category.department_id)
          .execute();
      }
    },
  );
  await t.test(
    'F056.5 new questions use supported types, keys, options and no submitted answers',
    async () => {
      const before = await db.selectFrom('answer').selectAll().execute();
      const questions = [
        'short_text',
        'single_select',
        'multi_select',
        'date',
        'information',
      ].map((type, order) => ({
        ...question(type),
        order,
        options: ['single_select', 'multi_select'].includes(type)
          ? [
              { key: null, label: 'One', order: 0 },
              { key: null, label: 'Two', order: 1 },
            ]
          : [],
      }));
      const issue = (
        (await post({ ...base(), questions }).expect(201)).body as {
          issue: IssueProjection;
        }
      ).issue;
      assert.ok(issue.questions);
      assert.equal(issue.questions.length, 5);
      assert.ok(
        issue.questions.every(
          (q) => q.key && q.condition === null && q.validation === null,
        ),
      );
      assert.equal(issue.questions[4]?.required, false);
      assert.deepEqual(
        await db.selectFrom('answer').selectAll().execute(),
        before,
      );
      for (const questions of [
        [question('timestamp')],
        [{ ...question(), key: randomUUID() }],
        Array.from({ length: 26 }, (_, order) => ({ ...question(), order })),
        [{ ...question(), prompt: 'x'.repeat(201) }],
        [{ ...question('single_select'), options: [] }],
        [{ ...question('information'), required: true }],
      ])
        await reject({ ...base(), questions });
    },
  );
  await t.test(
    'F056.5 Category lookup is bounded, scoped, active, literal-search and read-only; assignment is Category based',
    async () => {
      const before = await fingerprint();
      const found = (
        await get(
          'categories?search=' + encodeURIComponent(category.name),
        ).expect(200)
      ).body as { items: { id: string; canManageHandling: boolean }[] };
      assert.ok(
        found.items.some((x) => x.id === category.id && x.canManageHandling),
      );
      assert.ok(found.items.length <= 25);
      assert.deepEqual(
        (
          (await get('categories?search=%25').expect(200)).body as {
            items: unknown[];
          }
        ).items,
        [],
      );
      await get('categories?search=' + 'x'.repeat(101)).expect(400);
      await request(api).get(`${path}/creation/categories`).expect(401);
      await get(`assignment-targets?categoryId=${category.id}`).expect(200);
      await get(`assignment-targets?categoryId=${randomUUID()}`).expect(400);
      assert.deepEqual(await fingerprint(), before);
    },
  );
  await t.test(
    'F056.5 stale Category and stale assignment reject atomically',
    async () => {
      await db
        .updateTable('category')
        .set({ status: 'inactive' })
        .where('id', '=', category.id)
        .execute();
      try {
        await reject(base());
      } finally {
        await db
          .updateTable('category')
          .set({ status: 'active' })
          .where('id', '=', category.id)
          .execute();
      }
      await reject({
        ...base(),
        defaultAssignment: { type: 'staff', id: randomUUID() },
      });
    },
  );
  await t.test(
    'F056.5 source snapshot version, eligibility, Category and identity are authoritative',
    async () => {
      await db
        .updateTable('service_definition')
        .set({ status: 'active' })
        .where('id', '=', made.id)
        .execute();
      const source = (
        (await get(`sources/${made.id}?categoryId=${category.id}`).expect(200))
          .body as { source: { catalogVersionId: string } }
      ).source;
      assert.equal(source.catalogVersionId, made.catalogVersionId);
      const copied = {
        ...base(),
        ...(await reviewedCreation(db, org, made.id)),
        templateId: made.id,
      };
      const issue = (
        (await post(copied).expect(201)).body as { issue: IssueProjection }
      ).issue;
      assert.notEqual(issue.catalogVersionId, made.catalogVersionId);
      assert.equal(issue.assignmentRevision, 0);
      await reject(
        { ...copied, name: randomUUID(), expectedSourceVersion: randomUUID() },
        409,
      );
      await reject({ ...copied, name: randomUUID(), templateId: randomUUID() });
      await reject({ ...copied, name: randomUUID(), categoryId: randomUUID() });
      await db
        .updateTable('service_definition')
        .set({ status: 'inactive' })
        .where('id', '=', made.id)
        .execute();
      try {
        await reject({ ...copied, name: randomUUID() });
      } finally {
        await db
          .updateTable('service_definition')
          .set({ status: 'active' })
          .where('id', '=', made.id)
          .execute();
      }
      const redirectIssue = (
        (await post({ ...base(), handling: redirect }).expect(201)).body as {
          issue: IssueProjection;
        }
      ).issue;
      await db
        .updateTable('service_definition')
        .set({ status: 'active' })
        .where('id', '=', redirectIssue.id)
        .execute();
      await reject({
        ...copied,
        name: randomUUID(),
        templateId: redirectIssue.id,
        expectedSourceVersion: redirectIssue.catalogVersionId,
      });
      await get(`sources/${redirectIssue.id}?categoryId=${category.id}`).expect(
        400,
      );
      const eligible = (
        await get(`sources?categoryId=${category.id}`).expect(200)
      ).body as { items: { id: string }[] };
      assert.ok(!eligible.items.some((item) => item.id === redirectIssue.id));
    },
  );
  const roleTarget = randomUUID();
  await db
    .insertInto('operational_role')
    .values({
      id: roleTarget,
      organization_id: org,
      department_id: category.department_id,
      division_id: category.division_id,
      name: 'Fictional atomic target',
      active: true,
    })
    .execute();
  await t.test(
    'F056.5 inactive assignment targets reject before creation',
    async () => {
      await db
        .updateTable('operational_role')
        .set({ active: false })
        .where('id', '=', roleTarget)
        .execute();
      try {
        await reject({
          ...base(),
          defaultAssignment: { type: 'role', id: roleTarget },
        });
      } finally {
        await db
          .updateTable('operational_role')
          .set({ active: true })
          .where('id', '=', roleTarget)
          .execute();
      }
    },
  );
  await t.test(
    'F056.5 F032 action update failure rolls back complete creation',
    async () => {
      const before = await fingerprint();
      await sql`create function reject_atomic_action() returns trigger language plpgsql as $$ begin if new.action_type = 'external_redirect' then raise exception 'synthetic action failure'; end if; return new; end $$`.execute(
        db,
      );
      await sql`create trigger reject_atomic_action before update on service_definition for each row execute function reject_atomic_action()`.execute(
        db,
      );
      try {
        await post({ ...base(), handling: redirect }).expect(500);
      } finally {
        await sql`drop trigger reject_atomic_action on service_definition`.execute(
          db,
        );
        await sql`drop function reject_atomic_action()`.execute(db);
      }
      assert.deepEqual(await fingerprint(), before);
    },
  );
  for (const table of [
    'service_definition',
    'service_definition_version',
    'question',
    'question_option',
    'issue_requester_identity_policy',
    'issue_requester_identity_audit',
    'issue_default_assignment',
    'issue_default_assignment_audit',
    'issue_action_history',
    'issue_action_audit',
    'issue_configuration_audit',
  ])
    await t.test(
      `F056.5 ${table} insertion failure rolls back every participating artifact`,
      async () => {
        const before = await fingerprint();
        await sql`create function reject_atomic_create() returns trigger language plpgsql as $$ begin raise exception 'synthetic persistence failure'; end $$`.execute(
          db,
        );
        await sql`create trigger reject_atomic before insert on ${sql.table(table)} for each row execute function reject_atomic_create()`.execute(
          db,
        );
        try {
          await post({
            ...base(),
            handling: redirect,
            defaultAssignment: { type: 'role', id: roleTarget },
            questions: [
              {
                ...question('single_select'),
                options: [
                  { key: null, label: 'One', order: 0 },
                  { key: null, label: 'Two', order: 1 },
                ],
              },
            ],
          }).expect(500);
        } finally {
          await sql`drop trigger reject_atomic on ${sql.table(table)}`.execute(
            db,
          );
          await sql`drop function reject_atomic_create()`.execute(db);
        }
        assert.deepEqual(await fingerprint(), before);
      },
    );
}
