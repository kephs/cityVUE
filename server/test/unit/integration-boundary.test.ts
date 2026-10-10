import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';

/**
 * F062.1 — proves the integration contract slice is **inert**.
 *
 * Inertness is the deliverable, so it is asserted from the **emitted module
 * graph** rather than from substring scans of source text. The method is the
 * one F060.3C-2c-1 established for the operator path: resolve the complete
 * transitive graph from a single entry point, then assert the internal set and
 * the external set by **equality** against reviewed closed lists.
 *
 * Equality rather than absence matters. A forbidden-token list only catches
 * the dangers somebody thought to enumerate; an equality assertion over the
 * whole graph catches a newly reachable module even when it sits in no
 * forbidden directory and imports nothing with a suspicious name. Adding an
 * entry to either list below is then a deliberate, reviewable act.
 *
 * Deterministic input: `npm run test:compile` emits this test and `src` into
 * `dist-test` in one invocation and the unit scripts always run it first, so
 * `dist-test/src` cannot be stale relative to this run. The suite fails
 * loudly rather than skipping if the entry point is absent.
 */
const COMPILED_ROOT = resolve(__dirname, '../../src');
const SOURCE_ROOT = resolve(__dirname, '../../../src');
const ENTRY = resolve(COMPILED_ROOT, 'integration/index.js');

/**
 * The reviewed closed internal set.
 *
 * It admits **exactly two** modules outside `integration/`: F061.1's
 * provider-neutral telemetry contract and its metric-label validator. That is
 * a deliberate, reviewed dependency in the allowed direction
 * (integration -> observability contract), taken so F062 does not maintain a
 * competing metric-label policy. Arbitrary `observability/` imports are
 * **not** allowed: these two paths are listed individually, and the equality
 * assertion means a third would fail.
 */
const ALLOWED_OBSERVABILITY_MODULES = [
  'observability/metric-label-policy.js',
  'observability/telemetry-contracts.js',
];

/** F062.1's own modules. Source-content scans apply to these only: the
 * observability modules belong to another workstream and are not this
 * slice's to police. */
const F062_MODULES = [
  'integration/connector-capabilities.js',
  'integration/connector-registry.js',
  'integration/delivery-contract.js',
  'integration/fact-authority.js',
  'integration/index.js',
  'integration/integration-envelope.js',
  'integration/integration-telemetry.js',
  'integration/schema-compatibility.js',
];

const ALLOWED_MODULES = [
  ...F062_MODULES,
  ...ALLOWED_OBSERVABILITY_MODULES,
].sort();

/** The reviewed closed external set. **Empty**: a contracts-only slice needs
 * no package at all, not even a Node builtin. */
const ALLOWED_EXTERNALS: readonly string[] = [];

const SPECIFIER_PATTERNS = [
  /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  /(?:^|\n)\s*import\s[^;]*?from\s*["']([^"']+)["']/g,
  /(?:^|\n)\s*import\s*["']([^"']+)["']/g,
  /(?:^|\n)\s*export\s[^;]*?from\s*["']([^"']+)["']/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
];

function specifiers(text: string): string[] {
  const found: string[] = [];
  for (const pattern of SPECIFIER_PATTERNS)
    for (const match of text.matchAll(pattern))
      if (match[1]) found.push(match[1]);
  return [...new Set(found)];
}

