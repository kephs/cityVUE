import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';

/**
 * ADR-027 F060.3C-2c-1. Closes the production operator path against future
 * widening.
 *
 * The F060.3C-2b direct-import assertion was necessary but not sufficient: it
 * only inspected the entry module. This suite resolves the **complete
 * transitive runtime graph** and asserts equality against a reviewed closed
 * set, so a newly reachable internal module fails even when it sits in no
 * forbidden directory.
 *
 * **Why the emitted output and not the TypeScript source.** Capability comes
 * from what actually loads at runtime. The source graph legitimately reaches
 * `service-request`, `resident-experience`, `alerts`, `catalog`, `admin` and
 * `auth` through `import type` edges in `database.types.ts`, and the compiler
 * erases every one of them. Asserting on source would therefore fail on
 * dependencies that grant nothing, and would hide the thing that does matter:
 * whether those edges are still type-only. Both properties are asserted here,
 * separately.
 *
 * **Deterministic compiled input.** `npm run test:compile` emits this test and
 * `src` into `dist-test` in the same invocation, and the unit scripts always
 * run it first, so `dist-test/src` cannot be stale relative to this run. The
 * suite fails loudly rather than silently skipping if the entry point is
 * absent.
 */
const COMPILED_ROOT = resolve(__dirname, '../../src');
const SOURCE_ROOT = resolve(__dirname, '../../../src');
const ENTRY = resolve(COMPILED_ROOT, 'database/tenant-domain-operator-cli.js');

/** The reviewed closed runtime set from the F060.3C-2c assessment. Equality,
 * not absence: adding a module here is a deliberate, reviewable act. */
const ALLOWED_RUNTIME_MODULES = [
  'common/logging/log-sanitization.js',
  'config/database-tls.js',
  'config/environment.js',
  // ADR-028 F060.3C-2e-1, reviewed additions. All three are configuration
  // and policy only: the trusted execution contract, its provider-neutral
  // identity adapter, and the invocation audit interface with its stream and
  // in-memory adapters. None reaches an application domain, none opens a
  // database connection, and none reads a credential.
  'config/operator-audit.js',
  'config/operator-environment.js',
  'config/operator-execution.js',
  'config/operator-identity.js',
  'database/tenant-domain-operator-cli.js',
  'tenancy/tenant-domain-challenge.js',
  'tenancy/tenant-domain-verifier.js',
  'tenancy/tenant-domain.js',
  'tenancy/tenant-domain.operations.js',
  'tenancy/tenant-host-source.js',
  'tenancy/tenant-hostname.js',
];

const ALLOWED_RUNTIME_EXTERNALS = [
  'joi',
  'kysely',
  'node:crypto',
  'node:dns/promises',
  'node:fs',
  'node:net',
  'node:url',
  'pg',
  'reflect-metadata',
];

/** The approved control-plane database surface.
 *
 * F060.3C-2c-2 removed `organization`. That is a deliberate tightening, not
 * a weakened assertion: the Organization row lock and status read moved into
 * the schema-owner-owned `tenant_domain_lock_organization` helper, so the
 * operator role needs no privilege on that table at all. Re-adding it here
 * would mean the operator path had regained direct Organization access. */
const ALLOWED_TABLES = [
  'tenant_domain',
  'tenant_domain_audit',
  'tenant_domain_operator_approval',
  'tenant_domain_verification_attempt',
];

/** Exactly two reviewed raw statements: forcing deferred constraints so a dry
 * run validates, and asserting the live connection identity before any
 * mutation. */
const ALLOWED_RAW_SQL = [
  'select current_database() as database, current_user as user, inet_server_addr()::text as address',
  'select tenant_domain_lock_organization(${organizationId}::uuid) as servable',
  'set constraints all immediate',
];

/** Closed function allowlist. Every application database function the
 * operator runtime path invokes directly. */
const ALLOWED_FUNCTIONS = ['tenant_domain_lock_organization'];

/** Application domains the operator credential must never be able to reach.
 * Redundant with the closed allowlist on purpose, so a breach reports which
 * protected area was entered rather than only that the set changed. */
const FORBIDDEN_RUNTIME_AREAS = [
  'service-request',
  'attachments',
  'requesters',
  'requester-tracking',
  'tracking',
  'resident-experience',
  'access/',
  'staff',
  'role',
  'notifications',
  'ai/',
  'alerts/',
  'catalog/',
  'admin/',
  'auth/',
  'issues/',
  '.controller',
  '.module',
];

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

