import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath, URL } from 'node:url';
import ts from 'typescript';

const config = fileURLToPath(
  new URL('../tsconfig.build.json', import.meta.url),
);
const entry = fileURLToPath(new URL('../dist/main.js', import.meta.url));
const diagnosticHost = {
  getCanonicalFileName: (name) => name,
  getCurrentDirectory: ts.sys.getCurrentDirectory,
  getNewLine: () => ts.sys.newLine,
};
const report = (diagnostic) =>
  process.stderr.write(ts.formatDiagnostic(diagnostic, diagnosticHost));

function emit(program, write = () => program.emit()) {
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (
    diagnostics.some((item) => item.category === ts.DiagnosticCategory.Error)
  ) {
    diagnostics.forEach(report);
    return false;
  }
  const result = write();
  result.diagnostics.forEach(report);
  return (
    !result.emitSkipped &&
    !result.diagnostics.some(
      (item) => item.category === ts.DiagnosticCategory.Error,
    )
  );
}

// A bounded smoke check uses the same compiler/config as watch mode, without
// opening a port or leaving watchers behind. No database operation is performed.
if (process.argv.includes('--check')) {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    config,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: report,
    },
  );
  if (!parsed || parsed.errors.length) {
    parsed?.errors.forEach(report);
    process.exitCode = 1;
  } else if (!emit(ts.createProgram(parsed.fileNames, parsed.options))) {
    process.exitCode = 1;
  } else {
    await import('reflect-metadata');
    const { NestFactory } = await import('@nestjs/core');
    const { AppModule } = await import('../dist/app.module.js');
    const { configureApplication } = await import('../dist/bootstrap.js');
    const app = await NestFactory.create(AppModule, {
      logger: false,
      abortOnError: false,
    });
    try {
      configureApplication(app);
      await app.init();
      process.stdout.write('Development application initialization passed.\n');
    } finally {
      await app.close();
    }
  }
} else {
  let child;
  let stopping = false;
  let pending = Promise.resolve();
  async function stopChild() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
  const host = ts.createWatchCompilerHost(
    config,
    { noEmitOnError: true },
    ts.sys,
    ts.createEmitAndSemanticDiagnosticsBuilderProgram,
    report,
    report,
  );
  host.afterProgramCreate = (builder) => {
    if (!emit(builder.getProgram(), () => builder.emit())) return;
    // Restart only after a complete successful emit; never run partial output.
    pending = pending.then(async () => {
      await stopChild();
      if (!stopping) {
        child = spawn(process.execPath, [entry], { stdio: 'inherit' });
        child.on('error', () => {
          process.stderr.write('Development server process could not start.\n');
        });
      }
    });
  };
  const watcher = ts.createWatchProgram(host);
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    watcher.close();
    await pending;
    await stopChild();
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
