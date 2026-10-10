import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  connectorOperations,
  NO_CAPABILITIES,
  orderingGuarantees,
  sideEffectRisks,
  type ConnectorCapabilities,
} from '../../src/integration/connector-capabilities.js';
import { connectorLifecycleStates } from '../../src/integration/delivery-contract.js';
import {
  advancesConfigurationRevision,
  advancesRecordRevision,
  assertCapabilities,
  assertConnectorKey,
  assertConnectorKind,
  assertCredentialReference,
  capabilitiesDiffer,
  connectorChangeCategories,
  connectorKinds,
  connectorLifecycleTransitions,
  connectorMetadataRefusals,
  ConnectorMetadataRefusal,
  fromCapabilityColumns,
  INITIAL_CAPABILITIES,
  mayTransitionLifecycle,
  toCapabilityColumns,
} from '../../src/integration/persistence/connector-metadata.js';

/**
 * F062.2B — connector metadata contract and source-boundary tests.
 *
 * These assert two different kinds of property. The contract tests prove the
 * validation and lifecycle rules behave as specified; the source tests prove
 * the slice stayed inside its authorized scope, over the migration and
 * persistence sources, with comments and string literals removed where a
 * prohibition would otherwise flag its own documentation.
 */

const SRC = resolve(__dirname, '../../../src');
const MIGRATIONS = resolve(__dirname, '../../../migrations');
const MIGRATION = '20261020000000-add-integration-connector-registry.ts';

const F062_2B_SOURCES = [
  resolve(SRC, 'integration/persistence/connector-metadata.ts'),
  resolve(SRC, 'integration/persistence/connector-metadata.repository.ts'),
  resolve(MIGRATIONS, MIGRATION),
];

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

/** Executable code only: block comments, line comments and string literals
 * removed. A rule stated in a comment is not a rule broken, and this slice's
 * own documentation names the things it forbids. */
function executable(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\r\n]*/g, '$1 ')
    .replace(/'(?:[^'\\\r\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\r\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

// ---------------------------------------------------------------------------
// F062.1 parity: one vocabulary, not two
// ---------------------------------------------------------------------------

test('lifecycle transitions are declared over exactly F062.1 lifecycle states', () => {
  assert.deepEqual(
    Object.keys(connectorLifecycleTransitions).sort(),
    [...connectorLifecycleStates].sort(),
    'the transition table must cover exactly F062.1 connectorLifecycleStates',
  );
  for (const [from, targets] of Object.entries(connectorLifecycleTransitions)) {
    for (const target of targets)
      assert.ok(
        (connectorLifecycleStates as readonly string[]).includes(target),
        `${from} -> ${target} names a state F062.1 does not define`,
      );
  }
});

test('retired is terminal and nothing returns to configured', () => {
  assert.deepEqual(connectorLifecycleTransitions.retired, []);
  for (const state of connectorLifecycleStates)
    assert.equal(
      mayTransitionLifecycle(state, 'configured'),
      false,
      `${state} must not transition back to configured`,
    );
  // The specific regression this slice must prevent.
  assert.equal(mayTransitionLifecycle('retired', 'active'), false);
  assert.equal(mayTransitionLifecycle('retired', 'disabled'), false);
});

test('disabling is reversible and every live state can be retired', () => {
  assert.equal(mayTransitionLifecycle('disabled', 'active'), true);
  for (const state of ['configured', 'active', 'degraded', 'disabled'] as const)
    assert.equal(mayTransitionLifecycle(state, 'retired'), true);
});

test('the initial capability profile is F062.1 NO_CAPABILITIES itself', () => {
  assert.equal(INITIAL_CAPABILITIES, NO_CAPABILITIES);
  // The conservative default that matters: a destination is assumed
  // consequential until it declares otherwise.
  assert.equal(INITIAL_CAPABILITIES.sideEffectRisk, 'irreversible');
  assert.deepEqual(INITIAL_CAPABILITIES.operations, []);
});

test('capability columns round-trip F062.1 capabilities without loss', () => {
  const capabilities: ConnectorCapabilities = {
    operations: ['createRequest', 'getRequestStatus'],
    supportsIdempotencyKey: true,
    supportsReadAfterWrite: true,
    supportsReconciliation: true,
    supportsWebhookCallback: true,
    supportsOrdering: 'per_aggregate',
    supportsUpdate: true,
    supportsCancel: true,
    supportsDelete: false,
    supportsCurrentStateSync: true,
    reportsTerminalState: true,
    sideEffectRisk: 'physical',
  };
  const round = fromCapabilityColumns(toCapabilityColumns(capabilities));
  assert.deepEqual(round, {
    ...capabilities,
    operations: ['createRequest', 'getRequestStatus'].sort(),
  });
});

test('every capability column maps one F062.1 field, with none missed', () => {
  const columns = toCapabilityColumns(NO_CAPABILITIES);
  assert.equal(
    Object.keys(columns).length,
    Object.keys(NO_CAPABILITIES).length,
    'the column mapping must cover exactly the F062.1 contract fields',
  );
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function refusalCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof ConnectorMetadataRefusal);
    return error.code;
  }
  throw new Error('expected a refusal');
}

