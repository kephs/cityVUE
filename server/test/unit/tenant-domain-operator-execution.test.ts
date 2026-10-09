import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  OperatorRefusal,
  operatorFailureCodes,
  resolveOperatorTarget,
  type OperatorTarget,
} from '../../src/config/operator-environment.js';
import {
  entraExecutionClaims,
  normalizeTrustedIdentity,
  OperatorIdentityRefusal,
  trustedIdentityAdapters,
} from '../../src/config/operator-identity.js';
import {
  APPROVE_VERB,
  assertChannelsDisjoint,
  assertExecutionPermitted,
  assertPermitted,
  BREAKGLASS_PERMISSION,
  EXECUTE_PERMISSION,
  MAXIMUM_ELEVATION_MINUTES,
  MIGRATE_PERMISSION,
  OPERATION_INPUTS,
  OPERATOR_PERMISSIONS,
  operatorPermissions,
  RECOMMENDED_JOB_TIMEOUT_MINUTES,
  resolveTrustedExecution,
  TRUSTED_EXECUTION_VARIABLES,
  type OperatorPermission,
  type TrustedExecutionContext,
} from '../../src/config/operator-execution.js';
import {
  assertAuditPayloadSafe,
  beginAuditedInvocation,
  completeAuditedInvocation,
  FORBIDDEN_AUDIT_KEYS,
  memoryAuditSink,
  resolveAuditSink,
  startRecord,
  streamAuditSink,
  type OperatorAuditSink,
} from '../../src/config/operator-audit.js';

/**
 * ADR-028 F060.3C-2e-1. The trusted production operator execution contract,
 * proven without a database, without IAM and without a cloud resource: every
 * refusal below happens before a connection could be opened.
 */

/** The `server` package root, from the compiled test's location. */
const SERVER = resolve(__dirname, '../../..');
const source = (relative: string) =>
  readFileSync(resolve(SERVER, relative), 'utf8');

const TENANT = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const SUBJECT = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
const IDENTITY = `iam:${TENANT}/${SUBJECT}`;
const SHA = 'a'.repeat(40);
const DIGEST = 'sha256:' + 'b'.repeat(64);

const productionTarget = resolveOperatorTarget({
  REQRO_OPERATOR_ENVIRONMENT: 'production',
  REQRO_DEPLOYMENT_ENVIRONMENT: 'production',
  REQRO_OPERATOR_DATABASE: 'reqro_client_prod',
  REQRO_OPERATOR_DATABASE_USER: 'reqro_operator',
});

const testTarget = resolveOperatorTarget({
  REQRO_OPERATOR_ENVIRONMENT: 'test',
  REQRO_DEPLOYMENT_ENVIRONMENT: 'test',
  REQRO_OPERATOR_DATABASE: 'reqro_f0592_test',
  REQRO_OPERATOR_DATABASE_USER: 'reqro_test_user',
});

/** A complete, valid serving execution environment. Every negative case below
 * is this object minus or plus exactly one thing, so a refusal can only be
 * attributed to that one difference. */
const GRANTED_AT = '2026-10-08T12:00:00.000Z';
const EXPIRES_AT = '2026-10-08T12:30:00.000Z';
const NOW = new Date('2026-10-08T12:05:00.000Z');

function completeEnvironment(): NodeJS.ProcessEnv {
  return {
    REQRO_OPERATOR_IAM_TENANT_ID: TENANT,
    REQRO_OPERATOR_IAM_SUBJECT: SUBJECT,
    REQRO_OPERATOR_IAM_PERMISSIONS: 'tenant-domain.request',
    REQRO_OPERATOR_ELEVATION_REQUEST_ID: 'elev-01HQ8X',
    REQRO_OPERATOR_ELEVATION_GRANTED_AT: GRANTED_AT,
    REQRO_OPERATOR_ELEVATION_EXPIRES_AT: EXPIRES_AT,
    REQRO_OPERATOR_RUNNER_IDENTITY: 'runner/tenant-domain-operator',
    REQRO_OPERATOR_RUNNER_PLATFORM: 'neutral-runner',
    REQRO_OPERATOR_JOB_RUN_ID: 'job-4412',
    REQRO_OPERATOR_COMMIT_SHA: SHA,
    REQRO_OPERATOR_IMAGE_DIGEST: DIGEST,
    REQRO_OPERATOR_TRUSTED_RUNNER: 'runner/tenant-domain-operator',
    REQRO_OPERATOR_AUDIT_SINK: 'stream',
  };
}

function resolveServing(
  environment: NodeJS.ProcessEnv,
  target: OperatorTarget = productionTarget,
): TrustedExecutionContext | null {
  return resolveTrustedExecution({
    environment,
    target,
    now: NOW,
    newInvocationId: () => 'c0000000-0000-4000-8000-00000000000c',
  });
}

function refusalCode(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    assert.ok(
      error instanceof OperatorRefusal ||
        error instanceof OperatorIdentityRefusal,
      'expected a closed operator refusal',
    );
    return error.code;
  }
  return assert.fail('expected a refusal');
}

async function asyncRefusalCode(
  action: () => Promise<unknown>,
): Promise<string> {
  try {
    await action();
  } catch (error) {
    assert.ok(error instanceof OperatorRefusal, 'expected an OperatorRefusal');
    return error.code;
  }
  return assert.fail('expected a refusal');
}

// ---------------------------------------------------------------------------
// Identity: the normalized format, and its compatibility with the database
// ---------------------------------------------------------------------------

test('the normalized identity satisfies the recorded identity grammar in the migration source', () => {
  // The authority is Migration 47, not a copy of its rules. Both pattern
  // strings are asserted to be present in the migration source and then used
  // to build the matchers, so a change to the migration fails this test
  // instead of silently diverging from it.
  const migration = source(
    'migrations/20261017000000-add-tenant-domain-operator-controls.ts',
  );
  const grammarText = '^(iam|oidc|dev):[A-Za-z0-9][A-Za-z0-9._@/+-]{1,180}$';
  const runText = '[A-Za-z0-9]{32,}';
  assert.ok(
    migration.includes(grammarText),
    'the migration no longer declares the expected identity grammar',
  );
  assert.ok(
    migration.includes(runText),
    'the migration no longer declares the long-run exclusion',
  );
  // Three columns carry the grammar: operator_identity, requested_by and
  // approved_by. All three must accept the normalized value.
  assert.equal(
    migration.split(grammarText).length - 1,
    3,
    'the identity grammar is no longer applied to exactly three columns',
  );

  const grammar = new RegExp(grammarText);
  const longRun = new RegExp(runText);
  const normalized = normalizeTrustedIdentity({
    issuer: TENANT,
    subject: SUBJECT,
  });
  assert.equal(normalized.identity, IDENTITY);
  assert.ok(grammar.test(normalized.identity), 'grammar must accept it');
  assert.ok(
    !longRun.test(normalized.identity),
    'the long-alphanumeric-run exclusion must not reject it',
  );
  // 4 + 36 + 1 + 36, comfortably inside the 181-character ceiling.
  assert.equal(normalized.identity.length, 77);
});

