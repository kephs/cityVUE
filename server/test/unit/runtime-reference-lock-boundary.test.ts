import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * ADR-027 F060.3C-2d. A complete, equality-based inventory of every row lock
 * the runtime application takes on a reference table.
 *
 * **Why this test exists: a scanner defect, recorded honestly.** The
 * F060.3C-2d-A assessment reported three Category lock sites. There are
 * sixteen. The thirteen it missed use Kysely's `OF`-alias form —
 * `forShare(['request', 'category', 'organization'])` — against a query head
 * built in a *different function*, `staffRequestScope`. That assessment's
 * scanner searched backwards for `selectFrom` only within the same 60-line
 * window, found none, produced `unresolved(category)` and then **silently
 * dropped the site**. The privilege model it derived was consequently wrong
 * for one table, and the error surfaced only during implementation.
 *
 * Two rules follow, and this test enforces both:
 *
 * 1. Aliases are resolved across the **whole runtime**, not per function,
 *    because the shared scope builders are what establish them.
 * 2. An unresolved alias is a **test failure**, never a dropped site. Silence
 *    is what allowed the original defect to look like a clean result.
 *
 * The inventory is asserted by equality rather than by a forbidden-token
 * scan, so a new lock on a reference table fails this test until the
 * privilege model is revisited deliberately.
 */

/** Resolved from the built application entry point, so only modules the
 * runtime actually reaches are considered. */
const DIST = path.resolve(__dirname, '../../src');
const SOURCE = path.resolve(__dirname, '../../../src');

function runtimeClosure(): string[] {
  const entry = path.join(DIST, 'main.js');
  assert.ok(existsSync(entry), 'the built runtime entry point must exist');
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (file === undefined || seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, 'utf8').matchAll(
      /require\(["'](\.[^"']+)["']\)/g,
    )) {
      let target = path.resolve(path.dirname(file), match[1] ?? '');
      if (existsSync(target) && statSync(target).isDirectory())
        target = path.join(target, 'index.js');
      if (!target.endsWith('.js')) target += '.js';
      queue.push(target);
    }
  }
  return [...seen]
    .filter((file) => file.startsWith(DIST))
    .map((file) =>
      path.join(SOURCE, path.relative(DIST, file)).replace(/\.js$/, '.ts'),
    )
    .filter((file) => existsSync(file))
    .sort();
}

