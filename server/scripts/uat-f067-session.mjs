/**
 * F067 — the disposable UAT session CLI.
 *
 * This module is the executable entry. It gathers facts, prints and exits;
 * every decision it reports comes from `uat-f067-session-core.mjs`, which is
 * side-effect-free and is what the orchestrator and the effects depend on.
 *
 * **Nothing imports this file.** That is deliberate and enforced by test. The
 * shared definitions used to live here, so running the CLI suspended this
 * module's own evaluation on `await main()` while `main()` dynamically
 * imported the orchestrator and the effects -- both of which statically
 * imported this module. The cycle could not be linked, so the await never
 * settled and Node exited 13 silently. `--dry-run` worked only because it
 * never reached those imports.
 *
 * The core module removes that cycle. The entry invocation below is also
 * non-blocking, so even a future dependency cycle could not deadlock
 * evaluation: by the time `main()` runs, this module has finished evaluating.
 *
 * The shared definitions are re-exported unchanged, so existing importers and
 * tests keep working against this path.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  SERVER_ROOT,
  SESSION_FILE,
  describeSession,
  evaluateMigrationInventory,
  evaluateSessionRecord,
  redactUrl,
} from './uat-f067-session-core.mjs';

export * from './uat-f067-session-core.mjs';

/** The inventory this source tree declares, in applied order. */
export function readMigrationInventory(root = SERVER_ROOT) {
  const directory = resolve(root, 'migrations');
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => name.replace(/\.ts$/, ''))
    .sort();
}

function loadRecord(file = SESSION_FILE) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { corrupt: true };
  }
}

/** Persists identity only, and refuses an invalid record rather than writing it. */
export function saveRecord(record, file = SESSION_FILE) {
  const verdict = evaluateSessionRecord(record);
  if (!verdict.ok)
    throw new Error(
      `refusing to persist an invalid session record: ${verdict.reasons.join('; ')}`,
    );
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
}

const USAGE = `F067 isolated interactive UAT session harness

  start  --dry-run | --confirm   provision a disposable PostgreSQL session
  status                         report session identity and readiness
  end    --dry-run | --confirm   targeted teardown with verified absence

--dry-run prints the plan and touches nothing. --confirm performs the
operation and requires a separately authorized session. No tracking
credential is ever issued by this harness, and F065 automatic issuance is
never enabled by it.
`;

