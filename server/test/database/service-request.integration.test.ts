import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { ConfigService } from '@nestjs/config';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { up as catalogUp } from '../../migrations/20260902000000-create-organization-service-catalog.js';
import {
  down as requestDown,
  up as requestUp,
} from '../../migrations/20260902010000-create-service-request-foundation.js';
import {
  down as listDown,
  up as listUp,
} from '../../migrations/20260902020000-add-service-request-list-indexes.js';
import {
  down as eligibilityDown,
  up as eligibilityUp,
} from '../../migrations/20260902030000-add-location-eligibility-snapshot.js';
import { BadRequestException } from '@nestjs/common';
import type { AppConfiguration } from '../../src/config/configuration.js';
import type { DatabaseService } from '../../src/database/database.service.js';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import { CreateServiceRequestService } from '../../src/service-request/create-service-request.service.js';
import { GetServiceRequestDetailsService } from '../../src/service-request/get-service-request-details.service.js';
import { ListServiceRequestsService } from '../../src/service-request/list-service-requests.service.js';
import { ServiceRequestRepository } from '../../src/service-request/service-request.repository.js';

const url = process.env.TEST_DATABASE_URL;
const org = '10000000-0000-4000-8000-000000000001';
const category = '30000000-0000-4000-8000-000000000001';
const serviceId = '40000000-0000-4000-8000-000000000001';
const version = '50000000-0000-4000-8000-000000000001';
const blocked = '60000000-0000-4001-8000-000000000001';
const details = '60000000-0000-4001-8000-000000000002';
const condition = '60000000-0000-4001-8000-000000000003';

