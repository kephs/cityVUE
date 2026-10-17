import assert from 'node:assert/strict';
import test from 'node:test';
import { configuration } from '../../src/config/configuration.js';
import { issueIntakeTrackingCredential } from '../../src/service-request/requester-intake-issuance.js';
import { CreateServiceRequestService } from '../../src/service-request/create-service-request.service.js';

const FLAG = 'REQRO_ENABLE_REQUESTER_INTAKE_TRACKING';

test('F065 the intake issuance flag is off unless the environment says exactly true', () => {
  const original = process.env[FLAG];
  try {
    // Missing configuration means off.
    delete process.env.REQRO_ENABLE_REQUESTER_INTAKE_TRACKING;
    assert.equal(
      configuration().requesterTracking.intakeIssuanceEnabled,
      false,
      'an absent flag must not activate issuance',
    );
    // Anything that is not exactly 'true' means off, including values a
    // careless operator might expect to work.
    for (const value of [
      'false',
      'TRUE',
      'True',
      '1',
      'yes',
      'on',
      'enabled',
      '',
      ' true',
      'true ',
    ]) {
      process.env[FLAG] = value;
      assert.equal(
        configuration().requesterTracking.intakeIssuanceEnabled,
        false,
        `${JSON.stringify(value)} must not activate issuance`,
      );
    }
    process.env[FLAG] = 'true';
    assert.equal(
      configuration().requesterTracking.intakeIssuanceEnabled,
      true,
      'the explicit opt-in activates issuance',
    );
  } finally {
    if (original === undefined)
      delete process.env.REQRO_ENABLE_REQUESTER_INTAKE_TRACKING;
    else process.env[FLAG] = original;
  }
});

test('F065 intake issuance is gated by the creation path, and cannot enable itself', () => {
  const creation = (
    CreateServiceRequestService.prototype as unknown as {
      create: (...args: unknown[]) => unknown;
    }
  ).create.toString();
  // The one call site is guarded by the flag, the PUBLIC audience and the
  // resident-intake marker together.
  assert.ok(
    creation.includes('intakeTrackingEnabled'),
    'the creation path must consult the feature flag',
  );
  assert.ok(
    creation.includes('requesterIntake'),
    'the creation path must require the resident-intake marker',
  );
  const issuance = issueIntakeTrackingCredential.toString();
  // The helper never reads configuration, so it cannot be reached with the
  // flag off by some other route deciding for itself that it is enabled.
  for (const forbidden of [
    'intakeIssuanceEnabled',
    'intakeTrackingEnabled',
    'process.env',
    'ConfigService',
  ])
    assert.equal(
      issuance.includes(forbidden),
      false,
      `intake issuance must not reference ${forbidden}`,
    );
});

test('F065 intake issuance consults no permission and fabricates no staff identity', () => {
  const issuance = issueIntakeTrackingCredential.toString();
  for (const forbidden of [
    'assertStaffRequestPermission',
    'assertStaffRequestRead',
    'TRACKING_MANAGE',
    'tracking.manage',
    'permissions',
    'staffAccess',
    'staffIdentityId',
  ])
    assert.equal(
      issuance.includes(forbidden),
      false,
      `intake issuance must not reference ${forbidden}`,
    );
  // Attribution is explicit and the staff author is deliberately absent.
  assert.ok(issuance.includes('requester_intake'));
  assert.ok(issuance.includes('created_by_staff_identity_id'));
  // Expiry comes from the database clock, never from application time.
  assert.ok(issuance.includes('clock_timestamp()'));
  for (const forbidden of ['Date.now', 'new Date(Date', 'setDate'])
    assert.equal(
      issuance.includes(forbidden),
      false,
      `expiry must not be computed from application time (${forbidden})`,
    );
});

test('F065 no HTTP route issues a credential for an arbitrary existing request', async () => {
  const { RequesterTrackingController, StaffRequestTrackingController } =
    await import('../../src/service-request/request-tracking.controller.js');
  // The unauthenticated requester surface stays read-only.
  assert.deepEqual(
    Object.getOwnPropertyNames(RequesterTrackingController.prototype).filter(
      (name) => name !== 'constructor',
    ),
    ['track'],
  );
  // Staff management remains the only mutating surface, unchanged by F065.
  assert.deepEqual(
    Object.getOwnPropertyNames(StaffRequestTrackingController.prototype)
      .filter((name) => name !== 'constructor')
      .sort(),
    ['issue', 'revoke', 'rotate', 'state'],
  );
});
