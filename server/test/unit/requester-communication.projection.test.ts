import assert from 'node:assert/strict';
import test from 'node:test';
import { requesterCommunicationProjection } from '../../src/service-request/requester-communication.projection.js';

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
