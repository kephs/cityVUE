import { metricDimensions, type MetricLabels } from './telemetry-contracts.js';

export const metricLabelBudget = Object.freeze({
  maxLabels: 4,
  maxSeriesPerLabelSet: 256,
});
export type MetricLabelResult =
  | { readonly ok: true; readonly labels: MetricLabels }
  | {
      readonly ok: false;
      readonly reason:
        | 'invalid_shape'
        | 'unknown_attribute'
        | 'invalid_value'
        | 'cardinality_budget';
    };

/** Pure boundary validator. No value/key is echoed on rejection. The worst-case
 * Cartesian budget bounds a single schema's label combinations, not fleet-wide
 * series or the number of future instruments (which need separate review).
 * Copies own data properties only; never executes ordinary property getters.
 */
export const validateMetricLabels = (input: unknown): MetricLabelResult => {
  try {
    if (input === null || typeof input !== 'object')
      return { ok: false, reason: 'invalid_shape' };
    const prototype: unknown = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null)
      return { ok: false, reason: 'invalid_shape' };
    const keys = Reflect.ownKeys(input);
    if (keys.length > metricLabelBudget.maxLabels)
      return { ok: false, reason: 'cardinality_budget' };
    const labels: Record<string, string> = {};
    let series = 1;
    for (const key of keys) {
      if (typeof key !== 'string' || !Object.hasOwn(metricDimensions, key))
        return { ok: false, reason: 'unknown_attribute' };
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        !descriptor ||
        !Object.hasOwn(descriptor, 'value') ||
        !descriptor.enumerable
      )
        return { ok: false, reason: 'invalid_shape' };
      const value: unknown = descriptor.value;
      // Narrow key only after own-property membership, never inherited names.
      const allowed: readonly string[] =
        metricDimensions[key as keyof typeof metricDimensions];
      if (typeof value !== 'string' || !allowed.includes(value))
        return { ok: false, reason: 'invalid_value' };
      series *= allowed.length;
      if (series > metricLabelBudget.maxSeriesPerLabelSet)
        return { ok: false, reason: 'cardinality_budget' };
      labels[key] = value;
    }
    return { ok: true, labels: Object.freeze(labels) };
  } catch {
    // Reflective operations on hostile proxies may throw; never serialize errors.
    return { ok: false, reason: 'invalid_shape' };
  }
};
