import { Resolver } from 'node:dns/promises';
import { challengeHash, matchesChallenge } from './tenant-domain-challenge.js';

/** ADR-025 authoritative DNS ownership verification.
 *
 * Operator-triggered only. Nothing on the resident request path reaches this
 * module, and it performs DNS queries only — never an HTTP fetch — so the
 * outbound-fetch surface recorded in ADR-019 stays out of scope.
 *
 * Queries go to the zone's authoritative name servers rather than a
 * recursive resolver, so a stale cache cannot satisfy a challenge and
 * off-path cache poisoning does not reach the decision.
 */

/** `challenge_expired` is never produced by `observeVerification`: expiry is
 * decided against the database clock, not against DNS. It belongs to this
 * union because it is a recorded attempt result like any other. */
export type VerificationResult =
  | 'verified'
  | 'challenge_expired'
  | 'no_record'
  | 'value_mismatch'
  | 'disagreement'
  | 'insufficient_quorum'
  | 'unreachable'
  | 'timeout'
  | 'nxdomain'
  | 'servfail'
  | 'zone_undetermined';

/** What the attempt record stores. Raw DNS payloads are deliberately absent,
 * as are resolver IP addresses: name-server *names* carry the meaning. */
export interface VerificationObservation {
  readonly result: VerificationResult;
  readonly recordName: string;
  readonly expectedChallengeHash: string;
  readonly observedValueHash: string | null;
  readonly observedValueCount: number;
  readonly nameServers: readonly string[];
  readonly agreementCount: number;
  readonly degradedSingleNs: boolean;
  readonly ttlSeconds: number | null;
  readonly dnssec: DnssecObservation;
}

/**
 * Node's standard resolver cannot request or check RRSIG/DNSKEY records and
 * performs no signature validation, so `validated` is always `false` here and
 * `observed` is `false` unless a future validating resolver supplies it.
 *
 * No security decision may depend on an unvalidated AD bit. The shape exists
 * so a validating implementation can populate it without a schema change.
 */
export interface DnssecObservation {
  readonly observed: boolean;
  readonly validated: false;
  readonly reason: string;
}

const UNOBSERVABLE_DNSSEC: DnssecObservation = {
  observed: false,
  validated: false,
  reason: 'node_standard_resolver_cannot_validate_dnssec',
};

export interface TxtAnswer {
  readonly values: readonly string[];
  readonly ttlSeconds: number | null;
}

/** Per-server outcome, so the caller can tell "absent" from "unreachable". */
export type ServerAnswer =
  | { readonly kind: 'answer'; readonly answer: TxtAnswer }
  | { readonly kind: 'absent' }
  | { readonly kind: 'nxdomain' }
  | { readonly kind: 'servfail' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'unreachable' };

/** The seam that keeps the quorum logic testable without a network. */
export interface DnsPort {
  /** Authoritative name-server names for the closest enclosing zone, walking
   * up from the queried name. Empty when no delegation point is found. */
  authoritativeNameServers(name: string): Promise<readonly string[]>;
  txtAt(nameServer: string, name: string): Promise<ServerAnswer>;
  dnssec?(name: string): Promise<DnssecObservation>;
}

export interface VerificationRequest {
  readonly recordName: string;
  readonly expectedValue: string;
}

const REQUIRED_AGREEMENT = 2;
/** Bounds work against a hostile or misconfigured zone. */
const MAXIMUM_NAME_SERVERS = 8;

/**
 * Decides ownership from authoritative answers.
 *
 * Quorum rules, applied in this order:
 * - Any reachable server that answers *without* the expected value while
 *   another has it is a **disagreement**, and fails closed. A zone mid-change
 *   is not proof of control.
 * - A zone publishing two or more name servers requires agreement from at
 *   least two of them. If only one can be reached, the result is
 *   `insufficient_quorum` — it never silently degrades to one-server proof.
 * - A zone genuinely publishing a single name server verifies on that one
 *   server, recorded explicitly as a degraded case.
 */
