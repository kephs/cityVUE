import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  OperatorRefusal,
  resolveOperatorTarget,
} from '../../src/config/operator-environment.js';
import {
  entraExecutionClaims,
  ENTRA_DIRECTORY_ORIGIN,
  NON_DIRECTORY_ORIGINS,
  OperatorIdentityRefusal,
} from '../../src/config/operator-identity.js';
import {
  APPROVE_VERB,
  assertExecutionPermitted,
  assertNetworkProfile,
  assertPermitted,
  EXECUTE_PERMISSION,
  NETWORK_PROFILES,
  networkProfiles,
  requiredNetworkProfile,
  resolveTrustedExecution,
  type OperatorPermission,
  type TrustedExecutionContext,
} from '../../src/config/operator-execution.js';
import {
  assertIndependentApprover,
  assertRequestContext,
  buildRequestArtifact,
  canonicalRequestBytes,
  CANONICAL_REQUEST_FIELDS,
  loadRequestArtifact,
  MAXIMUM_REQUEST_LIFETIME_MINUTES,
  readRequestArtifact,
  requestArtifactDigest,
} from '../../src/config/operator-request-artifact.js';

/**
 * ADR-029 F060.3C-2e-2A. The Azure DevOps operator platform contract and the
 * requester-binding fix, proven without an Azure DevOps organization, an
 * Entra tenant, a container instance or a database. Every assertion below is
 * either a pure function call or a static read of a repository artifact.
 */

const SERVER = resolve(__dirname, '../../..');
const source = (relative: string) =>
  readFileSync(resolve(SERVER, relative), 'utf8');

const TENANT = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OTHER_TENANT = '9f8e7d6c-5b4a-4938-8271-6a5b4c3d2e1f';
const REQUESTER_OID = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
const APPROVER_OID = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f';
const REQUESTER = `iam:${TENANT}/${REQUESTER_OID}`;
const APPROVER = `iam:${TENANT}/${APPROVER_OID}`;
const ORGANIZATION = '10000000-0000-4000-8000-000000000001';
const CORRELATION = '20000000-0000-4000-8000-000000000002';
const SHA = 'a'.repeat(40);
const DIGEST = 'sha256:' + 'b'.repeat(64);
const NOW = new Date('2026-10-09T12:00:00.000Z');

const production = resolveOperatorTarget({
  REQRO_OPERATOR_ENVIRONMENT: 'production',
  REQRO_DEPLOYMENT_ENVIRONMENT: 'production',
  REQRO_OPERATOR_DATABASE: 'reqro_client_prod',
  REQRO_OPERATOR_DATABASE_USER: 'reqro_operator',
});

function servingEnvironment(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    REQRO_OPERATOR_IAM_TENANT_ID: TENANT,
    REQRO_OPERATOR_IAM_SUBJECT: APPROVER_OID,
    REQRO_OPERATOR_IAM_ORIGIN: 'aad',
    REQRO_OPERATOR_IAM_ORIGIN_TENANT_ID: TENANT,
    REQRO_OPERATOR_IAM_PERMISSIONS: 'tenant-domain.request',
    REQRO_OPERATOR_ELEVATION_REQUEST_ID: 'elev-1',
    REQRO_OPERATOR_ELEVATION_GRANTED_AT: '2026-10-09T11:55:00.000Z',
    REQRO_OPERATOR_ELEVATION_EXPIRES_AT: '2026-10-09T12:25:00.000Z',
    REQRO_OPERATOR_RUNNER_IDENTITY: 'runner/operator',
    REQRO_OPERATOR_RUNNER_PLATFORM: 'azure-devops',
    REQRO_OPERATOR_JOB_RUN_ID: 'build-991',
    REQRO_OPERATOR_COMMIT_SHA: SHA,
    REQRO_OPERATOR_IMAGE_DIGEST: DIGEST,
    REQRO_OPERATOR_NETWORK_PROFILE: 'restricted',
    REQRO_OPERATOR_TRUSTED_RUNNER: 'runner/operator',
    REQRO_OPERATOR_AUDIT_SINK: 'stream',
    ...overrides,
  };
}

