import { Injectable } from '@nestjs/common';
import { TenantDomainRepository } from './tenant-domain.repository.js';
import type { ResolvedTenant } from './tenant-domain.js';
import { normalizeHostname } from './tenant-hostname.js';

/** ADR-025 anonymous Organization resolution.
 *
 * Slice 1a builds the resolver but does not wire it to incoming HTTP
 * requests; `bootstrap.ts` still refuses to serve under the `registry`
 * strategy, so this changes no production runtime behavior.
 *
 * Every failure returns `null`. There is no reason code, no partial context
 * and no fallback: an unknown, malformed, inactive, unverified, ambiguous or
 * suspended binding is indistinguishable from any other, so resolution cannot
 * be used to enumerate tenants. Absent tenant context is an error for the
 * caller to handle, never a default to fill in.
 *
 * The resolver deliberately reads no configuration and holds no reference to
 * the configured development Organization, so the development strategy can
 * never leak into registry resolution and a registry miss can never degrade
 * into a default tenant.
 */
@Injectable()
export class TenantResolverService {
  constructor(private readonly domains: TenantDomainRepository) {}

  /**
   * Resolves a candidate host value to exactly one active Organization.
   *
   * `host` is whatever the caller observed, unvalidated and untrusted; it is
   * normalized here and never used in its raw form. The hostname selects which
   * public surface is served — it grants nothing.
   */
  async resolve(host: unknown): Promise<ResolvedTenant | null> {
    const normalized = normalizeHostname(host);
    if (!normalized.ok) return null;

    const bindings = await this.domains.findResolvable(normalized.hostname);
    // Exactly one, or nothing. Ambiguity fails closed rather than choosing.
    if (bindings.length !== 1) return null;

    const binding = bindings[0];
    if (binding?.hostname !== normalized.hostname) return null;
    return binding;
  }
}
