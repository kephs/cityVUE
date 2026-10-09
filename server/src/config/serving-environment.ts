import {
  validateEnvironment,
  type EnvironmentVariables,
} from './environment.js';
import { normalizeHostname } from '../tenancy/tenant-hostname.js';
import { parseTrustedProxyCidrs } from '../tenancy/tenant-host-source.js';
import { commandFailure } from '../common/logging/log-sanitization.js';

const requirements = [
  'REQRO_PUBLIC_HOSTNAMES requires 1-64 explicit canonical hostnames',
  'REQRO_PUBLIC_HOSTNAMES requires canonical public DNS hostnames without ports, wildcards or localhost',
  'REQRO_PUBLIC_HOSTNAMES must not contain duplicates',
  'TENANT_HOST_SOURCE must be forwarded',
  'TENANT_TRUSTED_PROXY_CIDRS requires explicit final-hop peers',
  'TENANT_TRUSTED_PROXY_CIDRS requires 1-64 final-hop peers and must not trust all addresses',
  'CORS_ORIGINS requires explicit approved HTTPS origins',
  'CORS_ORIGINS requires 1-64 distinct approved HTTPS origins',
  'CORS_ORIGINS requires exact HTTPS origins from REQRO_PUBLIC_HOSTNAMES',
  'CORS_ORIGINS requires exact HTTPS origins from REQRO_PUBLIC_HOSTNAMES, without paths or custom ports',
] as const;

function invalid(requirement: (typeof requirements)[number]): never {
  // Never interpolate configuration values, URLs or header-like input.
  throw new Error(`Invalid production serving configuration: ${requirement}`);
}

/** Keep the existing startup sanitizer; supplement only exact closed diagnostics
 * authored above. Arbitrary errors and near-matching messages are never printed. */
export function servingStartupFailure(error: unknown): string {
  const summary = commandFailure('API startup failed', error);
  const requirement =
    error instanceof Error
      ? requirements.find(
          (value) =>
            error.message ===
            `Invalid production serving configuration: ${value}`,
        )
      : undefined;
  return requirement
    ? summary +
        JSON.stringify({
          level: 50,
          service: 'cityvue-api',
          msg: 'Production serving configuration rejected',
          requirement,
        }) +
        '\n'
    : summary;
}

/** Deployment metadata, not registry authority or proof of DNS ownership.
 * Require canonical DNS names so URL parsing cannot reinterpret the inventory. */
export function parsePublicHostnames(value: unknown): readonly string[] {
  if (typeof value !== 'string' || value.length > 16384)
    invalid(
      'REQRO_PUBLIC_HOSTNAMES requires 1-64 explicit canonical hostnames',
    );
  const names = value.split(',').map((name) => name.trim());
  if (names.length > 64 || names.length === 0)
    invalid(
      'REQRO_PUBLIC_HOSTNAMES requires 1-64 explicit canonical hostnames',
    );
  for (const name of names) {
    const normalized = normalizeHostname(name);
    if (
      !normalized.ok ||
      normalized.hostname !== name ||
      !name.includes('.') ||
      name.endsWith('.localhost') ||
      name.endsWith('.local')
    )
      invalid(
        'REQRO_PUBLIC_HOSTNAMES requires canonical public DNS hostnames without ports, wildcards or localhost',
      );
  }
  if (new Set(names).size !== names.length)
    invalid('REQRO_PUBLIC_HOSTNAMES must not contain duplicates');
  return Object.freeze(names);
}

/** HTTP application only. Operator/migration entry points retain their existing
 * environment validator and do not acquire browser/ingress prerequisites. */
export function validateServingEnvironment(
  input: Record<string, unknown>,
): EnvironmentVariables {
  const environment = validateEnvironment(input);
  if (environment.NODE_ENV !== 'production') return environment;

  // Existing validation already enforces client/registry, no development
  // Organization, disabled development switches and verified database TLS.
  if (environment.TENANT_HOST_SOURCE !== 'forwarded')
    invalid('TENANT_HOST_SOURCE must be forwarded');

  const peers = environment.TENANT_TRUSTED_PROXY_CIDRS;
  if (peers.length > 16384 || peers.split(',').some((peer) => !peer.trim()))
    invalid('TENANT_TRUSTED_PROXY_CIDRS requires explicit final-hop peers');
  const ranges = parseTrustedProxyCidrs(peers);
  if (
    ranges.length === 0 ||
    ranges.length > 64 ||
    ranges.some((range) => range.prefix === 0)
  )
    invalid(
      'TENANT_TRUSTED_PROXY_CIDRS requires 1-64 final-hop peers and must not trust all addresses',
    );

  const hosts = new Set(parsePublicHostnames(input.REQRO_PUBLIC_HOSTNAMES));
  const rawOrigins = input.CORS_ORIGINS;
  if (typeof rawOrigins !== 'string' || rawOrigins.length > 16384)
    invalid('CORS_ORIGINS requires explicit approved HTTPS origins');
  const origins = rawOrigins.split(',').map((origin) => origin.trim());
  if (origins.length > 64 || new Set(origins).size !== origins.length)
    invalid('CORS_ORIGINS requires 1-64 distinct approved HTTPS origins');
  for (const origin of origins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      invalid(
        'CORS_ORIGINS requires exact HTTPS origins from REQRO_PUBLIC_HOSTNAMES',
      );
    }
    if (
      url.protocol !== 'https:' ||
      origin !== url.origin ||
      url.port !== '' ||
      !hosts.has(url.hostname)
    )
      invalid(
        'CORS_ORIGINS requires exact HTTPS origins from REQRO_PUBLIC_HOSTNAMES, without paths or custom ports',
      );
  }
  return environment;
}
