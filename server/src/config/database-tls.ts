import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { PoolConfig } from 'pg';

export interface DatabaseTlsConfiguration {
  environment: string;
  url: string;
  sslMode: string;
  caFile?: string | undefined;
}

function invalid(message: string): never {
  // Never include the URL, file contents, or underlying parser/filesystem error.
  throw new Error(`Invalid server configuration: ${message}`);
}

function readCaBundle(path: string): string {
  try {
    const pem = readFileSync(path, 'utf8');
    const certificates = pem.match(
      /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
    );
    if (!certificates?.length) throw new Error();
    let remainder = pem;
    for (const certificate of certificates) {
      if (!new X509Certificate(certificate).ca) throw new Error();
      remainder = remainder.replace(certificate, '');
    }
    if (remainder.trim()) throw new Error();
    return pem;
  } catch {
    return invalid(
      'DATABASE_SSL_CA_FILE must contain a readable PEM CA certificate bundle',
    );
  }
}

/** The sole API/migration TLS policy; validate before pg can parse URL overrides. */
export function databaseConnectionOptions(
  configuration: DatabaseTlsConfiguration,
): Pick<PoolConfig, 'connectionString' | 'ssl'> {
  const { environment, url, sslMode, caFile } = configuration;
  if (!['development', 'test', 'production'].includes(environment)) {
    invalid('database TLS requires an explicit valid NODE_ENV');
  }
  if (environment === 'production' && sslMode !== 'verify-full') {
    invalid('DATABASE_SSL_MODE must be verify-full in production');
  }
  if (sslMode !== 'disable' && sslMode !== 'verify-full') {
    invalid(
      'DATABASE_SSL_MODE must be verify-full or non-production disable; unverified TLS is unsupported',
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return invalid('DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.hostname.includes('%')
  ) {
    invalid('DATABASE_URL must identify a PostgreSQL TCP host');
  }
  for (const key of parsed.searchParams.keys()) {
    if (
      /^(ssl|tls)/i.test(key) ||
      ['uselibpqcompat', 'host', 'hostaddr'].includes(key.toLowerCase())
    ) {
      invalid(
        'DATABASE_URL must not contain TLS or host override parameters; use DATABASE_SSL_MODE and DATABASE_SSL_CA_FILE',
      );
    }
  }
  if (sslMode === 'disable') {
    if (caFile)
      invalid('DATABASE_SSL_CA_FILE requires DATABASE_SSL_MODE=verify-full');
    // Explicit false also prevents PGSSLMODE from changing local behavior.
    return { connectionString: parsed.href, ssl: false };
  }
  return {
    connectionString: parsed.href,
    ssl: {
      rejectUnauthorized: true,
      ...(caFile ? { ca: readCaBundle(caFile) } : {}),
    },
  };
}
