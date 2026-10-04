import assert from 'node:assert/strict';
import test from 'node:test';
import { requesterStatus } from '../../src/service-request/request-tracking.domain.js';
import {
  residentSafeNotificationView,
  type ResidentSafeNotificationInput,
} from '../../src/notifications/resident-safe-notification.js';

const submittedAt = new Date('2026-10-01T12:00:00.000Z');
const updatedAt = new Date('2026-10-02T09:30:00.000Z');

function input(
  overrides: Partial<ResidentSafeNotificationInput> = {},
): ResidentSafeNotificationInput {
  return {
    reference: 'REF-1234',
    issueName: 'Pothole repair',
    rawStatus: 'open',
    submittedAt,
    updatedAt,
    organizationDisplayName: 'Example Organization',
    ...overrides,
  };
}

test('the view carries only resident-safe fields', () => {
  const view = residentSafeNotificationView(input());

  assert.deepEqual(Object.keys(view).sort(), [
    'issueName',
    'organizationDisplayName',
    'portalUrl',
    'reference',
    'serviceLocation',
    'status',
    'submittedAt',
    'updatedAt',
  ]);
});

test('internal workflow status never reaches the view as itself', () => {
  assert.equal(
    residentSafeNotificationView(input({ rawStatus: 'on_hold' })).status,
    'in_progress',
  );
  assert.notEqual(
    residentSafeNotificationView(input({ rawStatus: 'on_hold' })).status,
    'on_hold',
  );
});

test('unknown and internal statuses degrade to the resident-safe representation', () => {
  for (const rawStatus of [
    'pending_internal_review',
    'escalated',
    'awaiting_vendor',
    'ON_HOLD',
    '',
    'draft',
  ]) {
    assert.equal(
      residentSafeNotificationView(input({ rawStatus })).status,
      'unavailable',
      rawStatus,
    );
  }
});

test('status mapping stays identical to the existing resident tracking projection', () => {
  // One source of truth: notifications must not drift from what the resident
  // already sees on the tracking page.
  for (const rawStatus of [
    'open',
    'in_progress',
    'on_hold',
    'closed',
    'cancelled',
    'something_else',
  ]) {
    assert.equal(
      residentSafeNotificationView(input({ rawStatus })).status,
      requesterStatus(rawStatus),
      rawStatus,
    );
  }
});

test('the projection accepts narrow inputs and ignores unknown internal fields', () => {
  const internal = {
    ...input(),
    // Sentinel internal values; the narrow input contract has no home for them.
    staffDisplayName: 'SENTINEL_STAFF_NAME',
    departmentName: 'SENTINEL_DEPARTMENT',
    assigneeId: 'SENTINEL_ASSIGNEE',
    internalNote: 'SENTINEL_INTERNAL_NOTE',
    contactEmail: 'sentinel.resident@example.invalid',
    contactPhone: '+15555550123',
    trackingCredential: 'SENTINEL_TRACKING_CREDENTIAL',
  } as ResidentSafeNotificationInput;

  const view = residentSafeNotificationView(internal);

  for (const forbidden of [
    'staffDisplayName',
    'departmentName',
    'assigneeId',
    'internalNote',
    'contactEmail',
    'contactPhone',
    'trackingCredential',
  ]) {
    assert.equal(
      Object.hasOwn(view, forbidden),
      false,
      `${forbidden} must not exist on the resident-safe view`,
    );
  }
});

test('a trusted https URL is accepted and unsafe URLs become null', () => {
  assert.equal(
    residentSafeNotificationView(
      input({ trustedPortalUrl: 'https://requests.example.gov/track' }),
    ).portalUrl,
    'https://requests.example.gov/track',
  );
  for (const unsafe of [
    'http://requests.example.gov/track',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'https://user:secret@requests.example.gov/track',
    'not a url',
    '',
    '   ',
    null,
    undefined,
  ]) {
    assert.equal(
      residentSafeNotificationView(input({ trustedPortalUrl: unsafe }))
        .portalUrl,
      null,
      String(unsafe),
    );
  }
});

test('no portal URL is produced unless a caller supplies a trusted one', () => {
  // Slice 1 resolves no tenant domain; there is no implicit platform link.
  assert.equal(residentSafeNotificationView(input()).portalUrl, null);
});

test('safe text values are normalized and empty locations become null', () => {
  const view = residentSafeNotificationView(
    input({
      reference: '  REF-1234  ',
      issueName: 'Pothole\n  repair',
      serviceLocation: '   ',
    }),
  );

  assert.equal(view.reference, 'REF-1234');
  assert.equal(view.issueName, 'Pothole repair');
  assert.equal(view.serviceLocation, null);
  assert.equal(view.submittedAt, '2026-10-01T12:00:00.000Z');
  assert.equal(view.updatedAt, '2026-10-02T09:30:00.000Z');
});
