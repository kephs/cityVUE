import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertDevelopmentDatabaseUrl,
  developmentStaffEnvironment,
  selectedDevelopmentPermissions,
  selectedDevelopmentScopes,
} from '../../src/database/development-staff-input.js';

const tenant = '30000000-0000-4000-8000-000000000003';
const base = {
  NODE_ENV: 'development',
  CITYVUE_DEPLOYMENT_PROFILE: 'development',
  CITYVUE_ENABLE_EXTERNAL_IDENTITY: 'true',
  ENTRA_TENANT_ID: tenant,
  F036_PERSONAL_ENTRA_TENANT_ID: tenant,
  ENTRA_API_CLIENT_ID: '50000000-0000-4000-8000-000000000005',
  ENTRA_EXPECTED_AUDIENCE: 'api://fictional',
  DATABASE_URL:
    'postgresql://reqro_dev_user:placeholder@localhost:5432/reqro_dev',
};

test('F036 requires raw explicit development profile and personal tenant confirmation', () => {
  assert.equal(developmentStaffEnvironment(base).NODE_ENV, 'development');
  for (const key of [
    'NODE_ENV',
    'CITYVUE_DEPLOYMENT_PROFILE',
    'CITYVUE_ENABLE_EXTERNAL_IDENTITY',
    'F036_PERSONAL_ENTRA_TENANT_ID',
    'ENTRA_TENANT_ID',
    'ENTRA_API_CLIENT_ID',
  ]) {
    for (const value of [
      undefined,
      '',
      'production',
      'client',
      'unknown',
      ' development',
    ])
      assert.throws(() =>
        developmentStaffEnvironment({ ...base, [key]: value }),
      );
  }
  for (const value of [undefined, ''])
    assert.throws(() =>
      developmentStaffEnvironment({ ...base, ENTRA_EXPECTED_AUDIENCE: value }),
    );
  assert.throws(() =>
    developmentStaffEnvironment({
      ...base,
      F036_PERSONAL_ENTRA_TENANT_ID: '40000000-0000-4000-8000-000000000004',
    }),
  );
});

test('F036 rejects unsafe database metadata before connecting, including URL option overrides', () => {
  assertDevelopmentDatabaseUrl(base.DATABASE_URL);
  for (const value of [
    'invalid',
    base.DATABASE_URL.replace('localhost', 'db.example.com'),
    base.DATABASE_URL.replace('localhost', '127.0.0.1'),
    base.DATABASE_URL.replace(':5432', ':5433'),
    base.DATABASE_URL.replace('/reqro_dev', '/reqro_test'),
    base.DATABASE_URL.replace('/reqro_dev', '/reqro_prod'),
    base.DATABASE_URL.replace('/reqro_dev', '/client_database'),
    base.DATABASE_URL.replace('reqro_dev_user:', 'postgres:'),
    base.DATABASE_URL + '?host=db.example.com',
    base.DATABASE_URL + '?options=-csearch_path=other',
    base.DATABASE_URL + '#ignored',
  ])
    assert.throws(() => assertDevelopmentDatabaseUrl(value));
});

test('F036/F041 bundles expand to approved explicit permissions without geospatial or wildcard defaults', () => {
  assert.deepEqual(
    selectedDevelopmentPermissions(undefined, 'INTERNAL_REQUEST_READER'),
    ['service_request.internal.read'],
  );
  assert.deepEqual(
    selectedDevelopmentPermissions(undefined, 'FULL_UAT_OPERATOR'),
    [
      'service_request.tracking.manage',
      'service_request.create',
      'service_request.create_internal',
      'service_request.internal.read',
      'service_request.contact.read',
      'service_request.note.read',
      'service_request.note.create',
      'service_request.communication.read',
      'service_request.communication.create',
      'service_request.internal.update',
      'catalog.issue_action.manage',
      'service_request.reference.manage',
      'service_request.view',
      'service_request.start_work',
      'service_request.hold',
      'service_request.resume',
      'service_request.close',
      'service_request.reopen',
      'service_request.assign',
      'service_request.route',
      'service_request.watchers.manage',
    ],
  );
  for (const invalid of [
    '*',
    'all',
    'reqro.admin.*',
    'service_request.internal.reed',
    'service_request.contact.reed',
    'service_request.notes.read',
    'service_request.note.update',
    'service_request.note.delete',
    'service_request.communication.update',
    'service_request.communication.delete',
    'service_request.communications.read',
    'service_request.veiw',
    'service_request.routes',
    'service_request.watchers.admin',
    '',
  ])
    assert.throws(() => selectedDevelopmentPermissions(invalid, undefined));
  assert.throws(() => selectedDevelopmentPermissions(undefined, '__proto__'));
  assert.deepEqual(
    selectedDevelopmentPermissions('service_request.view', undefined),
    ['service_request.view'],
  );
  assert.throws(() =>
    selectedDevelopmentPermissions('geospatial.read', 'FULL_UAT_OPERATOR'),
  );
  assert.deepEqual(
    selectedDevelopmentPermissions(
      'geospatial.read,geospatial.read',
      undefined,
    ),
    ['geospatial.read'],
  );
});

test('answer read requires an explicit selection and is absent from broad bundles', () => {
  assert.deepEqual(
    selectedDevelopmentPermissions('service_request.answers.read', undefined),
    ['service_request.answers.read'],
  );
  assert.equal(
    selectedDevelopmentPermissions(undefined, 'FULL_UAT_OPERATOR').includes(
      'service_request.answers.read',
    ),
    false,
  );
});

test('F036 scope inputs require explicit validated hierarchy identifiers without authority extras', () => {
  const scope = {
    departmentId: '20000000-0000-4000-8000-000000000001',
    divisionId: null,
  };
  assert.deepEqual(selectedDevelopmentScopes(JSON.stringify([scope])), [scope]);
  for (const invalid of [
    undefined,
    'null',
    '[]',
    '{}',
    'bad',
    JSON.stringify([scope, scope]),
    JSON.stringify([{ ...scope, organizationId: tenant }]),
    JSON.stringify([{ departmentId: scope.departmentId }]),
    JSON.stringify([{ ...scope, divisionId: '*' }]),
  ])
    assert.throws(() => selectedDevelopmentScopes(invalid));
});
