import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { Pool } from 'pg';
import {
  APPLICATION_SCHEMAS,
  classifyApplicationSchemas,
  refuseUnlessOwnedCleanupTarget,
  type DisposableExpectations,
} from './disposable-cluster-evidence.js';

/**
 * F062.2D-2C-3B-2 NEW-a follow-up — the disposable `reqro_f0592_test` cluster.
 *
 * Provisions ONE PostgreSQL 17 container per validation run, holding the
 * database and role the ten identity-guarded suites require. One container
 * for the whole run, not one per file: `node --test` gives each of the 66
 * database files its own process, and a per-file cluster would add 66 cold
 * starts.
 *
 * Follows `operator-role-cluster.ts`, with three deliberate differences.
 * The image is pinned by DIGEST rather than by the mutable `postgres:17-alpine`
 * tag, because the digest is the trusted identity the evidence predicate
 * checks. A nonce is injected as both a server setting and a container label,
 * so a suite can prove in-band that it is talking to this container. And
 * teardown is authorized by name before it runs, so a mistyped identifier
 * cannot remove something this run does not own.
 *
 * Credentials are generated in memory for the container's lifetime. Nothing
 * is written to any `.env`, nothing is printed and nothing is committed.
 * `reqro_dev`, `reqro_test`, the development Compose stack and the local
 * PostgreSQL 18 service are never referenced: the published port is an
 * ephemeral free port, never 5432.
 */

/**
 * The approved PostgreSQL image is pinned to a registry manifest/index digest.
 * RepoDigests establishes that identity; Docker's observed .Id is separate.
 * Depending on the store and inspection context, .Id may identify an OCI
 * index, a platform manifest or a configuration object. It is never evidence
 * of an independently verified configuration digest. That digest remains
 * unknown here. The container must report the same observed ID as this image.
 */
const IMAGE_REPOSITORY = 'postgres';
const IMAGE_REPOSITORY_DIGEST =
  'sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';
const IMAGE_REFERENCE = `${IMAGE_REPOSITORY}@${IMAGE_REPOSITORY_DIGEST}`;
const REQUIRED_MAJOR = 17;

/** Exact Docker Hub spellings only; never strip an arbitrary registry host. */
const APPROVED_REPOSITORIES = new Set([
  'postgres',
  'library/postgres',
  'docker.io/library/postgres',
  'registry-1.docker.io/library/postgres',
]);

/** A canonical content-addressable digest: `sha256:` and 64 lowercase hex. */
const CANONICAL_DIGEST = /^sha256:[0-9a-f]{64}$/;

/**
 * The delimiter in the image-inspection template. `|` cannot occur in a
 * digest, a repository reference or a tag, so a value can never contain it
 * and splitting is unambiguous.
 */
const IDENTITY_DELIMITER = '|';

/**
 * The Go template the image probe uses. One invocation returns both
 * identities, so they are read from a single consistent observation rather
 * than from two inspections that could straddle a change.
 */
const IDENTITY_FORMAT = `{{.Id}}${IDENTITY_DELIMITER}{{join .RepoDigests ","}}`;

export const TEST_DATABASE = 'reqro_f0592_test';
export const TEST_ROLE = 'reqro_test_user';

/** Volumes that must never be mounted or removed by this harness. */
export const DENIED_VOLUMES = [
  'cityvue-postgres-data',
  'server_cityvue-postgres-data',
] as const;

/**
 * The application-schema policy, re-exported from the evidence module where
 * it is defined. It lives there because this module imports that one: the
 * post-migration identity check and this run-level census must classify
 * through one policy, and defining it here would have required the evidence
 * module to import back into this one.
 *
 * The census exists to catch a test that left a scratch schema behind. It
 * predates any test applying the complete migration sequence, so it treated
 * every non-system schema as a leak, including `reqro_integration_api`, which
 * migration 51 creates by design.
 */
export { APPLICATION_SCHEMAS };

/** Observed schemas, with the migration history that may justify them. */
export interface SchemaInventory {
  /** Non-system schemas, excluding `public` and `information_schema`. */
  readonly schemas: readonly string[];
  /** Migration names the database records as applied, or `[]` if none. */
  readonly appliedMigrations: readonly string[];
}

export interface SchemaCensusVerdict {
  readonly ok: boolean;
  readonly reasons: readonly string[];
  /** Application schemas justified by their migration. */
  readonly allowed: readonly string[];
  /** Everything else: a leak, named. */
  readonly unexpected: readonly string[];
}

