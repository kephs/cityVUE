import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type Driver,
  type DatabaseConnection,
  type CompiledQuery,
  type QueryResult,
} from 'kysely';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import type { StaffAccess } from '../../src/auth/auth.types.js';
import { ResidentExperienceRepository } from '../../src/resident-experience/resident-experience.repository.js';
import { ResidentExperienceService } from '../../src/resident-experience/resident-experience.service.js';
import { residentFixture } from '../helpers/resident-experience.fixture.js';

const access: StaffAccess = {
  organizationId: randomUUID(),
  staffIdentityId: randomUUID(),
  tenantId: randomUUID(),
  objectId: randomUUID(),
  displayName: 'Synthetic',
  scopes: [],
  permissions: ['admin.configuration.read'],
  departmentIds: [],
  divisionIds: [],
  development: false,
};

/** SQL recording double: proves transaction commands and query scope, not PostgreSQL constraints. */
class RecordingDriver implements Driver, DatabaseConnection {
  queries: CompiledQuery[] = [];
  transactions: string[] = [];
  failEvent = false;
  emptyResource = false;
  emptyActor = false;
  emptyRevision = false;
  existingDraft = false;
  revisionId = randomUUID();
  async init() {
    /* No external connection in this recording double. */
  }
  async acquireConnection() {
    return this;
  }
  async beginTransaction() {
    this.transactions.push('begin');
  }
  async commitTransaction() {
    this.transactions.push('commit');
  }
  async rollbackTransaction() {
    this.transactions.push('rollback');
  }
  async releaseConnection() {
    /* Nothing is pooled. */
  }
  async destroy() {
    /* No external resources. */
  }
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    yield { rows: [] };
  }
  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    this.queries.push(query);
    const statement = query.sql;
    let rows: unknown[] = [];
    if (
      statement.startsWith('insert into "resident_experience_event"') &&
      this.failEvent
    )
      throw new Error('Injected event failure');
    if (statement.includes('from "organization"'))
      rows = [{ id: access.organizationId }];
    else if (statement.includes('from "organization_access_state"'))
      rows = [{ organization_id: access.organizationId }];
    else if (statement.includes('from "staff_identity"'))
      rows = this.emptyActor
        ? []
        : [{ id: access.staffIdentityId, display_name: 'Fresh identity' }];
    else if (statement.includes('from "organization_resident_experience"'))
      rows = this.emptyResource
        ? []
        : [
            {
              organization_id: access.organizationId,
              revision: 1,
              draft_revision_id: this.existingDraft ? this.revisionId : null,
              published_revision_id: null,
            },
          ];
    else if (statement.includes('from "resident_experience_revision"'))
      rows = this.emptyRevision
        ? []
        : [{ schema_version: 1, presentation: residentFixture().presentation }];
    else if (statement.includes('from "resident_experience_action"'))
      rows = residentFixture().actions.map((a) => ({
        logical_id: a.id,
        enabled: a.enabled,
        display_order: a.order,
        icon_key: a.iconKey,
        title: a.title,
        description: a.description,
        cta_label: a.ctaLabel,
        action_type: a.actionType,
        target: a.target,
        contact_id: a.contactId,
        tone: a.tone,
      }));
    else if (statement.includes('from "resident_experience_benefit"'))
      rows = residentFixture().benefits.map((b) => ({
        logical_id: b.id,
        enabled: b.enabled,
        display_order: b.order,
        icon_key: b.iconKey,
        title: b.title,
        description: b.description,
      }));
    return { rows: rows as R[], numAffectedRows: 1n };
  }
}
function setup() {
  const driver = new RecordingDriver();
  const db = new Kysely<DatabaseSchema>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (database) => new PostgresIntrospector(database),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  const repository = new ResidentExperienceRepository(db);
  const service = new ResidentExperienceService(repository, async (fresh) => {
    assert.equal(fresh.displayName, 'Fresh identity');
    assert.deepEqual(fresh.permissions, []); // Must not authorize with stale caller permissions.
  });
  return { driver, db, repository, service };
}
function writes(driver: RecordingDriver) {
  return driver.queries.filter((q) => /^(insert|update|delete)/.test(q.sql));
}

