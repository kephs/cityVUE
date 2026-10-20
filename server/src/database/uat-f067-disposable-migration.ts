/**
 * F067 — migration execution for a disposable UAT database.
 *
 * The orchestration commit drove Kysely's `Migrator` in process from an
 * `.mjs` script with `FileMigrationProvider` pointed at `migrations/`, which
 * holds TypeScript. Under plain Node 20 those imports cannot resolve at all,
 * so the live session would have failed at its migration phase every time.
 * The fault was invisible because the phase had never been executed.
 *
 * The correction is to run migrations the way the application already runs
 * them: through `tsx`, over the `migrations/` source directory, with Kysely's
 * `FileMigrationProvider`. That is the established TypeScript-aware mechanism
 * and it discovers every migration, including the four that are never
 * compiled into `dist-test` because no schema-isolated test can import them.
 *
 * `migration-cli.ts` itself is deliberately NOT reused. It assumes the
 * deployment owner role with `SET ROLE` and asserts, through
 * `assertMigrationLoginSeparate` and `assertMigrationRoleAssumed`, that the
 * migration login and the owner role are distinct identities. A disposable
 * cluster has one generated role that owns its own database and no separate
 * owner, so satisfying that CLI would mean creating deployment roles inside a
 * throwaway container or relaxing those assertions. Both are refused: the
 * persistent-database migration guards stay exactly as they are, and this
 * module carries its own, stricter gate for a different target.
 *
 * That gate is `evaluateFixtureTarget`: loopback host, a published port that
 * is not 5432, the database named exactly `reqro_f0592_test`, the disposable
 * role, and the in-band `reqro.disposable_nonce` matching the nonce this
 * session injected through `docker run`. `reqro_dev` and `reqro_bootstrap` are
 * refused by name. The gate runs before the first migration, so a misdirected
 * invocation cannot apply a single statement.
 *
 * The connection string is read from one dedicated variable. `DATABASE_URL` is
 * never consulted, so a populated `server/.env` cannot redirect this at a
 * persistent database by default.
 */
import {
  evaluateFixtureTarget,
  type FixtureTargetFacts,
  type Verdict,
} from './uat-f067-tracking-fixture.js';

/** The only variable this runner will take a connection string from. */
export const DISPOSABLE_MIGRATION_URL_VARIABLE = 'REQRO_F067_UAT_DATABASE_URL';
export const DISPOSABLE_MIGRATION_NONCE_VARIABLE =
  'REQRO_F067_UAT_DISPOSABLE_NONCE';
export const DISPOSABLE_MIGRATION_ROLE_VARIABLE =
  'REQRO_F067_UAT_DISPOSABLE_ROLE';

export interface MigrationExecution {
  /** Migrations the framework reported as successfully applied. */
  readonly applied: readonly string[];
  /** A sanitized framework error, or null. Never a connection string. */
  readonly error: string | null;
}

/**
 * Compares what the repository declares with what was applied.
 *
 * A framework error, a missing migration and an applied migration nobody
 * declared are all refusals. Partial success is never success: a schema that
 * is missing one migration is a schema the UAT cannot trust, and migration 49
 * alone decides whether the staff tracking endpoint can take a row lock.
 */
export function evaluateMigrationCompleteness(input: {
  readonly declared: readonly string[] | null | undefined;
  readonly applied: readonly string[] | null | undefined;
  readonly error?: string | null;
}): Verdict {
  const reasons: string[] = [];
  const declared = Array.isArray(input.declared) ? input.declared : null;
  const applied = Array.isArray(input.applied) ? input.applied : null;
  if (declared === null)
    return {
      ok: false,
      reasons: ['the declared migration inventory is unreadable'],
    };
  if (applied === null)
    return { ok: false, reasons: ['the applied migration list is unreadable'] };
  if (declared.length === 0)
    reasons.push(
      'the repository declares no migrations, which cannot be right',
    );
  if (typeof input.error === 'string' && input.error !== '')
    reasons.push(`the migration framework reported an error: ${input.error}`);
  const missing = declared.filter((name) => !applied.includes(name));
  if (missing.length)
    reasons.push(
      `${String(missing.length)} declared migration(s) were not applied: ${missing.join(', ')}`,
    );
  const unexpected = applied.filter((name) => !declared.includes(name));
  if (unexpected.length)
    reasons.push(
      `${String(unexpected.length)} applied migration(s) are not declared by the repository: ${unexpected.join(', ')}`,
    );
  return { ok: reasons.length === 0, reasons };
}

