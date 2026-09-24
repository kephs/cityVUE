import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSync } from 'class-validator';
import {
  areaName,
  assertAreaWrite,
  validateAreaChange,
} from '../../src/admin/admin-participation-area.domain.js';
import {
  AreaChangeDto,
  AreaCreateDto,
} from '../../src/admin/admin-participation-area.controller.js';
import { permissions, type StaffAccess } from '../../src/auth/auth.types.js';
import { developmentStaffBundles } from '../../src/database/development-staff-input.js';
import { buildErrorResponse } from '../../src/common/errors/http-exception.filter.js';
import { BadRequestException } from '@nestjs/common';
const base: StaffAccess = {
  organizationId: '10000000-0000-4000-8000-000000000001',
  staffIdentityId: '10000000-0000-4000-8000-000000000002',
  tenantId: 'tenant',
  objectId: 'actor',
  displayName: 'Fictional',
  scopes: [],
  permissions: [],
  departmentIds: [],
  divisionIds: [],
  development: false,
};
test('F055 independent read plus write, no bundle or development fallback', () => {
  for (const permission of permissions)
    assert.throws(() => {
      assertAreaWrite({ ...base, permissions: [permission] });
    });
  const both = {
    ...base,
    permissions: [
      'admin.configuration.read',
      'admin.participation_areas.write',
    ] as StaffAccess['permissions'],
  };
  assert.doesNotThrow(() => {
    assertAreaWrite(both);
  });
  assert.throws(() => {
    assertAreaWrite({ ...both, development: true });
  });
  for (const bundle of Object.values(developmentStaffBundles))
    assert.ok(
      !(bundle as readonly string[]).includes(
        'admin.participation_areas.write',
      ),
    );
});
test('F055 trims Unicode boundary whitespace, preserves capitalization, bounds plain text', () => {
  assert.equal(areaName('\u00a0 North District \u3000'), 'North District');
  assert.equal(areaName('<b>North</b>'), '<b>North</b>');
  assert.equal(areaName('é'.repeat(120)).length, 120);
  for (const v of [
    null,
    {},
    123,
    '',
    ' \t ',
    'x'.repeat(121),
    'North\u0000',
    'North\u202e',
    '\ud800',
  ])
    assert.throws(() => areaName(v));
});
test('F055 strict DTO plus service allow exactly one mutation and bounded expectedRevision', () => {
  const check = (body: object) =>
    validateSync(Object.assign(new AreaChangeDto(), body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
  for (const input of [
    { displayName: 'North' },
    { active: false },
    { displayOrder: 0 },
  ]) {
    const dto = Object.assign(new AreaChangeDto(), {
      ...input,
      expectedRevision: 1,
    });
    assert.equal(check(dto).length, 0);
    assert.doesNotThrow(() => {
      validateAreaChange(dto);
    });
  }
  for (const expectedRevision of [undefined, null, 0, -1, 1.1, '1', 2147483648])
    assert.ok(check({ displayName: 'North', expectedRevision }).length);
  for (const field of [
    'organizationId',
    'privacyThreshold',
    'collectionEnabled',
    'geometry',
    'latitude',
    'longitude',
    'assignmentTarget',
    'requesterId',
  ])
    assert.ok(
      check({ active: false, expectedRevision: 1, [field]: 'forged' }).length,
    );
  for (const body of [
    { expectedRevision: 1 },
    { expectedRevision: 1, active: false, displayName: 'North' },
    { expectedRevision: 1, displayOrder: 1.1 },
    { expectedRevision: 1, displayName: null },
  ])
    assert.throws(() => {
      validateAreaChange(body as never);
    });
  assert.ok(
    validateSync(
      Object.assign(new AreaCreateDto(), {
        displayName: 'North',
        active: false,
      }),
      { whitelist: true, forbidNonWhitelisted: true },
    ).length,
  );
});
test('F055 safe error codes emit fixed messages, never arbitrary exception text', () => {
  const result = buildErrorResponse(
    new BadRequestException({
      code: 'PARTICIPATION_AREA_DUPLICATE',
      message: 'secret',
    }),
    'safe',
  );
  assert.equal(
    result.message,
    'A Participation Area with this name already exists.',
  );
  assert.ok(!JSON.stringify(result).includes('secret'));
});