function resolveRelative(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.js`, join(base, 'index.js')])
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return null;
}

const asPosix = (file: string) =>
  relative(COMPILED_ROOT, file).split(sep).join('/');

interface Graph {
  readonly modules: string[];
  readonly externals: string[];
  readonly unresolved: string[];
}

function moduleGraph(entry: string): Graph {
  const visited = new Set<string>();
  const externals = new Set<string>();
  const unresolved = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || visited.has(file)) continue;
    visited.add(file);
    for (const specifier of specifiers(readFileSync(file, 'utf8'))) {
      if (!specifier.startsWith('.')) {
        externals.add(specifier);
        continue;
      }
      const target = resolveRelative(file, specifier);
      if (target === null) {
        unresolved.add(`${asPosix(file)} -> ${specifier}`);
        continue;
      }
      pending.push(target);
    }
  }
  return {
    modules: [...visited].map(asPosix).sort(),
    externals: [...externals].sort(),
    unresolved: [...unresolved].sort(),
  };
}

test('the compiled integration entry point exists', () => {
  assert.ok(
    existsSync(ENTRY),
    'run npm run test:compile before this suite; dist-test/src must be present',
  );
});

const graph = moduleGraph(ENTRY);

test('the integration module graph equals the reviewed closed set', () => {
  assert.deepEqual(graph.unresolved, [], 'every internal import must resolve');
  assert.deepEqual(
    graph.modules,
    ALLOWED_MODULES,
    'the integration graph changed; a newly reachable module must be reviewed before this list is updated',
  );
});

test('the integration graph imports no package at all', () => {
  // The strongest available statement of inertness: a contracts-only slice
  // needs no dependency, so the external set is empty rather than merely
  // free of forbidden entries. This single assertion subsumes "no HTTP
  // client", "no vendor SDK", "no cloud SDK", "no broker client" and "no
  // database driver" -- none of them can be reached without an import.
  assert.deepEqual(graph.externals, ALLOWED_EXTERNALS);
});

test('only the two reviewed observability contract modules are admitted', () => {
  // Proves the dependency is narrow rather than "integration may import
  // observability". Anything else there would break the equality assertion
  // above; this states the intent explicitly.
  assert.deepEqual(
    graph.modules.filter((module) => module.startsWith('observability/')),
    ALLOWED_OBSERVABILITY_MODULES,
  );
});

test('the dependency direction is integration to observability, never the reverse', () => {
  // F061.1 must remain unaware of F062. Asserted over F061.1's sources, which
  // this slice reads and never modifies.
  for (const module of ALLOWED_OBSERVABILITY_MODULES) {
    const text = readFileSync(
      resolve(SOURCE_ROOT, module.replace(/[.]js$/, '.ts')),
      'utf8',
    );
    assert.ok(
      !text.includes('integration/'),
      `${module} must not depend on the integration slice`,
    );
  }
});

test('the graph reaches no transport, persistence, credential or vendor module', () => {
  // Belt and braces over the equality assertions above, expressed as the
  // capability questions a reviewer actually asks. These are checked against
  // resolved module paths, not against source text, so a mention in a comment
  // cannot trip them and a real edge cannot hide from them.
  // `observability/` is deliberately absent: the two reviewed contract
  // modules are admitted above, and the equality assertion already prevents a
  // third from appearing.
  const forbiddenInternalAreas = [
    'database/',
    'config/',
    'auth/',
    'notifications/',
    'service-request/',
    'resident-experience/',
    'access/',
    'attachments/',
    'tenancy/',
    'ai/',
    '.controller',
    '.module',
    '.service',
  ];
  for (const module of graph.modules)
    for (const area of forbiddenInternalAreas)
      assert.ok(
        !module.includes(area),
        `${module} must not be reachable from the integration contracts`,
      );

  const forbiddenPackages = [
    'pg',
    'kysely',
    'axios',
    'node-fetch',
    'undici',
    'got',
    'amqplib',
    'kafkajs',
    '@azure/service-bus',
    '@azure/identity',
    '@azure/storage-blob',
    '@azure/monitor-opentelemetry',
    '@aws-sdk/client-sqs',
    '@opentelemetry/api',
    '@opentelemetry/sdk-node',
    'applicationinsights',
    'bullmq',
    'ioredis',
    '@nestjs/common',
    '@nestjs/core',
  ];
  for (const forbidden of forbiddenPackages)
    assert.ok(
      !graph.externals.includes(forbidden),
      `${forbidden} must not be reachable from the integration contracts`,
    );
});

test('no Node builtin granting I/O, process or credential access is reachable', () => {
  // Named explicitly because an empty external set already excludes them, but
  // a future reviewer relaxing ALLOWED_EXTERNALS should see which builtins
  // specifically must never return.
  const forbiddenBuiltins = [
    'node:fs',
    'fs',
    'node:net',
    'net',
    'node:http',
    'http',
    'node:https',
    'https',
    'node:dns',
    'node:dns/promises',
    'node:child_process',
    'child_process',
    'node:process',
    'node:worker_threads',
    'node:cluster',
    'node:os',
  ];
  for (const builtin of forbiddenBuiltins)
    assert.ok(
      !graph.externals.includes(builtin),
      `${builtin} must not be reachable from the integration contracts`,
    );
});

test('no module in the slice performs I/O, timing or scheduling at runtime', () => {
  // A semantic complement to the graph assertions: even with no imports, a
  // module could schedule work or read the ambient environment through
  // globals. Checked over executable lines with comments and string literals
  // removed, so documentation naming what is absent cannot trip it.
  for (const module of F062_MODULES) {
    const source = resolve(SOURCE_ROOT, module.replace(/\.js$/, '.ts'));
    assert.ok(existsSync(source), `${module} must have a source file`);
    const executable = readFileSync(source, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/`(?:[^`\\]|\\.)*`/g, '``');
    for (const forbidden of [
      'process.env',
      'setTimeout',
      'setInterval',
      'setImmediate',
      'queueMicrotask',
      'globalThis.fetch',
      'fetch(',
      'XMLHttpRequest',
      'WebSocket',
      'Worker(',
      'require(',
      'eval(',
      'Function(',
    ])
      assert.ok(
        !executable.includes(forbidden),
        `${module} must not use ${forbidden}`,
      );
  }
});