const schemaList = (value: unknown): string[] | null =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : null;

/**
 * Decides whether the schemas present after a run are accounted for.
 *
 * Pure, so every rejection is proven against fabricated input: no container is
 * provisioned and no database is contacted to show that an unexplained schema
 * is refused.
 */
export function evaluateSchemaCensus(input: {
  readonly before?: SchemaInventory | null;
  readonly after?: SchemaInventory | null;
}): SchemaCensusVerdict {
  const empty = { allowed: [] as readonly string[] };
  const beforeSchemas = schemaList(input.before?.schemas);
  const afterSchemas = schemaList(input.after?.schemas);
  if (beforeSchemas === null)
    return {
      ...empty,
      ok: false,
      unexpected: [],
      reasons: ['the pre-test schema inventory is missing or unreadable'],
    };
  if (afterSchemas === null)
    return {
      ...empty,
      ok: false,
      unexpected: [],
      reasons: ['the post-test schema inventory is missing or unreadable'],
    };
  const applied = schemaList(input.after?.appliedMigrations) ?? [];
  const reasons: string[] = [];
  if (beforeSchemas.length)
    reasons.push(
      `the database was not a clean baseline: ${beforeSchemas.sort().join(', ')}`,
    );

  // The same classifier the post-migration identity check uses.
  const classified = classifyApplicationSchemas(afterSchemas, applied);
  for (const { schema, migration } of classified.unjustified)
    // The schema exists but the migration that owns it did not run, so
    // something else created it. That is exactly what the census is for.
    reasons.push(
      `the schema ${schema} exists without evidence that migration ${migration} was applied`,
    );
  if (classified.foreign.length)
    reasons.push(
      `${String(classified.foreign.length)} schema(s) leaked during the run: ${classified.foreign.join(', ')}`,
    );
  const allowed = [...classified.allowed];
  const unexpected = [...afterSchemas]
    .sort()
    .filter((schema) => !allowed.includes(schema));
  return { ok: reasons.length === 0, reasons, allowed, unexpected };
}

/**
 * One Docker CLI invocation, normalised so the four outcomes can be told
 * apart: it answered, it answered with an error, it was killed, or it never
 * ran. The original shape kept only `status`, which is precisely why a CLI
 * that never answered was indistinguishable from one that answered "absent".
 */
export interface DockerResult {
  /** `null` when the process was killed or never started. */
  readonly status: number | null;
  readonly signal: string | null;
  /** The spawn or timeout failure, already summarised. */
  readonly spawnError: string | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

/** The subset of a `spawnSync` result this module reads. */
export interface SpawnLikeResult {
  readonly status?: number | null;
  readonly signal?: string | null;
  readonly error?:
    { readonly message?: string; readonly code?: string } | undefined;
  readonly stdout?: string | null;
  readonly stderr?: string | null;
}

/**
 * Pure. Normalises a `spawnSync` result.
 *
 * `stdout` and `stderr` are `null` rather than strings when the process never
 * started, so they are defaulted here: the previous `result.stdout.trim()`
 * would itself throw in exactly the case this module now has to report.
 */
export function normalizeDockerResult(
  result: SpawnLikeResult | null | undefined,
): DockerResult {
  const message = result?.error?.message ?? null;
  const signal = result?.signal ?? null;
  return {
    status: typeof result?.status === 'number' ? result.status : null,
    signal: typeof signal === 'string' && signal !== '' ? signal : null,
    spawnError: message === null ? null : summarizeDockerOutput(message),
    // `spawnSync` enforces `timeout` by killing the child, which surfaces as
    // ETIMEDOUT, as a SIGTERM signal, or as both depending on the platform.
    timedOut: (result?.error?.code ?? null) === 'ETIMEDOUT',
    stdout: (result?.stdout ?? '').trim(),
    stderr: (result?.stderr ?? '').trim(),
  };
}

function docker(args: readonly string[], timeout = 120_000): DockerResult {
  return normalizeDockerResult(
    spawnSync('docker', [...args], { encoding: 'utf8', timeout }),
  );
}

/**
 * Bounded, single-line, credential-free diagnostics. Docker's own messages
 * carry only object names, but a message is echoed into the validation log
 * and must not become a channel for anything else.
 */
export function summarizeDockerOutput(text: string, limit = 200): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const collapsed = firstLine
    .replace(/(postgres(?:ql)?:\/\/[^\s:@/]+:)[^@\s]*@/gi, '$1[redacted]@')
    .replace(
      /\b([A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|NONCE)\s*[=:]\s*)\S+/g,
      '$1[redacted]',
    )
    .replace(/\s+/g, ' ')
    .trim();
  return collapsed.length <= limit
    ? collapsed
    : `${collapsed.slice(0, limit)}...`;
}

