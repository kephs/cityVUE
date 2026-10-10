import { validateMetricLabels } from '../observability/metric-label-policy.js';
import {
  metricConcepts,
  type MetricConcept,
  type MetricLabels,
} from '../observability/telemetry-contracts.js';
import type { AttemptOutcome } from './delivery-contract.js';
import type { IntegrationFailureCategory } from './integration-envelope.js';

/**
 * F062.1 — integration telemetry **semantics only**.
 *
 * **F061 owns telemetry privacy and cardinality; F062 owns integration
 * meaning.** An earlier draft of this module maintained its own permitted and
 * prohibited label lists, which was a competing policy and — worse — it was
 * wrong: it listed `connectorId` as a *permitted* metric label, while F061.1
 * classifies `connectorId` as a `restrictedAttribute` whose
 * `restrictedAttributePolicy.metricLabels` is `forbidden`. That draft would
 * have emitted a label the platform policy forbids. The independent policy is
 * removed and this module now **delegates to F061.1's validator**, so there is
 * exactly one authority for what may become a label.
 *
 * What remains here is the part F061 cannot own: how integration concepts —
 * delivery outcomes, failure categories — *map onto* the dimensions F061
 * permits. That mapping is integration knowledge.
 *
 * **Dependency direction.** integration → observability contract, never the
 * reverse. F061.1 imports nothing from F062 and is unaware of it. Importing
 * Reqro's own provider-neutral telemetry policy is not a vendor dependency:
 * both F061.1 modules are dependency-free, so no OpenTelemetry SDK, Azure
 * Monitor, Application Insights, exporter or cloud monitoring schema enters
 * the graph. The boundary suite asserts the external import set is still
 * empty and admits only these two reviewed observability modules.
 */

/**
 * The integration metric concepts, drawn from F061.1's authoritative
 * `metricConcepts` rather than redeclared.
 *
 * Typed as `MetricConcept` so a name F061 does not define cannot be used, and
 * so a rename there is a compile error here rather than a silent divergence.
 */
export const INTEGRATION_METRIC_CONCEPTS = [
  'integration_delivery_latency',
  'integration_retry_count',
  'integration_dead_letter_count',
  'integration_reconciliation_failure',
  'integration_connector_health',
] as const satisfies readonly MetricConcept[];

export type IntegrationMetricConcept =
  (typeof INTEGRATION_METRIC_CONCEPTS)[number];

/** Unit, read from F061.1's declaration rather than restated. */
export function integrationMetricUnit(
  concept: IntegrationMetricConcept,
): (typeof metricConcepts)[IntegrationMetricConcept] {
  return metricConcepts[concept];
}

export function isIntegrationMetricConcept(
  value: string,
): value is IntegrationMetricConcept {
  return (INTEGRATION_METRIC_CONCEPTS as readonly string[]).includes(value);
}

/**
 * Maps an integration attempt outcome onto F061.1's `outcome` dimension.
 *
 * `ambiguous` deliberately maps to `pending` rather than `failed` or
 * `succeeded`: an ambiguous attempt is unresolved, and reporting it as either
 * would assert something nobody observed. The distinction survives in full in
 * the queryable delivery record; the metric carries only the bounded
 * dimension F061 permits.
 */
export function outcomeDimension(
  outcome: AttemptOutcome,
): NonNullable<MetricLabels['outcome']> {
  switch (outcome) {
    case 'succeeded':
      return 'succeeded';
    case 'failed_transient':
    case 'failed_permanent':
      return 'failed';
    case 'ambiguous':
      return 'pending';
  }
}

/**
 * Maps an integration failure category onto F061.1's `reason` dimension.
 *
 * The integration taxonomy is finer than F061's `reason`, and that is
 * correct: a metric needs a bounded dimension, while the precise category
 * belongs in the delivery record. Categories with no closer F061 value map to
 * `unknown` rather than inventing a dimension value F061 does not define.
 */
export function failureReasonDimension(
  category: IntegrationFailureCategory,
): NonNullable<MetricLabels['reason']> {
  switch (category) {
    case 'destination_timeout':
      return 'timeout';
    case 'destination_unavailable':
    case 'rate_limited':
      return 'dependency_unavailable';
    case 'authentication_failed':
      return 'invalid_authority';
    case 'destination_unconfigured':
      return 'registry_unavailable';
    case 'destination_rejected':
    case 'projection_failed':
    case 'contract_unsupported':
    case 'malformed_request':
    case 'internal_failure':
      return 'unknown';
  }
}

/** The component and dependency class integration work reports under, both
 * already defined by F061.1. */
export const INTEGRATION_COMPONENT =
  'integration' as const satisfies NonNullable<MetricLabels['component']>;
export const INTEGRATION_DEPENDENCY_CLASS =
  'integration' as const satisfies NonNullable<MetricLabels['dependencyClass']>;

/**
 * The narrow port F061 implements.
 *
 * Labels are F061.1's `MetricLabels`, so the permitted dimensions are F061's
 * closed set and nothing here can widen them.
 */
export interface IntegrationTelemetryPort {
  record(
    concept: IntegrationMetricConcept,
    labels: MetricLabels,
    value: number,
  ): void;
}

/**
 * Validates a label set by **delegating to F061.1**.
 *
 * No independent policy: unknown dimensions, out-of-vocabulary values, the
 * label-count budget and the cardinality budget are all F061's rules. The
 * rejection reason is passed through without echoing any key or value, which
 * is F061's own discipline.
 */
export function assertIntegrationLabels(labels: unknown): MetricLabels {
  const result = validateMetricLabels(labels);
  if (!result.ok)
    throw new Error(
      `Invalid integration telemetry labels: ${result.reason} (metric label policy is owned by F061)`,
    );
  return result.labels;
}

/**
 * The default port: records nothing.
 *
 * **Deliberately not a zero-reporting implementation.** F061 requires that
 * unimplemented queue and delivery SLIs be marked *not implemented* and never
 * reported as green or as zero failures. A no-op emitting zeros would read as
 * health; emitting nothing cannot. Until F062.2 exists there is no integration
 * work to measure, so there is nothing to report.
 */
export const NO_TELEMETRY: IntegrationTelemetryPort = {
  record: () => undefined,
};

/** Whether integration SLIs may be presented as healthy. Always false in this
 * slice: nothing is implemented, so nothing may read as green. */
export function integrationSlisImplemented(): false {
  return false;
}