test(
  'canonical creation is transactional, timezone-aware, and concurrency safe',
  { skip: !url },
  async () => {
    const schema = `request_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: url });
    await admin.query(`create schema "${schema}"`);
    const db = new Kysely<DatabaseSchema>({
      dialect: new PostgresDialect({
        pool: new Pool({
          connectionString: url,
          max: 20,
          options: `-c search_path=${schema}`,
        }),
      }),
    });
    try {
      await catalogUp(db);
      await requestUp(db);
      await listUp(db);
      await eligibilityUp(db);
      await db
        .insertInto('organization')
        .values({
          id: org,
          name: 'Development',
          short_name: 'Dev',
          slug: `dev-${schema}`,
          status: 'active',
          default_business_timezone: 'America/New_York',
        })
        .execute();
      const department = randomUUID();
      await db
        .insertInto('department')
        .values({
          id: department,
          organization_id: org,
          name: 'Works',
          description: null,
          status: 'active',
          display_order: 1,
        })
        .execute();
      await db
        .insertInto('category')
        .values({
          id: category,
          organization_id: org,
          department_id: department,
          division_id: null,
          name: 'Roads',
          description: 'Roads',
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
          id: serviceId,
          organization_id: org,
          category_id: category,
          service_key: 'pothole',
          status: 'active',
          current_published_version_id: null,
        })
        .execute();
      await db
        .insertInto('service_definition_version')
        .values({
          id: version,
          organization_id: org,
          service_definition_id: serviceId,
          version_number: 1,
          name: 'Pothole',
          resident_description: 'Damage',
          icon_key: 'cone',
          aliases: [],
          keywords: [],
          default_priority: 'high',
          location_policy: 'required',
          geographic_eligibility_mode: 'city_maintained_roadway',
          anonymous_reporting_policy: 'allowed',
          status: 'published',
          published_at: new Date(),
          routing_metadata: null,
        })
        .execute();
      const draftVersion = randomUUID();
      await db
        .insertInto('service_definition_version')
        .values({
          id: draftVersion,
          organization_id: org,
          service_definition_id: serviceId,
          version_number: 2,
          name: 'Draft Pothole',
          resident_description: 'Draft',
          icon_key: 'cone',
          aliases: [],
          keywords: [],
          default_priority: 'low',
          location_policy: 'optional',
          geographic_eligibility_mode: 'no_geographic_restriction',
          anonymous_reporting_policy: 'allowed',
          status: 'draft',
          published_at: null,
          routing_metadata: null,
        })
        .execute();
      await db
        .updateTable('service_definition')
        .set({ current_published_version_id: version })
        .where('id', '=', serviceId)
        .execute();
      await db
        .insertInto('question')
        .values([
          {
            id: blocked,
            organization_id: org,
            service_definition_version_id: version,
            question_key: 'blocked',
            label: 'Blocked?',
            help_text: null,
            question_type: 'yes_no',
            is_required: true,
            display_order: 1,
            validation_metadata: null,
            visibility_condition: null,
            status: 'active',
          },
          {
            id: details,
            organization_id: org,
            service_definition_version_id: version,
            question_key: 'details',
            label: 'Details',
            help_text: null,
            question_type: 'long_text',
            is_required: true,
            display_order: 2,
            validation_metadata: { minLength: 3, maxLength: 100 },
            visibility_condition: {
              questionKey: 'blocked',
              operator: 'equals',
              value: 'yes',
            },
            status: 'active',
          },
          {
            id: condition,
            organization_id: org,
            service_definition_version_id: version,
            question_key: 'condition',
            label: 'Condition',
            help_text: null,
            question_type: 'single_select',
            is_required: true,
            display_order: 3,
            validation_metadata: null,
            visibility_condition: null,
            status: 'active',
          },
        ])
        .execute();
      await db
        .insertInto('question_option')
        .values([
          {
            id: randomUUID(),
            organization_id: org,
            question_id: condition,
            option_key: 'bad',
            label: 'Damaged',
            display_order: 1,
            status: 'active',
          },
          {
            id: randomUUID(),
            organization_id: org,
            question_id: condition,
            option_key: 'missing',
            label: 'Missing',
            display_order: 2,
            status: 'active',
          },
        ])
        .execute();
      const repository = new ServiceRequestRepository();
      const config = { get: () => org } as unknown as ConfigService<
        AppConfiguration,
        true
      >;
      const creator = new CreateServiceRequestService(
        config,
        { client: db } as DatabaseService,
        repository,
        {
          execute: async (input: {
            enteredAddress: string;
            policyType: string;
          }) => {
            if (input.enteredAddress === 'DEV-INELIGIBLE')
              throw new BadRequestException({
                code: 'LOCATION_INELIGIBLE',
                message: 'Outside service area',
              });
            if (input.enteredAddress === 'DEV-UNABLE')
              throw new BadRequestException({
                code: 'LOCATION_ELIGIBILITY_UNDETERMINED',
                message: 'Unable to determine',
              });
            return {
              result: 'eligible',
              policyType: input.policyType,
              validatedAt: new Date('2026-10-15T12:00:00Z'),
              providerKey: 'development',
              providerReference: null,
              reasonCode: 'development_match',
            };
          },
        } as never,
      );
      const reader = new GetServiceRequestDetailsService(
        {
          get: (key: string) =>
            key === 'serviceRequestReads.developmentEnabled' ? true : org,
        } as unknown as ConfigService<AppConfiguration, true>,
        { client: db } as DatabaseService,
        repository,
      );
      const listReader = new ListServiceRequestsService(
        {
          get: (key: string) =>
            key === 'serviceRequestReads.developmentEnabled' ? true : org,
        } as unknown as ConfigService<AppConfiguration, true>,
        { client: db } as DatabaseService,
        repository,
      );
      const payload = {
        serviceDefinitionId: serviceId,
        serviceDefinitionVersionId: version,
        description: 'A separate resident narrative',
        reportingIdentity: 'anonymous',
        location: { enteredAddress: '1 Main Street' },
        answers: [
          { questionId: blocked, value: true },
          { questionId: details, value: 'Road is blocked' },
          { questionId: condition, value: 'bad' },
        ],
      };

      const september = await creator.execute(
        payload,
        new Date('2026-10-01T03:59:59Z'),
      );
      assert.equal(september.referenceNumber, 'SR-202609-000001');
      assert.equal(september.status, 'open');
      const october = await creator.execute(
        payload,
        new Date('2026-10-01T04:00:00Z'),
      );
      assert.equal(october.referenceNumber, 'SR-202610-000001');
      const concurrent = await Promise.all(
        Array.from({ length: 12 }, () =>
          creator.execute(payload, new Date('2026-10-15T12:00:00Z')),
        ),
      );
      assert.equal(
        new Set(concurrent.map((item) => item.referenceNumber)).size,
        12,
      );
      assert.deepEqual(
        concurrent
          .map((item) => Number(item.referenceNumber.slice(-6)))
          .sort((a, b) => a - b),
        Array.from({ length: 12 }, (_, index) => index + 2),
      );

      const request = await db
        .selectFrom('service_request')
        .selectAll()
        .where('id', '=', september.id)
        .executeTakeFirstOrThrow();
      assert.equal(request.priority, 'high');
      assert.equal(request.description, 'A separate resident narrative');
      assert.equal(request.revision, 1);
      const answers = await db
        .selectFrom('answer')
        .selectAll()
        .where('service_request_id', '=', september.id)
        .orderBy('display_order')
        .execute();
      assert.equal(answers.length, 3);
      assert.equal(answers[1]?.question_label, 'Details');
      assert.equal(answers[2]?.display_value, 'Damaged');
      assert.equal(
        (
          await db
            .selectFrom('location')
            .selectAll()
            .where('service_request_id', '=', september.id)
            .execute()
        ).length,
        1,
      );
      assert.equal(
        (
          await db
            .selectFrom('requester_contact')
            .selectAll()
            .where('service_request_id', '=', september.id)
            .execute()
        ).length,
        0,
      );
      const activity = await db
        .selectFrom('activity')
        .selectAll()
        .where('service_request_id', '=', september.id)
        .executeTakeFirstOrThrow();
      assert.equal(activity.actor_type, 'anonymous_resident');
      await assert.rejects(
        db
          .updateTable('activity')
          .set({ actor_type: 'system' })
          .where('id', '=', activity.id)
          .execute(),
      );
      assert.ok(
        await db
          .transaction()
          .execute((trx) =>
            repository.findByReference(org, september.referenceNumber, trx),
          ),
      );
      const readModel = await reader.execute(september.id);
      assert.equal(readModel.classification.issueName, 'Pothole');
      assert.equal(readModel.classification.department.name, 'Works');
      assert.equal(readModel.classification.category.name, 'Roads');
      assert.equal(readModel.classification.division, undefined);
      assert.deepEqual(
        readModel.answers.map((answer) => answer.label),
        ['Blocked?', 'Details', 'Condition'],
      );
      assert.equal(readModel.answers[2]?.value, 'bad');
      assert.equal(readModel.answers[2].displayValue, 'Damaged');
      assert.equal(readModel.location?.enteredAddress, '1 Main Street');
      const locationSnapshot = await db
        .selectFrom('location')
        .selectAll()
        .where('service_request_id', '=', september.id)
        .executeTakeFirstOrThrow();
      assert.equal(locationSnapshot.eligibility_result, 'eligible');
      assert.equal(
        locationSnapshot.eligibility_policy_type,
        'city_maintained_roadway',
      );
      assert.equal(locationSnapshot.eligibility_provider_key, 'development');
      assert.deepEqual(readModel.requester, { anonymous: true });
      assert.equal(readModel.activity[0]?.type, 'service_request_created');
      assert.equal(
        await db
          .transaction()
          .execute((trx) =>
            repository.loadDetails(trx, randomUUID(), september.id),
          ),
        undefined,
      );
      await assert.rejects(reader.execute('malformed'));
      await assert.rejects(reader.execute(randomUUID()));

      const identified = await creator.execute(
        {
          ...payload,
          reportingIdentity: 'identified',
          contact: { name: 'Alex Example', email: 'resident@example.test' },
        },
        new Date('2026-10-15T12:00:00Z'),
      );
      assert.equal(
        (
          await db
            .selectFrom('requester_contact')
            .select(['name', 'email'])
            .where('service_request_id', '=', identified.id)
            .executeTakeFirstOrThrow()
        ).email,
        'resident@example.test',
      );
      const identifiedReadModel = await reader.execute(identified.id);
      assert.deepEqual(identifiedReadModel.requester, {
        anonymous: false,
        name: 'Alex Example',
        email: 'resident@example.test',
      });
      const listed = await listReader.execute({
        search: 'pOtHoLe',
        department,
        category,
        status: 'open',
        priority: 'high',
        sort: 'reference_desc',
        page: 1,
        pageSize: 5,
      });
      assert.equal(listed.total, 15);
      assert.equal(listed.items.length, 5);
      assert.equal(listed.hasNextPage, true);
      assert.equal(
        listed.items.every(
          (item) => item.departmentName === 'Works' && item.divisionId === null,
        ),
        true,
      );
      assert.equal(Object.hasOwn(listed.items[0] ?? {}, 'description'), false);
      assert.equal(
        (await listReader.execute({ search: september.referenceNumber })).total,
        1,
      );
      assert.equal(
        (
          await repository.listForOrganization(db, randomUUID(), {
            sort: 'newest',
            page: 1,
            pageSize: 25,
          })
        ).total,
        0,
      );

      const before = await db
        .selectFrom('service_request')
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .executeTakeFirstOrThrow();
      await assert.rejects(
        creator.execute(
          { ...payload, location: { enteredAddress: 'DEV-INELIGIBLE' } },
          new Date('2026-10-15T12:00:00Z'),
        ),
        (error: unknown) =>
          error instanceof BadRequestException &&
          (error.getResponse() as { code?: string }).code ===
            'LOCATION_INELIGIBLE',
      );
      await assert.rejects(
        creator.execute(
          { ...payload, location: { enteredAddress: 'DEV-UNABLE' } },
          new Date('2026-10-15T12:00:00Z'),
        ),
        (error: unknown) =>
          error instanceof BadRequestException &&
          (error.getResponse() as { code?: string }).code ===
            'LOCATION_ELIGIBILITY_UNDETERMINED',
      );
      await assert.rejects(
        creator.execute(
          {
            ...payload,
            answers: [
              { questionId: blocked, value: false },
              { questionId: details, value: 'stale' },
              { questionId: condition, value: 'invalid' },
            ],
          },
          new Date('2026-10-15T12:00:00Z'),
        ),
      );
      await assert.rejects(
        creator.execute(
          {
            ...payload,
            answers: [
              { questionId: blocked, value: true },
              { questionId: condition, value: 'bad' },
            ],
          },
          new Date('2026-10-15T12:00:00Z'),
        ),
      );
      await assert.rejects(
        creator.execute(
          {
            ...payload,
            answers: [
              { questionId: blocked, value: false },
              { questionId: condition, value: 'unknown' },
            ],
          },
          new Date('2026-10-15T12:00:00Z'),
        ),
      );
      await assert.rejects(
        creator.execute(
          {
            serviceDefinitionId: serviceId,
            serviceDefinitionVersionId: version,
            description: payload.description,
            reportingIdentity: payload.reportingIdentity,
            answers: payload.answers,
          },
          new Date('2026-10-15T12:00:00Z'),
        ),
      );
      await assert.rejects(
        creator.execute(
          { ...payload, serviceDefinitionVersionId: draftVersion },
          new Date('2026-10-15T12:00:00Z'),
        ),
      );
      const after = await db
        .selectFrom('service_request')
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .executeTakeFirstOrThrow();
      assert.equal(after.count, before.count);
      assert.equal(
        (
          await db
            .selectFrom('service_request_reference_sequence')
            .select('last_value')
            .where('period_key', '=', '202610')
            .executeTakeFirstOrThrow()
        ).last_value,
        14,
      );

      await assert.rejects(
        db
          .insertInto('answer')
          .values({
            id: randomUUID(),
            organization_id: randomUUID(),
            service_request_id: september.id,
            question_id: blocked,
            question_key: 'bad',
            question_label: 'Bad',
            question_type: 'yes_no',
            display_order: 10,
            text_value: null,
            number_value: null,
            boolean_value: true,
            option_key: null,
            display_value: null,
          })
          .execute(),
      );
      await eligibilityDown(db);
      await listDown(db);
      await requestDown(db);
    } finally {
      await db.destroy();
      await admin.query(`drop schema if exists "${schema}" cascade`);
      await admin.end();
    }
  },
);
