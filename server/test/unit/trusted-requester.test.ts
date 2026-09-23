import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  developmentRequesterContext,
  assertTrustedRequester,
  type TrustedRequesterContext,
} from '../../src/service-request/trusted-requester.js';

test('F050 trusted synthetic source requires explicit non-production opt-in and exact fictional subject', () => {
  const env = {
    NODE_ENV: 'development',
    CITYVUE_DEPLOYMENT_PROFILE: 'development',
    F050_ENABLE_SYNTHETIC: 'true',
  };
  const org = randomUUID();
  const context = developmentRequesterContext(env, org, 'fictional-test-001');
  assertTrustedRequester(context);
  assert.equal(Object.isFrozen(context), true);
  assert.throws(() => {
    assertTrustedRequester({ ...context });
  });
  assert.throws(() => {
    assertTrustedRequester(
      JSON.parse(JSON.stringify(context)) as TrustedRequesterContext,
    );
  });
  for (const patch of [
    { NODE_ENV: 'production' },
    { NODE_ENV: '' },
    { CITYVUE_DEPLOYMENT_PROFILE: 'client' },
    { F050_ENABLE_SYNTHETIC: 'false' },
  ])
    assert.throws(() =>
      developmentRequesterContext(
        { ...env, ...patch },
        org,
        'fictional-test-001',
      ),
    );
  for (const subject of [
    '',
    'person@example.test',
    ' fictional-test',
    'fictional-test\n',
    'fictional-UPPER',
    'fictional-' + 'a'.repeat(101),
  ])
    assert.throws(() => developmentRequesterContext(env, org, subject));
  assert.throws(() =>
    developmentRequesterContext(env, 'wrong-org', 'fictional-test'),
  );
});
