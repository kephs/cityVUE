import assert from 'node:assert/strict';
import test from 'node:test';
import { requesterCommunicationProjection } from '../../src/service-request/requester-communication.projection.js';
import { REQUESTER_UPDATE_PAGE_SIZE } from '../../src/service-request/request-tracking.domain.js';

test('F042 future requester-facing projection minimizes sender identity and excludes every staff-only domain', () => {
  const source = {
    id: '10000000-0000-4000-8000-000000000001',
    body: 'Fictional correspondence',
    createdAt: '2026-09-21T12:00:00.123456Z',
    direction: 'outbound' as const,
    channel: 'portal' as const,
    deliveryState: 'recorded' as const,
    author: {
      displayName: 'Fictional employee',
      email: 'staff@example.invalid',
    },
    staffIdentityId: 'private',
    notes: ['staff-only'],
    activity: ['staff-only'],
    contact: { email: 'requester@example.invalid' },
    capabilities: { canCreateCommunication: true },
    assignment: 'private',
    watchers: ['private'],
    audit: 'private',
  };
  assert.deepEqual(requesterCommunicationProjection(source), {
    id: source.id,
    body: source.body,
    createdAt: source.createdAt,
    direction: 'outbound',
    channel: 'portal',
    deliveryState: 'recorded',
    sender: { displayName: 'Service team' },
  });
});

test('F063.1 the resident update page is a fixed server-side ceiling, not a caller-supplied size', () => {
  // A bearer credential must never be able to ask for an unbounded page, so
  // the ceiling is a fixed exported value rather than a request parameter.
  assert.equal(REQUESTER_UPDATE_PAGE_SIZE, 25);
  assert.ok(Number.isInteger(REQUESTER_UPDATE_PAGE_SIZE));
});

test('F063.1 the projection never carries an author display name through to a requester', () => {
  const projection = requesterCommunicationProjection({
    id: '10000000-0000-4000-8000-000000000002',
    body: 'Fictional correspondence',
    createdAt: '2026-09-21T12:00:00.000Z',
    direction: 'outbound',
    channel: 'portal',
    deliveryState: 'recorded',
  });
  assert.equal(projection.sender.displayName, 'Service team');
  const serialized = JSON.stringify(projection);
  for (const forbidden of [
    'author',
    'authorDisplayName',
    'author_display_name',
    'staffIdentityId',
    'author_staff_identity_id',
    'submission_key',
    'organization_id',
  ])
    assert.ok(
      !serialized.includes(forbidden),
      `${forbidden} must not reach a requester`,
    );
});