test('connector keys follow the F062.1 connector identifier grammar', () => {
  assert.equal(assertConnectorKey('loopback-one'), 'loopback-one');
  // A trailing hyphen IS accepted, because F062.1's CONNECTOR_ID grammar
  // permits it. Asserted rather than quietly tightened: F062.2B must not
  // enforce a stricter key rule than the contract layer, or the database and
  // the contract would disagree about what a valid connector key is.
  assert.equal(assertConnectorKey('trailing-'), 'trailing-');
  for (const bad of [
    '',
    'ab',
    'A-bad',
    '1leading',
    'has_underscore',
    'has.dot',
  ])
    assert.equal(
      refusalCode(() => assertConnectorKey(bad)),
      'connector_key_invalid',
      `${JSON.stringify(bad)} must be refused`,
    );
});

test('connector kinds are a closed provider-neutral vocabulary', () => {
  for (const kind of connectorKinds)
    assert.equal(assertConnectorKind(kind), kind);
  assert.equal(
    refusalCode(() => assertConnectorKind('unknown_kind')),
    'connector_kind_invalid',
  );
});

test('an unknown operation, a repeat or an unknown enum value is refused', () => {
  assert.equal(
    refusalCode(() =>
      assertCapabilities({
        ...NO_CAPABILITIES,
        operations: ['notAnOperation'] as never,
      }),
    ),
    'capability_contract_invalid',
  );
  assert.equal(
    refusalCode(() =>
      assertCapabilities({
        ...NO_CAPABILITIES,
        operations: ['createRequest', 'createRequest'],
      }),
    ),
    'capability_contract_invalid',
  );
  assert.equal(
    refusalCode(() =>
      assertCapabilities({
        ...NO_CAPABILITIES,
        supportsOrdering: 'global' as never,
      }),
    ),
    'capability_contract_invalid',
  );
  assert.equal(
    refusalCode(() =>
      assertCapabilities({
        ...NO_CAPABILITIES,
        sideEffectRisk: 'catastrophic' as never,
      }),
    ),
    'capability_contract_invalid',
  );
});

test('a valid contract over every declared operation is accepted', () => {
  const capabilities: ConnectorCapabilities = {
    ...NO_CAPABILITIES,
    operations: [...connectorOperations],
  };
  assert.equal(assertCapabilities(capabilities), capabilities);
  for (const ordering of orderingGuarantees)
    assert.ok(
      assertCapabilities({ ...NO_CAPABILITIES, supportsOrdering: ordering }),
    );
  for (const risk of sideEffectRisks)
    assert.ok(assertCapabilities({ ...NO_CAPABILITIES, sideEffectRisk: risk }));
});

test('capability difference is detected per field and ignores operation order', () => {
  assert.equal(capabilitiesDiffer(NO_CAPABILITIES, NO_CAPABILITIES), false);
  assert.equal(
    capabilitiesDiffer(
      { ...NO_CAPABILITIES, operations: ['createRequest', 'getRequest'] },
      { ...NO_CAPABILITIES, operations: ['getRequest', 'createRequest'] },
    ),
    false,
    'operation order is not a semantic change',
  );
  assert.equal(
    capabilitiesDiffer(NO_CAPABILITIES, {
      ...NO_CAPABILITIES,
      supportsIdempotencyKey: true,
    }),
    true,
  );
  assert.equal(
    capabilitiesDiffer(NO_CAPABILITIES, {
      ...NO_CAPABILITIES,
      sideEffectRisk: 'none',
    }),
    true,
  );
  // Every boolean field independently constitutes a change, so none can be
  // altered without advancing the revision.
  for (const [key, value] of Object.entries(NO_CAPABILITIES)) {
    if (typeof value !== 'boolean') continue;
    assert.equal(
      capabilitiesDiffer(NO_CAPABILITIES, {
        ...NO_CAPABILITIES,
        [key]: !value,
      }),
      true,
      `${key} must be revision-significant`,
    );
  }
});

