import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from '../../src/config/configuration.js';
import type { DatabaseService } from '../../src/database/database.service.js';
import { StaffActionsService } from '../../src/service-request/staff-actions.service.js';

function service(enabled: boolean) {
  const config = {
    get: (key: string) =>
      key === 'catalog.developmentOrganizationId'
        ? '10000000-0000-4000-8000-000000000001'
        : key === 'staffActions.developmentActorId'
          ? '90000000-0000-4000-8000-000000000001'
          : enabled,
  } as unknown as ConfigService<AppConfiguration, true>;
  return new StaffActionsService(config, {} as DatabaseService);
}

test('development staff actions fail closed before database access', async () => {
  await assert.rejects(
    service(false).assign('80000000-0000-4000-8000-000000000001', {
      expectedRevision: 1,
      assignmentType: 'unassigned',
    }),
    NotFoundException,
  );
});

test('assignment command validates target shape and request identifier', async () => {
  await assert.rejects(
    service(true).assign('bad', {
      expectedRevision: 1,
      assignmentType: 'unassigned',
    }),
    NotFoundException,
  );
  await assert.rejects(
    service(true).assign('80000000-0000-4000-8000-000000000001', {
      expectedRevision: 1,
      assignmentType: 'group',
    }),
    BadRequestException,
  );
  await assert.rejects(
    service(true).assign('80000000-0000-4000-8000-000000000001', {
      expectedRevision: 1,
      assignmentType: 'unassigned',
      targetId: '91000000-0000-4000-8000-000000000001',
    }),
    BadRequestException,
  );
});
