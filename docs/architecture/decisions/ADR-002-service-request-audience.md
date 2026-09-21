# ADR-002 — Service Request audience

**Status: Accepted** — F029 classification and F040 audience-aware access.

## Context

Resident requests, assisted intake and employee self-service require explicit attribution and access rules. An intake channel or authenticated submitter cannot reliably stand in for request audience.

## Decision

Persist `public` and `internal` as request classification. Display PUBLIC/INTERNAL as readable audience labels, independently from lifecycle status or severity. Persist intake channel separately: `web`, `phone`, `walk_in`, `staff` or `api`. Do not infer either field from the other, an Issue, a Department or sign-in.

Anonymous resident creation always receives server-selected PUBLIC/WEB. Staff intake accepts validated classification/channel choices under `service_request.create`; INTERNAL additionally requires `service_request.create_internal`. Internal intake is authenticated self-service: identified reporting, server-resolved staff requester and no resident contact object. Assisted PUBLIC intake retains resident contact separately from the verified staff submitter. Creating a request grants no later read/update access.

For existing requests, persisted audience selects the server access policy. Filters and forged browser audience cannot switch that policy. PUBLIC describes the public/resident service domain, not internet-readable staff data. INTERNAL is not access for every employee and is not a complete sensitivity classification.

## Consequences

One canonical creation model supports both audiences without separate reference counters. Named legacy audience routes retain their contracts; the unified staff workspace can show only the caller's independently authorized union. New sensitivity, employee impersonation or resident identity features require separate decisions.

## Security and privacy

Reject client Organization/author authority. PUBLIC classification never exposes requester contact, staff Activity, ownership or Notes anonymously. Keep staff submitter, staff requester and structured resident contact distinct.

## Related evidence

[F029](../../features/F029-service-request-audience-assisted-intake-foundation.md), [F040](../../features/F040-public-service-request-staff-workspace.md), [creation service](../../../server/src/service-request/create-service-request.service.ts), [DTOs](../../../server/src/service-request/service-request.dto.ts), [authorization ADR](ADR-006-public-internal-staff-authorization.md).
