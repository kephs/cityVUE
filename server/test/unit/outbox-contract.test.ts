import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  contractKindOf,
  INTEGRATION_TYPES,
  type IntegrationType,
} from '../../src/integration/integration-envelope.js';
import { deliveryStates } from '../../src/integration/delivery-contract.js';
import {
  assertEnqueueable,
  enqueueableIntegrationTypes,
  enqueueablePayloadModes,
  INITIAL_DELIVERY_STATE,
  isEnqueueablePayloadMode,
  outboxRefusals,
  OutboxRefusal,
  payloadModes,
  requiredPayloadMode,
  type EnqueueIntentInput,
} from '../../src/integration/persistence/outbox.js';

/**
 * F062.2C — outbox contract and source-boundary tests.
 *
 * The contract tests prove the enqueue policy behaves as specified; the source
 * tests prove the slice stayed inside its authorized scope, over executable
 * code with comments and string literals removed so a stated prohibition does
 * not flag its own documentation.
 */

const SRC = resolve(__dirname, '../../../src');
const MIGRATIONS = resolve(__dirname, '../../../migrations');
const MIGRATION = '20261021000000-add-integration-outbox.ts';

const F062_2C_SOURCES = [
  resolve(SRC, 'integration/persistence/outbox.ts'),
  resolve(SRC, 'integration/persistence/outbox.repository.ts'),
  resolve(MIGRATIONS, MIGRATION),
];

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function executable(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\r\n]*/g, '$1 ')
    .replace(/'(?:[^'\\\r\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\r\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

function input(
  overrides: Partial<EnqueueIntentInput> = {},
): EnqueueIntentInput {
  return {
    organizationId: '00000000-0000-4000-8000-000000000001',
    connectorId: '00000000-0000-4000-8000-000000000002',
    integrationId: '00000000-0000-4000-8000-000000000003',
    integrationType: 'work_item.sync_requested',
    aggregateId: '00000000-0000-4000-8000-000000000004',
    aggregateRevision: 1,
    origin: { kind: 'reqro' },
    correlationId: '00000000-0000-4000-8000-000000000005',
    causationId: null,
    deploymentEnvironment: 'development',
    occurredAt: new Date('2026-10-10T00:00:00.000Z'),
    ...overrides,
  };
}

function refusalCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof OutboxRefusal, String(error));
    return error.code;
  }
  throw new Error('expected a refusal');
}

// ---------------------------------------------------------------------------
// Payload-mode policy
// ---------------------------------------------------------------------------

test('exactly one payload mode is enqueueable, and it is the projection mode', () => {
  assert.deepEqual(enqueueablePayloadModes, ['current_state_projection']);
  assert.equal(isEnqueueablePayloadMode('current_state_projection'), true);
  assert.equal(isEnqueueablePayloadMode('historical_reference'), false);
  assert.equal(isEnqueueablePayloadMode('approved_snapshot'), false);
  // The vocabulary still names all three, so the policy is visible rather
  // than hidden by omission.
  assert.deepEqual([...payloadModes].sort(), [
    'approved_snapshot',
    'current_state_projection',
    'historical_reference',
  ]);
});

test('a state_sync kind requires the projection mode and an event requires a historical basis', () => {
  assert.equal(requiredPayloadMode('state_sync'), 'current_state_projection');
  assert.equal(requiredPayloadMode('event'), 'historical_reference');
});

test('no declared event type is enqueueable, and the one state_sync type is', () => {
  // F062.2A measured that no declared event type has proven historical
  // reconstructability. The consequence is enforced here rather than trusted.
  const enqueueable = enqueueableIntegrationTypes();
  assert.deepEqual(enqueueable, ['work_item.sync_requested']);
  for (const type of Object.keys(INTEGRATION_TYPES) as IntegrationType[]) {
    const expected = contractKindOf(type) === 'state_sync';
    assert.equal(
      enqueueable.includes(type),
      expected,
      `${type} enqueueability must follow its contract kind`,
    );
  }
});

test('every event type is refused with payload_mode_unavailable', () => {
  for (const type of Object.keys(INTEGRATION_TYPES) as IntegrationType[]) {
    if (contractKindOf(type) !== 'event') continue;
    assert.equal(
      refusalCode(() =>
        assertEnqueueable(
          input({ integrationType: type, aggregateRevision: 7 }),
        ),
      ),
      'payload_mode_unavailable',
      `${type} must be refused`,
    );
  }
});

// ---------------------------------------------------------------------------
// Contract derivation and parity
// ---------------------------------------------------------------------------

