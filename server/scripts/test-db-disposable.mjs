#!/usr/bin/env node
/**
 * F062 — the mandatory disposable-PostgreSQL validation gate.
 *
 * Provisions one disposable PostgreSQL 17 container, runs the database tier
 * and the database-dependent E2E tier against it SERIALLY, proves no schema
 * leaked, and tears the container and its anonymous volume down with
 * verification.
 *
 * The verdict is deliberately unforgiving, because every lenient reading is a
 * way for an incomplete validation to be mistaken for a passing one. The two
 * decisions that matter -- "did this tier really pass?" and "did this run
 * really pass?" -- are PURE functions (`evaluateTier`, `evaluateRun`),
 * exported so they can be proven against fabricated inputs rather than only
 * exercised by a happy-path run.
 *
 * F060 compatibility — the optional evidence channel. `--evidence`
 * additionally preserves each child invocation's exact command, raw stdout,
 * raw stderr, exit status, termination signal, spawn error, discovery and
 * completion state, counts and outcomes, alongside the schema census and the
 * cleanup results. The channel exists so a later, independently supervised
 * non-production CI run has something to collect; it changes no verdict a
 * default run reaches. Whether the bundle is COMPLETE is itself a pure,
 * exported decision (`evaluateCapture`), and an incomplete or unwritable
 * bundle is a failure rather than a silent omission.
 *
 * Importing this module has no side effects: `main()` runs only when the file
 * is the process entry point, so the unit tests can load the verdict logic
 * without provisioning anything.
 *
 * It does not print credentials. `TEST_DATABASE_URL` reaches the child
 * processes through the environment and is redacted wherever it is echoed.
 * Evidence files are redacted on the same basis; see `redactSensitive`.
 *
 * Output uses `process.stdout` rather than `console`, matching the lint
 * configuration for `scripts/*.mjs`.
 *
 * Usage:  node scripts/test-db-disposable.mjs [--skip-compile] [--evidence]
 */
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The mandatory tiers and their floors. Held here rather than at the call
 * site so a caller cannot pair a tier with the wrong floor, and so an
 * unrecognised tier name is itself a refusal.
 *
 * The floors close a silent-success path: `node --test` over a directory
 * holding no test files reports `# tests 0`, zero failures and exit 0, so a
 * stale, emptied or mis-resolved compile directory would otherwise be
 * indistinguishable from a clean pass. Floors rather than equalities, so
 * legitimately added tests do not trip the gate while a collapse in coverage
 * does. Reviewed against measured inventories of 1007 and 115.
 */
export const MANDATORY_TIERS = Object.freeze({
  database: Object.freeze({ directory: 'database', minimum: 1000 }),
  e2e: Object.freeze({ directory: 'e2e', minimum: 110 }),
});

const SUMMARY_KEYS = ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'];

/**
 * Reads the TAP trailer as DATA. Reports ambiguity and truncation rather than
 * silently taking a first match, because a duplicated or partial summary is
 * not evidence.
 */
export function parseTapSummary(output) {
  const text = typeof output === 'string' ? output : '';
  const counts = {};
  const ambiguous = [];
  const missing = [];
  for (const key of SUMMARY_KEYS) {
    const found = [...text.matchAll(new RegExp(`^# ${key} (\\d+)$`, 'gm'))].map(
      (match) => Number(match[1]),
    );
    const distinct = [...new Set(found)];
    if (found.length === 0) {
      missing.push(key);
      counts[key] = null;
    } else if (distinct.length > 1) {
      ambiguous.push(key);
      counts[key] = null;
    } else {
      counts[key] = distinct[0];
    }
  }
  return {
    counts,
    ambiguous,
    missing,
    // `# duration_ms` is the last line the reporter emits, so its absence
    // alongside a present summary means the output was cut off.
    complete: /^# duration_ms /m.test(text),
    hasPlan: /^1\.\.\d+$/m.test(text),
  };
}

/**
 * Pure. The verdict for one mandatory tier.
 *
 * `reasons` is empty exactly when the tier genuinely passed. Anything absent,
 * inconsistent, partial, skipped or cancelled produces a reason.
 */
export function evaluateTier(input) {
  const reasons = [];
  const tier = input?.tier;
  const spec = Object.prototype.hasOwnProperty.call(MANDATORY_TIERS, tier)
    ? MANDATORY_TIERS[tier]
    : undefined;
  if (spec === undefined) {
    reasons.push(
      `unknown mandatory tier ${JSON.stringify(tier ?? null)}; refusing to treat it as validated`,
    );
    return { ok: false, tier, counts: null, reasons };
  }

  if (input.directoryPresent === false)
    reasons.push(`${tier}: the compiled test directory is missing`);
  if (input.spawnError)
    reasons.push(
      `${tier}: the test runner could not start (${input.spawnError})`,
    );
  // A non-zero runner status is independent evidence; it must not be excused
  // by a summary that happens to look clean.
  if (input.status !== 0)
    reasons.push(
      `${tier}: the test runner exited with status ${JSON.stringify(input.status ?? null)}`,
    );

  const summary = parseTapSummary(input.output);
  const { counts } = summary;
  if (summary.missing.length > 0)
    reasons.push(
      `${tier}: the TAP summary is missing ${summary.missing.join(', ')}, so the run is not evidence`,
    );
  if (summary.ambiguous.length > 0)
    reasons.push(
      `${tier}: the TAP summary reports conflicting values for ${summary.ambiguous.join(', ')}`,
    );
  if (!summary.complete)
    reasons.push(`${tier}: the TAP output is truncated or interrupted`);
  if (!summary.hasPlan) reasons.push(`${tier}: the TAP plan line is absent`);

  if (counts.tests !== null) {
    if (counts.tests <= 0)
      reasons.push(
        `${tier}: no tests were discovered, so nothing was validated`,
      );
    else if (counts.tests < spec.minimum)
      reasons.push(
        `${tier}: only ${counts.tests} test(s) ran, below the reviewed floor of ${spec.minimum}`,
      );
  }
  if (counts.pass !== null && counts.pass < 0)
    reasons.push(`${tier}: a negative pass count is not evidence`);
  if (
    counts.pass !== null &&
    counts.tests !== null &&
    counts.pass !== counts.tests
  )
    reasons.push(
      `${tier}: ${counts.pass} passed of ${counts.tests} run, so the tier is not fully green`,
    );
  if (counts.fail !== null && counts.fail > 0)
    reasons.push(`${tier}: ${counts.fail} failing test(s)`);
  if (counts.cancelled !== null && counts.cancelled > 0)
    reasons.push(
      `${tier}: ${counts.cancelled} cancelled test(s) — interrupted run`,
    );
  if (counts.skipped !== null && counts.skipped > 0)
    reasons.push(
      `${tier}: ${counts.skipped} skipped test(s); a required suite that did not execute is not a pass`,
    );

  return { ok: reasons.length === 0, tier, counts, reasons };
}