test('F059.2 draft save locks, re-resolves identity, writes complete revision and event before commit', async () => {
  const { driver, db, service } = setup();
  try {
    const result = await service.saveDraft(
      access,
      { expectedRevision: 1, snapshot: residentFixture() },
      randomUUID(),
    );
    assert.equal(result.revision, 2);
    assert.equal(result.changed, true);
    assert.deepEqual(driver.transactions, ['begin', 'commit']);
    const statements = driver.queries.map((q) => q.sql);
    assert.ok(statements[0]?.includes('for share'));
    assert.ok(
      statements
        .find((q) => q.includes('organization_access_state'))
        ?.includes('for share'),
    );
    assert.ok(
      statements
        .find((q) => q.includes('from "organization_resident_experience"'))
        ?.includes('for update'),
    );
    assert.equal(writes(driver).length, 5); // revision, actions, benefits, pointer, event
    const event = writes(driver).at(-1);
    assert.ok(event);
    assert.ok(event.sql.includes('resident_experience_event'));
    assert.ok(event.parameters.includes(access.organizationId));
    assert.ok(event.parameters.includes(access.staffIdentityId));
    assert.ok(event.parameters.includes(result.draftRevisionId));
    assert.ok(!event.parameters.includes(JSON.stringify(residentFixture())));
    const pointer = writes(driver).find((q) => q.sql.startsWith('update'));
    assert.ok(pointer);
    assert.ok(pointer.sql.includes('"organization_id" ='));
    assert.ok(pointer.sql.includes('"revision" ='));
    assert.ok(!pointer.sql.includes('"published_revision_id" ='));
  } finally {
    await db.destroy();
  }
});
test('F059.2 event failure requests rollback and never commit', async () => {
  const { driver, db, service } = setup();
  driver.failEvent = true;
  try {
    await assert.rejects(
      () =>
        service.saveDraft(
          access,
          { expectedRevision: 1, snapshot: residentFixture() },
          randomUUID(),
        ),
      /Injected event failure/,
    );
    assert.deepEqual(driver.transactions, ['begin', 'rollback']);
  } finally {
    await db.destroy();
  }
});
test('F059.2 stale save returns 409 without writes or retry', async () => {
  const { driver, db, service } = setup();
  try {
    await assert.rejects(
      () =>
        service.saveDraft(
          access,
          { expectedRevision: 2, snapshot: residentFixture() },
          randomUUID(),
        ),
      ConflictException,
    );
    assert.deepEqual(writes(driver), []);
    assert.deepEqual(driver.transactions, ['begin', 'rollback']);
  } finally {
    await db.destroy();
  }
});
test('F059.2 no configured policy denies save even with existing admin read permission', async () => {
  const { driver, db, repository } = setup();
  try {
    await assert.rejects(
      () =>
        new ResidentExperienceService(repository).saveDraft(
          access,
          { expectedRevision: 1, snapshot: residentFixture() },
          randomUUID(),
        ),
      ForbiddenException,
    );
    assert.deepEqual(writes(driver), []);
  } finally {
    await db.destroy();
  }
});
test('F059.2 no-op checks authority but appends no history or new revision', async () => {
  const { driver, db, service } = setup();
  driver.existingDraft = true;
  try {
    const result = await service.saveDraft(
      access,
      { expectedRevision: 1, snapshot: residentFixture() },
      randomUUID(),
    );
    assert.equal(result.changed, false);
    assert.deepEqual(writes(driver), []);
  } finally {
    await db.destroy();
  }
});
test('F059.2 missing or cross-Organization actor fails before content access', async () => {
  const { driver, db, service } = setup();
  driver.emptyActor = true;
  try {
    await assert.rejects(
      () =>
        service.saveDraft(
          access,
          { expectedRevision: 1, snapshot: residentFixture() },
          randomUUID(),
        ),
      ForbiddenException,
    );
    assert.deepEqual(writes(driver), []);
    assert.ok(
      !driver.queries.some((q) => q.sql.includes('resident_experience')),
    );
  } finally {
    await db.destroy();
  }
});
test('F059.2 repository reads bind Organization on every parent/child query in one snapshot', async () => {
  const { driver, db, repository } = setup();
  try {
    assert.deepEqual(
      await repository.getRevision(access.organizationId, driver.revisionId),
      residentFixture(),
    );
    assert.deepEqual(driver.transactions, ['begin', 'commit']);
    for (const q of driver.queries.filter((q) =>
      q.sql.includes('resident_experience'),
    )) {
      assert.ok(q.sql.includes('"organization_id" ='));
      assert.ok(q.parameters.includes(access.organizationId));
      if (!q.sql.includes('organization_resident_experience'))
        assert.ok(q.parameters.includes(driver.revisionId));
    }
    driver.emptyRevision = true;
    await assert.rejects(
      () => repository.getRevision(access.organizationId, randomUUID()),
      /Not Found/,
    );
  } finally {
    await db.destroy();
  }
});
test('F059.2 malformed command rejects before database access', async () => {
  const { driver, db, service } = setup();
  try {
    for (const command of [
      null,
      {},
      { expectedRevision: 0, snapshot: residentFixture() },
      {
        expectedRevision: 1,
        snapshot: residentFixture(),
        organizationId: randomUUID(),
      },
    ])
      await assert.rejects(() =>
        service.saveDraft(access, command, randomUUID()),
      );
    await assert.rejects(() =>
      service.saveDraft(
        access,
        { expectedRevision: 1, snapshot: residentFixture() },
        'forged',
      ),
    );
    assert.deepEqual(driver.queries, []);
  } finally {
    await db.destroy();
  }
});
