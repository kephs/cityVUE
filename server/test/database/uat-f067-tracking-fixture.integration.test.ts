import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
// The four `public`-qualified migrations are deliberately NOT imported here.
//
// An earlier attempt imported them so TypeScript would emit them into
// `dist-test/migrations`, which made the complete sequence loadable by a
// compiled in-process migrator. That directory is the SHARED
// `FileMigrationProvider` root for every schema-isolated suite, so making
// those four visible broke eleven of them: each creates `public`-qualified
// SECURITY DEFINER functions whose bodies read `public.<table>` under a fixed
// `search_path`, so run from a per-test schema they fail with
// `type "public.tenant_domain" does not exist`, or collide with
// `function "tenant_domain_lock_organization" already exists` once a second
// schema applies them.
//
// They are unnecessary now: migrations run through the real launcher under
// `tsx`, which reads the authoritative `migrations/` SOURCE directory and
// therefore discovers all sixty regardless of what the test build contains.
// A regression assertion below proves the shared inventory stays clear of
// them.
//
// No Migrator or FileMigrationProvider here either: migrations are run by the
// real launcher, so this file observes the result rather than reimplementing
// the mechanism under test.
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';
import {
  TEST_DATABASE,
  TEST_ROLE,
} from '../helpers/f0592-disposable-cluster.js';
import { effectivePermissionContributions } from '../../src/auth/effective-permissions.js';
import { RequestTrackingRepository } from '../../src/service-request/request-tracking.repository.js';
import {
  FIXTURE_PERMISSIONS,
  FIXTURE_REQUIREMENTS,
  censusTrackingUatFixture,
  evaluateFixtureCensus,
  evaluateFixtureTarget,
  fixtureUpdateKeys,
  provisionTrackingUatFixture,
  trackingUatFixture,
} from '../../src/database/uat-f067-tracking-fixture.js';

/**
 * F067 — the UAT fixture, proven against a real PostgreSQL schema.
 *
 * The unit suite proves every decision the fixture makes. What it cannot
 * prove is that the rows it writes satisfy sixty migrations' worth of CHECK
 * constraints, triggers, partial unique indexes and foreign keys, or that the
 * grant it creates is the one the authorization layer actually reads. That is
 * what this exercises.
 *
 * The disposable instance is supplied by `scripts/test-db-disposable.mjs`,
 * which created it through the approved cluster helper and verified its image
 * digest, nonce, ownership label, loopback binding and anonymous storage
 * before any test ran. Three facts reach this process out of band through the
 * environment — the connection string, the session nonce and the container ID
 * — so the nonce comparison here is genuinely out-of-band against in-band,
 * not a value read from the server and compared with itself.
 *
 * Every run creates its own schema inside that instance and applies the
 * migrations there and nowhere else. No credential is inserted: the resident
 * resolver is exercised for its fail-closed path, because issuing a tracking
 * credential is a separate authorization this test does not hold.
 *
 * All fixture data is fictional.
 */

const url = process.env.TEST_DATABASE_URL;
/** Placed in the environment by the runner from `docker run`, never read from
 * the server, so comparing it with the in-band setting proves identity. */
const sessionNonce = process.env.REQRO_DISPOSABLE_NONCE ?? '';
const sessionContainerId = process.env.REQRO_DISPOSABLE_CONTAINER_ID ?? '';

/**
 * This file runs from `dist-test/test/database`, so `__dirname` is compiled
 * output, not source. The migrator must read the COMPILED migrations, because
 * that is what it can import; anything read as TypeScript source has to be
 * resolved from the server root instead.
 */
const SERVER_ROOT = path.resolve(__dirname, '../../..');
const MIGRATION_FOLDER = path.resolve(__dirname, '../../migrations');
const SOURCE_MIGRATION_FOLDER = path.resolve(SERVER_ROOT, 'migrations');
const REQUIRED_MIGRATIONS = [
  '20261030000000-add-requester-intake-tracking-issuance',
  '20261031000000-add-submission-idempotency',
];
/**
 * The migrations that only work where `public` holds the tables. They must be
 * applied by this test and must never reach the shared compiled inventory that
 * the schema-isolated suites load.
 */
const PUBLIC_QUALIFIED_MIGRATIONS = [
  '20261018000000-harden-tenant-domain-functions',
  '20261019000000-harden-runtime-reference-locks',
  '20261023000000-add-integration-worker-function-api',
  '20261026000000-harden-integration-worker-claim-dispatch-api',
];

/**
 * The Organization and catalog the fixture builds on, matching what
 * `seed-development.ts` declares. The values are asserted against that file
 * below, so if the seeder changes this test fails rather than silently
 * validating the fixture against a catalog the real seeder would not produce.
 */