// ---------------------------------------------------------------------------
// F060 compatibility — preserved child-process evidence.
//
// Everything in this section is OPT-IN. When `--evidence` is absent no
// directory is allocated, no digest is computed and no file is written, so the
// default developer workflow is the one that existed before.
//
// The decisions are pure and exported for the same reason the verdicts above
// are: a bundle that merely looks complete must be refusable against
// fabricated input, without provisioning anything.
// ---------------------------------------------------------------------------

/**
 * Manifest schema version, so a later reader can refuse what it cannot read.
 *
 * 2 adds, over 1: a per-invocation `slot` that keys the transcript files, the
 * `redacted` and `containmentFailed` stream flags, and the cleanup
 * verification fields propagated from the disposable-cluster helper.
 */
export const EVIDENCE_VERSION = 2;

export const EVIDENCE_LIMITS = Object.freeze({
  /**
   * Per stream, per invocation. Capture is bounded so a runaway child cannot
   * fill the disk; exceeding the bound is recorded as truncation and REFUSED,
   * because a partial transcript is not a transcript.
   */
  maxStreamBytes: 32 * 1024 * 1024,
  /** Owner-only. Advisory on Windows, enforced where the platform honours it. */
  directoryMode: 0o700,
  fileMode: 0o600,
});

const REDACTION_MARKER = '[redacted]';

/** Evidence labels are internal constants; anything else is refused. */
const EVIDENCE_LABEL = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * The only names this script will ever write. Derived from internal labels and
 * re-checked at the write boundary, so no constructed name can escape the
 * allocated directory even if a future caller gets the label wrong.
 */
const EVIDENCE_FILE_NAME =
  /^(?:[a-z][a-z0-9-]{0,31}\.(?:stdout|stderr)\.txt|manifest\.json)$/;

/** How many times one label may be disambiguated before capture fails shut. */
const MAX_SLOT_ORDINAL = 99;

/**
 * Pure. A unique, filename-safe identity for ONE invocation's transcripts.
 *
 * Transcripts used to be keyed by LABEL. A reused label therefore replaced an
 * earlier invocation's stdout and stderr while both records stayed in the
 * manifest -- a bundle that read as complete and silently was not. The slot is
 * the label while it is free, then `label-2`, `label-3` and so on.
 *
 * Returns `''` when no safe identity is available, either because the label
 * itself is unusable or because disambiguating it would leave the filename
 * grammar. `''` is refused by `evaluateCapture`, so a collision fails closed
 * rather than overwriting evidence.
 */
export function assignEvidenceSlot(label, taken = []) {
  const name = typeof label === 'string' ? label : '';
  if (!EVIDENCE_LABEL.test(name)) return '';
  const used = new Set(taken ?? []);
  if (!used.has(name)) return name;
  for (let ordinal = 2; ordinal <= MAX_SLOT_ORDINAL; ordinal += 1) {
    const candidate = `${name}-${String(ordinal)}`;
    // Re-checked against the grammar, so a long label cannot grow into a name
    // the write boundary would have to refuse.
    if (EVIDENCE_LABEL.test(candidate) && !used.has(candidate))
      return candidate;
  }
  return '';
}

/**
 * Patterns that look like a secret regardless of whether this run knows the
 * value. Defence in depth behind the exact-value redaction below, which is
 * the primary mechanism.
 *
 * Each pattern carries its own replacement rather than sharing a callback,
 * because the groups a caller must KEEP differ per pattern and a generic
 * handler is one off-by-one away from re-emitting the value it just matched.
 */
const SECRET_PATTERNS = Object.freeze([
  // A connection string carrying a password. Keeps the scheme, user and host.
  {
    pattern: /(postgres(?:ql)?:\/\/[^\s:@/]+:)[^@\s]*(@)/gi,
    replacement: `$1${REDACTION_MARKER}$2`,
  },
  // Environment- and flag-style assignments. Keeps the NAME, drops the value.
  {
    pattern:
      /\b([A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|API_KEY|APIKEY|NONCE)\s*[=:]\s*)\S+/g,
    replacement: `$1${REDACTION_MARKER}`,
  },
  // A SQL password literal.
  {
    pattern: /\b(password\s+)'[^']*'/gi,
    replacement: `$1${REDACTION_MARKER}`,
  },
]);

/**
 * Pure. The containment boundary for evidence text.
 *
 * `secrets` are the values this run generated and therefore knows exactly:
 * the test connection string, its password and the disposable nonce. They are
 * replaced by exact match, which is reliable in a way a pattern is not. The
 * patterns then catch shapes whose values this run does not know.
 *
 * Redaction is NOT silent. The caller records how many substitutions were
 * made, and records the digest of the RAW stream alongside the digest of what
 * was stored, so an integrity check refers to the child's own output while the
 * file on disk carries no credential. See `buildInvocationEvidence`.
 */
export function redactSensitive(text, secrets = []) {
  let output = typeof text === 'string' ? text : '';
  let redactions = 0;
  for (const secret of Array.isArray(secrets) ? secrets : []) {
    // Short values are not secrets worth matching and would redact prose.
    if (typeof secret !== 'string' || secret.length < 8) continue;
    const parts = output.split(secret);
    if (parts.length > 1) {
      redactions += parts.length - 1;
      output = parts.join(REDACTION_MARKER);
    }
  }
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    // Counted before replacing, so the count describes the original text.
    const matcher = new RegExp(pattern.source, pattern.flags);
    const found = output.match(matcher);
    if (found === null) continue;
    redactions += found.length;
    output = output.replace(matcher, replacement);
  }
  return { text: output, redactions };
}

function digestOf(text) {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

/** Bounded capture. Reports the TRUE size even when it keeps less than that. */
function boundStream(text, limit) {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= limit) return { text, bytes, truncated: false };
  return {
    text: Buffer.from(text, 'utf8').subarray(0, limit).toString('utf8'),
    bytes,
    truncated: true,
  };
}

