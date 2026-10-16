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
