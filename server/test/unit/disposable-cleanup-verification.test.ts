import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyResourceAbsence,
  normalizeDockerResult,
  summarizeDockerOutput,
  verifyCleanup,
  volumeTargetFromProbe,
  type CleanupProbes,
  type DockerResult,
  type SpawnLikeResult,
  type VolumeTarget,
} from '../helpers/f0592-disposable-cluster.js';

/**
 * F060 — fail-closed disposable Docker cleanup verification.
 *
 * The defect this file exists to keep closed:
 *
 *   containerRemoved: docker(['inspect', containerId]).status !== 0
 *
 * `spawnSync` reports `status: null` for a process that was killed or never
 * started, and `null !== 0` is true. Every Docker failure therefore read as
 * "the container is gone": a timeout, a SIGTERM, a missing CLI, an
 * unreachable daemon, an access error. It was observed in practice — a
 * disposable PostgreSQL container survived a teardown that reported
 * "ok container no longer exists", under host memory exhaustion that stopped
 * the Docker CLI from answering.
 *
 * The replacement invariant: absence is reported ONLY when a query succeeded
 * and proved the resource missing, or Docker returned an explicitly
 * recognised not-found response. Everything else is `unknown`, which fails
 * the mandatory validation gate.
 *
 * Every case here is proven against FABRICATED Docker results. No daemon is
 * contacted, no container is created and nothing is removed in order to prove
 * that an unverified teardown would be refused. All identifiers are synthetic.
 */

const CONTAINER = 'c'.repeat(64);
const VOLUME = 'a'.repeat(64);
const DEV_VOLUME = 'cityvue-postgres-data';

/** A successful Docker answer. */
function answered(overrides: Partial<DockerResult> = {}): DockerResult {
  return {
    status: 0,
    signal: null,
    spawnError: null,
    timedOut: false,
    stdout: '',
    stderr: '',
    ...overrides,
  };
}

/** Docker's real not-found responses, as measured against 29.7.2 / API 1.55. */
const NOT_FOUND = {
  object: `error: no such object: ${CONTAINER}`,
  container: `Error response from daemon: No such container: ${CONTAINER}`,
  volume: `Error response from daemon: get ${VOLUME}: no such volume`,
} as const;

function containerInspectStdout(
  mounts: readonly { Type?: string; Name?: string }[],
): string {
  return JSON.stringify([{ Id: CONTAINER, Mounts: mounts }]);
}

