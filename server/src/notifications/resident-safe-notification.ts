import { requesterStatus } from '../service-request/request-tracking.domain.js';

/**
 * ADR-026 resident-safe content boundary. This is a security boundary, not a
 * formatting convenience.
 *
 * Templates render against this view and nothing else. Staff identity, internal
 * notes, internal workflow status, department/division, assignment and routing
 * targets, requester contact values and authorization data are absent by
 * construction: they have no field here to occupy, so no template, renderer or
 * future provider can emit them even by mistake.
 *
 * The projection takes narrow explicit inputs rather than a ServiceRequest
 * aggregate, so adding an internal field to the domain can never silently widen
 * what a resident notification can say.
 */

/** Exactly the resident-facing statuses `requesterStatus` can produce. Raw
 * `service_request.status` is not assignable, so an internal value such as
 * `on_hold` cannot reach a notification. */
export type ResidentSafeStatus =
  'open' | 'in_progress' | 'closed' | 'cancelled' | 'unavailable';

export interface ResidentSafeNotificationView {
  /** Persisted human reference, already an opaque public identifier. */
  readonly reference: string;
  /** Published catalog version name. Never an internal description or note. */
  readonly issueName: string;
  readonly status: ResidentSafeStatus;
  readonly submittedAt: string;
  readonly updatedAt: string;
  /** Organization display name only; no internal organizational structure. */
  readonly organizationDisplayName: string;
  /** The resident's own entered service location, or null. */
  readonly serviceLocation: string | null;
  /**
   * An already-trusted absolute URL supplied by the caller, or null.
   *
   * Slice 1 resolves no domain: the ADR-025 tenant-domain registry does not
   * exist, so there is no trustworthy source for a tenant's canonical host.
   * This must never carry a requester tracking credential; ADR-026 requires a
   * separately reviewed short-lived exchange mechanism before any link can
   * convey request access.
   */
  readonly portalUrl: string | null;
}

/** Narrow, explicit inputs. Deliberately not a ServiceRequest aggregate. */
export interface ResidentSafeNotificationInput {
  readonly reference: string;
  readonly issueName: string;
  /** Raw persisted status; mapped through the existing resident-safe mapping. */
  readonly rawStatus: string;
  readonly submittedAt: Date;
  readonly updatedAt: Date;
  readonly organizationDisplayName: string;
  // Explicit undefined is accepted as well as omission; callers routinely hold
  // an optional value they have not resolved, and both mean "no value".
  readonly serviceLocation?: string | null | undefined;
  readonly trustedPortalUrl?: string | null | undefined;
}

function residentSafeStatus(rawStatus: string): ResidentSafeStatus {
  // Single source of truth shared with resident tracking: internal `on_hold`
  // presents as `in_progress`, and anything unrecognized degrades to
  // `unavailable` rather than leaking an internal workflow value.
  return requesterStatus(rawStatus) as ResidentSafeStatus;
}

function safeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Only https absolute URLs are accepted, and only from a trusted caller.
 * Anything else becomes null rather than reaching a resident. */
function safeUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username !== '' || parsed.password !== '') return null;
  return parsed.toString();
}

export function residentSafeNotificationView(
  input: ResidentSafeNotificationInput,
): ResidentSafeNotificationView {
  const serviceLocation =
    typeof input.serviceLocation === 'string'
      ? safeText(input.serviceLocation)
      : '';
  return {
    reference: safeText(input.reference),
    issueName: safeText(input.issueName),
    status: residentSafeStatus(input.rawStatus),
    submittedAt: input.submittedAt.toISOString(),
    updatedAt: input.updatedAt.toISOString(),
    organizationDisplayName: safeText(input.organizationDisplayName),
    serviceLocation: serviceLocation === '' ? null : serviceLocation,
    portalUrl: safeUrl(input.trustedPortalUrl),
  };
}
