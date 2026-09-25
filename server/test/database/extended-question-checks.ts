import { reviewedCreation } from './issue-creation-fixture.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { sql, type Kysely } from 'kysely';
import request from 'supertest';
import sharp from 'sharp';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import {
  AttachmentService,
  type AttachmentClaim,
} from '../../src/attachments/attachment.service.js';
import { LocalAttachmentStorage } from '../../src/attachments/attachment-storage.js';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import type { IssueProjection } from '../../src/admin/admin-issue.service.js';
import {
  up,
  down,
} from '../../migrations/20261006000000-extend-dynamic-question-types.js';

function present<T>(value: T | undefined | null): T {
  assert.ok(value !== undefined && value !== null);
  return value;
}

export async function checkExtendedQuestions(
  t: TestContext,
  c: {
    db: Kysely<DatabaseSchema>;
    app: INestApplication;
    org: string;
    actor: string;
    role: string;
    logs: string[];
  },
) {
  const { db, app, org, actor, role } = c;
  const api = app.getHttpServer() as Server;
  const patch = (id: string, body: object) =>
    request(api)
      .patch(`/api/v1/admin/issues/${id}`)
      .set('Authorization', `Bearer ${actor}`)
      .send(body);
  const grant = (permission: string) =>
    sql`insert into role_permission(organization_id,role_id,permission_key) values(${org},${role},${permission}) on conflict do nothing`.execute(
      db,
    );
  const state = async () =>
    (
      await sql<{ state: unknown }>`select jsonb_build_object(
    'request',(select count(*) from service_request),'answer',(select count(*) from answer),
    'selection',(select count(*) from answer_selected_option),'contact',(select count(*) from requester_contact),
    'location',(select count(*) from location),'assignment',(select count(*) from service_request_assignment),
    'activity',(select count(*) from activity),'operational',(select count(*) from request_operational_activity),
    'requester',(select count(*) from requester),'attachment',(select count(*) from attachment),
    'batch',(select count(*) from attachment_batch)) as state`.execute(db)
    ).rows[0]?.state;
  const original = await db
    .selectFrom('answer')
    .selectAll()
    .orderBy('id')
    .execute();
  await t.test(
    'F056.2C migration apply rollback reapply preserves every historical answer and grants',
    async () => {
      const grants = await db
        .selectFrom('role_permission')
        .selectAll()
        .orderBy('permission_key')
        .orderBy('role_id')
        .execute();
      await db.transaction().execute(up);
      await db.transaction().execute(down);
      assert.deepEqual(
        await db.selectFrom('answer').selectAll().orderBy('id').execute(),
        original,
      );
      await db.transaction().execute(up);
      assert.deepEqual(
        await db
          .selectFrom('role_permission')
          .selectAll()
          .orderBy('permission_key')
          .orderBy('role_id')
          .execute(),
        grants,
      );
      for (const before of original) {
        const after = await db
          .selectFrom('answer')
          .selectAll()
          .where('id', '=', before.id)
          .executeTakeFirstOrThrow();
        for (const key of Object.keys(before) as (keyof typeof before)[])
          assert.deepEqual(after[key], before[key]);
        assert.equal(after.date_value, null);
        assert.equal(after.selected_option_count, null);
      }
    },
  );
  const template = await db
    .selectFrom('service_definition')
    .select('id')
    .where('organization_id', '=', org)
    .where('status', '=', 'active')
    .where('action_type', '=', 'internal_intake')
    .executeTakeFirstOrThrow();
  const create = {
    templateId: template.id,
    ...(await reviewedCreation(db, org, template.id)),
    name: 'Fictional extended question test',
    description: 'Disposable synthetic question fixture',
    availability: 'INTERNAL_AND_EXTERNAL',
    displayOrder: 0,
    requesterPolicy: 'ANONYMOUS_ALLOWED',
    defaultAssignment: null,
  };
  const made = await request(api)
    .post('/api/v1/admin/issues')
    .set('Authorization', `Bearer ${actor}`)
    .send(create)
    .expect(201);
  let issue = (made.body as { issue: IssueProjection }).issue;
  const body = () => ({
    name: issue.name,
    description: issue.description,
    displayOrder: issue.displayOrder,
    active: issue.active,
    requesterPolicy: issue.requesterPolicy,
    defaultAssignment: null,
    expectedCoreRevision: issue.coreRevision,
    expectedActionRevision: issue.actionRevision,
    expectedPolicyRevision: issue.policyRevision,
    expectedAssignmentRevision: issue.assignmentRevision,
  });
  const wire = () => {
    assert.ok(issue.questions);
    return issue.questions.map(
      ({ key, prompt, help, type, required, order, options }) => ({
        key,
        prompt,
        help,
        type,
        required,
        order,
        options,
      }),
    );
  };
  const fresh = (type: string, order: number, required = false) => ({
    key: null,
    prompt: `Synthetic ${type} ${String(order)}`,
    help: '',
    type,
    required,
    order,
    options:
      type === 'multi_select'
        ? ['First', '<b>Second</b>', 'Third'].map((label, order) => ({
            key: null,
            label,
            order,
          }))
        : [],
  });
  await t.test(
    'F056.2C authoring publishes mixed new types, strict metadata, no-op and stale save',
    async () => {
      for (const question of [
        { ...fresh('information', 0), required: true },
        { ...fresh('information', 0), help: 'Not supported' },
        {
          ...fresh('information', 0),
          options: fresh('multi_select', 0).options,
        },
        { ...fresh('date', 0), options: fresh('multi_select', 0).options },
        { ...fresh('date', 0), validation: { min: '2000-01-01' } },
      ])
        await patch(issue.id, { ...body(), questions: [question] }).expect(400);
      const old = body();
      const result = await patch(issue.id, {
        ...old,
        active: true,
        questions: [
          fresh('multi_select', 0, true),
          fresh('date', 1, true),
          fresh('information', 2),
          fresh('multi_select', 3),
          fresh('date', 4),
        ],
      }).expect(200);
      issue = (result.body as { issue: IssueProjection }).issue;
      await patch(issue.id, { ...old, questions: wire() }).expect(409);
      const noop = await patch(issue.id, {
        ...body(),
        questions: wire(),
      }).expect(200);
      assert.equal((noop.body as { changed: boolean }).changed, false);
      await patch(issue.id, {
        ...body(),
        questions: wire().map((q, index) =>
          index === 0 ? { ...q, type: 'single_select' } : q,
        ),
      }).expect(400);
    },
  );
  const version = await db
    .selectFrom('service_definition_version')
    .selectAll()
    .where('id', '=', present(issue.catalogVersionId))
    .executeTakeFirstOrThrow();
  const questions = await db
    .selectFrom('question')
    .selectAll()
    .where('service_definition_version_id', '=', version.id)
    .orderBy('display_order')
    .execute();
  const [multi, date, info, optionalMulti, optionalDate] = questions;
  assert.ok(multi && date && info && optionalMulti && optionalDate);
  const options = await db
    .selectFrom('question_option')
    .selectAll()
    .where('question_id', '=', multi.id)
    .orderBy('display_order')
    .execute();
  const [first, second, third] = options;
  assert.ok(first && second && third);
  const input = {
    serviceDefinitionId: issue.id,
    serviceDefinitionVersionId: version.id,
    description: 'Synthetic extended question request',
    reportingIdentity: 'anonymous',
    ...(version.location_policy === 'not_applicable'
      ? {}
      : { location: { enteredAddress: 'Fictional training location' } }),
    answers: [
      {
        questionId: multi.id,
        optionKeys: [second.option_key, first.option_key],
      },
      { questionId: date.id, value: '2024-02-29' },
    ],
  };
  const post = (answers: object[], extra = {}) =>
    request(api)
      .post('/api/v1/service-requests')
      .send({ ...input, ...extra, answers });
  const invalid: [string, object[]][] = [
    ['required omitted', []],
    [
      'required multi empty',
      [{ questionId: multi.id, optionKeys: [] }, present(input.answers[1])],
    ],
    ['required date omitted', [present(input.answers[0])]],
    [
      'required date empty',
      [present(input.answers[0]), { questionId: date.id, value: '' }],
    ],
    [
      'duplicate option',
      [
        {
          questionId: multi.id,
          optionKeys: [first.option_key, first.option_key],
        },
        present(input.answers[1]),
      ],
    ],
    [
      'unknown option',
      [
        { questionId: multi.id, optionKeys: [randomUUID()] },
        present(input.answers[1]),
      ],
    ],
    [
      'scalar multi',
      [
        { questionId: multi.id, value: first.option_key },
        present(input.answers[1]),
      ],
    ],
    [
      'both fields',
      [
        {
          questionId: multi.id,
          optionKeys: [first.option_key],
          value: first.option_key,
        },
        present(input.answers[1]),
      ],
    ],
    [
      'date option array',
      [
        present(input.answers[0]),
        { questionId: date.id, optionKeys: [first.option_key] },
      ],
    ],
    [
      'information forged',
      [...input.answers, { questionId: info.id, value: '' }],
    ],
    [
      'unknown DTO field',
      [
        ...input.answers,
        { questionId: optionalDate.id, value: '2024-01-01', forged: true },
      ],
    ],
    ['duplicate question', [...input.answers, present(input.answers[0])]],
    [
      'too many selections',
      [
        {
          questionId: multi.id,
          optionKeys: Array.from({ length: 26 }, () => randomUUID()),
        },
        present(input.answers[1]),
      ],
    ],
  ];
  const foreignOption = await db
    .selectFrom('question_option')
    .select('option_key')
    .where('question_id', '=', optionalMulti.id)
    .executeTakeFirstOrThrow();
  invalid.push([
    'foreign question option',
    [
      { questionId: multi.id, optionKeys: [foreignOption.option_key] },
      present(input.answers[1]),
    ],
  ]);
  for (const value of [
    '2023-02-29',
    '1900-02-29',
    '2024-04-31',
    '2024-13-01',
    '2024-00-01',
    '2024-01-00',
    '0000-01-01',
    '2024-1-01',
    '02/29/2024',
    '2024-02-29T00:00:00Z',
    '2024-02-29+01:00',
    ' 2024-02-29',
    20240229,
    true,
    {},
    [],
    null,
  ])
    invalid.push([
      `invalid calendar ${JSON.stringify(value)}`,
      [present(input.answers[0]), { questionId: date.id, value }],
    ]);
  for (const [name, answers] of invalid)
    await t.test(
      `F056.2C API rejects ${name} without partial state`,
      async () => {
        const before = await state();
        await post(answers).expect(400);
        assert.deepEqual(await state(), before);
      },
    );
  let requestId = '';
  await t.test(
    'F056.2C mixed submission normalizes optional absence and stores typed date plus canonical selections',
    async () => {
      const result = await post([
        ...input.answers,
        { questionId: optionalMulti.id, optionKeys: [] },
        { questionId: optionalDate.id, value: '' },
      ]).expect(201);
      requestId = (result.body as { id: string }).id;
      const rows = await db
        .selectFrom('answer')
        .select(['id', 'question_type', 'selected_option_count'])
        .where('service_request_id', '=', requestId)
        .execute();
      assert.equal(rows.length, 2);
      assert.equal(
        rows.find((row) => row.question_type === 'multi_select')
          ?.selected_option_count,
        2,
      );
      const stored = await sql<{
        date: string;
      }>`select to_char(date_value,'YYYY-MM-DD') as date from answer where service_request_id=${requestId} and question_type='date'`.execute(
        db,
      );
      assert.equal(stored.rows[0]?.date, '2024-02-29');
    },
  );
  const selectedAnswer = await db
    .selectFrom('answer')
    .selectAll()
    .where('service_request_id', '=', requestId)
    .where('question_type', '=', 'multi_select')
    .executeTakeFirstOrThrow();
  const selected = {
    organization_id: org,
    answer_id: selectedAnswer.id,
    question_id: multi.id,
    option_key: third.option_key,
  };
  await t.test(
    'F056.2C database rejects impossible/out-of-range Date storage and Date update/delete',
    async () => {
      const dateAnswer = await db
        .selectFrom('answer')
        .selectAll()
        .where('service_request_id', '=', requestId)
        .where('question_type', '=', 'date')
        .executeTakeFirstOrThrow();
      for (const value of [
        '2024-02-30',
        '0000-01-01',
        '10000-01-01',
        'infinity',
      ])
        await assert.rejects(
          db
            .insertInto('answer')
            .values({
              ...dateAnswer,
              id: randomUUID(),
              question_id: optionalDate.id,
              question_key: optionalDate.question_key,
              question_label: optionalDate.label,
              date_value: value,
            })
            .execute(),
        );
      await assert.rejects(
        db
          .updateTable('answer')
          .set({ date_value: '2024-03-01' })
          .where('id', '=', dateAnswer.id)
          .execute(),
      );
      await assert.rejects(
        db.deleteFrom('answer').where('id', '=', dateAnswer.id).execute(),
      );
    },
  );
  await t.test(
    'F056.2C failed Admin audit rolls back new-type schema publication and core revision',
    async () => {
      const snapshot = async () =>
        (
          await sql`select jsonb_build_object(
        'issue',(select to_jsonb(i) from service_definition i where id=${issue.id}),
        'versions',(select count(*) from service_definition_version),
        'questions',(select count(*) from question),'options',(select count(*) from question_option),
        'audits',(select count(*) from issue_configuration_audit)) as state`.execute(
            db,
          )
        ).rows;
      const before = await snapshot();
      await sql`create function fail_extended_admin() returns trigger language plpgsql as $$ begin raise exception 'Synthetic audit failure'; end $$;
        create trigger fail_extended_admin before insert on issue_configuration_audit for each row execute function fail_extended_admin()`.execute(
        db,
      );
      try {
        await patch(issue.id, {
          ...body(),
          questions: wire().map((q) => ({
            ...q,
            prompt: `Changed ${q.prompt}`,
          })),
        }).expect(500);
        assert.deepEqual(await snapshot(), before);
      } finally {
        await sql`drop trigger fail_extended_admin on issue_configuration_audit;drop function fail_extended_admin()`.execute(
          db,
        );
      }
    },
  );
  await t.test(
    'F056.2C deferred completeness rejects an empty logical multi-select answer and forged Information response storage',
    async () => {
      await assert.rejects(
        db
          .insertInto('answer')
          .values({
            ...selectedAnswer,
            id: randomUUID(),
            question_id: optionalMulti.id,
            question_key: optionalMulti.question_key,
            question_label: optionalMulti.label,
            selected_option_count: 1,
          })
          .execute(),
      );
      await assert.rejects(
        db
          .insertInto('answer')
          .values({
            ...selectedAnswer,
            id: randomUUID(),
            question_id: info.id,
            question_key: info.question_key,
            question_label: info.label,
            question_type: 'short_text',
            text_value: 'Forged information response',
            selected_option_count: null,
          })
          .execute(),
      );
      const attempts = await Promise.allSettled([
        db.insertInto('answer_selected_option').values(selected).execute(),
        db.insertInto('answer_selected_option').values(selected).execute(),
      ]);
      assert.ok(attempts.every((attempt) => attempt.status === 'rejected'));
    },
  );
  for (const [name, mutate] of [
    [
      'append after submission',
      () => db.insertInto('answer_selected_option').values(selected).execute(),
    ],
    [
      'duplicate selection',
      () =>
        db
          .insertInto('answer_selected_option')
          .values({ ...selected, option_key: first.option_key })
          .execute(),
    ],
    [
      'foreign question',
      () =>
        db
          .insertInto('answer_selected_option')
          .values({
            ...selected,
            question_id: optionalMulti.id,
            option_key: foreignOption.option_key,
          })
          .execute(),
    ],
    [
      'foreign organization',
      () =>
        db
          .insertInto('answer_selected_option')
          .values({ ...selected, organization_id: randomUUID() })
          .execute(),
    ],
    [
      'selection update',
      () =>
        db
          .updateTable('answer_selected_option')
          .set({ option_label: 'Mutated' })
          .where('answer_id', '=', selectedAnswer.id)
          .execute(),
    ],
    [
      'selection delete',
      () =>
        db
          .deleteFrom('answer_selected_option')
          .where('answer_id', '=', selectedAnswer.id)
          .execute(),
    ],
    [
      'selection truncate',
      () => sql`truncate answer_selected_option`.execute(db),
    ],
    [
      'answer count update',
      () =>
        db
          .updateTable('answer')
          .set({ selected_option_count: 3 })
          .where('id', '=', selectedAnswer.id)
          .execute(),
    ],
    [
      'answer deletion',
      () =>
        db.deleteFrom('answer').where('id', '=', selectedAnswer.id).execute(),
    ],
  ] as const)
    await t.test(`F056.2C database rejects ${name}`, async () => {
      await assert.rejects(mutate());
    });
  for (const kind of ['selection', 'date'])
    await t.test(
      `F056.2C ${kind} persistence failure rolls back the entire request`,
      async () => {
        await sql`create function fail_extended_persistence() returns trigger language plpgsql as $$ begin raise exception 'Synthetic failure'; end $$`.execute(
          db,
        );
        const table =
          kind === 'selection' ? 'answer_selected_option' : 'answer';
        await sql`create trigger fail_extended before insert on ${sql.table(table)} for each row ${kind === 'date' ? sql`when (new.question_type='date')` : sql``} execute function fail_extended_persistence()`.execute(
          db,
        );
        try {
          const before = await state();
          await post(input.answers).expect(500);
          assert.deepEqual(await state(), before);
        } finally {
          await sql`drop trigger fail_extended on ${sql.table(table)};drop function fail_extended_persistence()`.execute(
            db,
          );
        }
      },
    );
  const read = () =>
    request(api)
      .get(`/api/v1/staff/service-requests/${requestId}/answers`)
      .set('Authorization', `Bearer ${actor}`);
  let historical: unknown;
  await t.test(
    'F056.2C authorized staff-assisted PUBLIC/API and INTERNAL use the shared new-type validator and audience boundary',
    async () => {
      await grant('service_request.create');
      await grant('service_request.create_internal');
      const staffPost = (body: object) =>
        request(api)
          .post('/api/v1/staff/service-requests')
          .set('Authorization', `Bearer ${actor}`)
          .send(body);
      for (const audience of ['public', 'internal']) {
        const body = {
          ...input,
          reportingIdentity:
            audience === 'internal' ? 'identified' : 'anonymous',
          audience,
          intakeChannel: 'api',
        };
        const before = await state();
        await staffPost({
          ...body,
          answers: [
            present(input.answers[0]),
            { questionId: date.id, value: '2023-02-29' },
          ],
        }).expect(400);
        assert.deepEqual(await state(), before);
        const created = await staffPost(body).expect(201);
        const id = (created.body as { id: string }).id;
        if (audience === 'internal') {
          await db
            .deleteFrom('role_permission')
            .where('role_id', '=', role)
            .where('permission_key', '=', 'service_request.internal.read')
            .execute();
          await request(api)
            .get(`/api/v1/staff/service-requests/${id}/answers`)
            .set('Authorization', `Bearer ${actor}`)
            .expect(404);
          await grant('service_request.internal.read');
        }
        const result = await request(api)
          .get(`/api/v1/staff/service-requests/${id}/answers`)
          .set('Authorization', `Bearer ${actor}`)
          .expect(200);
        assert.equal((result.body as { answers: unknown[] }).answers.length, 2);
      }
    },
  );
  await t.test(
    'F056.2C protected new answers require independent parent permission; no-store audited disclosure and audit failure withholding',
    async () => {
      await db
        .deleteFrom('role_permission')
        .where('role_id', '=', role)
        .where('permission_key', '=', 'service_request.answers.read')
        .execute();
      const denied = await read().expect(403);
      assert.equal(denied.headers['cache-control'], 'no-store');
      await grant('service_request.answers.read');
      await db
        .deleteFrom('role_permission')
        .where('role_id', '=', role)
        .where('permission_key', '=', 'service_request.view')
        .execute();
      await read().expect(404);
      await grant('service_request.view');
      const before =
        await sql`select id from request_answer_read_audit`.execute(db);
      const result = await read().expect(200);
      historical = result.body;
      assert.equal(result.headers['cache-control'], 'no-store');
      assert.equal(
        (await sql`select id from request_answer_read_audit`.execute(db)).rows
          .length,
        before.rows.length + 1,
      );
      const answers = (
        result.body as {
          answers: {
            selectedLabels?: string[];
            dateValue?: string;
            type: string;
          }[];
        }
      ).answers;
      assert.deepEqual(
        answers.find((a) => a.type === 'multi_select')?.selectedLabels,
        ['First', '<b>Second</b>'],
      );
      assert.equal(
        answers.find((a) => a.type === 'date')?.dateValue,
        '2024-02-29',
      );
      assert.equal(
        answers.some((a) => a.type === 'information'),
        false,
      );
      for (const path of [
        `/api/v1/service-requests/${requestId}`,
        `/api/v1/staff/service-requests/${requestId}`,
      ]) {
        const ordinary = await request(api)
          .get(path)
          .set('Authorization', `Bearer ${actor}`)
          .expect(200);
        assert.equal('answers' in ordinary.body, false);
        assert.ok(!JSON.stringify(ordinary.body).includes('2024-02-29'));
      }
      await sql`create function fail_extended_read() returns trigger language plpgsql as $$ begin raise exception 'Synthetic audit failure'; end $$;
      create trigger fail_extended_read before insert on request_answer_read_audit for each row execute function fail_extended_read()`.execute(
        db,
      );
      try {
        const failed = await read().expect(500);
        assert.equal('answers' in failed.body, false);
        assert.equal(failed.headers['cache-control'], 'no-store');
      } finally {
        await sql`drop trigger fail_extended_read on request_answer_read_audit;drop function fail_extended_read()`.execute(
          db,
        );
      }
    },
  );
  await t.test(
    'F056.2C historical labels and date survive schema publication; stale submission is atomic; populated rollback guarded',
    async () => {
      const changed = wire().map((q) =>
        q.type === 'multi_select'
          ? {
              ...q,
              options: q.options.map((o) => ({
                ...o,
                label: `Changed ${o.label}`,
                order: 25 - o.order,
              })),
            }
          : { ...q, prompt: `Changed ${q.prompt}` },
      );
      const result = await patch(issue.id, {
        ...body(),
        questions: changed,
      }).expect(200);
      issue = (result.body as { issue: IssueProjection }).issue;
      const before = await state();
      await post(input.answers).expect(409);
      await post(input.answers, {
        serviceDefinitionVersionId: issue.catalogVersionId,
      }).expect(400);
      const currentMulti = await db
        .selectFrom('question')
        .selectAll()
        .where(
          'service_definition_version_id',
          '=',
          present(issue.catalogVersionId),
        )
        .where('question_key', '=', multi.question_key)
        .executeTakeFirstOrThrow();
      await assert.rejects(
        db
          .insertInto('answer_selected_option')
          .values({
            ...selected,
            question_id: currentMulti.id,
          })
          .execute(),
      );
      assert.deepEqual(await state(), before);
      assert.deepEqual((await read().expect(200)).body, historical);
      assert.equal(
        (
          await db
            .selectFrom('question')
            .select('id')
            .where('id', '=', info.id)
            .execute()
        ).length,
        1,
      );
      await assert.rejects(
        db.transaction().execute(down),
        /Retained extended question history/,
      );
    },
  );
  await t.test(
    'F056.2C finalized evidence retry preserves extended answers after later schema publication; selection/date failure leaves evidence staged',
    async () => {
      const attachmentService = app.get(AttachmentService);
      const priorStorage = Object.getOwnPropertyDescriptor(
        attachmentService,
        'storage',
      );
      const priorEnabled = Object.getOwnPropertyDescriptor(
        attachmentService,
        'enabled',
      );
      const directory = await mkdtemp(join(tmpdir(), 'reqro-f0562c-evidence-'));
      Object.defineProperty(attachmentService, 'storage', {
        value: new LocalAttachmentStorage(directory),
        configurable: true,
      });
      Object.defineProperty(attachmentService, 'enabled', {
        value: true,
        configurable: true,
      });
      try {
        const catalog = await request(api)
          .get(`/api/v1/catalog/issues/${issue.id}`)
          .expect(200);
        const qs = (
          catalog.body as {
            questions: {
              id: string;
              type: string;
              required: boolean;
              options: { key: string }[];
            }[];
          }
        ).questions;
        const payload = {
          ...input,
          serviceDefinitionVersionId: issue.catalogVersionId,
          answers: qs
            .filter((q) => q.required)
            .map((q) =>
              q.type === 'multi_select'
                ? {
                    questionId: q.id,
                    optionKeys: q.options.slice(0, 2).map((o) => o.key),
                  }
                : { questionId: q.id, value: '2024-02-29' },
            ),
        };
        const batchResponse = await request(api)
          .post('/api/v1/intake/attachments/batches')
          .send({ issueId: issue.id, versionId: issue.catalogVersionId })
          .expect(201);
        const batch = batchResponse.body as AttachmentClaim;
        const claim = { batchId: batch.batchId, token: batch.token };
        const png = await sharp({
          create: { width: 16, height: 16, channels: 3, background: '#7799aa' },
        })
          .png()
          .toBuffer();
        await request(api)
          .post(
            `/api/v1/intake/attachments/batches/${claim.batchId}/files/${randomUUID()}`,
          )
          .set('X-Reqro-Attachment', claim.token)
          .attach('file', png, {
            filename: 'synthetic-extended.png',
            contentType: 'image/png',
          })
          .expect(201);
        for (const kind of ['selection', 'date']) {
          const table =
            kind === 'selection' ? 'answer_selected_option' : 'answer';
          await sql`create function fail_extended_evidence() returns trigger language plpgsql as $$ begin raise exception 'Synthetic persistence failure'; end $$;
          create trigger fail_extended_evidence before insert on ${sql.table(table)} for each row ${kind === 'date' ? sql`when (new.question_type='date')` : sql``} execute function fail_extended_evidence()`.execute(
            db,
          );
          try {
            const before = await state();
            await request(api)
              .post('/api/v1/service-requests')
              .send({ ...payload, attachments: claim })
              .expect(500);
            assert.deepEqual(await state(), before);
            assert.equal(
              (
                await db
                  .selectFrom('attachment_batch')
                  .select('state')
                  .where('id', '=', claim.batchId)
                  .executeTakeFirstOrThrow()
              ).state,
              'STAGED',
            );
          } finally {
            await sql`drop trigger fail_extended_evidence on ${sql.table(table)};drop function fail_extended_evidence()`.execute(
              db,
            );
          }
        }
        const first = await request(api)
          .post('/api/v1/service-requests')
          .send({ ...payload, attachments: claim })
          .expect(201);
        const edited = await patch(issue.id, {
          ...body(),
          questions: wire().map((q) => ({
            ...q,
            prompt: `Edited ${q.prompt}`,
          })),
        }).expect(200);
        issue = (edited.body as { issue: IssueProjection }).issue;
        const before = await state();
        const retry = await request(api)
          .post('/api/v1/service-requests')
          .send({ ...payload, attachments: claim })
          .expect(201);
        assert.equal(
          (retry.body as { id: string }).id,
          (first.body as { id: string }).id,
        );
        assert.deepEqual(await state(), before);
      } finally {
        if (priorStorage)
          Object.defineProperty(attachmentService, 'storage', priorStorage);
        if (priorEnabled)
          Object.defineProperty(attachmentService, 'enabled', priorEnabled);
        assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
  await t.test(
    'F056.2C template copies independent immutable definitions for every new type, without answers',
    async () => {
      const result = await request(api)
        .post('/api/v1/admin/issues')
        .set('Authorization', `Bearer ${actor}`)
        .send({
          ...create,
          templateId: issue.id,
          ...(await reviewedCreation(db, org, issue.id)),
          name: 'Fictional extended copy',
        })
        .expect(201);
      const copy = (result.body as { issue: IssueProjection }).issue;
      assert.ok(copy.questions && issue.questions);
      assert.equal(copy.questions.length, 5);
      assert.deepEqual(
        copy.questions.map((q) => q.type),
        issue.questions.map((q) => q.type),
      );
      const copied = await db
        .selectFrom('question')
        .select('id')
        .where(
          'service_definition_version_id',
          '=',
          present(copy.catalogVersionId),
        )
        .execute();
      assert.ok(copied.every((q) => !questions.some((old) => old.id === q.id)));
      assert.equal(
        (
          await db
            .selectFrom('answer')
            .select('id')
            .where(
              'question_id',
              'in',
              copied.map((q) => q.id),
            )
            .execute()
        ).length,
        0,
      );
    },
  );
  await t.test(
    'F056.2C new types retain authoritative Active, availability and External Redirect boundaries',
    async () => {
      const hadAction = await db
        .selectFrom('role_permission')
        .select('permission_key')
        .where('role_id', '=', role)
        .where('permission_key', '=', 'catalog.issue_action.manage')
        .executeTakeFirst();
      await grant('catalog.issue_action.manage');
      try {
        for (const availability of ['EXTERNAL_ONLY', 'INTERNAL_ONLY']) {
          const result = await request(api)
            .post('/api/v1/admin/issues')
            .set('Authorization', `Bearer ${actor}`)
            .send({
              ...create,
              templateId: issue.id,
              ...(await reviewedCreation(db, org, issue.id)),
              availability,
              name: `Fictional ${availability} extended`,
            })
            .expect(201);
          let copy = (result.body as { issue: IssueProjection }).issue;
          const copyBody = () => ({
            name: copy.name,
            description: copy.description,
            displayOrder: copy.displayOrder,
            active: copy.active,
            requesterPolicy: copy.requesterPolicy,
            defaultAssignment: null,
            expectedCoreRevision: copy.coreRevision,
            expectedActionRevision: copy.actionRevision,
            expectedPolicyRevision: copy.policyRevision,
            expectedAssignmentRevision: copy.assignmentRevision,
          });
          const payload = {
            ...input,
            serviceDefinitionId: copy.id,
            serviceDefinitionVersionId: copy.catalogVersionId,
          };
          const before = await state();
          await request(api)
            .post('/api/v1/service-requests')
            .send(payload)
            .expect(409);
          assert.deepEqual(await state(), before);
          const active = await patch(copy.id, {
            ...copyBody(),
            active: true,
          }).expect(200);
          copy = (active.body as { issue: IssueProjection }).issue;
          if (availability === 'INTERNAL_ONLY') {
            await request(api)
              .post('/api/v1/service-requests')
              .send(payload)
              .expect(409);
            await request(api)
              .get(`/api/v1/catalog/issues/${copy.id}`)
              .expect(404);
          } else {
            // A question identity from the source template is not a copied question identity.
            await request(api)
              .post('/api/v1/service-requests')
              .send(payload)
              .expect(400);
            const redirect = await patch(copy.id, {
              ...copyBody(),
              handling: {
                actionType: 'external_redirect',
                destination: 'https://example.com/fictional-intake',
                message: 'Synthetic handoff',
                label: 'Continue',
              },
            }).expect(200);
            copy = (redirect.body as { issue: IssueProjection }).issue;
            const catalog = await request(api)
              .get(`/api/v1/catalog/issues/${copy.id}`)
              .expect(200);
            assert.deepEqual(
              (catalog.body as { questions: unknown[] }).questions,
              [],
            );
            await request(api)
              .post('/api/v1/service-requests')
              .send(payload)
              .expect(409);
            assert.equal(
              copy.questions?.some((q) => q.type === 'information'),
              true,
            );
          }
          assert.deepEqual(await state(), before);
        }
      } finally {
        if (!hadAction)
          await db
            .deleteFrom('role_permission')
            .where('role_id', '=', role)
            .where('permission_key', '=', 'catalog.issue_action.manage')
            .execute();
      }
    },
  );
  await t.test(
    'F056.2C information-only schema submits zero answers',
    async () => {
      const result = await patch(issue.id, {
        ...body(),
        questions: [fresh('information', 0)],
      }).expect(200);
      issue = (result.body as { issue: IssueProjection }).issue;
      const created = await post([], {
        serviceDefinitionVersionId: issue.catalogVersionId,
      }).expect(201);
      assert.equal(
        (
          await db
            .selectFrom('answer')
            .select('id')
            .where(
              'service_request_id',
              '=',
              (created.body as { id: string }).id,
            )
            .execute()
        ).length,
        0,
      );
    },
  );
  await t.test(
    'F056.2C maximum 25-question/200-option fixture uses bulk persistence and indexed bounded read',
    async () => {
      const schema = Array.from({ length: 25 }, (_, order) =>
        order < 8
          ? {
              ...fresh('multi_select', order, true),
              options: Array.from({ length: 25 }, (_, n) => ({
                key: null,
                label: `Synthetic option ${String(n)}`,
                order: n,
              })),
            }
          : fresh('date', order, true),
      );
      const start = performance.now();
      const result = await patch(issue.id, {
        ...body(),
        questions: schema,
      }).expect(200);
      issue = (result.body as { issue: IssueProjection }).issue;
      const catalog = await request(api)
        .get(`/api/v1/catalog/issues/${issue.id}`)
        .expect(200);
      const qs = (
        catalog.body as {
          questions: { id: string; type: string; options: { key: string }[] }[];
        }
      ).questions;
      const created = await post(
        qs.map((q) =>
          q.type === 'multi_select'
            ? {
                questionId: q.id,
                optionKeys: q.options.map((o) => o.key).reverse(),
              }
            : { questionId: q.id, value: '2000-02-29' },
        ),
        { serviceDefinitionVersionId: issue.catalogVersionId },
      ).expect(201);
      requestId = (created.body as { id: string }).id;
      const resultRead = await read().expect(200);
      assert.equal(
        (resultRead.body as { answers: unknown[] }).answers.length,
        25,
      );
      const counts = await sql<{
        n: number;
      }>`select count(*)::int n from answer_selected_option s join answer a on a.id=s.answer_id where a.service_request_id=${requestId}`.execute(
        db,
      );
      assert.equal(counts.rows[0]?.n, 200);
      const plan = await db.transaction().execute(async (trx) => {
        await sql`set local enable_seqscan=off`.execute(trx);
        return sql`explain select * from answer_selected_option where answer_id=${selectedAnswer.id}`.execute(
          trx,
        );
      });
      assert.match(JSON.stringify(plan.rows), /answer_selected_option_pkey/);
      t.diagnostic(
        `F056.2C max schema, create and protected read: ${String(Math.round(performance.now() - start))} ms; disposable development observation, not a production benchmark`,
      );
    },
  );
  await t.test(
    'F056.2C normal logs exclude new answers and full Information/schema content',
    () => {
      const logs = c.logs.join('\n');
      for (const marker of [
        '2024-02-29',
        'Synthetic information',
        '<b>Second</b>',
        first.option_key,
        actor,
      ])
        assert.ok(!logs.includes(marker));
    },
  );
}
