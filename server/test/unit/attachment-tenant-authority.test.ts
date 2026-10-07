import assert from 'node:assert/strict';
import test from 'node:test';
import { NotFoundException } from '@nestjs/common';
import {
  residentAuthority,
  staffAuthority,
  type AttachmentAuthority,
} from '../../src/attachments/attachment.service.js';
import type { StaffAccess } from '../../src/auth/auth.types.js';

const ORGANIZATION_A = '20000000-0000-4000-8000-00000000000a';
const ORGANIZATION_B = '20000000-0000-4000-8000-00000000000b';

function staff(organizationId: string): StaffAccess {
  return {
    tenantId: '11111111-1111-4111-8111-111111111111',
    objectId: '22222222-2222-4222-8222-222222222222',
    staffIdentityId: '90000000-0000-4000-8000-000000000001',
    organizationId,
    displayName: 'Synthetic staff',
    scopes: [],
    permissions: [],
    departmentIds: [],
    divisionIds: [],
    development: false,
  };
}

test('authority constructors produce exactly one discriminated kind', () => {
  const resident = residentAuthority(ORGANIZATION_A);
  const operator = staffAuthority(staff(ORGANIZATION_B));

  assert.equal(resident.kind, 'resident');
  assert.equal(operator.kind, 'staff');
  // Neither shape can carry the other's authority.
  assert.equal('access' in resident, false);
  assert.equal('organizationId' in operator, false);
  assert.equal(resident.organizationId, ORGANIZATION_A);
  assert.equal(operator.access.organizationId, ORGANIZATION_B);
});

/**
 * Mirrors the service's batch-admission predicate exactly, so the authority
 * rules can be exercised without a database. The production path is proven
 * against PostgreSQL in the attachment integration suites.
 */
function admits(
  authority: AttachmentAuthority,
  batch: {
    context: string;
    organizationId: string;
    staffIdentityId: string | null;
  },
): boolean {
  if (authority.kind === 'resident')
    return (
      batch.context === 'REQUEST_EVIDENCE' &&
      batch.organizationId === authority.organizationId
    );
  const access = authority.access;
  return (
    batch.context !== 'REQUEST_EVIDENCE' &&
    batch.organizationId === access.organizationId &&
    batch.staffIdentityId === access.staffIdentityId
  );
}

const evidenceOfA = {
  context: 'REQUEST_EVIDENCE',
  organizationId: ORGANIZATION_A,
  staffIdentityId: null,
};
const evidenceOfB = {
  context: 'REQUEST_EVIDENCE',
  organizationId: ORGANIZATION_B,
  staffIdentityId: null,
};
const noteOfA = {
  context: 'INTERNAL_NOTE',
  organizationId: ORGANIZATION_A,
  staffIdentityId: '90000000-0000-4000-8000-000000000001',
};

test('a resident of one Organization cannot reach another Organization batch', () => {
  assert.equal(admits(residentAuthority(ORGANIZATION_A), evidenceOfA), true);
  assert.equal(admits(residentAuthority(ORGANIZATION_A), evidenceOfB), false);
  assert.equal(admits(residentAuthority(ORGANIZATION_B), evidenceOfA), false);
});

test('resident authority cannot reach a staff-owned batch', () => {
  // Even in its own Organization: an internal note batch is not resident
  // addressable, so a resident token can never preview or remove one.
  assert.equal(admits(residentAuthority(ORGANIZATION_A), noteOfA), false);
});

test('staff authority cannot stand in for anonymous evidence authority', () => {
  assert.equal(
    admits(staffAuthority(staff(ORGANIZATION_A)), evidenceOfA),
    false,
  );
  assert.equal(
    admits(staffAuthority(staff(ORGANIZATION_B)), evidenceOfA),
    false,
  );
});

test('staff authority is bounded by its own Organization and identity', () => {
  assert.equal(admits(staffAuthority(staff(ORGANIZATION_A)), noteOfA), true);
  assert.equal(admits(staffAuthority(staff(ORGANIZATION_B)), noteOfA), false);
  const otherOperator = {
    ...staff(ORGANIZATION_A),
    staffIdentityId: '90000000-0000-4000-8000-000000000002',
  };
  assert.equal(admits(staffAuthority(otherOperator), noteOfA), false);
});

test('the attachment service holds no Organization of its own', async () => {
  const { readFile } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const source = await readFile(
    resolve(__dirname, '../../src/attachments/attachment.service.js'),
    'utf8',
  );

  assert.doesNotMatch(
    source,
    /developmentOrganizationId/,
    'attachment.service must not read the development Organization',
  );
  assert.doesNotMatch(
    source,
    /this\.organizationId/,
    'attachment.service must not capture an Organization',
  );
  // No entry point may take an optional staff access any more.
  assert.doesNotMatch(source, /access\?: StaffAccess/);
});

test('the resident attachment controller obtains a tenant, never configuration', async () => {
  const { readFile } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const source = await readFile(
    resolve(__dirname, '../../src/attachments/attachment.controller.js'),
    'utf8',
  );

  assert.match(source, /residentAuthority/);
  assert.match(source, /staffAuthority/);
  assert.doesNotMatch(source, /developmentOrganizationId/);
});

test('an unresolved resident tenant fails closed before any attachment work', async () => {
  const { residentTenantFromRequest } =
    await import('../../src/tenancy/resident-tenant.decorator.js');

  // The upload guard derives resident authority through this helper, so an
  // absent or failed resolution refuses rather than defaulting.
  assert.throws(() => residentTenantFromRequest({}), NotFoundException);
  assert.throws(
    () =>
      residentTenantFromRequest({ tenantResolution: { status: 'not_found' } }),
    NotFoundException,
  );
});