async function main(argv = process.argv.slice(2)) {
  const out = (text) => process.stdout.write(`${redactUrl(text)}\n`);
  const errOut = (text) => process.stderr.write(`${redactUrl(text)}\n`);
  const [command, mode] = argv;

  if (command === undefined || command === '--help' || command === 'help') {
    out(USAGE);
    return 0;
  }
  if (!['start', 'status', 'end'].includes(command)) {
    errOut(`unknown command ${String(command)}`);
    out(USAGE);
    return 2;
  }
  if (
    command !== 'status' &&
    !['--dry-run', '--confirm'].includes(mode ?? '')
  ) {
    errOut(`${command} requires an explicit --dry-run or --confirm`);
    return 2;
  }

  const required = readMigrationInventory();

  if (command === 'status') {
    const record = loadRecord();
    if (record === null) {
      out('state                no session recorded');
      return 0;
    }
    const described = describeSession(record);
    if (described.state === 'unknown') {
      errOut('state                unknown — the session record is not usable');
      for (const reason of described.reasons) errOut(`  - ${reason}`);
      return 1;
    }
    const inventory = evaluateMigrationInventory({
      required,
      expected: record.migrations,
      applied: null,
    });
    // Readiness is never asserted from the record alone: the recorded
    // container is re-inspected and, when the session secret is available,
    // in-band database identity is confirmed too. Live effects are built only
    // once a record exists, so a no-session status touches nothing.
    const { runStatus } = await import('./uat-f067-orchestrator.mjs');
    const { createLiveEffects } = await import('./uat-f067-effects.mjs');
    const effects = await createLiveEffects({ serverRoot: SERVER_ROOT });
    const result = await runStatus(effects, { inventory: required });
    for (const line of result.lines ?? described.lines) out(line);
    out(
      `source inventory     ${inventory.ok ? 'matches this session' : 'DIVERGED'}`,
    );
    for (const reason of inventory.reasons) errOut(`  - ${reason}`);
    out(`state                ${String(result.state)}`);
    for (const reason of result.reasons ?? []) errOut(`  - ${reason}`);
    return result.ok && inventory.ok ? 0 : 1;
  }

  if (mode === '--dry-run') {
    out(
      `${command}: dry run — nothing was created, migrated, seeded or removed.`,
    );
    out(`  session file       ${SESSION_FILE}`);
    out(`  migration count    ${String(required.length)}`);
    const inventory = evaluateMigrationInventory({
      required,
      expected: null,
      applied: [],
    });
    out(
      `  inventory          ${inventory.ok ? 'complete, F065 and F066 present' : 'INCOMPLETE'}`,
    );
    for (const reason of inventory.reasons) errOut(`  - ${reason}`);
    if (command === 'start') {
      out(
        '  would then         start a disposable cluster, verify instance identity,',
      );
      out(
        '                     refuse unless loopback / non-5432 / reqro_f0592_test / nonce / label match,',
      );
      out(
        '                     apply the full migration inventory, prepare synthetic fixtures,',
      );
      out('                     and hold the session open.');
    } else {
      const record = loadRecord();
      out(
        `  recorded session   ${record === null ? 'none' : String(record.container ?? 'unusable')}`,
      );
      out(
        '  would then         match the recorded container ID and nonce against the',
      );
      out(
        '                     ownership label, remove that container and its anonymous',
      );
      out('                     volume only, and verify both are absent.');
    }
    return inventory.ok ? 0 : 1;
  }

  // --confirm. The orchestration is implemented, but reaching it requires an
  // explicit out-of-band authorization variable. Without it the harness
  // refuses: that refusal, not the absence of code, is what keeps an
  // unauthorized invocation from provisioning or destroying anything.
  if (process.env.REQRO_F067_UAT_AUTHORIZED !== 'true') {
    errOut(
      `${command} --confirm requires an authorized F067 UAT session. Set REQRO_F067_UAT_AUTHORIZED=true only under explicit authorization; this build performs no container, migration, seeding, fixture or removal operation without it.`,
    );
    errOut(
      'Re-run with --dry-run to see the exact plan, or obtain authorization for a live session.',
    );
    return 3;
  }

  const { runStart, runEnd } = await import('./uat-f067-orchestrator.mjs');
  const { createLiveEffects } = await import('./uat-f067-effects.mjs');
  const effects = await createLiveEffects({ serverRoot: SERVER_ROOT });
  const result =
    command === 'start'
      ? await runStart(effects, { inventory: required })
      : await runEnd(effects);
  for (const reason of result.reasons ?? []) errOut(`  - ${reason}`);
  if (!result.ok) {
    errOut(`${command}: ${String(result.state).toUpperCase()}`);
    return 1;
  }
  out(`${command}: ${String(result.state)}`);
  if (result.windowsCaveat) out(`note  ${String(result.windowsCaveat)}`);
  return 0;
}

export { main };

// Non-blocking on purpose. `process.exit(await main())` suspended this
// module's evaluation for as long as `main()` ran, which is what let a
// dependency cycle deadlock linking and exit 13 in silence. Starting `main()`
// after evaluation completes delivers the same exit code and removes that
// failure mode entirely, independently of the module topology.
const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(entry).href === import.meta.url)
  main().then(
    (code) => process.exit(code),
    (error) => {
      // Matches the previous behaviour: an unexpected throw is fatal and its
      // message is redacted, because a connection string can reach it.
      process.stderr.write(`${redactUrl(String(error?.message ?? error))}\n`);
      process.exit(1);
    },
  );
