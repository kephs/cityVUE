/**
 * F067: resident-facing presentation helpers for the public tracking page.
 *
 * Presentation only. Nothing here authorizes access, widens a projection or
 * adds a field to a response: the public tracking read (F044/F063.1/F065)
 * stays the only source of resident-visible data, and every value below is
 * derived from what that read already returned.
 */

/** The resident-visible status vocabulary a tracking read can admit. */
export const RESIDENT_STATUSES = [
  "open",
  "in_progress",
  "closed",
  "cancelled",
  "unavailable",
];

/**
 * Lifecycle grouping for the resident-visible status.
 *
 * `in_progress` already covers `on_hold` server-side, so a resident never
 * learns a request is paused. `closed` covers both completed and
 * administratively closed work because the projection does not distinguish
 * them -- this does not invent a "resolved" state the server never sends.
 */
export function requestLifecycle(status) {
  switch (status) {
    case "open":
    case "in_progress":
      return "active";
    case "closed":
      return "completed";
    case "cancelled":
      return "cancelled";
    default:
      return "unknown";
  }
}

/** Short lifecycle wording, so status meaning never rests on color alone. */
export const lifecyclePresentation = {
  active: { label: "Active request", icon: "arrow-repeat" },
  completed: { label: "Completed request", icon: "check-circle" },
  cancelled: { label: "Cancelled request", icon: "slash-circle" },
  unknown: { label: "Status unavailable", icon: "question-circle" },
};

/** Plain-language status descriptions in citizen-facing terms. */
export const residentStatusDescription = {
  open: "This request has been received and is waiting to be scheduled.",
  in_progress: "The service team is working on this request.",
  closed:
    "Work on this request is finished. No further action is planned for it.",
  cancelled:
    "This request was cancelled, and no further action is planned for it.",
  unavailable: "The status of this request is not available right now.",
};

export function residentStatusSummary(status) {
  const lifecycle = requestLifecycle(status);
  return {
    lifecycle,
    ...lifecyclePresentation[lifecycle],
    description:
      residentStatusDescription[status] ??
      residentStatusDescription.unavailable,
  };
}

/**
 * The timestamp of the newest resident-visible update, or null when the
 * request has none.
 *
 * Deliberately derived from the resident-visible updates the projection
 * already returned, which is exactly how F064's `lastUpdateAt` is defined:
 * `service_request.updated_at` also moves for internal routing and
 * assignment, so surfacing it would let a bearer infer staff activity they
 * are not entitled to see. The maximum is computed rather than assuming the
 * server's newest-first order, so a reordered response cannot mislabel it.
 */
export function lastResidentUpdateAt(updates) {
  if (!Array.isArray(updates)) return null;
  let newest = null;
  for (const update of updates) {
    const time = Date.parse(update?.createdAt);
    if (!Number.isFinite(time)) continue;
    if (!newest || time > newest.time)
      newest = { time, value: update.createdAt };
  }
  return newest ? newest.value : null;
}
