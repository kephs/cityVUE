import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from '../../src/config/configuration.js';
import type { DatabaseService } from '../../src/database/database.service.js';
import type { EvaluateLocationEligibilityService } from '../../src/location-eligibility/evaluate-location-eligibility.service.js';
import { CreateServiceRequestService } from '../../src/service-request/create-service-request.service.js';
import { ServiceRequestRepository } from '../../src/service-request/service-request.repository.js';
import type { CreateStaffServiceRequestDto } from '../../src/service-request/service-request.dto.js';
import type { StaffAccess } from '../../src/auth/auth.types.js';

const input: CreateStaffServiceRequestDto = {
  serviceDefinitionId: '40000000-0000-4000-8000-000000000001',
  serviceDefinitionVersionId: '50000000-0000-4000-8000-000000000001',
  description: 'Fictional intake',
  reportingIdentity: 'identified',
  answers: [],
  audience: 'internal',
  intakeChannel: 'staff',
};
const access: StaffAccess = {
  tenantId: '30000000-0000-4000-8000-000000000001',
  objectId: '30000000-0000-4000-8000-000000000002',
  staffIdentityId: '90000000-0000-4000-8000-000000000001',
  organizationId: '10000000-0000-4000-8000-000000000001',
  displayName: 'Fictional staff',
  scopes: ['access_as_user'],
  permissions: ['service_request.create', 'service_request.create_internal'],
  departmentIds: [],
  divisionIds: [],
  development: false,
};

test('staff creation service rejects absent, fallback and insufficiently authorized principals before database access', async () => {
  const config = {
    get: () => access.organizationId,
  } as unknown as ConfigService<AppConfiguration, true>;
  // An absent database deliberately makes any accidental persistence access fail.
  const service = new CreateServiceRequestService(
    config,
    {} as DatabaseService,
    new ServiceRequestRepository(),
    {} as EvaluateLocationEligibilityService,
  );
  for (const principal of [
    undefined,
    { ...access, development: true },
    { ...access, tenantId: null },
    { ...access, objectId: null },
    { ...access, permissions: [] },
    { ...access, permissions: ['service_request.create'] as const },
  ]) {
    await assert.rejects(
      service.executeStaff(input, principal as StaffAccess | undefined),
      ForbiddenException,
    );
  }
});
