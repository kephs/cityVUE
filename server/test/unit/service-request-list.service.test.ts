import assert from 'node:assert/strict';
import test from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { ListServiceRequestsService } from '../../src/service-request/list-service-requests.service.js';

const row = {
  id: '80000000-0000-4000-8000-000000000001',
  reference_number: 'SR-202609-000001',
  issue_name: 'Pothole',
  category_id: '30000000-0000-4000-8000-000000000001',
  category_name: 'Roads',
  department_id: '20000000-0000-4000-8000-000000000001',
  department_name: 'Public Works',
  division_id: null,
  division_name: null,
  status: 'open',
  priority: 'high',
  created_at: new Date('2026-09-02T12:00:00Z'),
  updated_at: new Date('2026-09-02T12:00:00Z'),
  revision: 1,
};
function service(enabled = true) {
  const calls: unknown[] = [];
  const config = {
    get: (key: string) =>
      key === 'catalog.developmentOrganizationId'
        ? '10000000-0000-4000-8000-000000000001'
        : enabled,
  };
  const repository = {
    listForOrganization: async (...args: unknown[]) => {
      calls.push(args);
      return { rows: [row], total: 1 };
    },
  };
  return {
    subject: new ListServiceRequestsService(
      config as never,
      { client: {} } as never,
      repository as never,
    ),
    calls,
  };
}
test('normalizes list options, scopes by backend Organization, and maps only safe row fields', async () => {
  const { subject, calls } = service();
  const result = await subject.execute({ search: '  pothole  ' });
  assert.equal(result.total, 1);
  assert.equal(result.items[0]?.issueName, 'Pothole');
  assert.equal('description' in (result.items[0] as object), false);
  assert.equal('requester' in (result.items[0] as object), false);
  const args = calls[0] as unknown[];
  assert.equal(args[1], '10000000-0000-4000-8000-000000000001');
  assert.deepEqual(args[2], {
    search: 'pothole',
    sort: 'newest',
    page: 1,
    pageSize: 25,
  });
});
test('fails closed while development reads are disabled', async () => {
  const { subject } = service(false);
  await assert.rejects(() => subject.execute({}), NotFoundException);
});
