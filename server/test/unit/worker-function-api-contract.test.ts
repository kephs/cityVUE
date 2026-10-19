import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  attemptOutcomes,
  deliveryStates,
  dispatchingLifecycleStates,
  mayTransitionDeliveryState,
  type DeliveryState,
} from '../../src/integration/delivery-contract.js';
import {
  integrationFailureCategories,
  transientIntegrationFailures,
} from '../../src/integration/integration-envelope.js';

/**
 * F062.2D-2B — the source boundary of the worker database function API.
 *
 * The behavioural proofs live in
 * `test/database/integration-worker-functions.integration.test.ts` and the
 * privilege proofs in `test/database/database-role-separation.integration.test.ts`.
 * These are the assertions that need no database: what the migration and the
 * two provisioning artifacts may and may not contain.
 */

const MIGRATIONS = resolve(__dirname, '../../../migrations');
const MIGRATION = '20261023000000-add-integration-worker-function-api.ts';
/** F062.2D-2C-3A's Migration 56 hardcodes `public.` for the same reason
 * Migration 53 does, so the same import prohibition applies to it. */
const HARDENING =
  '20261026000000-harden-integration-worker-claim-dispatch-api.ts';
/** Every migration that hardcodes `public.` and is therefore applied as
 * rewritten text. Adding one here extends the guard below to it. */
const HARDCODED_PUBLIC = [MIGRATION, HARDENING];
const DEPLOY = resolve(__dirname, '../../../../deploy/database');

function migration(): string {
  return readFileSync(resolve(MIGRATIONS, MIGRATION), 'utf8');
}

function artifact(name: string): string {
  return readFileSync(resolve(DEPLOY, name), 'utf8');
}

/** Executable SQL and plpgsql only: comments stripped, so a prohibition
 * stated in a comment does not flag itself. */
function executable(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\r\n]*/g, '$1 ')
    .replace(/(^|\n)\s*--[^\r\n]*/g, '$1 ');
}

/** The body of one `create function`, from its signature to the `$$` that
 * closes it. */
function functionBody(source: string, name: string): string {
  const at = source.indexOf(`create function reqro_integration_api.${name}(`);
  assert.notEqual(at, -1, `${name} must be created`);
  const body = source.slice(at);
  const end = body.indexOf('end $$;');
  assert.notEqual(end, -1, `${name} must be terminated`);
  return body.slice(0, end + 'end $$;'.length);
}

const FUNCTIONS = ['claim_integration_intent', 'complete_integration_attempt'];

// ---------------------------------------------------------------------------
// The function inventory
// ---------------------------------------------------------------------------

