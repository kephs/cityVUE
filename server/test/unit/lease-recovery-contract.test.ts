import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  attemptOutcomes,
  integrationAttemptReasonCodes,
  isAuthorizedAttemptSettlement,
  isIntegrationAttemptReasonCode,
  type AttemptOutcome,
  type IntegrationAttemptReasonCode,
} from '../../src/integration/delivery-contract.js';
import {
  integrationFailureCategories,
  transientIntegrationFailures,
  type IntegrationFailureCategory,
} from '../../src/integration/integration-envelope.js';

/**
 * F062.2D-2C-1 — contract parity between the TypeScript authority and the SQL
 * that persists it.
 *
 * The migration is read as text, so a vocabulary or shape that drifts between
 * the two is a test failure rather than a discovery. The live database side of
 * the same parity is proven in
 * `test/database/integration-lease-recovery-evidence.integration.test.ts`
 * against `pg_get_constraintdef`.
 */

const MIGRATION = resolve(
  __dirname,
  '../../../migrations/20261024000000-add-integration-lease-recovery-evidence.ts',
);

function migration(): string {
  return readFileSync(MIGRATION, 'utf8');
}

/** Executable SQL only: comments stripped, so a prohibition stated in a
 * comment does not flag itself. */
function executable(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\r\n]*/g, '$1 ')
    .replace(/(^|\n)\s*--[^\r\n]*/g, '$1 ');
}

// ---------------------------------------------------------------------------
// Vocabulary parity
// ---------------------------------------------------------------------------

test('the reason-code vocabulary is exactly the two authorized values', () => {
  assert.deepEqual(
    [...integrationAttemptReasonCodes],
    ['lease_expired_pre_dispatch', 'lease_expired_uncertain'],
  );
  // No duplicates, and the guard agrees with the array in both directions.
  assert.equal(
    new Set(integrationAttemptReasonCodes).size,
    integrationAttemptReasonCodes.length,
  );
  for (const value of integrationAttemptReasonCodes)
    assert.ok(isIntegrationAttemptReasonCode(value));
  for (const rejected of [
    'fenced_stale_completion',
    'internal_failure',
    'lease_expired',
    'LEASE_EXPIRED_PRE_DISPATCH',
    '',
  ])
    assert.equal(isIntegrationAttemptReasonCode(rejected), false, rejected);
});

test('the SQL vocabulary equals the TypeScript vocabulary, both directions', () => {
  const code = executable(migration());
  const clause =
    /add constraint integration_attempt_reason_code_vocabulary[\s\S]*?\)\),/.exec(
      code,
    )?.[0] ?? '';
  assert.notEqual(clause, '', 'the vocabulary constraint must exist');
  const inSql = [...clause.matchAll(/'([a-z_]+)'/g)].map(
    (match) => match[1] ?? '',
  );
  assert.deepEqual(
    [...inSql].sort(),
    [...integrationAttemptReasonCodes].sort(),
  );
});

test('no reason code duplicates a destination failure category', () => {
  // The two namespaces answer different questions, so no value may appear in
  // both. A shared spelling would make the evidence ambiguous about which
  // question it answered.
  for (const reason of integrationAttemptReasonCodes)
    assert.equal(
      (integrationFailureCategories as readonly string[]).includes(reason),
      false,
      `${reason} collides with the destination taxonomy`,
    );
});

test('the destination taxonomy and the transient set are unchanged', () => {
  // This slice must not broaden what is automatically retryable.
  assert.equal(integrationFailureCategories.length, 10);
  assert.deepEqual(
    [...transientIntegrationFailures],
    ['destination_unavailable', 'rate_limited'],
  );
  assert.equal(
    (transientIntegrationFailures as readonly string[]).includes(
      'internal_failure',
    ),
    false,
    'internal_failure must never be automatically retryable',
  );
  assert.equal(
    (transientIntegrationFailures as readonly string[]).includes(
      'destination_timeout',
    ),
    false,
    'a timeout may already have taken effect and is never transient',
  );
});

