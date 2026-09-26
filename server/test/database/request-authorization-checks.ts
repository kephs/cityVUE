import { RequestNoteService } from '../../src/service-request/request-note.service.js';
import { RequestNoteRepository } from '../../src/service-request/request-note.repository.js';
import { RequestCommunicationService } from '../../src/service-request/request-communication.service.js';
import { RequestCommunicationRepository } from '../../src/service-request/request-communication.repository.js';
import { communicationEligibility } from '../../src/service-request/request-communication-policy.js';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  sql,
  type Kysely,
  type KyselyPlugin,
  type CompiledQuery,
} from 'kysely';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import type { DatabaseService } from '../../src/database/database.service.js';
import {
  permissions,
  type StaffAccess,
  type Permission,
} from '../../src/auth/auth.types.js';
import { lockAuthorizationWriter } from '../../src/database/authorization-writer-lock.js';
import {
  authorizeRequestTransaction,
  requestTransaction,
  lockRequestRow,
} from '../../src/service-request/request-authorization.js';
import { InternalRequestMutationsService } from '../../src/service-request/internal-request-mutations.service.js';
import { InternalRequestRepository } from '../../src/service-request/internal-request.repository.js';
import { RequestOwnershipService } from '../../src/service-request/request-ownership.service.js';
import { RequestTrackingService } from '../../src/service-request/request-tracking.service.js';
import { RequestTrackingRepository } from '../../src/service-request/request-tracking.repository.js';
import { RequestAnswerService } from '../../src/service-request/request-answer.service.js';
import { RequesterHistoryService } from '../../src/service-request/requester-history.service.js';
import { StaffActionsService } from '../../src/service-request/staff-actions.service.js';
import type { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from '../../src/config/configuration.js';

function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing test value');
  return value;
}
async function bounded<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Test coordination deadline exceeded'));
        }, 10000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function pauseAfter(table: string) {
  const arrived = latch(),
    resume = latch();
  let selected: object | undefined,
    used = false;
  const plugin: KyselyPlugin = {
    transformQuery(args) {
      if (
        !used &&
        args.node.kind === 'SelectQueryNode' &&
        JSON.stringify(args.node).includes('"name":"' + table + '"')
      ) {
        used = true;
        selected = args.queryId;
      }
      return args.node;
    },
    async transformResult(args) {
      if (args.queryId === selected) {
        arrived.release();
        await resume.promise;
      }
      return args.result;
    },
  };
  return { plugin, arrived, resume };
}
async function waitBlocked(
  db: Kysely<DatabaseSchema>,
  pid: number,
  isBlocker: boolean,
) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = isBlocker
      ? await sql<{
          waiting: boolean;
        }>`select exists(select 1 from pg_stat_activity where ${pid}=any(pg_blocking_pids(pid))) as waiting`.execute(
          db,
        )
      : await sql<{
          waiting: boolean;
        }>`select cardinality(pg_blocking_pids(${pid}))>0 as waiting`.execute(
          db,
        );
    if (result.rows[0]?.waiting) return;
  }
  assert.fail('Expected a database lock waiter before deadline');
}

