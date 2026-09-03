import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { up as catalogUp } from '../../migrations/20260902000000-create-organization-service-catalog.js';
import { up as requestUp } from '../../migrations/20260902010000-create-service-request-foundation.js';
import { up as listUp } from '../../migrations/20260902020000-add-service-request-list-indexes.js';
import { up as eligibilityUp } from '../../migrations/20260902030000-add-location-eligibility-snapshot.js';
import { up as staffUp } from '../../migrations/20260903010000-add-staff-assignment-workflow-foundation.js';
import type { AppConfiguration } from '../../src/config/configuration.js';
import type { DatabaseService } from '../../src/database/database.service.js';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import { StaffActionsService } from '../../src/service-request/staff-actions.service.js';

const url = process.env.TEST_DATABASE_URL;

test(
  'F0 staff assignment and workflow invariants hold in PostgreSQL',
  { skip: !url },
  async () => {
    const schema = `staff_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: url });
    await admin.query(`create schema "${schema}"`);
    const db = new Kysely<DatabaseSchema>({
      dialect: new PostgresDialect({
        pool: new Pool({
          connectionString: url,
          max: 12,
          options: `-c search_path=${schema}`,
        }),
      }),
    });
    try {
      await catalogUp(db);
      await requestUp(db);
      await listUp(db);
      await eligibilityUp(db);
      await staffUp(db);

      const orgA = randomUUID();
      const orgB = randomUUID();
      await db
        .insertInto('organization')
        .values([
          {
            id: orgA,
            name: 'A',
            short_name: 'A',
            slug: `a-${schema}`,
            status: 'active',
            default_business_timezone: 'America/New_York',
          },
          {
            id: orgB,
            name: 'B',
            short_name: 'B',
            slug: `b-${schema}`,
            status: 'active',
            default_business_timezone: 'America/New_York',
          },
        ])
        .execute();
      const departmentA = randomUUID();
      const departmentB = randomUUID();
      await db
        .insertInto('department')
        .values([
          {
            id: departmentA,
            organization_id: orgA,
            name: 'Works A',
            description: null,
            status: 'active',
            display_order: 1,
          },
          {
            id: departmentB,
            organization_id: orgB,
            name: 'Works B',
            description: null,
            status: 'active',
            display_order: 1,
          },
        ])
        .execute();
      const divisionA = randomUUID();
      await db
        .insertInto('division')
        .values({
          id: divisionA,
          organization_id: orgA,
          department_id: departmentA,
          name: 'Streets',
          description: 'Road requests',
          status: 'active',
          display_order: 1,
        })
        .execute();
      const category = randomUUID();
      const definition = randomUUID();
      const version = randomUUID();
      await db
        .insertInto('category')
        .values({
          id: category,
          organization_id: orgA,
          department_id: departmentA,
          division_id: divisionA,
          name: 'Roads',
          description: 'Road requests',
          icon_key: 'road',
          aliases: [],
          keywords: [],
          status: 'active',
          display_order: 1,
        })
        .execute();
      await db
        .insertInto('service_definition')
        .values({
          id: definition,
          organization_id: orgA,
          category_id: category,
          service_key: 'road',
          status: 'active',
          current_published_version_id: null,
        })
        .execute();
      await db
        .insertInto('service_definition_version')
        .values({
          id: version,
          organization_id: orgA,
          service_definition_id: definition,
          version_number: 1,
          name: 'Road',
          resident_description: 'Road',
          icon_key: 'road',
          aliases: [],
          keywords: [],
          default_priority: 'medium',
          location_policy: 'optional',
          geographic_eligibility_mode: 'no_geographic_restriction',
          anonymous_reporting_policy: 'allowed',
          status: 'published',
          published_at: new Date(),
          routing_metadata: null,
        })
        .execute();
      await db
        .updateTable('service_definition')
        .set({ current_published_version_id: version })
        .where('id', '=', definition)
        .execute();
      const requestId = randomUUID();
      await db
        .insertInto('service_request')
        .values({
          id: requestId,
          organization_id: orgA,
          reference_number: 'SR-202609-999999',
          service_definition_id: definition,
          service_definition_version_id: version,
          category_id: category,
          status: 'open',
          priority: 'medium',
          description: 'F0 validation',
          reporting_identity: 'anonymous',
        })
        .execute();

      const actor = randomUUID();
      const worker = randomUUID();
      const inactive = randomUUID();
      const foreignStaff = randomUUID();
      await db
        .insertInto('staff_identity')
        .values([
          {
            id: actor,
            organization_id: orgA,
            entra_object_id: null,
            display_name: 'Actor',
            email: 'actor@example.test',
            active: true,
          },
          {
            id: worker,
            organization_id: orgA,
            entra_object_id: null,
            display_name: 'Worker',
            email: 'worker@example.test',
            active: true,
          },
          {
            id: inactive,
            organization_id: orgA,
            entra_object_id: null,
            display_name: 'Inactive',
            email: null,
            active: false,
          },
          {
            id: foreignStaff,
            organization_id: orgB,
            entra_object_id: null,
            display_name: 'Foreign',
            email: null,
            active: true,
          },
        ])
        .execute();
      await db
        .insertInto('staff_department_membership')
        .values({
          organization_id: orgA,
          staff_identity_id: worker,
          department_id: departmentA,
          active: true,
        })
        .execute();
      await db
        .insertInto('staff_division_membership')
        .values({
          organization_id: orgA,
          staff_identity_id: worker,
          department_id: departmentA,
          division_id: divisionA,
          active: true,
        })
        .execute();
      const groupA = randomUUID();
      const groupB = randomUUID();
      await db
        .insertInto('work_group')
        .values([
          {
            id: groupA,
            organization_id: orgA,
            department_id: departmentA,
            division_id: divisionA,
            name: 'Streets A',
            description: null,
            active: true,
          },
          {
            id: groupB,
            organization_id: orgB,
            department_id: departmentB,
            division_id: null,
            name: 'Streets B',
            description: null,
            active: true,
          },
        ])
        .execute();
      await db
        .insertInto('work_group_membership')
        .values({
          organization_id: orgA,
          work_group_id: groupA,
          staff_identity_id: worker,
          active: true,
        })
        .execute();
      await assert.rejects(
        db
          .insertInto('work_group_membership')
          .values({
            organization_id: orgA,
            work_group_id: groupA,
            staff_identity_id: foreignStaff,
            active: true,
          })
          .execute(),
      );
      await assert.rejects(
        db
          .insertInto('staff_department_membership')
          .values({
            organization_id: orgA,
            staff_identity_id: worker,
            department_id: departmentB,
            active: true,
          })
          .execute(),
      );
      await assert.rejects(
        db
          .insertInto('staff_division_membership')
          .values({
            organization_id: orgB,
            staff_identity_id: foreignStaff,
            department_id: departmentB,
            division_id: divisionA,
            active: true,
          })
          .execute(),
      );

      const config = {
        get: (key: string) =>
          key === 'catalog.developmentOrganizationId'
            ? orgA
            : key === 'staffActions.developmentActorId'
              ? actor
              : true,
      } as unknown as ConfigService<AppConfiguration, true>;
      const service = new StaffActionsService(config, {
        client: db,
      } as DatabaseService);
      await assert.rejects(
        service.assign(requestId, {
          expectedRevision: 1,
          assignmentType: 'individual',
          targetId: foreignStaff,
        }),
        NotFoundException,
      );
      await assert.rejects(
        service.assign(requestId, {
          expectedRevision: 1,
          assignmentType: 'individual',
          targetId: inactive,
        }),
        NotFoundException,
      );

      const competing = await Promise.allSettled([
        service.assign(requestId, {
          expectedRevision: 1,
          assignmentType: 'department',
          targetId: departmentA,
        }),
        service.assign(requestId, {
          expectedRevision: 1,
          assignmentType: 'group',
          targetId: groupA,
        }),
      ]);
      assert.equal(
        competing.filter((result) => result.status === 'fulfilled').length,
        1,
      );
      assert.equal(
        competing.filter(
          (result) =>
            result.status === 'rejected' &&
            result.reason instanceof ConflictException,
        ).length,
        1,
      );
      let current = await db
        .selectFrom('service_request_assignment')
        .selectAll()
        .where('service_request_id', '=', requestId)
        .where('ended_at', 'is', null)
        .execute();
      assert.equal(current.length, 1);
      await assert.rejects(
        db
          .insertInto('service_request_assignment')
          .values({
            id: randomUUID(),
            organization_id: orgA,
            service_request_id: requestId,
            assignment_type: 'unassigned',
            staff_identity_id: null,
            work_group_id: null,
            department_id: null,
            ended_at: null,
            assigned_by_actor_type: 'development_staff',
            assigned_by_staff_identity_id: actor,
            reason: null,
          })
          .execute(),
      );

      await service.assign(requestId, {
        expectedRevision: 2,
        assignmentType: 'individual',
        targetId: worker,
        reason: 'Specialist',
      });
      await service.assign(requestId, {
        expectedRevision: 3,
        assignmentType: 'unassigned',
        reason: 'Returned to queue',
      });
      const history = await db
        .selectFrom('service_request_assignment')
        .selectAll()
        .where('service_request_id', '=', requestId)
        .orderBy('assigned_at')
        .execute();
      assert.equal(history.length, 3);
      assert.equal(history.filter((item) => item.ended_at === null).length, 1);
      assert.equal(history.at(-1)?.assignment_type, 'unassigned');

      await service.workflow(requestId, {
        expectedRevision: 4,
        action: 'start_work',
      });
      const workflowRace = await Promise.allSettled([
        service.workflow(requestId, {
          expectedRevision: 5,
          action: 'hold',
          reason: 'Waiting for utility mark-out',
        }),
        service.workflow(requestId, {
          expectedRevision: 5,
          action: 'close',
          resolutionSummary: 'Completed',
        }),
      ]);
      assert.equal(
        workflowRace.filter((result) => result.status === 'fulfilled').length,
        1,
      );
      assert.equal(
        workflowRace.filter(
          (result) =>
            result.status === 'rejected' &&
            result.reason instanceof ConflictException,
        ).length,
        1,
      );
      let request = await db
        .selectFrom('service_request')
        .select(['status', 'revision'])
        .where('id', '=', requestId)
        .executeTakeFirstOrThrow();
      assert.equal(request.revision, 6);
      if (request.status === 'on_hold') {
        await service.workflow(requestId, {
          expectedRevision: 6,
          action: 'resume',
        });
        await service.workflow(requestId, {
          expectedRevision: 7,
          action: 'close',
          resolutionSummary: 'Completed safely',
        });
        await service.workflow(requestId, {
          expectedRevision: 8,
          action: 'reopen',
          reason: 'Issue returned',
        });
      } else {
        await service.workflow(requestId, {
          expectedRevision: 6,
          action: 'reopen',
          reason: 'Issue returned',
        });
      }
      request = await db
        .selectFrom('service_request')
        .select(['status', 'revision'])
        .where('id', '=', requestId)
        .executeTakeFirstOrThrow();
      assert.equal(request.status, 'open');
      await assert.rejects(
        service.workflow(requestId, {
          expectedRevision: request.revision,
          action: 'hold',
          reason: 'Invalid from open',
        }),
        ConflictException,
      );
      const unchanged = await db
        .selectFrom('service_request')
        .select(['status', 'revision'])
        .where('id', '=', requestId)
        .executeTakeFirstOrThrow();
      assert.deepEqual(unchanged, request);

      const activity = await db
        .selectFrom('activity')
        .selectAll()
        .where('service_request_id', '=', requestId)
        .orderBy('occurred_at')
        .execute();
      assert.ok(activity.length >= 6);
      assert.ok(
        activity.some(
          (item) =>
            item.activity_type === 'work_held' &&
            (item.metadata as Record<string, unknown>).reason ===
              'Waiting for utility mark-out',
        ) ||
          activity.some(
            (item) =>
              item.activity_type === 'service_request_closed' &&
              (item.metadata as Record<string, unknown>).resolutionSummary ===
                'Completed',
          ),
      );
      assert.ok(activity.every((item) => item.staff_identity_id === actor));
      const firstActivity = activity[0];
      assert.ok(firstActivity);
      await assert.rejects(
        db
          .updateTable('activity')
          .set({ actor_type: 'system' })
          .where('id', '=', firstActivity.id)
          .execute(),
      );
      await assert.rejects(
        db.deleteFrom('activity').where('id', '=', firstActivity.id).execute(),
      );
      current = await db
        .selectFrom('service_request_assignment')
        .selectAll()
        .where('service_request_id', '=', requestId)
        .where('ended_at', 'is', null)
        .execute();
      assert.equal(current.length, 1);
    } finally {
      await db.destroy();
      await admin.query(`drop schema if exists "${schema}" cascade`);
      await admin.end();
    }
  },
);
