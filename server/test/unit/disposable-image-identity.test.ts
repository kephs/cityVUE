import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateImageIdentity,
  normalizeDockerResult,
  type DockerResult,
} from '../helpers/f0592-disposable-cluster.js';
import {
  refuseUnlessDisposable,
  disposableConfigFromEnv,
  type DisposableEvidence,
} from '../helpers/disposable-cluster-evidence.js';

/**
 * Offline image-identity regressions. .Id is Docker-observed identity, not
 * necessarily a configuration digest. Equal and differing synthetic values
 * model containerd and graphdriver shapes without claiming real execution.
 */

const REPOSITORY = 'postgres';
const APPROVED_DIGEST = `sha256:${'b0'.repeat(32)}`;
/** A legitimately different Docker-observed image ID, as a graphdriver host reports. */
const OBSERVED_IMAGE_ID = `sha256:${'1d'.repeat(32)}`;
const OTHER_DIGEST = `sha256:${'ee'.repeat(32)}`;
const EXPECTED = { repository: REPOSITORY, repositoryDigest: APPROVED_DIGEST };

/** A probe that answered successfully with the given template output. */
function probe(stdout: string, overrides: Partial<DockerResult> = {}) {
  return {
    status: 0,
    signal: null,
    spawnError: null,
    timedOut: false,
    stdout,
    stderr: '',
    ...overrides,
  };
}

/** The template output shape: `{{.Id}}|{{join .RepoDigests ","}}`. */
function rendered(
  observedImageId: string,
  repoDigests: readonly string[],
): string {
  return `${observedImageId}|${repoDigests.join(',')}`;
}

function reasonOf(verdict: ReturnType<typeof evaluateImageIdentity>): string {
  if (verdict.ok) assert.fail('expected a refusal, got an approval');
  return verdict.reason;
}

// ---------------------------------------------------------------------------
// 1-3. Positive: the approved digest, a separately recorded Docker-observed image ID,
// and the two differing legitimately.
// ---------------------------------------------------------------------------

test('the approved repository digest verifies and both identities are reported', () => {
  const verdict = evaluateImageIdentity(
    probe(rendered(OBSERVED_IMAGE_ID, [`${REPOSITORY}@${APPROVED_DIGEST}`])),
    EXPECTED,
  );
  if (!verdict.ok) assert.fail(`expected approval, got: ${verdict.reason}`);
  assert.equal(verdict.identity.repositoryDigest, APPROVED_DIGEST);
  assert.equal(verdict.identity.observedImageId, OBSERVED_IMAGE_ID);
  // The whole point: the Docker-observed image ID is never returned as the registry
  // identity, even though both are `sha256:`-shaped.
  assert.notEqual(
    verdict.identity.observedImageId,
    verdict.identity.repositoryDigest,
    'the two identities must stay distinct',
  );
});

test('a Docker-observed image ID equal to the repository digest is also accepted', () => {
  // A containerd observation may report `.Id` as the index digest, so the two
  // values coincide there. That must remain valid: the correction is that
  // equality is not REQUIRED, not that it is forbidden.
  const verdict = evaluateImageIdentity(
    probe(rendered(APPROVED_DIGEST, [`${REPOSITORY}@${APPROVED_DIGEST}`])),
    EXPECTED,
  );
  if (!verdict.ok) assert.fail(`expected approval, got: ${verdict.reason}`);
  assert.equal(verdict.identity.observedImageId, APPROVED_DIGEST);
  assert.equal(verdict.identity.repositoryDigest, APPROVED_DIGEST);
});

test('a registry-qualified repository is the same repository', () => {
  for (const repository of [
    'postgres',
    'library/postgres',
    'docker.io/library/postgres',
    'registry-1.docker.io/library/postgres',
  ]) {
    const verdict = evaluateImageIdentity(
      probe(rendered(OBSERVED_IMAGE_ID, [`${repository}@${APPROVED_DIGEST}`])),
      EXPECTED,
    );
    if (!verdict.ok)
      assert.fail(`${repository} must verify, got: ${verdict.reason}`);
    assert.equal(verdict.identity.repositoryDigest, APPROVED_DIGEST);
  }
});