test('an unhyphenated subject is refused rather than written and rejected by the database', () => {
  // This is the specific incompatibility the format exists to avoid: a bare
  // 32-hex GUID is a 32-character alphanumeric run, which Migration 47
  // refuses. Proven against the migration's own rule, then proven refused at
  // the boundary.
  const longRun = new RegExp('[A-Za-z0-9]{32,}');
  const bare = SUBJECT.replaceAll('-', '');
  assert.equal(bare.length, 32);
  assert.ok(
    longRun.test(`iam:${TENANT}/${bare}`),
    'the unhyphenated form must be the thing the database refuses',
  );
  assert.equal(
    refusalCode(() =>
      entraExecutionClaims({
        REQRO_OPERATOR_IAM_TENANT_ID: TENANT,
        REQRO_OPERATOR_IAM_SUBJECT: bare,
      }),
    ),
    'identity_malformed',
  );
  // And refused by the provider-neutral core as well, so a future adapter
  // that forgets the GUID check still cannot produce an unwritable identity.
  assert.equal(
    refusalCode(() =>
      normalizeTrustedIdentity({ issuer: TENANT, subject: bare }),
    ),
    'identity_unsupported',
  );
});

test('the subject is the immutable object identifier, never a UPN, mail or display name', () => {
  for (const reassignable of [
    'operator@example.gov',
    'Alex Operator',
    'alex.operator',
  ])
    assert.equal(
      refusalCode(() =>
        entraExecutionClaims({
          REQRO_OPERATOR_IAM_TENANT_ID: TENANT,
          REQRO_OPERATOR_IAM_SUBJECT: reassignable,
        }),
      ),
      'identity_malformed',
      `${reassignable} must not be accepted as the subject`,
    );
  // They are still recorded as secondary context, and are not the key.
  const normalized = normalizeTrustedIdentity({
    issuer: TENANT,
    subject: SUBJECT,
    displayName: 'Alex Operator',
    email: 'operator@example.gov',
  });
  assert.equal(normalized.subject, SUBJECT);
  assert.equal(normalized.displayName, 'Alex Operator');
  assert.equal(normalized.email, 'operator@example.gov');
  assert.ok(
    !normalized.identity.includes('operator@example.gov'),
    'secondary context must not enter the recorded identity',
  );
});

test('absent trusted claims are refused and no identity is invented', () => {
  assert.equal(
    refusalCode(() => entraExecutionClaims({})),
    'identity_absent',
  );
  assert.equal(
    refusalCode(() =>
      entraExecutionClaims({ REQRO_OPERATOR_IAM_TENANT_ID: TENANT }),
    ),
    'identity_absent',
  );
  assert.equal(
    refusalCode(() =>
      normalizeTrustedIdentity({ issuer: '', subject: SUBJECT }),
    ),
    'identity_absent',
  );
});

test('an injected adapter supplies the claims, and only a database-compatible subject is accepted', () => {
  // Entra is the only shipped adapter, and a second provider is an injected
  // function rather than a change to the operator path.
  assert.deepEqual(Object.keys(trustedIdentityAdapters), ['entra']);
  const environment = {
    ...completeEnvironment(),
    SECOND_PROVIDER_ISSUER: 'issuer.example',
    SECOND_PROVIDER_SUBJECT: 'subject-0001',
  };
  const context = resolveTrustedExecution({
    environment,
    target: productionTarget,
    now: NOW,
    newInvocationId: () => 'c0000000-0000-4000-8000-00000000000c',
    identityAdapter: (env) => ({
      issuer: env.SECOND_PROVIDER_ISSUER ?? '',
      subject: env.SECOND_PROVIDER_SUBJECT ?? '',
    }),
  });
  assert.ok(context);
  assert.equal(context.identity, 'iam:issuer.example/subject-0001');

  // The claim that arbitrary OIDC subjects are supported is deliberately not
  // made: an opaque base64url `sub` is a long alphanumeric run, so it is
  // refused at the boundary rather than written and rejected by the database.
  assert.equal(
    refusalCode(() =>
      resolveTrustedExecution({
        environment,
        target: productionTarget,
        now: NOW,
        identityAdapter: () => ({
          issuer: 'issuer.example',
          subject: 'Zm9vYmFyYmF6cXV1eGNvcmdlZ3JhdWx0', // 32 chars, no hyphen
        }),
      }),
    ),
    'attribution_invalid',
  );
});

// ---------------------------------------------------------------------------
// Permissions: the correction this slice carries
// ---------------------------------------------------------------------------

test('tenant-domain.request never authorizes approve', () => {
  const requestVerbs: readonly string[] =
    OPERATOR_PERMISSIONS['tenant-domain.request'];
  assert.ok(
    !requestVerbs.includes(APPROVE_VERB),
    'the requester permission must never authorize approve',
  );
  const context = grant(['tenant-domain.request']);
  assert.equal(
    refusalCode(() => {
      assertPermitted(context, APPROVE_VERB);
    }),
    'permission_denied',
  );
  // It does authorize every other change, so the denial is specific to
  // approve rather than a blanket denial that would pass vacuously.
  for (const verb of requestVerbs)
    assert.doesNotThrow(() => {
      assertPermitted(context, verb);
    }, verb);
  assert.ok(
    requestVerbs.length >= 6,
    'the requester surface must be non-trivial',
  );
});

test('tenant-domain.approve authorizes approve and nothing else', () => {
  assert.deepEqual(OPERATOR_PERMISSIONS['tenant-domain.approve'], [
    APPROVE_VERB,
  ]);
  const context = grant(['tenant-domain.approve']);
  assert.doesNotThrow(() => {
    assertPermitted(context, APPROVE_VERB);
  });
  for (const verb of [
    'register',
    'issue-challenge',
    'verify',
    'activate',
    'deactivate',
    'revoke',
  ])
    assert.equal(
      refusalCode(() => {
        assertPermitted(context, verb);
      }),
      'permission_denied',
      verb,
    );
});