test('the credential reference grammar refuses shapes a reference should not take', () => {
  // Explicitly NOT a secret detector: no check can decide whether a string is
  // secret. Non-secrecy is a contract this slice keeps by never resolving or
  // interpreting the value. These are defence-in-depth against an accidental
  // paste.
  assert.equal(assertCredentialReference(null), null);
  assert.equal(
    assertCredentialReference('reqro/integration/loopback'),
    'reqro/integration/loopback',
  );
  for (const bad of [
    'https://vault.example/secret',
    'has whitespace',
    'sk-0123456789abcdef0123456789abcdef0123',
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    '-leading-dash',
  ])
    assert.equal(
      refusalCode(() => assertCredentialReference(bad)),
      'credential_reference_invalid',
      `${JSON.stringify(bad)} must be refused as a credential reference`,
    );
});

test('only a credential rotation leaves the configuration revision unchanged', () => {
  assert.deepEqual(
    connectorChangeCategories.filter(
      (category) => !advancesConfigurationRevision(category),
    ),
    ['credential_reference_rotated'],
  );
  for (const category of connectorChangeCategories)
    assert.equal(
      advancesConfigurationRevision(category),
      category !== 'credential_reference_rotated',
    );
});

test('every change category advances the record revision, without exception', () => {
  // This is the property that makes record_revision usable as the concurrency
  // token. If any category could leave it unchanged, two concurrent mutations
  // of that kind could both satisfy the same expected-revision predicate and
  // the later write would silently overwrite the earlier.
  for (const category of connectorChangeCategories)
    assert.equal(
      advancesRecordRevision(category),
      true,
      category + ' must advance the record revision',
    );
  assert.equal(
    connectorChangeCategories.filter(
      (category) => !advancesRecordRevision(category),
    ).length,
    0,
  );
  // And the two rules are genuinely different: exactly one category advances
  // the record revision without advancing the configuration revision.
  assert.deepEqual(
    connectorChangeCategories.filter(
      (category) =>
        advancesRecordRevision(category) &&
        !advancesConfigurationRevision(category),
    ),
    ['credential_reference_rotated'],
  );
});

test('the refusal vocabulary is closed and distinguishes no tenant existence', () => {
  assert.deepEqual([...connectorMetadataRefusals].sort(), [
    'capability_contract_invalid',
    'change_not_permitted',
    'connector_key_duplicate',
    'connector_key_invalid',
    'connector_kind_invalid',
    'connector_unknown',
    'credential_reference_invalid',
    'lifecycle_transition_unsupported',
    'organization_unavailable',
    'revision_stale',
  ]);
  // There is deliberately no separate "belongs to another Organization" code:
  // distinguishing it would confirm another tenant's connector exists.
  assert.equal(
    connectorMetadataRefusals.some((code) => /other|foreign|cross/.test(code)),
    false,
  );
});

// ---------------------------------------------------------------------------
// Source boundary: the slice stayed inside its authorized scope
// ---------------------------------------------------------------------------

test('no vendor or destination product name appears in executable code', () => {
  const vendors = [
    'vueworks',
    'cityworks',
    'cartegraph',
    'opengov',
    'trimble',
    'vistashare',
    'bluedag',
    'impresa',
    'azure',
    'microsoft',
    'entra',
    'mgo',
    'salesforce',
    'servicenow',
  ];
  for (const path of F062_2B_SOURCES) {
    const code = executable(read(path)).toLowerCase();
    for (const vendor of vendors)
      assert.equal(
        code.includes(vendor),
        false,
        `${path} names the vendor ${vendor} in executable code`,
      );
  }
});

