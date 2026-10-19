import assert from 'node:assert/strict';
import test from 'node:test';
import {
  disposableConfigFromEnv,
  refuseUnlessDisposable,
  refuseUnlessOwnedCleanupTarget,
  type DisposableEvidence,
} from '../helpers/disposable-cluster-evidence.js';

/**
 * F062.2D-2C-3B-2 NEW-a follow-up — the disposable-instance predicate.
 *
 * The predicate is pure, so every rejection below is proven against
 * FABRICATED evidence. No incorrect database is contacted, no persistent
 * volume is mounted and no foreign container is inspected in order to prove
 * that each would be refused. That is the reason the predicate was extracted
 * from the integration suites in the first place.
 *
 * All identifiers here are synthetic.
 */

const NONCE = 'f0ba7c2d9e4b41a7bd3c5e8f10273645';
const CONTAINER = 'c'.repeat(64);
const IMAGE_REPOSITORY_DIGEST =
  'sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';
const IMAGE_REFERENCE = `postgres@${IMAGE_REPOSITORY_DIGEST}`;
/**
 * Deliberately NOT the repository digest. The two identities differ under the
 * classic graphdriver image store, so the fixture that proves the predicate
 * correct has to differ too -- an equal pair would pass even if the predicate
 * went back to conflating them.
 */
const IMAGE_ID = `sha256:${'1d'.repeat(32)}`;
const ANONYMOUS_VOLUME = 'a'.repeat(64);
const EPOCH = new Date('2026-10-15T12:00:00.000Z');
const AFTER = new Date('2026-10-15T12:00:30.000Z');
const BEFORE = new Date('2026-10-15T11:59:00.000Z');

type ContainerFacts = NonNullable<DisposableEvidence['container']>;

/** Correct container facts, kept separately so perturbations never need a
 * non-null assertion to reach them. */
function containerFacts(): ContainerFacts {
  return {
    id: CONTAINER,
    imageReference: IMAGE_REFERENCE,
    imageId: IMAGE_ID,
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

/** A complete, correct evidence set. Every case below perturbs exactly one
 * field, so a rejection is attributable to that field alone. */
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
    },
    container: containerFacts(),
    expected: {
      database: 'reqro_f0592_test',
      role: 'reqro_test_user',
      nonce: NONCE,
      containerId: CONTAINER,
      imageReference: IMAGE_REFERENCE,
      imageId: IMAGE_ID,
      imageRepositoryDigest: IMAGE_REPOSITORY_DIGEST,
      harnessEpoch: EPOCH,
      deniedVolumeNames: ['cityvue-postgres-data'],
    },
  };
}

/** Deep-merges one perturbation into the correct evidence set. */
function perturb(change: {
  url?: Partial<DisposableEvidence['url']>;
  sql?: Partial<DisposableEvidence['sql']>;
  container?: Partial<ContainerFacts> | null;
  expected?: Partial<DisposableEvidence['expected']>;
}): DisposableEvidence {
  const base = evidence();
  return {
    url: { ...base.url, ...change.url },
    sql: { ...base.sql, ...change.sql },
    container:
      change.container === null
        ? null
        : { ...containerFacts(), ...change.container },
    expected: { ...base.expected, ...change.expected },
  };
}

test('correctly constructed disposable evidence is accepted', () => {
  assert.equal(refuseUnlessDisposable(evidence()), null);
});

test('loopback host spellings are all accepted', () => {
  for (const hostname of ['localhost', '127.0.0.1', '::1', '[::1]'])
    assert.equal(
      refuseUnlessDisposable(perturb({ url: { hostname } })),
      null,
      hostname,
    );
});

/**
 * Every row must be refused. The `reason` substring pins WHICH check fired,
 * so a case cannot silently start passing for an unrelated reason.
 */
