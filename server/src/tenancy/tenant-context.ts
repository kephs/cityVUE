import type { TenantDomainRole } from './tenant-domain.js';

/** ADR-025 request tenancy.
 *
 * A discriminated union rather than one optional-heavy shape: the development
 * strategy has no hostname, no binding and no role, and inventing placeholder
 * values for them would make a development context structurally
 * indistinguishable from a verified registry one.
 *
 * `source` is therefore load-bearing. A consumer that needs registry
 * provenance must narrow on it rather than reading an optional field that
 * happens to be populated.
 */
export type TenantContext =
  | {
      readonly source: 'development';
      readonly organizationId: string;
      readonly correlationId: string;
    }
  | {
      readonly source: 'registry';
      readonly organizationId: string;
      readonly hostname: string;
      readonly domainId: string;
      readonly role: TenantDomainRole;
      readonly correlationId: string;
    };

/**
 * Resolution outcome, modelled separately from the context itself so the
 * middleware can record "we looked and found nothing" without fabricating a
 * context, and so callers must handle absence explicitly.
 *
 * `not_found` deliberately carries no reason. Unknown, malformed, missing,
 * inactive, unverified, ambiguous and untrusted-peer cases are one
 * indistinguishable outcome, so resolution cannot become a tenant-enumeration
 * oracle. `unavailable` is separate only because an infrastructure failure is
 * independent of whether a hostname belongs to a customer.
 */
/**
 * Operator-only diagnostic cause, recorded in the server-side log and
 * never returned to a client. A closed allowlist: it distinguishes "a
 * customer's DNS is wrong" from "our proxy allowlist is wrong" without
 * making the HTTP response distinguishable.
 */
export type TenantResolutionReason =
  | 'resolved'
  | 'unknown_host'
  | 'malformed_host'
  | 'untrusted_forwarded_peer'
  | 'registry_unavailable';

export type TenantResolutionState =
  | { readonly status: 'resolved'; readonly context: TenantContext }
  | {
      readonly status: 'not_found';
      readonly reason: TenantResolutionReason;
    }
  | {
      readonly status: 'unavailable';
      readonly reason: TenantResolutionReason;
    };

/** Callers outside the middleware see one indistinguishable outcome; the
 * reason exists only for the operational log. */
export function tenantNotFound(
  reason: TenantResolutionReason,
): TenantResolutionState {
  return Object.freeze({ status: 'not_found', reason });
}
export const TENANT_UNAVAILABLE: TenantResolutionState = Object.freeze({
  status: 'unavailable',
  reason: 'registry_unavailable',
});

/** Attached by `TenantResolutionMiddleware`. Follows the same inline-request
 * augmentation convention as `staffAccess`, rather than a global declaration,
 * so the dependency is visible wherever it is read. */
export interface RequestWithTenant {
  tenantResolution?: TenantResolutionState;
}

export function resolvedTenant(context: TenantContext): TenantResolutionState {
  // Frozen so a later handler cannot mutate one request's resolved tenant.
  return Object.freeze({ status: 'resolved', context: Object.freeze(context) });
}
