import { createHash, randomBytes } from 'node:crypto';

export const TRACKING_MANAGE = 'service_request.tracking.manage' as const;
/**
 * F063.1: the bound on resident-visible correspondence returned by a single
 * tracking read. A bearer credential must never be able to ask for an
 * unbounded page, so this is a fixed server-side ceiling rather than a
 * caller-supplied size. It matches the staff stream's page size.
 */
export const REQUESTER_UPDATE_PAGE_SIZE = 25;
// 32 random bytes have a canonical unpadded base64url length of 43 characters.
export function validTrackingCredential(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(value) &&
    Buffer.from(value, 'base64url').toString('base64url') === value
  );
}
export function trackingDigest(value: string): string {
  return createHash('sha256').update(value, 'ascii').digest('hex');
}
export function generateTrackingCredential() {
  const credential = randomBytes(32).toString('base64url');
  return { credential, digest: trackingDigest(credential) };
}
/**
 * F065 platform bounds for an intake-issued credential's lifetime. The
 * `request_tracking_policy` CHECK enforces the same range, so neither the
 * database nor the application is the sole boundary.
 */
export const TRACKING_LIFETIME_MINIMUM_DAYS = 30;
export const TRACKING_LIFETIME_DEFAULT_DAYS = 180;
export const TRACKING_LIFETIME_MAXIMUM_DAYS = 365;
export function validTrackingLifetimeDays(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= TRACKING_LIFETIME_MINIMUM_DAYS &&
    value <= TRACKING_LIFETIME_MAXIMUM_DAYS
  );
}
/**
 * The stored policy cannot leave the approved range while its CHECK stands.
 * This clamps anyway rather than trusting the row, so a relaxed constraint
 * could never widen a credential's lifetime past the platform maximum. An
 * absent or non-integer value takes the platform default.
 */
export function trackingLifetimeDays(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value))
    return TRACKING_LIFETIME_DEFAULT_DAYS;
  return Math.min(
    Math.max(value, TRACKING_LIFETIME_MINIMUM_DAYS),
    TRACKING_LIFETIME_MAXIMUM_DAYS,
  );
}
export function requesterStatus(status: string): string {
  switch (status) {
    case 'open':
      return 'open';
    case 'in_progress':
    case 'on_hold':
      return 'in_progress';
    case 'closed':
      return 'closed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'unavailable';
  }
}