const rejections: readonly {
  readonly name: string;
  readonly reason: string;
  readonly evidence: DisposableEvidence;
}[] = [
  // --- destination identity -------------------------------------------
  {
    name: 'incorrect database in the URL',
    reason: 'URL database',
    evidence: perturb({ url: { database: 'reqro_dev' } }),
  },
  {
    name: 'incorrect role in the URL',
    reason: 'URL role',
    evidence: perturb({ url: { username: 'reqro_dev_user' } }),
  },
  {
    name: 'the server reports a different database',
    reason: 'reports database',
    evidence: perturb({ sql: { database: 'reqro_test' } }),
  },
  {
    name: 'the server reports a different role',
    reason: 'reports role',
    evidence: perturb({ sql: { user: 'reqro_dev_user' } }),
  },
  {
    name: 'a public destination',
    reason: 'loopback',
    evidence: perturb({ url: { hostname: 'db.example.gov' } }),
  },
  // Requirement 3: privacy is NOT disposability. These are the regression
  // guards against re-accepting an address test.
  {
    name: 'a private Docker bridge destination',
    reason: 'loopback',
    evidence: perturb({ url: { hostname: '172.17.0.2' } }),
  },
  {
    name: 'a private managed-endpoint destination',
    reason: 'loopback',
    evidence: perturb({ url: { hostname: '10.1.2.3' } }),
  },
  // --- the nonce -------------------------------------------------------
  {
    name: 'a missing server nonce',
    reason: 'does not expose',
    evidence: perturb({ sql: { nonce: null } }),
  },
  {
    name: 'an empty server nonce',
    reason: 'empty disposable-instance nonce',
    evidence: perturb({ sql: { nonce: '   ' } }),
  },
  {
    name: 'an incorrect server nonce',
    reason: 'does not match this run',
    evidence: perturb({ sql: { nonce: 'd'.repeat(32) } }),
  },
  {
    name: 'an empty expected nonce',
    reason: 'expected disposable-instance nonce is empty',
    evidence: perturb({ expected: { nonce: '' } }),
  },
  // --- provenance in time ----------------------------------------------
  {
    name: 'a missing postmaster start time',
    reason: 'postmaster start time',
    evidence: perturb({ sql: { postmasterStart: null } }),
  },
  {
    name: 'a server that started before this run',
    reason: 'started before this harness run',
    evidence: perturb({ sql: { postmasterStart: BEFORE } }),
  },
  {
    name: 'a reused container created before this run',
    reason: 'predates this harness run',
    evidence: perturb({ container: { created: BEFORE } }),
  },
  {
    name: 'a missing container creation time',
    reason: 'creation time is missing',
    evidence: perturb({ container: { created: null } }),
  },
  {
    name: 'an invalid harness epoch',
    reason: 'harness epoch is not a valid time',
    evidence: perturb({ expected: { harnessEpoch: new Date('nonsense') } }),
  },
  // --- inherited state -------------------------------------------------
  {
    name: 'an inherited schema backlog',
    reason: 'unexpected schema',
    evidence: perturb({ sql: { unexpectedSchemaCount: 380 } }),
  },
  {
    name: 'a missing schema census',
    reason: 'census is missing',
    evidence: perturb({ sql: { unexpectedSchemaCount: null } }),
  },
  // --- container identity ----------------------------------------------
  {
    name: 'an instance Docker cannot account for',
    reason: 'Docker does not account for this instance',
    evidence: perturb({ container: null }),
  },
  {
    name: 'a different container ID',
    reason: 'container ID does not match',
    evidence: perturb({ container: { id: 'b'.repeat(64) } }),
  },
  {
    name: 'an unpinned image reference',
    reason: 'not the pinned digest',
    evidence: perturb({ container: { imageReference: 'postgres:17-alpine' } }),
  },
  {
    name: 'a substituted container image configuration ID',
    reason: 'not the image this run verified',
    evidence: perturb({ container: { imageId: 'sha256:' + 'e'.repeat(64) } }),
  },
  {
    name: 'a stopped container',
    reason: 'not running',
    evidence: perturb({ container: { running: false } }),
  },
  // --- label binding ---------------------------------------------------
  {
    name: 'a container with no disposable label',
    reason: 'no com.reqro.disposable label',
    evidence: perturb({ container: { labels: {} } }),
  },
  {
    name: 'a label that disagrees with the server nonce',
    reason: 'label and the server nonce disagree',
    evidence: perturb({
      container: { labels: { 'com.reqro.disposable': 'f'.repeat(32) } },
    }),
  },
  // --- network binding -------------------------------------------------
  {
    name: 'a publicly bound port',
    reason: 'publish to 127.0.0.1 only',
    evidence: perturb({
      container: { portBindings: [{ hostIp: '0.0.0.0', hostPort: '62818' }] },
    }),
  },
  {
    name: 'a published port that is not the connected port',
    reason: 'is not the connected port',
    evidence: perturb({
      container: { portBindings: [{ hostIp: '127.0.0.1', hostPort: '5432' }] },
    }),
  },
  {
    name: 'no published port at all',
    reason: 'exactly one published port binding',
    evidence: perturb({ container: { portBindings: [] } }),
  },
  // --- storage lifecycle -----------------------------------------------
  {
    name: 'the persistent development volume',
    reason: 'persistent volume',
    evidence: perturb({
      container: {
        mounts: [
          {
            type: 'volume',
            name: 'cityvue-postgres-data',
            destination: '/var/lib/postgresql/data',
          },
        ],
      },
    }),
  },
  {
    name: 'an arbitrary named volume',
    reason: 'named volume',
    evidence: perturb({
      container: {
        mounts: [
          {
            type: 'volume',
            name: 'some-retained-volume',
            destination: '/var/lib/postgresql/data',
          },
        ],
      },
    }),
  },
  {
    name: 'a bind-mounted host directory',
    reason: 'got a bind mount',
    evidence: perturb({
      container: {
        mounts: [
          {
            type: 'bind',
            name: '',
            destination: '/var/lib/postgresql/data',
          },
        ],
      },
    }),
  },
  {
    name: 'an extra mount beyond the anonymous volume',
    reason: 'exactly one mount',
    evidence: perturb({
      container: {
        mounts: [
          {
            type: 'volume',
            name: ANONYMOUS_VOLUME,
            destination: '/var/lib/postgresql/data',
          },
          { type: 'bind', name: '', destination: '/secrets' },
        ],
      },
    }),
  },
];