test('the approve grant is checked against approve itself, not the operation it authorizes', () => {
  // Recording an approval for `activate` is the `approve` verb. A requester
  // holding activate authority must not be able to record it.
  const source_ = source('src/database/tenant-domain-operator-cli.ts');
  assert.ok(
    source_.includes('assertPermitted(execution, verb)'),
    'the permission check must be made against the chosen verb',
  );
  assert.ok(
    !/assertPermitted\(\s*execution\s*,\s*approvedVerb/.test(source_),
    'the permission check must never be made against the approved operation',
  );
});

test('the permission set is exactly the five approved conceptual permissions', () => {
  assert.deepEqual(operatorPermissions, [
    'tenant-domain.request',
    'tenant-domain.approve',
    'tenant-domain.execute',
    'deployment.migrate',
    'emergency.breakglass',
  ]);
});

test('execute, migrate and breakglass authorize no verb of their own', () => {
  const authorizeNothing: readonly OperatorPermission[] = [
    EXECUTE_PERMISSION,
    MIGRATE_PERMISSION,
    BREAKGLASS_PERMISSION,
  ];
  for (const permission of authorizeNothing)
    assert.deepEqual(OPERATOR_PERMISSIONS[permission], [], permission);

  // Execution authority is not verb authority: holding it alone authorizes
  // nothing, so it cannot be used as a substitute for request or approve.
  const context = grant([EXECUTE_PERMISSION]);
  for (const verb of [
    'register',
    'issue-challenge',
    'verify',
    'activate',
    'deactivate',
    'revoke',
    'approve',
  ])
    assert.equal(
      refusalCode(() => {
        assertPermitted(context, verb);
      }),
      'permission_denied',
      verb,
    );
});

test('migration authority can never become control-plane change authority', () => {
  // deployment.migrate is distinct. It authorizes no tenant-domain verb and
  // does not satisfy the commit gate, so the F060.3C-2d migration role's
  // authority cannot be reused to change the tenant-domain registry.
  const context = grant([MIGRATE_PERMISSION]);
  for (const verb of ['register', 'activate', 'deactivate', 'approve'])
    assert.equal(
      refusalCode(() => {
        assertPermitted(context, verb);
      }),
      'permission_denied',
      verb,
    );
  assert.equal(
    refusalCode(() => {
      assertExecutionPermitted(context, false);
    }),
    'permission_denied',
  );
});

test('break-glass is unimplemented and presenting it is refused outright', () => {
  // Refusing is stronger than conferring nothing: no capability exists that
  // could honour the grant, so an invocation claiming it is acting on a false
  // belief and must be told so rather than silently proceeding on whatever
  // other authority it holds.
  assert.equal(
    refusalCode(() =>
      resolveServing({
        ...completeEnvironment(),
        REQRO_OPERATOR_IAM_PERMISSIONS: `tenant-domain.request,${BREAKGLASS_PERMISSION}`,
      }),
    ),
    'permission_denied',
  );
  assert.equal(
    refusalCode(() =>
      resolveServing({
        ...completeEnvironment(),
        REQRO_OPERATOR_IAM_PERMISSIONS: BREAKGLASS_PERMISSION,
      }),
    ),
    'permission_denied',
  );
  // And no break-glass capability is implemented. Asserted as a precise
  // occurrence audit rather than a keyword scan: the permission's own name
  // legitimately appears in the model, and my first attempt at this test
  // flagged the exported constant as a violation of itself. In the execution
  // module's executable code the term may appear only as the permission-table
  // key, the exported constant and the refusal comparison; the command may
  // not mention it at all.
  const executable = (relative: string) =>
    source(relative)
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');

  // Five legitimate occurrences and no more: the permission-table key, the
  // exported constant's name and its value, the refusal comparison, and the
  // refusal message. A sixth would mean something started *using* it.
  assert.equal(
    [...executable('src/config/operator-execution.ts').matchAll(/breakglass/gi)]
      .length,
    5,
    'break-glass may appear only in the permission model, the constant and the refusal',
  );
  assert.ok(
    !/breakglass/i.test(
      executable('src/database/tenant-domain-operator-cli.ts'),
    ),
    'the command must contain no break-glass reference at all',
  );
  // No bypass capability in either module, with the permission constant
  // removed first so the model entry cannot satisfy or trip the scan.
  for (const relative of [
    'src/config/operator-execution.ts',
    'src/database/tenant-domain-operator-cli.ts',
  ]) {
    const stripped = executable(relative)
      .replace(/BREAKGLASS_PERMISSION/g, '')
      .replace(/'[^']*'/g, "''")
      .replace(/`[^`]*`/g, '``');
    for (const forbidden of ['bypass', 'breakGlass', 'break_glass'])
      assert.ok(
        !new RegExp(forbidden, 'i').test(stripped),
        `${relative} must implement no ${forbidden} capability`,
      );
  }
});

test('committing requires execution authority; planning does not', () => {
  const planner = grant(['tenant-domain.request']);
  // A dry run needs only the verb, which is how a requester produces the
  // pre-approval plan a second operator reviews.
  assert.doesNotThrow(() => {
    assertExecutionPermitted(planner, true);
  });
  assert.equal(
    refusalCode(() => {
      assertExecutionPermitted(planner, false);
    }),
    'permission_denied',
  );
  // With both grants, committing is authorized.
  const executor = grant(['tenant-domain.request', EXECUTE_PERMISSION]);
  assert.doesNotThrow(() => {
    assertExecutionPermitted(executor, false);
  });
  // Approving is a commit too, and also requires execution authority, so the
  // three authorities can be held by three different people.
  const approver = grant(['tenant-domain.approve']);
  assert.doesNotThrow(() => {
    assertPermitted(approver, APPROVE_VERB);
  });
  assert.equal(
    refusalCode(() => {
      assertExecutionPermitted(approver, false);
    }),
    'permission_denied',
  );
});

/** The six verbs `tenant-domain.request` covers, named once. */
const NON_APPROVE_VERBS = [
  'register',
  'issue-challenge',
  'verify',
  'activate',
  'deactivate',
  'revoke',
] as const;

test('the approved permission matrix, proven behaviourally for every grant, verb and mode', () => {
  // Gate 3. This is the whole authorization model exercised through the real
  // assertions rather than inferred from the permission table, so a change to
  // either axis that happens to leave the table looking right still fails.
  //
  // Each grant set is evaluated against all seven verbs in both modes, and the
  // set of combinations it actually permits is asserted as a whole. A missing
  // entry and a surplus entry both fail, so no row can pass vacuously.
  const evaluate = (
    permissions: readonly OperatorPermission[],
    verb: string,
    dryRun: boolean,
  ): boolean => {
    const context = grant(permissions);
    try {
      assertPermitted(context, verb);
      assertExecutionPermitted(context, dryRun);
      return true;
    } catch {
      return false;
    }
  };

  const allVerbs = [...NON_APPROVE_VERBS, APPROVE_VERB];
  const permitted = (permissions: readonly OperatorPermission[]): string[] => {
    const allowed: string[] = [];
    for (const verb of allVerbs)
      for (const dryRun of [true, false])
        if (evaluate(permissions, verb, dryRun))
          allowed.push(`${verb} ${dryRun ? '--dry-run' : '--confirm'}`);
    return allowed.sort();
  };

  const plan = (verbs: readonly string[]) =>
    verbs.map((verb) => `${verb} --dry-run`);
  const commit = (verbs: readonly string[]) =>
    verbs.map((verb) => `${verb} --confirm`);

  const matrix: Record<string, string[]> = {
    // Verb authority alone plans but never commits.
    request: permitted(['tenant-domain.request']),
    approve: permitted(['tenant-domain.approve']),
    // Execution authority alone authorizes nothing at all.
    execute: permitted([EXECUTE_PERMISSION]),
    // Migration authority is not operator authority in any mode.
    migrate: permitted([MIGRATE_PERMISSION]),
    // The two axes together are what authorize a commit.
    'request+execute': permitted(['tenant-domain.request', EXECUTE_PERMISSION]),
    'approve+execute': permitted(['tenant-domain.approve', EXECUTE_PERMISSION]),
    // Execution authority does not leak across the verb axis: holding it with
    // request still cannot approve, and with approve still cannot request.
    'migrate+execute': permitted([MIGRATE_PERMISSION, EXECUTE_PERMISSION]),
  };

  assert.deepEqual(matrix, {
    request: plan(NON_APPROVE_VERBS).sort(),
    approve: plan([APPROVE_VERB]).sort(),
    execute: [],
    migrate: [],
    'request+execute': [
      ...plan(NON_APPROVE_VERBS),
      ...commit(NON_APPROVE_VERBS),
    ].sort(),
    'approve+execute': [
      ...plan([APPROVE_VERB]),
      ...commit([APPROVE_VERB]),
    ].sort(),
    'migrate+execute': [],
  });

  // Stated explicitly, because the matrix above proves it but a reader should
  // not have to derive it: a non-approve --confirm requires request AND
  // execute, and an approve --confirm requires approve AND execute.
  for (const verb of NON_APPROVE_VERBS) {
    assert.ok(!evaluate(['tenant-domain.request'], verb, false), verb);
    assert.ok(!evaluate([EXECUTE_PERMISSION], verb, false), verb);
    assert.ok(
      evaluate(['tenant-domain.request', EXECUTE_PERMISSION], verb, false),
      verb,
    );
  }
  assert.ok(!evaluate(['tenant-domain.approve'], APPROVE_VERB, false));
  assert.ok(!evaluate([EXECUTE_PERMISSION], APPROVE_VERB, false));
  assert.ok(
    evaluate(
      ['tenant-domain.approve', EXECUTE_PERMISSION],
      APPROVE_VERB,
      false,
    ),
  );
  // And a dry run must NOT require execute, which is the property that makes
  // a pre-approval plan producible by someone who cannot commit.
  for (const verb of NON_APPROVE_VERBS)
    assert.ok(evaluate(['tenant-domain.request'], verb, true), verb);
});

test('request and approve are mutually exclusive assignments, and the database remains the control', () => {
  // The IAM intent is that no human holds both. That is a grant-assignment
  // rule, enforced where grants are assigned, and this code deliberately does
  // NOT refuse the combination: refusing would be a new authorization
  // semantic, and the authoritative self-approval control already exists in
  // the database.
  const both = grant([
    'tenant-domain.request',
    'tenant-domain.approve',
    EXECUTE_PERMISSION,
  ]);
  assert.doesNotThrow(() => {
    assertPermitted(both, 'activate');
  });
  assert.doesNotThrow(() => {
    assertPermitted(both, APPROVE_VERB);
  });

  // What makes that safe is Migration 47, not this module. Asserted against
  // the migration source so the claim cannot drift from the schema.
  const migration = source(
    'migrations/20261017000000-add-tenant-domain-operator-controls.ts',
  );
  assert.ok(
    migration.includes('check(requested_by<>approved_by)'),
    'the database must still refuse one identity for both roles',
  );
  // And the operations layer refuses to consume an approval whose approver is
  // the acting operator, which is the second independent control.
  const operations = source('src/tenancy/tenant-domain.operations.ts');
  assert.ok(
    /requires a different approver|cannot be self-approved/.test(operations),
    'the operations layer must still refuse self-approval',
  );
});

test('every verb a permission names is a real operation, and every operation is reachable', () => {
  // Every verb named by a permission must be an operation the command
  // actually implements, resolved from the command's own OPERATIONS list
  // rather than from a second copy here.
  const cli = source('src/database/tenant-domain-operator-cli.ts');
  const block = /const OPERATIONS = \[([\s\S]*?)\] as const;/.exec(cli);
  assert.ok(block?.[1], 'the OPERATIONS list could not be resolved');
  const operations = new Set(
    [...block[1].matchAll(/'([a-z-]+)'/g)].map((match) => match[1]),
  );
  assert.equal(operations.size, 7);
  const covered = new Set<string>();
  for (const permission of operatorPermissions)
    for (const verb of OPERATOR_PERMISSIONS[permission] as readonly string[]) {
      assert.ok(operations.has(verb), `${verb} is not a real operation`);
      covered.add(verb);
    }
  // Every operation is reachable through some permission, so no verb is
  // unauthorizable and silently dead.
  assert.deepEqual([...covered].sort(), [...operations].sort());
});

test('an unknown permission is refused rather than ignored', () => {
  assert.equal(
    refusalCode(() =>
      resolveServing({
        ...completeEnvironment(),
        REQRO_OPERATOR_IAM_PERMISSIONS: 'tenant-domain.superuser',
      }),
    ),
    'permission_denied',
  );
  assert.equal(
    refusalCode(() =>
      resolveServing({
        ...completeEnvironment(),
        REQRO_OPERATOR_IAM_PERMISSIONS: ' , ',
      }),
    ),
    'execution_context_missing',
  );
});

function grant(
  permissions: readonly OperatorPermission[],
): TrustedExecutionContext {
  const context = resolveServing({
    ...completeEnvironment(),
    REQRO_OPERATOR_IAM_PERMISSIONS: permissions.join(','),
  });
  assert.ok(context);
  return context;
}

// ---------------------------------------------------------------------------
// Trusted context completeness: serving is all-or-nothing
// ---------------------------------------------------------------------------

test('a complete serving context resolves, so the ablation below cannot pass vacuously', () => {
  const context = resolveServing(completeEnvironment());
  assert.ok(context);
  assert.equal(context.identity, IDENTITY);
  assert.equal(context.identityIssuer, TENANT);
  assert.equal(context.identitySubject, SUBJECT);
  assert.deepEqual(context.permissions, ['tenant-domain.request']);
  assert.equal(context.commitSha, SHA);
  assert.equal(context.imageDigest, DIGEST);
  assert.equal(context.runnerIdentity, 'runner/tenant-domain-operator');
  assert.equal(context.jobRunId, 'job-4412');
  assert.equal(context.invocationId, 'c0000000-0000-4000-8000-00000000000c');
  // Thirteen trusted fields, eleven of them independently required.
  assert.equal(Object.keys(context).length, 15);
  assert.equal(TRUSTED_EXECUTION_VARIABLES.length, 11);
});

test('removing any one of the eleven trusted variables refuses the invocation', () => {
  // A per-variable verdict map asserted as a whole, so a variable that turns
  // out not to be load bearing is reported rather than hidden by an
  // every-case-fails loop.
  const verdicts: Record<string, string> = {};
  for (const key of TRUSTED_EXECUTION_VARIABLES) {
    // Rebuilt without the key rather than deleted from a copy, so the
    // absence is structural and no residual value can survive.
    const environment = Object.fromEntries(
      Object.entries(completeEnvironment()).filter(([name]) => name !== key),
    );
    verdicts[key] = refusalCode(() => resolveServing(environment));
  }
  assert.deepEqual(verdicts, {
    REQRO_OPERATOR_IAM_TENANT_ID: 'execution_context_missing',
    REQRO_OPERATOR_IAM_SUBJECT: 'execution_context_missing',
    REQRO_OPERATOR_IAM_PERMISSIONS: 'execution_context_missing',
    REQRO_OPERATOR_ELEVATION_REQUEST_ID: 'execution_context_missing',
    REQRO_OPERATOR_ELEVATION_GRANTED_AT: 'execution_context_missing',
    REQRO_OPERATOR_ELEVATION_EXPIRES_AT: 'execution_context_missing',
    REQRO_OPERATOR_RUNNER_IDENTITY: 'execution_context_missing',
    REQRO_OPERATOR_RUNNER_PLATFORM: 'execution_context_missing',
    REQRO_OPERATOR_JOB_RUN_ID: 'execution_context_missing',
    REQRO_OPERATOR_COMMIT_SHA: 'execution_context_missing',
    REQRO_OPERATOR_IMAGE_DIGEST: 'execution_context_missing',
  });
  // The trusted-runner declaration is required too, and is separate from the
  // runner's own assertion of its identity.
  const withoutDeclaration = completeEnvironment();
  delete withoutDeclaration.REQRO_OPERATOR_TRUSTED_RUNNER;
  assert.equal(
    refusalCode(() => resolveServing(withoutDeclaration)),
    'execution_context_missing',
  );
});

test('the gated test target has no trusted execution context and keeps the F060.3C-2b path', () => {
  assert.equal(resolveServing({}, testTarget), null);
  assert.equal(resolveServing(completeEnvironment(), testTarget), null);
  assert.equal(testTarget.serving, false);
  assert.equal(productionTarget.serving, true);
});

// ---------------------------------------------------------------------------
// Just-in-time elevation
// ---------------------------------------------------------------------------

test('an expired elevation is refused', () => {
  assert.equal(
    refusalCode(() =>
      resolveTrustedExecution({
        environment: completeEnvironment(),
        target: productionTarget,
        now: new Date('2026-10-08T12:30:00.001Z'),
      }),
    ),
    'elevation_invalid',
  );
});

test('an elevation window wider than the maximum is refused rather than trimmed', () => {
  assert.equal(MAXIMUM_ELEVATION_MINUTES, 60);
  // Exactly at the ceiling is accepted; one minute beyond is refused.
  assert.ok(
    resolveServing({
      ...completeEnvironment(),
      REQRO_OPERATOR_ELEVATION_EXPIRES_AT: '2026-10-08T13:00:00.000Z',
    }),
  );
  assert.equal(
    refusalCode(() =>
      resolveServing({
        ...completeEnvironment(),
        REQRO_OPERATOR_ELEVATION_EXPIRES_AT: '2026-10-08T13:01:00.000Z',
      }),
    ),
    'elevation_invalid',
  );
  // The recommended job timeout is far below the ceiling, so a job cannot
  // outlive the elevation that authorized it.
  // Asserted as exact values; the inequality between two literals is not
  // something a test can meaningfully check.
  assert.equal(RECOMMENDED_JOB_TIMEOUT_MINUTES, 15);
});

test('a malformed, inverted or future elevation window is refused', () => {
  const cases: Record<string, NodeJS.ProcessEnv> = {
    malformed: { REQRO_OPERATOR_ELEVATION_EXPIRES_AT: 'soon' },
    inverted: {
      REQRO_OPERATOR_ELEVATION_GRANTED_AT: '2026-10-08T12:30:00.000Z',
      REQRO_OPERATOR_ELEVATION_EXPIRES_AT: '2026-10-08T12:00:00.000Z',
    },
    future: {
      REQRO_OPERATOR_ELEVATION_GRANTED_AT: '2026-10-08T13:00:00.000Z',
      REQRO_OPERATOR_ELEVATION_EXPIRES_AT: '2026-10-08T13:30:00.000Z',
    },
    unidentified: { REQRO_OPERATOR_ELEVATION_REQUEST_ID: 'bad id;drop' },
  };
  const verdicts: Record<string, string> = {};
  for (const [label, overrides] of Object.entries(cases))
    verdicts[label] = refusalCode(() =>
      resolveServing({ ...completeEnvironment(), ...overrides }),
    );
  assert.deepEqual(verdicts, {
    malformed: 'elevation_invalid',
    inverted: 'elevation_invalid',
    future: 'elevation_invalid',
    unidentified: 'elevation_invalid',
  });
});

// ---------------------------------------------------------------------------
// Runner trust
// ---------------------------------------------------------------------------

test('a runner that is not the declared trusted runner is refused', () => {
  assert.equal(
    refusalCode(() =>
      resolveServing({
        ...completeEnvironment(),
        REQRO_OPERATOR_RUNNER_IDENTITY: 'runner/some-other-pipeline',
      }),
    ),
    'runner_untrusted',
  );
  assert.equal(
    refusalCode(() =>
      resolveServing({
        ...completeEnvironment(),
        REQRO_OPERATOR_RUNNER_PLATFORM: 'Not A Label',
      }),
    ),
    'runner_untrusted',
  );
});

test('the runner comparison is documented as a consistency assertion, not authentication', () => {
  // Gate 7. This wording is a security property, not prose: two matching
  // environment values must never be documented as proving a trustworthy
  // runner. If someone later softens this, the test fails rather than the
  // claim quietly becoming an overstatement.
  const module = source('src/config/operator-execution.ts');
  const adapter = module.slice(
    module.indexOf('The provider-neutral trusted-runner assertion adapter'),
    module.indexOf('export const assertDeclaredRunner'),
  );
  assert.ok(adapter.length > 400, 'the runner adapter doc block was not found');
  // Matched whitespace-tolerantly: these phrases wrap across comment lines,
  // so a plain substring check would fail on the line break rather than on
  // the wording actually being absent.
  for (const required of [
    /not an authentication/i,
    /through the same\s+\*?\s*environment/i,
    /signed workload assertion/i,
  ])
    assert.match(adapter, required);
  // It must not claim the comparison establishes trust or authenticates.
  for (const overstatement of [
    /proves\s+(?:the\s+)?runner\s+is\s+trust/i,
    /authenticates\s+the\s+runner/i,
    /guarantees\s+a\s+trusted\s+runner/i,
  ])
    assert.doesNotMatch(adapter, overstatement);

  // The same honesty must survive in the operator-facing documents.
  for (const doc of [
    '../docs/architecture/decisions/ADR-028-trusted-production-operator-execution.md',
    '../docs/operations/TENANT_DOMAIN_OPERATOR_RUNBOOK.md',
  ]) {
    const text = source(doc);
    assert.ok(
      /consistency check|consistency assertion/i.test(text),
      `${doc} must describe the runner comparison as a consistency check`,
    );
  }
});

test('the runner assertion is an adapter, and the implementation names no vendor', () => {
  // Provider neutrality is asserted against the source: selecting a runner is
  // a separate authorized decision, so no vendor may be named here.
  const execution = source('src/config/operator-execution.ts');
  const audit = source('src/config/operator-audit.ts');
  for (const vendor of [
    'github',
    'actions/',
    'azure',
    'devops',
    'gitlab',
    'jenkins',
    'circleci',
    'buildkite',
    'aws',
    'gcp',
  ])
    for (const [name, text] of [
      ['operator-execution.ts', execution],
      ['operator-audit.ts', audit],
    ] as const) {
      const code = text
        .split('\n')
        .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
        .join('\n');
      assert.ok(
        !new RegExp(vendor, 'i').test(code),
        `${name} must not name ${vendor} in executable code`,
      );
    }

  // An injected assertion replaces the default, which is what a signed
  // workload assertion would later be.
  let asserted = '';
  const context = resolveTrustedExecution({
    environment: completeEnvironment(),
    target: productionTarget,
    now: NOW,
    runnerAssertion: (_environment, value) => {
      asserted = value;
    },
  });
  assert.ok(context);
  assert.equal(asserted, 'runner/tenant-domain-operator');
});

// ---------------------------------------------------------------------------
// Code provenance
// ---------------------------------------------------------------------------

test('provenance requires both an immutable commit SHA and an immutable image digest', () => {
  const verdicts: Record<string, string> = {};
  const cases: Record<string, NodeJS.ProcessEnv> = {
    'branch name': { REQRO_OPERATOR_COMMIT_SHA: 'main' },
    'short sha': { REQRO_OPERATOR_COMMIT_SHA: 'a'.repeat(7) },
    'uppercase sha': { REQRO_OPERATOR_COMMIT_SHA: 'A'.repeat(40) },
    'mutable tag': { REQRO_OPERATOR_IMAGE_DIGEST: 'latest' },
    'tag reference': {
      REQRO_OPERATOR_IMAGE_DIGEST: 'registry.example/reqro-operator:v1',
    },
    'short digest': { REQRO_OPERATOR_IMAGE_DIGEST: 'sha256:' + 'b'.repeat(12) },
  };
  for (const [label, overrides] of Object.entries(cases))
    verdicts[label] = refusalCode(() =>
      resolveServing({ ...completeEnvironment(), ...overrides }),
    );
  assert.deepEqual(verdicts, {
    'branch name': 'provenance_invalid',
    'short sha': 'provenance_invalid',
    'uppercase sha': 'provenance_invalid',
    'mutable tag': 'provenance_invalid',
    'tag reference': 'provenance_invalid',
    'short digest': 'provenance_invalid',
  });
});

// ---------------------------------------------------------------------------
// Humans choose the action, never the actor
// ---------------------------------------------------------------------------

test('a human-supplied operator identity is refused in a serving environment', () => {
  assert.equal(
    refusalCode(() =>
      resolveServing({
        ...completeEnvironment(),
        REQRO_OPERATOR_IDENTITY: `iam:${TENANT}/${SUBJECT}`,
      }),
    ),
    'identity_override_rejected',
  );
  // Even an identity identical to the derived one is refused, so the rule is
  // "you do not set the actor" rather than "you may set it if you guess right".
  assert.equal(
    refusalCode(() =>
      resolveServing({
        ...completeEnvironment(),
        REQRO_OPERATOR_IDENTITY: 'iam:other/subject-9999',
      }),
    ),
    'identity_override_rejected',
  );
  // Outside a serving environment it remains the attribution source.
  assert.equal(
    resolveServing(
      { ...completeEnvironment(), REQRO_OPERATOR_IDENTITY: 'dev:local' },
      testTarget,
    ),
    null,
  );
});

test('the trusted and human-selectable channels are disjoint', () => {
  assert.doesNotThrow(() => {
    assertChannelsDisjoint();
  });
  const trusted = new Set<string>(TRUSTED_EXECUTION_VARIABLES);
  for (const input of OPERATION_INPUTS)
    assert.ok(!trusted.has(input), `${input} must not be a trusted field`);
  assert.equal(OPERATION_INPUTS.length, 8);
});

test('no trusted execution field is read by the command, and none can arrive as an argument', () => {
  // Structural, and enumerated rather than asserted by absence of a string:
  // every environment key the command itself reads is collected from its
  // source, and that set must not intersect the trusted channel. The command
  // does name the trusted variables in its `--help` text, which is correct —
  // documenting them is not reading them — so a plain substring scan would
  // false-positive here. This checks the property that matters.
  const cli = source('src/database/tenant-domain-operator-cli.ts');
  const read = new Set<string>();
  for (const pattern of [
    /process\.env\.([A-Z][A-Z0-9_]+)/g,
    /process\.env\['([A-Z][A-Z0-9_]+)'\]/g,
    /requiredValue\(\s*'([A-Z][A-Z0-9_]+)'/g,
    /refusedValue\(\s*'([A-Z][A-Z0-9_]+)'/g,
  ])
    for (const match of cli.matchAll(pattern)) read.add(match[1] ?? '');

  // Non-vacuous: the command really does read its own human-selectable
  // inputs, so an empty intersection below is meaningful.
  assert.ok(
    read.size >= 8,
    `expected several direct reads, saw ${String(read.size)}`,
  );
  for (const human of [
    'REQRO_OPERATOR_HOSTNAME',
    'REQRO_OPERATOR_ORGANIZATION_ID',
    'REQRO_OPERATOR_EXPECTED_REVISION',
    'REQRO_OPERATOR_APPROVAL_ID',
  ])
    assert.ok(read.has(human), `${human} should be read by the command`);

  const intersection = TRUSTED_EXECUTION_VARIABLES.filter((key) =>
    read.has(key),
  );
  assert.deepEqual(
    intersection,
    [],
    'a trusted execution field must be read only by the execution contract',
  );

  // And no trusted field can arrive as an argument: there are no such flags.
  const code = cli
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join('\n');
  for (const flag of ['--identity', '--operator', '--runner', '--permission'])
    assert.ok(!code.includes(flag), `${flag} must not exist`);
  // The actor is taken from the execution context whenever one exists.
  assert.ok(
    /execution\?\.identity\s*\?\?/.test(code),
    'the derived identity must take precedence over the human field',
  );
});

// ---------------------------------------------------------------------------
// Infrastructure audit
// ---------------------------------------------------------------------------

const descriptor = {
  deploymentEnvironment: 'production',
  database: 'reqro_client_prod',
  databaseUser: 'reqro_operator',
  operation: 'activate',
  mode: 'confirm' as const,
  organizationId: '10000000-0000-4000-8000-000000000001',
  hostname: 'requests.example.gov',
  correlationId: '20000000-0000-4000-8000-000000000002',
};

test('the start record carries provenance and identity, and no secret', () => {
  const context = resolveServing(completeEnvironment());
  assert.ok(context);
  const record = startRecord(context, descriptor, NOW);
  assert.equal(record.phase, 'start');
  assert.equal(record.operatorIdentity, IDENTITY);
  assert.equal(record.commitSha, SHA);
  assert.equal(record.imageDigest, DIGEST);
  assert.equal(record.elevationRequestId, 'elev-01HQ8X');
  assert.equal(record.occurredAt, NOW.toISOString());
  assert.doesNotThrow(() => {
    assertAuditPayloadSafe(record);
  });

  const serialized = JSON.stringify(record);
  for (const forbidden of [
    'DATABASE_URL',
    'postgresql://',
    'password',
    'Bearer ',
    'PRIVATE KEY',
  ])
    assert.ok(
      !serialized.toLowerCase().includes(forbidden.toLowerCase()),
      `${forbidden} must never appear in an audit record`,
    );
});

test('a forbidden field name or a credential-shaped value is refused', () => {
  const verdicts: Record<string, string> = {};
  const payloads: Record<string, unknown> = {
    'database url key': { DATABASE_URL: 'x' },
    'nested password': { context: { db_password: 'x' } },
    'authorization header': { headers: { Authorization: 'x' } },
    'bearer value': { note: 'bearer abcdefghijklmnop' },
    'uri userinfo': { note: 'postgresql://user:pass@host:5432/db' },
    'pem block': { note: '-----BEGIN RSA PRIVATE KEY-----' },
    'array element': { items: [{ apiKey: 'x' }] },
  };
  for (const [label, payload] of Object.entries(payloads))
    verdicts[label] = refusalCode(() => {
      assertAuditPayloadSafe(payload);
    });
  assert.deepEqual(verdicts, {
    'database url key': 'audit_unavailable',
    'nested password': 'audit_unavailable',
    'authorization header': 'audit_unavailable',
    'bearer value': 'audit_unavailable',
    'uri userinfo': 'audit_unavailable',
    'pem block': 'audit_unavailable',
    'array element': 'audit_unavailable',
  });
  assert.ok(FORBIDDEN_AUDIT_KEYS.includes('database_url'));
  // A cyclic payload terminates rather than hanging.
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.doesNotThrow(() => {
    assertAuditPayloadSafe(cyclic);
  });
});

test('a serving environment must name a permitted audit adapter', () => {
  const verdicts: Record<string, string> = {};
  for (const [label, value] of [
    ['absent', undefined],
    ['memory', 'memory'],
    ['none', 'none'],
    ['unknown', 'syslog'],
  ] as const)
    verdicts[label] = refusalCode(() =>
      resolveAuditSink(
        value === undefined ? {} : { REQRO_OPERATOR_AUDIT_SINK: value },
        true,
      ),
    );
  assert.deepEqual(verdicts, {
    absent: 'audit_unavailable',
    memory: 'audit_unavailable',
    none: 'audit_unavailable',
    unknown: 'audit_unavailable',
  });
  assert.equal(
    resolveAuditSink({ REQRO_OPERATOR_AUDIT_SINK: 'stream' }, true).name,
    'stream',
  );
  // Outside a serving environment the in-memory adapter is the default.
  assert.equal(resolveAuditSink({}, false).name, 'memory');
});

test('execution does not begin if the start record cannot be established', async () => {
  const failing: OperatorAuditSink = {
    name: 'failing',
    recordStart: () => Promise.reject(new Error('transport down')),
    recordOutcome: () => Promise.resolve(),
  };
  const context = resolveServing(completeEnvironment());
  assert.ok(context);
  const record = startRecord(context, descriptor, NOW);
  assert.equal(
    await asyncRefusalCode(() => beginAuditedInvocation(failing, record)),
    'audit_unavailable',
  );
  // The refusal carries no transport detail.
  try {
    await beginAuditedInvocation(failing, record);
    assert.fail('expected a refusal');
  } catch (error) {
    assert.ok(error instanceof OperatorRefusal);
    assert.ok(!error.message.includes('transport down'));
  }
});

test('a lost outcome record is reported without replacing the real failure', async () => {
  const failing: OperatorAuditSink = {
    name: 'failing',
    recordStart: () => Promise.resolve(),
    recordOutcome: () => Promise.reject(new Error('transport down')),
  };
  assert.equal(
    await completeAuditedInvocation(failing, {
      phase: 'outcome',
      invocationId: 'i',
      occurredAt: NOW.toISOString(),
      outcome: 'failed',
      code: 'database_unavailable',
    }),
    false,
  );
  const memory = memoryAuditSink();
  assert.equal(
    await completeAuditedInvocation(memory, {
      phase: 'outcome',
      invocationId: 'i',
      occurredAt: NOW.toISOString(),
      outcome: 'succeeded',
      code: null,
    }),
    true,
  );
  assert.equal(memory.records.length, 1);
});

test('both audit phases are written, including for a refusal', async () => {
  const lines: string[] = [];
  const sink = streamAuditSink((line) => lines.push(line));
  const context = resolveServing(completeEnvironment());
  assert.ok(context);
  await beginAuditedInvocation(sink, startRecord(context, descriptor, NOW));
  await completeAuditedInvocation(sink, {
    phase: 'outcome',
    invocationId: context.invocationId,
    occurredAt: NOW.toISOString(),
    outcome: 'refused',
    code: 'approval_missing',
  });
  assert.equal(lines.length, 2);
  const [begun, ended] = lines.map(
    (line) => JSON.parse(line) as { audit: Record<string, unknown> },
  );
  assert.ok(begun);
  assert.ok(ended);
  assert.equal(begun.audit.phase, 'start');
  assert.equal(ended.audit.phase, 'outcome');
  assert.equal(ended.audit.outcome, 'refused');
  assert.equal(ended.audit.code, 'approval_missing');
  // The two records share the invocation identifier, which is what makes a
  // start without an outcome visible as a gap.
  assert.equal(begun.audit.invocationId, ended.audit.invocationId);
});

test('the audit boundary does not claim immutable off-host retention', () => {
  // Gate 8. The shipped adapter writes to the job's own error stream, so its
  // durability is the runner's log pipeline. Claiming more than that would
  // make an open production blocker look closed.
  const module = source('src/config/operator-audit.ts');
  for (const required of [
    /\*\*not\*\* immutable\s+\*?\s*off-host retention/i,
    /durability is entirely the runner/i,
  ])
    assert.match(module, required);
  assert.ok(
    /fail closed|fails closed/i.test(module),
    'the audit module must state the serving fail-closed rule',
  );
  // No claim of immutability or tamper-resistance for the shipped adapter.
  for (const overstatement of [
    /immutable (?:audit )?(?:log|sink|retention) is provided/i,
    /tamper[- ]proof/i,
    /guarantees? (?:durable|immutable) retention/i,
  ])
    assert.doesNotMatch(module, overstatement);

  // And the documents must keep recording it as an open blocker.
  for (const doc of [
    '../docs/architecture/decisions/ADR-028-trusted-production-operator-execution.md',
    '../docs/features/F060-3C-2E-trusted-operator-execution.md',
    '../docs/security/SECURITY_FRAMEWORK.md',
  ])
    assert.ok(
      /immutable off-host (?:audit )?retention remains an open infrastructure blocker/i.test(
        source(doc),
      ),
      `${doc} must record immutable off-host retention as an open blocker`,
    );
});

test('the command establishes the audit record before it builds a pool', () => {
  // Call sites, not import names: `indexOf` on a bare identifier would find
  // the import block at the top of the file and compare nothing useful.
  const cli = source('src/database/tenant-domain-operator-cli.ts');
  const audited = cli.indexOf('await beginAuditedInvocation(');
  const pool = cli.indexOf('new Kysely<DatabaseSchema>');
  const resolved = cli.indexOf('resolveTrustedExecution({');
  const permitted = cli.indexOf('assertPermitted(execution, verb)');
  for (const [label, index] of [
    ['audit start', audited],
    ['pool construction', pool],
    ['execution resolution', resolved],
    ['permission check', permitted],
  ] as const)
    assert.ok(index > 0, `${label} call site not found`);
  assert.ok(permitted > resolved, 'permission check must follow resolution');
  assert.ok(audited > permitted, 'audit must follow the permission check');
  assert.ok(audited < pool, 'audit must precede the database pool');
});

// ---------------------------------------------------------------------------
// The container build definition
// ---------------------------------------------------------------------------

test('the operator image runs the built artifact, is non-root and carries no credential', () => {
  const dockerfile = readFileSync(
    resolve(SERVER, 'deploy/operator/Dockerfile'),
    'utf8',
  );
  const lines = dockerfile
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));

  assert.ok(
    lines.some((line) =>
      line.startsWith(
        'ENTRYPOINT ["node", "dist/database/tenant-domain-operator-cli.js"]',
      ),
    ),
    'the entry point must be the compiled operator artifact',
  );
  assert.ok(
    !lines.some((line) => /\btsx\b/.test(line)),
    'the image must not run working-tree tsx',
  );
  assert.ok(lines.includes('USER node'), 'the image must not run as root');
  assert.ok(
    !lines.some((line) => line.startsWith('EXPOSE')),
    'a one-shot job exposes no port',
  );
  // No credential, and no DATABASE_URL default that could mask a missing
  // secret-manager injection.
  for (const line of lines)
    assert.ok(
      !/(PASSWORD|SECRET|TOKEN|DATABASE_URL|PGPASSWORD|credential)/i.test(line),
      `the image definition must carry no credential: ${line}`,
    );
  // The commit SHA is baked because it is a property of the build; the image
  // digest is not, because an image cannot know its own digest.
  assert.ok(lines.some((line) => line.includes('REQRO_OPERATOR_COMMIT_SHA')));
  assert.ok(
    !lines.some((line) => /^(ENV|ARG) REQRO_OPERATOR_IMAGE_DIGEST/.test(line)),
    'the image digest must be injected at run time, not baked',
  );
  // Provider neutral: no runner or registry vendor is selected here.
  for (const vendor of ['github', 'azure', 'gitlab', 'jenkins', 'ecr', 'acr'])
    assert.ok(
      !lines.some((line) => new RegExp(vendor, 'i').test(line)),
      `the image definition must not select ${vendor}`,
    );
});

// ---------------------------------------------------------------------------
// The closed failure-code set
// ---------------------------------------------------------------------------

test('every refusal code raised by the execution boundary is in the closed set', () => {
  const codes = new Set<string>(operatorFailureCodes);
  assert.equal(codes.size, operatorFailureCodes.length, 'no duplicates');
  for (const relative of [
    'src/config/operator-execution.ts',
    'src/config/operator-audit.ts',
  ])
    for (const match of source(relative).matchAll(/refuse\(\s*'([a-z_]+)'/g)) {
      const code = match[1] ?? '';
      assert.ok(
        codes.has(code),
        `${code} is raised but is not a declared operator failure code`,
      );
    }
  for (const added of [
    'execution_context_missing',
    'elevation_invalid',
    'runner_untrusted',
    'provenance_invalid',
    'permission_denied',
    'identity_override_rejected',
    'audit_unavailable',
  ])
    assert.ok(codes.has(added), added);
});