export async function observeVerification(
  dns: DnsPort,
  request: VerificationRequest,
): Promise<VerificationObservation> {
  const expectedChallengeHash = challengeHash(request.expectedValue);
  const dnssec = dns.dnssec
    ? await dns.dnssec(request.recordName)
    : UNOBSERVABLE_DNSSEC;
  const base = {
    recordName: request.recordName,
    expectedChallengeHash,
    observedValueHash: null,
    observedValueCount: 0,
    agreementCount: 0,
    degradedSingleNs: false,
    ttlSeconds: null,
    dnssec,
  } as const;

  const discovered = await dns.authoritativeNameServers(request.recordName);
  const nameServers = [...new Set(discovered)]
    .sort()
    .slice(0, MAXIMUM_NAME_SERVERS);
  if (nameServers.length === 0)
    return { ...base, result: 'zone_undetermined', nameServers: [] };

  const answers = await Promise.all(
    nameServers.map((server) => dns.txtAt(server, request.recordName)),
  );

  const matched: TxtAnswer[] = [];
  let answeredWithoutMatch = 0;
  let observedValueCount = 0;
  const failures = { nxdomain: 0, servfail: 0, timeout: 0, unreachable: 0 };
  let sawRecordsAtName = false;

  for (const outcome of answers) {
    switch (outcome.kind) {
      case 'answer':
        observedValueCount = Math.max(
          observedValueCount,
          outcome.answer.values.length,
        );
        if (outcome.answer.values.length > 0) sawRecordsAtName = true;
        if (matchesChallenge(outcome.answer.values, request.expectedValue))
          matched.push(outcome.answer);
        else answeredWithoutMatch += 1;
        break;
      case 'absent':
        answeredWithoutMatch += 1;
        break;
      default:
        failures[outcome.kind] += 1;
    }
  }

  const observed = {
    ...base,
    nameServers,
    observedValueCount,
    degradedSingleNs: nameServers.length === 1,
  };

  // A split zone is never proof, whichever side is larger.
  if (matched.length > 0 && answeredWithoutMatch > 0)
    return { ...observed, result: 'disagreement' };

  if (matched.length > 0) {
    const required = nameServers.length >= 2 ? REQUIRED_AGREEMENT : 1;
    if (matched.length < required)
      return { ...observed, result: 'insufficient_quorum' };
    const ttls = matched
      .map((answer) => answer.ttlSeconds)
      .filter((ttl): ttl is number => typeof ttl === 'number');
    return {
      ...observed,
      result: 'verified',
      agreementCount: matched.length,
      observedValueHash: challengeHash(request.expectedValue),
      ttlSeconds: ttls.length > 0 ? Math.min(...ttls) : null,
    };
  }

  if (answeredWithoutMatch > 0)
    return {
      ...observed,
      result: sawRecordsAtName ? 'value_mismatch' : 'no_record',
    };
  if (failures.nxdomain > 0) return { ...observed, result: 'nxdomain' };
  if (failures.servfail > 0) return { ...observed, result: 'servfail' };
  if (failures.timeout > 0) return { ...observed, result: 'timeout' };
  return { ...observed, result: 'unreachable' };
}

/** Terminal-ish codes that mean "the name does not hold the record", as
 * opposed to "we could not look". */
function classify(error: unknown): ServerAnswer {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOTFOUND' || code === 'NXDOMAIN') return { kind: 'nxdomain' };
  if (code === 'ENODATA') return { kind: 'absent' };
  if (code === 'ETIMEOUT' || code === 'ETIMEDOUT') return { kind: 'timeout' };
  if (code === 'SERVFAIL') return { kind: 'servfail' };
  return { kind: 'unreachable' };
}

export interface NodeDnsPortOptions {
  readonly timeoutMs: number;
  readonly tries: number;
}

/**
 * The production port. Walks up from the queried name to the closest
 * delegation point, resolves those name servers to addresses, and asks each
 * one directly.
 *
 * It never queries the root or a public suffix: at least two labels must
 * remain, so a missing delegation reports `zone_undetermined` instead of
 * escalating to a TLD's servers.
 */
export function nodeDnsPort(options: NodeDnsPortOptions): DnsPort {
  const resolver = () => {
    const instance = new Resolver({
      timeout: options.timeoutMs,
      tries: options.tries,
    });
    return instance;
  };

  return {
    async authoritativeNameServers(name) {
      const labels = name.split('.');
      // Stop while at least two labels remain so a TLD is never consulted.
      for (let index = 0; labels.length - index >= 2; index += 1) {
        const candidate = labels.slice(index).join('.');
        try {
          const servers = await resolver().resolveNs(candidate);
          if (servers.length > 0) return servers;
        } catch {
          // No delegation at this level; continue upward.
        }
      }
      return [];
    },
    async txtAt(nameServer, name) {
      try {
        const [address] = await resolver().resolve4(nameServer);
        if (address === undefined) return { kind: 'unreachable' };
        const direct = resolver();
        direct.setServers([address]);
        const records = await direct.resolveTxt(name);
        // A TXT record arrives as character strings that concatenate.
        const values = records.map((chunks) => chunks.join(''));
        return values.length === 0
          ? { kind: 'absent' }
          : { kind: 'answer', answer: { values, ttlSeconds: null } };
      } catch (error) {
        return classify(error);
      }
    },
  };
}