export type CleanupOutcome = 'absent' | 'present' | 'unknown';

export interface CleanupVerification {
  readonly outcome: CleanupOutcome;
  readonly detail: string;
}

/**
 * Docker's not-found wording, as this CLI actually phrases it. Measured
 * against Docker 29.7.2 / API 1.55 rather than assumed:
 *
 *   docker inspect <absent>           exit 1  "error: no such object: <id>"
 *   docker container inspect <absent> exit 1  "Error response from daemon:
 *                                              No such container: <id>"
 *   docker volume inspect <absent>    exit 1  "Error response from daemon:
 *                                              get <name>: no such volume"
 *   docker inspect <present>          exit 0
 *
 * Also measured: `docker rm --force --volumes <absent>` exits 0 and prints
 * nothing, so a successful removal command is NOT evidence of removal. The
 * absence probe is the only authority.
 */
const NOT_FOUND_PATTERNS = [
  /\bno such object\b/i,
  /\bno such container\b/i,
  /\bno such volume\b/i,
] as const;

/**
 * Failures that must never be read as absence, however they exit. A daemon
 * that cannot be reached, or a client that is not permitted to ask, has said
 * nothing at all about whether the resource still exists.
 */
const INCONCLUSIVE_PATTERNS = [
  /cannot connect to the docker daemon/i,
  /error during connect/i,
  /is the docker daemon running/i,
  /permission denied/i,
  /access is denied/i,
  /\bunauthorized\b/i,
  /\binternal server error\b/i,
  /\bconnection refused\b/i,
  /\bi\/o timeout\b/i,
  /context deadline exceeded/i,
] as const;

/**
 * Pure. Did Docker POSITIVELY establish that `name` is gone?
 *
 * The invariant: absence is reported only when a query succeeded and proved
 * the resource missing, by way of a not-found response this function
 * recognises. A timeout, a signal, a missing exit status, a failed spawn, a
 * daemon error, an access error, or any exit code Docker did not explain in
 * recognised words is `unknown` -- never `absent`.
 *
 * This is the correction. The previous expression
 *
 *   docker(['inspect', containerId]).status !== 0
 *
 * mapped every one of those cases to "removed", because `status` is `null`
 * for a killed or unstarted process and `null !== 0` is true. A container
 * that survived teardown was therefore reported as cleanly removed whenever
 * the Docker CLI failed to answer.
 */
export function classifyResourceAbsence(
  kind: 'container' | 'volume',
  name: string,
  probe: DockerResult | null | undefined,
): CleanupVerification {
  if (probe === null || probe === undefined)
    return {
      outcome: 'unknown',
      detail: `the ${kind} ${name} was never queried, so its removal is unverified`,
    };
  if (probe.timedOut)
    return {
      outcome: 'unknown',
      detail: `the ${kind} ${name} check timed out, so its removal is unverified`,
    };
  if (probe.spawnError !== null)
    return {
      outcome: 'unknown',
      detail: `the docker CLI could not be run to check the ${kind} ${name}: ${probe.spawnError}`,
    };
  if (probe.signal !== null)
    return {
      outcome: 'unknown',
      detail: `the ${kind} ${name} check was terminated by ${probe.signal}, so its removal is unverified`,
    };
  if (probe.status === null)
    return {
      outcome: 'unknown',
      detail: `the ${kind} ${name} check reported no exit status, so its removal is unverified`,
    };
  if (probe.status === 0)
    return {
      outcome: 'present',
      detail: `docker still reports the ${kind} ${name}, so it was not removed`,
    };
  // A non-zero exit only means "not a successful inspection". Which failure
  // it was decides everything, so the wording is read before the code, and
  // the inconclusive shapes are read before the not-found ones.
  if (INCONCLUSIVE_PATTERNS.some((pattern) => pattern.test(probe.stderr)))
    return {
      outcome: 'unknown',
      detail: `docker could not answer for the ${kind} ${name}: ${summarizeDockerOutput(probe.stderr)}`,
    };
  if (NOT_FOUND_PATTERNS.some((pattern) => pattern.test(probe.stderr)))
    return {
      outcome: 'absent',
      detail: `docker reports no such ${kind}: ${name}`,
    };
  return {
    outcome: 'unknown',
    detail: `docker exited ${String(probe.status)} for the ${kind} ${name} without a recognised not-found response: ${
      probe.stderr === '' ? '(no stderr)' : summarizeDockerOutput(probe.stderr)
    }`,
  };
}

