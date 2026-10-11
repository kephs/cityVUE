import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  deliveryStates,
  deliveryStateTransitions,
  mayTransitionDeliveryState,
  terminalDeliveryStates,
  transitionCapabilityPreconditions,
  type DeliveryState,
} from '../../src/integration/delivery-contract.js';

/**
 * F062.2D-2A — the non-age transition contract, and the source boundary of the
 * slice that mirrors it into SQL.
 *
 * The database-side parity assertions live in
 * `test/database/integration-delivery-attempt.integration.test.ts`, because
 * they need a live `pg_constraint`. These are the contract-side properties and
 * the scope assertions, which need no database.
 */

const MIGRATIONS = resolve(__dirname, '../../../migrations');
const MIGRATION = '20261022000000-add-integration-delivery-attempt.ts';

function migration(): string {
  return readFileSync(resolve(MIGRATIONS, MIGRATION), 'utf8');
}

/** Executable SQL and plpgsql only: comments stripped, so a prohibition
 * stated in a comment does not flag itself. */
function executable(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\r\n]*/g, '$1 ')
    .replace(/(^|\n)\s*--[^\r\n]*/g, '$1 ');
}

// ---------------------------------------------------------------------------
// The transition contract
// ---------------------------------------------------------------------------

test('the transition table covers exactly the F062.1 delivery states', () => {
  assert.deepEqual(
    Object.keys(deliveryStateTransitions).sort(),
    [...deliveryStates].sort(),
  );
  for (const [from, targets] of Object.entries(deliveryStateTransitions))
    for (const target of targets)
      assert.ok(
        (deliveryStates as readonly string[]).includes(target),
        `${from} -> ${target} names a state F062.1 does not define`,
      );
});

test('states with no outgoing edge are exactly the terminal states', () => {
  const withoutEdges = deliveryStates.filter(
    (state) => deliveryStateTransitions[state].length === 0,
  );
  assert.deepEqual(
    [...withoutEdges].sort(),
    [...terminalDeliveryStates].sort(),
    'terminal classification and the edge table must agree',
  );
});

test('no transition targets pending except none, and no state transitions to itself', () => {
  for (const state of deliveryStates) {
    assert.equal(
      mayTransitionDeliveryState(state, state),
      false,
      `${state} must not transition to itself`,
    );
    // `dead_lettered -> pending` is the authorized replay edge, and it is
    // deliberately absent until replay authorization evidence exists.
    assert.equal(
      mayTransitionDeliveryState(state, 'pending'),
      false,
      `${state} -> pending must not be reachable in this slice`,
    );
  }
});

test('the four named prohibitions hold', () => {
  // Asserted by name as well as by the sweep, so a regression report says
  // which rule broke.
  assert.equal(mayTransitionDeliveryState('accepted', 'pending'), false);
  assert.equal(mayTransitionDeliveryState('acknowledged', 'pending'), false);
  assert.equal(
    mayTransitionDeliveryState('dead_lettered', 'dispatching'),
    false,
  );
  // ambiguous -> dispatching exists as a pair but is capability-gated.
  assert.equal(mayTransitionDeliveryState('ambiguous', 'dispatching'), true);
  assert.ok(
    transitionCapabilityPreconditions.some(
      (p) =>
        p.from === 'ambiguous' &&
        p.to === 'dispatching' &&
        p.requires === 'supportsIdempotencyKey',
    ),
    'ambiguous -> dispatching must require idempotency support',
  );
});

test('acknowledged is reachable only behind reportsTerminalState', () => {
  const sources = deliveryStates.filter((state) =>
    mayTransitionDeliveryState(state, 'acknowledged'),
  );
  assert.deepEqual(sources, ['accepted']);
  assert.ok(
    transitionCapabilityPreconditions.some(
      (p) =>
        p.from === 'accepted' &&
        p.to === 'acknowledged' &&
        p.requires === 'reportsTerminalState',
    ),
    'ADR-026 forbids implying delivery no transport confirmed',
  );
});

test('every capability precondition names a declared pair', () => {
  for (const precondition of transitionCapabilityPreconditions)
    assert.ok(
      mayTransitionDeliveryState(precondition.from, precondition.to),
      `${precondition.from} -> ${precondition.to} is gated but not declared`,
    );
});

test('dispatching is the only state reachable from a retry path', () => {
  // Retrying must lead back into dispatch or to a terminal state, never
  // sideways into another unsettled state.
  assert.deepEqual([...deliveryStateTransitions.retrying].sort(), [
    'dead_lettered',
    'dispatching',
  ]);
});

// ---------------------------------------------------------------------------
// Scope: what this slice must not contain
// ---------------------------------------------------------------------------

test('the migration encodes no age threshold of any kind', () => {
  const code = executable(migration()).toLowerCase();
  for (const token of [
    'interval',
    'pending_age',
    'age_exceeded',
    'max_pending',
    'now() -',
    'clock_timestamp() -',
    ' age(',
  ])
    assert.equal(
      code.includes(token),
      false,
      `the migration references ${token}, which would be an age predicate`,
    );
});

test('the migration creates no worker-facing callable API', () => {
  const code = executable(migration());
  for (const token of [
    'claim_integration_intent',
    'complete_integration_attempt',
    'recover_expired_integration_claim',
    'security definer',
    'reqro_integration_api',
    'reqro_integration_worker',
    'reqro_integration_function_owner',
  ])
    assert.equal(
      code.toLowerCase().includes(token.toLowerCase()),
      false,
      `the migration contains ${token}, which belongs to a later slice`,
    );
});

