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
import type { DatabaseService } from '../../src/database/database.service.js';
import type { StaffAccess } from '../../src/auth/auth.types.js';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';
import { AlertsRepository } from '../../src/alerts/alerts.repository.js';
import { AlertsService } from '../../src/alerts/alerts.service.js';
import { CatalogRepository } from '../../src/catalog/catalog.repository.js';
import { CatalogService } from '../../src/catalog/catalog.service.js';
import { ParticipationService } from '../../src/service-request/participation.service.js';
import { ServiceRequestRepository } from '../../src/service-request/service-request.repository.js';
import { ListServiceRequestsService } from '../../src/service-request/list-service-requests.service.js';
import { GetServiceRequestDetailsService } from '../../src/service-request/get-service-request-details.service.js';
import { ResidentExperienceRepository } from '../../src/resident-experience/resident-experience.repository.js';
import { PublicResidentExperienceService } from '../../src/resident-experience/resident-experience.public.service.js';
import { RequestTrackingRepository } from '../../src/service-request/request-tracking.repository.js';
import { trackingDigest } from '../../src/service-request/request-tracking.domain.js';

/** ADR-025 Slice 1b-B. Two Organizations, entirely synthetic, proving that a
 * resident context for A never reaches B's data and that staff authority is
 * not widened by any request context. */
