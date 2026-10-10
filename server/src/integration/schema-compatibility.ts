import {
  INTEGRATION_TYPES,
  type IntegrationType,
} from './integration-envelope.js';

/**
 * F062.1 — schema version negotiation.
 *
 * **Unsupported versions fail safely rather than being guessed.** If no
 * mutually supported version exists the envelope is refused with an operator
 * signal; it is never silently downgraded to a version whose meaning differs,
 * and never dispatched best-effort. A silent downgrade is a semantic
 * corruption disguised as resilience.
 *
 * The rules this implements (F062 Part 7):
 *
 * - additive optional fields are *normally* backward compatible, and only
 *   normally — the guarantee depends on consumers ignoring unknown fields,
 *   which is a contract obligation rather than an assumption;
 * - a change in semantic meaning requires a new version even when the field
 *   shape is untouched, because no schema check detects it;
 * - removal or rename requires deprecation, never immediate removal;
 * - connectors declare the versions they accept, per type;
 * - a replayed immutable event keeps the version of the original intent.
 */

export const versionNegotiationOutcomes = [
  'negotiated',
  'type_not_supported',
  'no_mutual_version',
  'version_deprecated_and_unsupported',
] as const;
export type VersionNegotiationOutcome =
  (typeof versionNegotiationOutcomes)[number];

/** What a connector accepts for one integration type. */
export interface SupportedTypeVersions {
  readonly type: IntegrationType;
  /** Accepted versions. An empty list means the type is not supported, which
   * is distinct from the type being absent from the declaration. */
  readonly versions: readonly number[];
}

export type VersionNegotiation =
  | { readonly outcome: 'negotiated'; readonly version: number }
  | { readonly outcome: Exclude<VersionNegotiationOutcome, 'negotiated'> };

/**
 * Chooses the version to emit for a *new* dispatch: the highest version the
 * connector accepts that Reqro also declares for the type.
 *
 * Highest-mutual rather than newest-available, because emitting a version the
 * connector does not accept is the failure this negotiation exists to avoid.
 */
export function negotiateVersion(
  type: IntegrationType,
  supported: readonly SupportedTypeVersions[],
): VersionNegotiation {
  const declaration = supported.find((entry) => entry.type === type);
  if (declaration === undefined) return { outcome: 'type_not_supported' };

  // Reqro currently declares exactly one version per type. Typed as a number
  // list rather than the inferred literal so adding a second version later
  // needs no change here.
  const reqroVersions: readonly number[] = [
    INTEGRATION_TYPES[type].schemaVersion,
  ];
  const mutual = declaration.versions
    .filter((version) => reqroVersions.includes(version))
    .sort((left, right) => right - left);

  const [highest] = mutual;
  if (highest === undefined) return { outcome: 'no_mutual_version' };
  return { outcome: 'negotiated', version: highest };
}

/**
 * Whether a **replay** of an immutable event may proceed.
 *
 * A replay reproduces the original integration intent, so it must use the
 * version recorded on the envelope — not today's newest. If the connector no
 * longer accepts that version the replay **refuses** rather than re-encoding
 * the intent into a newer contract, because re-encoding would change what the
 * replay means.
 */
export function negotiateReplayVersion(
  type: IntegrationType,
  recordedVersion: number,
  supported: readonly SupportedTypeVersions[],
): VersionNegotiation {
  const declaration = supported.find((entry) => entry.type === type);
  if (declaration === undefined) return { outcome: 'type_not_supported' };
  if (!declaration.versions.includes(recordedVersion))
    return { outcome: 'version_deprecated_and_unsupported' };
  return { outcome: 'negotiated', version: recordedVersion };
}

/**
 * Classification of a proposed contract change, so the compatibility rules
 * are callable rather than only documented.
 */
export const schemaChangeKinds = [
  'additive_optional',
  'semantic_meaning_change',
  'removal_or_rename',
  'type_narrowing',
  'optional_to_required',
] as const;
export type SchemaChangeKind = (typeof schemaChangeKinds)[number];

/** Whether a change may ship without a version bump. Only an additive
 * optional field may, and only because consumers are contractually obliged to
 * ignore unknown fields. */
export function requiresVersionBump(change: SchemaChangeKind): boolean {
  return change !== 'additive_optional';
}

/** Whether a change additionally requires a deprecation window rather than
 * only a new version. */
export function requiresDeprecationWindow(change: SchemaChangeKind): boolean {
  return change === 'removal_or_rename';
}
