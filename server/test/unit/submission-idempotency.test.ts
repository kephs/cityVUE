import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  classifySubmission,
  replayTrackingState,
  submissionFingerprint,
  submissionKeyDigest,
  submissionRetentionHours,
  submissionScope,
  validRequestId,
  validSubmissionKey,
  SUBMISSION_RETENTION_DEFAULT_HOURS,
  SUBMISSION_RETENTION_MAXIMUM_HOURS,
  SUBMISSION_RETENTION_MINIMUM_HOURS,
  type SubmissionReservation,
} from '../../src/service-request/submission-idempotency.js';

/**
 * F066 — the submission-idempotency decisions, proven as pure functions.
 *
 * No database, no container and no HTTP server participate. Every branch that
 * decides whether a submission is new, a replay or a refusal is reachable from
 * fabricated input, which is what makes the refusals testable at all: the
 * interesting cases are the ones a real client cannot easily produce.
 *
 * The database-level guarantees these decisions rest on -- the unique
 * constraint, the deferred foreign key, concurrency and the append-only
 * triggers -- are proven against real PostgreSQL in
 * `submission-idempotency.integration.test.ts`, not here.
 */

const KEY = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const REQUEST = '0a9f2b31-5c6d-4e8f-9a1b-2c3d4e5f6a7b';
const FINGERPRINT = 'f'.repeat(64);

const recorded = (
  over: Partial<SubmissionReservation> = {},
): SubmissionReservation => ({
  fingerprint: FINGERPRINT,
  service_request_id: REQUEST,
  tracking_issued: false,
  expired: false,
  ...over,
});

test('F066 accepts a UUID submission key and refuses anything weaker', () => {
  assert.equal(validSubmissionKey(KEY), true);
  assert.equal(validSubmissionKey(randomUUID()), true);
  // A guessable or structured key would make the reservation space
  // enumerable, so shape and length are validated rather than trusted.
  for (const bad of [
    undefined,
    null,
    '',
    '   ',
    'not-a-uuid',
    '7c9e6679742540de944be07fc1f90ae7',
    `${KEY} `,
    ` ${KEY}`,
    `${KEY}${KEY}`,
    '00000000-0000-0000-0000-000000000000',
    '7c9e6679-7425-90de-944b-e07fc1f90ae7',
    1,
    {},
    [KEY],
  ])
    assert.equal(
      validSubmissionKey(bad),
      false,
      `${JSON.stringify(bad)} must not be accepted`,
    );
});

test('F066 persists only a digest of the submission key', () => {
  const digest = submissionKeyDigest(KEY);
  assert.match(digest, /^[0-9a-f]{64}$/);
  // The raw key must not be recoverable from, or present in, what is stored.
  assert.equal(digest.includes(KEY), false);
  assert.notEqual(digest, KEY);
  // Deterministic, so a retry carrying the same key finds its reservation.
  assert.equal(submissionKeyDigest(KEY), digest);
  // Distinct keys do not collide, and the domain separator means this digest
  // is not interchangeable with a bare SHA-256 of the key elsewhere.
  assert.notEqual(submissionKeyDigest(randomUUID()), digest);
});

test('F066 scopes a key to the authorized submission context', () => {
  const resident = submissionScope({
    audience: 'public',
    intakeChannel: 'web',
    staffId: null,
  });
  assert.equal(resident, 'public:web');
  // A staff key is bound to the acting identity, so one staff member's key
  // can neither collide with nor replay another's.
  const staffA = submissionScope({
    audience: 'public',
    intakeChannel: 'phone',
    staffId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  });
  const staffB = submissionScope({
    audience: 'public',
    intakeChannel: 'phone',
    staffId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
  });
  assert.notEqual(staffA, staffB);
  // Audience is part of the scope, so an INTERNAL submission never shares a
  // reservation with a PUBLIC one.
  assert.notEqual(
    submissionScope({
      audience: 'internal',
      intakeChannel: 'web',
      staffId: null,
    }),
    resident,
  );
  // The scope must stay within the column's accepted shape whatever the
  // channel claims to be.
  for (const channel of ['web', 'phone', 'walk_in', 'staff', 'api'])
    assert.match(
      submissionScope({
        audience: 'public',
        intakeChannel: channel,
        staffId: null,
      }),
      /^[a-z][a-z0-9:_-]*$/,
    );
  const forged = submissionScope({
    audience: 'public',
    intakeChannel: "web'; drop table organization; --",
    staffId: null,
  });
  assert.equal(forged, 'public:unknown');
  assert.match(forged, /^[a-z][a-z0-9:_-]*$/);
});

test('F066 binds the key to a canonical submission fingerprint', () => {
  const base = submissionFingerprint('a'.repeat(64));
  assert.match(base, /^[0-9a-f]{64}$/);
  assert.equal(submissionFingerprint('a'.repeat(64)), base);
  // A different submission body is a different fingerprint, which is what
  // turns "same key, different payload" into a refusal.
  assert.notEqual(submissionFingerprint('b'.repeat(64)), base);
  // A retry carrying a different attachment batch is not the same submission.
  // Without this the first receipt would be returned and the new evidence
  // silently discarded.
  const withBatch = submissionFingerprint('a'.repeat(64), {
    batchId: '11111111-1111-4111-8111-111111111111',
  });
  assert.notEqual(withBatch, base);
  assert.notEqual(
    submissionFingerprint('a'.repeat(64), {
      batchId: '22222222-2222-4222-8222-222222222222',
    }),
    withBatch,
  );
  assert.equal(
    submissionFingerprint('a'.repeat(64), {
      batchId: '11111111-1111-4111-8111-111111111111',
    }),
    withBatch,
  );
});

