import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CreateServiceRequestService } from '../../src/service-request/create-service-request.service.js';
import { GetServiceRequestDetailsService } from '../../src/service-request/get-service-request-details.service.js';
import { ListServiceRequestsService } from '../../src/service-request/list-service-requests.service.js';
import type { CreateServiceRequestDto } from '../../src/service-request/service-request.dto.js';
import { DatabaseService } from '../../src/database/database.service.js';

const serviceId = '40000000-0000-4000-8000-000000000001';
const versionId = '50000000-0000-4000-8000-000000000001';
const base = {
  serviceDefinitionId: serviceId,
  serviceDefinitionVersionId: versionId,
  description: 'Road damage',
  reportingIdentity: 'anonymous',
  location: { enteredAddress: '1 Main Street' },
  answers: [],
};
let app: INestApplication;
before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL =
    'postgresql://cityvue:placeholder@localhost:5432/cityvue_test';
  process.env.LOG_LEVEL = 'silent';
  process.env.ENABLE_DEVELOPMENT_SERVICE_REQUEST_READS = 'true';
  const [{ AppModule }, { configureApplication }] = await Promise.all([
    import('../../src/app.module.js'),
    import('../../src/bootstrap.js'),
  ]);
  const create = {
    execute: async (input: CreateServiceRequestDto) => {
      if (input.serviceDefinitionVersionId.endsWith('99'))
        throw new NotFoundException(
          'Published service definition version not found',
        );
      if (!input.location)
        throw new BadRequestException('Location is required for this service');
      if (
        input.reportingIdentity === 'anonymous' &&
        input.serviceDefinitionId.endsWith('05')
      )
        throw new BadRequestException(
          'Anonymous reporting is not allowed for this service',
        );
      return {
        id: '80000000-0000-4000-8000-000000000001',
        referenceNumber: 'SR-202609-000001',
        status: 'open',
        createdAt: new Date('2026-09-02T12:00:00Z'),
      };
    },
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DatabaseService)
    .useValue({ status: async () => 'up' })
    .overrideProvider(CreateServiceRequestService)
    .useValue(create)
    .overrideProvider(GetServiceRequestDetailsService)
    .useValue({
      execute: async (id: string) => {
        if (id !== '80000000-0000-4000-8000-000000000001')
          throw new NotFoundException();
        return {
          serviceRequest: {
            id,
            referenceNumber: 'SR-202609-000001',
            status: 'open',
            priority: 'medium',
            createdAt: new Date('2026-09-02T12:00:00Z'),
            updatedAt: new Date('2026-09-02T12:00:00Z'),
            revision: 1,
          },
          classification: {
            serviceDefinitionId: serviceId,
            serviceDefinitionVersionId: versionId,
            issueName: 'Pothole',
            category: {
              id: '30000000-0000-4000-8000-000000000001',
              name: 'Roads & Streets',
            },
            department: {
              id: '20000000-0000-4000-8000-000000000001',
              name: 'Public Works',
            },
          },
          request: { description: 'Synthetic road damage' },
          answers: [],
          location: {
            enteredAddress: '123 Test Street',
            locationType: 'entered_address',
          },
          requester: { anonymous: true },
          activity: [
            {
              type: 'service_request_created',
              actorType: 'anonymous_resident',
              occurredAt: new Date('2026-09-02T12:00:00Z'),
              metadata: { referenceNumber: 'SR-202609-000001' },
            },
          ],
        };
      },
    })
    .overrideProvider(ListServiceRequestsService)
    .useValue({
      execute: async (query: Record<string, unknown>) => ({
        items: [
          {
            serviceRequestId: '80000000-0000-4000-8000-000000000001',
            referenceNumber: 'SR-202609-000001',
            issueName: 'Pothole',
            categoryId: '30000000-0000-4000-8000-000000000001',
            categoryName: 'Roads & Streets',
            departmentId: '20000000-0000-4000-8000-000000000001',
            departmentName: 'Public Works',
            divisionId: null,
            divisionName: null,
            status: query.status ?? 'open',
            priority: 'medium',
            createdAt: new Date('2026-09-02T12:00:00Z'),
            updatedAt: new Date('2026-09-02T12:00:00Z'),
            revision: 1,
          },
        ],
        total: 1,
        page: Number(query.page ?? 1),
        pageSize: Number(query.pageSize ?? 25),
        hasPreviousPage: false,
        hasNextPage: false,
      }),
    })
    .compile();
  app = module.createNestApplication();
  configureApplication(app);
  await app.init();
});
after(async () => app.close());

