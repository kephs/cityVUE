import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
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

test('SDK imports are confined to the reviewed signal adapters; no monitoring vendor/exporter imports exist', () => {
  const walk = (directory: string): void => {
    for (const entry of readdirSync(join(root, directory), {
      withFileTypes: true,
    })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      const visit = (node: ts.Node): void => {
        if (
          ts.isStringLiteral(node) &&
          (ts.isImportDeclaration(node.parent) ||
            ts.isExportDeclaration(node.parent) ||
            ts.isCallExpression(node.parent))
        ) {
          const specifier = node.text;
          assert.doesNotMatch(
            specifier,
            /applicationinsights|azure.*monitor|exporter.*otlp|exporter.*azure|sdk-logs|auto-instrumentation/i,
          );
          if (specifier.startsWith('@opentelemetry/')) {
            assert.ok(
              [
                'src/observability/request-tracing.ts',
                'src/observability/request-metrics.ts',
              ].includes(path),
            );
            assert.ok(
              [
                '@opentelemetry/api',
                '@opentelemetry/sdk-metrics',
                '@opentelemetry/sdk-trace',
                '@opentelemetry/resources',
              ].includes(specifier),
            );
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source(path));
    }
  };
  walk('src');
  const manifest = JSON.parse(
    readFileSync(join(root, 'package.json'), 'utf8'),
  ) as { dependencies: Record<string, string> };
  assert.deepEqual(
    Object.keys(manifest.dependencies)
      .filter((key) => key.startsWith('@opentelemetry/'))
      .sort(),
    [
      '@opentelemetry/api',
      '@opentelemetry/resources',
      '@opentelemetry/sdk-metrics',
      '@opentelemetry/sdk-trace',
    ],
  );
  for (const key of Object.keys(manifest.dependencies))
    assert.doesNotMatch(
      key,
      /applicationinsights|azure.*monitor|exporter|instrumentation/i,
    );
});

test('observability imports are closed against database, tenant enrichment, network and F062 dependencies', () => {
  const allowed: Record<string, readonly string[]> = {
    'telemetry-contracts.ts': [],
    'metric-label-policy.ts': ['./telemetry-contracts.js'],
    'request-metrics.ts': [
      '@opentelemetry/api',
      '@opentelemetry/resources',
      '@opentelemetry/sdk-metrics',
      './metric-label-policy.js',
      './telemetry-contracts.js',
    ],
    'request-metrics.middleware.ts': [
      '@nestjs/common',
      'express',
      './request-metrics.js',
    ],
    'request-metrics.module.ts': [
      '@nestjs/common',
      '@nestjs/config',
      '../config/configuration.js',
      './request-metrics.js',
      './request-metrics.middleware.js',
    ],
    'request-tracing.ts': [
      '@opentelemetry/api',
      '@opentelemetry/resources',
      '@opentelemetry/sdk-trace',
      './telemetry-contracts.js',
    ],
    'request-tracing.middleware.ts': [
      '@nestjs/common',
      'express',
      './request-tracing.js',
    ],
    'request-tracing.module.ts': [
      '@nestjs/common',
      '@nestjs/config',
      '../config/configuration.js',
      './request-tracing.js',
      './request-tracing.middleware.js',
    ],
  };
  assert.deepEqual(
    readdirSync(join(root, 'src/observability')).sort(),
    Object.keys(allowed).sort(),
  );
  for (const [file, permitted] of Object.entries(allowed)) {
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node)) {
        assert.ok(ts.isStringLiteral(node.moduleSpecifier));
        assert.ok(permitted.includes(node.moduleSpecifier.text));
      }
      assert.equal(ts.isExportDeclaration(node), false);
      if (ts.isCallExpression(node)) {
        assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword);
        if (ts.isIdentifier(node.expression))
          assert.notEqual(node.expression.text, 'require');
      }
      ts.forEachChild(node, visit);
    };
    visit(source(`src/observability/${file}`));
  }
});

test('middleware reads only method, server id and framework route; adapter has no exporter or propagation wiring', () => {
  const middleware = source('src/observability/request-tracing.middleware.ts');
  const adapter = source('src/observability/request-tracing.ts');
  const visitMiddleware = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'request'
    )
      assert.ok(['method', 'route'].includes(node.name.text));
    // Request ID uses a typed intersection; no destructuring or computed access
    // may bypass the small reviewed request projection.
    assert.equal(ts.isElementAccessExpression(node), false);
    assert.equal(ts.isObjectBindingPattern(node), false);
    ts.forEachChild(node, visitMiddleware);
  };
  visitMiddleware(middleware);
  const constructed: string[] = [];
  let startSpanSeen = false;
  const visitAdapter = (node: ts.Node): void => {
    if (ts.isNewExpression(node))
      constructed.push(node.expression.getText(adapter));
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      assert.ok(
        ![
          'recordException',
          'addEvent',
          'addLink',
          'extract',
          'inject',
          'setGlobalTracerProvider',
          'setGlobalPropagator',
          'setGlobalContextManager',
        ].includes(node.expression.name.text),
      );
      if (node.expression.name.text === 'startSpan') {
        startSpanSeen = true;
        assert.equal(node.arguments[2]?.getText(adapter), 'ROOT_CONTEXT');
      }
    }
    ts.forEachChild(node, visitAdapter);
  };
  visitAdapter(adapter);
  assert.deepEqual(constructed, ['TracerProvider', 'AlwaysOnSampler']);
  assert.ok(startSpanSeen);
});

test('production wiring preserves server correlation before tracing and tenant resolution', () => {
  const app = source('src/app.module.ts');
  let seen = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'apply'
    ) {
      assert.deepEqual(
        node.arguments.map((argument) => argument.getText(app)),
        [
          'RequestLoggingMiddleware',
          'RequestTracingMiddleware',
          'RequestMetricsMiddleware',
          'TenantResolutionMiddleware',
        ],
      );
      seen = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(app);
  assert.ok(seen);
});