test('no network client, transport or outbound call is reachable', () => {
  const forbidden = [
    'fetch(',
    'XMLHttpRequest',
    'node:http',
    'node:https',
    'node:net',
    'node:dns',
    'node:tls',
    'axios',
    'got(',
    'undici',
    'WebSocket',
    'amqp',
    'kafka',
    'servicebus',
    'sqs',
  ];
  for (const path of F062_2B_SOURCES) {
    const code = executable(read(path));
    for (const token of forbidden)
      assert.equal(code.includes(token), false, `${path} reaches ${token}`);
  }
});

test('no secret, token or credential value is read or stored', () => {
  // `credential_reference` is permitted and is a locator; the words that would
  // indicate a secret VALUE are not.
  const forbidden = [
    'process.env',
    'apiKey',
    'api_key',
    'clientSecret',
    'client_secret',
    'accessToken',
    'access_token',
    'refreshToken',
    'refresh_token',
    'password',
    'authorization',
    'bearer',
  ];
  for (const path of F062_2B_SOURCES) {
    const code = executable(read(path));
    for (const token of forbidden)
      assert.equal(
        code.toLowerCase().includes(token.toLowerCase()),
        false,
        `${path} references ${token}`,
      );
  }
});

test('no worker, scheduler or background process exists in this slice', () => {
  const forbidden = [
    'setInterval',
    'setTimeout',
    'setImmediate',
    'Worker',
    'child_process',
    'cron',
    '@nestjs/schedule',
    'OnApplicationBootstrap',
    'skip locked',
    'SKIP LOCKED',
  ];
  for (const path of F062_2B_SOURCES) {
    const code = executable(read(path));
    for (const token of forbidden)
      assert.equal(code.includes(token), false, `${path} contains ${token}`);
  }
});

test('no outbox, delivery attempt, inbox, external reference or reconciliation table is created', () => {
  const migration = read(resolve(MIGRATIONS, MIGRATION));
  const created = [...migration.matchAll(/create table ([a-z_]+)/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    created.sort(),
    ['integration_connector', 'integration_connector_audit'],
    'this slice creates exactly the two connector tables',
  );
  for (const table of [
    'integration_outbox',
    'integration_delivery_attempt',
    'integration_inbox',
    'integration_external_reference',
    'integration_reconciliation_finding',
  ])
    assert.equal(
      migration.includes(table),
      false,
      `${table} must not appear in the F062.2B migration`,
    );
});

test('the migration grants nothing and alters no existing table', () => {
  const code = executable(read(resolve(MIGRATIONS, MIGRATION)));
  for (const token of [
    'grant ',
    'revoke ',
    'alter table',
    'create role',
    'drop column',
  ])
    assert.equal(
      code.toLowerCase().includes(token),
      false,
      `the F062.2B migration must not contain ${token}`,
    );
});

test('persistence is not reachable from the F062.1 contracts entry point', () => {
  // F062.1's boundary suite asserts the graph from src/integration/index.ts
  // has an empty external import set. Persistence necessarily imports Kysely
  // and Nest, so the entry point must not reach it; this keeps that proof
  // intact instead of widening its allowlist.
  const entry = read(resolve(SRC, 'integration/index.ts'));
  assert.equal(
    entry.includes('persistence'),
    false,
    'src/integration/index.ts must not export the persistence layer',
  );
  // And the dependency runs one way: no contract module imports persistence.
  for (const module of [
    'connector-capabilities.ts',
    'delivery-contract.ts',
    'integration-envelope.ts',
    'fact-authority.ts',
    'schema-compatibility.ts',
    'connector-registry.ts',
    'integration-telemetry.ts',
    'index.ts',
  ])
    assert.equal(
      read(resolve(SRC, 'integration', module)).includes('persistence/'),
      false,
      `${module} must not import the persistence layer`,
    );
});

test('the domain contract module itself stays free of database dependencies', () => {
  // Validation and vocabulary must be testable without a database, which is
  // why the contract module is separate from the repository.
  const code = read(
    resolve(SRC, 'integration/persistence/connector-metadata.ts'),
  );
  for (const token of [
    'kysely',
    '@nestjs',
    'DatabaseService',
    'database.types',
  ])
    assert.equal(
      code.includes(token),
      false,
      `connector-metadata.ts must not depend on ${token}`,
    );
});