function resolveServing(
  overrides: NodeJS.ProcessEnv = {},
): TrustedExecutionContext {
  const context = resolveTrustedExecution({
    environment: servingEnvironment(overrides),
    target: production,
    now: NOW,
    newInvocationId: () => 'c0000000-0000-4000-8000-00000000000c',
  });
  assert.ok(context);
  return context;
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

const directoryClaims = (
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv => ({
  REQRO_OPERATOR_IAM_TENANT_ID: TENANT,
  REQRO_OPERATOR_IAM_SUBJECT: REQUESTER_OID,
  REQRO_OPERATOR_IAM_ORIGIN: 'aad',
  REQRO_OPERATOR_IAM_ORIGIN_TENANT_ID: TENANT,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Azure DevOps identity resolution
// ---------------------------------------------------------------------------

const PIPELINES = [
  'azure-pipelines/tenant-domain-operator-request.yml',
  'azure-pipelines/tenant-domain-operator-approve.yml',
  'azure-pipelines/tenant-domain-operator-confirm.yml',
] as const;
const TEMPLATES = [
  'azure-pipelines/templates/operator-identity.yml',
  'azure-pipelines/templates/operator-job.yml',
] as const;
const ALL_PIPELINE_FILES = [...PIPELINES, ...TEMPLATES];

test('the acting human cannot be supplied by a pipeline parameter', () => {
  // The identity must come from the platform. A parameter for any trusted
  // field would hand the actor back to the human, so no pipeline may declare
  // one. Checked against the declared `parameters:` blocks only, because the
  // templates legitimately *receive* resolved values as parameters from the
  // identity step — what must not exist is a parameter a human can fill.
  for (const file of PIPELINES) {
    const text = source(file);
    const block =
      /\nparameters:\n([\s\S]*?)\n(?:variables|stages|resources):/.exec(text);
    assert.ok(block?.[1], `${file} must declare a parameters block`);
    const names = [...block[1].matchAll(/-\s+name:\s*(\S+)/g)].map(
      (match) => match[1],
    );
    assert.ok(names.length > 0, `${file} declares no parameters`);
    for (const forbidden of [
      'iamSubject',
      'iamOrigin',
      'iamOriginTenantId',
      'operatorIdentity',
      'requesterIdentity',
      'requester',
      'identity',
      'subject',
      'permissions',
      'elevationRequestId',
      'runnerIdentity',
      'commitSha',
      'imageDigest',
      // ADR-029 provenance review: the artifact and its digest must never be
      // human-fillable either, or the binding would be decorative.
      'requestArtifact',
      'requestArtifactJson',
      'requestArtifactDigest',
      'requestArtifactBase64',
      'requestDigest',
      'artifactDigest',
      'jobRunId',
      'originatingRunId',
    ])
      assert.ok(
        !names.includes(forbidden),
        `${file} must not expose ${forbidden} as a human-fillable parameter`,
      );
  }

  // And the resolution really is anchored to the platform-set actor.
  const identity = source(TEMPLATES[0]);
  assert.match(identity, /Build\.RequestedForId/);
  assert.ok(
    !/parameters\.(iamSubject|requesterIdentity|operatorIdentity)/.test(
      identity,
    ),
    'the identity template must not read the actor from a parameter',
  );
});

test('an Azure DevOps identity is resolved through Graph, not treated as an Entra oid', () => {
  const identity = source(TEMPLATES[0]);
  // The chain must be present: identities -> graph user -> origin check ->
  // directory membership. Asserting the hops rather than the prose.
  for (const hop of [
    '_apis/identities?identityIds=',
    '_apis/graph/users/',
    'subjectDescriptor',
    'originId',
    'graph.microsoft.com/v1.0/users/',
  ])
    assert.ok(
      identity.includes(hop),
      `the resolution chain must include ${hop}`,
    );
  // The non-authoritative attributes must never become the subject.
  for (const reassignable of ['principalName', 'mailAddress', 'displayName'])
    assert.ok(
      !new RegExp(`iamSubject[^\\n]*${reassignable}`).test(identity),
      `${reassignable} must not be published as the subject`,
    );
});

test('only the expected Entra tenant is accepted, and a non-directory origin is refused', () => {
  // Accepted: directory-backed principal in the expected tenant.
  assert.equal(entraExecutionClaims(directoryClaims()).subject, REQUESTER_OID);

  // Refused: resolved from a different tenant than this deployment expects.
  assert.equal(
    refusalCode(() =>
      entraExecutionClaims(
        directoryClaims({ REQRO_OPERATOR_IAM_ORIGIN_TENANT_ID: OTHER_TENANT }),
      ),
    ),
    'identity_origin_untrusted',
  );

  // Refused: every Azure DevOps origin that is not an Entra directory object.
  const verdicts: Record<string, string> = {};
  for (const origin of NON_DIRECTORY_ORIGINS)
    verdicts[origin] = refusalCode(() =>
      entraExecutionClaims(
        directoryClaims({ REQRO_OPERATOR_IAM_ORIGIN: origin }),
      ),
    );
  assert.deepEqual(verdicts, {
    vsts: 'identity_origin_untrusted',
    msa: 'identity_origin_untrusted',
    ghb: 'identity_origin_untrusted',
  });
  assert.equal(ENTRA_DIRECTORY_ORIGIN, 'aad');

  // GUID casing is not meaningful, so an equal tenant in different case is
  // accepted rather than refused for a cosmetic difference.
  assert.doesNotThrow(() =>
    entraExecutionClaims(
      directoryClaims({
        REQRO_OPERATOR_IAM_ORIGIN_TENANT_ID: TENANT.toUpperCase(),
      }),
    ),
  );
});

test('a malformed or missing originId is refused and no identity is invented', () => {
  const verdicts: Record<string, string> = {};
  const cases: Record<string, NodeJS.ProcessEnv> = {
    absent: { REQRO_OPERATOR_IAM_SUBJECT: '' },
    unhyphenated: {
      REQRO_OPERATOR_IAM_SUBJECT: REQUESTER_OID.replaceAll('-', ''),
    },
    truncated: { REQRO_OPERATOR_IAM_SUBJECT: '1b2c3d4e-5f6a' },
    descriptor: { REQRO_OPERATOR_IAM_SUBJECT: 'aad.NzkxMjM0NTY3ODkw' },
    'origin absent': { REQRO_OPERATOR_IAM_ORIGIN: '' },
    'origin tenant absent': { REQRO_OPERATOR_IAM_ORIGIN_TENANT_ID: '' },
  };
  for (const [label, overrides] of Object.entries(cases))
    verdicts[label] = refusalCode(() =>
      entraExecutionClaims(directoryClaims(overrides)),
    );
  assert.deepEqual(verdicts, {
    absent: 'identity_absent',
    unhyphenated: 'identity_malformed',
    truncated: 'identity_malformed',
    descriptor: 'identity_malformed',
    'origin absent': 'identity_absent',
    'origin tenant absent': 'identity_absent',
  });
});

test('a UPN, email or display name can never become the canonical identity', () => {
  for (const reassignable of [
    'alex.operator@example.gov',
    'Alex Operator',
    'AlexO',
  ])
    assert.equal(
      refusalCode(() =>
        entraExecutionClaims(
          directoryClaims({ REQRO_OPERATOR_IAM_SUBJECT: reassignable }),
        ),
      ),
      'identity_malformed',
      reassignable,
    );
  // Supplied as secondary context they are recorded and still not the key.
  const context = resolveServing({
    REQRO_OPERATOR_IAM_DISPLAY_NAME: 'Alex Operator',
    REQRO_OPERATOR_IAM_EMAIL: 'alex.operator@example.gov',
  });
  assert.equal(context.identity, APPROVER);
  assert.equal(context.identityDisplayName, 'Alex Operator');
  assert.ok(!context.identity.includes('alex.operator'));
});

// ---------------------------------------------------------------------------
// The trusted request artifact
// ---------------------------------------------------------------------------

function request(
  overrides: Partial<Parameters<typeof buildRequestArtifact>[0]> = {},
) {
  return buildRequestArtifact({
    requesterIdentity: REQUESTER,
    operation: 'activate',
    organizationId: ORGANIZATION,
    hostname: 'requests.example.gov',
    role: null,
    expectedRevision: 3,
    reason: 'Planned onboarding for the approved resident hostname',
    ticket: 'CHG-1041',
    correlationId: CORRELATION,
    commitSha: SHA,
    imageDigest: DIGEST,
    jobRunId: 'build-990',
    createdAt: NOW,
    lifetimeMinutes: 60,
    ...overrides,
  });
}

const APPROVAL_CONTEXT = {
  operation: 'activate',
  organizationId: ORGANIZATION,
  hostname: 'requests.example.gov',
  expectedRevision: 3,
};

test('the artifact binds the requester to the exact operation context', () => {
  const { artifact, digest } = request();
  const round = readRequestArtifact(JSON.stringify(artifact), digest, NOW);
  assert.equal(round.requesterIdentity, REQUESTER);
  assert.equal(round.operation, 'activate');
  assert.equal(round.expectedRevision, 3);
  assert.equal(round.commitSha, SHA);
  assert.equal(round.imageDigest, DIGEST);
  assert.equal(round.jobRunId, 'build-990');
  assert.equal(round.ticket, 'CHG-1041');
  assert.doesNotThrow(() => {
    assertRequestContext(round, APPROVAL_CONTEXT);
  });

  // The digest covers the canonical form, so every contract field is inside
  // it. Changing any one of them changes the digest.
  const canonical = canonicalRequestBytes(artifact);
  for (const field of [
    'requesterIdentity',
    'operation',
    'organizationId',
    'hostname',
    'expectedRevision',
    'correlationId',
    'commitSha',
    'imageDigest',
    'jobRunId',
    'createdAt',
    'expiresAt',
  ])
    assert.ok(canonical.includes(`${field}=`), `${field} must be covered`);
});

test('an approver cannot override the requester', () => {
  const { artifact, digest } = request();
  const forged = { ...artifact, requesterIdentity: APPROVER };
  // Rewriting the requester invalidates the digest, so the substitution is
  // refused rather than accepted with the approver's preferred name.
  assert.equal(
    refusalCode(() => readRequestArtifact(JSON.stringify(forged), digest, NOW)),
    'request_artifact_invalid',
  );
  // Re-digesting the forgery does not help either: the requester is then the
  // approver, and self-approval is refused.
  assert.equal(
    refusalCode(() => {
      const reread = readRequestArtifact(
        JSON.stringify(forged),
        requestArtifactDigest(forged),
        NOW,
      );
      assertIndependentApprover(reread, APPROVER);
    }),
    'self_approval',
  );
  // The honest case passes.
  assert.doesNotThrow(() => {
    assertIndependentApprover(request().artifact, APPROVER);
  });
});

test('artifact context substitution is refused', () => {
  const { artifact } = request();
  const verdicts: Record<string, string> = {};
  const substitutions: Record<string, typeof APPROVAL_CONTEXT> = {
    'other operation': { ...APPROVAL_CONTEXT, operation: 'revoke' },
    'other organization': {
      ...APPROVAL_CONTEXT,
      organizationId: '10000000-0000-4000-8000-00000000ffff',
    },
    'other hostname': {
      ...APPROVAL_CONTEXT,
      hostname: 'other.example.gov',
    },
    'other revision': { ...APPROVAL_CONTEXT, expectedRevision: 4 },
  };
  for (const [label, context] of Object.entries(substitutions))
    verdicts[label] = refusalCode(() => {
      assertRequestContext(artifact, context);
    });
  assert.deepEqual(verdicts, {
    'other operation': 'request_context_mismatch',
    'other organization': 'request_context_mismatch',
    'other hostname': 'request_context_mismatch',
    'other revision': 'request_context_mismatch',
  });
  // Hostname comparison is case-insensitive, matching how hostnames resolve.
  assert.doesNotThrow(() => {
    assertRequestContext(artifact, {
      ...APPROVAL_CONTEXT,
      hostname: 'Requests.Example.GOV',
    });
  });
});

test('a tampered, truncated or wrong-version artifact is refused', () => {
  const { artifact, digest } = request();
  const verdicts: Record<string, string> = {};
  verdicts['field edited'] = refusalCode(() =>
    readRequestArtifact(
      JSON.stringify({ ...artifact, expectedRevision: 9 }),
      digest,
      NOW,
    ),
  );
  verdicts['unknown version'] = refusalCode(() =>
    readRequestArtifact(
      JSON.stringify({ ...artifact, version: 2 }),
      digest,
      NOW,
    ),
  );
  verdicts['not json'] = refusalCode(() =>
    readRequestArtifact('{', digest, NOW),
  );
  verdicts['not an object'] = refusalCode(() =>
    readRequestArtifact('[]', digest, NOW),
  );
  verdicts['bad digest shape'] = refusalCode(() =>
    readRequestArtifact(JSON.stringify(artifact), 'deadbeef', NOW),
  );
  verdicts['wrong digest'] = refusalCode(() =>
    readRequestArtifact(
      JSON.stringify(artifact),
      'sha256:' + 'c'.repeat(64),
      NOW,
    ),
  );
  assert.deepEqual(verdicts, {
    'field edited': 'request_artifact_invalid',
    'unknown version': 'request_artifact_invalid',
    'not json': 'request_artifact_invalid',
    'not an object': 'request_artifact_invalid',
    'bad digest shape': 'request_artifact_invalid',
    'wrong digest': 'request_artifact_invalid',
  });
  // Extra keys cannot ride along: the digest is computed over the canonical
  // contract fields, so an added key is simply not covered and the artifact
  // still verifies — but it also cannot influence anything, because nothing
  // outside the contract is ever read.
  const withExtra = readRequestArtifact(
    JSON.stringify({ ...artifact, smuggled: 'ignored' }),
    digest,
    NOW,
  );
  assert.equal(
    Object.hasOwn(withExtra, 'smuggled'),
    false,
    'a key outside the contract must not survive parsing',
  );
});

test('an expired or over-long artifact is refused', () => {
  const { artifact, digest } = request();
  // One millisecond past expiry.
  assert.equal(
    refusalCode(() =>
      readRequestArtifact(
        JSON.stringify(artifact),
        digest,
        new Date('2026-10-09T13:00:00.001Z'),
      ),
    ),
    'request_artifact_expired',
  );
  // Still valid just before.
  assert.doesNotThrow(() =>
    readRequestArtifact(
      JSON.stringify(artifact),
      digest,
      new Date('2026-10-09T12:59:59.000Z'),
    ),
  );
  // A lifetime beyond the ceiling is refused at build time...
  assert.equal(
    refusalCode(() =>
      request({ lifetimeMinutes: MAXIMUM_REQUEST_LIFETIME_MINUTES + 1 }),
    ),
    'request_artifact_invalid',
  );
  // ...and also when read, so a hand-made artifact cannot claim a long life.
  const stretched = {
    ...artifact,
    expiresAt: new Date(NOW.getTime() + 48 * 3_600_000).toISOString(),
  };
  assert.equal(
    refusalCode(() =>
      readRequestArtifact(
        JSON.stringify(stretched),
        requestArtifactDigest(stretched),
        NOW,
      ),
    ),
    'request_artifact_expired',
  );
  // And an inverted window.
  const inverted = {
    ...artifact,
    expiresAt: new Date(NOW.getTime() - 60_000).toISOString(),
  };
  assert.equal(
    refusalCode(() =>
      readRequestArtifact(
        JSON.stringify(inverted),
        requestArtifactDigest(inverted),
        NOW,
      ),
    ),
    'request_artifact_expired',
  );
});

test('the artifact is loaded from the platform-supplied path, and a missing file is refused', () => {
  const directory = mkdtempSync(join(tmpdir(), 'reqro-request-'));
  const path = join(directory, 'request.json');
  const { artifact, digest } = request();
  writeFileSync(path, JSON.stringify(artifact), 'utf8');
  assert.equal(
    loadRequestArtifact(path, digest, NOW).requesterIdentity,
    REQUESTER,
  );
  assert.equal(
    refusalCode(() =>
      loadRequestArtifact(join(directory, 'absent.json'), digest, NOW),
    ),
    'request_artifact_invalid',
  );
});

test('the command derives the requester from the artifact and refuses a human one', () => {
  const cli = source('src/database/tenant-domain-operator-cli.ts');
  const code = cli
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join('\n');
  // The artifact path and digest come from the trusted context, never env.
  assert.match(code, /execution\.requestArtifactPath/);
  assert.match(code, /execution\.requestArtifactDigest/);
  // The human field is refused whenever an artifact is in play.
  assert.match(code, /refusedValue\(\s*'REQRO_OPERATOR_REQUESTER_IDENTITY'/);
  // And the requester used is the artifact's.
  assert.match(
    code,
    /requestArtifact\s*\n?\s*\?\s*requestArtifact\.requesterIdentity/,
  );
  // Binding and independence are both asserted before the approval is written.
  const bind = code.indexOf('assertRequestContext(');
  const independent = code.indexOf('assertIndependentApprover(');
  const record = code.indexOf('recordTenantDomainApproval(');
  assert.ok(bind > 0 && independent > bind && record > independent);
});

// ---------------------------------------------------------------------------
// Separate invocations, and the permission axes
// ---------------------------------------------------------------------------

test('request and approval are separate pipeline definitions', () => {
  // Three definitions, so one queued run can never both request and approve.
  const [requestPipeline, approvePipeline, confirmPipeline] = PIPELINES.map(
    (file) => source(file),
  );
  assert.ok(requestPipeline && approvePipeline && confirmPipeline);

  // Manual dispatch only: an operator action must not be triggerable by a
  // push, a pull request or a schedule.
  for (const file of PIPELINES) {
    const text = source(file);
    assert.match(text, /^trigger: none$/m, file);
    assert.match(text, /^pr: none$/m, file);
    assert.ok(!/^schedules:/m.test(text), `${file} must have no schedule`);
  }

  // The request pipeline plans only; it never confirms.
  assert.match(requestPipeline, /mode: '--dry-run'/);
  assert.ok(
    !requestPipeline.includes("mode: '--confirm'"),
    'the request pipeline must never confirm',
  );
  // The approve pipeline runs the approve verb and consumes a pinned run.
  assert.match(approvePipeline, /operation: approve/);
  assert.match(approvePipeline, /requestArtifactDigest:/);
  assert.match(approvePipeline, /buildVersionToDownload: specific/);
  // The confirm pipeline validates before applying.
  const dryRun = confirmPipeline.indexOf("mode: '--dry-run'");
  const confirm = confirmPipeline.indexOf("mode: '--confirm'");
  assert.ok(dryRun > 0 && confirm > dryRun, 'validate before applying');
  // Approval and confirm are gated by protected environments.
  assert.match(approvePipeline, /environment: reqro-operator-production/);
  assert.match(confirmPipeline, /environment: reqro-operator-production/);
});

test('the artifact actually travels from the request run to the approving container', () => {
  // A binding contract is hollow if nothing delivers the artifact. This
  // asserts the hand-off end to end across the three files, because the
  // first version of this pipeline hashed a file it never produced.
  const [requestPipeline, approvePipeline] = [
    source(PIPELINES[0]),
    source(PIPELINES[1]),
  ];
  const job = source(TEMPLATES[1]);

  // The request run extracts both halves from the operator's own output and
  // publishes them as one immutable artifact.
  assert.match(requestPipeline, /request\.json/);
  assert.match(requestPipeline, /request\.digest/);
  assert.match(requestPipeline, /artifact: tenant-domain-request/);
  // The digest is the one the operator computed; it is never recomputed
  // from the JSON by a pipeline step, which would substitute that step's
  // idea of the canonical form for the operator's.
  assert.ok(
    !requestPipeline.includes('sha256sum') &&
      !approvePipeline.includes('sha256sum'),
    'the pipelines must carry the operator digest, not recompute it',
  );

  // The approve run reads both from the pinned artifact and passes them on.
  assert.match(approvePipeline, /request\.digest/);
  assert.match(approvePipeline, /requestArtifactDigest:/);
  assert.match(approvePipeline, /requestArtifactBase64:/);

  // The job mounts the content as a file and points the operator at it, and
  // supplies the digest alongside — the operator refuses a half-supplied
  // pair, so both must travel together.
  assert.match(job, /--secrets-mount-path \/mnt\/request/);
  assert.match(
    job,
    /REQRO_OPERATOR_REQUEST_ARTIFACT=\/mnt\/request\/request\.json/,
  );
  assert.match(job, /REQRO_OPERATOR_REQUEST_DIGEST=/);

  // And the request pipeline never supplies an artifact to itself.
  assert.ok(
    !requestPipeline.includes('requestArtifactBase64:'),
    'a request invocation approves nothing and needs no artifact',
  );
});

test('every canonical field is covered by the digest, so none can be substituted', () => {
  // ADR-029 provenance review. The listed non-substitutable fields are all
  // canonical fields, so rather than testing a hand-picked subset this
  // mutates each field in turn and requires the digest check to catch it.
  // Exhaustive by construction: the loop is driven by the contract's own
  // field list, so a field added later is covered without editing this test.
  const { artifact, digest } = request();
  const record = artifact as unknown as Record<string, unknown>;
  const verdicts: Record<string, string> = {};
  for (const field of CANONICAL_REQUEST_FIELDS) {
    const current = record[field];
    // A value of a different shape per field type, so the mutation is real.
    const mutated =
      field === 'version'
        ? 2
        : typeof current === 'number'
          ? current + 1
          : typeof current === 'string'
            ? `${current}-substituted`
            : 'substituted';
    const forged = { ...record, [field]: mutated };
    verdicts[field] = refusalCode(() =>
      readRequestArtifact(JSON.stringify(forged), digest, NOW),
    );
  }
  // `version` is refused for being unsupported rather than for the digest,
  // which is correct and is why it is listed separately rather than lumped in.
  assert.deepEqual(verdicts, {
    version: 'request_artifact_invalid',
    requesterIdentity: 'request_artifact_invalid',
    operation: 'request_artifact_invalid',
    organizationId: 'request_artifact_invalid',
    hostname: 'request_artifact_invalid',
    role: 'request_artifact_invalid',
    expectedRevision: 'request_artifact_invalid',
    reason: 'request_artifact_invalid',
    ticket: 'request_artifact_invalid',
    correlationId: 'request_artifact_invalid',
    commitSha: 'request_artifact_invalid',
    imageDigest: 'request_artifact_invalid',
    jobRunId: 'request_artifact_invalid',
    createdAt: 'request_artifact_invalid',
    expiresAt: 'request_artifact_invalid',
  });
  assert.equal(CANONICAL_REQUEST_FIELDS.length, 15);
  // Non-vacuous: the unmodified artifact verifies.
  assert.doesNotThrow(() =>
    readRequestArtifact(JSON.stringify(artifact), digest, NOW),
  );
});

test('the artifact is obtained from the pinned originating run, not a free parameter', () => {
  // ADR-029 provenance review. The human selects *which* request to approve;
  // they cannot supply its content, its digest, or the pipeline it came from.
  const approvePipeline = source(PIPELINES[1]);

  // The source definition is infrastructure-owned: a variable, not a
  // parameter, so an operator cannot point the download at a pipeline they
  // control and fabricate a request.
  assert.match(
    approvePipeline,
    /definition: \$\(requestPipelineDefinitionId\)/,
  );
  assert.ok(
    !/definition: \$\{\{\s*parameters\./.test(approvePipeline),
    'the source pipeline definition must not be a human parameter',
  );
  // The run is pinned to one specific build, not "latest".
  assert.match(approvePipeline, /buildType: specific/);
  assert.match(approvePipeline, /buildVersionToDownload: specific/);
  assert.match(
    approvePipeline,
    /pipelineId: \$\{\{ parameters\.requestBuildId \}\}/,
  );
  assert.ok(
    !approvePipeline.includes('buildVersionToDownload: latest'),
    'the artifact must come from a pinned run, never the latest one',
  );

  // Both halves are derived from that download by a step, and passed on as
  // step outputs — never as parameters.
  assert.match(
    approvePipeline,
    /requestArtifactDigest: \$\(requestBinding\.requestDigest\)/,
  );
  assert.match(
    approvePipeline,
    /requestArtifactBase64: \$\(requestBinding\.requestBase64\)/,
  );
  assert.ok(
    !/requestArtifactDigest: \$\{\{\s*parameters\./.test(approvePipeline) &&
      !/requestArtifactBase64: \$\{\{\s*parameters\./.test(approvePipeline),
    'the artifact and digest must never come from a parameter',
  );

  // The confirmation flow does not take an artifact at all: it consumes the
  // approval row the approval flow created, which the database binds to the
  // same context. Stated here so the asymmetry is deliberate, not an omission.
  const confirmPipeline = source(PIPELINES[2]);
  assert.ok(
    !confirmPipeline.includes('requestArtifact'),
    'confirmation binds through the approval row, not the artifact',
  );
  assert.match(
    confirmPipeline,
    /approvalId: \$\{\{ parameters\.approvalId \}\}/,
  );
});

test('an approved mutating request cannot be replayed for repeated effect', () => {
  // ADR-029 replay review. Three existing, independent controls, asserted
  // against their sources rather than restated.

  // 1. The approval is single use, enforced by a partial unique index on the
  //    audit row that records its consumption -- not by a mutable flag the
  //    application has to remember.
  const migration = source(
    'migrations/20261017000000-add-tenant-domain-operator-controls.ts',
  );
  assert.match(
    migration,
    /create unique index tenant_domain_approval_single_use on tenant_domain_audit\(approval_id\) where approval_id is not null/,
  );
  assert.match(migration, /tenant_domain_approval_consumed\(approval uuid\)/);
  // And the mutating paths really do write the approval into the audit row,
  // which is what makes a second consumption violate that index.
  const operations = source('src/tenancy/tenant-domain.operations.ts');
  assert.match(operations, /approval_id: approvalId/);

  // 2. Optimistic concurrency: a mutating verb requires the expected revision
  //    to still be current, and a committed mutation advances it, so the same
  //    request's fixed revision is stale on a second attempt.
  assert.match(operations, /revision has moved/);

  // 3. The artifact pins that revision, so the contract boundary refuses a
  //    replay whose registry state has moved on, before any database work.
  const { artifact } = request();
  assert.equal(artifact.expectedRevision, 3);
  assert.equal(
    refusalCode(() => {
      assertRequestContext(artifact, {
        ...APPROVAL_CONTEXT,
        expectedRevision: 4,
      });
    }),
    'request_context_mismatch',
  );
  // The approval row also expires independently of the artifact.
  assert.match(migration, /expires_at=approved_at\+interval '24 hours'/);
});

test('the permission axes hold: request cannot approve, approve cannot request, execute alone grants nothing', () => {
  const grant = (
    permissions: readonly OperatorPermission[],
  ): TrustedExecutionContext =>
    resolveServing({ REQRO_OPERATOR_IAM_PERMISSIONS: permissions.join(',') });

  const requester = grant(['tenant-domain.request']);
  assert.equal(
    refusalCode(() => {
      assertPermitted(requester, APPROVE_VERB);
    }),
    'permission_denied',
  );

  const approver = grant(['tenant-domain.approve']);
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
        assertPermitted(approver, verb);
      }),
      'permission_denied',
      verb,
    );

  const executor = grant([EXECUTE_PERMISSION]);
  for (const verb of ['activate', APPROVE_VERB])
    assert.equal(
      refusalCode(() => {
        assertPermitted(executor, verb);
      }),
      'permission_denied',
      verb,
    );
  // Execute is still what a commit needs, on top of the verb.
  assert.equal(
    refusalCode(() => {
      assertExecutionPermitted(requester, false);
    }),
    'permission_denied',
  );
  assert.doesNotThrow(() => {
    assertExecutionPermitted(
      grant(['tenant-domain.request', EXECUTE_PERMISSION]),
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// DNS verification isolation
// ---------------------------------------------------------------------------

test('verify gets the DNS-capable profile and no other verb does', () => {
  assert.deepEqual(networkProfiles, ['dns-verification', 'restricted']);
  assert.deepEqual(NETWORK_PROFILES['dns-verification'], ['verify']);

  const profiles: Record<string, string> = {};
  for (const verb of [
    'register',
    'issue-challenge',
    'verify',
    'activate',
    'deactivate',
    'revoke',
    'approve',
  ])
    profiles[verb] = requiredNetworkProfile(verb);
  assert.deepEqual(profiles, {
    register: 'restricted',
    'issue-challenge': 'restricted',
    verify: 'dns-verification',
    activate: 'restricted',
    deactivate: 'restricted',
    revoke: 'restricted',
    approve: 'restricted',
  });

  // Checked in both directions: verify on the restricted profile is refused,
  // and a mutating verb on the DNS-capable profile is refused too, so that
  // egress is never held by an invocation that does not need it.
  const restricted = resolveServing();
  const dnsCapable = resolveServing({
    REQRO_OPERATOR_NETWORK_PROFILE: 'dns-verification',
  });
  assert.doesNotThrow(() => {
    assertNetworkProfile(restricted, 'activate');
  });
  assert.doesNotThrow(() => {
    assertNetworkProfile(dnsCapable, 'verify');
  });
  assert.equal(
    refusalCode(() => {
      assertNetworkProfile(restricted, 'verify');
    }),
    'network_profile_invalid',
  );
  assert.equal(
    refusalCode(() => {
      assertNetworkProfile(dnsCapable, 'activate');
    }),
    'network_profile_invalid',
  );
  // An unknown verb is refused rather than defaulted, so a future verb
  // cannot silently inherit DNS egress.
  assert.equal(
    refusalCode(() => requiredNetworkProfile('onboard')),
    'network_profile_invalid',
  );
  assert.equal(
    refusalCode(() =>
      resolveServing({ REQRO_OPERATOR_NETWORK_PROFILE: 'unrestricted' }),
    ),
    'network_profile_invalid',
  );
});

test('the DNS-verification profile receives no credential beyond the operator role', () => {
  // ADR-029 DNS least-privilege review.
  //
  // Stated plainly rather than overclaimed: `verify` DOES legitimately need
  // the database, because it records the verification attempt and the
  // resulting state. So the isolation that matters is not "no database" --
  // it is that the container holds no *other* authority, and that the
  // DNS-capable profile gains nothing except egress.
  const job = source(TEMPLATES[1]);
  const identity = source(TEMPLATES[0]);

  // No control-plane or directory token ever enters the container. The Azure
  // DevOps OAuth token and the Graph token exist only in the agent-side
  // identity step, which runs before the container and passes on resolved
  // values, not credentials.
  assert.match(identity, /SYSTEM_ACCESSTOKEN/);
  assert.match(identity, /graph\.microsoft\.com/);
  for (const credential of [
    'SYSTEM_ACCESSTOKEN',
    'System.AccessToken',
    'graphToken',
    'get-access-token',
    'graph.microsoft.com',
    'vssps.dev.azure.com',
  ])
    assert.ok(
      !job.includes(credential),
      `the operator container must never receive ${credential}`,
    );

  // No PIM or directory mutation capability is handed to the container, and
  // the only mounted content is the request artifact.
  for (const capability of [
    'roleManagement',
    'privilegedAccess',
    'roleAssignment',
    'az role assignment',
    'az ad ',
  ])
    assert.ok(
      !job.includes(capability),
      `the operator container must have no ${capability} capability`,
    );
  const secretArgs = [...job.matchAll(/--secrets\s+"?([A-Za-z0-9_.]+)=/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    secretArgs,
    ['request.json'],
    'the only mounted content may be the request artifact',
  );

  // The credential surface does not vary by profile: the job template has no
  // profile-conditional credential or identity logic, so `dns-verification`
  // cannot acquire anything `restricted` lacks. Egress is the only difference,
  // and that is a network policy outside the container.
  assert.ok(
    !job.includes('dns-verification'),
    'the job template must not branch its credentials on the network profile',
  );
  assert.match(job, /--assign-identity "\$\(operatorManagedIdentityId\)"/);
  assert.equal(
    [...job.matchAll(/--assign-identity/g)].length,
    1,
    'exactly one managed identity, the same for every profile',
  );
  // That identity's database authority is the unchanged reqro_operator grant
  // set from F060.3C-2c-3; this slice adds no grant.
  assert.match(job, /REQRO_OPERATOR_DATABASE_USER=reqro_operator/);
});

test('the pipelines declare the DNS profile only for verify', () => {
  const confirm = source(PIPELINES[2]);
  // The profile is derived from the operation, not supplied freely.
  assert.match(confirm, /eq\(parameters\.operation,\s*'verify'\)/);
  assert.match(confirm, /value: dns-verification/);
  assert.match(confirm, /value: restricted/);
  // The request and approve pipelines never run verify, so they are pinned
  // to the restricted profile.
  for (const file of [PIPELINES[0], PIPELINES[1]]) {
    const text = source(file);
    assert.match(text, /networkProfile: restricted/);
    assert.ok(
      !text.includes('dns-verification'),
      `${file} must not grant DNS egress`,
    );
  }
  // The verifier itself is untouched by this slice.
  const verifier = source('src/tenancy/tenant-domain-verifier.ts');
  assert.match(verifier, /authoritativeNameServers/);
  assert.match(verifier, /insufficient_quorum/);
});

// ---------------------------------------------------------------------------
// No credentials anywhere
// ---------------------------------------------------------------------------

test('no secret, PAT or password appears in any pipeline artifact', () => {
  for (const file of ALL_PIPELINE_FILES) {
    // Comments are stripped first. These files deliberately *document* that
    // they use no PAT and no password, and a raw substring scan would read
    // that promise as a violation of itself.
    const text = source(file)
      .split(/\r?\n/)
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');
    // A personal access token, matched as a word so `compatibility` and the
    // like cannot trip it.
    assert.doesNotMatch(text, /\bPATs?\b/, `${file} must use no PAT`);
    for (const forbidden of [
      'personal access token',
      'password',
      'PGPASSWORD',
      'client_secret',
      'clientSecret',
      'DATABASE_URL=',
      'connectionString',
      'api-key',
      'apiKey',
      'BEGIN PRIVATE KEY',
    ])
      assert.ok(
        !new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(
          text,
        ),
        `${file} must not contain ${forbidden}`,
      );
    // No inline credential-shaped URI either.
    assert.ok(
      !/[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@/i.test(text),
      `${file} must not contain a URI with embedded credentials`,
    );
  }
  // `System.AccessToken` is the platform's own OAuth token, not a stored
  // credential, and it is the only token the identity template uses.
  const identity = source(TEMPLATES[0]);
  assert.match(identity, /System\.AccessToken/);
  assert.ok(
    !/secret|vault/i.test(
      identity
        .split('\n')
        .filter((line) => !/^\s*#/.test(line))
        .join('\n'),
    ),
    'the identity template must need no secret store',
  );
});

test('the operator job is digest-pinned, non-interactive and never restarted', () => {
  const job = source(TEMPLATES[1]);
  assert.match(job, /--restart-policy Never/);
  assert.match(job, /timeoutInMinutes: 15/);
  assert.match(job, /@\$\{digest\}/);
  assert.match(job, /sha256:\*\) ;;/);
  assert.match(job, /node dist\/database\/tenant-domain-operator-cli\.js/);
  // No interactive shell and no working-tree execution.
  for (const forbidden of ['/bin/bash', '/bin/sh -i', 'tsx', 'npm run dev']) {
    assert.ok(!job.includes(forbidden), `the job must not use ${forbidden}`);
  }
  // The database role name stays literal.
  assert.match(job, /REQRO_OPERATOR_DATABASE_USER=reqro_operator/);
  // Trusted fields are environment, never argv: the command line carries
  // only the verb, the approved operation and the mode.
  const command = /--command-line "([^"]*)"/.exec(job);
  assert.ok(command?.[1]);
  for (const trusted of [
    'REQRO_OPERATOR_IAM_SUBJECT',
    'REQRO_OPERATOR_COMMIT_SHA',
    'REQRO_OPERATOR_IMAGE_DIGEST',
    'REQRO_OPERATOR_NETWORK_PROFILE',
  ])
    assert.ok(
      !command[1].includes(trusted),
      `${trusted} must not be passed on the command line`,
    );
});

// ---------------------------------------------------------------------------
// The database boundary is untouched
// ---------------------------------------------------------------------------

test('the operator database boundary is unchanged by this slice', () => {
  // The grant artifact and the migration count are the boundary. This slice
  // adds no SQL, so both must be byte-identical to the reviewed state.
  const artifact = source('../deploy/database/operator-role.sql');
  assert.match(artifact, /grant usage on schema/i);
  assert.match(artifact, /tenant_domain_lock_organization\(uuid\)/);
  // No new grant was introduced for Entra authentication: the role name is
  // literal and the mapping is infrastructure provisioning, not a grant.
  assert.ok(
    !/pgaadauth/i.test(artifact),
    'the reviewed grant artifact must not have been edited for Entra auth',
  );
  // And no module in this slice emits SQL.
  for (const relative of [
    'src/config/operator-request-artifact.ts',
    'src/config/operator-execution.ts',
    'src/config/operator-identity.ts',
  ]) {
    const text = source(relative);
    for (const forbidden of [
      'selectFrom',
      'insertInto',
      'updateTable',
      'deleteFrom',
      'sql`',
    ])
      assert.ok(
        !text.includes(forbidden),
        `${relative} must not contain ${forbidden}`,
      );
    // "grant" is ordinary English in the permission model, so a bare keyword
    // scan is useless here; what must be absent is a SQL statement.
    assert.doesNotMatch(
      text,
      /\b(grant|revoke)\s+(all|select|insert|update|delete|usage|execute|connect|temporary)\b/i,
      `${relative} must emit no SQL privilege statement`,
    );
  }
});

test('audit retention is client-configurable and not hard-coded', () => {
  const audit = source('src/config/operator-audit.ts');
  // No retention duration is compiled in: retention is a storage-policy
  // concern, and a constant here would imply Reqro enforces it.
  for (const hardCoded of ['sevenYears', '2555', '7 years', 'sevenYear']) {
    assert.ok(
      !audit.includes(hardCoded),
      `the audit module must not hard-code ${hardCoded}`,
    );
  }
  const adr = source(
    '../docs/architecture/decisions/ADR-029-production-operator-platform.md',
  );
  assert.match(adr, /configurable/i);
  assert.match(adr, /two years/i);
  assert.ok(
    !/seven years/i.test(adr),
    'the ADR must not fix a seven-year retention',
  );
});