/** The anonymous volume this run must remove, or why it is not known. */
export type VolumeTarget =
  | { readonly kind: 'none' }
  | { readonly kind: 'known'; readonly name: string }
  | { readonly kind: 'unknown'; readonly detail: string };

/**
 * Pure. Reads the owned anonymous volume from a PRE-removal container
 * inspection, because once the container is gone its mount list is gone too.
 *
 * The distinction that matters: "this container has no volume mount" is a
 * legitimate nothing-to-do, whereas "the inspection did not answer" is not.
 * The previous code collapsed both into `null`, and the subsequent
 * `volume === null || ...` then made the volume check vacuously succeed.
 */
export function volumeTargetFromProbe(
  containerId: string,
  probe: DockerResult | null | undefined,
): VolumeTarget {
  const classified = classifyResourceAbsence('container', containerId, probe);
  if (classified.outcome === 'unknown')
    return { kind: 'unknown', detail: classified.detail };
  if (classified.outcome === 'absent')
    return {
      kind: 'unknown',
      detail: `the container ${containerId} was already absent before teardown, so its anonymous volume could not be identified`,
    };

  let parsed: unknown;
  try {
    parsed = JSON.parse(probe?.stdout ?? '');
  } catch {
    return {
      kind: 'unknown',
      detail: `the container ${containerId} inspection was not valid JSON, so its anonymous volume could not be identified`,
    };
  }
  if (!Array.isArray(parsed) || parsed.length === 0)
    return {
      kind: 'unknown',
      detail: `the container ${containerId} inspection returned no records, so its anonymous volume could not be identified`,
    };
  const raw = parsed[0] as {
    Mounts?: { Type?: string; Name?: string }[];
  };
  const named = (raw.Mounts ?? []).filter(
    (mount) => mount.Type === 'volume' && (mount.Name ?? '') !== '',
  );
  const [first] = named;
  if (first?.Name === undefined || first.Name === '') return { kind: 'none' };
  return { kind: 'known', name: first.Name };
}

/** Everything the cleanup verdict is computed from. */
export interface CleanupProbes {
  readonly containerId: string;
  /** A pre-action authorization refusal, when teardown was never attempted. */
  readonly refusal: string | null;
  /** `null` when the removal command was not run. */
  readonly removal: DockerResult | null;
  readonly containerAbsence: DockerResult | null;
  readonly volume: VolumeTarget;
  readonly volumeAbsence: DockerResult | null;
}

/**
 * The cleanup result. The four original fields keep their names, types and
 * meaning so existing callers are unaffected; the rest are additive
 * diagnostics.
 */
export interface CleanupResult {
  readonly containerRemoved: boolean;
  readonly volumeRemoved: boolean;
  readonly volumeName: string | null;
  readonly refusal: string | null;
  readonly containerVerification: CleanupVerification;
  readonly volumeVerification: CleanupVerification;
  readonly removalExitStatus: number | null;
  /** `null` when the removal command itself reported no problem. */
  readonly removalDetail: string | null;
}

function removalDetailOf(removal: DockerResult | null): string | null {
  if (removal === null) return 'the removal command was not attempted';
  if (removal.timedOut) return 'the removal command timed out';
  if (removal.spawnError !== null)
    return `the removal command could not be run: ${removal.spawnError}`;
  if (removal.signal !== null)
    return `the removal command was terminated by ${removal.signal}`;
  if (removal.status === null)
    return 'the removal command reported no exit status';
  if (removal.status !== 0)
    return `the removal command exited ${String(removal.status)}: ${
      removal.stderr === ''
        ? '(no stderr)'
        : summarizeDockerOutput(removal.stderr)
    }`;
  return null;
}

/**
 * Pure. The cleanup verdict.
 *
 * `containerRemoved` and `volumeRemoved` are true ONLY on a positively
 * verified absence, so an unverified teardown fails the mandatory validation
 * gate instead of passing it.
 *
 * Both resources are judged independently and unconditionally: one
 * inconclusive check never suppresses the other's result, and a failed
 * removal command does not stop either absence check from being reported.
 */
