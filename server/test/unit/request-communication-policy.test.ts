import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { assertCommunicationEligibility } from '../../src/service-request/request-communication-policy.js';
import {
  accessPermissionMetadata,
  validateAccessDependencies,
} from '../../src/access/access-policy.js';

test('F058.2 inactive/anonymous history is readable but new writes fail; invalid relationships fail closed', () => {
  for (const state of ['eligible', 'anonymous', 'requester_inactive'] as const)
    assert.doesNotThrow(() => {
      assertCommunicationEligibility(state, false);
    });
  assert.doesNotThrow(() => {
    assertCommunicationEligibility('eligible', true);
  });
  for (const state of ['anonymous', 'requester_inactive'] as const)
    assert.throws(() => {
      assertCommunicationEligibility(state, true);
    }, ForbiddenException);
  for (const create of [false, true])
    assert.throws(() => {
      assertCommunicationEligibility('unavailable', create);
    }, NotFoundException);
});

test('F058.2 F057 communication metadata remains sensitive/manageable with contextual parent authority', () => {
  for (const key of [
    'service_request.communication.read',
    'service_request.communication.create',
  ] as const) {
    const meta = accessPermissionMetadata[key];
    assert.equal(meta.sensitive, true);
    assert.equal(meta.classification, 'manageable');
    assert.match(meta.contextual, /PUBLIC or INTERNAL/);
    assert.ok(!meta.description.includes('PUBLIC'));
    assert.ok(
      !(meta.requires as readonly string[]).includes('service_request.view'),
    );
  }
  for (const parent of [
    'service_request.view',
    'service_request.internal.read',
  ] as const)
    assert.doesNotThrow(() => {
      validateAccessDependencies(
        ['service_request.communication.create'],
        [parent, 'service_request.communication.read'],
      );
    });
  assert.throws(() => {
    validateAccessDependencies(
      ['service_request.communication.create'],
      ['service_request.internal.read'],
    );
  });
});
