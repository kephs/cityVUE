import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

/** Inspect syntax, not comments, formatting or line numbers. Behavioural
 * tenancy/HTTP tests separately exercise selector injection and no fallback. */
function source(name: string) {
  const filename = resolve(__dirname, '../../../src', name);
  return ts.createSourceFile(
    filename,
    readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
}
function nodes(root: ts.Node): ts.Node[] {
  const result: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    result.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return result;
}

test('the serving chain retains one authority selector, canonicalizer and registry lookup boundary', () => {
  const files = [
    'tenant-host-source.ts',
    'tenant-hostname.ts',
    'tenant-resolution.middleware.ts',
    'tenant-resolver.service.ts',
    'tenant-domain.repository.ts',
    'resident-tenant.decorator.ts',
  ];
  const parsed = files.map((file) => source(`tenancy/${file}`));
  // Include new local runtime imports so moving an alternate implementation
  // into a helper cannot evade the single-boundary assertions.
  const reachable = new Map<string, ts.SourceFile>();
  const visitImports = (file: ts.SourceFile) => {
    if (reachable.has(file.fileName)) return;
    reachable.set(file.fileName, file);
    for (const node of file.statements) {
      if (
        !ts.isImportDeclaration(node) ||
        node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword ||
        !ts.isStringLiteral(node.moduleSpecifier) ||
        !node.moduleSpecifier.text.startsWith('.')
      )
        continue;
      visitImports(
        source(
          resolve(
            dirname(file.fileName),
            node.moduleSpecifier.text.replace(/\.js$/, '.ts'),
          ),
        ),
      );
    }
  };
  parsed.forEach(visitImports);
  const runtimeFiles = [...reachable.values()];
  const all = runtimeFiles.flatMap(nodes);
  const functions = all
    .filter(ts.isFunctionDeclaration)
    .map((node) => node.name?.text);
  assert.equal(
    functions.filter((name) => name === 'selectTrustedHost').length,
    1,
  );
  assert.equal(
    functions.filter((name) => name === 'normalizeHostname').length,
    1,
  );

  const calls = (root: ts.Node, name: string) =>
    nodes(root)
      .filter(ts.isCallExpression)
      .filter((call) =>
        ts.isIdentifier(call.expression)
          ? call.expression.text === name
          : ts.isPropertyAccessExpression(call.expression) &&
            call.expression.name.text === name,
      );
  const [host, normalizer, middleware, resolver, repository] = parsed;
  assert.ok(host && normalizer && middleware && resolver && repository);
  assert.equal(calls(normalizer, 'domainToASCII').length, 1);
  assert.equal(
    runtimeFiles.reduce(
      (sum, file) => sum + calls(file, 'domainToASCII').length,
      0,
    ),
    1,
  );
  assert.equal(calls(host, 'normalizeHostname').length, 1);
  assert.equal(calls(resolver, 'normalizeHostname').length, 1);
  assert.equal(
    runtimeFiles.reduce(
      (sum, file) => sum + calls(file, 'normalizeHostname').length,
      0,
    ),
    2,
  );
  const selection = calls(middleware, 'selectTrustedHost');
  assert.equal(selection.length, 1);
  assert.ok(selection[0]);
  assert.deepEqual(
    selection[0].arguments.map((arg) => arg.getText(middleware)),
    [
      'this.policy',
      'request.headers',
      'request.socket.remoteAddress',
      'request.rawHeaders',
    ],
  );
  assert.equal(calls(resolver, 'findResolvable').length, 1);
  const registryReads = all
    .filter(ts.isCallExpression)
    .filter(
      (call) =>
        ts.isPropertyAccessExpression(call.expression) &&
        call.expression.name.text === 'selectFrom' &&
        call.arguments.some(
          (arg) => ts.isStringLiteral(arg) && arg.text === 'tenant_domain',
        ),
    );
  assert.equal(registryReads.length, 1);
  assert.ok(registryReads[0]);
  assert.equal(registryReads[0].getSourceFile().fileName, repository.fileName);

  // Development authority is confined to its explicit branch. A registry miss
  // must never reach a configuration default or browser-selected Organization.
  const resolveMethod = nodes(middleware).find(
    (node): node is ts.MethodDeclaration =>
      ts.isMethodDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'resolve',
  );
  assert.ok(resolveMethod?.body);
  const first = resolveMethod.body.statements[0];
  assert.ok(first && ts.isIfStatement(first));
  assert.match(
    first.expression.getText(middleware),
    /this\.strategy\s*===\s*'development'/,
  );
  const registryTail = resolveMethod.body.statements.slice(1).flatMap(nodes);
  for (const node of [
    ...registryTail,
    ...nodes(resolver),
    ...nodes(repository),
  ]) {
    if (ts.isIdentifier(node))
      assert.ok(
        ![
          'developmentOrganizationId',
          'DEVELOPMENT_ORGANIZATION_ID',
          'body',
          'query',
          'cookies',
        ].includes(node.text),
        node.text,
      );
  }
  for (const node of all.filter(ts.isStringLiteral)) {
    assert.ok(
      !['organization-id', 'x-organization-id', 'x-tenant-id'].includes(
        node.text.toLowerCase(),
      ),
      'browser Organization header cannot be authority',
    );
  }
});
