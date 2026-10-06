import { domainToASCII } from 'node:url';

/** ADR-025 hostname normalization.
 *
 * A pure component with no I/O, no configuration and no registry access. It
 * converts a candidate host string into the single canonical form the registry
 * stores and the resolver looks up by exact equality. It never performs
 * wildcard, suffix or prefix matching, and it never guesses: anything it cannot
 * canonicalize with certainty is rejected.
 *
 * Callers on the resident request path must collapse every rejection into one
 * indistinguishable failure so the resolver cannot become a tenant-enumeration
 * oracle. The distinct reasons below exist for operator tooling and tests. */
export type HostnameRejection =
  | 'absent'
  | 'oversized_input'
  | 'control_character'
  | 'multiple_hosts'
  | 'underscore'
  | 'wildcard'
  | 'forbidden_character'
  | 'ip_literal'
  | 'invalid_port'
  | 'invalid_idna'
  | 'invalid_label'
  | 'label_too_long'
  | 'hostname_too_long';

export type HostnameNormalization =
  | { readonly ok: true; readonly hostname: string }
  | { readonly ok: false; readonly reason: HostnameRejection };

/** Longest DNS name that can be represented in presentation format. */
const MAXIMUM_HOSTNAME_LENGTH = 253;
const MAXIMUM_LABEL_LENGTH = 63;
/** Bounds work before any conversion. A U-label never shrinks below its
 * A-label, so nothing legitimate approaches this. */
const MAXIMUM_INPUT_LENGTH = 1024;

/** Characters that can never appear in a Host value and that would otherwise
 * be reinterpreted by the IDNA/URL layer. `%` matters most: Node's
 * `domainToASCII` percent-decodes, so `%65xample.gov` would otherwise
 * canonicalize to `example.gov`. */
const FORBIDDEN_CHARACTERS = /[\s/\\?#@%"'<>{}|^`()!$&+;=]/;
const LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const NUMERIC_LABEL_PATTERN = /^[0-9]+$/;

function reject(reason: HostnameRejection): HostnameNormalization {
  return { ok: false, reason };
}

/**
 * IP literals are rejected outright. An address literal cannot hold DNS `TXT`
 * ownership evidence, so it can never satisfy ADR-025 verification, and
 * accepting one would add a second shape of lookup key for no benefit.
 * Bracketed and bare IPv6 forms, dotted IPv4 forms, and any name whose
 * rightmost label is entirely numeric are all refused. The last rule also
 * covers the shorthand forms the URL layer expands, such as `127.1`.
 */
export function normalizeHostname(input: unknown): HostnameNormalization {
  if (typeof input !== 'string' || input.length === 0) return reject('absent');
  if (input.length > MAXIMUM_INPUT_LENGTH) return reject('oversized_input');

  for (const character of input) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return reject('control_character');
  }
  // A repeated or comma-joined Host is ambiguous; it is never merged or split.
  if (input.includes(',')) return reject('multiple_hosts');
  if (input.includes('_')) return reject('underscore');
  if (input.includes('*')) return reject('wildcard');
  if (input.includes('[') || input.includes(']')) return reject('ip_literal');
  if (FORBIDDEN_CHARACTERS.test(input)) return reject('forbidden_character');

  let candidate = input;
  const separator = candidate.lastIndexOf(':');
  if (separator >= 0) {
    const port = candidate.slice(separator + 1);
    candidate = candidate.slice(0, separator);
    // Any remaining colon means an unbracketed IPv6 literal, not a port.
    if (candidate.includes(':')) return reject('ip_literal');
    if (!/^[0-9]{1,5}$/.test(port)) return reject('invalid_port');
    const value = Number(port);
    if (value < 1 || value > 65535) return reject('invalid_port');
  }
  if (candidate.length === 0) return reject('absent');

  // Exactly one trailing dot is the absolute-form marker and is dropped. A
  // second one leaves an empty label, which the label check below refuses.
  if (candidate.endsWith('.')) candidate = candidate.slice(0, -1);
  if (candidate.length === 0) return reject('absent');

  // Platform-standard UTS#46 processing: case folding, Unicode mapping and
  // punycode A-label conversion. Already-encoded A-labels pass through
  // unchanged, so normalization is idempotent.
  const ascii = domainToASCII(candidate);
  if (ascii.length === 0) return reject('invalid_idna');
  if (ascii.length > MAXIMUM_HOSTNAME_LENGTH)
    return reject('hostname_too_long');

  const labels = ascii.split('.');
  for (const label of labels) {
    if (label.length > MAXIMUM_LABEL_LENGTH) return reject('label_too_long');
    if (!LABEL_PATTERN.test(label)) return reject('invalid_label');
  }
  if (NUMERIC_LABEL_PATTERN.test(labels[labels.length - 1] ?? ''))
    return reject('ip_literal');

  return { ok: true, hostname: ascii };
}