test('the migration grants nothing and creates no role', () => {
  const code = executable(migration()).toLowerCase();
  for (const token of [
    'grant ',
    'revoke ',
    'create role',
    'alter role',
    'create schema',
  ])
    assert.equal(
      code.includes(token),
      false,
      `the migration contains ${token}`,
    );
});

test('the migration creates exactly one table and adds no outbox column', () => {
  const source = migration();
  const created = [...source.matchAll(/create table ([a-z_]+)/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(created, ['integration_delivery_attempt']);
  // Safe for existing rows by construction: no column is added anywhere.
  assert.equal(
    /alter table [a-z_]+\s+add column/i.test(source),
    false,
    'no column may be added to an existing table',
  );
  // The only table ALTERed is integration_outbox, and only to replace and
  // restore the one named constraint.
  const altered = new Set(
    [...source.matchAll(/alter table ([a-z_]+)/gi)].flatMap((m) =>
      m[1] === undefined ? [] : [m[1]],
    ),
  );
  assert.deepEqual([...altered], ['integration_outbox']);
  assert.equal(
    (source.match(/drop constraint integration_outbox_state_inert/g) ?? [])
      .length,
    1,
  );
  assert.equal(
    (source.match(/add constraint integration_outbox_state_inert/g) ?? [])
      .length,
    1,
  );
});

test('the inert guard is replaced and restored by its exact object name', () => {
  const source = migration();
  assert.match(
    source,
    /alter table integration_outbox drop constraint integration_outbox_state_inert;/,
    'the inert constraint must be dropped by name',
  );
  assert.match(
    source,
    /add constraint integration_outbox_state_inert check \(state = 'pending'\)/,
    'rollback must restore the inert constraint by name',
  );
});

test('rollback drops only objects this migration owns', () => {
  const source = migration();
  const downBody = source.slice(source.indexOf('export async function down'));
  const dropped = [
    ...downBody.matchAll(
      /drop (table|function|index|trigger|type) (if exists )?([a-z_]+)/g,
    ),
  ].flatMap((m) =>
    m[1] === undefined || m[3] === undefined ? [] : [m[1] + ' ' + m[3]],
  );
  assert.deepEqual(dropped.sort(), [
    'function guard_integration_delivery_attempt',
    'table integration_delivery_attempt',
  ]);
  // Earlier migrations' shared objects are never dropped.
  for (const shared of [
    'guard_integration_outbox',
    'guard_integration_connector',
    'integration_outbox',
    'integration_connector',
    'integration_connector_audit',
  ])
    assert.equal(
      new RegExp('drop (table|function) (if exists )?' + shared).test(downBody),
      false,
      `rollback must not drop ${shared}`,
    );
});

test('no raw claim token can be produced or persisted by the migration', () => {
  const code = executable(migration());
  // Nothing generates a token, and the only token-named column is a digest.
  for (const token of [
    'gen_random_bytes',
    'random()',
    'claim_token ',
    'claim_token,',
  ])
    assert.equal(
      code.includes(token),
      false,
      `the migration references ${token}`,
    );
  assert.match(code, /claim_token_digest char\(64\)/);
  assert.match(code, /\^\[0-9a-f\]\{64\}\$/);
});

test('no network, vendor or secret behaviour exists in the migration', () => {
  const code = executable(migration()).toLowerCase();
  for (const token of [
    'http',
    'fetch',
    'curl',
    'dblink',
    'postgres_fdw',
    'copy from program',
    'credential',
    'secret',
    'vueworks',
    'cityworks',
    'bluedag',
    'impresa',
    'azure',
    'microsoft',
    'mgo',
  ])
    assert.equal(
      code.includes(token),
      false,
      `the migration references ${token}`,
    );
});

test('the attempt table stores no response body, vendor text or resident value', () => {
  const code = executable(migration()).toLowerCase();
  for (const token of [
    'response_body',
    'error_message',
    'vendor_',
    'raw_',
    'http_status',
    'resident',
    'email',
    'phone',
    'address',
  ])
    assert.equal(
      code.includes(token),
      false,
      `the attempt table carries ${token}`,
    );
});

test('the transition whitelist in SQL matches the TypeScript table pair for pair', () => {
  // A source-level cross-check that complements the live pg_constraint
  // assertions: every declared edge appears in the migration's whitelist, and
  // the whitelist names no pair the contract omits.
  const code = executable(migration());
  const whitelist = code.slice(
    code.indexOf("OLD.state = 'pending'"),
    code.indexOf('Unsupported integration delivery state transition'),
  );
  assert.ok(whitelist.length > 0, 'the whitelist must be locatable');
  for (const from of deliveryStates) {
    const targets = deliveryStateTransitions[from];
    if (targets.length === 0) {
      assert.equal(
        whitelist.includes(`OLD.state = '${from}'`),
        false,
        `${from} is terminal and must not appear as a transition source`,
      );
      continue;
    }
    assert.ok(
      whitelist.includes(`OLD.state = '${from}'`),
      `${from} must appear as a transition source`,
    );
    for (const to of targets)
      assert.ok(
        whitelist.includes(`'${to}'`),
        `${from} -> ${to} must appear in the SQL whitelist`,
      );
  }
  // And the whitelist mentions no state outside the vocabulary.
  for (const quoted of whitelist.matchAll(/'([a-z_]+)'/g))
    assert.ok(
      (deliveryStates as readonly string[]).includes(
        quoted[1] as DeliveryState,
      ),
      `the SQL whitelist names ${String(quoted[1])}, which F062.1 does not define`,
    );
});