// ---------------------------------------------------------------------------
// The settlement matrix
// ---------------------------------------------------------------------------

test('the settlement matrix authorizes exactly the reviewed shapes', () => {
  const outcomes: readonly (AttemptOutcome | null)[] = [
    null,
    ...attemptOutcomes,
  ];
  const categories: readonly (IntegrationFailureCategory | null)[] = [
    null,
    ...integrationFailureCategories,
  ];
  const reasons: readonly (IntegrationAttemptReasonCode | null)[] = [
    null,
    ...integrationAttemptReasonCodes,
  ];

  const authorized: string[] = [];
  for (const outcome of outcomes)
    for (const failureCategory of categories)
      for (const reasonCode of reasons)
        for (const dispatchStarted of [false, true])
          if (
            isAuthorizedAttemptSettlement({
              outcome,
              failureCategory,
              reasonCode,
              dispatchStarted,
            })
          )
            authorized.push(
              [
                outcome ?? 'open',
                failureCategory ?? '-',
                reasonCode ?? '-',
                dispatchStarted ? 'marked' : 'unmarked',
              ].join('/'),
            );

  // The enumeration is complete, so the count is a property rather than an
  // anecdote: 5 outcomes x 11 categories x 3 reasons x 2 boundary states.
  assert.equal(outcomes.length * categories.length * reasons.length * 2, 330);

  // 2 open + 2 success + 1 shape C + 1 shape D + 42 adapter-derived.
  // Adapter-derived is 21 outcome/category pairs, each valid with the
  // boundary either set or unset: 2 transient + 9 permanent + 10 ambiguous.
  assert.equal(authorized.length, 48);

  // And the shapes themselves, named individually.
  const authorize = (
    outcome: AttemptOutcome | null,
    failureCategory: IntegrationFailureCategory | null,
    reasonCode: IntegrationAttemptReasonCode | null,
    dispatchStarted: boolean,
  ) =>
    isAuthorizedAttemptSettlement({
      outcome,
      failureCategory,
      reasonCode,
      dispatchStarted,
    });

  // Open.
  assert.equal(authorize(null, null, null, false), true);
  assert.equal(authorize(null, null, null, true), true);
  assert.equal(authorize(null, 'destination_unavailable', null, false), false);
  assert.equal(authorize(null, null, 'lease_expired_uncertain', true), false);

  // A.
  assert.equal(authorize('succeeded', null, null, false), true);
  assert.equal(
    authorize('succeeded', 'destination_unavailable', null, false),
    false,
  );
  assert.equal(
    authorize('succeeded', null, 'lease_expired_pre_dispatch', false),
    false,
  );

  // B.
  assert.equal(
    authorize('failed_transient', 'destination_unavailable', null, false),
    true,
  );
  assert.equal(authorize('failed_transient', 'rate_limited', null, true), true);
  assert.equal(
    authorize('failed_transient', 'authentication_failed', null, false),
    false,
  );
  assert.equal(
    authorize('failed_transient', 'destination_timeout', null, false),
    false,
  );
  assert.equal(authorize('failed_permanent', null, null, false), false);
  assert.equal(
    authorize('failed_permanent', 'destination_timeout', null, false),
    false,
  );
  assert.equal(authorize('ambiguous', 'destination_timeout', null, true), true);

  // C: pre-dispatch recovery. Boundary unset, no category, transient only.
  assert.equal(
    authorize('failed_transient', null, 'lease_expired_pre_dispatch', false),
    true,
  );
  assert.equal(
    authorize('failed_transient', null, 'lease_expired_pre_dispatch', true),
    false,
    'a crossed boundary contradicts the pre-dispatch reason',
  );
  assert.equal(
    authorize('ambiguous', null, 'lease_expired_pre_dispatch', false),
    false,
  );
  assert.equal(
    authorize(
      'failed_transient',
      'destination_unavailable',
      'lease_expired_pre_dispatch',
      false,
    ),
    false,
    'a lifecycle reason never coexists with a destination category',
  );

  // D: possibly-dispatched expiry. Boundary set, no category, ambiguous only.
  assert.equal(
    authorize('ambiguous', null, 'lease_expired_uncertain', true),
    true,
  );
  assert.equal(
    authorize('ambiguous', null, 'lease_expired_uncertain', false),
    false,
    'an unmarked attempt cannot be possibly-dispatched',
  );
  assert.equal(
    authorize('failed_transient', null, 'lease_expired_uncertain', true),
    false,
    'uncertainty is never transient',
  );
});

