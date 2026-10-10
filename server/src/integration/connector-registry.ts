import type { ConnectorCapabilities } from './connector-capabilities.js';
import type {
  AttemptOutcome,
  ConnectorLifecycleState,
} from './delivery-contract.js';
import type {
  IntegrationEnvelope,
  IntegrationFailureCategory,
} from './integration-envelope.js';
import type { SupportedTypeVersions } from './schema-compatibility.js';

/**
 * F062.1 — the connector port and an intentionally **empty** registry.
 *
 * **No connector exists, and none may be added in this slice.** The registry
 * ships empty for the same reason ADR-026's provider registry does: the shape
 * can be reviewed and the boundary proven before any transport, credential or
 * vendor contract is introduced. An empty registry that fails closed is a
 * completed deliverable, not a placeholder.
 *
 * **There is no transport here.** `ConnectorPort.dispatch` is a type. No
 * implementation exists, nothing in this module performs I/O, and the boundary
 * suite asserts the module graph reaches no HTTP client, database, queue,
 * credential source or vendor SDK.
 */

/** The projection a connector receives: already-resolved, minimal, and
 * produced outside the connector so an adapter cannot widen it. Opaque here
 * because its field set is declared per connector in a later slice. */
export interface ConnectorProjection {
  readonly fields: Readonly<Record<string, string | number | boolean | null>>;
}

/** Non-identifying per-attempt context. Carries no credential, no payload and
 * no resident value. */
export interface DispatchContext {
  readonly attempt: number;
  readonly idempotencyKey: string | null;
  readonly signal: AbortSignal;
}

export interface ConnectorOutcome {
  readonly outcome: AttemptOutcome;
  /** Destination-assigned identity, used later to correlate a callback. */
  readonly externalReference: string | null;
  readonly failureCategory: IntegrationFailureCategory | null;
  readonly durationMs: number;
}

/** The port every connector implements. Declared, never assumed. */
export interface ConnectorPort {
  readonly connectorId: string;
  readonly capabilities: ConnectorCapabilities;
  readonly supportedVersions: readonly SupportedTypeVersions[];
  readonly lifecycleState: ConnectorLifecycleState;
  dispatch(
    envelope: IntegrationEnvelope,
    projection: ConnectorProjection,
    context: DispatchContext,
  ): Promise<ConnectorOutcome>;
}

export const connectorResolutionFailures = [
  'connector_unknown',
  'connector_retired',
] as const;
export type ConnectorResolutionFailure =
  (typeof connectorResolutionFailures)[number];

export type ConnectorResolution =
  | { readonly resolved: true; readonly connector: ConnectorPort }
  | {
      readonly resolved: false;
      readonly failure: ConnectorResolutionFailure;
    };

/**
 * The connector registry.
 *
 * **Fails closed, with no fallback of any kind.** There is deliberately no
 * default connector, no catch-all, no "first registered" behaviour and no
 * substitution on miss. An unknown connector id resolves to a refusal that
 * the caller must handle — a shared fallback destination is how one tenant's
 * data reaches another, and a silent substitution is how an envelope reaches
 * a destination nobody authorized.
 *
 * `resolve` returns a discriminated result rather than throwing or returning
 * `undefined`, so a caller cannot ignore a miss by accident.
 */
export class ConnectorRegistry {
  private readonly connectors: ReadonlyMap<string, ConnectorPort>;

  /** Constructed empty by default. This slice registers nothing; the
   * parameter exists so a later slice can supply connectors without changing
   * the shape, and so tests can prove registration behaviour without a
   * vendor adapter. */
  constructor(connectors: readonly ConnectorPort[] = []) {
    const map = new Map<string, ConnectorPort>();
    for (const connector of connectors) {
      if (map.has(connector.connectorId))
        throw new Error(
          'Invalid integration configuration: duplicate connector identifier',
        );
      map.set(connector.connectorId, connector);
    }
    this.connectors = map;
  }

  get size(): number {
    return this.connectors.size;
  }

  /** Registered identifiers, for operator visibility and for the boundary
   * assertion that this slice registers none. */
  registeredIds(): readonly string[] {
    return [...this.connectors.keys()].sort();
  }

  resolve(connectorId: string): ConnectorResolution {
    const connector = this.connectors.get(connectorId);
    if (connector === undefined)
      return { resolved: false, failure: 'connector_unknown' };
    // A retired connector is terminal: it must not quietly resume and flush a
    // months-old backlog at a destination.
    if (connector.lifecycleState === 'retired')
      return { resolved: false, failure: 'connector_retired' };
    return { resolved: true, connector };
  }
}

/** The registry this slice ships: empty, and provably so. */
export const EMPTY_CONNECTOR_REGISTRY = new ConnectorRegistry();