test('POST creates anonymous and identified requests with a resident-safe response', async () => {
  const anonymous = await request(app.getHttpServer())
    .post('/api/v1/service-requests')
    .send(base)
    .expect(201);
  assert.deepEqual(anonymous.body, {
    id: '80000000-0000-4000-8000-000000000001',
    referenceNumber: 'SR-202609-000001',
    status: 'open',
    createdAt: '2026-09-02T12:00:00.000Z',
  });
  assert.equal(
    'organizationId' in (anonymous.body as Record<string, unknown>),
    false,
  );
  await request(app.getHttpServer())
    .post('/api/v1/service-requests')
    .send({
      ...base,
      reportingIdentity: 'identified',
      contact: { name: 'Resident', email: 'resident@example.test' },
    })
    .expect(201);
});
test('POST rejects malformed IDs and non-whitelisted fields safely', async () => {
  const malformed = await request(app.getHttpServer())
    .post('/api/v1/service-requests')
    .send({ ...base, serviceDefinitionId: 'bad' })
    .expect(400);
  assert.equal('stack' in (malformed.body as Record<string, unknown>), false);
  await request(app.getHttpServer())
    .post('/api/v1/service-requests')
    .send({ ...base, priority: 'urgent' })
    .expect(400);
});
test('POST returns safe policy and catalog errors', async () => {
  await request(app.getHttpServer())
    .post('/api/v1/service-requests')
    .send({ ...base, location: undefined })
    .expect(400);
  await request(app.getHttpServer())
    .post('/api/v1/service-requests')
    .send({
      ...base,
      serviceDefinitionId: '40000000-0000-4000-8000-000000000005',
    })
    .expect(400);
  await request(app.getHttpServer())
    .post('/api/v1/service-requests')
    .send({
      ...base,
      serviceDefinitionVersionId: '50000000-0000-4000-8000-000000000099',
    })
    .expect(404);
});

test('GET returns development-only Organization-scoped details and safe not found responses', async () => {
  const response = await request(app.getHttpServer())
    .get('/api/v1/service-requests/80000000-0000-4000-8000-000000000001')
    .expect(200);
  const body = response.body as {
    classification: { department: { name: string } };
    location: { enteredAddress: string };
  };
  assert.equal(body.classification.department.name, 'Public Works');
  assert.equal(body.location.enteredAddress, '123 Test Street');
  assert.equal('organizationId' in body, false);
  await request(app.getHttpServer())
    .get('/api/v1/service-requests/not-a-uuid')
    .expect(404);
  await request(app.getHttpServer())
    .get('/api/v1/service-requests/80000000-0000-4000-8000-000000000099')
    .expect(404);
});
test('GET list returns paginated minimal rows and validates query options', async () => {
  const response = await request(app.getHttpServer())
    .get(
      '/api/v1/service-requests?search=000001&status=open&sort=reference_asc&page=1&pageSize=10',
    )
    .expect(200);
  const listBody = response.body as { items: Record<string, unknown>[] };
  const firstItem = listBody.items[0];
  assert.ok(firstItem);
  assert.equal(firstItem.referenceNumber, 'SR-202609-000001');
  for (const forbidden of [
    'description',
    'requester',
    'location',
    'answers',
    'activity',
    'organizationId',
  ])
    assert.equal(forbidden in firstItem, false);
  await request(app.getHttpServer())
    .get('/api/v1/service-requests?pageSize=101')
    .expect(400);
  await request(app.getHttpServer())
    .get('/api/v1/service-requests?department=bad')
    .expect(400);
  await request(app.getHttpServer())
    .get('/api/v1/service-requests?sort=created_at;drop table')
    .expect(400);
});