test('conflicting repository digests cannot be rescued by the approved entry', () => {
  assert.match(
    reasonOf(
      evaluateImageIdentity(
        probe(
          rendered(OBSERVED_IMAGE_ID, [
            REPOSITORY + '@' + OTHER_DIGEST,
            REPOSITORY + '@' + APPROVED_DIGEST,
          ]),
        ),
        EXPECTED,
      ),
    ),
    /repository digest/,
  );
});

for (const repository of [
  'evil.example/postgres',
  'evil.example/library/postgres',
  'localhost:5000/postgres',
  'docker.io/attacker/postgres',
  'attacker/postgres',
  'docker.io.evil.example/library/postgres',
  'docker.io:443/library/postgres',
  'https://docker.io/library/postgres',
  'docker.io/library/postgres:17-alpine',
  'docker.io/library/../postgres',
  'Docker.io/library/postgres',
  'postgres ',
  ' postgres',
]) {
  test('rejects unapproved repository ' + repository, () => {
    for (const entries of [
      [repository + '@' + APPROVED_DIGEST],
      [REPOSITORY + '@' + APPROVED_DIGEST, repository + '@' + APPROVED_DIGEST],
    ]) {
      assert.equal(
        evaluateImageIdentity(
          probe(rendered(OBSERVED_IMAGE_ID, entries)),
          EXPECTED,
        ).ok,
        false,
      );
    }
  });
}

test('rejects empty entries, duplicates and malformed or ambiguous metadata', () => {
  const approved = REPOSITORY + '@' + APPROVED_DIGEST;
  for (const entries of [
    [approved, ''],
    ['', approved],
    [approved, approved],
    ['postgres@@' + APPROVED_DIGEST],
    [approved + '|'],
    [approved + '\n'],
  ]) {
    assert.equal(
      evaluateImageIdentity(
        probe(rendered(OBSERVED_IMAGE_ID, entries)),
        EXPECTED,
      ).ok,
      false,
    );
  }
});

test('approved aliases may repeat one unambiguous registry identity', () => {
  assert.equal(
    evaluateImageIdentity(
      probe(
        rendered(OBSERVED_IMAGE_ID, [
          'postgres@' + APPROVED_DIGEST,
          'docker.io/library/postgres@' + APPROVED_DIGEST,
        ]),
      ),
      EXPECTED,
    ).ok,
    true,
  );
});

// ---------------------------------------------------------------------------
// 4-7. Wrong, missing, malformed and unexpected identities.
// ---------------------------------------------------------------------------

test('an incorrect repository digest is refused', () => {
  const reason = reasonOf(
    evaluateImageIdentity(
      probe(rendered(OBSERVED_IMAGE_ID, [`${REPOSITORY}@${OTHER_DIGEST}`])),
      EXPECTED,
    ),
  );
  assert.match(reason, /repository digest/);
  assert.ok(reason.includes(APPROVED_DIGEST), 'must name what was expected');
});

test('a Docker-observed image ID matching the approved digest cannot stand in for it', () => {
  // The exact substitution this corrects: `.Id` is right, provenance is
  // absent or wrong. Being `.Id`-correct must not rescue it.
  const reason = reasonOf(
    evaluateImageIdentity(
      probe(rendered(APPROVED_DIGEST, [`${REPOSITORY}@${OTHER_DIGEST}`])),
      EXPECTED,
    ),
  );
  assert.match(reason, /repository digest/);
});

test('an absent repository digest is refused as a mutable tag', () => {
  const reason = reasonOf(
    evaluateImageIdentity(probe(rendered(OBSERVED_IMAGE_ID, [])), EXPECTED),
  );
  assert.match(reason, /no repository digest|mutable tag/);
});

test('a mutable tag without any approved digest is refused', () => {
  // What `docker image inspect postgres:17-alpine` looks like on a host that
  // built or loaded the image locally: tagged, never pulled, no digest.
  const reason = reasonOf(
    evaluateImageIdentity(probe(`${OBSERVED_IMAGE_ID}|`), EXPECTED),
  );
  assert.match(reason, /mutable tag/);
});