test('no vendor name appears in the integration contract sources', () => {
  // Vendor schemas, identifiers, status semantics and API concepts must stay
  // inside adapters -- and this slice contains no adapter, so no vendor name
  // belongs anywhere in it. Legitimate industry terminology is deliberately
  // NOT scanned for: `WorkItem` is Reqro's abstraction and `work order` is
  // ordinary public-works vocabulary, neither of which is a vendor concept.
  const vendors = [
    'vueworks',
    'cityworks',
    'cartegraph',
    'mgo',
    'vistashare',
    'salesforce',
    'servicenow',
    'azure',
    'kafka',
    'servicebus',
    'service bus',
    'rabbitmq',
    'sqs',
    'pubsub',
    'opentelemetry',
    'applicationinsights',
    'application insights',
    'datadog',
    'splunk',
    'prometheus',
  ];
  // Scanned over EXECUTABLE code only. These modules deliberately *document*
  // which vendor concepts are prohibited -- the telemetry contract states that
  // no OpenTelemetry or Azure Monitor type may appear -- and a raw scan would
  // read that prohibition as a violation of itself. Stating a rule is not
  // breaking it; what must be absent is a vendor name in code.
  for (const module of F062_MODULES) {
    const executable = readFileSync(
      resolve(SOURCE_ROOT, module.replace(/\.js$/, '.ts')),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const vendor of vendors)
      assert.ok(
        !new RegExp(vendor, 'i').test(executable),
        `${module} must not name ${vendor} in executable code`,
      );
  }
});

test('the slice adds no migration, schema or query', () => {
  // Scoped to this slice's own sources: a contracts-only slice must contain
  // no SQL and no persistence call.
  for (const module of F062_MODULES) {
    const text = readFileSync(
      resolve(SOURCE_ROOT, module.replace(/\.js$/, '.ts')),
      'utf8',
    );
    for (const forbidden of [
      'selectFrom',
      'insertInto',
      'updateTable',
      'deleteFrom',
      'createTable',
      'sql`',
      'Kysely',
      'Pool',
    ])
      assert.ok(
        !text.includes(forbidden),
        `${module} must not contain ${forbidden}`,
      );
    assert.doesNotMatch(
      text,
      /\b(create|alter|drop)\s+(table|index|type|function)\b/i,
      `${module} must contain no DDL`,
    );
  }
});
