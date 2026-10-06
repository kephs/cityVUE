/** ADR-025 tenant-domain registry vocabulary.
 *
 * One hostname maps to exactly one Organization, globally. A role describes
 * how a verified hostname is presented, never what it is allowed to do: the
 * hostname is a lookup key, not an authorization credential. */
export type TenantDomainRole =
  'public_canonical' | 'public_alias' | 'platform_fallback';

export const tenantDomainRoles: readonly TenantDomainRole[] = [
  'public_canonical',
  'public_alias',
  'platform_fallback',
];

/** A binding is registered `unverified`, may carry an issued ownership
 * challenge while `pending`, and only becomes `verified` against recorded
 * ownership evidence. Only a `verified` binding may be active, and only an
 * active binding can resolve. */
export type TenantDomainVerificationState =
  'unverified' | 'pending' | 'verified';

/** The only ownership evidence ADR-025 approves. Challenge issuance and the
 * check itself are not implemented in Slice 1a. */
export type TenantDomainVerificationMethod = 'dns_txt';

/** The resolved anonymous tenant context. Absent context is an error, never a
 * default, so this is produced only from an active, verified binding whose
 * Organization is active. */
export interface ResolvedTenant {
  readonly domainId: string;
  readonly organizationId: string;
  readonly hostname: string;
  readonly role: TenantDomainRole;
}

export function isTenantDomainRole(value: unknown): value is TenantDomainRole {
  return (
    typeof value === 'string' &&
    (tenantDomainRoles as readonly string[]).includes(value)
  );
}
