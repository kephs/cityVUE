import { up as questionsUp } from '../../migrations/20261006000000-extend-dynamic-question-types.js';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { ConfigService } from '@nestjs/config';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import type { DatabaseService } from '../../src/database/database.service.js';
import type { StaffAccess, Permission } from '../../src/auth/auth.types.js';
import type { AppConfiguration } from '../../src/config/configuration.js';
import type { AdminIssueService } from '../../src/admin/admin-issue.service.js';
import type {
  IssueChange,
  IssueCreate,
} from '../../src/admin/admin-issue.domain.js';
import { CreateServiceRequestService } from '../../src/service-request/create-service-request.service.js';
import { ServiceRequestRepository } from '../../src/service-request/service-request.repository.js';
import {
  up,
  down,
} from '../../migrations/20261007000000-govern-issue-availability.js';

export async function governedAvailabilityChecks(
  t: TestContext,
  db: Kysely<DatabaseSchema>,
  service: AdminIssueService,
  access: StaffAccess,
  create: IssueCreate,
  otherOrg: string,
) {
  await db.transaction().execute(questionsUp);
  const org = access.organizationId;
  const snapshot = async (tables: string[]) =>
    Promise.all(
      tables.map(
        async (table) =>
          (
            await sql`select to_jsonb(x) as row from ${sql.table(table)} x order by to_jsonb(x)::text`.execute(
              db,
            )
          ).rows,
      ),
    );
  const configuration = [
    'service_definition',
    'service_definition_version',
    'issue_configuration_audit',
    'issue_action_history',
    'issue_action_audit',
    'issue_requester_identity_policy',
    'issue_default_assignment',
  ];
  await t.test(
    'governed migration up/down/reapply preserves values, history and permissions',
    async () => {
      const before = await snapshot([
        'service_definition',
        'permission',
        'role_permission',
      ]);
      await db.transaction().execute(up);
      await db.transaction().execute(down);
      await db.transaction().execute(up);
      assert.deepEqual(
        await snapshot(['service_definition', 'permission', 'role_permission']),
        before,
      );
    },
  );
  const item = (
    await service.create(access, {
      ...create,
      name: 'Fictional governed availability',
      availability: 'INTERNAL_AND_EXTERNAL',
      locationPolicy: 'optional',
      questions: [
        {
          key: null,
          prompt: 'Fictional detail',
          help: '',
          type: 'short_text',
          required: true,
          order: 0,
          options: [],
        },
      ],
    })
  ).issue;
  const id = item.id;
  assert.ok(item.catalogVersionId);
  const body = async (): Promise<IssueChange> => {
    const i = (await service.detail(access, id)).issue;
    return {
      name: i.name,
      description: i.description,
      displayOrder: i.displayOrder,
      requesterPolicy: i.requesterPolicy as IssueChange['requesterPolicy'],
      defaultAssignment: null,
      active: i.active,
      expectedCoreRevision: i.coreRevision,
      expectedActionRevision: i.actionRevision,
      expectedPolicyRevision: i.policyRevision,
      expectedAssignmentRevision: i.assignmentRevision,
    };
  };
  const creator = (repository = new ServiceRequestRepository()) =>
    new CreateServiceRequestService(
      { get: () => org } as unknown as ConfigService<AppConfiguration, true>,
      { client: db } as DatabaseService,
      repository,
      {
        execute: async () => ({
          result: 'eligible',
          policyType: 'no_geographic_restriction',
          validatedAt: new Date(),
          providerKey: 'development',
          providerReference: null,
          reasonCode: 'development_match',
        }),
      } as never,
    );
  const creatorAccess = {
    ...access,
    permissions: [
      ...access.permissions,
      'service_request.create',
      'service_request.create_internal',
    ] as Permission[],
  };
  await service.change(access, id, { ...(await body()), active: true });
  const question = await db
    .selectFrom('question')
    .select('id')
    .where('service_definition_version_id', '=', item.catalogVersionId)
    .executeTakeFirstOrThrow();
  const requestInput = {
    serviceDefinitionId: id,
    serviceDefinitionVersionId: item.catalogVersionId,
    description: 'Fictional preservation proof',
    reportingIdentity: 'anonymous' as const,
    answers: [{ questionId: question.id, value: 'Fictional answer' }],
    location: { enteredAddress: 'Fictional test location' },
  };
  const publicReceipt = await creator().execute(requestInput);
  await creator().executeStaff(
    {
      ...requestInput,
      reportingIdentity: 'identified',
      audience: 'internal',
      intakeChannel: 'api',
    },
    creatorAccess,
  );
  await sql`insert into request_tracking_credential(organization_id,service_request_id,credential_digest,status,created_by_staff_identity_id)
    values(${org},${publicReceipt.id},${'1'.repeat(64)},'active',${access.staffIdentityId})`.execute(
    db,
  );
  const historicalTables = [
    'service_request',
    'answer',
    'answer_selected_option',
    'location',
    'requester_contact',
    'requester',
    'request_tracking_credential',
    'request_operational_activity',
  ];
  const historical = await snapshot(historicalTables);
  await t.test(
    'bare SQL, wrong before state, cross-Organization and incomplete audit evidence fail',
    async () => {
      const before = await snapshot(configuration);
      await assert.rejects(
        sql`update service_definition set availability='INTERNAL_ONLY' where id=${id}`.execute(
          db,
        ),
      );
      const b = await body();
      for (const [organization, prior] of [
        [otherOrg, 'INTERNAL_AND_EXTERNAL'],
        [org, 'EXTERNAL_ONLY'],
        [org, 'INTERNAL_AND_EXTERNAL'],
      ]) {
        await assert.rejects(
          db.transaction().execute(async (trx) => {
            await sql`insert into issue_configuration_audit(organization_id,issue_id,staff_identity_id,action,changed_fields,prior_core_revision,core_revision,policy_revision,assignment_revision,correlation_id,availability,prior_availability,prior_handling,handling,prior_action_revision,action_revision)
          values(${organization},${id},${access.staffIdentityId},'changed',array['availability'],${b.expectedCoreRevision},${b.expectedCoreRevision + 1},${b.expectedPolicyRevision},${b.expectedAssignmentRevision},${randomUUID()},'INTERNAL_ONLY',${prior},'internal_intake','internal_intake',1,1)`.execute(
              trx,
            );
          }),
        );
      }
      assert.deepEqual(await snapshot(configuration), before);
    },
  );
  await t.test(
    'Availability changes core once, no catalog publication; stale/no-op and history remain safe',
    async () => {
      const initial = await body();
      const changed = (
        await service.change(access, id, {
          ...initial,
          availability: 'INTERNAL_ONLY',
        })
      ).issue;
      assert.equal(changed.coreRevision, initial.expectedCoreRevision + 1);
      assert.equal(changed.actionRevision, initial.expectedActionRevision);
      assert.equal(changed.catalogVersionId, item.catalogVersionId);
      const before = await snapshot(configuration);
      await assert.rejects(
        service.change(access, id, {
          ...initial,
          availability: 'EXTERNAL_ONLY',
        }),
        { status: 409 },
      );
      assert.equal(
        (
          await service.change(access, id, {
            ...(await body()),
            availability: 'INTERNAL_ONLY',
          })
        ).changed,
        false,
      );
      assert.deepEqual(await snapshot(configuration), before);
      assert.deepEqual(await snapshot(historicalTables), historical);
      await assert.rejects(creator().execute(requestInput));
      await assert.rejects(db.transaction().execute(down));
      await assert.rejects(
        sql`update service_definition set availability='INTERNAL_AND_EXTERNAL' where id=${id}`.execute(
          db,
        ),
      );
    },
  );
  await t.test(
    'retained audit cannot be replayed; mismatched final target and forged transaction stamp fail',
    async () => {
      const before = await snapshot(configuration);
      await assert.rejects(
        sql`insert into issue_configuration_audit(organization_id,issue_id,staff_identity_id,action,changed_fields,prior_core_revision,core_revision,policy_revision,assignment_revision,correlation_id,availability,prior_availability,prior_handling,handling,prior_action_revision,action_revision,mutation_txid)
      select organization_id,issue_id,staff_identity_id,action,changed_fields,prior_core_revision,core_revision,policy_revision,assignment_revision,correlation_id,availability,prior_availability,prior_handling,handling,prior_action_revision,action_revision,mutation_txid from issue_configuration_audit where issue_id=${id} and prior_availability is not null`.execute(
          db,
        ),
      );
      const b = await body();
      await assert.rejects(
        db.transaction().execute(async (trx) => {
          const audit = await sql<{
            mutation_txid: string;
            actual: string;
          }>`insert into issue_configuration_audit(organization_id,issue_id,staff_identity_id,action,changed_fields,prior_core_revision,core_revision,policy_revision,assignment_revision,correlation_id,availability,prior_availability,prior_handling,handling,prior_action_revision,action_revision,mutation_txid)
        values(${org},${id},${access.staffIdentityId},'changed',array['availability'],${b.expectedCoreRevision},${b.expectedCoreRevision + 1},${b.expectedPolicyRevision},${b.expectedAssignmentRevision},${randomUUID()},'EXTERNAL_ONLY','INTERNAL_ONLY','internal_intake','internal_intake',1,1,0)
        returning mutation_txid::text,txid_current()::text as actual`.execute(
            trx,
          );
          assert.ok(audit.rows[0]);
          assert.equal(audit.rows[0].mutation_txid, audit.rows[0].actual);
          await sql`update service_definition set availability='INTERNAL_AND_EXTERNAL' where id=${id}`.execute(
            trx,
          );
        }),
      );
      assert.deepEqual(await snapshot(configuration), before);
    },
  );
  await t.test(
    'explicit combined Handling/Availability save, matrix, F032 scope and rollback',
    async () => {
      const redirect = {
        actionType: 'external_redirect',
        destination: 'https://example.com/governed',
        message: 'Fictional handoff',
        label: 'Continue',
      };
      const before = await snapshot(configuration);
      await assert.rejects(
        service.change(access, id, { ...(await body()), handling: redirect }),
        { status: 400 },
      );
      await assert.rejects(
        service.change(
          {
            ...access,
            permissions: access.permissions.filter(
              (p) => p !== 'catalog.issue_action.manage',
            ),
          },
          id,
          {
            ...(await body()),
            availability: 'EXTERNAL_ONLY',
            handling: redirect,
          },
        ),
        { status: 403 },
      );
      await assert.rejects(
        service.change({ ...access, departmentIds: [] }, id, {
          ...(await body()),
          availability: 'EXTERNAL_ONLY',
          handling: redirect,
        }),
      );
      assert.deepEqual(await snapshot(configuration), before);
      for (const table of [
        'issue_action_history',
        'issue_action_audit',
        'issue_configuration_audit',
      ]) {
        await sql`create function fail_governed_test() returns trigger language plpgsql as $$ begin raise exception 'Injected failure'; end $$`.execute(
          db,
        );
        await sql`create trigger fail_governed_test before insert on ${sql.table(table)} for each row execute function fail_governed_test()`.execute(
          db,
        );
        try {
          await assert.rejects(
            service.change(access, id, {
              ...(await body()),
              availability: 'EXTERNAL_ONLY',
              handling: redirect,
            }),
          );
        } finally {
          await sql`drop trigger fail_governed_test on ${sql.table(table)}; drop function fail_governed_test()`.execute(
            db,
          );
        }
        assert.deepEqual(await snapshot(configuration), before);
      }
      const initial = await body();
      const changed = (
        await service.change(access, id, {
          ...initial,
          availability: 'EXTERNAL_ONLY',
          handling: redirect,
          displayOrder: 4,
        })
      ).issue;
      assert.equal(changed.coreRevision, initial.expectedCoreRevision + 1);
      assert.equal(changed.actionRevision, initial.expectedActionRevision + 1);
      await assert.rejects(
        service.change(access, id, {
          ...(await body()),
          availability: 'INTERNAL_AND_EXTERNAL',
        }),
        { status: 400 },
      );
      await service.change(access, id, {
        ...(await body()),
        availability: 'INTERNAL_AND_EXTERNAL',
        handling: { actionType: 'internal_intake' },
      });
      assert.deepEqual(await snapshot(historicalTables), historical);
      const transitions = (
        await sql<{
          prior_availability: string;
          availability: string;
        }>`select prior_availability,availability from issue_configuration_audit where issue_id=${id} and prior_availability is not null order by core_revision`.execute(
          db,
        )
      ).rows;
      assert.equal(transitions.length, 3);
    },
  );
  await t.test(
    'all intake transitions retain catalog and historical data for Active and Inactive Issues',
    async () => {
      for (const active of [false, true])
        for (const from of [
          'INTERNAL_ONLY',
          'EXTERNAL_ONLY',
          'INTERNAL_AND_EXTERNAL',
        ] as const) {
          await service.change(access, id, {
            ...(await body()),
            active,
            availability: from,
          });
          for (const to of [
            'INTERNAL_ONLY',
            'EXTERNAL_ONLY',
            'INTERNAL_AND_EXTERNAL',
          ] as const) {
            const current = await body();
            const saved = (
              await service.change(access, id, { ...current, availability: to })
            ).issue;
            assert.equal(saved.catalogVersionId, item.catalogVersionId);
            assert.deepEqual(await snapshot(historicalTables), historical);
            await service.change(access, id, {
              ...(await body()),
              availability: from,
            });
          }
        }
    },
  );
  await t.test(
    'concurrent configuration has one winner; admitted intake completes before new Availability',
    async () => {
      await service.change(access, id, {
        ...(await body()),
        availability: 'INTERNAL_AND_EXTERNAL',
      });
      const initial = await body();
      const results = await Promise.allSettled(
        ['INTERNAL_ONLY', 'EXTERNAL_ONLY'].map((availability) =>
          service.change(access, id, {
            ...initial,
            availability: availability as NonNullable<
              IssueChange['availability']
            >,
          }),
        ),
      );
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      await service.change(access, id, {
        ...(await body()),
        availability: 'INTERNAL_AND_EXTERNAL',
      });
      const repository = new ServiceRequestRepository(),
        load = repository.loadSubmissionDefinition.bind(repository);
      let admit!: () => void, release!: () => void;
      const entered = new Promise<void>((r) => {
          admit = r;
        }),
        gate = new Promise<void>((r) => {
          release = r;
        });
      repository.loadSubmissionDefinition = async (...args) => {
        const result = await load(...args);
        admit();
        await gate;
        return result;
      };
      const creating = creator(repository).execute(requestInput);
      await Promise.race([
        entered,
        creating.then(() => {
          throw Error('Intake bypassed gate');
        }),
      ]);
      const changing = service.change(access, id, {
        ...(await body()),
        availability: 'INTERNAL_ONLY',
      });
      release();
      const [receipt] = await Promise.all([creating, changing]);
      assert.ok(receipt.id);
      await assert.rejects(creator().execute(requestInput));
      await creator().executeStaff(
        {
          ...requestInput,
          reportingIdentity: 'identified',
          audience: 'internal',
          intakeChannel: 'api',
        },
        creatorAccess,
      );
    },
  );
}