export function verifyCleanup(probes: CleanupProbes): CleanupResult {
  const containerVerification = classifyResourceAbsence(
    'container',
    probes.containerId,
    probes.containerAbsence,
  );

  let volumeVerification: CleanupVerification;
  if (probes.volume.kind === 'none')
    volumeVerification = {
      outcome: 'absent',
      detail:
        'no anonymous volume was attached, so there was nothing to remove',
    };
  else if (probes.volume.kind === 'unknown')
    volumeVerification = { outcome: 'unknown', detail: probes.volume.detail };
  else
    volumeVerification = classifyResourceAbsence(
      'volume',
      probes.volume.name,
      probes.volumeAbsence,
    );

  return {
    containerRemoved: containerVerification.outcome === 'absent',
    volumeRemoved: volumeVerification.outcome === 'absent',
    volumeName: probes.volume.kind === 'known' ? probes.volume.name : null,
    refusal: probes.refusal,
    containerVerification,
    volumeVerification,
    removalExitStatus: probes.removal?.status ?? null,
    removalDetail: removalDetailOf(probes.removal),
  };
}

/** Ephemeral, in-memory only. Never persisted or printed. */
function secret(): string {
  return randomBytes(24).toString('base64url');
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    // Loopback only, matching how the container publishes.
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close();
        reject(new Error('could not determine a free port'));
        return;
      }
      const { port } = address;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

export function dockerAvailable(): boolean {
  return (
    docker(['info', '--format', '{{.ServerVersion}}'], 60_000).status === 0
  );
}

export interface DisposableCluster {
  readonly container: string;
  readonly containerId: string;
  readonly port: number;
  readonly nonce: string;
  readonly epoch: Date;
  readonly imageReference: string;
  /**
   * Docker's `.Id` for the running image: the Docker-observed image ID, not the
   * approved registry digest. It is what binds this container to the image
   * this run inspected.
   */
  readonly imageId: string;
  /** The approved REPOSITORY DIGEST, verified against `.RepoDigests`. */
  readonly imageRepositoryDigest: string;
  /** The URL the suites receive as `TEST_DATABASE_URL`. */
  readonly testUrl: string;
  /** The expectations the evidence predicate is given. */
  expectations(): DisposableExpectations;
  /** Environment the test child processes inherit. No credential leaves here
   * except inside `TEST_DATABASE_URL`, which the suites require. */
  environment(): Record<string, string>;
  /** Counts schemas that no test created. */
  census(): Promise<number>;
  /**
   * Names those schemas, alongside the migrations the database records as
   * applied. A count alone cannot tell an application schema that an approved
   * migration created from a scratch schema a test forgot to drop.
   */
  schemaInventory(): Promise<SchemaInventory>;
  /**
   * Authorized teardown. Returns removal evidence in which `containerRemoved`
   * and `volumeRemoved` mean VERIFIED absence, never merely "docker did not
   * say otherwise".
   */
  destroy(): Promise<CleanupResult>;
}

/** The two identities of one approved local image, told apart. */
export interface VerifiedImageIdentity {
  /** The approved registry identity, matched against `.RepoDigests`. */
  readonly repositoryDigest: string;
  /**
   * Docker's `.Id` for the resolved image. Store-dependent, recorded as
   * evidence and bound to the container that runs it -- never treated as the
   * registry identity.
   */
  readonly observedImageId: string;
}

export type ImageIdentityVerdict =
  | { readonly ok: true; readonly identity: VerifiedImageIdentity }
  | { readonly ok: false; readonly reason: string };

/**
 * Pure. Decides whether one image probe proves the approved image is present,
 * and separates the two identities it reports.
 *
 * Fail-closed by construction: every branch that is not an affirmative match
 * refuses. A probe that did not run, was killed, answered non-zero, answered
 * nothing, answered something unparseable, or carries only a mutable tag is a
 * verification failure, not a soft pass. Being pure, each of those branches is
 * provable against fabricated input, which is the only way the
 * never-reached-in-practice ones get covered at all.
 */