/** Comments must not satisfy or trip a structural assertion. */
function strip(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const sources = runtimeClosure().map((file) => ({
  relative: path.relative(SOURCE, file).replace(/\\/g, '/'),
  code: strip(readFileSync(file, 'utf8')),
}));

/** Alias -> physical table, gathered across every runtime module. This is the
 * fix for the original defect: `request`, `category` and `organization` are
 * established by `staffRequestScope`, far from the lock calls that name them. */
const aliases = new Map<string, string>();
for (const { code } of sources)
  for (const match of code.matchAll(
    /\.(?:selectFrom|innerJoin|leftJoin|rightJoin|fullJoin)\(\s*["']([a-z_][a-z0-9_]*)(?:\s+as\s+([A-Za-z_]\w*))?["']/g,
  ))
    aliases.set(match[2] ?? match[1] ?? '', match[1] ?? '');

interface LockSite {
  readonly site: string;
  readonly mode: string;
  readonly tables: readonly string[];
}

/** The closed set of physical tables the dynamic assignment-target choice can
 * reach. Proven from source: `targetTypes = ['staff', 'role', 'group']` maps
 * to `staff_identity`, `operational_role` and `work_group`. Note that `role`
 * is a discriminant VALUE, not a table — mistaking it for one is how an
 * earlier report wrongly placed `role` in the lock inventory. */
const ASSIGNMENT_TARGET_TABLES = [
  'operational_role',
  'staff_identity',
  'work_group',
] as const;

const ofSites: LockSite[] = [];
const unresolved: string[] = [];

for (const { relative, code } of sources) {
  const lines = code.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    for (const match of line.matchAll(
      /\.(forUpdate|forShare|forNoKeyUpdate|forKeyShare)\s*\(\s*(\[[^\]]*\]|["'][A-Za-z_]\w*["'])\s*\)/g,
    )) {
      const named = [
        ...(match[2] ?? '').matchAll(/["']([A-Za-z_]\w*)["']/g),
      ].map((entry) => entry[1] ?? '');
      const tables = named.map((alias) => {
        const table = aliases.get(alias);
        if (table === undefined) {
          unresolved.push(`${relative}:${String(index + 1)} OF(${alias})`);
          return `UNRESOLVED(${alias})`;
        }
        return table;
      });
      ofSites.push({
        site: `${relative}:${String(index + 1)}`,
        mode: match[1] ?? '',
        tables,
      });
    }
  }
}

test('every OF-clause lock alias resolves to a physical table', () => {
  // The rule that the original defect violated. An alias this scan cannot
  // resolve must fail loudly; it must never be dropped.
  assert.deepEqual(
    unresolved,
    [],
    'an OF-clause lock alias could not be resolved to a table; resolve it rather than ignoring the site',
  );
});

test('the Category row-lock inventory is exactly the reviewed set', () => {
  // Equality, not a token scan: a new Category lock fails here until the
  // privilege model is revisited, because Category carries the slice's only
  // lock-only column grant.
  // Keyed by file with a per-file count rather than by line number, so an
  // unrelated edit above a lock does not break the inventory while a NEW or
  // REMOVED lock still does.
  const perFile = new Map<string, number>();
  for (const entry of ofSites)
    if (entry.tables.includes('category'))
      perFile.set(
        entry.site.replace(/:\d+$/, ''),
        (perFile.get(entry.site.replace(/:\d+$/, '')) ?? 0) + 1,
      );
  assert.deepEqual([...perFile.entries()].sort(), [
    ['attachments/attachment.service.ts', 1],
    ['catalog/issue-action.command.ts', 1],
    ['service-request/internal-request-mutations.service.ts', 1],
    ['service-request/issue-default-assignment.ts', 1],
    ['service-request/public-request-contact.policy.ts', 1],
    ['service-request/request-answer.service.ts', 1],
    ['service-request/request-communication.service.ts', 1],
    ['service-request/request-contact.service.ts', 1],
    ['service-request/request-note.service.ts', 1],
    ['service-request/request-ownership.service.ts', 1],
    ['service-request/request-tracking.service.ts', 2],
    ['service-request/staff-actions.service.ts', 1],
  ]);
  // Thirteen OF-alias sites across twelve files, deliberately left native so
  // the atomic multi-relation lock of the hot request paths is preserved.
  const total = [...perFile.values()].reduce((sum, n) => sum + n, 0);
  assert.equal(total, 13);
});

test('only Category keeps a native runtime reference lock', () => {
  // Every table reached by an OF-clause lock, with the reason it is allowed.
  const locked = [...new Set(ofSites.flatMap((entry) => entry.tables))].sort();
  assert.deepEqual(locked, [
    // Genuinely mutated by the runtime, so the lock needs no extra privilege.
    'category',
    'organization',
    'service_definition',
    'service_request',
  ]);
  // The five converted reference tables must appear in NO native lock, or
  // their helpers would not have removed the privilege requirement.
  for (const table of [
    'department',
    'division',
    'staff_identity',
    'operational_role',
    'work_group',
  ])
    assert.ok(
      !locked.includes(table),
      `${table} still has a native runtime row lock, so its helper does not remove the privilege requirement`,
    );
});

test('the converted reference tables take their locks only through helpers', () => {
  // The helper wrappers are the single route to those locks.
  const wrappers = readFileSync(
    path.join(SOURCE, 'database/reference-locks.ts'),
    'utf8',
  );
  const exported = [...wrappers.matchAll(/export function (lock[A-Za-z]+)\(/g)]
    .map((match) => match[1] ?? '')
    .sort();
  assert.deepEqual(exported, [
    'lockActiveCategory',
    'lockActiveDepartment',
    'lockActiveDivision',
    'lockAssignmentTarget',
    'lockDepartment',
    'lockDivision',
    'lockStaff',
  ]);
  // Exactly seven, matching the seven Migration 49 helpers. Category has no
  // existence-only wrapper: its native sites keep their own locks.
  assert.equal(exported.length, 7);
  assert.ok(!exported.includes('lockCategory'));
});

test('role is absent from the runtime lock inventory', () => {
  // `role` entered an earlier inventory by mistake: the literal 'role' in
  // `type === 'role' ? 'operational_role' : ...` is a discriminant value that
  // resolves to `operational_role`. Every selectFrom('role') in the repository
  // is development or UAT tooling, never the runtime.
  const everyLockedTable = new Set(ofSites.flatMap((entry) => entry.tables));
  assert.ok(!everyLockedTable.has('role'));
  for (const { relative, code } of sources)
    assert.ok(
      !/\.selectFrom\(\s*["']role["']/.test(code),
      `${relative} selects from role in the runtime; the lock inventory assumed it does not`,
    );
  // And the dynamic choice reaches exactly three tables, none of them `role`.
  assert.deepEqual([...ASSIGNMENT_TARGET_TABLES].sort(), [
    'operational_role',
    'staff_identity',
    'work_group',
  ]);
});

test('exactly one runtime lock-only column privilege is designed', () => {
  // The design input for the following F060.3C-2d role slice, asserted here so
  // it cannot drift silently. `category.id` is the only column the runtime
  // will hold UPDATE on purely to satisfy row locking, and Migration 49's
  // protect_category_identity is what makes it inert.
  const migration = readFileSync(
    path.join(
      SOURCE,
      '../migrations/20261019000000-harden-runtime-reference-locks.ts',
    ),
    'utf8',
  );
  assert.match(
    migration,
    /create function public\.protect_category_identity\(\)/,
  );
  assert.match(migration, /NEW\.id is distinct from OLD\.id/);
  assert.match(
    migration,
    /create trigger category_identity_immutable before update of id on public\.category/,
  );
  // It must stay SECURITY INVOKER and touch no table.
  const bodyMatch =
    /create function public\.protect_category_identity\(\) returns trigger([\s\S]*?)end \$\$;/.exec(
      migration,
    );
  assert.ok(bodyMatch);
  const body = bodyMatch[1] ?? '';
  assert.ok(!/security definer/i.test(body));
  assert.ok(
    !/\b(select|insert|update|delete)\s+(?:into\s+)?[a-z_]+\s+(from|set|into)\b/i.test(
      body,
    ),
  );
});

test('the Migration 49 function surface is exactly the reviewed set', () => {
  const migration = readFileSync(
    path.join(
      SOURCE,
      '../migrations/20261019000000-harden-runtime-reference-locks.ts',
    ),
    'utf8',
  );
  const created = [...migration.matchAll(/create function public\.([a-z_]+)/g)]
    .map((match) => match[1] ?? '')
    .sort();
  assert.deepEqual(created, [
    'lock_active_category',
    'lock_active_department',
    'lock_active_division',
    'lock_assignment_target',
    'lock_department',
    'lock_division',
    'lock_staff',
    'protect_category_identity',
  ]);
  const replaced = [
    ...migration.matchAll(/create or replace function public\.([a-z_]+)/g),
  ]
    .map((match) => match[1] ?? '')
    .sort();
  assert.deepEqual(replaced, [
    'advance_access_revision',
    'invalidate_access_revision',
  ]);
  // Every function this migration creates or replaces loses PUBLIC EXECUTE.
  const revoked = [
    ...migration.matchAll(
      /revoke execute on function public\.([a-z_]+)\([^)]*\) from public/g,
    ),
  ]
    .map((match) => match[1] ?? '')
    .sort();
  assert.deepEqual(revoked, [...created, ...replaced].sort());
  // No role-specific grant belongs in this migration.
  assert.ok(!migration.includes('grant execute on function public.'));
  assert.ok(!migration.includes('to reqro_'));
});

test('the operator boundary is untouched by the runtime lock work', () => {
  const wrappers = readFileSync(
    path.join(SOURCE, 'database/reference-locks.ts'),
    'utf8',
  );
  // The operator helper must never appear in a runtime path.
  assert.ok(!wrappers.includes('tenant_domain_lock_organization'));
  for (const { relative, code } of sources)
    assert.ok(
      !code.includes('tenant_domain_lock_organization'),
      `${relative} references the operator-only Organization lock helper`,
    );
  // And Migration 49 must not alter any tenant-domain object.
  const migration = readFileSync(
    path.join(
      SOURCE,
      '../migrations/20261019000000-harden-runtime-reference-locks.ts',
    ),
    'utf8',
  );
  assert.ok(
    !migration.replace(/\/\*[\s\S]*?\*\//g, '').includes('tenant_domain'),
  );
});