export async function checkRequestAuthorization(
  t: TestContext,
  db: Kysely<DatabaseSchema>,
  c: {
    org: string;
    otherOrg: string;
    category: string;
    service: string;
    version: string;
  },
) {
  const actorId = randomUUID(),
    role = randomUUID(),
    department = randomUUID(),
    division = randomUUID(),
    tenant = randomUUID();
  const keys = permissions.filter((p) => p.startsWith('service_request.'));
  await db
    .insertInto('permission')
    .values(keys.map((permission_key) => ({ permission_key })))
    .onConflict((oc) => oc.column('permission_key').doNothing())
    .execute();
  await db
    .insertInto('department')
    .values({
      id: department,
      organization_id: c.org,
      name: 'F058 synthetic scope',
      status: 'active',
      display_order: 999,
    })
    .execute();
  await db
    .insertInto('division')
    .values({
      id: division,
      organization_id: c.org,
      department_id: department,
      name: 'F058 synthetic division',
      status: 'active',
      display_order: 999,
    })
    .execute();
  await db
    .insertInto('staff_identity')
    .values({
      id: actorId,
      organization_id: c.org,
      display_name: 'Synthetic request operator',
      entra_tenant_id: tenant,
      entra_object_id: actorId,
      active: true,
    })
    .execute();
  await db
    .insertInto('role')
    .values({
      id: role,
      organization_id: c.org,
      name: 'F058 synthetic request authority',
      active: true,
    })
    .execute();
  await db
    .insertInto('role_permission')
    .values(
      keys.map((permission_key) => ({
        organization_id: c.org,
        role_id: role,
        permission_key,
      })),
    )
    .execute();
  await db
    .insertInto('staff_role_assignment')
    .values({
      organization_id: c.org,
      staff_identity_id: actorId,
      role_id: role,
      active: true,
    })
    .execute();
  await db
    .insertInto('staff_department_membership')
    .values({
      organization_id: c.org,
      staff_identity_id: actorId,
      department_id: department,
      active: true,
    })
    .execute();
  await db
    .insertInto('staff_division_membership')
    .values({
      organization_id: c.org,
      staff_identity_id: actorId,
      department_id: department,
      division_id: division,
      active: true,
    })
    .execute();
  const actor: StaffAccess = {
    organizationId: c.org,
    staffIdentityId: actorId,
    tenantId: tenant,
    objectId: actorId,
    displayName: 'Synthetic request operator',
    permissions: [...keys],
    departmentIds: [department],
    divisionIds: [division],
    scopes: [],
    development: false,
  };
  const service = (client = db) =>
    new InternalRequestMutationsService({ client } as DatabaseService);
  const requestRow = (id: string) => ({
    id,
    organization_id: c.org,
    reference_number: 'F058-' + id.toUpperCase(),
    service_definition_id: c.service,
    service_definition_version_id: c.version,
    category_id: c.category,
    status: 'open',
    priority: 'medium',
    description: 'Synthetic concurrency request',
    reporting_identity: 'anonymous',
    audience: 'public',
    intake_channel: 'web',
    routed_department_id: department,
    routed_division_id: division,
  });
  const make = async () => {
    const id = randomUUID();
    await db.insertInto('service_request').values(requestRow(id)).execute();
    return id;
  };
  const workflow = (id: string, client = db) =>
    service(client).workflow(
      id,
      { expectedRevision: 1, action: 'start_work' },
      actor,
      'all',
    );
  const state = (id: string) =>
    db
      .selectFrom('service_request')
      .select(['status', 'revision'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  const restore = async () =>
    db.transaction().execute(async (trx) => {
      await lockAuthorizationWriter(trx, c.org);
      await trx
        .updateTable('organization')
        .set({ status: 'active' })
        .where('id', '=', c.org)
        .execute();
      await trx
        .updateTable('staff_identity')
        .set({ active: true })
        .where('id', '=', actorId)
        .execute();
      await trx
        .updateTable('staff_department_membership')
        .set({ active: true })
        .where('staff_identity_id', '=', actorId)
        .execute();
      await trx
        .updateTable('staff_division_membership')
        .set({ active: true })
        .where('staff_identity_id', '=', actorId)
        .execute();
      await trx
        .insertInto('role_permission')
        .values(
          keys.map((permission_key) => ({
            organization_id: c.org,
            role_id: role,
            permission_key,
          })),
        )
        .onConflict((oc) =>
          oc.columns(['role_id', 'permission_key']).doNothing(),
        )
        .execute();
    });
  type Writer = (trx: Kysely<DatabaseSchema>) => Promise<unknown>;
  const revoke =
    (key: Permission): Writer =>
    (trx) =>
      trx
        .deleteFrom('role_permission')
        .where('role_id', '=', role)
        .where('permission_key', '=', key)
        .execute();
  const writers: [string, Writer][] = [
    ['permission', revoke('service_request.start_work')],
    [
      'Department',
      (trx) =>
        trx
          .updateTable('staff_department_membership')
          .set({ active: false })
          .where('staff_identity_id', '=', actorId)
          .execute(),
    ],
    [
      'Division',
      (trx) =>
        trx
          .updateTable('staff_division_membership')
          .set({ active: false })
          .where('staff_identity_id', '=', actorId)
          .execute(),
    ],
    [
      'Staff',
      (trx) =>
        trx
          .updateTable('staff_identity')
          .set({ active: false })
          .where('id', '=', actorId)
          .execute(),
    ],
    [
      'Organization',
      (trx) =>
        trx
          .updateTable('organization')
          .set({ status: 'inactive' })
          .where('id', '=', c.org)
          .execute(),
    ],
  ];

  const requester = randomUUID();
  await db
    .insertInto('staff_identity')
    .values({
      id: requester,
      organization_id: c.org,
      display_name: 'Fictional internal requester',
      entra_tenant_id: tenant,
      entra_object_id: requester,
      active: true,
    })
    .execute();
  const communication = (client = db) =>
    new RequestCommunicationService(
      { client } as DatabaseService,
      new RequestCommunicationRepository(),
    );
  const makeInternal = async () => {
    const id = randomUUID();
    await db
      .insertInto('service_request')
      .values({
        ...requestRow(id),
        audience: 'internal',
        reporting_identity: 'identified',
        requester_staff_identity_id: requester,
        submitted_by_staff_identity_id: requester,
      })
      .execute();
    return id;
  };
  const communicationSnapshot = async (id: string) => ({
    parent: await db
      .selectFrom('service_request')
      .selectAll()
      .where('id', '=', id)
      .execute(),
    messages: await db
      .selectFrom('request_communication')
      .selectAll()
      .where('service_request_id', '=', id)
      .execute(),
    audit: await db
      .selectFrom('activity')
      .selectAll()
      .where('service_request_id', '=', id)
      .execute(),
    operational: await db
      .selectFrom('request_operational_activity')
      .selectAll()
      .where('service_request_id', '=', id)
      .execute(),
  });
  await t.test(
    'F058.2 defensive eligibility rejects missing, mismatched and cross-Organization requester without weakening database constraints',
    async () => {
      for (const [requesterId, submitterId, organizationId, identity] of [
        [null, null, c.org, 'identified'],
        [requester, actorId, c.org, 'identified'],
        [requester, requester, c.otherOrg, 'identified'],
        [randomUUID(), requester, c.org, 'identified'],
        [requester, requester, c.org, 'anonymous'],
      ]) {
        const result = await sql<{
          state: string;
        }>`select ${communicationEligibility()} as state from
        (select 'internal'::text as audience, ${identity}::text as reporting_identity,
        ${requesterId}::uuid as requester_staff_identity_id, ${submitterId}::uuid as submitted_by_staff_identity_id,
        ${organizationId}::uuid as organization_id) request`.execute(db);
        assert.equal(result.rows[0]?.state, 'unavailable');
      }
    },
  );

  for (const stream of [
    'public communication',
    'internal communication',
    'internal notes',
  ] as const) {
    await t.test(
      'F058.2 bounded query count for ' +
        stream +
        ' at 0/1/25/26 records and older page',
      async () => {
        const id = await makeInternal();
        if (stream === 'public communication') {
          // Separate synthetic PUBLIC fixture, leaving the INTERNAL immutable attribution contract intact.
          const publicId = await make();
          await measure(publicId);
        } else await measure(id);
        async function measure(target: string) {
          const counts: number[] = [];
          let count = 0;
          const client = db.withPlugin({
            transformQuery(args) {
              count++;
              return args.node;
            },
            async transformResult(args) {
              return args.result;
            },
          });
          const service =
            stream === 'internal notes'
              ? new RequestNoteService(
                  { client } as DatabaseService,
                  new RequestNoteRepository(),
                )
              : communication(client);
          let prior = 0;
          for (const size of [0, 1, 25, 26]) {
            for (let n = prior; n < size; n++) {
              const values = {
                organization_id: c.org,
                service_request_id: target,
                author_staff_identity_id: actorId,
                author_display_name: 'Fictional author',
                body: `Fictional bounded history ${String(n)}`,
                submission_key: randomUUID(),
              };
              if (stream === 'internal notes')
                await db
                  .insertInto('request_internal_note')
                  .values(values)
                  .execute();
              else
                await db
                  .insertInto('request_communication')
                  .values(values)
                  .execute();
            }
            prior = size;
            count = 0;
            const page = await service.list(target, actor, 25);
            counts.push(count);
            assert.equal(page.items.length, Math.min(size, 25));
            if (size === 26) {
              assert.ok(page.nextCursor);
              count = 0;
              const older = await service.list(
                target,
                actor,
                25,
                page.nextCursor,
              );
              assert.equal(older.items.length, 1);
              counts.push(count);
            }
          }
          assert.equal(new Set(counts).size, 1);
          assert.ok(counts.length > 0 && counts.every((value) => value <= 12));
          t.diagnostic(
            'F058.2 ' +
              stream +
              ' queries at 0/1/25/26/older: ' +
              counts.join('/'),
          );
        }
      },
    );
  }

  for (const table of ['request_communication', 'activity']) {
    await t.test(
      'F058.2 INTERNAL ' + table + ' failure rolls back the entire append',
      async () => {
        const id = await makeInternal(),
          before = await communicationSnapshot(id);
        const client = db.withPlugin({
          transformQuery(args) {
            if (
              args.node.kind === 'InsertQueryNode' &&
              JSON.stringify(args.node).includes('"name":"' + table + '"')
            )
              throw new Error('Synthetic failure');
            return args.node;
          },
          async transformResult(args) {
            return args.result;
          },
        });
        await assert.rejects(
          communication(client).create(
            id,
            actor,
            'Fictional rollback body',
            randomUUID(),
          ),
        );
        assert.deepEqual(await communicationSnapshot(id), before);
      },
    );
  }
  await t.test(
    'F058.2 INTERNAL scoped submission replay is immutable and conflicting text cannot append',
    async () => {
      const id = await makeInternal(),
        key = randomUUID(),
        before = await communicationSnapshot(id);
      const first = await communication().create(
        id,
        actor,
        'Fictional replay body',
        key,
      );
      const after = await communicationSnapshot(id);
      assert.equal(
        (await communication().create(id, actor, 'Fictional replay body', key))
          .id,
        first.id,
      );
      await assert.rejects(
        communication().create(id, actor, 'Fictional conflicting body', key),
      );
      assert.deepEqual(await communicationSnapshot(id), after);
      assert.deepEqual(after.parent, before.parent);
      assert.deepEqual(after.operational, before.operational);
      assert.equal(after.messages.length, 1);
      assert.equal(after.audit.length, 1);
    },
  );
  const communicationWriters: [string, Writer][] = [
    [
      'communication permission',
      revoke('service_request.communication.create'),
    ],
    ...writers.slice(1),
    [
      'requester',
      (trx) =>
        trx
          .updateTable('staff_identity')
          .set({ active: false })
          .where('id', '=', requester)
          .execute(),
    ],
  ];
  for (const [name, change] of communicationWriters) {
    await t.test(
      'F058.2 communication waits for preceding ' +
        name +
        ' revocation and leaves no partial state',
      async () => {
        const id = await makeInternal(),
          before = await communicationSnapshot(id),
          ready = latch(),
          release = latch();
        let pid = 0;
        const writer = db.transaction().execute(async (trx) => {
          await lockAuthorizationWriter(trx, c.org);
          pid = required(
            (
              await sql<{
                pid: number;
              }>`select pg_backend_pid() as pid`.execute(trx)
            ).rows[0],
          ).pid;
          await change(trx);
          ready.release();
          await release.promise;
        });
        await ready.promise;
        const result = communication()
          .create(id, actor, 'Fictional record', randomUUID())
          .then(
            () => false,
            () => true,
          );
        try {
          await waitBlocked(db, pid, true);
        } finally {
          release.release();
        }
        await writer;
        assert.equal(await result, true);
        assert.deepEqual(await communicationSnapshot(id), before);
        await restore();
        await db
          .updateTable('staff_identity')
          .set({ active: true })
          .where('id', '=', requester)
          .execute();
      },
    );
    await t.test(
      'F058.2 communication barrier completes before ' +
        name +
        ' revocation with one immutable record',
      async () => {
        const id = await makeInternal(),
          pause = pauseAfter('organization_access_state');
        const before = await communicationSnapshot(id);
        const operation = communication(db.withPlugin(pause.plugin)).create(
          id,
          actor,
          'Fictional record',
          randomUUID(),
        );
        await bounded(pause.arrived.promise);
        const ready = latch();
        let pid = 0;
        const writer = db.transaction().execute(async (trx) => {
          pid = required(
            (
              await sql<{
                pid: number;
              }>`select pg_backend_pid() as pid`.execute(trx)
            ).rows[0],
          ).pid;
          ready.release();
          await lockAuthorizationWriter(trx, c.org);
          await change(trx);
        });
        await ready.promise;
        try {
          await waitBlocked(db, pid, false);
        } finally {
          pause.resume.release();
        }
        await operation;
        await writer;
        const after = await communicationSnapshot(id);
        assert.equal(after.messages.length, 1);
        assert.equal(after.audit.length, 1);
        assert.deepEqual(after.parent, before.parent);
        assert.deepEqual(after.operational, before.operational);
        await restore();
        assert.equal((await communication().list(id, actor)).items.length, 1);
        await db
          .updateTable('staff_identity')
          .set({ active: true })
          .where('id', '=', requester)
          .execute();
      },
    );
  }
  for (const [name, change] of writers) {
    await t.test(
      'F058 ' + name + ' revocation wins before the request barrier',
      async () => {
        const id = await make(),
          ready = latch(),
          release = latch();
        let pid = 0;
        const writer = db.transaction().execute(async (trx) => {
          await lockAuthorizationWriter(trx, c.org);
          pid = required(
            (
              await sql<{
                pid: number;
              }>`select pg_backend_pid() as pid`.execute(trx)
            ).rows[0],
          ).pid;
          await change(trx);
          ready.release();
          await release.promise;
        });
        await ready.promise;
        const result = workflow(id).then(
          () => false,
          () => true,
        );
        try {
          await waitBlocked(db, pid, true);
        } finally {
          release.release();
        }
        await writer;
        assert.equal(await result, true);
        assert.deepEqual(await state(id), { status: 'open', revision: 1 });
        await restore();
      },
    );
    await t.test(
      'F058 request barrier wins before ' + name + ' revocation',
      async () => {
        const id = await make(),
          pause = pauseAfter('organization_access_state');
        const operation = workflow(id, db.withPlugin(pause.plugin));
        await pause.arrived.promise;
        let pid = 0;
        const pidReady = latch();
        const writer = db.transaction().execute(async (trx) => {
          pid = required(
            (
              await sql<{
                pid: number;
              }>`select pg_backend_pid() as pid`.execute(trx)
            ).rows[0],
          ).pid;
          pidReady.release();
          await lockAuthorizationWriter(trx, c.org);
          await change(trx);
        });
        await pidReady.promise;
        try {
          await waitBlocked(db, pid, false);
        } finally {
          pause.resume.release();
        }
        await operation;
        await writer;
        assert.deepEqual(await state(id), {
          status: 'in_progress',
          revision: 2,
        });
        await restore();
      },
    );
  }
  await t.test(
    'F058 unrelated permission change preserves authorized action',
    async () => {
      const id = await make();
      await db.transaction().execute(async (trx) => {
        await lockAuthorizationWriter(trx, c.org);
        await revoke('service_request.contact.read')(trx);
      });
      await workflow(id);
      await restore();
    },
  );
  await t.test(
    'F058 same request commands have one revision winner',
    async () => {
      const id = await make();
      const results = await Promise.allSettled([workflow(id), workflow(id)]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.deepEqual(await state(id), { status: 'in_progress', revision: 2 });
    },
  );
  await t.test(
    'F058 different requests share Organization barriers concurrently',
    async () => {
      const ids = [await make(), await make()],
        a = pauseAfter('organization_access_state'),
        b = pauseAfter('organization_access_state');
      const pending = [
        workflow(required(ids[0]), db.withPlugin(a.plugin)),
        workflow(required(ids[1]), db.withPlugin(b.plugin)),
      ];
      try {
        await Promise.all([a.arrived.promise, b.arrived.promise]);
      } finally {
        a.resume.release();
        b.resume.release();
      }
      await Promise.all(pending);
    },
  );
  await t.test('F058 different Organizations remain independent', async () => {
    const id = await make();
    await db.transaction().execute(async (trx) => {
      await lockAuthorizationWriter(trx, c.otherOrg);
      await requestTransaction(db, actor, [], async (tx) => {
        await lockRequestRow(tx, c.org, id, true);
      });
    });
  });
  await t.test(
    'F058 stale revision, cross-Organization and development identity fail closed',
    async () => {
      const id = await make();
      await workflow(id);
      await assert.rejects(workflow(id));
      for (const access of [
        { ...actor, organizationId: c.otherOrg },
        { ...actor, development: true },
      ])
        await assert.rejects(
          service().workflow(
            id,
            { expectedRevision: 2, action: 'hold', reason: 'Synthetic' },
            access,
            'all',
          ),
        );
    },
  );
  await t.test(
    'F058 required Activity failure rolls back request and history',
    async () => {
      const id = await make();
      await sql`create function f058_reject_activity() returns trigger language plpgsql as $$ begin raise exception 'Synthetic audit failure'; end $$; create trigger f058_reject before insert on activity for each row execute function f058_reject_activity()`.execute(
        db,
      );
      try {
        await assert.rejects(workflow(id));
        assert.deepEqual(await state(id), { status: 'open', revision: 1 });
        assert.equal(
          (
            await db
              .selectFrom('request_operational_activity')
              .select('id')
              .where('service_request_id', '=', id)
              .execute()
          ).length,
          0,
        );
      } finally {
        await sql`drop trigger f058_reject on activity; drop function f058_reject_activity()`.execute(
          db,
        );
      }
    },
  );
  await t.test(
    'F058 snapshot before revocation fails closed at authorization lock',
    async () => {
      const ready = latch(),
        go = latch();
      const attempt = db
        .transaction()
        .setIsolationLevel('repeatable read')
        .execute(async (trx) => {
          await sql`select count(*) from organization_access_state`.execute(
            trx,
          );
          ready.release();
          await go.promise;
          await authorizeRequestTransaction(trx, actor);
        })
        .then(
          () => undefined,
          (error: unknown) => (error as { code: string }).code,
        );
      await ready.promise;
      await db.transaction().execute(async (trx) => {
        await lockAuthorizationWriter(trx, c.org);
        await revoke('service_request.start_work')(trx);
      });
      go.release();
      assert.equal(await attempt, '40001');
      await restore();
    },
  );
  await t.test(
    'F058 requester-history service fails closed when its snapshot predates committed revocation',
    async () => {
      const id = await make(),
        ready = latch(),
        release = latch();
      let pid = 0;
      const writer = db.transaction().execute(async (trx) => {
        await lockAuthorizationWriter(trx, c.org);
        pid = required(
          (
            await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(
              trx,
            )
          ).rows[0],
        ).pid;
        await revoke('service_request.view')(trx);
        ready.release();
        await release.promise;
      });
      await bounded(ready.promise);
      const result = new RequesterHistoryService({
        client: db,
      } as DatabaseService)
        .read(id, actor)
        .then(
          () => undefined,
          (e: unknown) => (e as { code: string }).code,
        );
      try {
        await waitBlocked(db, pid, true);
      } finally {
        release.release();
      }
      await writer;
      assert.equal(await result, '40001');
      await restore();
    },
  );
  await t.test(
    'F058 routing versus assignment preserves one atomic revision winner',
    async () => {
      const id = await make();
      const ownership = new RequestOwnershipService({
        client: db,
      } as DatabaseService);
      const results = await Promise.allSettled([
        ownership.mutate(
          id,
          { expectedRevision: 1, targetType: 'staff', targetId: actorId },
          actor,
          'assign',
          'all',
        ),
        service().route(
          id,
          { expectedRevision: 1, departmentId: department, divisionId: null },
          actor,
          'all',
        ),
      ]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal((await state(id)).revision, 2);
    },
  );
  await t.test(
    'F058 three-session authenticated legacy, aligned request and writer queue completes without deadlock',
    async () => {
      const id = await make(),
        first = pauseAfter('service_request'),
        second = pauseAfter('organization_access_state');
      const config = { get: () => undefined } as unknown as ConfigService<
        AppConfiguration,
        true
      >;
      const legacy = new StaffActionsService(config, {
        client: db.withPlugin(first.plugin),
      } as DatabaseService);
      const firstResult = legacy.workflow(
        id,
        { expectedRevision: 1, action: 'start_work' },
        actor,
      );
      await bounded(first.arrived.promise);
      const secondResult = workflow(id, db.withPlugin(second.plugin)).then(
        () => false,
        () => true,
      );
      await bounded(second.arrived.promise);
      second.resume.release();
      let pid = 0;
      const ready = latch();
      const writer = db.transaction().execute(async (trx) => {
        pid = required(
          (
            await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(
              trx,
            )
          ).rows[0],
        ).pid;
        ready.release();
        await lockAuthorizationWriter(trx, c.org);
      });
      await bounded(ready.promise);
      try {
        await waitBlocked(db, pid, false);
      } finally {
        first.resume.release();
        second.resume.release();
      }
      await firstResult;
      assert.equal(await secondResult, true);
      await writer;
    },
  );
  for (const [name, key, run] of [
    [
      'assignment',
      'service_request.assign',
      (id: string, client = db) =>
        new RequestOwnershipService({ client } as DatabaseService).mutate(
          id,
          { expectedRevision: 1, targetType: 'staff', targetId: actorId },
          actor,
          'assign',
          'all',
        ),
    ],
    [
      'routing',
      'service_request.route',
      (id: string, client = db) =>
        service(client).route(
          id,
          { expectedRevision: 1, departmentId: department, divisionId: null },
          actor,
          'all',
        ),
    ],
    [
      'tracking',
      'service_request.tracking.manage',
      (id: string, client = db) =>
        new RequestTrackingService(
          { client } as DatabaseService,
          new RequestTrackingRepository(),
        ).change(id, actor, 'issue', null),
    ],
    [
      'answers',
      'service_request.answers.read',
      (id: string, client = db) =>
        new RequestAnswerService({ client } as DatabaseService).read(id, actor),
    ],
  ] as const) {
    await t.test(
      'F058 ' +
        name +
        ' waits for revocation and rejects a stale guard permission',
      async () => {
        const id = await make(),
          ready = latch(),
          release = latch();
        let pid = 0;
        const writer = db.transaction().execute(async (trx) => {
          await lockAuthorizationWriter(trx, c.org);
          pid = required(
            (
              await sql<{
                pid: number;
              }>`select pg_backend_pid() as pid`.execute(trx)
            ).rows[0],
          ).pid;
          await revoke(key)(trx);
          ready.release();
          await release.promise;
        });
        await bounded(ready.promise);
        const result = run(id).then(
          () => false,
          () => true,
        );
        try {
          await waitBlocked(db, pid, true);
        } finally {
          release.release();
        }
        await writer;
        assert.equal(await result, true);
        assert.deepEqual(await state(id), { status: 'open', revision: 1 });
        await restore();
      },
    );
    await t.test(
      'F058 ' + name + ' completes before a later revocation',
      async () => {
        const id = await make(),
          pause = pauseAfter('organization_access_state');
        const result = run(id, db.withPlugin(pause.plugin));
        await bounded(pause.arrived.promise);
        let pid = 0;
        const ready = latch();
        const writer = db.transaction().execute(async (trx) => {
          pid = required(
            (
              await sql<{
                pid: number;
              }>`select pg_backend_pid() as pid`.execute(trx)
            ).rows[0],
          ).pid;
          ready.release();
          await lockAuthorizationWriter(trx, c.org);
          await revoke(key)(trx);
        });
        await bounded(ready.promise);
        try {
          await waitBlocked(db, pid, false);
        } finally {
          pause.resume.release();
        }
        await result;
        await writer;
        await restore();
      },
    );
  }
  await t.test(
    'F058 count/page retains its snapshot during concurrent insertion',
    async () => {
      const pause = pauseAfter('service_definition_version');
      const repo = new InternalRequestRepository({
        client: db.withPlugin(pause.plugin),
      } as DatabaseService);
      const pending = repo.list(actor, 1, 100, {}, 'all');
      await pause.arrived.promise;
      const before = await db
        .selectFrom('service_request')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('routed_department_id', '=', department)
        .executeTakeFirstOrThrow();
      try {
        await make();
      } finally {
        pause.resume.release();
      }
      const result = await pending;
      assert.equal(result.total, before.n);
      assert.equal(result.items.length, Math.min(100, before.n));
    },
  );
  for (const kind of [
    'deletion',
    'status change',
    'membership revocation',
  ] as const)
    await t.test(
      'F058 authorized count/page snapshot survives concurrent ' + kind,
      async () => {
        const id = await make(),
          pause = pauseAfter('service_definition_version');
        const repo = new InternalRequestRepository({
          client: db.withPlugin(pause.plugin),
        } as DatabaseService);
        const filters = { q: 'F058-' + id, status: 'open' };
        const pending = repo.list(actor, 1, 25, filters, 'all');
        await bounded(pause.arrived.promise);
        try {
          if (kind === 'deletion')
            await db
              .deleteFrom('service_request')
              .where('id', '=', id)
              .execute();
          else if (kind === 'status change')
            await db
              .updateTable('service_request')
              .set({ status: 'in_progress' })
              .where('id', '=', id)
              .execute();
          else
            await db.transaction().execute(async (trx) => {
              await lockAuthorizationWriter(trx, c.org);
              await trx
                .updateTable('staff_department_membership')
                .set({ active: false })
                .where('staff_identity_id', '=', actorId)
                .execute();
            });
        } finally {
          pause.resume.release();
        }
        const result = await pending;
        assert.equal(result.total, 1);
        assert.equal(result.items[0]?.status, 'open');
        const fresh = await new InternalRequestRepository({
          client: db,
        } as DatabaseService).list(actor, 1, 25, filters, 'all');
        assert.equal(fresh.total, 0);
        await restore();
      },
    );
  await t.test(
    'F058 assignment rechecks target membership after a concurrent writer',
    async () => {
      const target = randomUUID(),
        id = await make();
      await db
        .insertInto('staff_identity')
        .values({
          id: target,
          organization_id: c.org,
          display_name: 'Synthetic assignment target',
          active: true,
        })
        .execute();
      await db
        .insertInto('staff_role_assignment')
        .values({
          organization_id: c.org,
          staff_identity_id: target,
          role_id: role,
          active: true,
        })
        .execute();
      await db
        .insertInto('staff_department_membership')
        .values({
          organization_id: c.org,
          staff_identity_id: target,
          department_id: department,
          active: true,
        })
        .execute();
      await db
        .insertInto('staff_division_membership')
        .values({
          organization_id: c.org,
          staff_identity_id: target,
          department_id: department,
          division_id: division,
          active: true,
        })
        .execute();
      const ready = latch(),
        release = latch();
      let pid = 0;
      const writer = db.transaction().execute(async (trx) => {
        await lockAuthorizationWriter(trx, c.org);
        pid = required(
          (
            await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(
              trx,
            )
          ).rows[0],
        ).pid;
        await trx
          .updateTable('staff_division_membership')
          .set({ active: false })
          .where('staff_identity_id', '=', target)
          .execute();
        ready.release();
        await release.promise;
      });
      await bounded(ready.promise);
      const result = new RequestOwnershipService({
        client: db,
      } as DatabaseService)
        .mutate(
          id,
          { expectedRevision: 1, targetType: 'staff', targetId: target },
          actor,
          'assign',
          'all',
        )
        .then(
          () => false,
          () => true,
        );
      try {
        await waitBlocked(db, pid, true);
      } finally {
        release.release();
      }
      await writer;
      assert.equal(await result, true);
      assert.equal((await state(id)).revision, 1);
      assert.equal(
        (
          await db
            .selectFrom('service_request_assignment')
            .select('id')
            .where('service_request_id', '=', id)
            .execute()
        ).length,
        0,
      );
    },
  );
  for (const size of [20, 200, 2000])
    await t.test(
      'F058 bounded list at ' + String(size) + ' synthetic requests',
      async () => {
        const prefix = 'scale' + String(size);
        const rows = Array.from({ length: size }, () => ({
          ...requestRow(randomUUID()),
          reference_number: (prefix + '-' + randomUUID()).toUpperCase(),
        }));
        for (let i = 0; i < rows.length; i += 200)
          await db
            .insertInto('service_request')
            .values(rows.slice(i, i + 200))
            .execute();
        await sql`update service_request set created_at='2026-01-01T00:00:00Z' where organization_id=${c.org} and reference_number like ${prefix.toUpperCase() + '-%'}`.execute(
          db,
        );
        for (const pageSize of [25, 50, 100]) {
          let queries = 0;
          const captured: CompiledQuery[] = [];
          const plugin: KyselyPlugin = {
            transformQuery(a) {
              queries++;
              const compiled = db.getExecutor().compileQuery(a.node, a.queryId);
              if (
                compiled.sql.includes('service_request') &&
                compiled.sql.includes('version')
              )
                captured.push(compiled);
              return a.node;
            },
            async transformResult(a) {
              return a.result;
            },
          };
          const repo = new InternalRequestRepository({
            client: db.withPlugin(plugin),
          } as DatabaseService);
          const filters = {
            q: prefix,
            audience: 'public' as const,
            departmentId: department,
            divisionId: division,
            status: 'open',
            assignment: 'unassigned' as const,
            view: 'all',
          };
          const result = await repo.list(actor, 1, pageSize, filters, 'all');
          assert.equal(result.total, size);
          assert.equal(result.items.length, Math.min(size, pageSize));
          assert.equal(queries, 8);
          const next = await repo.list(actor, 2, pageSize, filters, 'all');
          assert.equal(
            new Set(
              [...result.items, ...next.items].map((r) => r.serviceRequestId),
            ).size,
            result.items.length + next.items.length,
          );
          if (size === 2000 && pageSize === 100)
            for (const query of captured.slice(0, 2)) {
              const explained = await db.executeQuery<{
                'QUERY PLAN': {
                  'Execution Time': number;
                  Plan: Record<string, unknown>;
                }[];
              }>({
                ...query,
                sql: 'explain (analyze, buffers, format json) ' + query.sql,
              });
              const plan = explained.rows[0]?.['QUERY PLAN'][0];
              assert.ok(plan);
              t.diagnostic(
                'F058 EXPLAIN ' +
                  JSON.stringify({
                    executionMs: plan['Execution Time'],
                    rows: plan.Plan['Actual Rows'],
                    sharedHits: plan.Plan['Shared Hit Blocks'],
                    sharedReads: plan.Plan['Shared Read Blocks'],
                  }),
              );
            }
        }
        t.diagnostic(
          'Scale ' +
            String(size) +
            ': 5 authority queries + count/page + read-only setup = 8 statements, excluding BEGIN/COMMIT',
        );
      },
    );
}