const SEED = {
  organizationId: '10000000-0000-4000-8000-000000000001',
  organizationName: 'CityVUE Development Municipality',
  organizationSlug: 'cityvue-development',
  timezone: 'America/New_York',
  departmentId: '20000000-0000-4000-8000-000000000001',
  categoryId: '30000000-0000-4000-8000-000000000001',
  serviceId: '40000000-0000-4000-8000-000000000001',
  versionId: '50000000-0000-4000-8000-000000000001',
  serviceKey: 'pothole',
  priority: 'medium',
  icon: 'cone-striped',
} as const;

test(
  'F067 disposable fixture provisioning against the real migrated schema',
  { skip: !url },
  async (t) => {
    assert.ok(url);
    /**
     * This test migrates the disposable database's own `public` schema rather
     * than a schema inside it.
     *
     * The per-test schema pattern the other suites use cannot carry the
     * complete sequence: four migrations create `public`-qualified
     * SECURITY DEFINER functions whose bodies read `public.<table>` under a
     * fixed `search_path`, so they only work where `public` holds the tables.
     * One of them, migration 49, creates `lock_staff`, which the staff
     * tracking endpoint calls on every request — so a schema-isolated run
     * cannot validate the schema this UAT actually needs.
     *
     * The container is the disposal boundary, which is what makes this safe:
     * the instance is verified disposable below and destroyed immediately
     * afterwards. The runner's schema census excludes `public`, so this leaks
     * no schema, and the other suites set `search_path` to their own schema,
     * so what lands here is not on their lookup path.
     */
    const schema = 'public';
    const admin = new Pool({ connectionString: url });
    try {
      await prepareDatabaseExtensions(admin);
    } catch (error) {
      await admin.end();
      throw error;
    }
    const pool = new Pool({ connectionString: url });
    const db = new Kysely<DatabaseSchema>({
      dialect: new PostgresDialect({ pool }),
    });

    try {
      // --- 1. destination identity, before any write ----------------------

      await t.test(
        'the connected instance is this session disposable one',
        async () => {
          const probe = await sql<{
            database: string;
            role: string;
            nonce: string | null;
            port: string;
          }>`select current_database() database, current_user role,
            current_setting('reqro.disposable_nonce', true) nonce,
            current_setting('port') port`.execute(db);
          const facts = probe.rows[0];
          assert.ok(facts);
          assert.equal(facts.database, TEST_DATABASE);
          assert.equal(facts.database, 'reqro_f0592_test');
          assert.equal(facts.role, TEST_ROLE);
          // The database is explicitly not a persistent one.
          assert.notEqual(facts.database, 'reqro_dev');
          assert.notEqual(facts.database, 'reqro_bootstrap');
          // In-band nonce against the out-of-band value from `docker run`.
          assert.ok(sessionNonce !== '', 'the runner supplied a session nonce');
          assert.equal(facts.nonce, sessionNonce);
          assert.ok(
            sessionContainerId !== '',
            'the runner supplied a container ID',
          );
          // The host endpoint is loopback and is not the native cluster.
          const parsed = new URL(url);
          assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname));
          assert.notEqual(parsed.port, '5432');
          assert.equal(parsed.pathname, `/${TEST_DATABASE}`);
          assert.equal(parsed.username, TEST_ROLE);
          // The server's own listening port is 5432 inside the container; the
          // published host port differs, which is what the URL must carry.
          assert.equal(facts.port, '5432');
        },
      );

      await t.test(
        'the fixture destination verdict accepts this target and rejects the persistent one',
        async () => {
          const probe = await sql<{
            database: string;
            role: string;
            nonce: string | null;
          }>`select current_database() database, current_user role,
            current_setting('reqro.disposable_nonce', true) nonce`.execute(db);
          const facts = probe.rows[0];
          assert.ok(facts);
          assert.equal(
            evaluateFixtureTarget({
              url,
              sqlDatabase: facts.database,
              sqlUser: facts.role,
              sqlNonce: facts.nonce,
              expectedNonce: sessionNonce,
              expectedRole: TEST_ROLE,
            }),
            null,
          );
          // The same live facts with a persistent target in the URL are refused.
          const refusal = evaluateFixtureTarget({
            url: url.replace(`/${TEST_DATABASE}`, '/reqro_dev'),
            sqlDatabase: facts.database,
            sqlUser: facts.role,
            sqlNonce: facts.nonce,
            expectedNonce: sessionNonce,
            expectedRole: TEST_ROLE,
          });
          assert.ok(refusal?.includes('reqro_dev'));
        },
      );

      // --- 2. the complete migration sequence -----------------------------

      let applied: string[] = [];
      await t.test(
        'the complete current migration sequence applies cleanly',
        async () => {
          // The authoritative inventory is the source directory, which is
          // what the launcher reads. The compiled test build is deliberately
          // not consulted for completeness here: it is shared with every
          // schema-isolated suite and must stay as it was.
          const declared = (await fs.readdir(SOURCE_MIGRATION_FOLDER))
            .filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts'))
            .map((name) => name.replace(/\.ts$/, ''))
            .sort();

          // The real launcher, not an in-process restatement of it. This is
          // the corrected mechanism: `tsx` over the `migrations/` SOURCE
          // directory, which is what makes all sixty discoverable and what
          // the orchestrator now spawns. Driving Kysely's Migrator here
          // instead would prove the provider works and leave the thing that
          // was actually broken untested.
          const spawned = spawnSync(
            process.execPath,
            [
              path.resolve(
                SERVER_ROOT,
                'node_modules',
                'tsx',
                'dist',
                'cli.mjs',
              ),
              'src/database/uat-f067-disposable-migration-cli.ts',
            ],
            {
              cwd: SERVER_ROOT,
              encoding: 'utf8',
              timeout: 900_000,
              env: {
                ...process.env,
                REQRO_F067_UAT_DATABASE_URL: url,
                REQRO_F067_UAT_DISPOSABLE_NONCE: sessionNonce,
                REQRO_F067_UAT_DISPOSABLE_ROLE: TEST_ROLE,
              },
            },
          );
          const stdout = spawned.stdout;
          // No connection string may appear in what the launcher prints.
          assert.ok(!stdout.includes('postgresql://'), 'launcher leaked a URL');
          const reportLine = stdout.trim().split('\n').pop() ?? '';
          let report: {
            ok: boolean;
            appliedCount: number;
            declaredCount: number;
            applied: string[];
            reasons: string[];
          };
          try {
            report = JSON.parse(reportLine) as typeof report;
          } catch {
            assert.fail(
              `the launcher produced no readable report (status ${String(spawned.status)}): ${spawned.stderr.slice(0, 400)}`,
            );
          }
          assert.deepEqual(report.reasons, []);
          assert.equal(report.ok, true);
          assert.equal(spawned.status, 0);
          assert.equal(report.declaredCount, 60);
          assert.equal(report.appliedCount, 60);
          applied = report.applied;
          // The launcher's own claim, checked against the database's record of
          // what ran, so a truthful report and a real schema are both proven.
          const history = await sql<{ name: string }>`
            select name from kysely_migration order by name
          `.execute(db);
          assert.deepEqual(
            history.rows.map((row) => row.name),
            declared,
          );
          assert.deepEqual([...applied].sort(), declared);
          for (const required of REQUIRED_MIGRATIONS)
            assert.ok(applied.includes(required), required);
          assert.equal(applied.length, declared.length);
          // The absolute count, so a migration deleted from the repository is
          // as visible as one that failed to apply.
          assert.equal(declared.length, 60);
          // The four that a per-test schema can never carry, applied here
          // because this test migrates the disposable database's own `public`
          // schema through the source-reading launcher.
          for (const required of PUBLIC_QUALIFIED_MIGRATIONS)
            assert.ok(applied.includes(required), required);
        },
      );

      await t.test(
        'the shared compiled migration inventory is left untouched',
        async () => {
          // The regression this guards. `dist-test/migrations` is the shared
          // FileMigrationProvider root for every schema-isolated suite, and
          // the four `public`-qualified migrations must never appear in it:
          // run from a per-test schema they fail outright, and once a second
          // schema applies them they collide in `public`. Completeness for
          // F067 comes from the source directory instead, which is why this
          // test needs nothing from the shared build.
          const compiled = (await fs.readdir(MIGRATION_FOLDER))
            .filter((name) => name.endsWith('.js'))
            .map((name) => name.replace(/\.js$/, ''));
          for (const excluded of PUBLIC_QUALIFIED_MIGRATIONS)
            assert.ok(
              !compiled.includes(excluded),
              `${excluded} must not reach the shared compiled inventory`,
            );
          // And the launcher still applied all sixty regardless.
          assert.equal(applied.length, 60);
        },
      );

      await t.test(
        'the row-lock helpers the staff tracking endpoint calls exist',
        async () => {
          // Migration 49 moves every runtime row lock into an owner-owned
          // SECURITY DEFINER helper. `RequestTrackingService.parent` calls
          // `lockStaff` on every staff tracking request, so without these the
          // endpoint cannot serve a credential operation at all. This is the
          // concrete reason the complete sequence matters for F067.
          const functions = await sql<{ proname: string }>`
            select p.proname from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'lock\\_%'
            order by p.proname
          `.execute(db);
          const names = functions.rows.map((row) => row.proname);
          for (const required of [
            'lock_active_category',
            'lock_active_department',
            'lock_active_division',
            'lock_assignment_target',
            'lock_department',
            'lock_division',
            'lock_staff',
          ])
            assert.ok(names.includes(required), required);
          // The tenant-domain and category-identity guards from the same pair
          // of hardening migrations.
          const guards = await sql<{ proname: string }>`
            select p.proname from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('tenant_domain_lock_organization','protect_category_identity')
          `.execute(db);
          assert.equal(guards.rows.length, 2);
        },
      );

      await t.test(
        'the tracking schema elements the F067 endpoint depends on exist',
        async () => {
          const column = async (table: string, name: string) =>
            (
              await sql<{ present: boolean }>`select exists(
              select 1 from information_schema.columns
              where table_schema=${schema} and table_name=${table} and column_name=${name}
            ) present`.execute(db)
            ).rows[0]?.present === true;
          // The column whose absence made `reqro_dev` unusable for this UAT.
          assert.equal(
            await column('request_tracking_credential', 'expires_at'),
            true,
          );
          assert.equal(
            await column('request_tracking_credential', 'issuer_type'),
            true,
          );
          assert.equal(
            await column('request_tracking_policy', 'credential_lifetime_days'),
            true,
          );
          assert.equal(await column('service_request', 'audience'), true);
          assert.equal(
            await column('request_communication', 'delivery_state'),
            true,
          );
          const tables = await sql<{
            tablename: string;
          }>`select tablename from pg_tables where schemaname=${schema} order by tablename`.execute(
            db,
          );
          const names = tables.rows.map((row) => row.tablename);
          for (const required of [
            'service_request',
            'request_communication',
            'request_internal_note',
            'request_tracking_credential',
            'request_tracking_policy',
            'service_request_reference_config',
            'service_request_reference_sequence',
          ])
            assert.ok(names.includes(required), required);
        },
      );

      // --- 3. the seeded Organization and catalog -------------------------

      await t.test(
        'the test catalog matches what seed:development declares',
        () => {
          const seed = readFileSync(
            path.resolve(SERVER_ROOT, 'src/database/seed-development.ts'),
            'utf8',
          );
          for (const value of [
            SEED.organizationId,
            SEED.organizationName,
            SEED.organizationSlug,
            SEED.timezone,
            SEED.departmentId,
            SEED.categoryId,
            SEED.serviceKey,
            SEED.icon,
          ])
            assert.ok(seed.includes(value), value);
          // The seeder publishes the version and points the definition at it.
          assert.ok(seed.includes("status: 'published'"));
          assert.ok(seed.includes('current_published_version_id: versionId'));
        },
      );

      await t.test(
        'the Organization insert creates its tracking policy by trigger',
        async () => {
          await db
            .insertInto('organization')
            .values({
              id: SEED.organizationId,
              name: SEED.organizationName,
              short_name: 'Development',
              slug: SEED.organizationSlug,
              status: 'active',
              default_business_timezone: SEED.timezone,
            })
            .execute();
          // F065 backfills existing tenants and triggers for new ones. The
          // Organization is created after the migration, so this exercises the
          // trigger rather than the backfill.
          const policy = await db
            .selectFrom('request_tracking_policy')
            .select('credential_lifetime_days')
            .where('organization_id', '=', SEED.organizationId)
            .executeTakeFirst();
          assert.ok(policy, 'the trigger created a tracking policy row');
          assert.equal(policy.credential_lifetime_days, 180);
        },
      );

      await t.test(
        'the catalog the fixture resolves is present and published',
        async () => {
          await db
            .insertInto('department')
            .values({
              id: SEED.departmentId,
              organization_id: SEED.organizationId,
              name: 'Public Works',
              description: 'Synthetic development department.',
              status: 'active',
              display_order: 0,
            })
            .execute();
          await db
            .insertInto('category')
            .values({
              id: SEED.categoryId,
              organization_id: SEED.organizationId,
              department_id: SEED.departmentId,
              division_id: null,
              name: 'Roads & Streets',
              description: 'Road surfaces, signs, and street conditions.',
              icon_key: 'signpost-split',
              aliases: [],
              keywords: [],
              status: 'active',
              display_order: 1,
            })
            .execute();
          await db
            .insertInto('service_definition')
            .values({
              id: SEED.serviceId,
              organization_id: SEED.organizationId,
              category_id: SEED.categoryId,
              service_key: SEED.serviceKey,
              availability: 'INTERNAL_AND_EXTERNAL',
              status: 'active',
              current_published_version_id: null,
            })
            .execute();
          await db
            .insertInto('service_definition_version')
            .values({
              id: SEED.versionId,
              organization_id: SEED.organizationId,
              service_definition_id: SEED.serviceId,
              version_number: 1,
              name: 'Pothole',
              resident_description:
                'Report a hole or broken pavement in a public roadway.',
              icon_key: SEED.icon,
              aliases: [],
              keywords: [],
              default_priority: SEED.priority,
              location_policy: 'required',
              geographic_eligibility_mode: 'no_geographic_restriction',
              anonymous_reporting_policy: 'allowed',
              status: 'published',
              published_at: new Date('2026-09-02T00:00:00Z'),
              routing_metadata: null,
            })
            .execute();
          await db
            .updateTable('service_definition')
            .set({ current_published_version_id: SEED.versionId })
            .where('id', '=', SEED.serviceId)
            .execute();
          const resolved = await db
            .selectFrom('service_definition as definition')
            .innerJoin('service_definition_version as version', (join) =>
              join
                .onRef(
                  'version.id',
                  '=',
                  'definition.current_published_version_id',
                )
                .onRef(
                  'version.organization_id',
                  '=',
                  'definition.organization_id',
                ),
            )
            .select(['version.status', 'version.default_priority'])
            .where('definition.service_key', '=', SEED.serviceKey)
            .executeTakeFirst();
          assert.equal(resolved?.status, 'published');
          assert.equal(resolved.default_priority, SEED.priority);
        },
      );

      // --- 4. fixture run one ---------------------------------------------

      const provision = () =>
        db.transaction().execute((trx) =>
          provisionTrackingUatFixture(trx, {
            url,
            expectedNonce: sessionNonce,
            expectedRole: TEST_ROLE,
          }),
        );

      let first: Awaited<ReturnType<typeof provision>>;
      await t.test(
        'the first fixture run provisions every required record',
        async () => {
          first = await provision();
          assert.equal(first.changed, true);
          assert.equal(first.plan.referenceAllocations, 2);
          assert.equal(first.credentialsIssued, 0);
          assert.equal(first.staffAuthenticated, false);
          assert.deepEqual(evaluateFixtureCensus(first.census), {
            ok: true,
            reasons: [],
          });
          assert.equal(
            first.census.publicRequestsWithUpdates,
            FIXTURE_REQUIREMENTS.publicRequestsWithUpdates,
          );
          assert.equal(
            first.census.publicRequestsWithoutUpdates,
            FIXTURE_REQUIREMENTS.publicRequestsWithoutUpdates,
          );
          assert.equal(
            first.census.residentVisibleUpdates,
            FIXTURE_REQUIREMENTS.residentVisibleUpdates,
          );
          assert.equal(first.census.trackingManageGrants, 1);
          assert.equal(first.census.staffIdentities, 1);
        },
      );

      await t.test(
        'the two PUBLIC requests carry valid catalog relationships and lifecycle values',
        async () => {
          const rows = await db
            .selectFrom('service_request')
            .selectAll()
            .where('organization_id', '=', SEED.organizationId)
            .orderBy('id')
            .execute();
          assert.equal(rows.length, 2);
          for (const row of rows) {
            assert.equal(row.audience, 'public');
            assert.equal(row.status, 'open');
            assert.equal(row.priority, SEED.priority);
            assert.equal(row.reporting_identity, 'anonymous');
            assert.equal(row.intake_channel, 'web');
            assert.equal(row.category_id, SEED.categoryId);
            assert.equal(row.service_definition_id, SEED.serviceId);
            assert.equal(row.service_definition_version_id, SEED.versionId);
            assert.equal(row.submitted_by_staff_identity_id, null);
            assert.equal(row.requester_staff_identity_id, null);
            assert.equal(row.requester_staff_identity_id, null);
            assert.equal(row.routed_department_id, null);
            assert.equal(row.requester_id, null);
            assert.equal(row.requester_geography_state, 'NOT_COLLECTED');
            assert.equal(row.participation_area_id, null);
            assert.equal(row.revision, 1);
          }
          assert.deepEqual(
            rows.map((row) => row.id).sort(),
            trackingUatFixture.requests.map((request) => request.id).sort(),
          );
        },
      );

      await t.test(
        'the allocated references satisfy the database format and uniqueness constraints',
        async () => {
          const rows = await db
            .selectFrom('service_request')
            .select(['id', 'reference_number'])
            .orderBy('reference_number')
            .execute();
          const references = rows.map((row) => row.reference_number);
          assert.equal(new Set(references).size, 2);
          for (const reference of references) {
            assert.match(reference, /^SR-[0-9]{4}(0[1-9]|1[0-2])-[0-9]{6}$/);
            assert.match(reference, /^[A-Z0-9]+(-[A-Z0-9]+)*$/);
            assert.ok(reference.length <= 48);
          }
          // The allocator advanced its own per-period counter exactly twice.
          const sequence = await db
            .selectFrom('service_request_reference_sequence')
            .select(['period_key', 'last_value'])
            .execute();
          assert.equal(sequence.length, 1);
          assert.equal(Number(sequence[0]?.last_value), 2);
          // The reference is immutable, which is what makes it safe to quote.
          await assert.rejects(
            db
              .updateTable('service_request')
              .set({ reference_number: 'SR-209901-000009' })
              .where('id', '=', trackingUatFixture.requests[0].id)
              .execute(),
            /immutable/i,
          );
        },
      );

      await t.test(
        'every required relational row exists for both requests',
        async () => {
          for (const request of trackingUatFixture.requests) {
            const location = await db
              .selectFrom('location')
              .select(['entered_address', 'location_type'])
              .where('service_request_id', '=', request.id)
              .executeTakeFirst();
            assert.equal(location?.entered_address, request.enteredAddress);
            assert.equal(location.location_type, 'entered_address');
            const activity = await db
              .selectFrom('activity')
              .select(['activity_type', 'actor_type', 'staff_identity_id'])
              .where('service_request_id', '=', request.id)
              .execute();
            assert.equal(activity.length, 1);
            assert.equal(activity[0]?.activity_type, 'service_request_created');
            assert.equal(activity[0].actor_type, 'anonymous_resident');
            assert.equal(activity[0].staff_identity_id, null);
            const operational = await db
              .selectFrom('request_operational_activity')
              .select([
                'activity_type',
                'actor_type',
                'request_revision',
                'intake_channel',
              ])
              .where('service_request_id', '=', request.id)
              .execute();
            assert.equal(operational.length, 1);
            assert.equal(operational[0]?.activity_type, 'request_created');
            assert.equal(operational[0].actor_type, 'anonymous_resident');
            assert.equal(operational[0].request_revision, 1);
            assert.equal(operational[0].intake_channel, 'web');
          }
        },
      );

      // --- 5. resident-visible correspondence -----------------------------

      await t.test(
        'resident-visible updates are correctly classified and ordered',
        async () => {
          const withUpdates = trackingUatFixture.requests.find(
            (request) => request.updates.length > 0,
          );
          const withoutUpdates = trackingUatFixture.requests.find(
            (request) => request.updates.length === 0,
          );
          assert.ok(withUpdates && withoutUpdates);
          const resident = async (requestId: string) =>
            db
              .selectFrom('request_communication')
              .select(['id', 'body', 'submission_key', 'created_at'])
              .where('organization_id', '=', SEED.organizationId)
              .where('service_request_id', '=', requestId)
              .where('direction', '=', 'outbound')
              .where('channel', '=', 'portal')
              .where('delivery_state', '=', 'recorded')
              .orderBy('created_at', 'desc')
              .orderBy('id', 'desc')
              .execute();
          const visible = await resident(withUpdates.id);
          assert.equal(visible.length, withUpdates.updates.length);
          assert.equal((await resident(withoutUpdates.id)).length, 0);
          // Newest first, with strictly increasing stored timestamps, so the
          // resident timeline has an unambiguous latest update.
          const times = visible.map((row) =>
            new Date(row.created_at).getTime(),
          );
          assert.ok(times[0] !== undefined && times[1] !== undefined);
          assert.ok(times[0] > times[1]);
          assert.deepEqual(
            [...visible].map((row) => row.submission_key).sort(),
            withUpdates.updates.map((update) => update.submissionKey).sort(),
          );
          // Correspondence is append-only, as the resident projection assumes.
          await assert.rejects(
            db
              .updateTable('request_communication')
              .set({ body: 'rewritten' })
              .where('id', '=', visible[0]?.id ?? '')
              .execute(),
            /append-only/i,
          );
        },
      );

      await t.test(
        'an internal note is never admitted as a resident-visible update',
        async () => {
          await db
            .insertInto('request_internal_note')
            .values({
              organization_id: SEED.organizationId,
              service_request_id: trackingUatFixture.requests[0].id,
              author_staff_identity_id: trackingUatFixture.staffId,
              author_display_name: trackingUatFixture.staffDisplayName,
              submission_key: randomUUID(),
              body: 'Synthetic internal note. Must never reach a resident.',
              created_at: new Date(),
            })
            .execute();
          const notes = await db
            .selectFrom('request_internal_note')
            .select('id')
            .execute();
          assert.equal(notes.length, 1);
          // The resident projection reads request_communication only, so the
          // note changes no resident-visible count.
          const visible = await db
            .selectFrom('request_communication')
            .select('id')
            .where('direction', '=', 'outbound')
            .where('channel', '=', 'portal')
            .where('delivery_state', '=', 'recorded')
            .execute();
          assert.equal(
            visible.length,
            FIXTURE_REQUIREMENTS.residentVisibleUpdates,
          );
        },
      );

      await t.test(
        'the resident resolver is fail-closed and reports no credential',
        async () => {
          const repository = new RequestTrackingRepository();
          await db.transaction().execute(async (trx) => {
            // No credential exists, so no digest can resolve. This is the whole
            // resident entry point: without issuance there is no resident data.
            assert.equal(await repository.resolve(trx, 'a'.repeat(64)), null);
            assert.equal(await repository.resolve(trx, 'f'.repeat(64)), null);
            for (const request of trackingUatFixture.requests) {
              const state = await repository.state(
                trx,
                SEED.organizationId,
                request.id,
              );
              assert.equal(state.status, 'not_issued');
              assert.equal(state.version, null);
              assert.equal(state.expiresAt, null);
              assert.equal(state.expired, false);
            }
            assert.equal(
              await repository.lifetimeDays(trx, SEED.organizationId),
              180,
            );
          });
          const credentials = await db
            .selectFrom('request_tracking_credential')
            .select('id')
            .execute();
          assert.equal(credentials.length, 0);
        },
      );

      // --- 6. effective staff authorization -------------------------------

      await t.test(
        'the synthetic staff identity holds exactly the two required permissions',
        async () => {
          const staff = await db
            .selectFrom('staff_identity')
            .selectAll()
            .where('id', '=', trackingUatFixture.staffId)
            .executeTakeFirst();
          assert.ok(staff);
          assert.equal(staff.active, true);
          assert.equal(staff.display_name, trackingUatFixture.staffDisplayName);
          // Unauthenticated by construction: no Entra binding is fabricated.
          assert.equal(staff.entra_object_id, null);
          assert.equal(staff.entra_tenant_id, null);
          const role = await db
            .selectFrom('role')
            .selectAll()
            .where('id', '=', trackingUatFixture.roleId)
            .executeTakeFirst();
          assert.equal(role?.active, true);
          assert.equal(role.name, trackingUatFixture.roleName);
          assert.ok(
            role.access_creation_txid !== null,
            'the role creation trigger stamped it',
          );
          const assignment = await db
            .selectFrom('staff_role_assignment')
            .selectAll()
            .where('role_id', '=', trackingUatFixture.roleId)
            .execute();
          assert.equal(assignment.length, 1);
          assert.equal(assignment[0]?.active, true);
          assert.equal(
            assignment[0].staff_identity_id,
            trackingUatFixture.staffId,
          );
          // The real effective-permission query, not a restatement of it.
          const contributions = await effectivePermissionContributions(
            db,
            SEED.organizationId,
          )
            .where(
              'assignment.staff_identity_id',
              '=',
              trackingUatFixture.staffId,
            )
            .execute();
          const keys = [
            ...new Set(contributions.map((row) => row.permission_key)),
          ].sort();
          assert.deepEqual(keys, [...FIXTURE_PERMISSIONS].sort());
          assert.ok(keys.includes('service_request.view'));
          assert.ok(keys.includes('service_request.tracking.manage'));
          // No administrative or issuance authority anywhere in the tenant.
          for (const key of keys) assert.ok(!key.startsWith('admin.'), key);
          const everyGrant = await db
            .selectFrom('role_permission')
            .select('permission_key')
            .execute();
          assert.deepEqual(
            [...new Set(everyGrant.map((row) => row.permission_key))].sort(),
            [...FIXTURE_PERMISSIONS].sort(),
          );
          // The fixture role is not owned, so no access change set was forged.
          const ownership = await db
            .selectFrom('access_role_ownership')
            .select('role_id')
            .execute();
          assert.equal(ownership.length, 0);
          const changeSets = await db
            .selectFrom('access_change_set')
            .select('id')
            .execute();
          assert.equal(changeSets.length, 0);
        },
      );

      // --- 7. idempotency --------------------------------------------------

      await t.test(
        'the second fixture run changes nothing and allocates no reference',
        async () => {
          const before = await db
            .selectFrom('service_request')
            .select(['id', 'reference_number', 'created_at'])
            .orderBy('id')
            .execute();
          const second = await provision();
          assert.equal(second.changed, false);
          assert.equal(second.plan.referenceAllocations, 0);
          assert.equal(second.plan.createStaff, false);
          assert.equal(second.plan.createRole, false);
          assert.equal(second.plan.createAssignment, false);
          assert.equal(second.plan.grantPermissions.length, 0);
          assert.equal(second.plan.createRequests.length, 0);
          assert.equal(second.plan.createUpdates.length, 0);
          assert.deepEqual(second.references, {});
          // The census is identical across both runs.
          assert.deepEqual(second.census, first.census);
          assert.deepEqual(evaluateFixtureCensus(second.census), {
            ok: true,
            reasons: [],
          });
          // No duplicate rows anywhere, and the identities are unchanged.
          const after = await db
            .selectFrom('service_request')
            .select(['id', 'reference_number', 'created_at'])
            .orderBy('id')
            .execute();
          assert.deepEqual(
            after.map((row) => [row.id, row.reference_number]),
            before.map((row) => [row.id, row.reference_number]),
          );
          const counts = await sql<{
            requests: number;
            updates: number;
            assignments: number;
            grants: number;
            staff: number;
            roles: number;
            locations: number;
            activities: number;
            operational: number;
            sequences: number;
          }>`select
            (select count(*)::int from service_request) requests,
            (select count(*)::int from request_communication) updates,
            (select count(*)::int from staff_role_assignment) assignments,
            (select count(*)::int from role_permission) grants,
            (select count(*)::int from staff_identity) staff,
            (select count(*)::int from role) roles,
            (select count(*)::int from location) locations,
            (select count(*)::int from activity) activities,
            (select count(*)::int from request_operational_activity) operational,
            (select coalesce(max(last_value),0)::int from service_request_reference_sequence) sequences
          `.execute(db);
          assert.deepEqual(counts.rows[0], {
            requests: 2,
            updates: fixtureUpdateKeys().length,
            assignments: 1,
            grants: FIXTURE_PERMISSIONS.length,
            staff: 1,
            roles: 1,
            locations: 2,
            activities: 2,
            operational: 2,
            // Unchanged: the second run allocated nothing.
            sequences: 2,
          });
        },
      );

      await t.test(
        'an inactive role assignment is reactivated in place against the real primary key',
        async () => {
          // The assignment's primary key is (staff_identity_id, role_id), so
          // an inactive row occupies the key an insert would need. Before the
          // F3 correction the plan read only active rows, called the
          // assignment absent and attempted that insert.
          await db
            .updateTable('staff_role_assignment')
            .set({ active: false })
            .where('role_id', '=', trackingUatFixture.roleId)
            .execute();
          const effectiveBefore = await effectivePermissionContributions(
            db,
            SEED.organizationId,
          ).execute();
          assert.equal(effectiveBefore.length, 0, 'the grant is gone');

          const repaired = await provision();
          assert.equal(repaired.changed, true);
          assert.equal(repaired.plan.createAssignment, false);
          assert.equal(repaired.plan.reactivateAssignment, true);
          // Nothing was duplicated and no permission was added.
          assert.equal(repaired.plan.grantPermissions.length, 0);
          assert.equal(repaired.plan.referenceAllocations, 0);
          const assignments = await db
            .selectFrom('staff_role_assignment')
            .selectAll()
            .execute();
          assert.equal(assignments.length, 1);
          assert.equal(assignments[0]?.active, true);
          assert.equal(
            assignments[0].staff_identity_id,
            trackingUatFixture.staffId,
          );
          const grants = await db
            .selectFrom('role_permission')
            .select('permission_key')
            .execute();
          assert.equal(grants.length, FIXTURE_PERMISSIONS.length);
          // The effective grant is restored, and readiness follows.
          const effectiveAfter = await effectivePermissionContributions(
            db,
            SEED.organizationId,
          ).execute();
          assert.ok(
            effectiveAfter.some(
              (row) => row.permission_key === 'service_request.tracking.manage',
            ),
          );
          assert.equal(repaired.census.trackingManageGrants, 1);
          assert.deepEqual(evaluateFixtureCensus(repaired.census), {
            ok: true,
            reasons: [],
          });
          // And a further run settles back to a no-op.
          const settled = await provision();
          assert.equal(settled.changed, false);
          assert.equal(settled.plan.reactivateAssignment, false);
        },
      );

      await t.test(
        'readiness measures persisted state, not the run that wrote it',
        async () => {
          const census = () =>
            db.transaction().execute((trx) => censusTrackingUatFixture(trx));
          // A read-only census of the provisioned database is ready.
          assert.deepEqual(evaluateFixtureCensus(await census()), {
            ok: true,
            reasons: [],
          });

          // Deactivating the role assignment removes the effective grant while
          // leaving every row in place. Readiness must follow the database.
          await db
            .updateTable('staff_role_assignment')
            .set({ active: false })
            .where('role_id', '=', trackingUatFixture.roleId)
            .execute();
          const degraded = await census();
          assert.equal(degraded.trackingManageGrants, 0);
          // The requests and updates are untouched, so only the grant is short.
          assert.equal(
            degraded.residentVisibleUpdates,
            FIXTURE_REQUIREMENTS.residentVisibleUpdates,
          );
          const refusal = evaluateFixtureCensus(degraded);
          assert.equal(refusal.ok, false);
          assert.deepEqual(refusal.reasons, [
            'expected at least 1 trackingManageGrants, got 0',
          ]);
          // The real authorization query agrees: no effective grant remains.
          const none = await effectivePermissionContributions(
            db,
            SEED.organizationId,
          ).execute();
          assert.equal(none.length, 0);

          // Reactivating restores it, so the measurement tracks both directions.
          await db
            .updateTable('staff_role_assignment')
            .set({ active: true })
            .where('role_id', '=', trackingUatFixture.roleId)
            .execute();
          assert.deepEqual(evaluateFixtureCensus(await census()), {
            ok: true,
            reasons: [],
          });
          const restored = await effectivePermissionContributions(
            db,
            SEED.organizationId,
          ).execute();
          assert.ok(
            restored.some(
              (row) => row.permission_key === 'service_request.tracking.manage',
            ),
          );
        },
      );
    } finally {
      // Connections only. `public` is deliberately NOT dropped: dropping it
      // would remove the shared pgcrypto installation and the schema itself
      // from a database other suites still hold connections to. The migrated
      // tables are discarded with the container, which the runner removes and
      // then positively verifies absent.
      await db.destroy().catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  },
);