/**
 * Pure. Normalises ONE child invocation into a manifest-safe record plus the
 * stream text to be written beside it.
 *
 * The two are returned separately on purpose: `record` is what lands in
 * `manifest.json` and therefore holds only metadata and digests, while
 * `streams` holds the transcripts that go to their own files. stdout and
 * stderr are never merged — `output` is accepted separately and used only to
 * derive the counts, so the recorded counts come from the same text the tier
 * verdict judged.
 *
 * A stream the caller did not supply is recorded as NOT captured. Nothing is
 * invented to fill a gap; an absent record stays absent and `evaluateCapture`
 * refuses it.
 */
export function buildInvocationEvidence(input) {
  const label = typeof input?.label === 'string' ? input.label : '';
  // The slot is the transcript identity. It defaults to the label so a single
  // invocation needs no ceremony, but the orchestrator assigns it explicitly
  // so two invocations can never share one.
  const slot = typeof input?.slot === 'string' ? input.slot : label;
  const secrets = Array.isArray(input?.secrets) ? input.secrets : [];
  const limit =
    Number.isInteger(input?.limit) && input.limit > 0
      ? input.limit
      : EVIDENCE_LIMITS.maxStreamBytes;

  const captured = {};
  const streams = {};
  for (const stream of ['stdout', 'stderr']) {
    const raw = input?.[stream];
    if (typeof raw !== 'string') {
      captured[stream] = {
        captured: false,
        containmentFailed: false,
        file: null,
        bytes: 0,
        storedBytes: 0,
        truncated: false,
        redacted: false,
        redactions: 0,
        rawDigest: null,
        storedDigest: null,
      };
      streams[stream] = null;
      continue;
    }
    const bounded = boundStream(raw, limit);
    const redacted = redactSensitive(bounded.text, secrets);
    // Belt and braces. If a value this run KNOWS is secret still survives in
    // the text that was about to be written, redaction did not do its job, and
    // the right answer is to persist nothing rather than persist a credential.
    // Reported as a capture failure, so the run cannot pass on it.
    const residual = secrets.some(
      (secret) =>
        typeof secret === 'string' &&
        secret.length >= 8 &&
        redacted.text.includes(secret),
    );
    if (residual) {
      captured[stream] = {
        captured: false,
        containmentFailed: true,
        file: null,
        bytes: bounded.bytes,
        storedBytes: 0,
        truncated: bounded.truncated,
        redacted: true,
        redactions: redacted.redactions,
        // The raw digest still describes what the child produced, so the
        // omission is accountable rather than invisible.
        rawDigest: digestOf(raw),
        storedDigest: null,
      };
      streams[stream] = null;
      continue;
    }
    captured[stream] = {
      captured: true,
      containmentFailed: false,
      file: EVIDENCE_LABEL.test(slot) ? `${slot}.${stream}.txt` : null,
      bytes: bounded.bytes,
      storedBytes: Buffer.byteLength(redacted.text, 'utf8'),
      truncated: bounded.truncated,
      // Stated outright, so stored output is never mistaken for a byte-for-byte
      // copy of the raw stream.
      redacted: redacted.redactions > 0,
      redactions: redacted.redactions,
      // Over the stream exactly as the child produced it: the integrity
      // reference, unaffected by redaction.
      rawDigest: digestOf(raw),
      // Over exactly the bytes written to disk.
      storedDigest: digestOf(redacted.text),
    };
    streams[stream] = redacted.text;
  }

  const summary = parseTapSummary(input?.output);
  const outputText = typeof input?.output === 'string' ? input.output : '';

  return {
    record: {
      label,
      // Unique per invocation; names the transcript files beside the manifest.
      slot,
      tier: typeof input?.tier === 'string' ? input.tier : null,
      // 'tap' marks an invocation whose transcript is expected to carry a TAP
      // plan, summary and duration trailer. A compiler run is not one.
      reporter: input?.reporter === 'tap' ? 'tap' : null,
      invocation: {
        command: typeof input?.command === 'string' ? input.command : null,
        args: Array.isArray(input?.args)
          ? input.args.map((arg) => redactSensitive(String(arg), secrets).text)
          : null,
        cwd: typeof input?.cwd === 'string' ? input.cwd : null,
        directoryPresent:
          typeof input?.directoryPresent === 'boolean'
            ? input.directoryPresent
            : null,
        // KEY NAMES ONLY. The values carry `TEST_DATABASE_URL` and the
        // disposable nonce, so recording them would defeat the point.
        envKeys: Array.isArray(input?.envKeys) ? [...input.envKeys] : null,
      },
      executed: input?.executed === true,
      status: typeof input?.status === 'number' ? input.status : null,
      signal:
        typeof input?.signal === 'string' && input.signal !== ''
          ? input.signal
          : null,
      spawnError:
        typeof input?.spawnError === 'string' && input.spawnError !== ''
          ? redactSensitive(input.spawnError, secrets).text
          : null,
      stdout: captured.stdout,
      stderr: captured.stderr,
      // Named so a reader knows which text the counts came from rather than
      // assuming it was stdout alone.
      summarySource: 'stdout+stderr',
      discovery: {
        plan: summary.hasPlan,
        testsReported: summary.counts.tests,
        discovered:
          typeof summary.counts.tests === 'number' && summary.counts.tests > 0,
        missingSummaryKeys: summary.missing,
        ambiguousSummaryKeys: summary.ambiguous,
      },
      execution: { completed: summary.complete },
      counts: summary.counts,
      failures: [...outputText.matchAll(/^not ok \d+ - (.*)$/gm)].map(
        (match) => redactSensitive(match[1], secrets).text,
      ),
    },
    streams,
  };
}