export function evaluateImageIdentity(
  probe: DockerResult,
  expected: { readonly repository: string; readonly repositoryDigest: string },
): ImageIdentityVerdict {
  const refuse = (reason: string): ImageIdentityVerdict => ({
    ok: false,
    reason,
  });

  // 1. The probe must have run to completion and answered. A timeout is
  //    checked first: `spawnSync` reports it as an ETIMEDOUT spawn error, a
  //    signal, or both, and the timeout is the more precise cause.
  if (probe.timedOut)
    return refuse(
      'Docker image inspection timed out, so the image is unverified',
    );
  if (probe.spawnError !== null)
    return refuse(`Docker image inspection could not run: ${probe.spawnError}`);
  if (probe.signal !== null)
    return refuse(
      `Docker image inspection was terminated by ${probe.signal}, so the image is unverified`,
    );
  if (probe.status !== 0)
    return refuse(
      `the approved PostgreSQL image is unavailable locally: ${
        probe.stderr === '' ? 'Docker reported no detail' : probe.stderr
      }`,
    );
  if (probe.stdout === '')
    return refuse('Docker image inspection returned no image metadata');

  if (/\s/.test(probe.stdout))
    return refuse('malformed image metadata contains whitespace');

  // 2. The response must have the shape the template asks for. An absent
  //    delimiter means the template did not render, not that there are no
  //    repository digests -- those cases are distinguishable and only the
  //    second is allowed to continue.
  const split = probe.stdout.indexOf(IDENTITY_DELIMITER);
  if (split === -1 || probe.stdout.lastIndexOf(IDENTITY_DELIMITER) !== split)
    return refuse('Docker image inspection returned malformed image metadata');
  const observedImageId = probe.stdout.slice(0, split);
  const digestList = probe.stdout.slice(split + 1);

  // 3. The Docker-observed image ID is recorded, so it must itself be well formed.
  //    It is NOT compared with the approved repository digest.
  if (!CANONICAL_DIGEST.test(observedImageId))
    return refuse(
      `the Docker-observed image ID is not a canonical sha256 digest: ${
        observedImageId === '' ? 'empty' : observedImageId
      }`,
    );

  // Expectations come from the fixed launcher pin, never metadata or a tag.
  if (
    expected.repository !== IMAGE_REPOSITORY ||
    !CANONICAL_DIGEST.test(expected.repositoryDigest)
  )
    return refuse('unsupported approved repository identity');

  if (digestList === '')
    return refuse(
      'the local image carries no repository digest; mutable tags are refused',
    );
  const entries = digestList.split(',');
  if (new Set(entries).size !== entries.length)
    return refuse('duplicate repository digest metadata is ambiguous');
  for (const entry of entries) {
    const at = entry.indexOf('@');
    if (at <= 0 || at !== entry.lastIndexOf('@'))
      return refuse('malformed repository digest metadata');
    const repository = entry.slice(0, at);
    const repositoryDigest = entry.slice(at + 1);
    if (!CANONICAL_DIGEST.test(repositoryDigest))
      return refuse('malformed repository digest metadata');
    if (!APPROVED_REPOSITORIES.has(repository))
      return refuse('unexpected repository reference: ' + repository);
    // Every entry must resolve to the same approved identity. An approved
    // entry cannot rescue contradictory metadata or a foreign repository.
    if (repositoryDigest !== expected.repositoryDigest)
      return refuse(
        'repository digest differs from approved ' + expected.repositoryDigest,
      );
  }

  return {
    ok: true,
    identity: { repositoryDigest: expected.repositoryDigest, observedImageId },
  };
}

/**
 * Confirms the approved image is present locally and really carries the
 * approved repository digest, and reports both identities for evidence.
 */
function verifyImage(): VerifiedImageIdentity {
  const verdict = evaluateImageIdentity(
    docker(['image', 'inspect', IMAGE_REFERENCE, '--format', IDENTITY_FORMAT]),
    {
      repository: IMAGE_REPOSITORY,
      repositoryDigest: IMAGE_REPOSITORY_DIGEST,
    },
  );
  if (!verdict.ok) throw new Error(verdict.reason);
  return verdict.identity;
}

/**
 * Starts the cluster and provisions the test identity. The returned handle
 * must be destroyed in a `finally`.
 */