interface RuntimeGraph {
  readonly modules: string[];
  readonly externals: string[];
  readonly unresolved: string[];
}

/** Recursively resolves internal runtime dependencies from the compiled entry
 * point. External packages are recorded but not traversed. */
function runtimeGraph(entry: string): RuntimeGraph {
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

test('the compiled operator entry point exists', () => {
  // A missing artifact must fail rather than silently pass an empty graph.
  assert.ok(
    existsSync(ENTRY),
    'run npm run test:compile before this suite; dist-test/src must be present',
  );
});

const graph = runtimeGraph(ENTRY);

test('the runtime dependency graph equals the reviewed closed set', () => {
  assert.deepEqual(graph.unresolved, [], 'every internal import must resolve');
  assert.deepEqual(
    graph.modules,
    ALLOWED_RUNTIME_MODULES,
    'the production operator runtime graph changed; a newly reachable internal module must be reviewed before this list is updated',
  );
});

test('the runtime graph pulls in no unreviewed external package', () => {
  assert.deepEqual(graph.externals, ALLOWED_RUNTIME_EXTERNALS);
});

test('the runtime graph reaches no protected application domain', () => {
  for (const module of graph.modules)
    for (const area of FORBIDDEN_RUNTIME_AREAS)
      assert.ok(
        !module.includes(area),
        `the production operator path must not reach ${area}; found via ${module}`,
      );
});

/** Negative control. Without this, every assertion above would still pass if
 * the resolver silently stopped following imports, and the boundary would be
 * vacuously "clean". Resolving the application module must therefore produce a
 * large graph that does reach protected domains. */
test('the resolver genuinely follows imports and detects breaches', () => {
  const application = resolve(COMPILED_ROOT, 'app.module.js');
  assert.ok(existsSync(application));
  const broad = runtimeGraph(application);
  assert.ok(
    broad.modules.length > 100,
    `expected the application graph to be large, saw ${String(broad.modules.length)}`,
  );
  const breaches = broad.modules.filter((module) =>
    FORBIDDEN_RUNTIME_AREAS.some((area) => module.includes(area)),
  );
  assert.ok(
    breaches.length > 0,
    'the forbidden-area detector reported nothing on the full application graph, so it cannot be trusted on the operator graph',
  );
  // And the operator graph is a strict, much smaller subset of it.
  assert.ok(graph.modules.length < broad.modules.length);
});

/** The latent escalation the F060.3C-2c assessment identified: the source
 * graph reaches protected domains through `database.types.ts`, and only the
 * compiler's type erasure keeps them out of the runtime graph. If a future
 * edit turned one of those into a value import, the runtime graph assertion
 * above would start failing — but only after the escalation existed. These two
 * assertions make the erasure itself the invariant. */
test('every domain import in database.types.ts stays type-only', () => {
  const source = readFileSync(
    resolve(SOURCE_ROOT, 'database/database.types.ts'),
    'utf8',
  );
  const relativeImports = [
    ...source.matchAll(
      /(?:^|\n)\s*(import|export)(\s+type)?\s[^;]*?from\s*'(\.[^']+)'/g,
    ),
  ];
  assert.ok(
    relativeImports.length > 0,
    'expected database.types.ts to carry relative domain imports',
  );
  for (const match of relativeImports)
    assert.ok(
      match[2] !== undefined,
      `database.types.ts must import ${match[3] ?? 'an internal module'} with "import type" so it erases; a value import would place application code in the operator runtime graph`,
    );
});

test('the emitted database.types.js requires no application domain', () => {
  const emitted = resolve(COMPILED_ROOT, 'database/database.types.js');
  assert.ok(existsSync(emitted));
  const text = readFileSync(emitted, 'utf8');
  for (const specifier of specifiers(text))
    assert.ok(
      !specifier.startsWith('.'),
      `database.types.js must erase to a types-only stub; it requires ${specifier}`,
    );
  for (const area of FORBIDDEN_RUNTIME_AREAS)
    assert.ok(
      !text.includes(area),
      `the emitted schema module must not reference ${area}`,
    );
});

/** The database surface is read from the TypeScript sources of exactly the
 * modules the runtime graph reaches, so SQL behind a helper module is counted
 * rather than treated as invisible. */
