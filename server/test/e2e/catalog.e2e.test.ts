import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CatalogService } from '../../src/catalog/catalog.service.js';
import { DatabaseService } from '../../src/database/database.service.js';

const categoryId = '30000000-0000-4000-8000-000000000001';
const issueId = '40000000-0000-4000-8000-000000000001';
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
  const catalog = {
    listCategories: async (search?: string) =>
      search?.trim().toLowerCase() === 'roads'
        ? [
            {
              id: categoryId,
              name: 'Roads & Streets',
              description: 'Road surfaces.',
              iconKey: 'signpost-split',
            },
          ]
        : [],
    listIssues: async (id: string) =>
      id === categoryId
        ? [
            {
              id: issueId,
              name: 'Pothole',
              description: 'Report pavement damage.',
              iconKey: 'cone-striped',
            },
          ]
        : [],
    getIssue: async (id: string) => {
      if (id !== issueId) throw new NotFoundException('Issue not found');
      return {
        id: issueId,
        name: 'Pothole',
        description: 'Report pavement damage.',
        iconKey: 'cone-striped',
        version: 1,
        defaultPriority: 'medium',
        locationPolicy: 'required',
        geographicEligibilityMode: 'city_maintained_roadway',
        anonymousReportingPolicy: 'allowed',
        questions: [
          {
            id: '60000000-0000-4001-8000-000000000001',
            key: 'roadBlocked',
            label: 'Is the roadway blocked?',
            helpText: null,
            type: 'yes_no',
            required: true,
            visibilityCondition: null,
            options: [],
          },
        ],
      };
    },
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DatabaseService)
    .useValue({ status: async () => 'up' })
    .overrideProvider(CatalogService)
    .useValue(catalog)
    .compile();
  app = module.createNestApplication();
  configureApplication(app);
  await app.init();
});

after(async () => app.close());

test('catalog endpoints expose resident DTO fields', async () => {
  const categories = await request(app.getHttpServer())
    .get('/api/v1/catalog/categories?search=%20Roads%20')
    .expect(200);
  const categoryBody = categories.body as Record<string, unknown>[];
  assert.deepEqual(categoryBody[0], {
    id: categoryId,
    name: 'Roads & Streets',
    description: 'Road surfaces.',
    iconKey: 'signpost-split',
  });
  const issues = await request(app.getHttpServer())
    .get(`/api/v1/catalog/categories/${categoryId}/issues`)
    .expect(200);
  const issueBody = issues.body as {
    name: string;
    organizationId?: unknown;
    routingMetadata?: unknown;
  }[];
  const firstIssue = issueBody[0];
  assert.ok(firstIssue);
  assert.equal(firstIssue.name, 'Pothole');
  assert.equal('organizationId' in firstIssue, false);
  assert.equal('routingMetadata' in firstIssue, false);
  const detail = await request(app.getHttpServer())
    .get(`/api/v1/catalog/issues/${issueId}`)
    .expect(200);
  const detailBody = detail.body as { questions: { key: string }[] };
  assert.equal(detailBody.questions[0]?.key, 'roadBlocked');
});

test('catalog endpoints reject malformed and missing IDs', async () => {
  await request(app.getHttpServer())
    .get('/api/v1/catalog/issues/not-a-uuid')
    .expect(400);
  await request(app.getHttpServer())
    .get('/api/v1/catalog/issues/40000000-0000-4000-8000-000000000099')
    .expect(404);
});
