import { refuseOperator as refuse } from './operator-environment.js';
import type { TrustedExecutionContext } from './operator-execution.js';

/**
 * ADR-028 F060.3C-2e-1. The infrastructure audit boundary for production
 * operator execution.
 *
 * **Two audit trails exist and they answer different questions.** The database
 * trail (`tenant_domain_audit`, Migration 47) records what changed, and it
 * only exists if the mutation reached the database. This trail records that an
 * invocation was *attempted* — by whom, under what elevation, on what runner,
 * from what code — and it is written before anything is attempted and again
 * when the outcome is known. A refused invocation, a crash and a successful
 * change all leave a record here; only the last leaves one in the database.
 *
 * **Fail closed in a serving environment.** If the start record cannot be
 * established, production operator execution does not begin. There is
 * deliberately no silent fallback to "no audit": an unobserved production
 * mutation is exactly the thing this boundary exists to prevent, so an
 * unavailable sink is refused with `audit_unavailable` rather than downgraded
 * to a warning.
 *
 * **What this file is honest about.** The only adapter implemented here writes
 * a structured record to the process's own error stream, which means its
 * durability is entirely the runner's log pipeline. That is **not** immutable
 * off-host retention, and it is not claimed to be; immutable retention remains
 * an open infrastructure blocker recorded in the feature document. What the
 * adapter boundary buys is that satisfying that blocker later is a new
 * implementation of {@link OperatorAuditSink}, not a change to the operator
 * path.
 *
 * **No secret ever enters a record.** Payloads are assembled field by field
 * from an allowlist — the same posture as the repository's log sanitization —
 * and {@link assertAuditPayloadSafe} re-checks the assembled object before it
 * is emitted. `DATABASE_URL`, passwords, tokens, authorization headers and
 * secret-manager payloads are not read by this module at all, so there is no
 * path by which one could arrive; the assertion is the second barrier that
 * makes a future careless addition fail a test rather than ship.
 */

/** Opened before anything is attempted. */
export interface OperatorAuditStart {
  readonly phase: 'start';
  readonly invocationId: string;
  readonly occurredAt: string;
  readonly operatorIdentity: string;
  readonly identityIssuer: string;
  readonly permissions: readonly string[];
  readonly elevationRequestId: string;
  readonly elevationExpiresAt: string;
  readonly runnerIdentity: string;
  readonly runnerPlatform: string;
  readonly jobRunId: string;
  readonly commitSha: string;
  readonly imageDigest: string;
  readonly deploymentEnvironment: string;
  readonly database: string;
  readonly databaseUser: string;
  readonly operation: string;
  readonly mode: 'dry-run' | 'confirm';
  readonly organizationId: string;
  readonly hostname: string;
  readonly correlationId: string;
}

/** Written once the outcome is known, including when it is a refusal. */
export interface OperatorAuditOutcome {
  readonly phase: 'outcome';
  readonly invocationId: string;
  readonly occurredAt: string;
  readonly outcome: 'succeeded' | 'refused' | 'failed';
  /** The closed operator failure code, or null on success. Never a message. */
  readonly code: string | null;
}

export type OperatorAuditRecord = OperatorAuditStart | OperatorAuditOutcome;

/**
 * The provider-neutral sink. A cloud log service, a SIEM forwarder or an
 * append-only store is a new implementation of these two methods.
 *
 * `recordStart` is permitted to reject, and a rejection stops the invocation.
 * `recordOutcome` is called in a `finally`, so it must not mask the original
 * failure; a rejection there is reported and swallowed by the caller.
 */
export interface OperatorAuditSink {
  readonly name: string;
  recordStart(record: OperatorAuditStart): Promise<void>;
  recordOutcome(record: OperatorAuditOutcome): Promise<void>;
}

/** Field names that must never appear in a record, at any depth. Matched case
 * insensitively and as substrings, so `DATABASE_URL`, `db_password` and
 * `Authorization` are all caught. */
export const FORBIDDEN_AUDIT_KEYS: readonly string[] = [
  'database_url',
  'databaseurl',
  'connectionstring',
  'connection_string',
  'password',
  'passwd',
  'secret',
  'token',
  'credential',
  'authorization',
  'apikey',
  'api_key',
  'private_key',
  'privatekey',
  'dsn',
];

/** Value shapes that indicate a credential leaked in as *data* rather than
 * under a telling key: a URI with embedded userinfo, a bearer header, or a
 * PEM block. */