/** The per-invocation half of the capture verdict. */
function invocationCaptureReasons(record) {
  const reasons = [];
  const label = typeof record?.label === 'string' ? record.label : '';
  const slot = typeof record?.slot === 'string' ? record.slot : '';
  const name = EVIDENCE_LABEL.test(label) ? label : 'an unlabelled invocation';
  if (!EVIDENCE_LABEL.test(label))
    reasons.push(`${name}: the evidence label is missing or unsafe`);
  // An invocation with no safe slot has nowhere to put its transcripts, which
  // is how a label collision surfaces here rather than as a lost file.
  if (!EVIDENCE_LABEL.test(slot))
    reasons.push(
      `${name}: the evidence slot is missing or unsafe, so its transcripts have no unambiguous identity`,
    );

  const invocation = record?.invocation;
  if (
    invocation === null ||
    typeof invocation !== 'object' ||
    typeof invocation.command !== 'string' ||
    invocation.command === '' ||
    !Array.isArray(invocation.args)
  )
    reasons.push(`${name}: the exact invocation was not recorded`);

  for (const stream of ['stdout', 'stderr']) {
    const entry = record?.[stream];
    if (entry === null || typeof entry !== 'object') {
      reasons.push(`${name}: raw ${stream} was not preserved`);
      continue;
    }
    if (entry.containmentFailed === true) {
      reasons.push(
        `${name}: the ${stream} transcript could not be sanitised, so it was deliberately not persisted`,
      );
      continue;
    }
    if (entry.captured !== true) {
      reasons.push(`${name}: raw ${stream} was not preserved`);
      continue;
    }
    if (entry.truncated === true)
      reasons.push(
        `${name}: the captured ${stream} is truncated at ${String(entry.bytes)} byte(s)`,
      );
    if (
      typeof entry.rawDigest !== 'string' ||
      typeof entry.storedDigest !== 'string'
    )
      reasons.push(`${name}: the ${stream} integrity digests are missing`);
    // The manifest and the files on disk must agree on one identity, or a
    // reader cannot tell which transcript belongs to which invocation.
    if (EVIDENCE_LABEL.test(slot) && entry.file !== `${slot}.${stream}.txt`)
      reasons.push(
        `${name}: the recorded ${stream} file ${String(entry.file)} does not match the evidence slot ${slot}`,
      );
    // Redacted output is never presented as the raw stream.
    if (entry.redacted === true && entry.rawDigest === entry.storedDigest)
      reasons.push(
        `${name}: the ${stream} was redacted but its stored digest still equals the raw digest`,
      );
  }

  if (record?.executed !== true) {
    reasons.push(`${name}: the child process did not execute`);
    return reasons;
  }
  const spawnError = record.spawnError ?? null;
  const signal = record.signal ?? null;
  if (spawnError !== null)
    reasons.push(
      `${name}: the child process could not start (${String(spawnError)})`,
    );
  if (signal !== null)
    reasons.push(
      `${name}: the child process was terminated by ${String(signal)}`,
    );
  if (typeof record.status !== 'number') {
    if (spawnError === null && signal === null)
      reasons.push(
        `${name}: neither an exit status nor a termination cause was recorded`,
      );
  } else if (record.status !== 0)
    reasons.push(`${name}: exited with status ${String(record.status)}`);

  if (record.reporter !== 'tap') return reasons;

  if (record.execution?.completed !== true)
    reasons.push(`${name}: the transcript does not show execution completing`);
  if (record.discovery?.discovered !== true)
    reasons.push(`${name}: no tests were discovered, so nothing was validated`);
  reasons.push(...countReasons(name, record.counts));
  return reasons;
}

/**
 * Outcome arithmetic over a recorded summary.
 *
 * The contradiction check is the one the tier verdict cannot make: a summary
 * whose parts do not add up to its total is self-inconsistent, so neither
 * reading of it is evidence. `todo` is checked here too — `node --test` exits
 * 0 for a TODO test, and a required test deferred is a required test that did
 * not run.
 */
function countReasons(name, counts) {
  if (counts === null || typeof counts !== 'object')
    return [`${name}: no test counts were recorded`];
  const reasons = [];
  const { tests, pass, fail, cancelled, skipped, todo } = counts;
  const parts = [pass, fail, cancelled, skipped];
  if (
    typeof tests === 'number' &&
    parts.every((value) => typeof value === 'number')
  ) {
    const total = pass + fail + cancelled + skipped;
    if (total !== tests)
      reasons.push(
        `${name}: the recorded counts contradict one another — ${String(pass)} pass + ${String(fail)} fail + ${String(cancelled)} cancelled + ${String(skipped)} skipped is ${String(total)}, not ${String(tests)}`,
      );
  }
  if (typeof fail === 'number' && fail > 0)
    reasons.push(`${name}: ${String(fail)} failing test(s)`);
  if (typeof skipped === 'number' && skipped > 0)
    reasons.push(`${name}: ${String(skipped)} skipped test(s)`);
  if (typeof cancelled === 'number' && cancelled > 0)
    reasons.push(`${name}: ${String(cancelled)} cancelled test(s)`);
  if (typeof todo === 'number' && todo > 0)
    reasons.push(
      `${name}: ${String(todo)} TODO test(s); a deferred required test is not a pass`,
    );
  return reasons;
}

/**
 * Pure. The manifest's teardown section, mapped from the disposable-cluster
 * helper's cleanup result.
 *
 * The helper returns a three-way verdict per resource -- 'absent', 'present'
 * or 'unknown' -- alongside the booleans. Both are carried through, because
 * the boolean alone cannot express "Docker could not tell us", and that state
 * is exactly what used to be mistaken for success.
 *
 * Nothing is invented. A field the helper did not report becomes `null`, never
 * a manufactured 'absent'. An outcome string that is not one of the three
 * recognised states is recorded as 'unknown' rather than trusted, so an
 * unfamiliar helper version fails closed instead of passing.
 *
 * Every free-text detail is redacted with this run's known secrets before it
 * can reach the manifest.
 */
export function buildTeardownEvidence(teardown, secrets = []) {
  if (teardown === null || teardown === undefined) return null;
  const verificationOf = (value) =>
    value === null || value === undefined || typeof value !== 'object'
      ? null
      : {
          outcome: ['absent', 'present', 'unknown'].includes(value.outcome)
            ? value.outcome
            : 'unknown',
          detail:
            typeof value.detail === 'string'
              ? redactSensitive(value.detail, secrets).text
              : null,
        };
  return {
    containerRemoved: teardown.containerRemoved === true,
    volumeRemoved: teardown.volumeRemoved === true,
    volumeName: teardown.volumeName ?? null,
    refusal:
      teardown.refusal === null || teardown.refusal === undefined
        ? null
        : redactSensitive(String(teardown.refusal), secrets).text,
    containerVerification: verificationOf(teardown.containerVerification),
    volumeVerification: verificationOf(teardown.volumeVerification),
    removalExitStatus:
      typeof teardown.removalExitStatus === 'number'
        ? teardown.removalExitStatus
        : null,
    removalDetail:
      typeof teardown.removalDetail === 'string'
        ? redactSensitive(teardown.removalDetail, secrets).text
        : null,
  };
}

/**
 * Pure. Was the evidence bundle actually produced, completely?
 *
 * Returns `{ ok: true, requested: false }` when the channel was not selected.
 * That is the only way `ok` is true without evidence: a disabled channel has
 * nothing to be incomplete about, and this case must not invent a requirement
 * that a default run cannot meet.
 *
 * When the channel WAS selected, anything missing, truncated, unwritten,
 * self-contradictory or unexecuted is a reason. Candidate-generated evidence
 * must also declare itself unauthenticated, so a bundle produced here can
 * never be mistaken for supervised platform evidence.
 */
