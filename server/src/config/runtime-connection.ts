import {
  resolveDeploymentSchema,
  withoutConnectionOptions,
} from './operator-environment.js';

/**
 * ADR-027 F060.3C-2d. The runtime application's database connection posture.
 *
 * Deliberately a separate module from `database-roles.ts`, which holds the
 * migration side. A boundary test asserts that **no module in the runtime
 * graph so much as mentions `MIGRATION_DATABASE_URL`**, and the cleanest way
 * to keep that true is for the runtime not to import the code that reads it.
 * Separating the credentials in the database is only half the work; the
 * application must also be structurally unable to confuse them.
 *
 * The runtime keeps `DATABASE_URL`. What changes is the identity behind it —
 * `reqro_runtime`, which owns nothing — and the connection hygiene around it:
 * the deployment-owned schema is pinned at startup, and any
 * `search_path`-bearing `options` parameter is stripped from the URL first,
 * because F060.3C-2c-3 measured that a connection-string `options` value
 * **overrides** an explicit `options` key in a pool configuration.
 *
 * No secret is resolved or emitted here.
 */
export interface RuntimeConnection {
  /** The runtime credential, stripped of any `search_path` override. */
  readonly url: string;
  /** The deployment-owned application schema. */
  readonly schema: string;
  /** `options` string pinning that schema on the connection. */
  readonly connectionOptions: string;
}

export function resolveRuntimeConnection(
  url: string,
  environment: NodeJS.ProcessEnv,
): RuntimeConnection {
  const deployment = resolveDeploymentSchema(environment);
  return {
    url: withoutConnectionOptions(url),
    schema: deployment.schema,
    connectionOptions: deployment.connectionOptions,
  };
}