export interface DisposableMigrationEffects {
  /** Reads database, role and the in-band nonce from the server itself. */
  readonly readTargetFacts: () => Promise<FixtureTargetFacts>;
  /** The migration identities the repository declares, from source. */
  readonly readDeclaredMigrations: () => Promise<readonly string[]>;
  /** Extension preparation, run only after the gate passes. */
  readonly prepareExtensions: () => Promise<void>;
  /** Applies every pending migration. */
  readonly migrate: () => Promise<MigrationExecution>;
}

export interface DisposableMigrationResult {
  readonly ok: boolean;
  readonly reasons: readonly string[];
  readonly declared: readonly string[];
  readonly applied: readonly string[];
}

/**
 * Gate, prepare, migrate, then verify completeness.
 *
 * Every effect is injected, so the whole sequence is exercised offline and a
 * mock that was never called is the proof that a refused target applied
 * nothing. A thrown effect is converted into a refusal rather than escaping,
 * so the caller always receives a verdict instead of sometimes a verdict and
 * sometimes an exception.
 */
export async function runDisposableMigration(
  effects: DisposableMigrationEffects,
): Promise<DisposableMigrationResult> {
  const empty = {
    declared: [] as readonly string[],
    applied: [] as readonly string[],
  };
  let facts: FixtureTargetFacts;
  try {
    facts = await effects.readTargetFacts();
  } catch (error) {
    return {
      ...empty,
      ok: false,
      reasons: [`the disposable target could not be read: ${message(error)}`],
    };
  }
  const refusal = evaluateFixtureTarget(facts);
  if (refusal !== null)
    return {
      ...empty,
      ok: false,
      reasons: [`the migration target was refused: ${refusal}`],
    };

  let declared: readonly string[];
  try {
    declared = await effects.readDeclaredMigrations();
  } catch (error) {
    return {
      ...empty,
      ok: false,
      reasons: [
        `the declared migration inventory could not be read: ${message(error)}`,
      ],
    };
  }

  try {
    await effects.prepareExtensions();
  } catch (error) {
    return {
      ...empty,
      declared,
      ok: false,
      reasons: [`database extensions could not be prepared: ${message(error)}`],
    };
  }

  let execution: MigrationExecution;
  try {
    execution = await effects.migrate();
  } catch (error) {
    return {
      ...empty,
      declared,
      ok: false,
      reasons: [`migration execution failed: ${message(error)}`],
    };
  }
  // Defensive despite the type: the effect is injected and a malformed
  // result must be refused rather than read as "nothing was applied".
  const applied = Array.isArray(execution.applied) ? execution.applied : null;
  const verdict = evaluateMigrationCompleteness({
    declared,
    applied,
    error: execution.error,
  });
  return {
    ok: verdict.ok,
    reasons: verdict.reasons,
    declared,
    applied: applied ?? [],
  };
}

/** A message with no connection string in it. The URL is never interpolated
 * into a reason anywhere above, so only the framework's own text can appear,
 * and a credential-bearing URL is stripped if one ever reaches here. */
function message(error: unknown): string {
  const text =
    error instanceof Error ? error.message : 'a non-error failure was thrown';
  return text.replace(/postgres(?:ql)?:\/\/[^\s]*/gi, '[redacted-url]');
}