test(
  'cross-tenant isolation across resident and staff authority',
  { skip: !process.env.TEST_DATABASE_URL && 'TEST_DATABASE_URL missing' },
  async (t) => {
    const testUrl = process.env.TEST_DATABASE_URL;
    assert.ok(testUrl);
    const url = new URL(testUrl);
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
    assert.equal(url.pathname, '/reqro_f0592_test');
    assert.equal(decodeURIComponent(url.username), 'reqro_test_user');
    const admin = new Pool({ connectionString: testUrl });
    const schema = `cross_tenant_${randomUUID().replaceAll('-', '')}`;
    let db: Kysely<DatabaseSchema> | undefined,
      created = false;
    try {
      assert.deepEqual(
        (await admin.query('select current_database() db,current_user usr'))
          .rows,
        [{ db: 'reqro_f0592_test', usr: 'reqro_test_user' }],
      );
      await prepareDatabaseExtensions(admin);
      await admin.query(`create schema "${schema}"`);
      created = true;
      db = new Kysely<DatabaseSchema>({
        dialect: new PostgresDialect({
          pool: new Pool({
            connectionString: testUrl,
            options: `-c search_path=${schema}`,
            max: 8,
          }),
        }),
      });
      const database = db;
      const folder = path.resolve(__dirname, '../../migrations');
      for (const file of (await readdir(folder))
        .filter((name) => name.endsWith('.js'))
        .sort()) {
        const migration = (await import(
          pathToFileURL(path.join(folder, file)).href
        )) as { up: (db: Kysely<DatabaseSchema>) => Promise<void> };
        await database.transaction().execute(migration.up);
      }

      /** Seeds one complete, independent Organization. */
      async function seed(label: string) {
        const org = randomUUID(),
          department = randomUUID(),
          category = randomUUID(),
          service = randomUUID(),
          version = randomUUID(),
          request = randomUUID(),
          area = randomUUID(),
          staffIdentity = randomUUID(),
          credential = `${label}-tracking-credential-000000000000`;
        await database
          .insertInto('organization')
          .values({
            id: org,
            name: `Synthetic ${label}`,
            short_name: label,
            slug: `${label}-${org}`,
            status: 'active',
            default_business_timezone: 'UTC',
          })
          .execute();
        await database
          .insertInto('department')
          .values({
            id: department,
            organization_id: org,
            name: `${label} Works`,
            description: null,
            status: 'active',
            display_order: 1,
          })
          .execute();
        await database
          .insertInto('category')
          .values({
            id: category,
            organization_id: org,
            department_id: department,
            division_id: null,
            name: `${label} Roads`,
            description: `${label} roads`,
            icon_key: 'road',
            status: 'active',
            display_order: 1,
            aliases: [],
            keywords: [],
          })
          .execute();
        await database
          .insertInto('service_definition')
          .values({
            id: service,
            organization_id: org,
            category_id: category,
            service_key: `${label}-pothole`,
            status: 'active',
            availability: 'INTERNAL_AND_EXTERNAL',
            current_published_version_id: null,
          })
          .execute();
        await database
          .insertInto('service_definition_version')
          .values({
            id: version,
            organization_id: org,
            service_definition_id: service,
            version_number: 1,
            name: `${label} Pothole`,
            resident_description: `${label} pothole`,
            icon_key: 'road',
            aliases: [],
            keywords: [],
            default_priority: 'medium',
            location_policy: 'optional',
            geographic_eligibility_mode: 'no_geographic_restriction',
            geographic_eligibility_policy_reference: null,
            anonymous_reporting_policy: 'allowed',
            status: 'published',
            published_at: new Date('2026-10-01T00:00:00Z'),
            routing_metadata: null,
          })
          .execute();
        // The published pointer is set after the version exists, because each
        // references the other.
        await database
          .updateTable('service_definition')
          .set({ current_published_version_id: version })
          .where('id', '=', service)
          .execute();
        await database
          .insertInto('staff_identity')
          .values({
            id: staffIdentity,
            organization_id: org,
            entra_tenant_id: randomUUID(),
            entra_object_id: randomUUID(),
            display_name: `${label} operator`,
            email: null,
            active: true,
          })
          .execute();
        await database
          .insertInto('resident_alert')
          .values({
            id: randomUUID(),
            organization_id: org,
            type: 'notice',
            severity: 'info',
            title: `${label} alert`,
            message: `${label} alert body`,
            link_url: null,
            link_label: null,
            starts_at: new Date('2026-10-01T00:00:00Z'),
            expires_at: null,
            published_at: new Date('2026-10-01T00:00:00Z'),
            is_active: true,
            deactivated_at: null,
          } as never)
          .execute();
        await database
          .updateTable('organization')
          .set({ service_participation_collection_enabled: true })
          .where('id', '=', org)
          .execute();
        await database
          .insertInto('participation_area')
          .values({
            id: area,
            organization_id: org,
            display_name: `${label} Area`,
          })
          .execute();
        await database
          .insertInto('service_request')
          .values({
            id: request,
            organization_id: org,
            reference_number: `SR-2026-${label.toUpperCase()}-0001`,
            service_definition_id: service,
            service_definition_version_id: version,
            category_id: category,
            status: 'open',
            priority: 'medium',
            description: `${label} confidential description`,
            reporting_identity: 'anonymous',
            audience: 'public',
          })
          .execute();
        await database
          .insertInto('request_tracking_credential')
          .values({
            organization_id: org,
            service_request_id: request,
            credential_digest: trackingDigest(credential),
            status: 'active',
            created_by_staff_identity_id: staffIdentity,
          } as never)
          .execute();
        return { org, category, service, version, request, area, credential };
      }

      const a = await seed('alpha');
      const b = await seed('bravo');

      const service = { client: database } as DatabaseService;
      const alerts = new AlertsService(new AlertsRepository(service));
      const catalog = new CatalogService(new CatalogRepository(service));
      const participation = new ParticipationService(service, {
        get: () => undefined,
      } as never);
      const residentExperienceRepository = new ResidentExperienceRepository(
        database,
      );
      const residentExperience = new PublicResidentExperienceService(
        residentExperienceRepository,
        { logger: { error: () => undefined } } as never,
      );
      const requests = new ServiceRequestRepository();
      const enabled = {
        get: (key: string) =>
          key === 'serviceRequestReads.developmentEnabled' ? true : undefined,
      } as never;
      const list = new ListServiceRequestsService(enabled, service, requests);
      const details = new GetServiceRequestDetailsService(
        enabled,
        service,
        requests,
      );
      const tracking = new RequestTrackingRepository();
      const staff = (organizationId: string): StaffAccess =>
        ({
          tenantId: randomUUID(),
          objectId: randomUUID(),
          staffIdentityId: randomUUID(),
          organizationId,
          displayName: 'Synthetic staff',
          scopes: [],
          permissions: ['service_request.view'],
          departmentIds: [],
          divisionIds: [],
          development: true,
        }) as unknown as StaffAccess;

      await t.test('alerts never cross Organizations', async () => {
        const alpha = await alerts.listActive(a.org);
        const bravo = await alerts.listActive(b.org);

        assert.equal(alpha.length, 1);
        assert.equal(bravo.length, 1);
        assert.equal(alpha[0]?.title, 'alpha alert');
        assert.equal(bravo[0]?.title, 'bravo alert');
        assert.equal(JSON.stringify(alpha).includes('bravo'), false);
        assert.equal(JSON.stringify(bravo).includes('alpha'), false);
      });

      await t.test(
        'catalog configuration never crosses Organizations',
        async () => {
          const categories = await catalog.listCategories(a.org);
          assert.deepEqual(
            categories.map((entry) => entry.name),
            ['alpha Roads'],
          );
          // B's category identifier is not a selector: asking A for it yields
          // nothing rather than B's content.
          assert.deepEqual(await catalog.listIssues(a.org, b.category), []);
          const alphaIssues = await catalog.listIssues(a.org, a.category);
          assert.deepEqual(
            alphaIssues.map((entry) => entry.name),
            ['alpha Pothole'],
          );
          // A published issue of B cannot be loaded through A's context.
          await assert.rejects(
            catalog.getIssueForOrganization(a.org, b.service),
          );
        },
      );

      await t.test(
        'participation areas never cross Organizations',
        async () => {
          const alpha = await participation.areas(a.org);
          const bravo = await participation.areas(b.org);

          assert.equal(alpha.collectionEnabled, true);
          assert.deepEqual(
            alpha.items.map((entry) => entry.label),
            ['alpha Area'],
          );
          assert.deepEqual(
            bravo.items.map((entry) => entry.label),
            ['bravo Area'],
          );
        },
      );

      await t.test(
        'resident experience reads are Organization scoped',
        async () => {
          // Neither Organization has published, and neither read can observe the
          // other's resource row.
          assert.deepEqual(await residentExperience.getPublished(a.org), {
            schemaVersion: 1,
            configuration: null,
          });
          assert.deepEqual(await residentExperience.getPublished(b.org), {
            schemaVersion: 1,
            configuration: null,
          });
        },
      );

      await t.test(
        'staff reads are bounded by identity Organization',
        async () => {
          const alpha = await list.execute({}, staff(a.org));
          assert.equal(alpha.total, 1);
          assert.equal(alpha.items[0]?.referenceNumber, 'SR-2026-ALPHA-0001');

          // Staff of A asking for B's request id gets nothing, because the
          // Organization predicate comes from identity, not from the path.
          await assert.rejects(details.execute(b.request, staff(a.org)));
          const own = await details.execute(a.request, staff(a.org));
          assert.equal(
            own.serviceRequest.referenceNumber,
            'SR-2026-ALPHA-0001',
          );
          assert.equal(
            JSON.stringify(await list.execute({}, staff(a.org))).includes(
              'bravo',
            ),
            false,
          );
        },
      );

      await t.test(
        'a tracking credential resolves only its own Organization request',
        async () => {
          const alpha = await database
            .transaction()
            .execute((trx) =>
              tracking.resolve(trx, trackingDigest(a.credential)),
            );
          assert.ok(alpha);
          assert.equal(alpha.reference, 'SR-2026-ALPHA-0001');
          assert.equal(JSON.stringify(alpha).includes('bravo'), false);

          const bravo = await database
            .transaction()
            .execute((trx) =>
              tracking.resolve(trx, trackingDigest(b.credential)),
            );
          assert.ok(bravo);
          assert.equal(bravo.reference, 'SR-2026-BRAVO-0001');

          // An unknown credential resolves nothing rather than falling back.
          assert.equal(
            await database
              .transaction()
              .execute((trx) =>
                tracking.resolve(trx, trackingDigest('absent')),
              ),
            null,
          );
        },
      );

      await t.test(
        'an inactive Organization stops serving resident data',
        async () => {
          await sql`update organization set status='inactive' where id=${b.org}::uuid`.execute(
            database,
          );
          // The resolver already refuses an inactive Organization, and the
          // tracking lookup independently requires an active one.
          assert.equal(
            await database
              .transaction()
              .execute((trx) =>
                tracking.resolve(trx, trackingDigest(b.credential)),
              ),
            null,
          );
          await sql`update organization set status='active' where id=${b.org}::uuid`.execute(
            database,
          );
        },
      );
    } finally {
      if (db) await db.destroy();
      if (created) {
        assert.match(schema, /^cross_tenant_[a-f0-9]{32}$/);
        await admin.query(`drop schema "${schema}" cascade`);
      }
      await admin.end();
    }
  },
);