test('malformed digests are refused', () => {
  const malformed = [
    `${REPOSITORY}@sha256:${'b0'.repeat(31)}`, // too short
    `${REPOSITORY}@sha256:${'B0'.repeat(32)}`, // uppercase, not canonical
    `${REPOSITORY}@sha512:${'b0'.repeat(32)}`, // unsupported algorithm
    `${REPOSITORY}@${'b0'.repeat(32)}`, // algorithm missing
    `${REPOSITORY}@`, // digest missing
    `@${APPROVED_DIGEST}`, // repository missing
    APPROVED_DIGEST, // no repository separator at all
  ];
  for (const entry of malformed) {
    const reason = reasonOf(
      evaluateImageIdentity(
        probe(rendered(OBSERVED_IMAGE_ID, [entry])),
        EXPECTED,
      ),
    );
    assert.match(
      reason,
      /malformed repository digest|is not postgres@/,
      `${entry} must be refused, got: ${reason}`,
    );
  }
});

test('a malformed Docker-observed image ID is refused', () => {
  for (const observedImageId of [
    '',
    'not-a-digest',
    `sha256:${'b0'.repeat(31)}`,
  ]) {
    const reason = reasonOf(
      evaluateImageIdentity(
        probe(rendered(observedImageId, [`${REPOSITORY}@${APPROVED_DIGEST}`])),
        EXPECTED,
      ),
    );
    assert.match(reason, /Docker-observed image ID/);
  }
});

test('an unexpected repository reference is refused', () => {
  const reason = reasonOf(
    evaluateImageIdentity(
      probe(
        rendered(OBSERVED_IMAGE_ID, [`attacker/postgres@${APPROVED_DIGEST}`]),
      ),
      EXPECTED,
    ),
  );
  assert.match(reason, /unexpected repository reference/);
  assert.ok(reason.includes('attacker/postgres'));
});

test('a repository that merely ends in the approved name is refused', () => {
  // `notpostgres` must not satisfy `postgres`. The accepted boundary is a
  // path separator, not a suffix.
  const reason = reasonOf(
    evaluateImageIdentity(
      probe(rendered(OBSERVED_IMAGE_ID, [`notpostgres@${APPROVED_DIGEST}`])),
      EXPECTED,
    ),
  );
  assert.match(reason, /unexpected repository reference/);
});

test('an unrelated local image never satisfies the check', () => {
  const reason = reasonOf(
    evaluateImageIdentity(
      probe(rendered(OBSERVED_IMAGE_ID, [`redis@${OTHER_DIGEST}`])),
      EXPECTED,
    ),
  );
  assert.match(reason, /unexpected repository reference/);
});

// ---------------------------------------------------------------------------
// 9-11. The probe did not run, did not finish, or answered nothing usable.
// ---------------------------------------------------------------------------

test('a failed Docker inspection is a verification failure', () => {
  const reason = reasonOf(
    evaluateImageIdentity(
      probe('', { status: 1, stderr: 'Error: No such image' }),
      EXPECTED,
    ),
  );
  assert.match(reason, /unavailable locally/);
  assert.ok(reason.includes('No such image'));
});

test('a failed inspection with no detail still refuses', () => {
  const reason = reasonOf(
    evaluateImageIdentity(probe('', { status: 1 }), EXPECTED),
  );
  assert.match(reason, /unavailable locally/);
});

test('a spawn failure is a verification failure', () => {
  const reason = reasonOf(
    evaluateImageIdentity(
      probe('', { status: null, spawnError: 'spawn docker ENOENT' }),
      EXPECTED,
    ),
  );
  assert.match(reason, /could not run/);
});

test('a timed-out inspection is a verification failure', () => {
  const reason = reasonOf(
    evaluateImageIdentity(
      probe('', { status: null, timedOut: true, signal: 'SIGTERM' }),
      EXPECTED,
    ),
  );
  assert.match(reason, /timed out/);
});