test('every named SQL settlement constraint exists in the migration', () => {
  const code = executable(migration());
  for (const name of [
    'integration_attempt_settlement_explained',
    'integration_attempt_open_carries_no_evidence',
    'integration_attempt_success_carries_no_reason',
    'integration_attempt_lifecycle_reason_excludes_category',
    'integration_attempt_permanent_requires_category',
    'integration_attempt_pre_dispatch_reason_shape',
    'integration_attempt_uncertain_reason_shape',
    'integration_attempt_reason_code_vocabulary',
    'integration_attempt_transient_category_shape',
    'integration_attempt_timeout_is_ambiguous',
    'integration_attempt_lease_after_start',
    'integration_attempt_dispatch_not_before_start',
  ]) {
    assert.ok(
      code.includes(`add constraint ${name}`),
      `${name} must be added by the migration`,
    );
    assert.ok(
      code.includes(`drop constraint if exists ${name}`),
      `${name} must be dropped by the rollback`,
    );
  }
  // The two boundary cross-checks are what make a reason code an assertion
  // the database verifies rather than a label the writer chooses.
  assert.match(
    code,
    /pre_dispatch_reason_shape[\s\S]*?dispatch_started_at is null/,
  );
  assert.match(
    code,
    /uncertain_reason_shape[\s\S]*?dispatch_started_at is not null/,
  );
});

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

test('the migration adds exactly the three reviewed columns', () => {
  const code = executable(migration());
  const added = [...code.matchAll(/add column ([a-z_]+)/g)].map(
    (match) => match[1] ?? '',
  );
  assert.deepEqual(added, [
    'claim_expires_at',
    'dispatch_started_at',
    'reason_code',
  ]);
  const dropped = [...code.matchAll(/drop column ([a-z_]+)/g)].map(
    (match) => match[1] ?? '',
  );
  assert.deepEqual([...dropped].sort(), [...added].sort());
});

test('no retry, ordering, counter, role, grant or network behaviour is added', () => {
  const code = executable(migration()).toLowerCase();
  for (const token of [
    // Deferred to F062.2D-2C-2 and 2C-3.
    'next_attempt_at',
    'requires_ordered_delivery',
    'aggregate_revision',
    'backoff',
    'jitter',
    'exponent',
    // attempt_number is the evidence ordinal and is NOT a retry counter, so
    // no counter column may appear.
    'attempt_count',
    'retry_count',
    'recovery_count',
    // Renewal and the fields F062.2D-2C-0A rejected.
    'renewed_at',
    'heartbeat',
    'claimed_by',
    'claimed_at',
    // Privilege and identity.
    'grant ',
    'revoke ',
    'create role',
    'alter role',
    'reqro_integration_worker',
    'security definer',
    // The functions this slice must not create or change.
    'reqro_integration_api',
    'claim_integration_intent',
    'complete_integration_attempt',
    'mark_integration_dispatch_started',
    'recover_expired_integration_claim',
    // Network, vendor and secret.
    'http',
    'dblink',
    'postgres_fdw',
    'credential',
    'secret',
  ])
    assert.equal(
      code.includes(token),
      false,
      `the migration references ${token}`,
    );
});