const runtimeSources = graph.modules.map((module) => ({
  module,
  text: readFileSync(
    resolve(SOURCE_ROOT, module.replace(/\.js$/, '.ts')),
    'utf8',
  ),
}));

test('the runtime path reaches exactly the approved tables', () => {
  const tables = new Set<string>();
  for (const { text } of runtimeSources)
    for (const match of text.matchAll(
      /(?:insertInto|selectFrom|updateTable|deleteFrom|innerJoin|leftJoin|replaceInto)\(\s*'([a-z_]+)'/g,
    ))
      if (match[1]) tables.add(match[1]);
  assert.deepEqual(
    [...tables].sort(),
    ALLOWED_TABLES,
    'the production operator path reaches a table outside the approved control-plane surface',
  );
});

test('the operator path reads the Organization table in no way at all', () => {
  // F060.3C-2c-2: the row lock and status read live in a schema-owner-owned
  // SECURITY DEFINER helper that returns only a boolean, so the operator role
  // needs no Organization privilege. Any direct read reappearing here would
  // reintroduce the `FOR SHARE` requirement for UPDATE privilege on the table.
  for (const { module, text } of runtimeSources)
    for (const shape of [
      "selectFrom('organization')",
      "insertInto('organization')",
      "updateTable('organization')",
      "deleteFrom('organization')",
      'from organization',
      'from public.organization',
    ])
      assert.ok(
        !text.includes(shape),
        `${module} must not access the Organization table directly: found ${shape}`,
      );
});

test('the operator path calls exactly the approved database functions', () => {
  // Application database functions invoked from raw SQL in the operator path.
  // The call site is unqualified by design — PostgreSQL never searches
  // `pg_temp` for function names — so the allowlist matches the bare name,
  // while the function bodies themselves stay fully qualified.
  const called = new Set<string>();
  for (const { text } of runtimeSources)
    for (const match of text.matchAll(
      /sql(?:<[^>]*>)?`[\s\S]*?\b(tenant_domain_[a-z_]+)\(/g,
    ))
      if (match[1]) called.add(match[1]);
  assert.deepEqual(
    [...called].sort(),
    ALLOWED_FUNCTIONS,
    'the operator path invokes an application database function outside the approved set',
  );
});

test('the runtime path carries exactly the reviewed raw statements', () => {
  const statements: string[] = [];
  for (const { text } of runtimeSources)
    for (const match of text.matchAll(/sql(?:<[^>]*>)?`([\s\S]*?)`/g)) {
      const normalized = (match[1] ?? '').replace(/\s+/g, ' ').trim();
      if (normalized.length > 0) statements.push(normalized);
    }
  assert.deepEqual([...new Set(statements)].sort(), ALLOWED_RAW_SQL);
});

/** Comments and string literals are prose: the operator modules deliberately
 * document the capabilities they exclude, and that must not trip a scan for
 * code implementing them. */
function identifiersOf(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

test('no module in the runtime path has a raw-SQL or connection escape hatch', () => {
  for (const { module, text } of runtimeSources)
    // Graph-wide: a raw-statement path or an ad-hoc connection string must
    // exist nowhere in the operator path. `connectionString` is deliberately
    // not here — building it from validated configuration is exactly what the
    // reviewed TLS module does; what matters is that the entry point cannot,
    // which the next assertion covers.
    for (const forbidden of ['sql.raw', 'executeQuery', 'databaseUrl'])
      assert.ok(
        !identifiersOf(text).includes(forbidden),
        `${module} must not contain ${forbidden}`,
      );
});

test('the operator entry point reaches no listing capability', () => {
  // `listTenantDomains` is a legitimate export of the shared operations
  // module, used by the development command. What must stay true is that the
  // production entry point never reaches it, because the hostname namespace is
  // global and the command must not become a cross-tenant browsing tool.
  const entry = runtimeSources.find(
    ({ module }) => module === 'database/tenant-domain-operator-cli.js',
  );
  assert.ok(entry);
  const identifiers = identifiersOf(entry.text);
  for (const forbidden of [
    'listTenantDomains',
    'discover',
    'onboard',
    '--database-url',
    // The entry point takes its connection only from the validated
    // environment through the reviewed TLS module; it never builds one.
    'connectionString',
  ])
    assert.ok(
      !identifiers.includes(forbidden),
      `the production operator command must not contain ${forbidden}`,
    );
  // Its only Organization-scoped read is the exact-target inspection.
  assert.ok(identifiers.includes('inspectTenantDomain'));
});