test('abnormal termination is a verification failure', () => {
  const reason = reasonOf(
    evaluateImageIdentity(
      probe('', { status: null, signal: 'SIGKILL' }),
      EXPECTED,
    ),
  );
  assert.match(reason, /terminated by SIGKILL/);
});

test('a successful probe that answered nothing is a verification failure', () => {
  const reason = reasonOf(evaluateImageIdentity(probe(''), EXPECTED));
  assert.match(reason, /no image metadata/);
});

test('output that did not render the template is a verification failure', () => {
  // No delimiter: the template failed, which is NOT the same as "there are no
  // repository digests" and must not be read as it.
  for (const stdout of [OBSERVED_IMAGE_ID, 'null', '<no value>', '{}']) {
    const reason = reasonOf(evaluateImageIdentity(probe(stdout), EXPECTED));
    assert.match(reason, /malformed image metadata/, `for ${stdout}`);
  }
});

test('contradictory metadata is refused rather than reconciled', () => {
  // Two repository digests for the same repository, neither approved. There
  // is no rule by which one wins, so the only safe answer is refusal.
  const reason = reasonOf(
    evaluateImageIdentity(
      probe(
        rendered(OBSERVED_IMAGE_ID, [
          `${REPOSITORY}@${OTHER_DIGEST}`,
          `${REPOSITORY}@sha256:${'cc'.repeat(32)}`,
        ]),
      ),
      EXPECTED,
    ),
  );
  assert.match(reason, /repository digest/);
});

test('a real spawnSync-shaped failure normalises into a refusal', () => {
  // Proves the pure evaluator composes with the normaliser the helper uses,
  // so the branches above are reachable from an actual probe.
  const normalised = normalizeDockerResult({
    status: null,
    signal: 'SIGTERM',
    stdout: '',
    stderr: '',
    error: Object.assign(new Error('spawnSync docker ETIMEDOUT'), {
      code: 'ETIMEDOUT',
    }),
  });
  assert.equal(normalised.timedOut, true);
  assert.match(
    reasonOf(evaluateImageIdentity(normalised, EXPECTED)),
    /timed out/,
  );
});

// ---------------------------------------------------------------------------
// 15. Evidence compatibility: the predicate keeps the identities apart.
// ---------------------------------------------------------------------------

const NONCE = 'f0ba7c2d9e4b41a7bd3c5e8f10273645';
const CONTAINER = 'c'.repeat(64);
const ANONYMOUS_VOLUME = 'a'.repeat(64);
const EPOCH = new Date('2026-10-15T12:00:00.000Z');
const AFTER = new Date('2026-10-15T12:00:30.000Z');

type ContainerFacts = NonNullable<DisposableEvidence['container']>;

/**
 * Correct container facts, built separately so a perturbation never needs a
 * non-null assertion to reach them.
 */
function containerFacts(): ContainerFacts {
  return {
    id: CONTAINER,
    imageReference: `${REPOSITORY}@${APPROVED_DIGEST}`,
    // This synthetic daemon reports a distinct observed image ID.
    imageId: OBSERVED_IMAGE_ID,
    running: true,
    created: AFTER,
    portBindings: [{ hostIp: '127.0.0.1', hostPort: '62818' }],
    mounts: [
      {
        type: 'volume',
        name: ANONYMOUS_VOLUME,
        destination: '/var/lib/postgresql/data',
      },
    ],
    labels: { 'com.reqro.disposable': NONCE },
  };
}

/** Correct evidence in which the two image identities legitimately differ. */
function evidence(): DisposableEvidence {
  return {
    url: {
      hostname: '127.0.0.1',
      port: '62818',
      database: 'reqro_f0592_test',
      username: 'reqro_test_user',
    },
    sql: {
      database: 'reqro_f0592_test',
      user: 'reqro_test_user',
      nonce: NONCE,
      postmasterStart: AFTER,
      unexpectedSchemaCount: 0,
      schemas: [],
      appliedMigrations: [],
    },
    container: containerFacts(),
    expected: {
      database: 'reqro_f0592_test',
      role: 'reqro_test_user',
      nonce: NONCE,
      containerId: CONTAINER,
      imageReference: `${REPOSITORY}@${APPROVED_DIGEST}`,
      imageId: OBSERVED_IMAGE_ID,
      imageRepositoryDigest: APPROVED_DIGEST,
      harnessEpoch: EPOCH,
      deniedVolumeNames: ['cityvue-postgres-data'],
    },
  };
}