const FORBIDDEN_VALUE =
  /(^|\s)[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@|bearer\s+[A-Za-z0-9._-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/i;

/**
 * Refuses a record that carries a forbidden key or a credential-shaped value.
 *
 * Walks the whole object rather than the top level, because a nested payload
 * is exactly how a secret would arrive if someone later passed an error object
 * or a configuration blob straight through.
 */
export function assertAuditPayloadSafe(payload: unknown): void {
  const seen = new Set<unknown>();
  const walk = (value: unknown): void => {
    if (value === null || value === undefined) return;
    if (typeof value === 'string') {
      if (FORBIDDEN_VALUE.test(value))
        refuse(
          'audit_unavailable',
          'the audit record carries a credential-shaped value',
        );
      return;
    }
    if (typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    for (const [key, nested] of Object.entries(value)) {
      const lowered = key.toLowerCase();
      for (const forbidden of FORBIDDEN_AUDIT_KEYS)
        if (lowered.includes(forbidden))
          refuse(
            'audit_unavailable',
            'the audit record carries a forbidden field name',
          );
      walk(nested);
    }
  };
  walk(payload);
}

/**
 * The stream adapter: one JSON object per line on the process's error stream.
 *
 * Chosen because it requires no cloud resource and no credential, and because
 * every job runner captures the stream already. Its durability guarantee is
 * the runner's, not this adapter's — see the module comment.
 */
export function streamAuditSink(
  write: (line: string) => void = (line) => process.stderr.write(line),
): OperatorAuditSink {
  const emit = (record: OperatorAuditRecord) => {
    assertAuditPayloadSafe(record);
    write(
      JSON.stringify({
        level: 30,
        time: Date.now(),
        service: 'cityvue-api',
        msg: 'tenant domain operator invocation',
        audit: record,
      }) + '\n',
    );
  };
  return {
    name: 'stream',
    recordStart: (record) => {
      emit(record);
      return Promise.resolve();
    },
    recordOutcome: (record) => {
      emit(record);
      return Promise.resolve();
    },
  };
}

/** Development and test adapter. Retains records in memory so a test can
 * assert what was written, and is refused in a serving environment. */
export function memoryAuditSink(): OperatorAuditSink & {
  readonly records: readonly OperatorAuditRecord[];
} {
  const records: OperatorAuditRecord[] = [];
  return {
    name: 'memory',
    records,
    recordStart: (record) => {
      assertAuditPayloadSafe(record);
      records.push(record);
      return Promise.resolve();
    },
    recordOutcome: (record) => {
      assertAuditPayloadSafe(record);
      records.push(record);
      return Promise.resolve();
    },
  };
}

/** The adapters a deployment may name. `memory` exists for development and
 * tests only; naming it in a serving environment is refused. */
const SERVING_ADAPTERS: readonly string[] = ['stream'];

/**
 * Resolves the configured sink.
 *
 * A serving deployment must name one explicitly. There is no default,
 * deliberately: defaulting would mean a deployment that never configured audit
 * still appeared to have it, which is the failure this gate exists to make
 * impossible.
 */
export function resolveAuditSink(
  environment: NodeJS.ProcessEnv,
  serving: boolean,
): OperatorAuditSink {
  const requested = (environment.REQRO_OPERATOR_AUDIT_SINK ?? '').trim();
  if (!serving)
    return requested === 'stream' ? streamAuditSink() : memoryAuditSink();
  if (!requested)
    refuse(
      'audit_unavailable',
      'REQRO_OPERATOR_AUDIT_SINK is required; a serving operator invocation must name a configured audit adapter',
    );
  if (!SERVING_ADAPTERS.includes(requested))
    refuse(
      'audit_unavailable',
      'REQRO_OPERATOR_AUDIT_SINK does not name an adapter permitted in a serving environment',
    );
  return streamAuditSink();
}

export interface InvocationDescriptor {
  readonly deploymentEnvironment: string;
  readonly database: string;
  readonly databaseUser: string;
  readonly operation: string;
  readonly mode: 'dry-run' | 'confirm';
  readonly organizationId: string;
  readonly hostname: string;
  readonly correlationId: string;
}

/** Assembles the start record field by field. Nothing is spread in from the
 * environment or from a configuration object, so the record's shape is fixed
 * by this function rather than by whatever its callers happen to hold. */
export function startRecord(
  context: TrustedExecutionContext,
  descriptor: InvocationDescriptor,
  occurredAt: Date,
): OperatorAuditStart {
  return {
    phase: 'start',
    invocationId: context.invocationId,
    occurredAt: occurredAt.toISOString(),
    operatorIdentity: context.identity,
    identityIssuer: context.identityIssuer,
    permissions: context.permissions,
    elevationRequestId: context.elevationRequestId,
    elevationExpiresAt: context.elevationExpiresAt.toISOString(),
    runnerIdentity: context.runnerIdentity,
    runnerPlatform: context.runnerPlatform,
    jobRunId: context.jobRunId,
    commitSha: context.commitSha,
    imageDigest: context.imageDigest,
    deploymentEnvironment: descriptor.deploymentEnvironment,
    database: descriptor.database,
    databaseUser: descriptor.databaseUser,
    operation: descriptor.operation,
    mode: descriptor.mode,
    organizationId: descriptor.organizationId,
    hostname: descriptor.hostname,
    correlationId: descriptor.correlationId,
  };
}

/**
 * Establishes the start record, refusing the invocation if it cannot be
 * written.
 *
 * The sink's own rejection is deliberately not propagated as-is: its message
 * could carry transport detail, so it is replaced by the closed
 * `audit_unavailable` code. In a non-serving environment the same failure is
 * still refused — a test that cannot write its in-memory record is broken, and
 * a fallback here would be a path that only ever weakens the serving guarantee.
 */
export async function beginAuditedInvocation(
  sink: OperatorAuditSink,
  record: OperatorAuditStart,
): Promise<void> {
  try {
    await sink.recordStart(record);
  } catch {
    refuse(
      'audit_unavailable',
      'the operator invocation audit start record could not be established; execution did not begin',
    );
  }
}

/** Closes the invocation. Never throws: it runs in a `finally` and must not
 * replace the real failure with an audit failure. The returned boolean lets a
 * caller report a lost outcome record without changing the exit path. */
export async function completeAuditedInvocation(
  sink: OperatorAuditSink,
  record: OperatorAuditOutcome,
): Promise<boolean> {
  try {
    await sink.recordOutcome(record);
    return true;
  } catch {
    return false;
  }
}