test('the migration creates exactly the two reviewed functions', () => {
  const code = executable(migration());
  const created = [
    ...code.matchAll(/create function ([a-z_]+)\.([a-z_]+)\(/g),
  ].map((match) => `${String(match[1])}.${String(match[2])}`);
  assert.deepEqual(created, [
    'reqro_integration_api.claim_integration_intent',
    'reqro_integration_api.complete_integration_attempt',
  ]);
  // No `create or replace`, which would silently redefine an existing
  // definer function rather than failing.
  assert.equal(/create or replace function/i.test(code), false);
});

test('the recovery function is deferred rather than stubbed', () => {
  const code = executable(migration());
  assert.equal(code.includes('recover_expired_integration_claim'), false);
  // And nothing stands in for it: no lease, no expiry, no caller-supplied
  // duration anywhere in executable SQL.
  for (const token of [
    'claimed_until',
    'lease',
    'expires_at',
    'expired',
    'interval',
    'lease_expired',
    // NOT 'timeout': down() sets lock_timeout, which bounds a lock wait and
    // is not a lease.
  ])
    assert.equal(
      code.toLowerCase().includes(token),
      false,
      `the migration references ${token}`,
    );
});

test('every function is hardened in source as well as in the catalogue', () => {
  const code = executable(migration());
  for (const name of FUNCTIONS) {
    const body = functionBody(code, name);
    assert.match(body, /language plpgsql volatile security definer/);
    // pg_catalog first, pg_temp LAST, and the application schema present
    // only so the nested integrity guards resolve; see the migration header.
    assert.match(body, /set search_path = pg_catalog, public, pg_temp/);
    // No caller-controlled object identifier, and no dynamic SQL: the DO
    // blocks that issue SET ROLE are outside every function body.
    assert.equal(/\bexecute\s+format\b/i.test(body), false, name);
    assert.equal(/\bexecute\s+'/i.test(body), false, name);
    assert.equal(body.includes('quote_ident'), false, name);
  }
});

// ---------------------------------------------------------------------------
// F062.2D-2B review hardening: the definer search_path contract
// ---------------------------------------------------------------------------

/**
 * F062.2D-1 recommended `pg_catalog, pg_temp`. Implementation evidence proved
 * that the accepted F062.2C and F062.2D-2A trigger guards resolve the
 * application schema unqualified while running inside these definer
 * functions, so the reviewed path for F062.2D-2B is
 * `pg_catalog, public, pg_temp`.
 *
 * The refinement is only as safe as its exact shape, so the shape is asserted
 * rather than described: `pg_catalog` first, so no schema can shadow a
 * built-in; `public` as the single trusted application schema and nothing
 * else; `pg_temp` last, so a session-local decoy relation is never resolved
 * first. The companion role-separation test proves the condition that makes
 * `public` trustworthy -- that no untrusted principal holds CREATE on it.
 */
test('both definer functions pin exactly pg_catalog, public, pg_temp', () => {
  const code = executable(migration());

  // Exactly one pin per function, and `search_path` appears nowhere else in
  // executable SQL -- so no later statement re-points a function at another
  // path, and neither function is left to inherit the caller's.
  const pins = [
    ...code.matchAll(/set\s+search_path\s*=\s*([^\n]*?)\s+as\s+\$\$/g),
  ].map((match) => match[1] ?? '');
  assert.equal(pins.length, FUNCTIONS.length);
  assert.equal(
    (code.match(/search_path/g) ?? []).length,
    FUNCTIONS.length,
    'executable SQL must mention search_path only in the two function pins',
  );

  for (const name of FUNCTIONS) {
    const body = functionBody(code, name);
    const pin =
      /set\s+search_path\s*=\s*([^\n]*?)\s+as\s+\$\$/.exec(body)?.[1] ?? '';
    assert.equal(pin, 'pg_catalog, public, pg_temp', `${name} search_path`);

    // Positional rather than merely textual: the ORDER is the security
    // property, so it is asserted element by element.
    const schemas = pin.split(',').map((entry) => entry.trim());
    assert.deepEqual(schemas, ['pg_catalog', 'public', 'pg_temp']);
    assert.equal(schemas[0], 'pg_catalog', `${name}: pg_catalog must be first`);
    assert.equal(
      schemas[schemas.length - 1],
      'pg_temp',
      `${name}: pg_temp must be last`,
    );
    assert.equal(
      schemas.indexOf('public'),
      1,
      `${name}: public must follow pg_catalog, never precede it`,
    );

    // The rejected shapes, named individually so a future edit cannot
    // reintroduce one quietly. The last is F062.2D-1's original
    // recommendation, which the nested guards made unusable.
    for (const rejected of [
      'public, pg_catalog, pg_temp',
      'pg_catalog, pg_temp, public',
      'pg_temp, pg_catalog, public',
      'public, pg_temp, pg_catalog',
      'pg_catalog, pg_temp',
    ])
      assert.notEqual(pin, rejected, `${name} uses a rejected search_path`);

    // No caller-controlled and no inherited path. `from current` would
    // freeze whatever path the migrating session happened to carry, and
    // set_config or current_schema inside the body would reintroduce
    // run-time resolution the pin exists to remove.
    assert.equal(/search_path\s+from\s+current/i.test(body), false, name);
    assert.equal(/set\s+search_path\s+to\s+default/i.test(body), false, name);
    assert.equal(/reset\s+search_path/i.test(body), false, name);
    assert.equal(/set_config\s*\(\s*'search_path'/i.test(body), false, name);
    assert.equal(/\bcurrent_schema\b/i.test(body), false, name);
  }

  // No fourth schema is admitted in either pin, under any ordering.
  for (const pin of pins)
    for (const entry of pin.split(',').map((value) => value.trim()))
      assert.ok(
        ['pg_catalog', 'public', 'pg_temp'].includes(entry),
        `${entry} must not appear in a SECURITY DEFINER search_path`,
      );
});

test('every application object inside a function body is schema qualified', () => {
  const code = executable(migration());
  const tables = [
    'integration_outbox',
    'integration_delivery_attempt',
    'integration_connector',
    'integration_connector_audit',
  ];
  for (const name of FUNCTIONS) {
    const body = functionBody(code, name);
    for (const table of tables) {
      // The lookbehind excludes a dotted prefix, so this counts only
      // UNQUALIFIED references, and the property is that there are none.
      const bare = (
        body.match(new RegExp(`(?<![a-z_.])${table}(?![a-z_])`, 'g')) ?? []
      ).length;
      const qualified = (
        body.match(new RegExp(`public\\.${table}(?![a-z_])`, 'g')) ?? []
      ).length;
      assert.equal(
        bare,
        0,
        `${name} references ${table} without the public. qualification`,
      );
      // And the table is genuinely referenced, so the check above is not
      // vacuous.
      if (name === 'claim_integration_intent')
        assert.ok(qualified > 0, `${name} must reference ${table}`);
    }
  }
  // The literal spelling matters, because the test harness rewrites it and
  // the deployment relies on it.
  assert.ok(code.includes('public.integration_outbox'));
  assert.ok(code.includes('public.integration_delivery_attempt'));
});

// ---------------------------------------------------------------------------
// Vocabulary parity with F062.1
// ---------------------------------------------------------------------------

test('the completion function mirrors F062.1 outcomes and categories exactly', () => {
  const body = functionBody(
    executable(migration()),
    'complete_integration_attempt',
  );
  for (const outcome of attemptOutcomes)
    assert.ok(body.includes(`'${outcome}'`), `${outcome} must appear`);
  for (const category of integrationFailureCategories)
    assert.ok(body.includes(`'${category}'`), `${category} must appear`);

  // The transient allowlist is exactly F062.1's, and destination_timeout is
  // deliberately outside it.
  const transient = body.slice(
    body.indexOf(
      "attempt_outcome = 'failed_transient' and attempt_failure_category",
    ),
  );
  const allowlist = transient.slice(0, transient.indexOf('then'));
  for (const category of transientIntegrationFailures)
    assert.ok(allowlist.includes(`'${category}'`), `${category} is transient`);
  assert.equal(allowlist.includes("'destination_timeout'"), false);
});

test('the outcome to delivery-state mapping names only declared edges', () => {
  const body = functionBody(
    executable(migration()),
    'complete_integration_attempt',
  );
  const at = body.indexOf('resulting_state := case attempt_outcome');
  assert.notEqual(at, -1, 'the mapping must be locatable');
  const mapping = body.slice(at, body.indexOf('end;', at));
  const pairs = [...mapping.matchAll(/when '([a-z_]+)' then '([a-z_]+)'/g)];
  assert.equal(
    pairs.length,
    attemptOutcomes.length,
    'the mapping must be total over the four outcomes',
  );
  for (const pair of pairs) {
    const outcome = String(pair[1]);
    const state = String(pair[2]) as DeliveryState;
    assert.ok(
      (attemptOutcomes as readonly string[]).includes(outcome),
      `${outcome} is not an F062.1 outcome`,
    );
    assert.ok(
      mayTransitionDeliveryState('dispatching', state),
      `dispatching -> ${state} is not a declared edge`,
    );
  }
  // The states a worker must never reach by settling an attempt.
  for (const unreachable of ['dead_lettered', 'acknowledged', 'refused'])
    assert.equal(
      mapping.includes(`'${unreachable}'`),
      false,
      `${unreachable} must not be reachable from an attempt outcome`,
    );
});

test('claim eligibility mirrors F062.1 dispatchingLifecycleStates', () => {
  const body = functionBody(
    executable(migration()),
    'claim_integration_intent',
  );
  const at = body.indexOf('lifecycle_state not in');
  assert.notEqual(at, -1);
  const gate = body.slice(at, body.indexOf('then', at));
  for (const state of dispatchingLifecycleStates)
    assert.ok(gate.includes(`'${state}'`), `${state} may dispatch`);
  for (const state of ['configured', 'disabled', 'retired'])
    assert.equal(gate.includes(`'${state}'`), false);
  // And only pending obligations are selected.
  assert.match(body, /o\.state = 'pending'/);
  for (const state of deliveryStates.filter((s) => s !== 'pending'))
    assert.equal(
      body.includes(`o.state = '${state}'`),
      false,
      `${state} must not be claimable in this slice`,
    );
});

// ---------------------------------------------------------------------------
// Scope: what this slice must not contain
// ---------------------------------------------------------------------------

test('the migration encodes no age-based behaviour', () => {
  const code = executable(migration()).toLowerCase();
  for (const token of [
    'pending_age',
    'age_exceeded',
    'max_pending',
    'next_attempt',
    'attempt_count',
    'now() -',
    'clock_timestamp() -',
    ' age(',
    "interval '",
  ])
    assert.equal(
      code.includes(token),
      false,
      `the migration references ${token}, which would be an age predicate`,
    );
});

test('the migration grants nothing, creates no role and creates no table', () => {
  const code = executable(migration()).toLowerCase();
  for (const token of [
    'grant ',
    'create role',
    'alter role',
    'create table',
    'alter table',
    'create index',
    'create trigger',
  ])
    assert.equal(
      code.includes(token),
      false,
      `the migration contains ${token}`,
    );
  // The only revoke is the fail-closed PUBLIC one, once per function.
  assert.equal((code.match(/revoke /g) ?? []).length, 2);
  for (const name of FUNCTIONS)
    assert.ok(
      new RegExp(
        `revoke execute on function\\s+reqro_integration_api\\.${name}\\(`,
      ).test(code),
      `PUBLIC EXECUTE must be revoked from ${name} by full signature`,
    );
  assert.equal((code.match(/from public;/g) ?? []).length, 2);
});

test('no raw claim token can be produced, persisted or returned', () => {
  const code = executable(migration());
  for (const token of ['gen_random_bytes', 'random()'])
    assert.equal(
      code.includes(token),
      false,
      `the migration references ${token}`,
    );
  // `claim_token` as an identifier in its own right would be a raw-token
  // column or variable. `raw_claim_token` (the parameter) and
  // `claim_token_digest` (the one stored value) both contain the substring
  // legitimately, so the boundaries are part of the assertion.
  assert.equal(
    /(?<![a-z_])claim_token(?![a-z_])/.test(code),
    false,
    'the migration names a bare claim_token',
  );
  assert.ok(/(?<![a-z_])claim_token_digest(?![a-z_])/.test(code));
  // The digest is computed in the database, from pg_catalog built-ins, and is
  // the only thing written.
  assert.equal(
    (
      code.match(
        /pg_catalog\.sha256\(pg_catalog\.convert_to\(raw_claim_token, 'UTF8'\)\)/g,
      ) ?? []
    ).length,
    2,
    'both functions must hash the token themselves',
  );
  assert.equal(code.includes('digest('), false, 'pgcrypto is not required');
  // No output column of either function names a token or a digest.
  const returns = code.slice(
    code.indexOf('returns table ('),
    code.indexOf('language plpgsql volatile security definer'),
  );
  assert.equal(/token|digest|credential|secret/i.test(returns), false);
});

test('no network, vendor, secret or resident behaviour exists in the migration', () => {
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
    'cartegraph',
    'azure',
    'microsoft',
    'entra',
    'resident',
    'email',
    'phone',
    'service_request',
  ])
    assert.equal(
      code.includes(token),
      false,
      `the migration references ${token}`,
    );
});

/** True when `source` statically imports the compiled form of `file`, which
 * is what would pull a hardcoded-`public.` migration into the test build. */
function importsMigration(source: string, file: string): boolean {
  const compiled = file.replace(/\.ts$/, '.js');
  return (
    source.includes(compiled) &&
    /^import/m.test(source.slice(0, source.indexOf(compiled))) &&
    source.includes(`from '../../migrations/${compiled}'`)
  );
}

test('the hardcoded-public migrations are applied as text, so no test may import them', () => {
  const files = readdirSync(MIGRATIONS).filter((file) => file.endsWith('.ts'));
  assert.equal(files.length, 60, 'the repository holds 60 migrations');
  for (const file of HARDCODED_PUBLIC)
    assert.ok(files.includes(file), `${file} is missing`);
  // F062.2D-2C-3B-1's Migration 57 is deliberately NOT in the set above: it
  // qualifies every object unqualified, so it is safe for a test to import
  // and apply directly to a disposable schema. Asserted rather than assumed,
  // because adding `public.` to it later must break this test instead of
  // silently making the migration run against the wrong schema.
  const POLICY_MIGRATION =
    '20261027000000-add-integration-execution-policy-persistence.ts';
  assert.ok(files.includes(POLICY_MIGRATION));
  assert.equal(
    HARDCODED_PUBLIC.includes(POLICY_MIGRATION),
    false,
    'Migration 57 must not be treated as a hardcoded-public migration',
  );
  assert.equal(
    readFileSync(resolve(MIGRATIONS, POLICY_MIGRATION), 'utf8').includes(
      'public.',
    ),
    false,
    'Migration 57 must not hardcode the public schema',
  );
  // F062.2D-2C-3B-2's Migration 58 follows 57's precedent for the same
  // reason: its destination retry-after suite imports and applies it to a
  // disposable schema, which is only safe while it qualifies nothing.
  const RETRY_AFTER_MIGRATION =
    '20261028000000-add-integration-destination-retry-after-evidence.ts';
  assert.ok(files.includes(RETRY_AFTER_MIGRATION));
  assert.equal(
    HARDCODED_PUBLIC.includes(RETRY_AFTER_MIGRATION),
    false,
    'Migration 58 must not be treated as a hardcoded-public migration',
  );
  assert.equal(
    readFileSync(resolve(MIGRATIONS, RETRY_AFTER_MIGRATION), 'utf8').includes(
      'public.',
    ),
    false,
    'Migration 58 must not hardcode the public schema',
  );
  // F065's Migration 59 follows the same precedent for the same reason: the
  // requester tracking suite imports and applies it to a disposable schema,
  // which is only safe while it qualifies nothing.
  const INTAKE_TRACKING_MIGRATION =
    '20261030000000-add-requester-intake-tracking-issuance.ts';
  assert.ok(files.includes(INTAKE_TRACKING_MIGRATION));
  assert.equal(
    HARDCODED_PUBLIC.includes(INTAKE_TRACKING_MIGRATION),
    false,
    'Migration 59 must not be treated as a hardcoded-public migration',
  );
  assert.equal(
    readFileSync(
      resolve(MIGRATIONS, INTAKE_TRACKING_MIGRATION),
      'utf8',
    ).includes('public.'),
    false,
    'Migration 59 must not hardcode the public schema',
  );
  // F066's Migration 60 follows the same precedent for the same reason: the
  // submission-idempotency suite and the intake harness both import and apply
  // it to a disposable schema, which is only safe while it qualifies nothing.
  const SUBMISSION_IDEMPOTENCY_MIGRATION =
    '20261031000000-add-submission-idempotency.ts';
  assert.ok(files.includes(SUBMISSION_IDEMPOTENCY_MIGRATION));
  assert.equal(
    HARDCODED_PUBLIC.includes(SUBMISSION_IDEMPOTENCY_MIGRATION),
    false,
    'Migration 60 must not be treated as a hardcoded-public migration',
  );
  assert.equal(
    readFileSync(
      resolve(MIGRATIONS, SUBMISSION_IDEMPOTENCY_MIGRATION),
      'utf8',
    ).includes('public.'),
    false,
    'Migration 60 must not hardcode the public schema',
  );
  // Migrations are compiled into the test output only when a test imports
  // them statically, and a migration hardcoding `public.` must not be
  // imported, or it would run against a disposable schema unrewritten.
  //
  // The detector is exercised against a synthetic source first, so a guard
  // that silently stopped matching cannot pass by finding nothing.
  for (const file of HARDCODED_PUBLIC) {
    const compiled = file.replace(/\.ts$/, '.js');
    assert.equal(
      importsMigration(
        `import { up } from '../../migrations/${compiled}';`,
        file,
      ),
      true,
      `the guard no longer detects an import of ${file}`,
    );
    assert.equal(
      importsMigration(`const name = '${compiled}';`, file),
      false,
      `naming ${file} as a string must not be treated as an import`,
    );
  }
  const suites = resolve(__dirname, '..');
  const offenders: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.ts')) {
        const source = readFileSync(path, 'utf8');
        for (const file of HARDCODED_PUBLIC)
          if (importsMigration(source, file))
            offenders.push(`${entry.name} -> ${file}`);
      }
    }
  };
  walk(suites);
  assert.deepEqual(offenders, []);
});