function probes(overrides: Partial<CleanupProbes> = {}): CleanupProbes {
  return {
    containerId: CONTAINER,
    refusal: null,
    removal: answered(),
    containerAbsence: answered({ status: 1, stderr: NOT_FOUND.object }),
    volume: { kind: 'known', name: VOLUME },
    volumeAbsence: answered({ status: 1, stderr: NOT_FOUND.volume }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normalizeDockerResult — the four distinguishable process outcomes.
// ---------------------------------------------------------------------------

test('a spawnSync result is normalised without losing the failure cause', () => {
  // Answered cleanly.
  const clean = normalizeDockerResult({
    status: 0,
    signal: null,
    stdout: ' out \n',
    stderr: '',
  });
  assert.equal(clean.status, 0);
  assert.equal(clean.signal, null);
  assert.equal(clean.spawnError, null);
  assert.equal(clean.timedOut, false);
  assert.equal(clean.stdout, 'out');

  // Killed by the timeout: status is null, and the cause is preserved.
  const timedOut = normalizeDockerResult({
    status: null,
    signal: 'SIGTERM',
    error: { message: 'spawnSync docker ETIMEDOUT', code: 'ETIMEDOUT' },
    stdout: null,
    stderr: null,
  });
  assert.equal(timedOut.status, null);
  assert.equal(timedOut.signal, 'SIGTERM');
  assert.equal(timedOut.timedOut, true);
  assert.ok(timedOut.spawnError?.includes('ETIMEDOUT'));

  // Never started. The previous implementation called `.trim()` on these
  // nulls and threw before it could report anything.
  const unstarted = normalizeDockerResult({
    status: null,
    error: { message: 'spawnSync docker ENOENT', code: 'ENOENT' },
    stdout: null,
    stderr: null,
  });
  assert.equal(unstarted.stdout, '');
  assert.equal(unstarted.stderr, '');
  assert.equal(unstarted.timedOut, false);
  assert.ok(unstarted.spawnError?.includes('ENOENT'));

  // Absent input is not a crash either.
  assert.equal(normalizeDockerResult(undefined).status, null);
  assert.equal(normalizeDockerResult(null).stdout, '');
});

test('normalisation accepts a real spawnSync shape', () => {
  // Guards the structural assumption rather than only the fabricated one.
  const real: SpawnLikeResult = {
    status: 1,
    signal: null,
    stdout: '',
    stderr: `${NOT_FOUND.container}\n`,
  };
  const normalised = normalizeDockerResult(real);
  assert.equal(normalised.status, 1);
  assert.equal(normalised.stderr, NOT_FOUND.container);
});

// ---------------------------------------------------------------------------
// classifyResourceAbsence — the correction itself.
// ---------------------------------------------------------------------------

test('a successful inspection means the resource still exists', () => {
  // Case 1. Exit zero is a successful query, so the resource is PRESENT.
  // Absence and presence are not each other's default.
  const verdict = classifyResourceAbsence(
    'container',
    CONTAINER,
    answered({ status: 0, stdout: containerInspectStdout([]) }),
  );
  assert.equal(verdict.outcome, 'present');
  assert.ok(verdict.detail.includes('still reports'));
});

test('a recognised not-found response proves absence', () => {
  // Case 2 and case 10. Each of Docker's three wordings is accepted.
  for (const stderr of [
    NOT_FOUND.object,
    NOT_FOUND.container,
    'Error: No such object: ' + CONTAINER,
  ]) {
    const verdict = classifyResourceAbsence(
      'container',
      CONTAINER,
      answered({ status: 1, stderr }),
    );
    assert.equal(verdict.outcome, 'absent', `must accept: ${stderr}`);
  }
  const volume = classifyResourceAbsence(
    'volume',
    VOLUME,
    answered({ status: 1, stderr: NOT_FOUND.volume }),
  );
  assert.equal(volume.outcome, 'absent');
  assert.ok(volume.detail.includes('no such volume'));
});

test('every ambiguous Docker outcome is unknown, never absent', () => {
  const cases: readonly {
    readonly name: string;
    readonly expect: string;
    readonly probe: DockerResult | null | undefined;
  }[] = [
    // Case 3: timed out.
    {
      name: 'a timed-out inspection',
      expect: 'timed out',
      probe: answered({
        status: null,
        signal: 'SIGTERM',
        timedOut: true,
        spawnError: 'spawnSync docker ETIMEDOUT',
      }),
    },
    // Case 3: null status with no other explanation.
    {
      name: 'a null exit status',
      expect: 'reported no exit status',
      probe: answered({ status: null }),
    },
    // Case 4: failed to spawn.
    {
      name: 'a CLI that could not be started',
      expect: 'could not be run',
      probe: answered({
        status: null,
        spawnError: 'spawnSync docker ENOENT',
      }),
    },
    // Case 5: terminated by a signal.
    {
      name: 'an inspection killed by a signal',
      expect: 'terminated by SIGKILL',
      probe: answered({ status: null, signal: 'SIGKILL' }),
    },
    // Case 6: daemon unavailable. THE case observed in practice.
    {
      name: 'an unreachable daemon',
      expect: 'could not answer',
      probe: answered({
        status: 1,
        stderr:
          'error during connect: Get "http://%2F%2F.%2Fpipe%2Fdocker_engine/v1.55/containers/x/json": open //./pipe/docker_engine: The system cannot find the file specified.',
      }),
    },
    {
      name: 'a daemon that is not running',
      expect: 'could not answer',
      probe: answered({
        status: 1,
        stderr:
          'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?',
      }),
    },
    // Case 7: permission denied.
    {
      name: 'permission denied',
      expect: 'could not answer',
      probe: answered({
        status: 1,
        stderr:
          'Got permission denied while trying to connect to the Docker daemon socket',
      }),
    },
    {
      name: 'access denied on Windows',
      expect: 'could not answer',
      probe: answered({ status: 1, stderr: 'Access is denied.' }),
    },
    // Case 8: a generic non-zero error that explains nothing.
    {
      name: 'an unexplained non-zero exit',
      expect: 'without a recognised not-found response',
      probe: answered({ status: 125, stderr: 'something went wrong' }),
    },
    {
      name: 'a non-zero exit with no stderr at all',
      expect: '(no stderr)',
      probe: answered({ status: 7, stderr: '' }),
    },
    {
      name: 'an internal server error',
      expect: 'could not answer',
      probe: answered({
        status: 1,
        stderr: 'Error response from daemon: internal server error',
      }),
    },
    // A probe that was never taken is not evidence either.
    {
      name: 'a probe that never ran',
      expect: 'never queried',
      probe: null,
    },
    {
      name: 'an absent probe',
      expect: 'never queried',
      probe: undefined,
    },
  ];
  for (const entry of cases) {
    const verdict = classifyResourceAbsence(
      'container',
      CONTAINER,
      entry.probe,
    );
    assert.equal(
      verdict.outcome,
      'unknown',
      `${entry.name} must be unknown, got ${verdict.outcome}`,
    );
    assert.ok(
      verdict.detail.includes(entry.expect),
      `${entry.name} explained wrongly: ${verdict.detail}`,
    );
  }
});

test('an inconclusive failure wins over not-found wording', () => {
  // Defence in depth: if a daemon error ever quotes "no such container" back,
  // the ambiguity still decides, because such a reply proves nothing.
  const verdict = classifyResourceAbsence(
    'container',
    CONTAINER,
    answered({
      status: 1,
      stderr:
        'Cannot connect to the Docker daemon: no such container: ' + CONTAINER,
    }),
  );
  assert.equal(verdict.outcome, 'unknown');
});

test('the regression expression is no longer sufficient for absence', () => {
  // The literal defect: every one of these satisfies `status !== 0` and the
  // old code called all of them "removed". None may be `absent` now.
  for (const probe of [
    answered({ status: null }),
    answered({ status: null, signal: 'SIGTERM' }),
    answered({ status: null, spawnError: 'spawnSync docker ENOENT' }),
    answered({ status: 1, stderr: 'Access is denied.' }),
    answered({ status: 125, stderr: 'unexplained' }),
  ])
    assert.notEqual(
      classifyResourceAbsence('container', CONTAINER, probe).outcome,
      'absent',
    );
});

// ---------------------------------------------------------------------------
// volumeTargetFromProbe — "no volume" is not "unknown volume".
// ---------------------------------------------------------------------------

test('the owned anonymous volume is read from the pre-removal inspection', () => {
  const target = volumeTargetFromProbe(
    CONTAINER,
    answered({
      stdout: containerInspectStdout([{ Type: 'volume', Name: VOLUME }]),
    }),
  );
  assert.deepEqual(target, { kind: 'known', name: VOLUME });
});

test('a container with no volume mount is a legitimate nothing-to-do', () => {
  // Case 12. Distinct from "could not tell": there is positively no volume.
  for (const mounts of [
    [],
    [{ Type: 'bind', Name: '' }],
    [{ Type: 'volume', Name: '' }],
  ]) {
    const target = volumeTargetFromProbe(
      CONTAINER,
      answered({ stdout: containerInspectStdout(mounts) }),
    );
    assert.deepEqual(target, { kind: 'none' });
  }
});

test('a volume that cannot be identified is unknown, not absent', () => {
  const cases: readonly {
    readonly name: string;
    readonly expect: string;
    readonly probe: DockerResult | null;
  }[] = [
    {
      name: 'the inspection timed out',
      expect: 'timed out',
      probe: answered({ status: null, timedOut: true }),
    },
    {
      name: 'the CLI could not start',
      expect: 'could not be run',
      probe: answered({ status: null, spawnError: 'spawnSync docker ENOENT' }),
    },
    {
      name: 'the daemon was unreachable',
      expect: 'could not answer',
      probe: answered({
        status: 1,
        stderr:
          'Cannot connect to the Docker daemon. Is the docker daemon running?',
      }),
    },
    {
      name: 'the container had already vanished',
      expect: 'already absent before teardown',
      probe: answered({ status: 1, stderr: NOT_FOUND.container }),
    },
    {
      name: 'the output was not JSON',
      expect: 'not valid JSON',
      probe: answered({ status: 0, stdout: 'not json at all' }),
    },
    {
      name: 'the output held no records',
      expect: 'returned no records',
      probe: answered({ status: 0, stdout: '[]' }),
    },
    { name: 'no probe was taken', expect: 'never queried', probe: null },
  ];
  for (const entry of cases) {
    const target = volumeTargetFromProbe(CONTAINER, entry.probe);
    // Asserted together rather than in two steps: asserting the discriminant
    // first narrows the union, which would make the detail check vacuous.
    assert.ok(
      target.kind === 'unknown' && target.detail.includes(entry.expect),
      `${entry.name} must be unknown and explain itself, got ${JSON.stringify(
        target,
      )}`,
    );
  }
});

// ---------------------------------------------------------------------------
// verifyCleanup — the verdict handed to the mandatory gate.
// ---------------------------------------------------------------------------

test('a fully verified teardown reports both resources removed', () => {
  const result = verifyCleanup(probes());
  assert.equal(result.containerRemoved, true);
  assert.equal(result.volumeRemoved, true);
  assert.equal(result.volumeName, VOLUME);
  assert.equal(result.refusal, null);
  assert.equal(result.containerVerification.outcome, 'absent');
  assert.equal(result.volumeVerification.outcome, 'absent');
  assert.equal(result.removalExitStatus, 0);
  assert.equal(result.removalDetail, null);
});

test('a container with no attached volume still passes cleanly', () => {
  // Case 12 at the verdict level: nothing to remove is removed.
  const result = verifyCleanup(
    probes({ volume: { kind: 'none' }, volumeAbsence: null }),
  );
  assert.equal(result.containerRemoved, true);
  assert.equal(result.volumeRemoved, true);
  assert.equal(result.volumeName, null);
  assert.ok(result.volumeVerification.detail.includes('nothing to remove'));
});

test('an unverified teardown is reported as failure', () => {
  const cases: readonly {
    readonly name: string;
    readonly probes: CleanupProbes;
    readonly container: boolean;
    readonly volume: boolean;
  }[] = [
    // Case 9: the volume is still there.
    {
      name: 'the volume still exists',
      probes: probes({ volumeAbsence: answered({ status: 0 }) }),
      container: true,
      volume: false,
    },
    // Case 11: the volume check could not answer.
    {
      name: 'the volume check timed out',
      probes: probes({
        volumeAbsence: answered({ status: null, timedOut: true }),
      }),
      container: true,
      volume: false,
    },
    {
      name: 'the volume check was signalled',
      probes: probes({
        volumeAbsence: answered({ status: null, signal: 'SIGKILL' }),
      }),
      container: true,
      volume: false,
    },
    {
      name: 'the volume check could not spawn',
      probes: probes({
        volumeAbsence: answered({
          status: null,
          spawnError: 'spawnSync docker ENOENT',
        }),
      }),
      container: true,
      volume: false,
    },
    // The container side of the same failure modes.
    {
      name: 'the container still exists',
      probes: probes({ containerAbsence: answered({ status: 0 }) }),
      container: false,
      volume: true,
    },
    {
      name: 'the container check timed out',
      probes: probes({
        containerAbsence: answered({ status: null, timedOut: true }),
      }),
      container: false,
      volume: true,
    },
    {
      name: 'the daemon was unreachable for the container check',
      probes: probes({
        containerAbsence: answered({
          status: 1,
          stderr:
            'Cannot connect to the Docker daemon. Is the docker daemon running?',
        }),
      }),
      container: false,
      volume: true,
    },
    // The volume could never be identified at all.
    {
      name: 'the volume was never identified',
      probes: probes({
        volume: { kind: 'unknown', detail: 'the inspection did not answer' },
        volumeAbsence: null,
      }),
      container: true,
      volume: false,
    },
    // Both sides inconclusive at once.
    {
      name: 'neither check could answer',
      probes: probes({
        containerAbsence: answered({ status: null }),
        volumeAbsence: answered({ status: null }),
      }),
      container: false,
      volume: false,
    },
  ];
  for (const entry of cases) {
    const result = verifyCleanup(entry.probes);
    assert.equal(
      result.containerRemoved,
      entry.container,
      `${entry.name}: containerRemoved`,
    );
    assert.equal(
      result.volumeRemoved,
      entry.volume,
      `${entry.name}: volumeRemoved`,
    );
  }
});

test('cleanup verification continues after an earlier step fails', () => {
  // Case 14. A failed removal command, and a container check that could not
  // answer, must not suppress the volume's own verified result.
  const result = verifyCleanup(
    probes({
      removal: answered({
        status: 1,
        stderr: 'Error response from daemon: removal already in progress',
      }),
      containerAbsence: answered({ status: null, timedOut: true }),
    }),
  );
  assert.equal(result.containerRemoved, false);
  // Still judged, still true, still reported.
  assert.equal(result.volumeRemoved, true);
  assert.equal(result.volumeVerification.outcome, 'absent');
  assert.equal(result.removalExitStatus, 1);
  assert.ok(result.removalDetail?.includes('exited 1'));
});

test('a successful removal command is not itself evidence of removal', () => {
  // Measured: `docker rm --force --volumes <absent>` exits 0 and says
  // nothing, so exit 0 cannot stand in for a verified absence.
  const result = verifyCleanup(
    probes({
      removal: answered({ status: 0 }),
      containerAbsence: answered({ status: 0 }),
      volumeAbsence: answered({ status: 0 }),
    }),
  );
  assert.equal(result.removalExitStatus, 0);
  assert.equal(result.removalDetail, null);
  assert.equal(result.containerRemoved, false);
  assert.equal(result.volumeRemoved, false);
});

test('the removal failure cause is preserved for every process outcome', () => {
  for (const entry of [
    { probe: null, expect: 'was not attempted' },
    {
      probe: answered({ status: null, timedOut: true }),
      expect: 'timed out',
    },
    {
      probe: answered({ status: null, spawnError: 'spawnSync docker ENOENT' }),
      expect: 'could not be run',
    },
    {
      probe: answered({ status: null, signal: 'SIGKILL' }),
      expect: 'terminated by SIGKILL',
    },
    { probe: answered({ status: null }), expect: 'no exit status' },
    { probe: answered({ status: 4, stderr: '' }), expect: '(no stderr)' },
  ]) {
    const result = verifyCleanup(probes({ removal: entry.probe }));
    assert.ok(
      result.removalDetail?.includes(entry.expect),
      `expected "${entry.expect}", got ${String(result.removalDetail)}`,
    );
  }
});

test('a pre-action refusal reports nothing as removed', () => {
  // Teardown was never attempted, so neither resource may be called removed.
  const result = verifyCleanup(
    probes({
      refusal: `refusing teardown: ${DEV_VOLUME} is a persistent volume`,
      removal: null,
      containerAbsence: null,
      volumeAbsence: null,
    }),
  );
  assert.equal(result.containerRemoved, false);
  assert.equal(result.volumeRemoved, false);
  assert.equal(
    result.refusal,
    `refusing teardown: ${DEV_VOLUME} is a persistent volume`,
  );
  assert.equal(result.volumeName, VOLUME);
  assert.ok(result.removalDetail?.includes('was not attempted'));
});

test('an unconfirmed cleanup fails the mandatory validation verdict', () => {
  // Case 13. The gate reads the same four fields it always has, so a verdict
  // of "unknown" must arrive as `false` and be refused there.
  const unverified = verifyCleanup(
    probes({ containerAbsence: answered({ status: null, timedOut: true }) }),
  );
  const reasons: string[] = [];
  if (unverified.refusal !== null)
    reasons.push(`teardown refused: ${unverified.refusal}`);
  else {
    if (!unverified.containerRemoved)
      reasons.push('removal of the owned container was not verified');
    if (!unverified.volumeRemoved)
      reasons.push('removal of the owned anonymous volume was not verified');
  }
  assert.deepEqual(reasons, [
    'removal of the owned container was not verified',
  ]);

  // And the verified case must still pass that same gate, or the correction
  // would simply have broken teardown.
  const verified = verifyCleanup(probes());
  assert.equal(verified.refusal, null);
  assert.equal(verified.containerRemoved, true);
  assert.equal(verified.volumeRemoved, true);
});

// ---------------------------------------------------------------------------
// Diagnostics must stay bounded and credential-free.
// ---------------------------------------------------------------------------

test('diagnostics are bounded, single-line and carry no credentials', () => {
  const noisy = [
    'Error response from daemon: postgresql://reqro_test_user:Sup3rSecret0123@127.0.0.1:54321/db',
    'POSTGRES_PASSWORD=another-secret-value',
    'second line that must not appear',
  ].join('\n');
  const summary = summarizeDockerOutput(noisy);

  assert.equal(summary.includes('Sup3rSecret0123'), false);
  assert.equal(summary.includes('second line'), false);
  assert.equal(summary.includes('\n'), false);
  assert.ok(summary.includes('reqro_test_user'));
  assert.ok(summary.includes('[redacted]'));

  // Bounded.
  const long = summarizeDockerOutput('x'.repeat(5000));
  assert.ok(long.length <= 210, `unbounded diagnostic: ${String(long.length)}`);

  // An assignment-shaped secret on its own line is removed too.
  const assigned = summarizeDockerOutput(
    'REQRO_DISPOSABLE_NONCE=0123456789abcdef',
  );
  assert.equal(assigned.includes('0123456789abcdef'), false);
});

test('a classified detail never leaks the connection string', () => {
  const verdict = classifyResourceAbsence(
    'container',
    CONTAINER,
    answered({
      status: 9,
      stderr:
        'failed: postgresql://reqro_test_user:Sup3rSecret0123@127.0.0.1:54321/reqro_f0592_test',
    }),
  );
  assert.equal(verdict.outcome, 'unknown');
  assert.equal(verdict.detail.includes('Sup3rSecret0123'), false);
  assert.ok(verdict.detail.includes('[redacted]'));
});

// ---------------------------------------------------------------------------
// The denied-volume guard is unchanged by this correction.
// ---------------------------------------------------------------------------

test('the persistent development volume is never a teardown target', () => {
  // Not a new rule; asserted here so the volume-identification change cannot
  // quietly start nominating a named volume for removal.
  const target: VolumeTarget = volumeTargetFromProbe(
    CONTAINER,
    answered({
      stdout: containerInspectStdout([{ Type: 'volume', Name: DEV_VOLUME }]),
    }),
  );
  // Identification is honest -- it reports what Docker said...
  assert.deepEqual(target, { kind: 'known', name: DEV_VOLUME });
  // ...and `refuseUnlessOwnedCleanupTarget`, which `destroy()` calls before
  // removing anything, is what refuses it. That predicate has its own suite
  // in disposable-cluster-evidence.test.ts and is unchanged here.
});
