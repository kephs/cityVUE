import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import { Pool } from 'pg';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import type { StaffAccess, Permission } from '../../src/auth/auth.types.js';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';
import { phoneFixture } from '../helpers/resident-experience.fixture.js';
import { ResidentExperienceRepository } from '../../src/resident-experience/resident-experience.repository.js';
import { AdminResidentExperienceService } from '../../src/resident-experience/resident-experience.admin.service.js';
import { ResidentReviewRepository } from '../../src/resident-experience/resident-experience.review.repository.js';
import {
  classifyResidentPublication,
  type ResidentReviewBinding,
} from '../../src/resident-experience/resident-experience.review.js';
import {
  up,
  down,
} from '../../migrations/20261013000000-resident-experience-review-foundation.js';

test(
  'Slice 4A disposable review/publication database invariants',
  { skip: !process.env.TEST_DATABASE_URL && 'TEST_DATABASE_URL missing' },
  async (t) => {
    const testUrl = process.env.TEST_DATABASE_URL;
    assert.ok(testUrl);
    const url = new URL(testUrl);
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
    assert.equal(url.pathname, '/reqro_f0592_test');
    assert.equal(decodeURIComponent(url.username), 'reqro_test_user');
    const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const schema = `resident_review_${randomUUID().replaceAll('-', '')}`;
    let db: Kysely<DatabaseSchema> | undefined,
      created = false;
    try {
      assert.deepEqual(
        (await admin.query('select current_database() db,current_user usr'))
          .rows,
        [{ db: 'reqro_f0592_test', usr: 'reqro_test_user' }],
      );
      const address = await admin.query<{ address: string }>(
        'select inet_server_addr()::text address',
      );
      assert.ok(
        ['::1/128', '127.0.0.1/32'].includes(address.rows[0]?.address ?? ''),
      );
      await prepareDatabaseExtensions(admin);
      await admin.query(`create schema "${schema}"`);
      created = true;
      db = new Kysely<DatabaseSchema>({
        dialect: new PostgresDialect({
          pool: new Pool({
            connectionString: process.env.TEST_DATABASE_URL,
            options: `-c search_path=${schema}`,
            max: 8,
          }),
        }),
      });
      const database = db;
      const isolated = await sql<{
        schema: string;
      }>`select current_schema() as schema`.execute(database);
      assert.equal(isolated.rows[0]?.schema, schema);
      const folder = path.resolve(__dirname, '../../migrations');
      const migrations = (await readdir(folder))
        .filter((f) => f.endsWith('.js') && f < '20261013000000')
        .sort();
      assert.equal(migrations.length, 42);
      for (const file of migrations) {
        const migration = (await import(
          pathToFileURL(path.join(folder, file)).href
        )) as { up: (db: Kysely<DatabaseSchema>) => Promise<void> };
        await database.transaction().execute(migration.up);
      }
      const snapshots = new ResidentExperienceRepository(database),
        drafts = new AdminResidentExperienceService(snapshots),
        reviews = new ResidentReviewRepository(snapshots);
      const authorPermissions: Permission[] = [
        'admin.configuration.read',
        'resident_experience.write',
        'resident_experience.contact.manage',
        'resident_experience.publish',
      ];
      async function actor(
        org: string,
        permissions: Permission[] = authorPermissions,
      ) {
        const id = randomUUID(),
          role = randomUUID(),
          tenant = randomUUID(),
          object = randomUUID();
        await database.transaction().execute(async (trx) => {
          await trx
            .selectFrom('organization')
            .select('id')
            .where('id', '=', org)
            .forUpdate()
            .execute();
          await trx
            .selectFrom('organization_access_state')
            .select('organization_id')
            .where('organization_id', '=', org)
            .forUpdate()
            .execute();
          await trx
            .insertInto('staff_identity')
            .values({
              id,
              organization_id: org,
              entra_tenant_id: tenant,
              entra_object_id: object,
              display_name: 'Synthetic reviewer',
              email: null,
              active: true,
            })
            .execute();
          await trx
            .insertInto('role')
            .values({
              id: role,
              organization_id: org,
              name: role,
              description: null,
              active: true,
            })
            .execute();
          for (const permission_key of permissions)
            await trx
              .insertInto('role_permission')
              .values({ organization_id: org, role_id: role, permission_key })
              .execute();
          await trx
            .insertInto('staff_role_assignment')
            .values({
              organization_id: org,
              staff_identity_id: id,
              role_id: role,
              active: true,
            })
            .execute();
        });
        const access: StaffAccess = {
          organizationId: org,
          staffIdentityId: id,
          tenantId: tenant,
          objectId: object,
          displayName: 'Synthetic',
          permissions,
          scopes: [],
          departmentIds: [],
          divisionIds: [],
          development: false,
        };
        return { access, role };
      }
      async function fixture() {
        const org = randomUUID();
        await database
          .insertInto('organization')
          .values({
            id: org,
            name: 'Synthetic reviews',
            short_name: 'Test',
            slug: org,
            status: 'active',
            default_business_timezone: 'UTC',
          })
          .execute();
        const author = await actor(org),
          reviewer = await actor(org, [
            'admin.configuration.read',
            'resident_experience.publish',
            'resident_experience.contact.manage',
          ]),
          publisher = await actor(org);
        const snapshot = phoneFixture();
        await drafts.save(
          author.access,
          { expectedRevision: 1, snapshot },
          randomUUID(),
        );
        return { org, author, reviewer, publisher, snapshot };
      }
      type Fixture = Awaited<ReturnType<typeof fixture>>;
      async function binding(f: Fixture): Promise<ResidentReviewBinding> {
        const resource = await snapshots.getResource(f.org);
        assert.ok(resource?.draft_revision_id);
        const auth = await database
          .selectFrom('organization_access_state')
          .select('authorization_revision')
          .where('organization_id', '=', f.org)
          .executeTakeFirstOrThrow();
        return {
          organizationId: f.org,
          targetRevisionId: resource.draft_revision_id,
          baselineRevisionId: resource.published_revision_id,
          draftRevisionId: resource.draft_revision_id,
          resourceRevision: resource.revision,
          authorizationRevision: auth.authorization_revision,
          purpose: 'draft',
          policyVersion: 1,
          classifierVersion: 1,
        };
      }
      async function request(f: Fixture, b?: ResidentReviewBinding) {
        const current = b ?? (await binding(f));
        const previous = await database
          .selectFrom('resident_experience_review_request')
          .select('id')
          .where('organization_id', '=', f.org)
          .orderBy('review_sequence', 'desc')
          .executeTakeFirst();
        return database
          .transaction()
          .execute((trx) =>
            reviews.insertRequest(
              trx,
              f.author.access,
              current,
              previous?.id ?? null,
            ),
          );
      }
      type Request = Awaited<ReturnType<typeof request>>;
      async function decide(
        f: Fixture,
        r: Request,
        outcome: 'approved' | 'rejected' = 'approved',
        access = f.reviewer.access,
      ) {
        return database
          .transaction()
          .execute((trx) =>
            reviews.insertDecision(
              trx,
              access,
              r.id,
              r.resource_revision,
              outcome,
            ),
          );
      }
      type Decision = Awaited<ReturnType<typeof decide>>;
      async function publication(
        trx: Transaction<DatabaseSchema>,
        f: Fixture,
        r: Request,
        d: Decision,
        actorId = f.publisher.access.staffIdentityId,
        transition = true,
      ) {
        await trx
          .insertInto('resident_experience_event')
          .values({
            id: randomUUID(),
            organization_id: f.org,
            actor_id: actorId,
            operation: 'published',
            prior_revision_id: r.baseline_revision_id,
            new_revision_id: r.target_revision_id,
            prior_resource_revision: r.resource_revision,
            resource_revision: r.resource_revision + 1,
            changed_fields: r.changed_fields,
            consequential: r.consequential,
            reasons: r.reasons,
            correlation_id: randomUUID(),
            review_request_id: r.id,
            review_decision_id: d.id,
          })
          .execute();
        if (transition)
          await trx
            .updateTable('organization_resident_experience')
            .set({
              published_revision_id: r.target_revision_id,
              revision: r.resource_revision + 1,
            })
            .where('organization_id', '=', f.org)
            .execute();
      }
      const publish = (f: Fixture, r: Request, d: Decision, actorId?: string) =>
        database
          .transaction()
          .execute((trx) => publication(trx, f, r, d, actorId));
      const seed = await fixture();
      await database
        .updateTable('organization_branding')
        .set({ display_name: 'Preserved synthetic branding' })
        .where('organization_id', '=', seed.org)
        .execute();
      async function preserved() {
        const output: Record<string, unknown> = {};
        for (const table of [
          'organization_branding',
          'permission',
          'role',
          'role_permission',
          'staff_role_assignment',
          'resident_experience_revision',
          'resident_experience_action',
          'resident_experience_contact',
          'resident_experience_benefit',
        ])
          output[table] = (
            await sql`select to_jsonb(x) row from ${sql.table(table)} x order by to_jsonb(x)::text`.execute(
              database,
            )
          ).rows;
        return output;
      }
      const before = await preserved();
      await t.test(
        '43 apply / rollback / reapply preserves existing drafts, branding, registry, roles and grants',
        async () => {
          await database.transaction().execute(up);
          assert.deepEqual(await preserved(), before);
          await database.transaction().execute(down);
          assert.deepEqual(await preserved(), before);
          await database.transaction().execute(up);
          assert.deepEqual(await preserved(), before);
          assert.equal(
            (await snapshots.getResource(seed.org))?.published_revision_id,
            null,
          );
        },
      );
      await t.test(
        'first publication and SQL/domain classification agree without exposing a runtime command',
        async () => {
          const r = await request(seed);
          assert.deepEqual(
            {
              changedFields: r.changed_fields,
              reasons: r.reasons,
              consequential: r.consequential,
            },
            classifyResidentPublication(null, seed.snapshot),
          );
          assert.equal(r.reasons[0], 'first_publication');
          await assert.rejects(
            database.transaction().execute(down),
            /Retained resident review evidence/,
          );
          const d = await decide(seed, r);
          await publish(seed, r, d);
          assert.deepEqual(
            await snapshots.getPublished(seed.org),
            seed.snapshot,
          );
        },
      );
      await t.test(
        'ordinary publication can be reviewed and published without contact or edit permission',
        async () => {
          const f = await fixture(),
            r = await request(f),
            d = await decide(f, r);
          await publish(f, r, d);
          const next = structuredClone(f.snapshot);
          next.presentation.branding.applicationName = 'Ordinary branding';
          await drafts.save(
            f.author.access,
            { expectedRevision: r.resource_revision + 1, snapshot: next },
            randomUUID(),
          );
          const reviewer = await actor(f.org, [
            'admin.configuration.read',
            'resident_experience.publish',
          ]);
          const publisher = await actor(f.org, [
            'admin.configuration.read',
            'resident_experience.publish',
          ]);
          const ordinary = await request(f);
          assert.equal(ordinary.consequential, false);
          const approved = await decide(
            f,
            ordinary,
            'approved',
            reviewer.access,
          );
          await publish(
            f,
            ordinary,
            approved,
            publisher.access.staffIdentityId,
          );
          assert.deepEqual(await snapshots.getPublished(f.org), next);
        },
      );
      await t.test(
        'review requests and decisions reject update, delete and truncate',
        async () => {
          const f = await fixture(),
            r = await request(f);
          await decide(f, r);
          for (const table of [
            'resident_experience_review_request',
            'resident_experience_review_decision',
          ]) {
            for (const op of ['update', 'delete', 'truncate'])
              await assert.rejects(
                database.transaction().execute(async (trx) => {
                  if (op === 'update')
                    await sql`update ${sql.table(table)} set id=id`.execute(
                      trx,
                    );
                  else if (op === 'delete')
                    await sql`delete from ${sql.table(table)}`.execute(trx);
                  else await sql`truncate ${sql.table(table)}`.execute(trx);
                }),
                /immutable|foreign key/i,
              );
          }
        },
      );
      await t.test(
        'one terminal decision per request, including conflicting outcomes and concurrent decisions',
        async () => {
          const f = await fixture(),
            r = await request(f);
          const outcomes = await Promise.allSettled([
            decide(f, r),
            decide(f, r, 'rejected'),
          ]);
          assert.equal(
            outcomes.filter((x) => x.status === 'fulfilled').length,
            1,
          );
          assert.equal(
            (
              await database
                .selectFrom('resident_experience_review_decision')
                .selectAll()
                .where('request_id', '=', r.id)
                .execute()
            ).length,
            1,
          );
        },
      );
      await t.test(
        'cross-Organization target, request, decision and publication references fail safely',
        async () => {
          const a = await fixture(),
            b = await fixture(),
            ra = await request(a),
            rb = await request(b),
            da = await decide(a, ra),
            dbb = await decide(b, rb);
          await assert.rejects(
            request(a, {
              ...(await binding(a)),
              targetRevisionId: rb.target_revision_id,
            }),
            /Not Found/,
          );
          await assert.rejects(
            database
              .transaction()
              .execute((trx) =>
                reviews.insertDecision(
                  trx,
                  b.reviewer.access,
                  ra.id,
                  rb.resource_revision,
                  'approved',
                ),
              ),
            /Not Found/,
          );
          await assert.rejects(publish(a, ra, dbb), /approval unusable/);
          await assert.rejects(publish(b, ra, da), /review unavailable/);
          await assert.rejects(
            database
              .insertInto('resident_experience_review_decision')
              .values({
                id: randomUUID(),
                organization_id: b.org,
                request_id: ra.id,
                reviewer_id: b.reviewer.access.staffIdentityId,
                outcome: 'approved',
              })
              .execute(),
            /review unavailable/,
          );
        },
      );
      await t.test(
        'request binding rejects incorrect publication baseline, resource revision and authorization context',
        async () => {
          const f = await fixture(),
            b = await binding(f);
          for (const changed of [
            { ...b, baselineRevisionId: b.targetRevisionId },
            { ...b, resourceRevision: b.resourceRevision + 1 },
            { ...b, authorizationRevision: '999999' },
          ])
            await assert.rejects(
              request(f, changed),
              /changed|Stale resident review/,
            );
          for (const changed of [
            { ...b, policyVersion: 2 },
            { ...b, classifierVersion: 2 },
          ])
            await assert.rejects(request(f, changed), /check constraint/);
        },
      );
      await t.test(
        'publication event cannot substitute another revision or classification',
        async () => {
          const f = await fixture(),
            r = await request(f),
            d = await decide(f, r);
          await assert.rejects(
            publish(
              f,
              {
                ...r,
                new_revision_id: randomUUID(),
                target_revision_id: randomUUID(),
              } as Request,
              d,
            ),
            /evidence mismatch/,
          );
          await assert.rejects(
            publish(f, { ...r, consequential: false }, d),
            /evidence mismatch/,
          );
        },
      );
      await t.test(
        '24-hour database window is half-open and timestamps cannot be backdated or extended',
        async () => {
          const f = await fixture(),
            r = await request(f);
          const d = await database
            .insertInto('resident_experience_review_decision')
            .values({
              id: randomUUID(),
              organization_id: f.org,
              request_id: r.id,
              reviewer_id: f.reviewer.access.staffIdentityId,
              outcome: 'approved',
              decided_at: new Date(0),
              expires_at: new Date('2999-01-01'),
            })
            .returningAll()
            .executeTakeFirstOrThrow();
          assert.ok(d.decided_at.getTime() > Date.now() - 10000);
          assert.equal(
            d.expires_at.getTime() - d.decided_at.getTime(),
            86400000,
          );
          const result = await sql<{
            start: boolean;
            before: boolean;
            expired: boolean;
            future: boolean;
          }>`select resident_review_unexpired(${d.decided_at}::timestamptz,${d.decided_at}::timestamptz) start,
        resident_review_unexpired(${d.decided_at}::timestamptz,${d.expires_at}::timestamptz-interval '1 microsecond') before,
        resident_review_unexpired(${d.decided_at}::timestamptz,${d.expires_at}::timestamptz) expired,
        resident_review_unexpired(${d.decided_at}::timestamptz,${d.decided_at}::timestamptz-interval '1 microsecond') future`.execute(
            database,
          );
          assert.deepEqual(result.rows, [
            { start: true, before: true, expired: false, future: false },
          ]);
        },
      );
      await t.test('rejected approval cannot publish', async () => {
        const f = await fixture(),
          r = await request(f),
          d = await decide(f, r, 'rejected');
        await assert.rejects(publish(f, r, d), /approval unusable/);
        assert.equal(await snapshots.getPublished(f.org), null);
      });
      await t.test(
        'superseding review request invalidates an old approval without changing history',
        async () => {
          const f = await fixture(),
            r = await request(f),
            d = await decide(f, r);
          await request(f);
          await assert.rejects(publish(f, r, d), /review unavailable/);
          assert.equal(
            (
              await database
                .selectFrom('resident_experience_review_decision')
                .select('outcome')
                .where('id', '=', d.id)
                .executeTakeFirstOrThrow()
            ).outcome,
            'approved',
          );
        },
      );
      await t.test(
        'later content save invalidates old approval and preserves prior publication',
        async () => {
          const f = await fixture(),
            r = await request(f),
            d = await decide(f, r);
          const changed = structuredClone(f.snapshot);
          changed.presentation.benefitsLabel = 'Changed';
          await drafts.save(
            f.author.access,
            { expectedRevision: r.resource_revision, snapshot: changed },
            randomUUID(),
          );
          await assert.rejects(publish(f, r, d), /review unavailable/);
          assert.equal(await snapshots.getPublished(f.org), null);
        },
      );
      await t.test(
        'authorization revision change invalidates approval, including revoke then regrant',
        async () => {
          const f = await fixture(),
            r = await request(f),
            d = await decide(f, r);
          await database.transaction().execute(async (trx) => {
            await trx
              .selectFrom('organization')
              .select('id')
              .where('id', '=', f.org)
              .forUpdate()
              .execute();
            await trx
              .selectFrom('organization_access_state')
              .select('organization_id')
              .where('organization_id', '=', f.org)
              .forUpdate()
              .execute();
            await trx
              .deleteFrom('role_permission')
              .where('role_id', '=', f.reviewer.role)
              .where('permission_key', '=', 'resident_experience.publish')
              .execute();
            await trx
              .insertInto('role_permission')
              .values({
                organization_id: f.org,
                role_id: f.reviewer.role,
                permission_key: 'resident_experience.publish',
              })
              .execute();
          });
          await assert.rejects(publish(f, r, d), /review unavailable/);
        },
      );
      await t.test(
        'saver cannot review; reviewer cannot publish; consequential review and publication need contact authority',
        async () => {
          const f = await fixture();
          const limited = await actor(f.org, [
            'admin.configuration.read',
            'resident_experience.publish',
          ]);
          const r = await request(f);
          await assert.rejects(
            decide(f, r, 'approved', f.author.access),
            /Independent resident reviewer/,
          );
          await assert.rejects(
            decide(f, r, 'approved', limited.access),
            /Access denied/,
          );
          const d = await decide(f, r);
          await assert.rejects(
            publish(f, r, d, f.reviewer.access.staffIdentityId),
            /Independent resident publication/,
          );
          await assert.rejects(
            publish(f, r, d, limited.access.staffIdentityId),
            /Independent resident publication/,
          );
        },
      );
      await t.test(
        'cosmetic successor cannot launder consequential contributor identity',
        async () => {
          const f = await fixture();
          const next = structuredClone(f.snapshot);
          next.presentation.branding.applicationName = 'Cosmetic';
          await drafts.save(
            f.publisher.access,
            { expectedRevision: 2, snapshot: next },
            randomUUID(),
          );
          const r = await request(f);
          await assert.rejects(
            decide(f, r, 'approved', f.author.access),
            /Independent resident reviewer/,
          );
          const contributors = await database
            .transaction()
            .execute((trx) =>
              reviews.contributors(trx, f.org, r.target_revision_id, null),
            );
          assert.deepEqual(
            contributors,
            [
              f.author.access.staffIdentityId,
              f.publisher.access.staffIdentityId,
            ].sort(),
          );
        },
      );
      await t.test(
        'forged publication evidence cannot commit without a matching pointer transition',
        async () => {
          const f = await fixture(),
            r = await request(f),
            d = await decide(f, r);
          await assert.rejects(
            database
              .transaction()
              .execute((trx) => publication(trx, f, r, d, undefined, false)),
            /matching transition/,
          );
          assert.equal(
            (
              await database
                .selectFrom('resident_experience_event')
                .select('id')
                .where('organization_id', '=', f.org)
                .where('operation', '=', 'published')
                .execute()
            ).length,
            0,
          );
        },
      );
      await t.test(
        'published pointer cannot change without exact same-transaction approved evidence',
        async () => {
          const f = await fixture(),
            b = await binding(f);
          await assert.rejects(
            database
              .updateTable('organization_resident_experience')
              .set({
                published_revision_id: b.targetRevisionId,
                revision: b.resourceRevision + 1,
              })
              .where('organization_id', '=', f.org)
              .execute(),
            /atomic approval evidence/,
          );
          assert.equal(await snapshots.getPublished(f.org), null);
        },
      );
      await t.test(
        'concurrent publication consumes an approval once and advances the pointer once',
        async () => {
          const f = await fixture(),
            r = await request(f),
            d = await decide(f, r);
          const results = await Promise.allSettled([
            publish(f, r, d),
            publish(f, r, d),
          ]);
          assert.equal(
            results.filter((x) => x.status === 'fulfilled').length,
            1,
          );
          await assert.rejects(publish(f, r, d));
          assert.equal(
            (await snapshots.getResource(f.org))?.revision,
            r.resource_revision + 1,
          );
          assert.equal(
            (
              await database
                .selectFrom('resident_experience_event')
                .select('id')
                .where('review_decision_id', '=', d.id)
                .execute()
            ).length,
            1,
          );
        },
      );
      await t.test(
        'publication baseline change invalidates all earlier context and historical republish needs fresh review',
        async () => {
          const f = await fixture(),
            r1 = await request(f),
            d1 = await decide(f, r1);
          await publish(f, r1, d1);
          const changed = structuredClone(f.snapshot);
          assert.ok(changed.contacts[0]);
          changed.contacts[0].guidance = 'Changed synthetic guidance';
          await drafts.save(
            f.author.access,
            { expectedRevision: 3, snapshot: changed },
            randomUUID(),
          );
          const r2 = await request(f),
            d2 = await decide(f, r2);
          await publish(f, r2, d2);
          await assert.rejects(publish(f, r1, d1), /review unavailable/);
          const b = {
            ...(await binding(f)),
            targetRevisionId: r1.target_revision_id,
            purpose: 'historical' as const,
          };
          const r3 = await request(f, b),
            d3 = await decide(f, r3);
          await publish(f, r3, d3);
          assert.deepEqual(await snapshots.getPublished(f.org), f.snapshot);
          assert.equal(
            (await snapshots.getResource(f.org))?.draft_revision_id,
            r2.target_revision_id,
          );
        },
      );
      await t.test(
        'historical mode rejects a revision that has never been published',
        async () => {
          const f = await fixture();
          await assert.rejects(
            request(f, { ...(await binding(f)), purpose: 'historical' }),
            /Invalid resident review purpose/,
          );
        },
      );
      await t.test(
        'empty collections remain intentional and publishing never creates defaults',
        async () => {
          const f = await fixture();
          const empty = structuredClone(f.snapshot);
          empty.actions = [];
          empty.contacts = [];
          empty.benefits = [];
          await drafts.save(
            f.author.access,
            { expectedRevision: 2, snapshot: empty },
            randomUUID(),
          );
          const r = await request(f),
            d = await decide(f, r);
          await publish(f, r, d);
          assert.deepEqual(await snapshots.getPublished(f.org), empty);
        },
      );
      await t.test(
        'new review rows cannot be created and approved/published within one transaction',
        async () => {
          const f = await fixture(),
            b = await binding(f);
          await assert.rejects(
            database.transaction().execute(async (trx) => {
              const r = await reviews.insertRequest(
                trx,
                f.author.access,
                b,
                null,
              );
              await reviews.insertDecision(
                trx,
                f.reviewer.access,
                r.id,
                b.resourceRevision,
                'approved',
              );
            }),
            /review unavailable/,
          );
        },
      );
      await t.test(
        'existing revisions/children/save events remain immutable and late child inserts remain blocked',
        async () => {
          const f = await fixture(),
            b = await binding(f);
          await assert.rejects(
            sql`update resident_experience_revision set presentation=presentation where id=${b.targetRevisionId}::uuid`.execute(
              database,
            ),
            /immutable/,
          );
          await assert.rejects(
            sql`delete from resident_experience_action where revision_id=${b.targetRevisionId}::uuid`.execute(
              database,
            ),
            /immutable/,
          );
          await assert.rejects(
            sql`insert into resident_experience_benefit select organization_id,revision_id,'late',enabled,99,icon_key,title,description from resident_experience_benefit where revision_id=${b.targetRevisionId}::uuid`.execute(
              database,
            ),
            /closed/,
          );
          await assert.rejects(
            sql`update resident_experience_event set consequential=consequential where organization_id=${f.org}::uuid`.execute(
              database,
            ),
            /immutable/,
          );
        },
      );
      await t.test(
        'approval authorization changes after evidence insertion roll back the entire publication',
        async () => {
          const f = await fixture(),
            r = await request(f),
            d = await decide(f, r);
          await assert.rejects(
            database.transaction().execute(async (trx) => {
              await publication(trx, f, r, d);
              await trx
                .insertInto('role_permission')
                .values({
                  organization_id: f.org,
                  role_id: f.author.role,
                  permission_key: 'analytics.service_participation.read',
                })
                .execute();
            }),
            /expired or superseded before commit/,
          );
          assert.equal(await snapshots.getPublished(f.org), null);
          assert.equal(
            (
              await database
                .selectFrom('role_permission')
                .selectAll()
                .where('role_id', '=', f.author.role)
                .where(
                  'permission_key',
                  '=',
                  'analytics.service_participation.read',
                )
                .execute()
            ).length,
            0,
          );
        },
      );
      await t.test(
        'stale review selection and same-transaction approval consumption are rejected',
        async () => {
          const f = await fixture(),
            b = await binding(f),
            r = await request(f);
          await assert.rejects(
            database
              .transaction()
              .execute((trx) =>
                reviews.insertRequest(trx, f.author.access, b, null),
              ),
            /Stale resident review selection/,
          );
          await assert.rejects(
            database.transaction().execute(async (trx) => {
              const d = await reviews.insertDecision(
                trx,
                f.reviewer.access,
                r.id,
                r.resource_revision,
                'approved',
              );
              await publication(trx, f, r, d);
            }),
            /approval unusable/,
          );
        },
      );
      await t.test(
        'historical review excludes the author of consequential changes being undone',
        async () => {
          const f = await fixture(),
            r1 = await request(f),
            d1 = await decide(f, r1);
          await publish(f, r1, d1);
          const changed = structuredClone(f.snapshot);
          assert.ok(changed.contacts[0]);
          changed.contacts[0].guidance =
            'Changed by a different synthetic author';
          await drafts.save(
            f.publisher.access,
            { expectedRevision: 3, snapshot: changed },
            randomUUID(),
          );
          const r2 = await request(f),
            d2 = await decide(f, r2);
          await publish(f, r2, d2);
          const historical = await request(f, {
            ...(await binding(f)),
            targetRevisionId: r1.target_revision_id,
            purpose: 'historical',
          });
          await assert.rejects(
            decide(f, historical, 'approved', f.publisher.access),
            /Independent resident reviewer/,
          );
        },
      );
      await t.test(
        'rollback refuses retained Slice 4 evidence without losing any data',
        async () => {
          const requests = await database
            .selectFrom('resident_experience_review_request')
            .selectAll()
            .orderBy('id')
            .execute();
          await assert.rejects(
            database.transaction().execute(down),
            /Retained resident review evidence/,
          );
          assert.deepEqual(
            await database
              .selectFrom('resident_experience_review_request')
              .selectAll()
              .orderBy('id')
              .execute(),
            requests,
          );
        },
      );
    } finally {
      if (db) await db.destroy();
      if (created) {
        assert.match(schema, /^resident_review_[a-f0-9]{32}$/);
        await admin.query(`drop schema "${schema}" cascade`);
      }
      await admin.end();
    }
  },
);
