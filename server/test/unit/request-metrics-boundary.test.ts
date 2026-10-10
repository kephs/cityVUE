import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(__dirname, '../../..');
const source = (path: string) =>
  ts.createSourceFile(
    path,
    readFileSync(join(root, path), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );

test('metrics runtime imports only reviewed dependencies and creates no exporter or network client', () => {
  const ast = source('src/observability/request-metrics.ts');
  const imports: string[] = [];
  const constructions: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      assert.ok(ts.isStringLiteral(node.moduleSpecifier));
      imports.push(node.moduleSpecifier.text);
    }
    assert.equal(ts.isExportDeclaration(node), false);
    if (ts.isNewExpression(node))
      constructions.push(node.expression.getText(ast));
    if (ts.isCallExpression(node)) {
      assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword);
      assert.doesNotMatch(
        node.expression.getText(ast),
        /require|fetch|connect|setInterval|setGlobal|register|detectResources/,
      );
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        ['add', 'record'].includes(node.expression.name.text) &&
        ['requests', 'duration'].includes(
          node.expression.expression.getText(ast),
        )
      )
        assert.equal(node.arguments[2]?.getText(ast), 'ROOT_CONTEXT');
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.deepEqual(imports, [
    '@opentelemetry/api',
    '@opentelemetry/resources',
    '@opentelemetry/sdk-metrics',
    './metric-label-policy.js',
    './telemetry-contracts.js',
  ]);
  assert.deepEqual(constructions, ['MeterProvider']);
  const text = readFileSync(
    join(root, 'src/observability/request-metrics.ts'),
    'utf8',
  );
  assert.match(text, /readers: MetricReader\[\] = \[\]/);
  assert.match(text, /validateMetricLabels\(labels\)/);
});

test('metrics middleware request projection is limited to method and trusted route template', () => {
  const ast = source('src/observability/request-metrics.middleware.ts');
  const reads: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'request'
    )
      reads.push(node.name.text);
    assert.equal(ts.isElementAccessExpression(node), false);
    assert.equal(ts.isObjectBindingPattern(node), false);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.deepEqual(reads, ['method', 'route']);
});

test('locked monitoring dependency set has only the approved official SDK family and no exporter', () => {
  const lock = JSON.parse(
    readFileSync(join(root, 'package-lock.json'), 'utf8'),
  ) as {
    packages: Record<string, { version?: string }>;
  };
  assert.deepEqual(
    Object.keys(lock.packages)
      .filter((name) => name.includes('node_modules/@opentelemetry/'))
      .sort(),
    [
      'node_modules/@opentelemetry/api',
      'node_modules/@opentelemetry/core',
      'node_modules/@opentelemetry/resources',
      'node_modules/@opentelemetry/sdk-metrics',
      'node_modules/@opentelemetry/sdk-trace',
      'node_modules/@opentelemetry/semantic-conventions',
    ],
  );
  assert.equal(
    lock.packages['node_modules/@opentelemetry/sdk-metrics']?.version,
    '2.12.0',
  );
  for (const name of Object.keys(lock.packages))
    assert.doesNotMatch(
      name,
      /applicationinsights|azure.*monitor|opentelemetry.*(?:exporter|sdk-logs|instrumentation)/i,
    );
});