test('evidence with legitimately differing image identities is accepted', () => {
  // Under the old rule this exact evidence -- a correct graphdriver host --
  // was refused, because the container image ID is not the repository digest.
  assert.equal(refuseUnlessDisposable(evidence()), null);
});

test('the container must run the image this run verified', () => {
  const refusal = refuseUnlessDisposable({
    ...evidence(),
    container: { ...containerFacts(), imageId: OTHER_DIGEST },
  });
  assert.match(String(refusal), /Docker-observed image ID/);
});

test('a container created from an unpinned reference is refused', () => {
  const refusal = refuseUnlessDisposable({
    ...evidence(),
    container: { ...containerFacts(), imageReference: 'postgres:17-alpine' },
  });
  assert.match(String(refusal), /image reference/);
});

test('expectations whose reference omits the approved digest are refused', () => {
  // Guards the one gap a observed-ID comparison alone would leave: a
  // consistent pair of values that are not the approved provenance.
  const base = evidence();
  const refusal = refuseUnlessDisposable({
    ...base,
    expected: {
      ...base.expected,
      imageReference: `${REPOSITORY}@${OTHER_DIGEST}`,
    },
  });
  assert.match(
    String(refusal),
    /does not carry the approved repository digest/,
  );
});

test('an absent repository digest expectation fails closed', () => {
  const base = evidence();
  const refusal = refuseUnlessDisposable({
    ...base,
    expected: { ...base.expected, imageRepositoryDigest: '   ' },
  });
  assert.match(String(refusal), /repository digest is empty/);
});

test('the repository digest is a required part of the environment contract', () => {
  // Omitting it is "partial", never "absent": a half-configured environment
  // is the shape a tampered or half-torn-down run takes, so it must fail
  // rather than skip.
  const state = disposableConfigFromEnv({
    REQRO_DISPOSABLE_NONCE: NONCE,
    REQRO_DISPOSABLE_CONTAINER_ID: CONTAINER,
    REQRO_DISPOSABLE_IMAGE_REFERENCE: `${REPOSITORY}@${APPROVED_DIGEST}`,
    REQRO_DISPOSABLE_IMAGE_ID: OBSERVED_IMAGE_ID,
    REQRO_DISPOSABLE_EPOCH: EPOCH.toISOString(),
  });
  if (state.kind !== 'partial')
    assert.fail(`expected partial, got ${state.kind}`);
  assert.ok(
    state.missing.includes('REQRO_DISPOSABLE_IMAGE_REPOSITORY_DIGEST'),
    'the missing key must be named',
  );
});

test('a complete environment carries both identities separately', () => {
  const state = disposableConfigFromEnv({
    REQRO_DISPOSABLE_NONCE: NONCE,
    REQRO_DISPOSABLE_CONTAINER_ID: CONTAINER,
    REQRO_DISPOSABLE_IMAGE_REFERENCE: `${REPOSITORY}@${APPROVED_DIGEST}`,
    REQRO_DISPOSABLE_IMAGE_ID: OBSERVED_IMAGE_ID,
    REQRO_DISPOSABLE_IMAGE_REPOSITORY_DIGEST: APPROVED_DIGEST,
    REQRO_DISPOSABLE_EPOCH: EPOCH.toISOString(),
  });
  if (state.kind !== 'configured')
    assert.fail(`expected configured, got ${state.kind}`);
  assert.equal(state.expected.imageId, OBSERVED_IMAGE_ID);
  assert.equal(state.expected.imageRepositoryDigest, APPROVED_DIGEST);
  assert.notEqual(
    state.expected.imageId,
    state.expected.imageRepositoryDigest,
    'the environment must not collapse the two identities',
  );
});
