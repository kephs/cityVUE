import type { INestApplication } from '@nestjs/common';

/**
 * HTTP listener address policy (SEC-002).
 *
 * Production keeps its existing listener: `listen(port)` with no host, so the
 * container accepts traffic from its ingress exactly as before. Every other
 * NODE_ENV — development, test, or a value that is missing or unrecognised —
 * listens on IPv4 loopback only, so a workstation API is never reachable from
 * the network whatever the host firewall allows. There is deliberately no
 * override: no environment variable can widen a non-production listener.
 */
export const LOOPBACK_LISTEN_HOST = '127.0.0.1';

/** The host to pass to `listen`, or undefined for the unchanged production
 * listener. Only the exact string 'production' leaves loopback. */
export function resolveListenHost(environment: unknown): string | undefined {
  return environment === 'production' ? undefined : LOOPBACK_LISTEN_HOST;
}

export interface ListenSettings {
  readonly port: number;
  /** Validated `app.environment`, i.e. NODE_ENV. */
  readonly environment: unknown;
}

export interface Listening {
  readonly port: number;
  readonly host?: string;
}

/** The API's only listener call, used by `main.ts`. */
export async function listenApplication(
  app: Pick<INestApplication, 'listen'>,
  settings: ListenSettings,
): Promise<Listening> {
  const host = resolveListenHost(settings.environment);
  if (host === undefined) {
    await app.listen(settings.port);
    return { port: settings.port };
  }
  await app.listen(settings.port, host);
  return { port: settings.port, host };
}