test('incorrect disposable evidence is refused, with the cause named', () => {
  for (const rejection of rejections) {
    const refusal = refuseUnlessDisposable(rejection.evidence);
    assert.ok(
      refusal !== null,
      `${rejection.name} must be refused but was accepted`,
    );
    assert.ok(
      refusal.includes(rejection.reason),
      `${rejection.name} refused for the wrong reason: ${refusal}`,
    );
  }
});

test('every rejection reason is free of credential material', () => {
  const secret = 'sup3rs3cr3t-password';
  for (const rejection of rejections) {
    const refusal = refuseUnlessDisposable(rejection.evidence) ?? '';
    assert.ok(!refusal.includes(secret));
    assert.ok(!refusal.toLowerCase().includes('password'));
  }
});

test('the predicate fails closed on empty evidence', () => {
  const empty: DisposableEvidence = {
    url: { hostname: '', port: '', database: '', username: '' },
    sql: {
      database: '',
      user: '',
      nonce: null,
      postmasterStart: null,
      unexpectedSchemaCount: null,
    },
    container: null,
    expected: {
      database: '',
      role: '',
      nonce: '',
      containerId: '',
      imageReference: '',
      imageId: '',
      imageRepositoryDigest: '',
      harnessEpoch: new Date('nonsense'),
      deniedVolumeNames: [],
    },
  };
  assert.ok(refuseUnlessDisposable(empty) !== null);
});

// ---------------------------------------------------------------------------
// Configuration discovery: absent skips, partial fails.
// ---------------------------------------------------------------------------