test('F066 an unclaimed key is a first submission', () => {
  assert.deepEqual(classifySubmission(undefined, FINGERPRINT), {
    kind: 'first',
  });
});

test('F066 a recorded key with the same fingerprint is an exact replay', () => {
  assert.deepEqual(classifySubmission(recorded(), FINGERPRINT), {
    kind: 'replay',
    serviceRequestId: REQUEST,
    trackingIssued: false,
  });
  assert.deepEqual(
    classifySubmission(recorded({ tracking_issued: true }), FINGERPRINT),
    { kind: 'replay', serviceRequestId: REQUEST, trackingIssued: true },
  );
});

test('F066 the same key with a different payload is refused, not replayed', () => {
  // The dangerous alternative is returning the first submission's receipt for
  // a materially different submission, which would silently discard it.
  assert.deepEqual(classifySubmission(recorded(), 'e'.repeat(64)), {
    kind: 'mismatch',
  });
  // Reported as a mismatch whatever the record's age, so misuse is never
  // masked by the window having closed.
  assert.deepEqual(
    classifySubmission(recorded({ expired: true }), 'e'.repeat(64)),
    { kind: 'mismatch' },
  );
});

test('F066 a key past its retry window is refused rather than replayed or reused', () => {
  // Not a replay: the window closed. And not a silent new submission either,
  // which is what would produce a duplicate the client reads as a replay.
  assert.deepEqual(
    classifySubmission(recorded({ expired: true }), FINGERPRINT),
    {
      kind: 'expired',
    },
  );
  // Only a positive "still open" permits a replay. The window is decided by
  // the database clock that wrote the expiry, so this flag is the answer and
  // not an application-side comparison that a skewed clock could widen.
  assert.equal(
    classifySubmission(recorded({ expired: false }), FINGERPRINT).kind,
    'replay',
  );
});

test('F066 an unreadable reservation fails closed instead of replaying', () => {
  // Anything other than an explicit `false` is treated as closed. A record
  // whose window cannot be shown to be open must not be replayed.
  for (const expired of [undefined, null, 'false', 0, 1, {}])
    assert.deepEqual(
      classifySubmission(recorded({ expired }), FINGERPRINT),
      { kind: 'expired' },
      `expired=${JSON.stringify(expired)} must fail closed`,
    );
  // A malformed request identity is never used to read a request back.
  for (const id of ['', 'not-a-uuid', '00000000-0000-0000-0000-000000000000'])
    assert.deepEqual(
      classifySubmission(recorded({ service_request_id: id }), FINGERPRINT),
      { kind: 'expired' },
    );
});

test('F066 a replay never reports a recoverable tracking link', () => {
  // The raw credential was returned once and only its digest was stored, so
  // the honest answers are "issued, unrecoverable" and "never issued".
  assert.equal(replayTrackingState(true), 'issued_unrecoverable');
  assert.equal(replayTrackingState(false), 'not_issued');
  // There is deliberately no state that means "here it is again".
  for (const state of [replayTrackingState(true), replayTrackingState(false)])
    assert.ok(['issued_unrecoverable', 'not_issued'].includes(state));
});

test('F066 the retry window is bounded, and an unusable value takes the default', () => {
  assert.equal(SUBMISSION_RETENTION_MINIMUM_HOURS, 1);
  assert.equal(SUBMISSION_RETENTION_DEFAULT_HOURS, 24);
  assert.equal(SUBMISSION_RETENTION_MAXIMUM_HOURS, 168);
  assert.equal(submissionRetentionHours(48), 48);
  // Clamped at both ends, so no configuration can widen the window past the
  // platform maximum or shorten it below a usable retry period.
  assert.equal(
    submissionRetentionHours(100000),
    SUBMISSION_RETENTION_MAXIMUM_HOURS,
  );
  assert.equal(submissionRetentionHours(0), SUBMISSION_RETENTION_MINIMUM_HOURS);
  assert.equal(
    submissionRetentionHours(-5),
    SUBMISSION_RETENTION_MINIMUM_HOURS,
  );
  // Absent or non-integer takes the documented default rather than a guess.
  for (const bad of [undefined, null, ' 24 ', 24.5, Number.NaN, {}, []])
    assert.equal(
      submissionRetentionHours(bad),
      SUBMISSION_RETENTION_DEFAULT_HOURS,
      `${JSON.stringify(bad)} must take the default`,
    );
});

test('F066 a recorded request identity is validated before it is queried with', () => {
  assert.equal(validRequestId(REQUEST), true);
  assert.equal(validRequestId(randomUUID()), true);
  for (const bad of [undefined, null, '', 'x', `${REQUEST};--`, 7, {}])
    assert.equal(validRequestId(bad), false);
});