export async function startDisposableCluster(): Promise<DisposableCluster> {
  // Both identities come from this one verified observation. The container is
  // created from `IMAGE_REFERENCE` alone, so the approved pinned reference
  // remains the only thing that can be launched.
  const image = verifyImage();

  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const container = `reqro-f0592-pg17-${suffix}`;
  const nonce = randomUUID().replaceAll('-', '');
  const bootstrap = { user: 'reqro_cluster_admin', password: secret() };
  const testRole = { user: TEST_ROLE, password: secret() };
  const port = await freePort();
  // Recorded BEFORE the container exists, so "created after the epoch" is a
  // real ordering rather than a tautology.
  const epoch = new Date();

  if (port === 5432)
    throw new Error('refusing to publish on 5432, the local service port');

  const urlFor = (role: { user: string; password: string }, database: string) =>
    `postgresql://${encodeURIComponent(role.user)}:${encodeURIComponent(
      role.password,
    )}@127.0.0.1:${String(port)}/${database}`;

  const started = docker([
    'run',
    '--detach',
    '--name',
    container,
    '--publish',
    `127.0.0.1:${String(port)}:5432`,
    '--label',
    `com.reqro.disposable=${nonce}`,
    '--env',
    `POSTGRES_USER=${bootstrap.user}`,
    '--env',
    `POSTGRES_PASSWORD=${bootstrap.password}`,
    '--env',
    'POSTGRES_DB=reqro_bootstrap',
    // No `--volume`: the image declares its own VOLUME, so Docker creates an
    // ANONYMOUS volume that `docker rm --volumes` removes. No development
    // volume is named, mounted or reachable.
    IMAGE_REFERENCE,
    // The nonce as a server setting. Injected out of band, read back in band.
    'postgres',
    '-c',
    `reqro.disposable_nonce=${nonce}`,
  ]);
  if (started.status !== 0)
    throw new Error(
      `could not start the disposable cluster: ${started.stderr}`,
    );
  const containerId = started.stdout;

  const bootstrapUrl = urlFor(bootstrap, 'reqro_bootstrap');
  const testUrl = urlFor(testRole, TEST_DATABASE);

  const expectations = (): DisposableExpectations => ({
    database: TEST_DATABASE,
    role: TEST_ROLE,
    nonce,
    containerId,
    imageReference: IMAGE_REFERENCE,
    imageId: image.observedImageId,
    imageRepositoryDigest: image.repositoryDigest,
    harnessEpoch: epoch,
    deniedVolumeNames: DENIED_VOLUMES,
  });

  const destroy = async (): Promise<CleanupResult> => {
    // Identify the anonymous volume BEFORE removal: `docker rm` takes the
    // mount list with it, so afterwards there is nothing left to read.
    const volume = volumeTargetFromProbe(
      containerId,
      docker(['inspect', containerId], 60_000),
    );

    // Authorize before destroying, not after. An unidentified volume is not a
    // teardown target, so it contributes no name to authorize -- it fails
    // closed later, in the verdict, rather than widening what is removed.
    const refusal = refuseUnlessOwnedCleanupTarget(
      {
        containerId,
        volumeNames: volume.kind === 'known' ? [volume.name] : [],
      },
      { containerId, deniedVolumeNames: DENIED_VOLUMES },
    );
    if (refusal !== null)
      return verifyCleanup({
        containerId,
        refusal,
        removal: null,
        containerAbsence: null,
        volume,
        volumeAbsence: null,
      });

    const removal = docker(['rm', '--force', '--volumes', containerId], 90_000);
    await Promise.resolve();
    // Both absence checks run however the removal went, so a failed step
    // never hides the other resource's state. `docker rm --force` exits 0
    // even for a container that was never there, which is exactly why the
    // removal's own status is recorded but is not the evidence.
    const containerAbsence = docker(['inspect', containerId], 60_000);
    const volumeAbsence =
      volume.kind === 'known'
        ? docker(['volume', 'inspect', volume.name], 60_000)
        : null;
    return verifyCleanup({
      containerId,
      refusal: null,
      removal,
      containerAbsence,
      volume,
      volumeAbsence,
    });
  };

  try {
    // Readiness, bounded. `pg_isready` runs inside the container, so the host
    // needs no PostgreSQL client.
    let ready = false;
    for (let attempt = 0; attempt < 90 && !ready; attempt++) {
      ready =
        docker(
          [
            'exec',
            container,
            'pg_isready',
            '-U',
            bootstrap.user,
            '-d',
            'reqro_bootstrap',
          ],
          20_000,
        ).status === 0;
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!ready)
      throw new Error('the disposable cluster did not become ready in time');

    // `pg_isready` is necessary but not sufficient: the official entrypoint
    // initializes against a temporary local-only server and then restarts the
    // real one, so there is a window in which `pg_isready` succeeds while a
    // published-port connection is still refused. The real condition is a
    // successful round trip over TCP.
    let accepted = false;
    let lastRefusal = '';
    for (let attempt = 0; attempt < 60 && !accepted; attempt++) {
      const probe = new Pool({
        connectionString: bootstrapUrl,
        max: 1,
        connectionTimeoutMillis: 5000,
      });
      try {
        await probe.query('select 1');
        accepted = true;
      } catch (error) {
        lastRefusal = (error as Error).message;
      } finally {
        await probe.end().catch(() => undefined);
      }
      if (!accepted) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!accepted)
      throw new Error(
        `the disposable cluster never accepted a connection: ${lastRefusal}`,
      );

    const admin = new Pool({ connectionString: bootstrapUrl, max: 2 });
    try {
      // The authoritative version gate: refuse anything but 17.
      const version = await admin.query<{ setting: string; full: string }>(
        `select current_setting('server_version_num') as setting,
                current_setting('server_version') as full`,
      );
      const major = Math.floor(Number(version.rows[0]?.setting ?? 0) / 10_000);
      if (major !== REQUIRED_MAJOR)
        throw new Error(
          `the disposable cluster must be PostgreSQL ${String(
            REQUIRED_MAJOR,
          )}, got ${version.rows[0]?.full ?? 'unknown'}`,
        );

      // The nonce must be readable by the NON-superuser test role, which is
      // what makes the in-band check available to the suites at all.
      const setting = await admin.query<{ value: string | null }>(
        "select current_setting('reqro.disposable_nonce', true) as value",
      );
      if (setting.rows[0]?.value !== nonce)
        throw new Error('the disposable nonce was not applied to the server');

      // Deliberately not a superuser and unable to create roles or
      // databases: the suites prove constrained behaviour, so the role they
      // run as must actually be constrained.
      await admin.query(
        `create role ${TEST_ROLE} login password '${testRole.password}'
           nosuperuser nocreatedb nocreaterole noinherit nobypassrls`,
      );
      // Owning the database grants CREATE on it and on its `public` schema,
      // which is what the per-test disposable schemas need.
      await admin.query(`create database ${TEST_DATABASE} owner ${TEST_ROLE}`);
      // PUBLIC keeps TEMPORARY and `public` CREATE on purpose. Revoking them
      // would be a tighter production posture but would disable the `pg_temp`
      // shadowing evidence F060.3C-2c-2 depends on.
    } finally {
      await admin.end();
    }
  } catch (error) {
    await destroy();
    throw error;
  }

  return {
    container,
    containerId,
    port,
    nonce,
    epoch,
    imageReference: IMAGE_REFERENCE,
    imageId: image.observedImageId,
    imageRepositoryDigest: image.repositoryDigest,
    testUrl,
    expectations,
    environment: () => ({
      TEST_DATABASE_URL: testUrl,
      REQRO_DISPOSABLE_NONCE: nonce,
      REQRO_DISPOSABLE_CONTAINER_ID: containerId,
      REQRO_DISPOSABLE_IMAGE_REFERENCE: IMAGE_REFERENCE,
      REQRO_DISPOSABLE_IMAGE_ID: image.observedImageId,
      REQRO_DISPOSABLE_IMAGE_REPOSITORY_DIGEST: image.repositoryDigest,
      REQRO_DISPOSABLE_EPOCH: epoch.toISOString(),
    }),
    census: async () => {
      const pool = new Pool({ connectionString: testUrl, max: 1 });
      try {
        const result = await pool.query<{ count: number }>(
          `select count(*)::int count from pg_namespace
            where nspname not like 'pg_%'
              and nspname not in ('information_schema', 'public')`,
        );
        return result.rows[0]?.count ?? -1;
      } finally {
        await pool.end();
      }
    },
    schemaInventory: async () => {
      const pool = new Pool({ connectionString: testUrl, max: 1 });
      try {
        const schemas = await pool.query<{ nspname: string }>(
          `select nspname from pg_namespace
            where nspname not like 'pg_%'
              and nspname not in ('information_schema', 'public')
            order by nspname`,
        );
        // The migration history lives in `public` and exists only once some
        // test has migrated the database itself. Its absence is normal and
        // means no application schema can be justified.
        const present = await pool.query(
          `select 1 from pg_tables
            where schemaname = 'public' and tablename = 'kysely_migration'`,
        );
        const appliedMigrations =
          present.rowCount === 0
            ? []
            : (
                await pool.query<{ name: string }>(
                  'select name from kysely_migration order by name',
                )
              ).rows.map((row) => row.name);
        return {
          schemas: schemas.rows.map((row) => row.nspname),
          appliedMigrations,
        };
      } finally {
        await pool.end();
      }
    },
    destroy,
  };
}
