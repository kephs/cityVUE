# ADR-005 — Requester contact privacy

**Status: Accepted** — F039 protected contact with F040 effective request scope.

## Context

Staff may need operational request information without needing requester identity/contact. Structured contact must not leak through broad list/detail projections or relationships such as assignment.

## Decision

Request access does not imply contact access. Require the parent's audience-specific read permission, trusted Organization/current effective scope and independent `service_request.contact.read`. No default grant exists. Audience-specific contact controllers supply server-owned policies to the shared `RequestContactService`; browser input cannot select the policy.

The current `requester_contact` domain has name and optional email; no structured phone field exists. Return only `{name, email}`, with nulls for authorized absence. Do not infer requester contact from staff submitter/requester identity. Service location is distinct operational information governed by request access and can itself be sensitive. Structured contact is absent from ordinary request lists/details, including legacy PUBLIC detail.

Resolve the scoped parent, fetch the narrow contact projection and persist `service_request_contact_viewed` security audit in one transaction. Audit records trusted actor, Organization, request, time and safe correlation/action metadata, never contact values or description. Required audit failure prevents any disclosure, including a partial successful response. No operational Activity is appended.

## Consequences

Contact is fetched on demand into component memory with no-store response policy. Clear state on request/auth context change and denied fetch; unauthorized UI reveals no presence or masked fragments. Current values remain plain text. Search, editing, export, consent, messaging and new retention behavior are not introduced by contact-read permission.

## Security and privacy

Assignment, watchers, operational membership, update permission and Notes do not supply contact authorization. URLs, titles, normal logs, analytics and persistent browser storage do not receive the projection. Free-text descriptions, answers, narratives and Notes may contain incidental PII; F039 is not general redaction or automated detection.

## Related evidence

[F039](../../features/F039-protected-resident-contact-access.md), [F040](../../features/F040-public-service-request-staff-workspace.md), [contact service](../../../server/src/service-request/request-contact.service.ts), [PUBLIC effective-scope policy](../../../server/src/service-request/public-request-contact.policy.ts), [contact UI](../../../react/src/staff/requests/RequesterContact.jsx).