test('the migration creates exactly one index and one function', () => {
  const code = executable(migration());
  const indexes = [...code.matchAll(/create (?:unique )?index ([a-z_]+)/g)].map(
    (match) => match[1] ?? '',
  );
  assert.deepEqual(indexes, ['integration_attempt_lease_expiry']);
  // The partial predicate keeps the index to rows a recovery scan could
  // return, and the index is not unique: an Organization may legitimately
  // hold many expiring claims.
  assert.match(
    code,
    /create index integration_attempt_lease_expiry[\s\S]*?where completed_at is null and claim_expires_at is not null/,
  );
  assert.equal(code.includes('create unique index'), false);

  // Only the F062.2D-2A guard is replaced, and only by replacement rather
  // than by a new function name.
  const functions = [
    ...code.matchAll(/create (?:or replace )?function ([a-z_.]+)\(/g),
  ].map((match) => match[1] ?? '');
  assert.deepEqual(functions, [
    'guard_integration_delivery_attempt',
    'guard_integration_delivery_attempt',
  ]);
});

test('the guard keeps every F062.2D-2A protection and adds the new ones', () => {
  const code = executable(migration());
  const [, upBody = '', downBody = ''] =
    /export async function up[\s\S]*?`([\s\S]*?)`\.execute[\s\S]*?export async function down[\s\S]*?`([\s\S]*?)`\.execute/.exec(
      code,
    ) ?? [];
  assert.notEqual(upBody, '');
  assert.notEqual(downBody, '');

  for (const preserved of [
    'are evidence and are never deleted',
    'must be created open',
    'A settled integration delivery attempt is immutable',
    'may only be updated to settle it',
    'claim identity is immutable',
    'requires an obligation owned by its Organization',
    'must name its obligation connector',
    'must pin the obligation semantic revision',
  ]) {
    assert.ok(upBody.includes(preserved), `up lost: ${preserved}`);
    // Rollback restores the original guard, so it carries them too.
    assert.ok(downBody.includes(preserved), `down lost: ${preserved}`);
  }

  for (const added of [
    'claim lease is immutable and cannot be extended',
    'dispatch boundary is write-once and cannot be changed or cleared',
    'dispatch boundary must be recorded before settlement',
    'dispatch boundary carries no settlement evidence',
    'must be created before its dispatch boundary',
    'must be created without a settlement reason',
  ]) {
    assert.ok(upBody.includes(added), `up is missing: ${added}`);
    // And the restored original must NOT carry them.
    assert.equal(downBody.includes(added), false, `down retained: ${added}`);
  }

  // The marker is database-authored in the guard, not accepted from a caller.
  assert.match(upBody, /NEW\.dispatch_started_at = clock_timestamp\(\)/);
  // No caller-controlled timestamp survives: the only assignment is the
  // database's own.
  assert.equal((upBody.match(/NEW\.dispatch_started_at = /g) ?? []).length, 1);
});

test('rollback refuses to erase evidence rather than nulling it', () => {
  const code = executable(migration());
  const downBody =
    /export async function down[\s\S]*?`([\s\S]*?)`\.execute/.exec(code)?.[1] ??
    '';
  assert.match(downBody, /prevents rollback/);
  // The refusal reads all three columns, so no kind of evidence is missed.
  for (const column of [
    'claim_expires_at is not null',
    'dispatch_started_at is not null',
    'reason_code is not null',
  ])
    assert.ok(downBody.includes(column), `the refusal ignores ${column}`);
  // And it never deletes or blanks anything to succeed. Matched as
  // STATEMENTS: the restored guard legitimately names DELETE and TRUNCATE in
  // its own refusal, which is a protection rather than an erasure.
  assert.equal(/delete\s+from/i.test(downBody), false);
  assert.equal(/truncate\s+table/i.test(downBody), false);
  assert.equal(/drop\s+table/i.test(downBody), false);
  assert.equal(/set reason_code = null/i.test(downBody), false);
  assert.equal(/set claim_expires_at = null/i.test(downBody), false);
  assert.equal(/set dispatch_started_at = null/i.test(downBody), false);
});

test('the migration is importable, so no test applies it as text', () => {
  // Unlike Migrations 48, 49 and 53 this one hardcodes no schema name, so it
  // is imported and compiled like Migration 52. A hardcoded `public.` would
  // run unrewritten against a disposable schema.
  const code = executable(migration());
  assert.equal(/\bpublic\./.test(code), false);
  assert.equal(code.includes('search_path'), false);
});
