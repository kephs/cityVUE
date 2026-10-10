import type { AggregateType, EventOrigin } from './integration-envelope.js';

/**
 * F062.1 — the fact-authority contract.
 *
 * **The rule this module exists to enforce:**
 *
 * > `origin` and `causationId` are loop-prevention evidence. They are **not
 * > authorization.**
 *
 * An inbound delivery that is correctly signed, correctly deduplicated,
 * correctly tenant-scoped and demonstrably not an echo is *still not*
 * permitted to write a fact its system does not own. Those checks establish
 * **who is speaking and that we have not heard it before** — a different
 * question from **whether this speaker may assert this fact**. Conflating them
 * would let any authenticated connector write anything, which is the
 * integration equivalent of treating authentication as authorization.
 *
 * Authority is therefore **declared data that is checked per field**, not a
 * convention. One inbound payload may legitimately carry an authoritative
 * field and a non-authoritative one; the correct behaviour is to apply the
 * first and refuse the second as a distinct, visible outcome.
 */

/** Who owns a fact. `reqro` facts have no inbound write path at all — the
 * absence is structural, not a permission check that could be misconfigured. */
export type FactAuthority =
  | { readonly kind: 'reqro' }
  | { readonly kind: 'connector'; readonly connectorId: string };

/** A fact identified neutrally: an aggregate and a field on it. No vendor
 * field name appears here; a connector maps its own schema to these. */
export interface FactRef {
  readonly aggregateType: AggregateType;
  readonly field: string;
}

/** A declaration binding one fact to exactly one authority. */
export interface FactAuthorityDeclaration {
  readonly fact: FactRef;
  readonly authority: FactAuthority;
}

export const factAuthorityRefusalCodes = [
  'authority_undeclared',
  'authority_mismatch',
  'reqro_owned_fact',
  'declaration_conflict',
] as const;
export type FactAuthorityRefusalCode =
  (typeof factAuthorityRefusalCodes)[number];

export class FactAuthorityRefusal extends Error {
  constructor(
    readonly code: FactAuthorityRefusalCode,
    message: string,
  ) {
    super(message);
    this.name = 'FactAuthorityRefusal';
  }
}

const factKey = (fact: FactRef) => `${fact.aggregateType}.${fact.field}`;

/**
 * An immutable, conflict-free authority map.
 *
 * Built once from declarations. **Exactly one writer per fact** is enforced at
 * construction: two declarations for the same fact are a `declaration_conflict`
 * rather than a last-one-wins merge, because dual-master ambiguity introduced
 * by configuration order would be invisible at the point of use.
 */
export class FactAuthorityRegistry {
  private readonly byFact: ReadonlyMap<string, FactAuthority>;

  constructor(declarations: readonly FactAuthorityDeclaration[]) {
    const map = new Map<string, FactAuthority>();
    for (const declaration of declarations) {
      const key = factKey(declaration.fact);
      if (map.has(key))
        throw new FactAuthorityRefusal(
          'declaration_conflict',
          'a fact may have exactly one declared authority',
        );
      map.set(key, declaration.authority);
    }
    this.byFact = map;
  }

  /** The declared authority, or undefined when the fact is undeclared.
   * Undeclared is **not** permissive — see {@link assertMayWriteFact}. */
  authorityFor(fact: FactRef): FactAuthority | undefined {
    return this.byFact.get(factKey(fact));
  }

  /**
   * Whether an inbound write from this origin may modify this fact.
   *
   * Returns a reason rather than a bare boolean so a refusal can be reported
   * with its cause: an out-of-authority write is a **security-relevant event**
   * — a destination sending more than its contract allows, or a connector
   * mapping fields wrongly — not a data-quality one.
   */
  mayWriteFact(
    origin: EventOrigin,
    fact: FactRef,
  ):
    | { readonly permitted: true }
    | { readonly permitted: false; readonly code: FactAuthorityRefusalCode } {
    const authority = this.authorityFor(fact);
    // Fail closed on an undeclared fact. Defaulting to permitted would make
    // every future field writable by any connector until somebody remembered
    // to declare it.
    if (authority === undefined)
      return { permitted: false, code: 'authority_undeclared' };
    if (authority.kind === 'reqro')
      return { permitted: false, code: 'reqro_owned_fact' };
    if (origin.kind !== 'external')
      return { permitted: false, code: 'authority_mismatch' };
    return origin.connectorId === authority.connectorId
      ? { permitted: true }
      : { permitted: false, code: 'authority_mismatch' };
  }
}

/** Throwing form, for call sites that treat a refusal as exceptional. */
export function assertMayWriteFact(
  registry: FactAuthorityRegistry,
  origin: EventOrigin,
  fact: FactRef,
): void {
  const decision = registry.mayWriteFact(origin, fact);
  if (!decision.permitted)
    throw new FactAuthorityRefusal(
      decision.code,
      'the connector is not the declared authority for this fact',
    );
}

/**
 * Loop prevention, kept deliberately separate from authority.
 *
 * An envelope whose origin is `external:{c}` must not produce an outbound
 * envelope back to connector `c`. This is checked structurally rather than
 * relying on a connector to notice its own echo.
 *
 * **This function answers only "is this an echo?".** It is not and must never
 * be used as an authorization check — which is why it lives next to
 * {@link FactAuthorityRegistry} but is not a method on it.
 */
export function wouldEcho(
  origin: EventOrigin,
  targetConnectorId: string,
): boolean {
  return origin.kind === 'external' && origin.connectorId === targetConnectorId;
}

/**
 * AI remains an actor, never an authority.
 *
 * An AI-driven workflow may cause a domain mutation through the same
 * authorized APIs as any other caller, and the resulting envelope is
 * attributed through `origin` like any other. What it must never be is a
 * declared {@link FactAuthority}: there is deliberately no `ai` variant,
 * so no fact can be owned by a model. Authority belongs to systems of record
 * and to Reqro, and an AI proposal requires the same human approval any other
 * privileged action does.
 *
 * Exported as an assertion so the property is testable rather than only
 * documented.
 */
export function factAuthorityKinds(): readonly string[] {
  return ['reqro', 'connector'];
}
