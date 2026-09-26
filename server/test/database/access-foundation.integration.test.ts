import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import { permissions, type StaffAccess } from '../../src/auth/auth.types.js';
import { manageablePermissions } from '../../src/access/access-policy.js';
import { effectivePermissions } from '../../src/auth/effective-permissions.js';
import {
  changeManagedAccess,
  provisionAccessAdministrator,
  readAccessSnapshot,
  lockAccessState,
} from '../../src/access/access-foundation.js';
import {
  up,
  down,
} from '../../migrations/20261008000000-add-administrative-access-foundation.js';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';
import { changeDevelopmentStaffGrants } from '../../src/database/development-staff-grants.js';
import { developmentOrganization } from '../../src/database/development-staff-input.js';
import {
  provisionDevelopmentGeospatialGrant,
  revokeDevelopmentGeospatialGrant,
} from '../../src/database/development-geospatial-grant.js';

const url = process.env.TEST_DATABASE_URL;
function required<T>(value: T | undefined): T {
  assert.notEqual(value, undefined);
  return value as T;
}
test('F057 PostgreSQL security foundation', { skip: !url }, async (t) => {
  const schema = `access_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: url });
  await prepareDatabaseExtensions(admin);
  await admin.query(`create schema "${schema}"`);
  const pool = new Pool({
    connectionString: url,
    options: `-c search_path=${schema}`,
    max: 8,
  });
  const db = new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({ pool }),
  });
  const org = randomUUID(),
    org2 = randomUUID(),
    staff = randomUUID(),
    second = randomUUID(),
    third = randomUUID(),
    foreign = randomUUID(),
    tenant = randomUUID();
  const rev = async (o = org) =>
    required(
      (
        await sql<{
          revision: string;
        }>`select authorization_revision::text revision from organization_access_state where organization_id=${o}`.execute(
          db,
        )
      ).rows[0],
    ).revision;
  const count = async (table: string) =>
    required(
      (
        await sql<{
          n: string;
        }>`select count(*)::text n from ${sql.table(table)}`.execute(db)
      ).rows[0],
    ).n;
  const provision = async (
    id: string,
    operation: 'bootstrap' | 'add-manager' | 'remove-manager',
    extra: Partial<Parameters<typeof provisionAccessAdministrator>[1]> = {},
  ) =>
    provisionAccessAdministrator(db, {
      organizationId: org,
      staffId: id,
      expectedRevision: await rev(),
      expectedBootstrap: operation !== 'bootstrap',
      operation,
      dryRun: false,
      ...extra,
    });
  const actor: StaffAccess = {
    tenantId: tenant,
    objectId: staff,
    staffIdentityId: staff,
    organizationId: org,
    displayName: 'Synthetic',
    permissions: [
      'admin.configuration.read',
      'admin.access.read',
      'admin.access.manage',
    ],
    scopes: [],
    departmentIds: [],
    divisionIds: [],
    development: false,
  };
  const managed = async (id: string, keys: string[]) =>
    changeManagedAccess(db, actor, {
      staffId: id,
      expectedRevision: await rev(),
      permissions: keys,
    });
  try {
    const folder = path.resolve(__dirname, '../../migrations');
    for (const file of (await readdir(folder))
      .filter((f) => f.endsWith('.js'))
      .sort()) {
      const migration = (await import(
        pathToFileURL(path.join(folder, file)).href
      )) as { up: (d: Kysely<DatabaseSchema>) => Promise<void> };
      await db.transaction().execute((trx) => migration.up(trx));
    }
    await db
      .insertInto('permission')
      .values(permissions.map((permission_key) => ({ permission_key })))
      .onConflict((oc) => oc.column('permission_key').doNothing())
      .execute();
    await db
      .insertInto('organization')
      .values(
        [org, org2].map((id, i) => ({
          id,
          name: `F057 Synthetic ${String(i)}`,
          short_name: 'Test',
          slug: `f057-${id}`,
          status: 'active',
          default_business_timezone: 'UTC',
        })),
      )
      .execute();
    await db
      .insertInto('staff_identity')
      .values(
        [staff, second, third, foreign].map((id) => ({
          id,
          organization_id: id === foreign ? org2 : org,
          display_name: 'Synthetic test staff',
          email: null,
          active: true,
          entra_tenant_id: tenant,
          entra_object_id: id,
        })),
      )
      .execute();
    await t.test('migration zero grants, safe down and reapply', async () => {
      assert.equal(await count('role_permission'), '0');
      assert.deepEqual(await effectivePermissions(db, org, staff), []);
      await db.transaction().execute((trx) => down(trx));
      await db.transaction().execute((trx) => up(trx));
      assert.equal(await rev(), '0');
      assert.equal(await count('access_change_set'), '0');
    });
    await t.test(
      'dry-run is read-only and bootstrap expected state is strict',
      async () => {
        const before = await rev();
        const r = await provision(staff, 'bootstrap', { dryRun: true });
        assert.equal(r.changed, true);
        assert.equal(await count('role'), '0');
        assert.equal(await rev(), before);
        await assert.rejects(
          provision(staff, 'bootstrap', { expectedRevision: '999' }),
        );
        await assert.rejects(provision(foreign, 'bootstrap'));
      },
    );
    await t.test(
      'bootstrap atomically grants only prerequisites and increments once',
      async () => {
        const before = await rev();
        await provision(staff, 'bootstrap');
        assert.equal(await rev(), (BigInt(before) + 1n).toString());
        assert.deepEqual(await effectivePermissions(db, org, staff), [
          'admin.access.manage',
          'admin.access.read',
          'admin.configuration.read',
        ]);
        assert.equal(await count('access_change_set'), '1');
        assert.equal(await count('access_permission_delta'), '3');
      },
    );
    await t.test(
      'bootstrap no-op, stale retry and different-target conflict',
      async () => {
        const before = await rev();
        const a = await count('access_change_set');
        await provision(staff, 'bootstrap', { expectedBootstrap: true });
        assert.equal(await rev(), before);
        assert.equal(await count('access_change_set'), a);
        await assert.rejects(
          provision(second, 'bootstrap', { expectedBootstrap: true }),
        );
        await assert.rejects(
          provision(staff, 'bootstrap', { expectedRevision: '0' }),
        );
      },
    );
    await t.test(
      'last-manager removal and direct eligibility deactivation roll back',
      async () => {
        const before = await rev();
        await assert.rejects(provision(staff, 'remove-manager'));
        await assert.rejects(
          db
            .updateTable('staff_identity')
            .set({ active: false })
            .where('id', '=', staff)
            .execute(),
        );
        assert.equal(await rev(), before);
        assert.equal((await effectivePermissions(db, org, staff)).length, 3);
      },
    );
    await t.test(
      'add second manager then remove one retains one effective manager',
      async () => {
        await provision(second, 'add-manager');
        await provision(second, 'remove-manager');
        assert.deepEqual(await effectivePermissions(db, org, second), []);
        await provision(second, 'add-manager');
      },
    );
    await t.test(
      'owned operational grants need no actor possession and preserve locked contributions',
      async () => {
        await managed(third, ['service_request.view']);
        const shared = randomUUID();
        await db
          .insertInto('role')
          .values({
            id: shared,
            organization_id: org,
            name: `shared-${shared}`,
            description: null,
            active: true,
          })
          .execute();
        await db
          .insertInto('role_permission')
          .values({
            organization_id: org,
            role_id: shared,
            permission_key: 'service_request.view',
          })
          .execute();
        await db
          .insertInto('staff_role_assignment')
          .values({
            organization_id: org,
            staff_identity_id: third,
            role_id: shared,
            active: true,
          })
          .execute();
        await managed(third, []);
        const snapshot = await readAccessSnapshot(db, actor, third);
        assert.deepEqual(snapshot.owned, []);
        assert.deepEqual(snapshot.locked, ['service_request.view']);
        assert.deepEqual(snapshot.effective, ['service_request.view']);
        assert.equal('tenantId' in snapshot.staff, false);
      },
    );
    await t.test(
      'no-op owned save, absent empty save, strict body, self-edit, inactive and foreign targets',
      async () => {
        const before = await rev();
        await managed(third, []);
        assert.equal(await rev(), before);
        await assert.rejects(managed(staff, []));
        await assert.rejects(managed(foreign, []));
        await assert.rejects(
          changeManagedAccess(db, actor, {
            staffId: third,
            expectedRevision: before,
            permissions: [],
            actorId: staff,
          }),
        );
        await db
          .updateTable('staff_identity')
          .set({ active: false })
          .where('id', '=', third)
          .execute();
        await assert.rejects(managed(third, ['service_request.view']));
        await db
          .updateTable('staff_identity')
          .set({ active: true })
          .where('id', '=', third)
          .execute();
      },
    );
    await t.test(
      'unknown and provisioning-only keys rejected; dependencies validated',
      async () => {
        for (const key of [
          'unknown',
          'admin.access.read',
          'admin.access.manage',
          'geospatial.read',
          'ai.workspace.access',
          'ai.administration.access',
        ])
          await assert.rejects(managed(third, [key]));
        await assert.rejects(managed(third, ['catalog.issue_action.manage']));
        await managed(third, [
          'admin.configuration.read',
          'admin.issues.write',
          'catalog.issue_action.manage',
        ]);
      },
    );
    await t.test(
      'owned role cannot be shared, adopted, moved or contain direct unaudited permissions',
      async () => {
        const row = required(
          (
            await sql<{
              role_id: string;
            }>`select role_id from access_role_ownership where staff_identity_id=${third} and kind='operational'`.execute(
              db,
            )
          ).rows[0],
        );
        await assert.rejects(
          db
            .insertInto('staff_role_assignment')
            .values({
              organization_id: org,
              staff_identity_id: second,
              role_id: row.role_id,
              active: true,
            })
            .execute(),
        );
        for (const key of [
          'admin.access.read',
          'admin.access.manage',
          'geospatial.read',
          'ai.workspace.access',
          'ai.administration.access',
          'service_request.close',
        ])
          await assert.rejects(
            db
              .insertInto('role_permission')
              .values({
                organization_id: org,
                role_id: row.role_id,
                permission_key: key,
              })
              .execute(),
          );
        await assert.rejects(
          sql`insert into access_role_ownership(organization_id,staff_identity_id,role_id,kind,creation_txid) values(${org2},${foreign},${row.role_id},'operational',txid_current())`.execute(
            db,
          ),
        );
        const oldRole = randomUUID();
        await db
          .insertInto('role')
          .values({
            id: oldRole,
            organization_id: org,
            name: `f036-${oldRole}`,
            description: JSON.stringify({
              source: 'F036',
              permissions: [],
              memberships: [],
            }),
            active: true,
          })
          .execute();
        await assert.rejects(
          sql`insert into access_role_ownership(organization_id,staff_identity_id,role_id,kind,creation_txid) values(${org},${second},${oldRole},'operational',txid_current())`.execute(
            db,
          ),
        );
      },
    );
    await t.test(
      'append-only audit rejects update delete and truncate',
      async () => {
        for (const table of [
          'access_change_set',
          'access_permission_delta',
          'access_role_ownership',
        ]) {
          await assert.rejects(sql.raw(`delete from ${table}`).execute(db));
          await assert.rejects(
            sql.raw(`truncate ${table} cascade`).execute(db),
          );
        }
        await assert.rejects(
          sql`update access_change_set set correlation_id=gen_random_uuid()`.execute(
            db,
          ),
        );
        await assert.rejects(
          sql`update access_permission_delta set direction=direction`.execute(
            db,
          ),
        );
      },
    );
    await t.test(
      'bootstrap latch and revision cannot be directly rewritten',
      async () => {
        await assert.rejects(
          sql`update organization_access_state set bootstrap_established=false where organization_id=${org}`.execute(
            db,
          ),
        );
        await assert.rejects(
          sql`update organization_access_state set bootstrap_established=true where organization_id=${org2}`.execute(
            db,
          ),
        );
        await assert.rejects(
          sql`update organization_access_state set authorization_revision=999 where organization_id=${org}`.execute(
            db,
          ),
        );
      },
    );
    await t.test(
      'meaningful writes advance once; role metadata and no-op active writes do not',
      async () => {
        const before = await rev();
        await db.transaction().execute(async (trx) => {
          await trx
            .updateTable('staff_identity')
            .set({ active: false })
            .where('id', '=', third)
            .execute();
          await trx
            .updateTable('staff_identity')
            .set({ active: true })
            .where('id', '=', third)
            .execute();
        });
        assert.equal(await rev(), (BigInt(before) + 1n).toString());
        const after = await rev();
        await db
          .updateTable('staff_identity')
          .set({ active: true })
          .where('id', '=', third)
          .execute();
        assert.equal(await rev(), after);
      },
    );
    await t.test(
      'Organization deactivation allowed; reactivation without effective manager refused',
      async () => {
        await db
          .updateTable('organization')
          .set({ status: 'inactive' })
          .where('id', '=', org)
          .execute();
        await db
          .updateTable('staff_identity')
          .set({ active: false })
          .where('organization_id', '=', org)
          .execute();
        await assert.rejects(
          db
            .updateTable('organization')
            .set({ status: 'active' })
            .where('id', '=', org)
            .execute(),
        );
        await db.transaction().execute(async (trx) => {
          await trx
            .updateTable('staff_identity')
            .set({ active: true })
            .where('organization_id', '=', org)
            .execute();
          await trx
            .updateTable('organization')
            .set({ status: 'active' })
            .where('id', '=', org)
            .execute();
        });
      },
    );
    await t.test(
      'required audit failure rolls back grant and revision',
      async () => {
        await sql`create function fail_access_test() returns trigger language plpgsql as $$ begin raise exception 'Injected audit failure'; end $$;
        create trigger fail_access_test before insert on access_change_set for each row execute function fail_access_test()`.execute(
          db,
        );
        const before = await rev();
        const keys = await effectivePermissions(db, org, third);
        await assert.rejects(managed(third, ['service_request.view']));
        assert.equal(await rev(), before);
        assert.deepEqual(await effectivePermissions(db, org, third), keys);
        await sql`drop trigger fail_access_test on access_change_set;drop function fail_access_test()`.execute(
          db,
        );
      },
    );
    await t.test(
      'same-Organization competing manager removals cannot remove both',
      async () => {
        const expected = await rev();
        const results = await Promise.allSettled(
          [staff, second].map((staffId) =>
            provisionAccessAdministrator(db, {
              organizationId: org,
              staffId,
              expectedRevision: expected,
              expectedBootstrap: true,
              operation: 'remove-manager',
              dryRun: false,
            }),
          ),
        );
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        assert.equal(
          required(
            (
              await sql<{
                n: string;
              }>`select effective_access_managers(${org})::text n`.execute(db)
            ).rows[0],
          ).n,
          '1',
        );
        if (
          !(await effectivePermissions(db, org, staff)).includes(
            'admin.access.manage',
          )
        )
          await provision(staff, 'add-manager');
      },
    );
    await t.test(
      'different Organization lock does not wait for first Organization',
      async () => {
        let release!: () => void;
        let locked!: () => void;
        const ready = new Promise<void>((r) => {
          locked = r;
        });
        const wait = new Promise<void>((r) => {
          release = r;
        });
        const first = db.transaction().execute(async (trx) => {
          await lockAccessState(trx, org);
          locked();
          await wait;
        });
        await ready;
        try {
          await db.transaction().execute(async (trx) => {
            await sql`set local lock_timeout='500ms'`.execute(trx);
            await lockAccessState(trx, org2);
          });
        } finally {
          release();
          await first;
        }
      },
    );
    await t.test(
      'retained state refuses down without deleting history',
      async () => {
        const n = await count('access_change_set');
        await assert.rejects(db.transaction().execute((trx) => down(trx)));
        assert.equal(await count('access_change_set'), n);
      },
    );
    await t.test(
      'shared multi-role manager supports all contributing-writer last-admin protections',
      async () => {
        const roles = [randomUUID(), randomUUID(), randomUUID()];
        await db
          .insertInto('role')
          .values(
            roles.map((id) => ({
              id,
              organization_id: org2,
              name: `split-${id}`,
              description: null,
              active: true,
            })),
          )
          .execute();
        await db
          .insertInto('role_permission')
          .values(
            roles.map((role_id, i) => ({
              organization_id: org2,
              role_id,
              permission_key: required(
                [
                  'admin.configuration.read',
                  'admin.access.read',
                  'admin.access.manage',
                ][i],
              ),
            })),
          )
          .execute();
        await db
          .insertInto('staff_role_assignment')
          .values(
            roles.map((role_id) => ({
              organization_id: org2,
              staff_identity_id: foreign,
              role_id,
              active: true,
            })),
          )
          .execute();
        await provisionAccessAdministrator(db, {
          organizationId: org2,
          staffId: foreign,
          expectedRevision: await rev(org2),
          expectedBootstrap: false,
          operation: 'bootstrap',
          dryRun: false,
        });
        const managerRole = required(
          (
            await sql<{
              role_id: string;
            }>`select role_id from access_role_ownership where staff_identity_id=${foreign}`.execute(
              db,
            )
          ).rows[0],
        ).role_id;
        assert.equal(
          (
            await db
              .selectFrom('role_permission')
              .selectAll()
              .where('role_id', '=', managerRole)
              .execute()
          ).length,
          0,
        );
        for (const roleId of roles) {
          await assert.rejects(
            db
              .updateTable('role')
              .set({ active: false })
              .where('id', '=', roleId)
              .execute(),
          );
          await assert.rejects(
            db
              .deleteFrom('role_permission')
              .where('role_id', '=', roleId)
              .execute(),
          );
          await assert.rejects(
            db
              .updateTable('staff_role_assignment')
              .set({ active: false })
              .where('role_id', '=', roleId)
              .execute(),
          );
        }
        assert.equal(
          required(
            (
              await sql<{
                n: string;
              }>`select effective_access_managers(${org2})::text n`.execute(db)
            ).rows[0],
          ).n,
          '1',
        );
      },
    );
    await t.test(
      'direct concurrent deactivation reaches deferred invariant rather than relying on expected revision',
      async () => {
        await provision(second, 'add-manager');
        const outcomes = await Promise.allSettled(
          [staff, second].map((id) =>
            db.transaction().execute(async (trx) => {
              await lockAccessState(trx, org);
              await trx
                .updateTable('staff_identity')
                .set({ active: false })
                .where('id', '=', id)
                .execute();
            }),
          ),
        );
        assert.equal(
          outcomes.filter((r) => r.status === 'fulfilled').length,
          1,
        );
        assert.equal(
          required(
            (
              await sql<{
                n: string;
              }>`select effective_access_managers(${org})::text n`.execute(db)
            ).rows[0],
          ).n,
          '1',
        );
        await db
          .updateTable('staff_identity')
          .set({ active: true })
          .where('organization_id', '=', org)
          .execute();
      },
    );
    await t.test(
      'external membership writers invalidate once without changing scope interpretation',
      async () => {
        const departmentId = randomUUID(),
          divisionId = randomUUID();
        await db
          .insertInto('department')
          .values({
            id: departmentId,
            organization_id: org,
            name: 'Synthetic department',
            description: null,
            status: 'active',
            display_order: 1,
          })
          .execute();
        await db
          .insertInto('division')
          .values({
            id: divisionId,
            department_id: departmentId,
            organization_id: org,
            name: 'Synthetic division',
            description: null,
            status: 'active',
            display_order: 1,
          })
          .execute();
        const before = await rev();
        await db
          .insertInto('staff_division_membership')
          .values({
            organization_id: org,
            staff_identity_id: third,
            department_id: departmentId,
            division_id: divisionId,
            active: true,
          })
          .execute();
        assert.equal(await rev(), (BigInt(before) + 1n).toString());
        const snap = await readAccessSnapshot(db, actor, third);
        assert.equal(snap.departmentIds.length, 0);
        assert.equal(snap.divisions.length, 1);
        await db
          .insertInto('staff_department_membership')
          .values({
            organization_id: org,
            staff_identity_id: third,
            department_id: departmentId,
            active: true,
          })
          .execute();
        const current = await rev();
        await assert.rejects(
          changeManagedAccess(db, actor, {
            staffId: third,
            expectedRevision: before,
            permissions: [],
          }),
        );
        await db
          .updateTable('staff_department_membership')
          .set({ active: true })
          .where('staff_identity_id', '=', third)
          .execute();
        assert.equal(await rev(), current);
        await db
          .updateTable('department')
          .set({ status: 'inactive' })
          .where('id', '=', departmentId)
          .execute();
        assert.deepEqual(
          (await readAccessSnapshot(db, actor, third)).departmentIds,
          [departmentId],
        );
      },
    );
    await t.test(
      'F036 and F027 cooperate after Migration 38 and retain provenance and restoration semantics',
      async () => {
        const d = developmentOrganization,
          id = randomUUID(),
          dept = randomUUID();
        await db
          .insertInto('organization')
          .values({
            ...d,
            short_name: 'Synthetic',
            status: 'active',
            default_business_timezone: 'UTC',
          })
          .execute();
        await db
          .insertInto('staff_identity')
          .values({
            id,
            organization_id: d.id,
            display_name: 'Synthetic tooling staff',
            email: null,
            active: true,
            entra_tenant_id: tenant,
            entra_object_id: id,
          })
          .execute();
        await db
          .insertInto('department')
          .values({
            id: dept,
            organization_id: d.id,
            name: 'Synthetic tools',
            description: null,
            status: 'active',
            display_order: 1,
          })
          .execute();
        const input = {
          tenantId: tenant,
          staffId: id,
          organizationId: d.id,
          scopes: [{ departmentId: dept, divisionId: null }],
          permissions: [
            'service_request.view',
            'service_request.create',
          ] as const,
        };
        const before = await rev(d.id);
        await changeDevelopmentStaffGrants(
          db,
          { ...input, permissions: [...input.permissions] },
          'provision',
          false,
        );
        assert.equal(await rev(d.id), (BigInt(before) + 1n).toString());
        const after = await rev(d.id);
        await changeDevelopmentStaffGrants(
          db,
          { ...input, permissions: [...input.permissions] },
          'provision',
          false,
        );
        assert.equal(await rev(d.id), after);
        await changeDevelopmentStaffGrants(
          db,
          { ...input, permissions: ['service_request.create'] },
          'deprovision',
          false,
        );
        assert.deepEqual(await effectivePermissions(db, d.id, id), [
          'service_request.view',
        ]);
        await changeDevelopmentStaffGrants(
          db,
          { ...input, permissions: ['service_request.view'] },
          'deprovision',
          false,
        );
        assert.equal(
          (
            await db
              .selectFrom('staff_department_membership')
              .selectAll()
              .where('staff_identity_id', '=', id)
              .execute()
          ).length,
          0,
        );
        const grant = {
          tenantId: tenant,
          objectId: id,
          organizationId: d.id,
          grant: true,
        };
        await provisionDevelopmentGeospatialGrant(db, grant);
        assert.deepEqual(await effectivePermissions(db, d.id, id), [
          'geospatial.read',
        ]);
        await revokeDevelopmentGeospatialGrant(db, grant);
        assert.deepEqual(await effectivePermissions(db, d.id, id), []);
      },
    );
    await t.test(
      'failure injection at mutation stages is atomic including commit-time invariants',
      async () => {
        for (const table of [
          'role',
          'access_role_ownership',
          'role_permission',
          'staff_role_assignment',
          'organization_access_state',
          'access_change_set',
          'access_permission_delta',
        ]) {
          const id = randomUUID();
          await db
            .insertInto('staff_identity')
            .values({
              id,
              organization_id: org,
              display_name: 'Synthetic failure target',
              email: null,
              active: true,
              entra_tenant_id: tenant,
              entra_object_id: id,
            })
            .execute();
          const before = await rev(),
            audit = await count('access_change_set'),
            roles = await count('role');
          await sql
            .raw(
              `create function inject_access_failure() returns trigger language plpgsql as $$ begin raise exception 'Injected failure'; end $$; create trigger inject_access_failure before insert or update on ${table} for each row execute function inject_access_failure()`,
            )
            .execute(db);
          try {
            await assert.rejects(provision(id, 'add-manager'));
            assert.equal(await rev(), before);
            assert.equal(await count('access_change_set'), audit);
            assert.equal(await count('role'), roles);
          } finally {
            await sql
              .raw(
                `drop trigger inject_access_failure on ${table};drop function inject_access_failure()`,
              )
              .execute(db);
          }
        }
      },
    );
    await t.test(
      'actor revocation is re-resolved after Organization lock and cross-org reads deny',
      async () => {
        await assert.rejects(readAccessSnapshot(db, actor, foreign));
        await provision(staff, 'remove-manager');
        await assert.rejects(managed(third, []));
        await provision(staff, 'add-manager');
        await assert.rejects(
          changeManagedAccess(
            db,
            { ...actor, development: true },
            { staffId: third, expectedRevision: await rev(), permissions: [] },
          ),
        );
      },
    );
    await t.test(
      'database manageable restriction admits all 27 and rejects excluded keys even with matching audit',
      async () => {
        await managed(third, [...manageablePermissions]);
        const roleId = required(
          (
            await sql<{
              role_id: string;
            }>`select role_id from access_role_ownership where staff_identity_id=${third} and kind='operational'`.execute(
              db,
            )
          ).rows[0],
        ).role_id;
        assert.deepEqual(
          (
            await db
              .selectFrom('role_permission')
              .select('permission_key')
              .where('role_id', '=', roleId)
              .execute()
          )
            .map((r) => r.permission_key)
            .sort(),
          manageablePermissions,
        );
        for (const key of [
          'admin.access.read',
          'admin.access.manage',
          'geospatial.read',
          'ai.workspace.access',
          'ai.administration.access',
        ]) {
          await assert.rejects(
            db.transaction().execute(async (trx) => {
              const state = await lockAccessState(trx, org);
              const id = randomUUID();
              await sql`insert into access_change_set(id,organization_id,target_staff_id,role_id,actor_staff_id,source,operation,correlation_id,before_revision,after_revision,mutation_txid)
            values(${id},${org},${third},${roleId},${staff},'runtime','update_managed_access',${randomUUID()},${state.authorization_revision}::bigint,${state.authorization_revision}::bigint+1,txid_current())`.execute(
                trx,
              );
              await sql`insert into access_permission_delta values(${id},${key},'added')`.execute(
                trx,
              );
              await trx
                .insertInto('role_permission')
                .values({
                  organization_id: org,
                  role_id: roleId,
                  permission_key: key,
                })
                .execute();
            }),
            /not F057 manageable/,
          );
        }
        await managed(third, []);
      },
    );
    await t.test(
      'audit rejects wrong revision, foreign target, replayed children and incomplete transitions',
      async () => {
        const row = required(
          (
            await sql<{
              id: string;
              role_id: string;
            }>`select id,role_id from access_change_set where target_staff_id=${third} limit 1`.execute(
              db,
            )
          ).rows[0],
        );
        const insert = async (before: string, targetId: string) =>
          db.transaction().execute(async (trx) => {
            await lockAccessState(trx, org);
            await sql`insert into access_change_set(id,organization_id,target_staff_id,role_id,actor_staff_id,source,operation,correlation_id,before_revision,after_revision,mutation_txid)
          values(${randomUUID()},${org},${targetId},${row.role_id},${staff},'runtime','update_managed_access',${randomUUID()},${before}::bigint,${before}::bigint+1,txid_current())`.execute(
              trx,
            );
          });
        await assert.rejects(insert('999999', third), /revision mismatch/);
        await assert.rejects(insert(await rev(), foreign));
        await assert.rejects(
          insert(await rev(), third),
          /transition incomplete/,
        );
        await assert.rejects(
          sql`insert into access_permission_delta values(${row.id},'service_request.create','added')`.execute(
            db,
          ),
          /current transaction/,
        );
      },
    );
    await t.test(
      'fresh F036 provenance, pre-existing shared roles and duplicate ownership cannot be adopted',
      async () => {
        await assert.rejects(
          db.transaction().execute(async (trx) => {
            const id = randomUUID();
            await trx
              .insertInto('role')
              .values({
                id,
                organization_id: org,
                name: `synthetic-${id}`,
                description: JSON.stringify({
                  source: 'F036',
                  permissions: [],
                  memberships: [],
                }),
                active: true,
              })
              .execute();
            await sql`insert into access_role_ownership(organization_id,staff_identity_id,role_id,kind,creation_txid) values(${org},${second},${id},'operational',txid_current())`.execute(
              trx,
            );
          }),
          /prior provenance/,
        );
        await assert.rejects(
          db.transaction().execute(async (trx) => {
            const id = randomUUID();
            await trx
              .insertInto('role')
              .values({
                id,
                organization_id: org,
                name: `synthetic-${id}`,
                description: null,
                active: true,
              })
              .execute();
            await sql`insert into access_role_ownership(organization_id,staff_identity_id,role_id,kind,creation_txid) values(${org},${third},${id},'operational',txid_current())`.execute(
              trx,
            );
          }),
          /unique constraint/,
        );
      },
    );
    await t.test(
      'query plans and snapshots remain set-based with Organization/target index paths',
      async () => {
        for (const query of [
          sql`explain select * from organization_access_state where organization_id=${org}`,
          sql`explain select * from access_role_ownership where organization_id=${org} and staff_identity_id=${third} and kind='operational'`,
          sql`explain select id from access_change_set where organization_id=${org} and target_staff_id=${third} order by created_at desc,id limit 25`,
          sql`explain select effective_access_managers(${org})`,
        ]) {
          assert.ok((await query.execute(db)).rows.length > 0);
        }
        const hidden = await db
          .updateTable('staff_identity')
          .set({ active: false })
          .where('id', '=', third)
          .execute();
        assert.ok(hidden);
        assert.deepEqual(
          (await readAccessSnapshot(db, actor, third)).effective,
          [],
        );
        await db
          .updateTable('staff_identity')
          .set({ active: true })
          .where('id', '=', third)
          .execute();
      },
    );
    await t.test(
      'bootstrap is not a replacement command and absent empty ownership is a no-op',
      async () => {
        const before = await rev(),
          owners = await count('access_role_ownership');
        await managed(second, []);
        assert.equal(await rev(), before);
        assert.equal(await count('access_role_ownership'), owners);
        await assert.rejects(
          provision(second, 'bootstrap', { expectedBootstrap: true }),
          /already established/,
        );
      },
    );
    await t.test(
      'failure at bootstrap activation rolls back already-created role, grants, audit and revision',
      async () => {
        const organizationId = randomUUID(),
          staffId = randomUUID();
        await db
          .insertInto('organization')
          .values({
            id: organizationId,
            name: 'Synthetic bootstrap failure',
            short_name: 'Test',
            slug: `failure-${organizationId}`,
            status: 'active',
            default_business_timezone: 'UTC',
          })
          .execute();
        await db
          .insertInto('staff_identity')
          .values({
            id: staffId,
            organization_id: organizationId,
            display_name: 'Synthetic bootstrap failure',
            email: null,
            active: true,
            entra_tenant_id: tenant,
            entra_object_id: staffId,
          })
          .execute();
        const before = await rev(organizationId),
          roles = await count('role'),
          audits = await count('access_change_set');
        await sql`create function fail_bootstrap_activation() returns trigger language plpgsql as $$ begin raise exception 'Injected bootstrap activation failure'; end $$;
        create trigger fail_bootstrap_activation before update on organization_access_state for each row when(new.bootstrap_established and not old.bootstrap_established) execute function fail_bootstrap_activation()`.execute(
          db,
        );
        try {
          await assert.rejects(
            provisionAccessAdministrator(db, {
              organizationId,
              staffId,
              expectedRevision: before,
              expectedBootstrap: false,
              operation: 'bootstrap',
              dryRun: false,
            }),
            /bootstrap activation failure/,
          );
          assert.equal(await rev(organizationId), before);
          assert.equal(await count('role'), roles);
          assert.equal(await count('access_change_set'), audits);
          assert.deepEqual(
            await effectivePermissions(db, organizationId, staffId),
            [],
          );
        } finally {
          await sql`drop trigger fail_bootstrap_activation on organization_access_state;drop function fail_bootstrap_activation()`.execute(
            db,
          );
        }
      },
    );
  } finally {
    await db.destroy();
    await admin.query(`drop schema "${schema}" cascade`);
    await admin.end();
  }
});