// ---------------------------------------------------------------------------
// The provisioning artifacts
// ---------------------------------------------------------------------------

/**
 * F062.2D-2C-3B-2. The destination retry-after migration is persistence only.
 *
 * The behavioural proofs live in
 * `test/database/integration-destination-retry-after-evidence.integration.test.ts`.
 * This is the source-level containment proof: Migration 58 may touch the
 * attempt table and its guard, and nothing else. Comments are stripped first,
 * so the migration's own prose about `complete_integration_attempt` does not
 * flag itself.
 */
test('Migration 58 adds retry evidence without touching a worker function', () => {
  const RETRY_AFTER =
    '20261028000000-add-integration-destination-retry-after-evidence.ts';
  const code = executable(
    readFileSync(resolve(MIGRATIONS, RETRY_AFTER), 'utf8'),
  );

  // No worker function is created, replaced, dropped or granted. This is what
  // keeps the new column unwritable: the only function that settles an attempt
  // is untouched, and its parameter list cannot carry the delay.
  for (const token of [
    'reqro_integration_api',
    'complete_integration_attempt',
    'claim_integration_intent',
    'mark_integration_dispatch_started',
    'recover_expired_integration_claim',
    'security definer',
    'grant ',
    'revoke ',
    'create role',
    'create schema',
    'set role',
  ])
    assert.equal(
      code.includes(token),
      false,
      `Migration 58 references ${token}`,
    );

  // It creates no table and no default, and selects no policy number.
  assert.equal(code.includes('create table'), false);
  assert.equal(code.includes('default'), false, 'Migration 58 sets a default');

  // The one column it adds, and the only table it alters.
  assert.equal(
    code.includes('add column destination_retry_after_seconds integer'),
    true,
  );
  for (const table of [
    'integration_connector',
    'integration_outbox',
    'integration_execution_safety_policy',
  ])
    assert.equal(
      code.includes(`alter table ${table}`),
      false,
      `Migration 58 alters ${table}`,
    );

  // The rate-limited constraint must be NULL-safe. Written with `=`, it would
  // evaluate to NULL for a successful settlement and PostgreSQL would satisfy
  // the CHECK on unknown, admitting evidence onto a success.
  assert.equal(
    code.includes("failure_category is not distinct from 'rate_limited'"),
    true,
    'the rate_limited constraint must be null-safe',
  );
  assert.equal(
    code.includes("or failure_category = 'rate_limited'"),
    false,
    'a three-valued equality must not gate the rate_limited constraint',
  );
});

