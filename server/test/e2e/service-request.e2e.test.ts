import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CreateServiceRequestService } from '../../src/service-request/create-service-request.service.js';
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
