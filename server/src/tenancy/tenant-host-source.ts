import { BlockList, isIPv4, isIPv6 } from 'node:net';
import { normalizeHostname } from './tenant-hostname.js';

/** ADR-025 trusted request-host selection.
 *
 * Pure apart from the `BlockList` it builds once at construction. It decides
 * *which string is allowed to be the request host*; canonicalization is then
 * delegated to the existing normalizer, so there is exactly one hostname
 * grammar in the system.
 *
 * `direct` is the default and matches current behavior: only the literal
 * `Host` is read and `X-Forwarded-Host` is ignored entirely. A forwarded host
 * is trusted only when the immediate socket peer is inside explicitly
 * configured infrastructure.
 *
 * There is deliberately no hop-count mode. Express's numeric `trust proxy`
 * counts entries in a client-controllable header, so an attacker able to
 * prepend hops shifts which entry is read. The peer address is the only value
 * in the exchange that the far side cannot forge. Express `trust proxy` is
 * also left off because it rewrites `req.ip` and `req.protocol`, which would
 * silently change throttling behavior as a side effect of a tenancy setting.
 */
export type TenantHostSource = 'direct' | 'forwarded';

export const FORWARDED_HOST_HEADER = 'x-forwarded-host';

export type HostSelection =
  { readonly ok: true; readonly hostname: string } | { readonly ok: false };

const REJECTED: HostSelection = Object.freeze({ ok: false });

export interface TenantHostPolicy {
  readonly source: TenantHostSource;
  isTrustedPeer(address: string | null | undefined): boolean;
}

interface ParsedCidr {
  readonly address: string;
  readonly type: 'ipv4' | 'ipv6';
  readonly prefix: number | null;
}

function parseEntry(entry: string): ParsedCidr {
  const parts = entry.split('/');
  if (parts.length > 2) throw new Error(`Invalid trusted proxy CIDR: ${entry}`);
  const address = parts[0] ?? '';
  const type = isIPv4(address) ? 'ipv4' : isIPv6(address) ? 'ipv6' : null;
  if (!type) throw new Error(`Invalid trusted proxy CIDR: ${entry}`);
  if (parts.length === 1) return { address, type, prefix: null };
  const raw = parts[1] ?? '';
  if (!/^[0-9]{1,3}$/.test(raw))
    throw new Error(`Invalid trusted proxy CIDR: ${entry}`);
  const prefix = Number(raw);
  if (prefix < 0 || prefix > (type === 'ipv4' ? 32 : 128))
    throw new Error(`Invalid trusted proxy CIDR: ${entry}`);
  return { address, type, prefix };
}

/**
 * Validates a comma-separated CIDR list, throwing on anything malformed.
 * Used by environment validation so a bad proxy allowlist stops the process
 * instead of silently trusting nothing — or, worse, everything.
 */
export function parseTrustedProxyCidrs(value: string): ParsedCidr[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map(parseEntry);
}

/**
 * Normalizes a socket peer address for comparison. Strips an IPv6 zone index
 * and unwraps the IPv4-mapped IPv6 form Node reports on dual-stack sockets,
 * so `::ffff:10.0.0.1` matches an IPv4 CIDR as an operator would expect.
 */
export function normalizePeerAddress(
  address: string | null | undefined,
): { address: string; type: 'ipv4' | 'ipv6' } | null {
  if (typeof address !== 'string' || address.length === 0) return null;
  const withoutZone = address.split('%')[0] ?? '';
  const mapped = /^::ffff:((?:[0-9]{1,3}\.){3}[0-9]{1,3})$/i.exec(withoutZone);
  const candidate = mapped?.[1] ?? withoutZone;
  if (isIPv4(candidate)) return { address: candidate, type: 'ipv4' };
  if (isIPv6(candidate)) return { address: candidate, type: 'ipv6' };
  return null;
}

export function createTenantHostPolicy(
  source: TenantHostSource,
  trustedProxyCidrs: string,
): TenantHostPolicy {
  const entries = parseTrustedProxyCidrs(trustedProxyCidrs);
  const blocked = new BlockList();
  for (const entry of entries) {
    if (entry.prefix === null) blocked.addAddress(entry.address, entry.type);
    else blocked.addSubnet(entry.address, entry.prefix, entry.type);
  }
  return {
    source,
    isTrustedPeer(address) {
      // An empty allowlist trusts nobody, which is the correct reading of
      // "no trusted infrastructure is configured".
      if (entries.length === 0) return false;
      const peer = normalizePeerAddress(address);
      return peer !== null && blocked.check(peer.address, peer.type);
    },
  };
}

/** A repeated header arrives as an array; a comma-joined one arrives as a
 * string the normalizer rejects. Both are ambiguous and both fail closed. */
function singleHeaderValue(
  value: string | string[] | undefined,
): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Selects the host the registry may be queried with.
 *
 * In `forwarded` mode an untrusted peer, a missing forwarded host or a
 * repeated one all fail closed, and the literal `Host` is **never** used as a
 * fallback. Falling back would mean a request that bypassed the trusted edge
 * could still select a tenant, which is exactly what the proxy boundary
 * exists to prevent.
 */
export function selectTrustedHost(
  policy: TenantHostPolicy,
  headers: Partial<Record<string, string | string[] | undefined>>,
  remoteAddress: string | null | undefined,
): HostSelection {
  let raw: string | null;
  if (policy.source === 'direct') {
    raw = singleHeaderValue(headers.host);
  } else {
    if (!policy.isTrustedPeer(remoteAddress)) return REJECTED;
    raw = singleHeaderValue(headers[FORWARDED_HOST_HEADER]);
  }
  if (raw === null) return REJECTED;
  const normalized = normalizeHostname(raw);
  return normalized.ok ? { ok: true, hostname: normalized.hostname } : REJECTED;
}
