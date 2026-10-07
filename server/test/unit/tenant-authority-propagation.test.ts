import assert from 'node:assert/strict';
import test from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { AlertsController } from '../../src/alerts/alerts.controller.js';
import { AlertsService } from '../../src/alerts/alerts.service.js';
import { CatalogController } from '../../src/catalog/catalog.controller.js';
import { CatalogService } from '../../src/catalog/catalog.service.js';
import { PublicResidentExperienceController } from '../../src/resident-experience/resident-experience.public.controller.js';
import { PublicResidentExperienceService } from '../../src/resident-experience/resident-experience.public.service.js';
import { ParticipationAreaController } from '../../src/service-request/participation.controller.js';
import { ServiceRequestController } from '../../src/service-request/service-request.controller.js';
import { residentTenantFromRequest } from '../../src/tenancy/resident-tenant.decorator.js';
import type { TenantContext } from '../../src/tenancy/tenant-context.js';
import type { StaffAccess } from '../../src/auth/auth.types.js';

const ORGANIZATION_A = '20000000-0000-4000-8000-00000000000a';
const ORGANIZATION_B = '20000000-0000-4000-8000-00000000000b';
const CORRELATION = '7f7f7f7f-7f7f-4f7f-8f7f-7f7f7f7f7f7f';

function tenant(organizationId: string): TenantContext {
  return {
    source: 'registry',
    organizationId,
    correlationId: CORRELATION,
  } as unknown as TenantContext;
}

function staff(organizationId: string): StaffAccess {
  return {
    tenantId: '11111111-1111-4111-8111-111111111111',
    objectId: '22222222-2222-4222-8222-222222222222',
    staffIdentityId: '90000000-0000-4000-8000-000000000001',
    organizationId,
    displayName: 'Synthetic staff',
    scopes: [],
    permissions: ['service_request.view'],
    departmentIds: [],
    divisionIds: [],
    development: false,
  } as unknown as StaffAccess;
}

/** Records the Organization each repository call received. */
function recorder() {
  const seen: string[] = [];
  return {
    seen,
    capture: (organizationId: string) => seen.push(organizationId),
  };
}

test('alerts take Organization from the resident tenant, not configuration', async () => {
  const { seen, capture } = recorder();
  const controller = new AlertsController(
    new AlertsService({
      listActive: (organizationId: string) => {
        capture(organizationId);
        return Promise.resolve([]);
      },
    } as never),
  );

  await controller.listActive(tenant(ORGANIZATION_A));
  await controller.listActive(tenant(ORGANIZATION_B));
  assert.deepEqual(seen, [ORGANIZATION_A, ORGANIZATION_B]);
});

test('catalog reads take Organization from the resident tenant', async () => {
  const { seen, capture } = recorder();
  const repository = {
    listActiveCategories: (organizationId: string) => {
      capture(organizationId);
      return Promise.resolve([]);
    },
    listPublishedIssues: (organizationId: string) => {
      capture(organizationId);
      return Promise.resolve([]);
    },
    getPublishedIssue: (organizationId: string) => {
      capture(organizationId);
      return Promise.resolve(undefined);
    },
  };
  const controller = new CatalogController(
    new CatalogService(repository as never),
  );

  await controller.listCategories(tenant(ORGANIZATION_A));
  await controller.listIssues(tenant(ORGANIZATION_B), ORGANIZATION_A);
  await assert.rejects(
    controller.getIssue(tenant(ORGANIZATION_B), ORGANIZATION_A),
    NotFoundException,
  );
  // The category and issue identifiers are path values and must never be
  // mistaken for an Organization selector.
  assert.deepEqual(seen, [ORGANIZATION_A, ORGANIZATION_B, ORGANIZATION_B]);
});

test('the public resident experience takes Organization from the resident tenant', async () => {
  const { seen, capture } = recorder();
  const controller = new PublicResidentExperienceController(
    new PublicResidentExperienceService(
      {
        getPublished: (organizationId: string) => {
          capture(organizationId);
          return Promise.resolve(null);
        },
      } as never,
      { logger: { error: () => undefined } } as never,
    ),
  );

  await controller.getPublished(tenant(ORGANIZATION_B), {}, {
    headers: {},
  } as never);
  assert.deepEqual(seen, [ORGANIZATION_B]);
});