export function evaluateCapture(input) {
  if (input === null || input === undefined || input.requested !== true)
    return { ok: true, requested: false, reasons: [] };

  const reasons = [];
  if (typeof input.directory !== 'string' || input.directory === '')
    reasons.push(
      'evidence capture was requested but no output directory was allocated',
    );

  const provenance = input.provenance;
  if (provenance === null || typeof provenance !== 'object')
    reasons.push('the evidence bundle records no provenance');
  else {
    if (provenance.authenticated !== false)
      reasons.push(
        'candidate-generated evidence must declare itself unauthenticated',
      );
    if (
      typeof provenance.generatedBy !== 'string' ||
      provenance.generatedBy === ''
    )
      reasons.push('the evidence bundle does not name its generator');
  }

  const census = input.census;
  if (
    census === null ||
    typeof census !== 'object' ||
    !('before' in census) ||
    !('after' in census)
  )
    reasons.push('the schema census and leak verification were not recorded');

  if (input.instanceEvidence === undefined)
    reasons.push('the disposable-instance evidence result was not recorded');

  const teardown = input.teardown;
  if (teardown === undefined)
    reasons.push(
      'the container and anonymous-volume cleanup results were not recorded',
    );
  else if (teardown !== null) {
    if (
      typeof teardown.containerRemoved !== 'boolean' ||
      typeof teardown.volumeRemoved !== 'boolean'
    )
      reasons.push('the recorded cleanup results are incomplete');
    // The cleanup helper distinguishes 'absent', 'present' and 'unknown'. When
    // it reported a verification, the boolean beside it must agree: a resource
    // called removed whose outcome is anything but 'absent' is precisely the
    // false-positive the cleanup correction exists to prevent, and it must not
    // be laundered back in through the evidence layer.
    for (const resource of ['container', 'volume']) {
      const removed = teardown[`${resource}Removed`];
      const verification = teardown[`${resource}Verification`];
      // Absent is not fabricated into a verdict: a helper that reported no
      // verification simply leaves the booleans to speak for themselves.
      if (verification === null || verification === undefined) continue;
      if (
        typeof verification !== 'object' ||
        typeof verification.outcome !== 'string'
      ) {
        reasons.push(
          `the recorded ${resource} cleanup verification is malformed`,
        );
        continue;
      }
      if (!['absent', 'present', 'unknown'].includes(verification.outcome)) {
        reasons.push(
          `the recorded ${resource} cleanup outcome ${verification.outcome} is not a recognised state`,
        );
        continue;
      }
      if (removed !== (verification.outcome === 'absent'))
        reasons.push(
          `the recorded ${resource} cleanup disagrees with its own verification: removed=${String(removed)} but the outcome is ${verification.outcome}`,
        );
    }
  }

  if (!Array.isArray(input.invocations))
    reasons.push('no child-process evidence was recorded');
  const invocations = Array.isArray(input.invocations) ? input.invocations : [];
  for (const tier of Object.keys(MANDATORY_TIERS))
    if (!invocations.some((record) => record?.tier === tier))
      reasons.push(
        `the mandatory ${tier} tier produced no child-process evidence`,
      );
  // Two invocations sharing a slot would write over each other's transcripts,
  // so the bundle is refused before a reader can be misled by it.
  const seenSlots = new Set();
  for (const record of invocations) {
    const slot = typeof record?.slot === 'string' ? record.slot : '';
    if (slot === '') continue;
    if (seenSlots.has(slot))
      reasons.push(
        `two invocations share the evidence slot ${slot}, so one transcript would overwrite the other`,
      );
    seenSlots.add(slot);
  }
  for (const record of invocations)
    reasons.push(...invocationCaptureReasons(record));

  if (!Array.isArray(input.files))
    reasons.push('no evidence-file write results were recorded');
  else
    for (const file of input.files)
      if (file?.written !== true)
        reasons.push(
          `evidence could not be written to ${String(file?.name ?? 'an unnamed file')}${
            file?.error ? `: ${String(file.error)}` : ''
          }`,
        );

  return { ok: reasons.length === 0, requested: true, reasons };
}

/**
 * Pure. The verdict for the whole run.
 *
 * Requires BOTH mandatory tiers to be present and passing, so a green unit
 * suite -- or a tier that silently never ran -- can never stand in for
 * database and E2E validation.
 */
