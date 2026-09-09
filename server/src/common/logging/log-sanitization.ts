import type { Request } from 'express';

/** Operational logs are an allowlist, not a dump of application objects. */
const messages = new Set([
  'Application event',
  'CityVUE API started',
  'API startup failed',
  'request completed',
  'request errored',
  'request aborted',
  'Unhandled request error',
  'Idle PostgreSQL client error',
  'PostgreSQL readiness check failed',
  'Migration command failed',
  'Development seed failed',
  'Location eligibility validation started',
  'Location eligibility validation completed',
]);

const errorNames = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'AggregateError',
  'DatabaseError',
  'HttpException',
  'ServiceUnavailableException',
  'InternalServerErrorException',
]);
const errorCodes = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ENOENT',
  'EACCES',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  '23502',
  '23503',
  '23505',
  '23514',
  '28000',
  '28P01',
  '40001',
  '40P01',
  '42501',
  '42601',
  '42703',
  '42P01',
  '53300',
  '57014',
  '57P01',
  '57P02',
  '57P03',
  '08000',
  '08001',
  '08003',
  '08006',
]);

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function member(value: unknown, allowed: Set<string>): string | undefined {
  return typeof value === 'string' && allowed.has(value) ? value : undefined;
}

export function safeLogMessage(value: unknown): string {
  return member(value, messages) ?? 'Application event';
}

export function safeErrorContext(error: unknown): Record<string, string> {
  const input = record(error);
  return {
    errorName: member(input.name, errorNames) ?? 'UnknownError',
    errorCode: member(input.code, errorCodes) ?? 'unknown',
  };
}

const httpRoutes = new WeakMap<object, string>();

/** Internal HTTP boundary: pass the real framework request after routing.
 * The template is kept out of enumerable fields so spreading, serialization,
 * custom contexts and child bindings cannot carry its trusted provenance.
 */
export function requestLogContext(
  request: Request,
  extra: unknown = {},
): Record<string, unknown> {
  const input = record(request);
  const path = record(input.route).path;
  const context = sanitizeLogContext({
    ...sanitizeLogContext(extra),
    requestId: input.id,
    method: input.method,
    requestContentType: safeContentType(record(input.headers)['content-type']),
  });
  httpRoutes.set(context, typeof path === 'string' ? path : 'unmatched');
  return context;
}

export function trustedHttpRoute(context: unknown): string | undefined {
  return context !== null && typeof context === 'object'
    ? httpRoutes.get(context)
    : undefined;
}

export function safeServiceMetadata(value: {
  version: string;
  environment: string;
}): { service: string; version: string; environment: string } {
  return {
    service: 'cityvue-api',
    version:
      value.version === value.version.trim() &&
      /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value.version)
        ? value.version
        : 'unknown',
    environment: ['development', 'test', 'production'].includes(
      value.environment,
    )
      ? value.environment
      : 'unknown',
  };
}

const contentTypes = new Set([
  'application/json',
  'application/problem+json',
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
  'text/html',
  'application/octet-stream',
]);

/** Keep only known media types, never boundary/charset parameters or raw headers. */
export function safeContentType(value: unknown): string | undefined {
  return typeof value === 'string'
    ? member(value.split(';')[0]?.trim().toLowerCase(), contentTypes)
    : undefined;
}

const methods = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'CONNECT',
  'TRACE',
]);
const enums: Record<string, Set<string>> = {
  errorName: new Set([...errorNames, 'UnknownError']),
  errorCode: new Set([...errorCodes, 'unknown']),
  environment: new Set(['development', 'test', 'production']),
  component: new Set(['api', 'http', 'database', 'migration', 'seed', 'nest']),
  requestContentType: contentTypes,
  responseContentType: contentTypes,
  policyType: new Set([
    'no_geographic_restriction',
    'city_boundary',
    'service_area',
    'city_maintained_roadway',
    'city_owned_property',
    'facility',
    'park',
    'gis_asset',
    'utility_service_area',
  ]),
  result: new Set(['eligible', 'ineligible', 'unable_to_determine']),
  reasonCode: new Set([
    'provider_unavailable',
    'development_match',
    'development_outside',
    'development_no_match',
  ]),
};

/** Unknown fields (including route, nested contexts, bodies and headers) are omitted.
 * Custom IDs must be UUID v4; HTTP IDs are always generated by the server.
 */
export function sanitizeLogContext(value: unknown): Record<string, unknown> {
  const input = record(value);
  const output: Record<string, unknown> = {};
  if (value instanceof Error) Object.assign(output, safeErrorContext(value));
  if (input.err !== undefined)
    Object.assign(output, safeErrorContext(input.err));
  for (const [key, allowed] of Object.entries(enums)) {
    const result = member(input[key], allowed);
    if (result !== undefined) output[key] = result;
  }
  const requestId = input.requestId ?? input.reqId;
  if (
    typeof requestId === 'string' &&
    requestId.length === 36 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      requestId,
    )
  ) {
    output.requestId = requestId;
  }
  const method = member(input.method, methods);
  if (method) output.method = method;
  for (const key of ['statusCode', 'durationMs', 'port']) {
    const number = input[key];
    if (typeof number === 'number' && Number.isFinite(number) && number >= 0)
      output[key] = number;
  }
  return output;
}

/** CLI/bootstrap failures share API error classification; never print error.message. */
export function commandFailure(message: string, error: unknown): string {
  const configurationError =
    error instanceof Error &&
    error.message.startsWith('Invalid server configuration:');
  return (
    JSON.stringify({
      level: 50,
      time: Date.now(),
      service: 'cityvue-api',
      msg: safeLogMessage(message),
      ...safeErrorContext(error),
      ...(configurationError
        ? { classification: 'Invalid server configuration' }
        : {}),
    }) + '\n'
  );
}