test('the contract is derived from F062.1, never supplied by the caller', () => {
  const resolved = assertEnqueueable(input());
  const declared = INTEGRATION_TYPES['work_item.sync_requested'];
  assert.deepEqual(resolved, {
    contractKind: declared.kind,
    aggregateType: declared.aggregate,
    schemaVersion: declared.schemaVersion,
    payloadMode: 'current_state_projection',
  });
  // The input type deliberately has no contractKind, aggregateType or
  // schemaVersion field, so relabelling is not expressible at the call site.
  for (const field of [
    'contractKind',
    'aggregateType',
    'schemaVersion',
    'state',
  ])
    assert.equal(
      Object.hasOwn(input(), field),
      false,
      `EnqueueIntentInput must not accept ${field}`,
    );
});

test('an unknown integration type is refused before anything is derived from it', () => {
  assert.equal(
    refusalCode(() =>
      assertEnqueueable(
        input({ integrationType: 'service_request.invented' as never }),
      ),
    ),
    'integration_type_unknown',
  );
});

test('the initial delivery state is pending and is part of the F062.1 vocabulary', () => {
  assert.equal(INITIAL_DELIVERY_STATE, 'pending');
  assert.ok(
    (deliveryStates as readonly string[]).includes(INITIAL_DELIVERY_STATE),
  );
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

test('the deployment environment must match the F062.1 grammar', () => {
  for (const bad of [
    '',
    'ab',
    'Production',
    '1env',
    'has space',
    'has_underscore',
  ])
    assert.equal(
      refusalCode(() =>
        assertEnqueueable(input({ deploymentEnvironment: bad })),
      ),
      'environment_invalid',
      `${JSON.stringify(bad)} must be refused`,
    );
  assert.ok(assertEnqueueable(input({ deploymentEnvironment: 'production' })));
});

test('an external origin must name its connector', () => {
  assert.equal(
    refusalCode(() =>
      assertEnqueueable(
        input({ origin: { kind: 'external', connectorId: '' } }),
      ),
    ),
    'origin_invalid',
  );
  assert.ok(
    assertEnqueueable(
      input({ origin: { kind: 'external', connectorId: 'loopback-one' } }),
    ),
  );
});

test('a state_sync intent does not require an aggregate revision', () => {
  // Only an immutable event asserts something happened at a revision. A
  // desired-state intent converges on what is true now.
  assert.ok(assertEnqueueable(input({ aggregateRevision: null })));
});

test('the refusal vocabulary is closed and leaks no tenant existence', () => {
  assert.deepEqual([...outboxRefusals].sort(), [
    'aggregate_mismatch',
    'aggregate_revision_required',
    'connector_retired',
    'connector_revision_stale',
    'connector_unknown',
    'contract_kind_mismatch',
    'delivery_state_not_caller_controlled',
    'environment_invalid',
    'integration_type_unknown',
    'intent_duplicate',
    'origin_invalid',
    'payload_mode_mismatch',
    'payload_mode_unavailable',
    'schema_version_mismatch',
  ]);
  assert.equal(
    outboxRefusals.some((code) => /other|foreign|cross|tenant/.test(code)),
    false,
  );
});

// ---------------------------------------------------------------------------
// Source boundary
// ---------------------------------------------------------------------------

test('the enqueue primitive takes the caller transaction and opens none of its own', () => {
  const source = read(
    resolve(SRC, 'integration/persistence/outbox.repository.ts'),
  );
  // The signature is the mechanism: a transaction parameter, not an injected
  // client. Without it, a business mutation and its intent could not commit
  // together, which is the whole purpose of the slice.
  assert.match(
    source,
    /export async function enqueueIntegrationIntent\(\s*transaction: Kysely<DatabaseSchema>,/,
    'enqueueIntegrationIntent must accept the caller transaction as its first parameter',
  );
  const code = executable(source);
  // No independent transaction anywhere in the module.
  assert.equal(
    code.includes('.transaction()'),
    false,
    'the outbox repository must never open its own transaction',
  );
  // And the enqueue path must not reach the shared client. Only the read-only
  // evidence methods on the class may, and they are reads.
  const enqueueBody = executable(
    source.slice(
      source.indexOf('export async function enqueueIntegrationIntent'),
    ),
  );
  assert.equal(
    enqueueBody.includes('this.database'),
    false,
    'enqueue must not use an injected database connection',
  );
  // Every query in the enqueue path is rooted on the caller transaction.
  // Counting is the robust form: if a query were ever rooted anywhere else,
  // the query count would exceed the transaction-rooted count.
  const queries = [...enqueueBody.matchAll(/\.(insertInto|selectFrom)\(/g)]
    .length;
  const rooted = [
    ...enqueueBody.matchAll(/transaction\s*\.\s*(insertInto|selectFrom)\(/g),
  ].length;
  assert.ok(queries > 0, 'the enqueue path must issue at least one query');
  assert.equal(
    rooted,
    queries,
    'every enqueue-path query must be rooted on the caller transaction',
  );
});

test('no update or delete primitive over the outbox exists', () => {
  const code = executable(
    read(resolve(SRC, 'integration/persistence/outbox.repository.ts')),
  );
  for (const token of ['updateTable', 'deleteFrom'])
    assert.equal(
      code.includes(token),
      false,
      `the outbox repository must expose no ${token}`,
    );
});

test('no worker, scan, claim, retry or dead-letter surface exists', () => {
  const forbidden = [
    'skip locked',
    'SKIP LOCKED',
    'claim_token',
    'claim_generation',
    'claimed_by',
    'claimed_until',
    'attempt_count',
    'next_attempt_at',
    'integration_delivery_attempt',
    'setInterval',
    'setTimeout',
    'setImmediate',
    'cron',
    '@nestjs/schedule',
    'OnApplicationBootstrap',
    'dead_letter',
  ];
  for (const path of F062_2C_SOURCES) {
    const code = executable(read(path));
    for (const token of forbidden)
      assert.equal(code.includes(token), false, `${path} contains ${token}`);
  }
});

test('no network client, broker or vendor SDK is reachable', () => {
  const forbidden = [
    'fetch(',
    'XMLHttpRequest',
    'node:http',
    'node:https',
    'node:net',
    'node:dns',
    'node:tls',
    'axios',
    'undici',
    'WebSocket',
    'amqp',
    'kafka',
    'servicebus',
    'sqs',
  ];
  for (const path of F062_2C_SOURCES) {
    const code = executable(read(path));
    for (const token of forbidden)
      assert.equal(code.includes(token), false, `${path} reaches ${token}`);
  }
});

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
  for (const path of F062_2C_SOURCES) {
    const code = executable(read(path)).toLowerCase();
    for (const vendor of vendors)
      assert.equal(code.includes(vendor), false, `${path} names ${vendor}`);
  }
});

test('no credential or secret access exists', () => {
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
    'credential_reference',
  ];
  for (const path of F062_2C_SOURCES) {
    const code = executable(read(path)).toLowerCase();
    for (const token of forbidden)
      assert.equal(
        code.includes(token.toLowerCase()),
        false,
        `${path} references ${token}`,
      );
  }
});

test('no F061 telemetry SDK dependency enters persistence', () => {
  const forbidden = [
    '@opentelemetry',
    'opentelemetry',
    'applicationinsights',
    'OTLP',
    'metricLabels',
    'validateMetricLabels',
  ];
  for (const path of F062_2C_SOURCES) {
    const code = executable(read(path));
    for (const token of forbidden)
      assert.equal(code.includes(token), false, `${path} references ${token}`);
  }
});

test('no production domain service is wired to the outbox', () => {
  // The slice proves the mechanism, not the product event policy. Each real
  // producer needs its own payload and authority review.
  const callers = ['enqueueIntegrationIntent', 'outbox.repository'];
  const domains = [
    'service-request',
    'catalog',
    'attachments',
    'admin',
    'resident-experience',
    'alerts',
    'access',
    'ai',
    'notifications',
    'tenancy',
    'auth',
    'geospatial',
    'location-eligibility',
    'health',
  ];
  for (const domain of domains) {
    const base = resolve(SRC, domain);
    let entries: string[];
    try {
      entries = listFiles(base);
    } catch {
      // A domain directory that does not exist is not a finding.
      continue;
    }
    for (const file of entries) {
      const code = read(file);
      for (const caller of callers)
        assert.equal(
          code.includes(caller),
          false,
          `${file} must not reference ${caller}`,
        );
    }
  }
});

test('the outbox is not reachable from the F062.1 contracts entry point', () => {
  const entry = read(resolve(SRC, 'integration/index.ts'));
  assert.equal(
    entry.includes('persistence'),
    false,
    'src/integration/index.ts must not export persistence',
  );
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
      `${module} must not import persistence`,
    );
});

test('the outbox contract module stays free of database dependencies', () => {
  const code = read(resolve(SRC, 'integration/persistence/outbox.ts'));
  for (const token of [
    'kysely',
    '@nestjs',
    'DatabaseService',
    'database.types',
  ])
    assert.equal(
      code.includes(token),
      false,
      `outbox.ts must not depend on ${token}`,
    );
});

test('the migration creates only the outbox table and grants nothing', () => {
  const migration = read(resolve(MIGRATIONS, MIGRATION));
  const created = [...migration.matchAll(/create table ([a-z_]+)/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(created, ['integration_outbox']);
  const code = executable(migration);
  for (const token of ['grant ', 'revoke ', 'create role', 'drop column'])
    assert.equal(
      code.toLowerCase().includes(token),
      false,
      `the migration must not contain ${token}`,
    );
  // It alters no existing table: the only ALTER-shaped statement permitted is
  // the lock it takes on integration_connector.
  assert.equal(
    /alter table/i.test(code),
    false,
    'the migration must not alter an existing table',
  );
});

function listFiles(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = resolve(directory, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}