const COMPLETE_ENV = {
  REQRO_DISPOSABLE_NONCE: NONCE,
  REQRO_DISPOSABLE_CONTAINER_ID: CONTAINER,
  REQRO_DISPOSABLE_IMAGE_REFERENCE: IMAGE_REFERENCE,
  REQRO_DISPOSABLE_IMAGE_ID: IMAGE_ID,
  REQRO_DISPOSABLE_IMAGE_REPOSITORY_DIGEST: IMAGE_REPOSITORY_DIGEST,
  REQRO_DISPOSABLE_EPOCH: EPOCH.toISOString(),
} as const;

test('an entirely absent configuration is a skip, not a failure', () => {
  assert.deepEqual(disposableConfigFromEnv({}), { kind: 'absent' });
  assert.deepEqual(disposableConfigFromEnv({ REQRO_DISPOSABLE_NONCE: '   ' }), {
    kind: 'absent',
  });
});

test('a partially configured environment is never a skip', () => {
  for (const key of Object.keys(COMPLETE_ENV)) {
    const partial = Object.fromEntries(
      Object.entries(COMPLETE_ENV).filter(([name]) => name !== key),
    );
    const state = disposableConfigFromEnv(partial);
    if (state.kind !== 'partial')
      assert.fail(`omitting ${key} must be partial, got ${state.kind}`);
    assert.ok(state.missing.includes(key));
  }
});

test('a complete configuration yields usable expectations', () => {
  const state = disposableConfigFromEnv(COMPLETE_ENV);
  if (state.kind !== 'configured')
    assert.fail(`a complete environment must configure, got ${state.kind}`);
  assert.equal(state.expected.database, 'reqro_f0592_test');
  assert.equal(state.expected.role, 'reqro_test_user');
  assert.equal(state.expected.nonce, NONCE);
  assert.equal(state.expected.harnessEpoch.toISOString(), EPOCH.toISOString());
  // The development volume is denied by default, not by caller diligence.
  assert.ok(state.expected.deniedVolumeNames.includes('cityvue-postgres-data'));
  // A complete configuration must satisfy the predicate end to end.
  assert.equal(
    refuseUnlessDisposable({ ...evidence(), expected: state.expected }),
    null,
  );
});

// ---------------------------------------------------------------------------
// Teardown authorization.
// ---------------------------------------------------------------------------

test('teardown accepts only resources this run created', () => {
  const expected = {
    containerId: CONTAINER,
    deniedVolumeNames: ['cityvue-postgres-data'],
  };
  assert.equal(
    refuseUnlessOwnedCleanupTarget(
      { containerId: CONTAINER, volumeNames: [ANONYMOUS_VOLUME] },
      expected,
    ),
    null,
  );

  const unauthorized: readonly {
    readonly name: string;
    readonly reason: string;
    readonly target: {
      readonly containerId: string;
      readonly volumeNames: readonly string[];
    };
  }[] = [
    {
      name: 'a foreign container',
      reason: 'not the one this run created',
      target: { containerId: 'b'.repeat(64), volumeNames: [] },
    },
    {
      name: 'no container ID',
      reason: 'no container ID was supplied',
      target: { containerId: '', volumeNames: [] },
    },
    {
      name: 'the persistent development volume',
      reason: 'is a persistent volume',
      target: {
        containerId: CONTAINER,
        volumeNames: ['cityvue-postgres-data'],
      },
    },
    {
      name: 'an arbitrary named volume',
      reason: 'is not an anonymous volume',
      target: { containerId: CONTAINER, volumeNames: ['retained-data'] },
    },
  ];
  for (const attempt of unauthorized) {
    const refusal = refuseUnlessOwnedCleanupTarget(attempt.target, expected);
    assert.ok(refusal !== null, `${attempt.name} must be refused`);
    assert.ok(refusal.includes(attempt.reason), `${attempt.name}: ${refusal}`);
  }

  // A run that recorded no container must never remove anything.
  assert.ok(
    refuseUnlessOwnedCleanupTarget(
      { containerId: CONTAINER, volumeNames: [] },
      { containerId: '', deniedVolumeNames: [] },
    ) !== null,
  );
});