test('participation areas take Organization from the resident tenant', async () => {
  const { seen, capture } = recorder();
  const query = {
    select: () => query,
    where: (_column: string, _op: string, value: string) => {
      if (typeof value === 'string' && value.startsWith('2000')) capture(value);
      return query;
    },
    executeTakeFirst: () => Promise.resolve(undefined),
  };
  const controller = new ParticipationAreaController({
    areas: (organizationId: string) => {
      capture(organizationId);
      return Promise.resolve({ collectionEnabled: false, items: [] });
    },
  } as never);

  await controller.areas(tenant(ORGANIZATION_A));
  assert.deepEqual(seen, [ORGANIZATION_A]);
  void query;
});

test('anonymous request creation takes Organization from the resident tenant', async () => {
  const seen: string[] = [];
  const controller = new ServiceRequestController(
    {
      execute: (organizationId: string) => {
        seen.push(organizationId);
        return Promise.resolve({} as never);
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
  );

  // A forged Organization-looking body field must not influence the write.
  await controller.create(tenant(ORGANIZATION_A), {
    organizationId: ORGANIZATION_B,
    organization_id: ORGANIZATION_B,
    tenant: ORGANIZATION_B,
  } as never);
  assert.deepEqual(seen, [ORGANIZATION_A]);
});

test('staff reads take Organization from verified identity, never the hostname', async () => {
  const listed: string[] = [];
  const detailed: string[] = [];
  const assigned: string[] = [];
  const controller = new ServiceRequestController(
    {} as never,
    {
      execute: (_id: string, access: StaffAccess) => {
        detailed.push(access.organizationId);
        return Promise.resolve({} as never);
      },
    } as never,
    {
      execute: (_query: unknown, access: StaffAccess) => {
        listed.push(access.organizationId);
        return Promise.resolve({} as never);
      },
    } as never,
    {
      assign: (_id: string, _input: unknown, access: StaffAccess) => {
        assigned.push(access.organizationId);
        return Promise.resolve({} as never);
      },
      workflow: () => Promise.resolve({} as never),
    } as never,
  );

  // Staff identity belongs to B. No hostname participates in these handlers,
  // so there is no argument through which A could be selected.
  await controller.list({}, staff(ORGANIZATION_B));
  await controller.details('id', staff(ORGANIZATION_B));
  await controller.assignment('id', {} as never, staff(ORGANIZATION_B));
  assert.deepEqual(listed, [ORGANIZATION_B]);
  assert.deepEqual(detailed, [ORGANIZATION_B]);
  assert.deepEqual(assigned, [ORGANIZATION_B]);
});

test('staff handlers accept no resident tenant argument', () => {
  // Structural guard: if a staff handler ever gained a resident-tenant
  // parameter, its arity would change and this would fail.
  assert.equal(ServiceRequestController.prototype.list.length, 2);
  assert.equal(ServiceRequestController.prototype.details.length, 2);
  assert.equal(ServiceRequestController.prototype.assignment.length, 3);
  // Resident creation takes the tenant first, then the body.
  assert.equal(ServiceRequestController.prototype.create.length, 2);
});

test('a resident handler fails closed when no tenant resolved', () => {
  assert.throws(() => residentTenantFromRequest({}), NotFoundException);
  assert.throws(
    () =>
      residentTenantFromRequest({
        tenantResolution: { status: 'not_found', reason: 'unknown_host' },
      }),
    NotFoundException,
  );
});

test('no refactored resident service reads the development Organization', async () => {
  const { readFile } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  for (const emitted of [
    '../../src/alerts/alerts.service.js',
    '../../src/catalog/catalog.service.js',
    '../../src/resident-experience/resident-experience.public.service.js',
    '../../src/service-request/participation.service.js',
    '../../src/service-request/list-service-requests.service.js',
    '../../src/service-request/get-service-request-details.service.js',
    '../../src/service-request/staff-actions.service.js',
  ]) {
    const source = await readFile(resolve(__dirname, emitted), 'utf8');
    assert.doesNotMatch(
      source,
      /developmentOrganizationId/,
      `${emitted} must not read the development Organization`,
    );
  }
});
