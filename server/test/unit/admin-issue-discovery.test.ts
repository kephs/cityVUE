import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { issueDiscoveryQuery } from '../../src/admin/admin-issue-discovery.service.js';
test('F056.1 query defaults, trim, Unicode and bounded allowlists', () => {
  assert.equal(issueDiscoveryQuery({}).pageSize, 25);
  assert.equal(
    issueDiscoveryQuery({ search: '  Café %_  ' }).search,
    'Café %_',
  );
  for (const size of [25, 50, 100, 250, 500])
    assert.equal(
      issueDiscoveryQuery({ pageSize: String(size) }).pageSize,
      size,
    );
  for (const query of [
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { page: '9007199254740992' },
    { pageSize: '501' },
    { pageSize: 'all' },
    { sort: 'name; drop table category' },
    { direction: 'sideways' },
    { status: 'deleted' },
    { requesterPolicy: 'anonymous' },
    { assignmentState: 'mine' },
    { category: 'not-a-uuid' },
    { search: 'x'.repeat(101) },
    { search: 'a\u0000b' },
  ])
    assert.throws(() => issueDiscoveryQuery(query));
});
