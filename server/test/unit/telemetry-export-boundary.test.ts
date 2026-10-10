import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const root = resolve(__dirname, '../../..');
const entry = 'src/observability/telemetry-export.ts';
const edges = new Map<string, readonly string[]>([
  [entry, ['./metric-label-policy.js', './telemetry-contracts.js']],
  ['src/observability/metric-label-policy.ts', ['./telemetry-contracts.js']],
  ['src/observability/telemetry-contracts.ts', []],
]);
const calls = new Set([
  'Number.isFinite',
  'Number.isInteger',
  'Object.freeze',
  'Object.getOwnPropertyDescriptor',
  'Object.getPrototypeOf',
  'Object.hasOwn',
  'Reflect.ownKeys',
  'approvals.add',
  'approvals.has',
  'data',
  'isApprovedTelemetryExportRecord',
  'keys.includes',
  'member',
  'nonnegative',
  'reference',
  'sink.accept',
  'validate',
  'validateMetricLabels',
  'values.includes',
  'allowed.includes',
]);
const inspect = (file: string, text: string): string[] => {
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      assert.ok(ts.isStringLiteral(node.moduleSpecifier));
      assert.ok(
        edges.get(file)?.includes(node.moduleSpecifier.text),
        'Unreviewed dependency',
      );
      imports.push(node.moduleSpecifier.text);
    }
    assert.equal(ts.isImportEqualsDeclaration(node), false, 'No require alias');
    assert.equal(ts.isExportDeclaration(node), false, 'No re-export escape');
    if (ts.isImportTypeNode(node)) assert.fail('No imported type escape');
    if (ts.isNewExpression(node)) {
      assert.equal(file, entry);
      assert.equal(node.expression.getText(ast), 'WeakSet');
    }
    if (ts.isCallExpression(node))
      assert.ok(
        calls.has(node.expression.getText(ast)),
        `Unreviewed call: ${node.expression.getText(ast)}`,
      );
    if (ts.isIdentifier(node))
      assert.ok(
        !new Set([
          'fetch',
          'require',
          'process',
          'global',
          'globalThis',
          'eval',
          'Function',
          'WebSocket',
          'XMLHttpRequest',
          'setTimeout',
          'setInterval',
          'setImmediate',
        ]).has(node.text),
        'No ambient I/O or dynamic execution',
      );
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return imports;
};

test('default export graph recursively contains only the gate and two pure F061.1 policy modules', () => {
  const visited = new Set<string>();
  const walk = (file: string): void => {
    if (visited.has(file)) return;
    visited.add(file);
    const imports = inspect(file, readFileSync(join(root, file), 'utf8'));
    assert.deepEqual(imports, edges.get(file));
    for (const specifier of imports) {
      const target = resolve(root, dirname(file), specifier).replace(
        /\.js$/,
        '.ts',
      );
      walk(relative(root, target).split(sep).join('/'));
    }
  };
  walk(entry);
  assert.deepEqual([...visited].sort(), [...edges.keys()].sort());
});

test('graph guard refuses network, persistence, dynamic imports, sockets and aliased ambient calls', () => {
  for (const specifier of [
    'http',
    'node:https',
    'net',
    'node:tls',
    'dns',
    'node:fs',
    'node:fs/promises',
    'child_process',
    'axios',
    '@grpc/grpc-js',
    '@opentelemetry/exporter-trace-otlp-http',
    '@azure/monitor-opentelemetry',
    'applicationinsights',
    '../integration/integration-telemetry.js',
    '../../test/helpers/telemetry-export-sink.js',
  ]) {
    assert.throws(() => inspect(entry, `import thing from '${specifier}';`));
    assert.throws(() => inspect(entry, `export * from '${specifier}';`));
  }
  for (const code of [
    "import('node:http')",
    "require('node:fs')",
    "fetch('synthetic')",
    'const send = fetch; send()',
    'globalThis["fetch"]()',
    'new WebSocket("synthetic")',
    'new Function("return process")()',
    'setTimeout(() => {}, 1)',
    'const f = Object.constructor; f("synthetic")()',
    'process.getBuiltinModule("net")',
    'import io = require("node:http")',
    'type T = import("node:net").Socket',
  ])
    assert.throws(() => inspect(entry, code));
});

test('test sink is unreachable from production and production build excludes test infrastructure', () => {
  const scan = (directory: string): void => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, item.name);
      if (item.isDirectory()) {
        scan(file);
        continue;
      }
      if (!file.endsWith('.ts')) continue;
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node): void => {
        if (
          ts.isStringLiteral(node) &&
          (ts.isImportDeclaration(node.parent) ||
            ts.isExportDeclaration(node.parent) ||
            ts.isCallExpression(node.parent))
        ) {
          assert.doesNotMatch(node.text, /test\/helpers|telemetry-export-sink/);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  };
  scan(join(root, 'src'));
  const build = JSON.parse(
    readFileSync(join(root, 'tsconfig.build.json'), 'utf8'),
  ) as { exclude: string[] };
  assert.ok(build.exclude.includes('test'));
});

test('export contract has no endpoint/credential/vendor types or exporter dependency', () => {
  const ast = ts.createSourceFile(
    entry,
    readFileSync(join(root, entry), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const visit = (node: ts.Node): void => {
    if (ts.isPropertySignature(node))
      assert.doesNotMatch(
        node.name.getText(ast),
        /endpoint|credential|token|secret|connection|exporterKind|azure|otlp/i,
      );
    ts.forEachChild(node, visit);
  };
  visit(ast);
  const lock = JSON.parse(
    readFileSync(join(root, 'package-lock.json'), 'utf8'),
  ) as { packages: Record<string, unknown> };
  for (const name of Object.keys(lock.packages))
    assert.doesNotMatch(
      name,
      /opentelemetry.*exporter|applicationinsights|@azure\/monitor|@grpc\/grpc-js/i,
    );
});