test('the bootstrap creates the function owner and exactly one new edge', () => {
  const code = artifact('bootstrap-roles.sql');
  assert.match(
    code,
    /create role %I nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls',\s*\n\s*function_owner_role/,
  );
  assert.match(
    code,
    /grant %I to %I with inherit false, set true, admin false/,
  );
  // The schema is created here, with AUTHORIZATION, because the function
  // owner must not hold CREATE on the database.
  assert.match(code, /create schema %I authorization %I/);
  assert.match(code, /revoke all on schema %I from public/);
  // The worker principal is F062.2D-3's, not this slice's.
  const executableSql = executable(code);
  assert.equal(executableSql.includes('reqro_integration_worker'), false);
  // And the fail-closed block still asserts the edge's options rather than
  // trusting the member role's NOINHERIT attribute.
  assert.match(code, /m\.inherit_option = false/);
  assert.match(code, /m\.set_option = true/);
  assert.match(code, /m\.admin_option = false/);
});

test('the grant artifact gives the function owner exactly the derived privileges', () => {
  const code = artifact('integration-worker-role.sql');
  const executableSql = executable(code);
  const grants = [
    ...executableSql.matchAll(/grant ([^;]*?) to :"function_owner"/gs),
  ].map((match) => String(match[1]).replace(/\s+/g, ' ').trim());
  assert.deepEqual(grants, [
    'usage on schema :"schema"',
    'select, update on :"schema".integration_outbox',
    'select, insert, update on :"schema".integration_delivery_attempt',
    'select on :"schema".integration_connector',
    'update (id) on :"schema".integration_connector',
    'select on :"schema".integration_connector_audit',
  ]);

  // The prohibitions that would each be an escalation path.
  for (const forbidden of [
    'with grant option',
    'grant all',
    'on all tables',
    'alter default privileges',
    'delete on',
    'truncate on',
    'create on schema',
  ])
    assert.equal(
      executableSql.toLowerCase().includes(forbidden),
      false,
      `the grant artifact contains ${forbidden}`,
    );
  // No business table is named in executable SQL, and no worker principal is
  // granted anything: F062.2D-3 adds that, and the commented template is not
  // executable.
  for (const table of [
    'service_request',
    'answer',
    'attachment',
    'requester_contact',
    'tenant_domain',
    'permission',
  ])
    assert.equal(
      executableSql.includes(table),
      false,
      `the grant artifact names ${table}`,
    );
  assert.equal(executableSql.includes(':"worker"'), false);
  assert.equal(executableSql.includes('execute on function'), false);
});
