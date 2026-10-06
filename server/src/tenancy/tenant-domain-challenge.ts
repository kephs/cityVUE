import { createHash, randomBytes, randomUUID } from 'node:crypto';

/** ADR-025 DNS ownership challenge format.
 *
 * Pure: no I/O, no database, no configuration. Everything here is derived
 * deterministically from the already-canonical hostname stored in the
 * registry, so an auditor can reproduce the queried name and the expected
 * value from the stored row alone.
 *
 * DNS TXT verification proves **current DNS control**, not legal or
 * organizational ownership, and it cannot distinguish legitimate control from
 * a compromised DNS administrative account. Those limits are properties of
 * the method, not defects in this implementation.
 */

/** Underscore-prefixed per the RFC 8552 attrleaf convention, which keeps
 * scoped service metadata out of the host namespace. The label is
 * Reqro-specific and collides with no common mail or security record
 * (`_dmarc`, `_domainkey`, `_acme-challenge`, `_mta-sts`, `_smtp._tls`). */
export const VERIFICATION_LABEL = '_reqro-verify';

/** Keys the record so a domain can carry several vendors' tokens, and
 * versions the value so the format can change without ambiguity. */
export const CHALLENGE_VALUE_PREFIX = 'reqro-site-verification=v1.';

/** `_reqro-verify.` costs 14 of DNS's 253 octets. A longer hostname could be
 * registered but never verified, so the registry refuses one. */
export const MAXIMUM_VERIFIABLE_HOSTNAME_LENGTH =
  253 - (VERIFICATION_LABEL.length + 1);

export const CHALLENGE_TOKEN_BYTES = 32;
/** base64url of 32 bytes, unpadded. */
export const CHALLENGE_TOKEN_LENGTH = 43;

export const DEFAULT_CHALLENGE_LIFETIME_DAYS = 14;
export const MAXIMUM_CHALLENGE_LIFETIME_DAYS = 30;

const TOKEN_PATTERN = new RegExp(
  `^[A-Za-z0-9_-]{${String(CHALLENGE_TOKEN_LENGTH)}}$`,
);

export interface IssuedChallenge {
  readonly tokenId: string;
  readonly token: string;
  /** The exact string the customer publishes as the TXT value. */
  readonly value: string;
}

/**
 * Builds the verification record name.
 *
 * The result is **not** a registry hostname and must never be passed through
 * `normalizeHostname`: the normalizer rejects underscores by design, and this
 * name intentionally sits outside the stored hostname grammar. It is a query
 * name only.
 *
 * Returns `null` when the hostname cannot carry a challenge within the DNS
 * name limit, so callers fail closed rather than querying a truncated name.
 */
export function verificationRecordName(hostname: string): string | null {
  if (
    hostname.length === 0 ||
    hostname.length > MAXIMUM_VERIFIABLE_HOSTNAME_LENGTH
  )
    return null;
  return `${VERIFICATION_LABEL}.${hostname}`;
}

/** 256 bits from a cryptographically secure source. The token is public by
 * design — it is published in DNS — so its value is binding and
 * unguessability, not confidentiality. */
export function issueChallenge(): IssuedChallenge {
  const token = randomBytes(CHALLENGE_TOKEN_BYTES).toString('base64url');
  return { tokenId: randomUUID(), token, value: challengeValue(token) };
}

export function challengeValue(token: string): string {
  return `${CHALLENGE_VALUE_PREFIX}${token}`;
}

export function isWellFormedChallengeValue(value: string): boolean {
  return (
    value.startsWith(CHALLENGE_VALUE_PREFIX) &&
    TOKEN_PATTERN.test(value.slice(CHALLENGE_VALUE_PREFIX.length))
  );
}

/** Lowercase hex SHA-256, matching the `char(64)` evidence columns. */
export function challengeHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * A name may legitimately hold many TXT values — other vendors' tokens, SPF,
 * arbitrary notes. Ownership is proven when **exactly one of them equals** the
 * expected value. Values are never concatenated, prefix-matched or trimmed:
 * a near miss is a miss.
 */
export function matchesChallenge(
  observed: readonly string[],
  expected: string,
): boolean {
  return observed.some((value) => value === expected);
}

/** Clamped to the approved bounds. The database independently refuses a
 * window outside them, so this cannot be the only guard. */
export function challengeExpiry(requestedAt: Date, lifetimeDays: number): Date {
  if (
    !Number.isInteger(lifetimeDays) ||
    lifetimeDays < 1 ||
    lifetimeDays > MAXIMUM_CHALLENGE_LIFETIME_DAYS
  )
    throw new RangeError(
      `Challenge lifetime must be 1-${String(MAXIMUM_CHALLENGE_LIFETIME_DAYS)} days`,
    );
  return new Date(requestedAt.getTime() + lifetimeDays * 24 * 60 * 60 * 1000);
}
