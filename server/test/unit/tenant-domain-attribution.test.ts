import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  recordTenantDomainApproval,
  tenantDomainApprovableOperations,
} from '../../src/tenancy/tenant-domain.operations.js';

/** ADR-027 F060.3C-2a. These assert the validation that happens before any
 * database round trip, so a malformed operator attribution never reaches a
 * connection. The database enforces the same grammar independently; the
 * disposable PostgreSQL suite covers that side. */
const organizationId = '10000000-0000-4000-8000-000000000001';
const correlationId = '20000000-0000-4000-8000-000000000002';
const REASON = 'Planned onboarding for the approved resident hostname';

/** No query is ever issued: every case below is refused by validation, so a
 * client that throws on use proves the refusal happened first. */
const unusable = {
  transaction: () => {
    throw new Error('no database access expected');
  },
} as never;

function approvalInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId,
    hostname: 'requests.example.gov',
    expectedRevision: 3,
    operation: 'activated' as const,
    requestedBy: 'iam:user/alex',
    approvedBy: 'iam:user/sam',
    reason: REASON,
    correlationId,
    ...overrides,
  };
}

test('an operator identity must name an infrastructure scheme', async () => {
  for (const requestedBy of [
    '',
    '   ',
    'alex',
    'synthetic-operator',
    // A bare UUID is a staff-identity shape and carries no scheme.
    '30000000-0000-4000-8000-000000000003',
    'entra:user/alex',
    'iam:',
    'iam:/alex',
    'iam:user alex',
    'iam:user\talex',
    `iam:${'a'.repeat(200)}`,
  ])
    await assert.rejects(
      () =>
        recordTenantDomainApproval(unusable, approvalInput({ requestedBy })),
      /infrastructure operator identity/,
      JSON.stringify(requestedBy),
    );
});

test('an operator identity must not carry a secret-shaped value', async () => {
  // A long unbroken alphanumeric run is what a token looks like. The scheme
  // grammar accepts it, so this is a separate, deliberate refusal.
  await assert.rejects(
    () =>
      recordTenantDomainApproval(
        unusable,
        approvalInput({ requestedBy: 'iam:A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6' }),
      ),
    /secret-shaped value/,
  );
});

test('legitimate infrastructure identities are accepted by the grammar', async () => {
  // These must fail later, on the unusable client, rather than in validation.
  for (const requestedBy of [
    'iam:user/alex',
    'iam:role/platform-operator/alex@example.gov',
    // An OIDC subject is commonly a UUID; the scheme prefix is what makes it
    // unmistakable, so the hyphenated runs must stay acceptable.
    'oidc:40000000-0000-4000-8000-000000000004',
    'oidc:alex.taylor@example.gov',
    'dev:synthetic-operator',
    'iam:arn/aws/iam/123456789012/user/alex',
  ])
    await assert.rejects(
      () =>
        recordTenantDomainApproval(unusable, approvalInput({ requestedBy })),
      /no database access expected/,
      JSON.stringify(requestedBy),
    );
});

test('a reason must be substantive, bounded and free of control characters', async () => {
  for (const reason of ['', '  ', 'too short', 'a'.repeat(501)])
    await assert.rejects(
      () => recordTenantDomainApproval(unusable, approvalInput({ reason })),
      /operator reason of 12 to 500 characters/,
      JSON.stringify(reason),
    );
  await assert.rejects(
    () =>
      recordTenantDomainApproval(
        unusable,
        approvalInput({ reason: `Planned onboarding\u0007 for the hostname` }),
      ),
    /must not contain control characters/,
  );
});

test('a correlation id must be an explicit UUID', async () => {
  for (const value of ['', 'not-a-uuid', '1234'])
    await assert.rejects(
      () =>
        recordTenantDomainApproval(
          unusable,
          approvalInput({ correlationId: value }),
        ),
      /correlation UUID is required/,
      JSON.stringify(value),
    );
});

test('an approval cannot name one identity for both roles', async () => {
  await assert.rejects(
    () =>
      recordTenantDomainApproval(
        unusable,
        approvalInput({
          requestedBy: 'iam:user/alex',
          approvedBy: 'iam:user/alex',
        }),
      ),
    /requires a different approver/,
  );
});

test('only activation and revocation are approvable operations', async () => {
  assert.deepEqual(tenantDomainApprovableOperations, [
    'activated',
    'verification_revoked',
  ]);
  for (const operation of ['registered', 'verified', 'deactivated', ''])
    await assert.rejects(
      () => recordTenantDomainApproval(unusable, approvalInput({ operation })),
      /Only activation and revocation take an independent approval/,
      JSON.stringify(operation),
    );
});

/** Read from TypeScript source, not the emitted module: the schema file is
 * types only and compiles away, and these assertions are about what the
 * source is allowed to reference. */
function source(relative: string): string {
  return readFileSync(resolve(__dirname, '../../../src', relative), 'utf8');
}

test('no platform principal table is introduced by this slice', () => {
  // ADR-027 decision 3: platform authority stays infrastructure-rooted, and
  // nothing a tenant grant path can write may confer it. This slice therefore
  // adds attribution and approval evidence and no principal of its own.
  const schema = source('database/database.types.ts');
  for (const forbidden of [
    'platform_operator',
    'operator_grant',
    'control_plane',
    'platform_role',
    'platform_identity',
  ])
    assert.doesNotMatch(
      schema,
      new RegExp(forbidden),
      `${forbidden} must not enter the schema under this slice`,
    );
  assert.match(schema, /tenant_domain_operator_approval/);
});

test('operator control code reaches no application data', () => {
  // ADR-027 decision 4 control-plane separation, enforced as a boundary the
  // build checks rather than a convention. An allowlist, not a blocklist: a
  // newly reachable table fails this rather than slipping through.
  const operations = source('tenancy/tenant-domain.operations.ts');
  const reached = [
    ...operations.matchAll(
      /(?:insertInto|selectFrom|updateTable|deleteFrom)\('([a-z_]+)'\)/g,
    ),
  ].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(reached)].sort(),
    [
      'organization',
      'tenant_domain',
      'tenant_domain_audit',
      'tenant_domain_operator_approval',
      'tenant_domain_verification_attempt',
    ],
    'the operator path may reach Organization identity and status, the registry, verification evidence and operator attribution, and nothing else',
  );
  // Raw SQL could reach past the query builders, so the only template allowed
  // here is the dry-run constraint check.
  assert.deepEqual(
    [...operations.matchAll(/sql`([^`]*)`/g)].map((match) => match[1]),
    ['set constraints all immediate'],
  );
  assert.deepEqual(
    [
      ...new Set([...operations.matchAll(/from '([^']+)'/g)].map((m) => m[1])),
    ].sort(),
    [
      '../database/database.types.js',
      './tenant-domain-challenge.js',
      './tenant-domain-verifier.js',
      './tenant-domain.js',
      './tenant-hostname.js',
      'kysely',
    ],
  );
});