export function evaluateRun(input) {
  const reasons = [];

  if (input?.evidence?.verified !== true)
    reasons.push(
      `disposable-instance evidence was not verified${
        input?.evidence?.refusal ? `: ${input.evidence.refusal}` : ''
      }`,
    );

  const before = input?.census?.before;
  const after = input?.census?.after;
  if (typeof before !== 'number' || before < 0)
    reasons.push('the pre-test schema census is missing or unreadable');
  else if (before !== 0)
    reasons.push(`the database was not a clean baseline: ${before} schema(s)`);
  if (typeof after !== 'number' || after < 0)
    reasons.push('the post-test schema census is missing or unreadable');
  else {
    // When a named verdict was recorded it decides, because only it can tell
    // an application schema created by an approved migration from a scratch
    // schema a test left behind. Its refusals are carried verbatim.
    const verdict = input?.census?.verdict;
    if (verdict === null || verdict === undefined) {
      // No verdict recorded: the original count rule, unchanged, so a run
      // that never measured names cannot pass on silence.
      if (typeof before === 'number' && after > before)
        reasons.push(`${after - before} schema(s) leaked during the run`);
      else if (typeof before === 'number' && after !== before)
        reasons.push(`the schema census changed from ${before} to ${after}`);
    } else if (verdict.ok !== true) {
      const recorded = Array.isArray(verdict.reasons) ? verdict.reasons : [];
      if (recorded.length) reasons.push(...recorded.map(String));
      else
        reasons.push('the schema census verdict was refused without a reason');
    } else {
      // A passing verdict still has to add up: the growth must be exactly the
      // schemas it justified, and nothing may be listed as unexpected.
      const allowed = Array.isArray(input?.census?.allowed)
        ? input.census.allowed
        : [];
      const unexpected = Array.isArray(input?.census?.unexpected)
        ? input.census.unexpected
        : [];
      if (unexpected.length)
        reasons.push(
          `${String(unexpected.length)} unexpected schema(s) recorded despite a passing census: ${unexpected.map(String).join(', ')}`,
        );
      if (typeof before === 'number' && after - before !== allowed.length)
        reasons.push(
          `the schema census changed from ${before} to ${after}, which ${String(allowed.length)} accounted-for schema(s) do not explain`,
        );
    }
  }

  const verdicts = Array.isArray(input?.tiers) ? input.tiers : [];
  for (const name of Object.keys(MANDATORY_TIERS)) {
    const verdict = verdicts.find((candidate) => candidate?.tier === name);
    if (verdict === undefined) {
      reasons.push(`the mandatory ${name} tier did not run`);
      continue;
    }
    if (!verdict.ok)
      reasons.push(...(verdict.reasons ?? [`the ${name} tier did not pass`]));
  }

  const teardown = input?.teardown;
  if (teardown === null || teardown === undefined)
    reasons.push('no teardown evidence was produced');
  else if (teardown.refusal)
    reasons.push(`teardown refused: ${teardown.refusal}`);
  else {
    if (teardown.containerRemoved !== true)
      reasons.push('removal of the owned container was not verified');
    if (teardown.volumeRemoved !== true)
      reasons.push('removal of the owned anonymous volume was not verified');
  }

  // The optional channel, judged last so the reasons above keep their order.
  // A run that did not request evidence is unaffected; a run that did must
  // have produced a complete bundle, or it has not passed.
  const capture = evaluateCapture(input?.capture);
  if (!capture.ok) reasons.push(...capture.reasons);

  return { ok: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Orchestration. Runs only as the entry point.
// ---------------------------------------------------------------------------

/**
 * A fresh, owner-only directory inside the OS temporary area.
 *
 * No caller-supplied path is accepted anywhere in this script, so neither a
 * mistaken nor a hostile argument can direct a write at an unrelated file.
 * `mkdtemp` also guarantees the directory did not previously exist, so there
 * is nothing in it to overwrite.
 */
function allocateEvidenceDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'reqro-validation-evidence-'));
  try {
    chmodSync(directory, EVIDENCE_LIMITS.directoryMode);
  } catch {
    // POSIX modes are advisory on Windows; the directory is still created
    // inside the invoking user's private temporary area.
  }
  return directory;
}

