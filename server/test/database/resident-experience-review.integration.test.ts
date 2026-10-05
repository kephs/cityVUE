import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import httpRequest from 'supertest';
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
import { AdminResidentReviewService } from '../../src/resident-experience/resident-experience.review.service.js';
import { ResidentPublicationService } from '../../src/resident-experience/resident-experience.publication.service.js';
import { residentReviewApi } from '../helpers/resident-experience-review-api.js';
import { projectPublishedResidentExperience } from '../../src/resident-experience/resident-experience.public.dto.js';
import {
  classifyResidentPublication,
  type ResidentReviewBinding,
} from '../../src/resident-experience/resident-experience.review.js';
import {
  up,
  down,
} from '../../migrations/20261013000000-resident-experience-review-foundation.js';
import {
  up as up44,
  down as down44,
} from '../../migrations/20261014000000-separate-resident-review-authority.js';

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
        reviews = new ResidentReviewRepository(snapshots),
        publicationService = new ResidentPublicationService(snapshots);
      const authorPermissions: Permission[] = [
        'admin.configuration.read',
        'resident_experience.write',
        'resident_experience.contact.manage',
      ];
      let policyVersion: 1 | 2 = 1;
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
          permissions: [...permissions],
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
            policyVersion === 1
              ? 'resident_experience.publish'
              : 'resident_experience.review',
            'resident_experience.contact.manage',
          ]),
          publisher = await actor(org, [
            'admin.configuration.read',
            'resident_experience.publish',
            'resident_experience.contact.manage',
          ]);
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
          policyVersion,
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
      const publishWithService = (
        f: Fixture,
        r: Request,
        publisher = f.publisher,
      ) =>
        publicationService.publish({
          publisher: publisher.access,
          reviewRequestId: r.id,
          expectedResourceRevision: r.resource_revision,
          correlationId: randomUUID(),
        });
      async function grant(
        actor: Awaited<ReturnType<typeof fixture>>['author'],
        ...keys: Permission[]
      ) {
        await database.transaction().execute(async (trx) => {
          await trx
            .selectFrom('organization')
            .select('id')
            .where('id', '=', actor.access.organizationId)
            .forUpdate()
            .execute();
          await trx
            .selectFrom('organization_access_state')
            .select('organization_id')
            .where('organization_id', '=', actor.access.organizationId)
            .forUpdate()
            .execute();
          for (const permission_key of keys)
            await trx
              .insertInto('role_permission')
              .values({
                organization_id: actor.access.organizationId,
                role_id: actor.role,
                permission_key,
              })
              .execute();
        });
        actor.access.permissions.push(...keys);
      }
      async function rawDecision(
        f: Fixture,
        r: Request,
        reviewer = f.reviewer.access,
      ) {
        return database
          .insertInto('resident_experience_review_decision')
          .values({
            id: randomUUID(),
            organization_id: f.org,
            request_id: r.id,
            reviewer_id: reviewer.staffIdentityId,
            outcome: 'approved',
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      }
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
        '44 apply / rollback / reapply preserves v1 evidence and creates zero grants',
        async () => {
          const historical = await fixture(),
            pending = await fixture(),
            approved = await fixture();
          const historicalRequest = await request(historical),
            historicalDecision = await rawDecision(
              historical,
              historicalRequest,
            );
          await publish(historical, historicalRequest, historicalDecision);
          const pendingRequest = await request(pending),
            approvedRequest = await request(approved),
            approvedDecision = await rawDecision(approved, approvedRequest);
          const retained = await preserved();
          const evidence = async () => ({
            requests: await database
              .selectFrom('resident_experience_review_request')
              .selectAll()
              .orderBy('id')
              .execute(),
            decisions: await database
              .selectFrom('resident_experience_review_decision')
              .selectAll()
              .orderBy('id')
              .execute(),
            events: await database
              .selectFrom('resident_experience_event')
              .selectAll()
              .orderBy('id')
              .execute(),
          });
          const oldEvidence = await evidence();
          const currentLegacy = async () =>
            (
              await sql<{
                valid: boolean;
              }>`select resident_review_context_valid(q) valid from resident_experience_review_request q where id=${pendingRequest.id}::uuid`.execute(
                database,
              )
            ).rows[0]?.valid;
          assert.equal(await currentLegacy(), true);
          await database.transaction().execute(up44);
          assert.equal(await currentLegacy(), false);
          assert.equal(
            (
              await database
                .selectFrom('organization_access_state')
                .select('authorization_revision')
                .where('organization_id', '=', pending.org)
                .executeTakeFirstOrThrow()
            ).authorization_revision,
            pendingRequest.authorization_revision,
          );
          assert.equal(
            (
              await database
                .selectFrom('role_permission')
                .selectAll()
                .where('permission_key', '=', 'resident_experience.review')
                .execute()
            ).length,
            0,
          );
          assert.deepEqual(
            { ...(await preserved()), permission: retained.permission },
            retained,
          );
          assert.deepEqual(await evidence(), oldEvidence);
          await database.transaction().execute(down44);
          assert.deepEqual(await preserved(), retained);
          assert.deepEqual(await evidence(), oldEvidence);
          await database.transaction().execute(up44);
          policyVersion = 2;
          await grant(seed.reviewer, 'resident_experience.review');
          await grant(pending.reviewer, 'resident_experience.review');
          await grant(approved.reviewer, 'resident_experience.review');
          const lifecycle = new AdminResidentReviewService(snapshots);
          assert.equal(
            (await lifecycle.get(pending.reviewer.access, pendingRequest.id))
              .canReview,
            false,
          );
          assert.equal(
            (await lifecycle.get(approved.publisher.access, approvedRequest.id))
              .canPublish,
            false,
          );
          assert.equal(
            (await lifecycle.get(approved.publisher.access, approvedRequest.id))
              .usability.reason,
            'stale',
          );
          await assert.rejects(
            rawDecision(pending, pendingRequest),
            /unavailable/,
          );
          await assert.rejects(
            publish(approved, approvedRequest, approvedDecision),
            /unavailable/,
          );
          await assert.rejects(
            lifecycle.decide(pending.reviewer.access, pendingRequest.id, {
              expectedRevision: 2,
              outcome: 'approved',
            }),
            ConflictException,
          );
          await assert.rejects(
            publishWithService(approved, approvedRequest),
            ConflictException,
          );
          await assert.rejects(
            request(seed, { ...(await binding(seed)), policyVersion: 1 }),
            /Current resident review policy/,
          );
          await assert.rejects(
            sql`update resident_experience_review_request set policy_version=2 where id=${pendingRequest.id}::uuid`.execute(
              database,
            ),
            /immutable/,
          );
          await assert.rejects(
            sql`delete from resident_experience_review_decision where id=${approvedDecision.id}::uuid`.execute(
              database,
            ),
            /immutable/,
          );
          assert.deepEqual(await evidence(), oldEvidence);
          assert.deepEqual(
            await snapshots.getPublished(historical.org),
            historical.snapshot,
          );
          const replacement = await lifecycle.create(approved.author.access, {
            targetRevisionId: approvedRequest.target_revision_id,
            expectedRevision: approvedRequest.resource_revision,
            purpose: 'draft',
            supersedesRequestId: approvedRequest.id,
          });
          assert.equal(replacement.policyVersion, 2);
          await lifecycle.decide(approved.reviewer.access, replacement.id, {
            expectedRevision: replacement.resourceRevision,
            outcome: 'approved',
          });
          await publicationService.publish({
            publisher: approved.publisher.access,
            reviewRequestId: replacement.id,
            expectedResourceRevision: replacement.resourceRevision,
            correlationId: randomUUID(),
          });
          assert.deepEqual(
            await snapshots.getPublished(approved.org),
            approved.snapshot,
          );
          assert.deepEqual(
            await database
              .selectFrom('resident_experience_review_request')
              .selectAll()
              .where('id', '=', approvedRequest.id)
              .executeTakeFirstOrThrow(),
            approvedRequest,
          );
          assert.deepEqual(
            await database
              .selectFrom('resident_experience_review_decision')
              .selectAll()
              .where('id', '=', approvedDecision.id)
              .executeTakeFirstOrThrow(),
            approvedDecision,
          );
        },
      );
      await t.test(
        'policy 2 has independent review-only and publish-only authority in service and database',
        async () => {
          const f = await fixture(),
            r = await request(f);
          const lifecycle = new AdminResidentReviewService(snapshots);
          assert.equal(
            (await lifecycle.get(f.reviewer.access, r.id)).canReview,
            true,
          );
          assert.equal(
            (await lifecycle.get(f.publisher.access, r.id)).canReview,
            false,
          );
          await assert.rejects(
            decide(f, r, 'approved', f.publisher.access),
            ForbiddenException,
          );
          await assert.rejects(
            rawDecision(f, r, f.publisher.access),
            /Independent resident reviewer/,
          );
          const d = await decide(f, r);
          assert.equal(
            (await lifecycle.get(f.publisher.access, r.id)).canPublish,
            true,
          );
          assert.equal(
            (await lifecycle.get(f.reviewer.access, r.id)).canPublish,
            false,
          );
          await assert.rejects(
            publishWithService(f, r, f.reviewer),
            ForbiddenException,
          );
          const secondReviewer = await actor(f.org, [
            'admin.configuration.read',
            'resident_experience.review',
            'resident_experience.contact.manage',
          ]);
          const fresh = await request(f),
            decision = await decide(f, fresh);
          await assert.rejects(
            publish(f, fresh, decision, secondReviewer.access.staffIdentityId),
            /Independent resident publication/,
          );
          await publishWithService(f, fresh);
          assert.deepEqual(await snapshots.getPublished(f.org), f.snapshot);
          assert.ok(d.id);
        },
      );
      await t.test(
        'review and publication independently enforce consequential contact authority in PostgreSQL',
        async () => {
          const f = await fixture();
          const limitedReviewer = await actor(f.org, [
            'admin.configuration.read',
            'resident_experience.review',
          ]);
          const limitedPublisher = await actor(f.org, [
            'admin.configuration.read',
            'resident_experience.publish',
          ]);
          const r = await request(f);
          await assert.rejects(
            decide(f, r, 'approved', limitedReviewer.access),
            ForbiddenException,
          );
          await assert.rejects(
            rawDecision(f, r, limitedReviewer.access),
            /Independent resident reviewer/,
          );
          const d = await decide(f, r);
          await assert.rejects(
            publishWithService(f, r, limitedPublisher),
            ForbiddenException,
          );
          await assert.rejects(
            publish(f, r, d, limitedPublisher.access.staffIdentityId),
            /Independent resident publication/,
          );
          assert.equal(await snapshots.getPublished(f.org), null);
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
        '44 rollback refuses retained version-2 evidence even without review grants',
        async () => {
          const f = await fixture();
          await request(f);
          await assert.rejects(
            database.transaction().execute(async (trx) => {
              await sql`lock table organization,organization_access_state in access exclusive mode`.execute(
                trx,
              );
              await trx
                .deleteFrom('role_permission')
                .where('permission_key', '=', 'resident_experience.review')
                .execute();
              await down44(trx);
            }),
            /Retained resident review policy 2 evidence/,
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
        'reviewed publication service advances the exact first-publication pointer atomically',
        async () => {
          const f = await fixture(),
            r = await request(f);
          await decide(f, r);
          const result = await publishWithService(f, r);
          assert.equal(result.targetRevisionId, r.target_revision_id);
          assert.equal(result.priorPublishedRevisionId, null);
          assert.equal(result.resourceRevision, r.resource_revision + 1);
          assert.deepEqual(await snapshots.getPublished(f.org), f.snapshot);
          const event = await database
            .selectFrom('resident_experience_event')
            .selectAll()
            .where('organization_id', '=', f.org)
            .where('id', '=', result.publicationEventId)
            .executeTakeFirstOrThrow();
          assert.equal(event.review_request_id, r.id);
          assert.equal(event.review_decision_id, result.reviewDecisionId);
        },
      );
      await t.test(
        'publisher cannot consume approval they reviewed',
        async () => {
          const f = await fixture();
          await grant(f.publisher, 'resident_experience.review');
          const r = await request(f);
          await decide(f, r, 'approved', f.publisher.access);
          await assert.rejects(
            publishWithService(f, r, f.publisher),
            (error: unknown) =>
              error instanceof ConflictException &&
              /independent publisher/i.test(error.message),
          );
          assert.equal(
            (await snapshots.getResource(f.org))?.published_revision_id,
            null,
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
        'stale expected resource revision leaves the prior pointer unchanged',
        async () => {
          const f = await fixture(),
            r = await request(f);
          await decide(f, r);
          await assert.rejects(
            publicationService.publish({
              publisher: f.publisher.access,
              reviewRequestId: r.id,
              expectedResourceRevision: r.resource_revision + 1,
              correlationId: randomUUID(),
            }),
            /changed|stale/i,
          );
          assert.equal(
            (await snapshots.getResource(f.org))?.published_revision_id,
            null,
          );
        },
      );
      await t.test(
        'two publication attempts consume one approval only once',
        async () => {
          const f = await fixture(),
            r = await request(f);
          await decide(f, r);
          const outcomes = await Promise.allSettled([
            publishWithService(f, r),
            publishWithService(f, r),
          ]);
          assert.equal(
            outcomes.filter((o) => o.status === 'fulfilled').length,
            1,
          );
          assert.equal(
            outcomes.filter((o) => o.status === 'rejected').length,
            1,
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
            1,
          );
        },
      );
      await t.test(
        'historical republication uses a fresh approval and creates a new event',
        async () => {
          const f = await fixture(),
            firstRequest = await request(f);
          await decide(f, firstRequest);
          await publishWithService(f, firstRequest);
          const next = structuredClone(f.snapshot);
          next.presentation.branding.applicationName = 'Forward publication';
          await drafts.save(
            f.author.access,
            {
              expectedRevision: firstRequest.resource_revision + 1,
              snapshot: next,
            },
            randomUUID(),
          );
          const forwardRequest = await request(f);
          await decide(f, forwardRequest);
          await publishWithService(f, forwardRequest);
          const historicalRequest = await request(f, {
            ...(await binding(f)),
            targetRevisionId: firstRequest.target_revision_id,
            purpose: 'historical',
          });
          assert.equal(
            historicalRequest.baseline_revision_id,
            forwardRequest.target_revision_id,
          );
          await decide(f, historicalRequest);
          const result = await publishWithService(f, historicalRequest);
          assert.equal(
            result.priorPublishedRevisionId,
            forwardRequest.target_revision_id,
          );
          assert.deepEqual(await snapshots.getPublished(f.org), f.snapshot);
          assert.equal(
            (
              await database
                .selectFrom('resident_experience_event')
                .select('id')
                .where('organization_id', '=', f.org)
                .where('operation', '=', 'published')
                .execute()
            ).length,
            3,
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
            'resident_experience.review',
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
          await assert.rejects(
            request(f, { ...b, policyVersion: 1 }),
            /Current resident review policy/,
          );
          await assert.rejects(
            request(f, { ...b, classifierVersion: 2 }),
            /check constraint/,
          );
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
              .where('permission_key', '=', 'resident_experience.review')
              .execute();
            await trx
              .insertInto('role_permission')
              .values({
                organization_id: f.org,
                role_id: f.reviewer.role,
                permission_key: 'resident_experience.review',
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
          await grant(f.author, 'resident_experience.review');
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
          await grant(f.author, 'resident_experience.review');
          const cosmeticAuthor = await actor(f.org);
          const next = structuredClone(f.snapshot);
          next.presentation.branding.applicationName = 'Cosmetic';
          await drafts.save(
            cosmeticAuthor.access,
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
              cosmeticAuthor.access.staffIdentityId,
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
          const f = await fixture();
          await grant(
            f.publisher,
            'resident_experience.write',
            'resident_experience.review',
          );
          const r1 = await request(f),
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
      const lifecycle = new AdminResidentReviewService(snapshots);
      async function lifecycleInput(f: Fixture) {
        const context = await lifecycle.context(f.author.access);
        return {
          targetRevisionId: context.draftRevisionId,
          expectedRevision: context.resourceRevision,
          purpose: 'draft',
          supersedesRequestId: context.latestRequestId,
        };
      }
      await t.test(
        '4B review context projects current draft request eligibility without exposing permissions',
        async () => {
          const f = await fixture();
          const reviewerOnly = f.reviewer.access;
          const publisherOnly = (
            await actor(f.org, [
              'admin.configuration.read',
              'resident_experience.publish',
              'resident_experience.contact.manage',
            ])
          ).access;
          const writerWithoutContact = (
            await actor(f.org, [
              'admin.configuration.read',
              'resident_experience.write',
            ])
          ).access;
          assert.equal(
            (await lifecycle.context(f.author.access)).canRequestReview,
            true,
          );
          assert.equal(
            (await lifecycle.context(reviewerOnly)).canRequestReview,
            false,
          );
          assert.equal(
            (await lifecycle.context(publisherOnly)).canRequestReview,
            false,
          );
          assert.equal(
            (await lifecycle.context(writerWithoutContact)).canRequestReview,
            false,
          );
          const pending = await lifecycle.create(
            f.author.access,
            await lifecycleInput(f),
          );
          assert.equal(
            (await lifecycle.context(f.author.access)).canRequestReview,
            false,
          );
          await lifecycle.decide(f.reviewer.access, pending.id, {
            expectedRevision: 2,
            outcome: 'approved',
          });
          assert.equal(
            (await lifecycle.context(f.author.access)).canRequestReview,
            false,
          );
          const next = structuredClone(f.snapshot);
          next.presentation.metadata.title = 'A newer saved draft';
          await drafts.save(
            f.author.access,
            { expectedRevision: 2, snapshot: next },
            randomUUID(),
          );
          assert.equal(
            (await lifecycle.context(f.author.access)).canRequestReview,
            true,
          );
        },
      );
      await t.test(
        'approved revision 6 allows an eligible author to request revision 8 with exact supersession',
        async () => {
          const f = await fixture();
          const author = (
            await actor(f.org, [
              'admin.configuration.read',
              'resident_experience.write',
              'resident_experience.contact.manage',
            ])
          ).access;
          const publisher = (
            await actor(f.org, [
              'admin.configuration.read',
              'resident_experience.publish',
              'resident_experience.contact.manage',
            ])
          ).access;
          async function saveNext(expectedRevision: number) {
            const snapshot = structuredClone(f.snapshot);
            snapshot.presentation.metadata.title = `Saved revision ${String(expectedRevision + 1)}`;
            await drafts.save(
              author,
              { expectedRevision, snapshot },
              randomUUID(),
            );
          }
          for (let revision = 2; revision < 6; revision++)
            await saveNext(revision);
          const oldInput = await lifecycleInput(f);
          const old = await lifecycle.create(author, oldInput);
          await assert.rejects(
            lifecycle.create(author, {
              ...oldInput,
              supersedesRequestId: old.id,
            }),
            ConflictException,
          );
          await lifecycle.decide(f.reviewer.access, old.id, {
            expectedRevision: 6,
            outcome: 'approved',
          });
          assert.equal(
            (await lifecycle.context(author)).canRequestReview,
            false,
          );
          await assert.rejects(
            lifecycle.create(author, {
              ...oldInput,
              supersedesRequestId: old.id,
            }),
            ConflictException,
          );
          await saveNext(6);
          await saveNext(7);
          assert.equal(
            (await lifecycle.get(author, old.id)).usability.reason,
            'stale',
          );
          const context = await lifecycle.context(author);
          assert.equal(context.resourceRevision, 8);
          assert.equal(context.canRequestReview, true);
          for (const actor of [f.reviewer.access, publisher]) {
            assert.equal(
              (await lifecycle.context(actor)).canRequestReview,
              false,
            );
            const stale = await lifecycle.get(actor, old.id);
            assert.equal(stale.canReview, false);
            assert.equal(stale.canPublish, false);
          }
          const input = await lifecycleInput(f);
          await assert.rejects(
            lifecycle.create(author, {
              ...input,
              supersedesRequestId: null,
            }),
            ConflictException,
          );
          const fresh = await lifecycle.create(author, input);
          assert.equal(fresh.supersedesRequestId, old.id);
          assert.equal(fresh.targetRevisionId, context.draftRevisionId);
          assert.equal(fresh.resourceRevision, 8);
          assert.equal(
            (await lifecycle.context(author)).canRequestReview,
            false,
          );
          assert.equal(
            (await lifecycle.get(f.reviewer.access, fresh.id)).canReview,
            true,
          );
          assert.equal(
            (await lifecycle.get(publisher, fresh.id)).canPublish,
            false,
          );
          assert.equal(await snapshots.getPublished(f.org), null);
        },
      );
      await t.test(
        'consumed review permits a fresh draft review only after a newer draft is saved',
        async () => {
          const f = await fixture();
          const r = await lifecycle.create(
            f.author.access,
            await lifecycleInput(f),
          );
          await lifecycle.decide(f.reviewer.access, r.id, {
            expectedRevision: 2,
            outcome: 'approved',
          });
          await publicationService.publish({
            publisher: f.publisher.access,
            reviewRequestId: r.id,
            expectedResourceRevision: 2,
            correlationId: randomUUID(),
          });
          assert.equal(
            (await lifecycle.context(f.author.access)).canRequestReview,
            false,
          );
          const next = structuredClone(f.snapshot);
          next.presentation.metadata.title = 'After publication';
          await drafts.save(
            f.author.access,
            { expectedRevision: 3, snapshot: next },
            randomUUID(),
          );
          assert.equal(
            (await lifecycle.context(f.author.access)).canRequestReview,
            true,
          );
          const fresh = await lifecycle.create(
            f.author.access,
            await lifecycleInput(f),
          );
          assert.equal(fresh.supersedesRequestId, r.id);
          assert.equal(
            (await lifecycle.context(f.author.access)).canRequestReview,
            false,
          );
          assert.deepEqual(await snapshots.getPublished(f.org), f.snapshot);
        },
      );
      await t.test(
        '4B exact read is immutable, scoped and projects review values separately from public presentation',
        async () => {
          const f = await fixture(),
            other = await fixture(),
            input = await lifecycleInput(f);
          assert.ok(input.targetRevisionId);
          const original = await lifecycle.revision(
            f.reviewer.access,
            input.targetRevisionId,
          );
          assert.deepEqual(
            original.presentation,
            projectPublishedResidentExperience(f.snapshot),
          );
          assert.deepEqual(original.review, f.snapshot);
          assert.equal(original.changes.consequential, true);
          assert.deepEqual(
            Object.keys(original).sort(),
            [
              'baselineRevisionId',
              'changes',
              'currentDraft',
              'latestRequestId',
              'presentation',
              'resourceRevision',
              'review',
              'revisionId',
              'unpublished',
            ].sort(),
          );
          const next = structuredClone(f.snapshot);
          next.presentation.metadata.title = 'Cosmetic next draft';
          assert.ok(next.actions[0] && next.benefits[0]);
          next.actions[0].enabled = false;
          next.benefits[0].enabled = false;
          await drafts.save(
            f.author.access,
            { expectedRevision: 2, snapshot: next },
            randomUUID(),
          );
          const retained = await lifecycle.revision(
            f.reviewer.access,
            input.targetRevisionId,
          );
          assert.deepEqual(retained.review, f.snapshot);
          assert.equal(retained.currentDraft, false);
          const latest = await lifecycle.revision(
            f.reviewer.access,
            (await binding(f)).targetRevisionId,
          );
          assert.equal(latest.review.actions[0]?.enabled, false);
          assert.equal(latest.review.benefits[0]?.enabled, false);
          assert.equal(latest.presentation.configuration?.actions.length, 1);
          assert.equal(latest.presentation.configuration.benefits.length, 0);
          for (const id of [
            randomUUID(),
            (await binding(other)).targetRevisionId,
          ])
            await assert.rejects(
              lifecycle.revision(f.reviewer.access, id),
              NotFoundException,
            );
          await assert.rejects(
            lifecycle.create(f.author.access, input),
            ConflictException,
          );
          await assert.rejects(
            lifecycle.create(f.author.access, {
              ...input,
              expectedRevision: 3,
            }),
            ConflictException,
          );
        },
      );
      await t.test(
        '4B request/approve/reject preserve pointers, public output, events and immutable evidence',
        async () => {
          for (const outcome of ['approved', 'rejected'] as const) {
            const f = await fixture(),
              input = await lifecycleInput(f);
            const before = await snapshots.getResource(f.org),
              publicBefore = await snapshots.getPublished(f.org);
            const r = await lifecycle.create(f.author.access, input);
            assert.equal(r.changes.reasons[0], 'first_publication');
            assert.equal(r.canReview, false);
            assert.equal(
              (await lifecycle.get(f.reviewer.access, r.id)).canReview,
              true,
            );
            const d = await lifecycle.decide(f.reviewer.access, r.id, {
              expectedRevision: 2,
              outcome,
            });
            assert.equal(d.decision?.outcome, outcome);
            assert.equal(d.usability.usable, outcome === 'approved');
            assert.equal(d.canPublish, false);
            assert.equal(
              (await lifecycle.get(f.publisher.access, r.id)).canPublish,
              outcome === 'approved',
            );
            assert.equal(d.independentPublisherRequired, true);
            assert.ok(d.decision);
            assert.equal(
              d.decision.expiresAt.getTime() - d.decision.decidedAt.getTime(),
              86400000,
            );
            const stored = await database
              .selectFrom('resident_experience_review_request')
              .selectAll()
              .where('id', '=', r.id)
              .executeTakeFirstOrThrow();
            const b = await binding(f);
            assert.equal(
              stored.authorization_revision,
              b.authorizationRevision,
            );
            assert.equal(stored.baseline_revision_id, b.baselineRevisionId);
            assert.equal(stored.target_revision_id, b.targetRevisionId);
            await assert.rejects(
              lifecycle.decide(f.reviewer.access, r.id, {
                expectedRevision: 2,
                outcome,
              }),
              ConflictException,
            );
            await assert.rejects(
              sql`update resident_experience_review_decision set outcome='rejected' where id=${d.decision.id}::uuid`.execute(
                database,
              ),
            );
            await assert.rejects(
              sql`delete from resident_experience_review_request where id=${r.id}::uuid`.execute(
                database,
              ),
            );
            assert.deepEqual(await snapshots.getResource(f.org), before);
            assert.deepEqual(await snapshots.getPublished(f.org), publicBefore);
            const events = await database
              .selectFrom('resident_experience_event')
              .select(['operation', 'review_decision_id'])
              .where('organization_id', '=', f.org)
              .execute();
            assert.deepEqual(events, [
              { operation: 'draft_saved', review_decision_id: null },
            ]);
          }
        },
      );
      await t.test(
        '4B concurrent requests and decisions have one winner; supersession is explicit',
        async () => {
          const f = await fixture();
          const secondReviewer = await actor(f.org, [
            'admin.configuration.read',
            'resident_experience.review',
            'resident_experience.contact.manage',
          ]);
          const input = await lifecycleInput(f);
          const results = await Promise.allSettled([
            lifecycle.create(f.author.access, input),
            lifecycle.create(f.author.access, input),
          ]);
          assert.equal(
            results.filter((r) => r.status === 'fulfilled').length,
            1,
          );
          const failure = results.find((r) => r.status === 'rejected');
          assert.ok(
            failure?.status === 'rejected' &&
              failure.reason instanceof ConflictException,
          );
          const winner = results.find((r) => r.status === 'fulfilled');
          assert.ok(winner?.status === 'fulfilled');
          const r = winner.value;
          const decisions = await Promise.allSettled([
            lifecycle.decide(f.reviewer.access, r.id, {
              expectedRevision: 2,
              outcome: 'approved',
            }),
            lifecycle.decide(secondReviewer.access, r.id, {
              expectedRevision: 2,
              outcome: 'rejected',
            }),
          ]);
          assert.equal(
            decisions.filter((d) => d.status === 'fulfilled').length,
            1,
          );
          assert.ok(
            decisions.some(
              (d) =>
                d.status === 'rejected' &&
                d.reason instanceof ConflictException,
            ),
          );
          const next = structuredClone(f.snapshot);
          next.presentation.metadata.title =
            'New context for replacement review';
          await drafts.save(
            f.author.access,
            { expectedRevision: 2, snapshot: next },
            randomUUID(),
          );
          const replacement = await lifecycle.create(
            f.author.access,
            await lifecycleInput(f),
          );
          assert.equal(replacement.supersedesRequestId, r.id);
          assert.equal(
            (await lifecycle.get(f.reviewer.access, r.id)).usability.reason,
            'stale',
          );
          assert.equal(
            (await lifecycle.get(f.publisher.access, r.id)).canPublish,
            false,
          );
          await assert.rejects(
            lifecycle.decide(f.reviewer.access, r.id, {
              expectedRevision: 2,
              outcome: 'approved',
            }),
            ConflictException,
          );
          await assert.rejects(
            lifecycle.create(f.author.access, {
              ...input,
              supersedesRequestId: r.id,
            }),
            ConflictException,
          );
        },
      );
      await t.test(
        '4B consequential lineage excludes both the contact author and final cosmetic saver',
        async () => {
          const f = await fixture();
          await grant(f.author, 'resident_experience.review');
          await grant(
            f.publisher,
            'resident_experience.write',
            'resident_experience.review',
          );
          const original = await request(f),
            approved = await decide(f, original);
          await publish(f, original, approved); // test-only accepted 4A fixture establishes prior publication
          const changed = structuredClone(f.snapshot);
          assert.ok(changed.contacts[0]);
          changed.contacts[0].phoneTarget = '+12025550101';
          changed.contacts[0].displayValue = '+1 (202) 555-0101';
          changed.contacts[0].classification = 'emergency';
          await drafts.save(
            f.author.access,
            { expectedRevision: 3, snapshot: changed },
            randomUUID(),
          );
          changed.presentation.metadata.title = 'Cosmetic second author';
          await drafts.save(
            f.publisher.access,
            { expectedRevision: 4, snapshot: changed },
            randomUUID(),
          );
          const before = await snapshots.getPublished(f.org);
          const r = await lifecycle.create(
            f.author.access,
            await lifecycleInput(f),
          );
          assert.equal(r.changes.consequential, true);
          for (const person of [f.author, f.publisher]) {
            assert.equal(
              (await lifecycle.get(person.access, r.id)).canReview,
              false,
            );
            await assert.rejects(
              lifecycle.decide(person.access, r.id, {
                expectedRevision: 5,
                outcome: 'approved',
              }),
              ForbiddenException,
            );
          }
          assert.equal(
            (
              await lifecycle.decide(f.reviewer.access, r.id, {
                expectedRevision: 5,
                outcome: 'approved',
              })
            ).usability.usable,
            true,
          );
          assert.deepEqual(await snapshots.getPublished(f.org), before);
        },
      );
      await t.test(
        '4B edits and fresh authority changes invalidate immutable approvals and stale guard context',
        async () => {
          for (const mutation of ['draft', 'permission', 'inactive'] as const) {
            const f = await fixture(),
              r = await lifecycle.create(
                f.author.access,
                await lifecycleInput(f),
              );
            const approval = await lifecycle.decide(f.reviewer.access, r.id, {
              expectedRevision: 2,
              outcome: 'approved',
            });
            if (mutation === 'draft') {
              const changed = structuredClone(f.snapshot);
              changed.presentation.metadata.title = 'Later content';
              await drafts.save(
                f.author.access,
                { expectedRevision: 2, snapshot: changed },
                randomUUID(),
              );
            } else
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
                if (mutation === 'permission')
                  await trx
                    .deleteFrom('role_permission')
                    .where('role_id', '=', f.reviewer.role)
                    .where('permission_key', '=', 'resident_experience.review')
                    .execute();
                else
                  await trx
                    .updateTable('staff_identity')
                    .set({ active: false })
                    .where('id', '=', f.reviewer.access.staffIdentityId)
                    .execute();
              });
            const projected = await lifecycle.get(f.author.access, r.id);
            assert.equal(projected.usability.usable, false);
            assert.deepEqual(projected.decision, approval.decision);
            await assert.rejects(
              lifecycle.decide(f.reviewer.access, r.id, {
                expectedRevision: 2,
                outcome: 'approved',
              }),
              mutation === 'draft' ? ConflictException : ForbiddenException,
            );
            assert.equal(await snapshots.getPublished(f.org), null);
          }
        },
      );
      await t.test(
        '4B historical requests need prior publication evidence and never republish',
        async () => {
          const f = await fixture(),
            input = await lifecycleInput(f);
          await assert.rejects(
            lifecycle.create(f.author.access, {
              ...input,
              purpose: 'historical',
            }),
            ConflictException,
          );
          const r1 = await request(f),
            d1 = await decide(f, r1);
          await publish(f, r1, d1);
          const changed = structuredClone(f.snapshot);
          changed.presentation.metadata.title = 'New publication';
          await drafts.save(
            f.author.access,
            { expectedRevision: 3, snapshot: changed },
            randomUUID(),
          );
          const r2 = await request(f),
            d2 = await decide(f, r2);
          await publish(f, r2, d2);
          const before = await snapshots.getPublished(f.org);
          const historical = await lifecycle.create(f.author.access, {
            ...(await lifecycleInput(f)),
            purpose: 'historical',
            targetRevisionId: r1.target_revision_id,
          });
          assert.equal(historical.baselineRevisionId, r2.target_revision_id);
          assert.equal(historical.purpose, 'historical');
          assert.equal(historical.decision, null);
          await lifecycle.decide(f.reviewer.access, historical.id, {
            expectedRevision: 5,
            outcome: 'approved',
          });
          assert.deepEqual(await snapshots.getPublished(f.org), before);
          assert.equal(
            (await lifecycle.get(f.reviewer.access, r1.id)).usability.usable,
            false,
          );
        },
      );
      await t.test(
        '4B protected HTTP lifecycle uses actual service/database authority, errors and no-store',
        async (apiTest) => {
          const f = await fixture(),
            other = await fixture(),
            same = await fixture();
          await grant(same.publisher, 'resident_experience.review');
          const reader = await actor(f.org, ['admin.configuration.read']);
          const limited = await actor(f.org, [
            'admin.configuration.read',
            'resident_experience.review',
          ]);
          const ordinaryPublisher = await actor(f.org, [
            'admin.configuration.read',
            'resident_experience.publish',
          ]);
          const writeOnly = await actor(f.org, [
            'admin.configuration.read',
            'resident_experience.write',
          ]);
          const app = await residentReviewApi(
            lifecycle,
            {
              author: f.author.access,
              reviewer: f.reviewer.access,
              reader: reader.access,
              limited: limited.access,
              ordinaryPublisher: ordinaryPublisher.access,
              writeOnly: writeOnly.access,
              publisher: f.publisher.access,
              samePublisher: same.publisher.access,
              other: other.reviewer.access,
            },
            publicationService,
          );
          const base = '/api/v1/admin/resident-experience';
          const input = await lifecycleInput(f);
          const targetId = input.targetRevisionId;
          assert.ok(targetId);
          const post = (suffix: string, token: string, body: unknown) =>
            httpRequest(app.getHttpServer())
              .post(base + suffix)
              .set('Authorization', `Bearer ${token}`)
              .send(body as object);
          const get = (suffix: string, token = 'reviewer') =>
            httpRequest(app.getHttpServer())
              .get(base + suffix)
              .set('Authorization', `Bearer ${token}`);
          const responseCanPublish = (response: httpRequest.Response) =>
            (response.body as { canPublish: boolean }).canPublish;
          const responseCanRequest = (response: httpRequest.Response) =>
            (response.body as { canRequestReview: boolean }).canRequestReview;
          try {
            await apiTest.test(
              'anonymous and missing request authority denied; errors are no-store',
              async () => {
                const denied = await httpRequest(app.getHttpServer())
                  .get(base + '/review-context')
                  .expect(401);
                assert.equal(denied.headers['cache-control'], 'no-store');
                await post('/review-requests', 'reader', input).expect(403);
                await post('/review-requests', 'reviewer', input).expect(403);
                await post('/review-requests', 'writeOnly', input).expect(403);
                await post(
                  '/review-requests',
                  'ordinaryPublisher',
                  input,
                ).expect(403);
                assert.equal(
                  responseCanRequest(
                    await get('/review-context', 'author').expect(200),
                  ),
                  true,
                );
                for (const token of [
                  'reviewer',
                  'ordinaryPublisher',
                  'writeOnly',
                ])
                  assert.equal(
                    responseCanRequest(
                      await get('/review-context', token).expect(200),
                    ),
                    false,
                  );
              },
            );
            await apiTest.test(
              'exact projection and forged selectors/malformed body isolation',
              async () => {
                const read = await get('/revisions/' + targetId).expect(200);
                assert.deepEqual(
                  (read.body as { presentation: unknown }).presentation,
                  projectPublishedResidentExperience(f.snapshot),
                );
                assert.equal(read.headers['cache-control'], 'no-store');
                await get('/revisions/' + targetId, 'other').expect(404);
                await get('/revisions/' + randomUUID()).expect(404);
                await get('/review-context?organizationId=forged').expect(400);
                await get('/review-context').send({}).expect(400);
                for (const body of [
                  {},
                  { ...input, organizationId: other.org },
                  { ...input, consequential: false },
                ])
                  await post('/review-requests', 'author', body).expect(400);
                await post('/review-requests', 'author', {
                  ...input,
                  targetRevisionId: (await binding(other)).targetRevisionId,
                }).expect(404);
              },
            );
            const response = await post(
              '/review-requests',
              'author',
              input,
            ).expect(201);
            const r = response.body as { id: string };
            assert.equal(response.headers['cache-control'], 'no-store');
            assert.equal(
              responseCanRequest(
                await get('/review-context', 'author').expect(200),
              ),
              false,
            );
            await apiTest.test(
              'decision checks review/contact authority, saver separation and tenant before mutation',
              async () => {
                for (const token of [
                  'reader',
                  'limited',
                  'author',
                  'publisher',
                ])
                  await post('/review-requests/' + r.id + '/decision', token, {
                    expectedRevision: 2,
                    outcome: 'approved',
                  }).expect(403);
                await get('/review-requests/' + r.id, 'other').expect(404);
                await post('/review-requests/' + r.id + '/decision', 'other', {
                  expectedRevision: 2,
                  outcome: 'approved',
                }).expect(404);
                await post(
                  '/review-requests/' + r.id + '/decision',
                  'reviewer',
                  {
                    expectedRevision: 2,
                    outcome: 'approved',
                    reviewerId: 'forged',
                  },
                ).expect(400);
                await post(
                  '/review-requests/' + r.id + '/decision',
                  'reviewer',
                  { expectedRevision: 1, outcome: 'approved' },
                ).expect(409);
                const decision = await post(
                  '/review-requests/' + r.id + '/decision',
                  'reviewer',
                  { expectedRevision: 2, outcome: 'approved' },
                ).expect(201);
                assert.equal(decision.headers['cache-control'], 'no-store');
                assert.equal(
                  (decision.body as { canPublish: boolean }).canPublish,
                  false,
                );
                for (const token of [
                  'reader',
                  'limited',
                  'writeOnly',
                  'reviewer',
                ])
                  assert.equal(
                    responseCanPublish(
                      await get('/review-requests/' + r.id, token).expect(200),
                    ),
                    false,
                  );
                assert.equal(
                  responseCanPublish(
                    await get('/review-requests/' + r.id, 'publisher').expect(
                      200,
                    ),
                  ),
                  true,
                );
                await post(
                  '/review-requests/' + r.id + '/decision',
                  'reviewer',
                  { expectedRevision: 2, outcome: 'rejected' },
                ).expect(409);
                await post('/review-requests', 'author', input).expect(409);
                assert.equal(await snapshots.getPublished(f.org), null);
              },
            );
            await apiTest.test(
              'publication enforces publisher authority, bounded output, no-store and exact target',
              async () => {
                for (const token of [
                  'reader',
                  'writeOnly',
                  'reviewer',
                  'ordinaryPublisher',
                ])
                  await post('/publications', token, {
                    reviewRequestId: r.id,
                    expectedResourceRevision: 2,
                  }).expect(403);
                await post('/publications', 'limited', {
                  reviewRequestId: r.id,
                  expectedResourceRevision: 2,
                }).expect(403);
                const otherRequest = await request(other);
                const otherRequestBinding = otherRequest as {
                  id: string;
                  resource_revision: number;
                };
                await post('/publications', 'publisher', {
                  reviewRequestId: otherRequestBinding.id,
                  expectedResourceRevision:
                    otherRequestBinding.resource_revision,
                }).expect(404);
                const published = await post('/publications', 'publisher', {
                  reviewRequestId: r.id,
                  expectedResourceRevision: 2,
                }).expect(201);
                assert.equal(published.headers['cache-control'], 'no-store');
                const publishedBody = published.body as {
                  targetRevisionId: string;
                  resourceRevision: number;
                };
                assert.deepEqual(
                  Object.keys(published.body).sort(),
                  [
                    'consequential',
                    'priorPublishedRevisionId',
                    'publicationEventId',
                    'resourceRevision',
                    'reviewDecisionId',
                    'reviewRequestId',
                    'targetRevisionId',
                  ].sort(),
                );
                assert.equal(publishedBody.targetRevisionId, targetId);
                assert.equal(publishedBody.resourceRevision, 3);
                assert.equal(
                  responseCanPublish(
                    await get('/review-requests/' + r.id, 'publisher').expect(
                      200,
                    ),
                  ),
                  false,
                );
                assert.deepEqual(
                  await snapshots.getPublished(f.org),
                  f.snapshot,
                );
                await post('/publications', 'publisher', {
                  reviewRequestId: r.id,
                  expectedResourceRevision: 2,
                }).expect(409);
                const sameRequest = await request(same);
                await decide(
                  same,
                  sameRequest,
                  'approved',
                  same.publisher.access,
                );
                await post('/publications', 'samePublisher', {
                  reviewRequestId: sameRequest.id,
                  expectedResourceRevision: sameRequest.resource_revision,
                }).expect(409);
                assert.deepEqual(
                  await snapshots.getPublished(f.org),
                  f.snapshot,
                );
              },
            );
            await apiTest.test(
              'ordinary exact review needs review but neither publish, contact nor write',
              async () => {
                const changed = structuredClone(f.snapshot);
                changed.presentation.metadata.title = 'Ordinary wording';
                await drafts.save(
                  f.author.access,
                  { expectedRevision: 3, snapshot: changed },
                  randomUUID(),
                );
                const next = await post(
                  '/review-requests',
                  'author',
                  await lifecycleInput(f),
                ).expect(201);
                const id = (next.body as { id: string }).id;
                await post('/review-requests/' + id + '/decision', 'limited', {
                  expectedRevision: 4,
                  outcome: 'approved',
                }).expect(201);
                assert.equal(
                  responseCanPublish(
                    await get('/review-requests/' + id, 'limited').expect(200),
                  ),
                  false,
                );
                assert.equal(
                  responseCanPublish(
                    await get('/review-requests/' + id, 'reader').expect(200),
                  ),
                  false,
                );
                assert.equal(
                  responseCanPublish(
                    await get(
                      '/review-requests/' + id,
                      'ordinaryPublisher',
                    ).expect(200),
                  ),
                  true,
                );
                assert.deepEqual(
                  await snapshots.getPublished(f.org),
                  f.snapshot,
                );
                await post('/publish', 'author', {}).expect(404);
              },
            );
          } finally {
            await app.close();
          }
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
