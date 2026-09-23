import assert from 'node:assert/strict';
import test from 'node:test';
import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import { validateDefaultAssignment } from '../../src/service-request/issue-default-assignment.js';
import { developmentIssueDefault } from '../../src/database/development-issue-default.js';

test('F048 None and canonical target types accept only bounded revisions and UUID identities', () => {
  const id = '10000000-0000-4000-8000-000000000001';
  validateDefaultAssignment({ expectedRevision: 0, target: null });
  for (const type of ['staff', 'role', 'group'] as const)
    validateDefaultAssignment({ expectedRevision: 10, target: { type, id } });
  for (const expectedRevision of [-1, 0.5, NaN, 2147483647])
    assert.throws(() => {
      validateDefaultAssignment({ expectedRevision, target: null });
    });
  for (const type of ['team', 'email', 'department', 'STAFF', 'none'])
    assert.throws(() => {
      validateDefaultAssignment({
        expectedRevision: 0,
        target: { type: type as 'staff', id },
      });
    });
  for (const invalid of [
    'person@example.test',
    'Fictional Team',
    "' OR true",
    'not-a-uuid',
  ])
    assert.throws(() => {
      validateDefaultAssignment({
        expectedRevision: 0,
        target: { type: 'staff', id: invalid },
      });
    });
});

test('F048 development configuration rejects foreign Organization and implicit identity before database use', async () => {
  const db = {} as Kysely<DatabaseSchema>;
  await assert.rejects(
    developmentIssueDefault(
      db,
      { organizationId: 'foreign', tenantId: '', staffId: '', issueId: '' },
      false,
    ),
  );
  await assert.rejects(
    developmentIssueDefault(
      db,
      {
        organizationId: '10000000-0000-4000-8000-000000000001',
        tenantId: '',
        staffId: '',
        issueId: '',
      },
      true,
    ),
  );
});