/** One evidence file. Never throws: a write failure is a recorded result. */
function writeEvidenceFile(directory, name, text) {
  if (!EVIDENCE_FILE_NAME.test(name))
    return {
      name,
      path: null,
      bytes: 0,
      written: false,
      error: 'refused an unsafe evidence file name',
    };
  const target = join(directory, name);
  try {
    writeFileSync(target, text, {
      encoding: 'utf8',
      mode: EVIDENCE_LIMITS.fileMode,
      // Exclusive: refuse rather than replace anything already there.
      flag: 'wx',
    });
    return {
      name,
      path: target,
      bytes: Buffer.byteLength(text, 'utf8'),
      written: true,
      error: null,
    };
  } catch (error) {
    return {
      name,
      path: target,
      bytes: 0,
      written: false,
      error: error.message,
    };
  }
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const serverRoot = resolve(here, '..');
  const distTest = resolve(serverRoot, 'dist-test', 'test');

  const out = (text) => process.stdout.write(`${text}\n`);
  const errOut = (text) => process.stderr.write(`${text}\n`);
  const redact = (text) =>
    String(text).replace(/(postgresql:\/\/[^:]+:)[^@]*@/g, '$1***@');

  const hardFailures = [];
  const fail = (message) => {
    hardFailures.push(message);
    errOut(`FAIL  ${message}`);
  };
  const ok = (message) => out(`ok    ${message}`);
  const info = (message) => out(`info  ${message}`);

  // --- the optional evidence channel ---------------------------------------
  // Explicitly selected, never inferred. Nothing below allocates, hashes or
  // writes anything unless `--evidence` was passed.
  const captureRequested = process.argv.includes('--evidence');
  const capture = {
    version: EVIDENCE_VERSION,
    requested: captureRequested,
    directory: null,
    provenance: null,
    instance: null,
    instanceEvidence: undefined,
    census: null,
    teardown: undefined,
    invocations: [],
    files: [],
    verdict: null,
  };
  /** Exact values that must never reach an evidence file. Grows once known. */
  const secrets = [];
  const pendingStreams = new Map();

  if (captureRequested) {
    capture.provenance = {
      generatedBy: 'server/scripts/test-db-disposable.mjs',
      evidenceVersion: EVIDENCE_VERSION,
      // Produced by the candidate under validation, on a developer machine.
      // It is an input to a later supervised decision, never a substitute for
      // one, and a reader must authenticate it independently.
      authenticated: false,
      note: 'candidate-generated evidence; not authenticated platform evidence',
      redactionBoundary:
        'stored transcripts are redacted of the generated connection string, its password and the disposable nonce; rawDigest is taken over the unredacted stream, so integrity is checked against what the child actually produced',
    };
    try {
      capture.directory = allocateEvidenceDirectory();
      info(`evidence directory: ${capture.directory}`);
    } catch (error) {
      fail(`could not allocate an evidence directory: ${error.message}`);
    }
  }

  const captureInvocation = (input) => {
    if (!captureRequested) return;
    // The slot is decided here, against every slot already handed out, so a
    // reused label cannot displace an earlier transcript.
    const slot = assignEvidenceSlot(input?.label, pendingStreams.keys());
    const built = buildInvocationEvidence({ ...input, slot, secrets });
    capture.invocations.push(built.record);
    // Keyed by SLOT, which is unique by construction. An unassignable slot is
    // recorded as '' and refused by `evaluateCapture` rather than colliding.
    if (slot !== '') pendingStreams.set(slot, built.streams);
  };

  /**
   * Writes the bundle and judges it. Never throws, so a capture problem can
   * neither divert the validation flow nor skip cleanup; it is reported.
   */
  const flushEvidence = () => {
    if (!captureRequested || capture.directory === null) return;
    out('\n== evidence capture ==');
    for (const [slot, streams] of pendingStreams)
      for (const stream of ['stdout', 'stderr']) {
        if (streams[stream] === null) continue;
        capture.files.push(
          writeEvidenceFile(
            capture.directory,
            `${slot}.${stream}.txt`,
            streams[stream],
          ),
        );
      }
    capture.verdict = evaluateCapture(capture);
    const manifest = writeEvidenceFile(
      capture.directory,
      'manifest.json',
      `${JSON.stringify(capture, null, 2)}\n`,
    );
    if (!manifest.written)
      fail(`the evidence manifest could not be written: ${manifest.error}`);
    if (capture.verdict.ok && manifest.written)
      ok(`complete execution evidence written to ${capture.directory}`);
    else
      info(
        `evidence is INCOMPLETE; ${capture.verdict.reasons.length} problem(s) recorded`,
      );
  };

  out('== 1. prerequisites ==');
  if (!process.argv.includes('--skip-compile')) {
    const tsc = resolve(serverRoot, 'node_modules', 'typescript', 'bin', 'tsc');
    if (!existsSync(tsc)) {
      fail('the local TypeScript compiler is missing; run npm install');
    } else {
      const args = [tsc, '-p', 'tsconfig.test.json'];
      const compiled = spawnSync(process.execPath, args, {
        cwd: serverRoot,
        encoding: 'utf8',
      });
      captureInvocation({
        label: 'compile',
        tier: null,
        reporter: null,
        command: process.execPath,
        args,
        cwd: serverRoot,
        executed: true,
        status: compiled.status,
        signal: compiled.signal ?? null,
        spawnError: compiled.error ? compiled.error.message : null,
        stdout: compiled.stdout ?? '',
        stderr: compiled.stderr ?? '',
        output: `${compiled.stdout ?? ''}\n${compiled.stderr ?? ''}`,
      });
      if (compiled.status !== 0) {
        fail('test compilation failed');
        errOut(compiled.stdout || compiled.stderr);
      } else ok('test sources compiled');
    }
  }
  if (hardFailures.length > 0) {
    flushEvidence();
    errOut('\naborting before provisioning: prerequisites failed');
    process.exit(1);
  }

  const clusterModule = resolve(
    distTest,
    'helpers',
    'f0592-disposable-cluster.js',
  );
  if (!existsSync(clusterModule)) {
    fail(`the compiled cluster helper is missing at ${clusterModule}`);
    flushEvidence();
    process.exit(1);
  }
  const { startDisposableCluster, dockerAvailable, evaluateSchemaCensus } =
    await import(pathToFileURL(clusterModule).href);
  if (!dockerAvailable()) {
    fail('Docker is unavailable, so no disposable instance can be provisioned');
    flushEvidence();
    process.exit(1);
  }
  ok('Docker control plane reachable');

  out('\n== 2-3. provisioning one disposable PostgreSQL 17 instance ==');
  let cluster;
  try {
    cluster = await startDisposableCluster();
  } catch (error) {
    fail(`provisioning failed: ${redact(error.message)}`);
    flushEvidence();
    process.exit(1);
  }
  ok(`container ${cluster.container} on 127.0.0.1:${cluster.port}`);
  // Both identities, each labelled. Printing one unlabelled value invited
  // exactly the confusion this corrects: a repository digest and a
  // Docker-observed image ID look alike and are not interchangeable.
  info(`image pinned to ${cluster.imageRepositoryDigest} (repository digest)`);
  info(`Docker-observed image ID ${cluster.imageId}`);

  if (captureRequested) {
    // Now that the generated values exist, teach the redactor exactly what to
    // remove. Exact-value redaction is the primary containment; the patterns
    // in `redactSensitive` are the fallback.
    const encoded = /postgresql:\/\/[^:]+:([^@]*)@/.exec(cluster.testUrl)?.[1];
    for (const value of [
      cluster.testUrl,
      encoded,
      encoded === undefined ? undefined : decodeURIComponent(encoded),
      cluster.nonce,
    ])
      if (typeof value === 'string' && value !== '') secrets.push(value);
    // A short container reference is a local identifier, not a secret, and is
    // what makes the bundle traceable to a `docker` record.
    capture.instance = {
      containerShortId: cluster.containerId.slice(0, 12),
      containerName: cluster.container,
      // imageId is Docker's observed .Id, whose meaning depends on the store.
      // imageRepositoryDigest is the separately verified registry identity.
      // No platform-manifest or configuration digest is inferred from .Id.
      // These v2 additions require separate Azure reader compatibility approval.
      imageId: cluster.imageId,
      imageRepositoryDigest: cluster.imageRepositoryDigest,
      port: cluster.port,
      epoch: cluster.epoch.toISOString(),
    };
  }

  const evidence = { verified: false, refusal: null };
  // `before`/`after` stay counts for the recorded evidence shape; the verdict
  // and the named schemas are what decide, because a count cannot tell an
  // application schema an approved migration created from a leaked one.
  const census = {
    before: null,
    after: null,
    allowed: [],
    unexpected: [],
    verdict: null,
  };
  let inventoryBefore;
  const tiers = [];
  let teardown = null;
  let skewMs = null;

  try {
    out('\n== 4. disposable-instance evidence ==');
    const { collectDisposableEvidence, refuseUnlessDisposable } = await import(
      pathToFileURL(
        resolve(distTest, 'helpers', 'disposable-cluster-evidence.js'),
      ).href
    );
    const pgModule = await import('pg');
    const PoolCtor = pgModule.default?.Pool ?? pgModule.Pool;
    const admin = new PoolCtor({ connectionString: cluster.testUrl, max: 2 });
    try {
      const collected = await collectDisposableEvidence(
        admin,
        cluster.testUrl,
        cluster.expectations(),
      );
      evidence.refusal = refuseUnlessDisposable(collected);
      evidence.verified = evidence.refusal === null;
      if (evidence.verified)
        ok(
          'database, role, loopback target, nonce, container identity, image digest, port binding, timestamps and anonymous storage all verified',
        );
      else fail(`evidence refused: ${evidence.refusal}`);

      // NEW-b context only. Recorded, never corrected here: a container clock
      // behind the host makes `occurred_at <= created_at` violable.
      const t0 = Date.now();
      const clock = await admin.query('select clock_timestamp() now');
      const t1 = Date.now();
      skewMs = new Date(clock.rows[0].now).getTime() - (t0 + t1) / 2;
      info(`host-to-container clock skew: ${skewMs.toFixed(0)} ms`);
      if (skewMs < -250)
        info(
          'the container clock trails the host; NEW-b check violations are environmentally possible',
        );
    } catch (error) {
      evidence.refusal = redact(error.message);
      fail(`evidence collection failed: ${evidence.refusal}`);
    } finally {
      await admin.end().catch(() => undefined);
    }

    out('\n== 5. pre-test schema census ==');
    inventoryBefore = await cluster.schemaInventory();
    census.before = inventoryBefore.schemas.length;
    if (census.before === 0) ok('clean baseline: zero non-system schemas');
    else
      fail(
        `expected a clean database, found ${census.before} schema(s): ${inventoryBefore.schemas.join(', ')}`,
      );

    for (const [name, spec] of Object.entries(MANDATORY_TIERS)) {
      out(`\n== ${name} tier (serial, floor ${spec.minimum}) ==`);
      const cwd = resolve(distTest, spec.directory);
      const directoryPresent = existsSync(cwd);
      const args = ['--test', '--test-concurrency=1', '--test-reporter=tap'];
      let status = null;
      let signal = null;
      let spawnError = null;
      let output = '';
      let stdout = null;
      let stderr = null;
      let childEnv = null;
      if (directoryPresent) {
        childEnv = cluster.environment();
        const result = spawnSync(process.execPath, args, {
          cwd,
          encoding: 'utf8',
          maxBuffer: 256 * 1024 * 1024,
          env: { ...process.env, ...childEnv },
        });
        status = result.status;
        signal = result.signal ?? null;
        spawnError = result.error ? result.error.message : null;
        stdout = result.stdout ?? '';
        stderr = result.stderr ?? '';
        output = `${stdout}\n${stderr}`;
      }
      const verdict = evaluateTier({
        tier: name,
        directoryPresent,
        status,
        spawnError,
        output,
      });
      tiers.push(verdict);
      captureInvocation({
        label: name,
        tier: name,
        reporter: 'tap',
        command: process.execPath,
        args,
        cwd,
        directoryPresent,
        envKeys: childEnv === null ? null : Object.keys(childEnv),
        executed: directoryPresent,
        status,
        signal,
        spawnError,
        stdout,
        stderr,
        output,
      });
      const counts = verdict.counts;
      if (counts !== null)
        out(
          `      tests ${counts.tests} | pass ${counts.pass} | fail ${counts.fail} | skipped ${counts.skipped} | cancelled ${counts.cancelled}`,
        );
      for (const name2 of [...output.matchAll(/^not ok \d+ - (.*)$/gm)].map(
        (match) => match[1],
      ))
        out(`      not ok: ${name2}`);
      if (verdict.ok) ok(`${name}: ${counts.pass}/${counts.tests}, zero skips`);
      else for (const reason of verdict.reasons) fail(reason);
      // SQLSTATE 23514 on the outbox clock constraint is NEW-b, out of scope
      // here, and must be reported as itself rather than investigated as a
      // disposable-instance defect.
      if (/23514/.test(output) && /occurred_at/.test(output))
        info(
          `${name}: SQLSTATE 23514 on occurred_at observed — classified as NEW-b (timestamp race), not a disposable-instance failure`,
        );
    }

    out('\n== post-test schema census ==');
    const inventoryAfter = await cluster.schemaInventory();
    census.after = inventoryAfter.schemas.length;
    const verdict = evaluateSchemaCensus({
      before: inventoryBefore,
      after: inventoryAfter,
    });
    census.allowed = [...verdict.allowed];
    census.unexpected = [...verdict.unexpected];
    census.verdict = { ok: verdict.ok, reasons: [...verdict.reasons] };
    if (verdict.ok) {
      if (verdict.allowed.length)
        ok(
          `no leaked schemas; ${verdict.allowed.join(', ')} accounted for by its migration`,
        );
      else
        ok(
          `zero leaked schemas (${census.before} before, ${census.after} after)`,
        );
    } else for (const reason of verdict.reasons) fail(reason);
  } catch (error) {
    fail(`validation aborted: ${redact(error.stack ?? error.message)}`);
  } finally {
    // Cleanup is attempted on every outcome, including a failing tier.
    out('\n== teardown ==');
    try {
      teardown = await cluster.destroy();
    } catch (error) {
      fail(`teardown threw: ${redact(error.message)}`);
    }
    if (teardown === null || teardown === undefined)
      fail('no teardown evidence was produced');
    else if (teardown.refusal !== null)
      fail(`teardown refused: ${teardown.refusal}`);
    else {
      if (teardown.containerRemoved) ok('container no longer exists');
      else fail('the container still exists after teardown');
      if (teardown.volumeRemoved) ok('anonymous volume no longer exists');
      else fail(`the anonymous volume ${teardown.volumeName} still exists`);
    }
  }

  out('\n== recorded outcomes ==');
  for (const verdict of tiers)
    out(
      verdict.counts === null
        ? `      ${verdict.tier}: NOT EXECUTED`
        : `      ${verdict.tier}: tests=${verdict.counts.tests} pass=${verdict.counts.pass} fail=${verdict.counts.fail} skipped=${verdict.counts.skipped} cancelled=${verdict.counts.cancelled}`,
    );
  if (skewMs !== null) out(`      clock skew: ${skewMs.toFixed(0)} ms`);

  // Recorded as observed, including when the run failed. Cleanup has already
  // happened in the `finally` above, so writing evidence cannot affect it.
  if (captureRequested) {
    capture.instanceEvidence = {
      verified: evidence.verified,
      refusal:
        evidence.refusal === null
          ? null
          : redactSensitive(evidence.refusal, secrets).text,
      clockSkewMs: skewMs === null ? null : Math.round(skewMs),
    };
    capture.census = {
      before: census.before,
      after: census.after,
      cleanBaseline: census.before === 0,
      // `leaked` counts schemas nothing accounts for, not raw growth: a
      // schema an approved migration created is not a leak, and recording it
      // as one would make the evidence contradict the verdict.
      leaked: Array.isArray(census.unexpected)
        ? census.unexpected.length
        : null,
      noLeak:
        census.verdict === null
          ? census.after === census.before
          : census.verdict.ok === true,
      allowed: Array.isArray(census.allowed) ? [...census.allowed] : [],
      unexpected: Array.isArray(census.unexpected)
        ? [...census.unexpected]
        : [],
      verdict: census.verdict,
    };
    capture.teardown = buildTeardownEvidence(teardown, secrets);
  }
  flushEvidence();

  // The authoritative verdict. Independent of the running tally, so a missing
  // tier or unverified teardown cannot pass by omission.
  const run = evaluateRun({ evidence, census, tiers, teardown, capture });
  out('\n== result ==');
  if (run.ok && hardFailures.length === 0) {
    out('PASS — complete disposable validation, zero skips, clean teardown');
    process.exit(0);
  }
  const reasons = [...new Set([...run.reasons, ...hardFailures])];
  errOut(`FAILED — ${reasons.length} problem(s):`);
  for (const reason of reasons) errOut(`  - ${reason}`);
  process.exit(1);
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(entry).href === import.meta.url)
  await main();
