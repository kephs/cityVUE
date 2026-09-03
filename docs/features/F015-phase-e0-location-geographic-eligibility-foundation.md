# F015 — Phase E0 Canonical Location and Geographic Eligibility Foundation

**Status:** Implemented and locally validated; production provider and deployment deferred  
**Scope:** Local development only

## Problem and goal

Some services may accept requests only inside an authoritative boundary, service area, or other approved geographic scope. Client-only checks can be bypassed and vendor GIS schemas must not become CityVUE's domain model. Phase E0 therefore adds an API-authoritative, vendor-neutral eligibility boundary to canonical request creation while leaving provider selection and authoritative City data for a later approved production phase.

The canonical outcome is `eligible`, `ineligible`, or `unable_to_determine`. A published immutable `ServiceDefinitionVersion` supplies the policy type, optional opaque policy reference, and unable-to-determine behavior. E0 supports only conservative `block` behavior.

## Contract and submission flow

`LocationEligibilityProvider.evaluate` accepts Organization context, the exact-version policy, entered/normalized location fields, coordinates, and neutral facility/park/parcel/asset references. It returns the canonical outcome, policy type, validation time, provider key/reference, and a safe reason code. Provider-specific schemas, endpoints, credentials, and geometry stay behind this interface.

Request creation loads and validates the requested published definition version, then validates the request and required location. `no_geographic_restriction` skips the provider and stores no eligibility snapshot. Restrictive policies evaluate before the write transaction. Only `eligible` continues into the atomic request write.

`ineligible` returns HTTP 400 with `LOCATION_INELIGIBLE`. An indeterminate result returns `LOCATION_ELIGIBILITY_UNDETERMINED`; provider failure or timeout returns `LOCATION_ELIGIBILITY_UNAVAILABLE`. These states create no request, location, answer, contact, activity, or reference allocation. HTTP 400 is used because the submitted location cannot satisfy the exact published intake policy; it is not a server-authentication or vendor-protocol response.

## Persistence

The version stores `geographic_eligibility_policy_reference` and `unable_to_determine_behavior`. The Location snapshot stores result, policy type/reference, provider key/reference, reason code, and validation timestamp. A database constraint prevents partial snapshots. These are historical facts from submission time; later policy or provider changes do not rewrite them.

## Development provider and configuration

The deterministic provider is a test harness only: `DEV-ELIGIBLE` is eligible, `DEV-INELIGIBLE` is ineligible, and any other value (including `DEV-UNABLE`) is unable to determine. It requires both `LOCATION_ELIGIBILITY_PROVIDER=development` and `ENABLE_DEVELOPMENT_LOCATION_ELIGIBILITY=true`. Both default off, and production configuration rejects either development setting. The disabled provider fails closed for restrictive policies. Calls have one bounded timeout and no automatic retry.

## Privacy, security, and observability

The frontend cannot override Organization, policy, provider, or outcome. Resident errors are mapped from an allow-list of safe codes and never expose provider detail. Eligibility event logs contain only policy type, result, duration, and safe reason code; addresses, coordinates, contact data, answers, raw provider payloads, and credentials are excluded. Existing HTTP request correlation supplies request-level tracing; richer provider-operation correlation is required before production.

## Frontend behavior

API-mode intake displays specific, plain-language messages for ineligible, indeterminate, and temporarily unavailable outcomes. A failed submission remains on the review step with entered form state intact so the resident can correct the location or retry. Legacy/localStorage mode is unchanged.

## Tests and acceptance

Unit tests cover deterministic outcomes, no-restriction bypass, policy decisions, timeout, and provider failure. E2E tests verify safe endpoint errors. PostgreSQL integration tests verify exact-version policy use, eligible snapshot persistence, blocked outcomes, no partial writes, Organization isolation, and migration reversibility. React tests verify safe message mapping and state preservation. Local UAT exercises eligible, ineligible, and indeterminate addresses with controlled synthetic data.

## Non-goals and deferred decisions

E0 does not add maps, autocomplete, address normalization, coordinates, spatial queries, real GIS endpoints, City boundary data, staff overrides, Entra/RBAC, production API exposure, or deployment. PostGIS remains an option, not a commitment: later discovery may choose provider-only evaluation, CityVUE-owned PostGIS geometry, or a hybrid cache/provider model. A production phase must approve authoritative layers and ownership, refresh cadence, boundary semantics, availability targets, privacy/retention, near-boundary handling, retries/degraded operation, staff override authorization/audit, and Organization-scoped provider configuration.
