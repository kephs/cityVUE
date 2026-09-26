import test from 'node:test';
import assert from 'node:assert/strict';
import { personalAccessUatMode } from '../../src/database/personal-access-uat.js';

const env = {
  NODE_ENV: 'development',
  CITYVUE_DEPLOYMENT_PROFILE: 'development',
  CITYVUE_ENABLE_EXTERNAL_IDENTITY: 'true',
  ENTRA_TENANT_ID: 'synthetic-tenant',
  F036_PERSONAL_ENTRA_TENANT_ID: 'synthetic-tenant',
  F036_STAFF_ID: 'synthetic-staff',
  F057_STAFF_ID: 'synthetic-staff',
  F036_ORGANIZATION_ID: 'synthetic-org',
  F057_ORGANIZATION_ID: 'synthetic-org',
  F057_PERSONAL_MANAGER_UAT: 'true',
};
test('personal manager opt-in is explicit and cannot enable Reader operations', () => {
  assert.equal(personalAccessUatMode(env, false), true);
  assert.equal(personalAccessUatMode(env, true), false);
  assert.equal(
    personalAccessUatMode(
      {
        ...env,
        F057_PERSONAL_MANAGER_UAT: 'false',
        F057_PERSONAL_READER_UAT: 'true',
      },
      false,
    ),
    false,
  );
});
test('personal manager selection fails closed on profile, tenant, identity and Organization mismatch', () => {
  for (const key of [
    'NODE_ENV',
    'CITYVUE_DEPLOYMENT_PROFILE',
    'CITYVUE_ENABLE_EXTERNAL_IDENTITY',
    'ENTRA_TENANT_ID',
    'F036_PERSONAL_ENTRA_TENANT_ID',
    'F036_STAFF_ID',
    'F057_STAFF_ID',
    'F036_ORGANIZATION_ID',
    'F057_ORGANIZATION_ID',
  ]) {
    assert.throws(() => personalAccessUatMode({ ...env, [key]: '' }, false));
    assert.throws(() =>
      personalAccessUatMode({ ...env, [key]: 'unapproved' }, false),
    );
  }
});
