# F045 — Requester Issue Location Experience

Status: implemented and locally validated from synchronized `54bb498ba37edcd28c646c84a4a1274370939697`. No push, deployment or F046 work authorized.

## Design and existing boundaries

Service Location describes the reported issue, not where the requester lives. Device geolocation is an optional input method for establishing Service Location. It is not Requester Geography. No separate device coordinates, accuracy, permission state, search query, provider response or provenance will be persisted.

The existing Organization/request-owned `location` table has `entered_address`, nullable latitude/longitude (`numeric(9,6)`), location type and eligibility snapshot fields. F045 extends the creation DTO and mapping to use those columns; no migration is required. Six fractional decimal places are the existing storage precision, not survey-grade precision. Existing staff and requester projection policies remain authoritative.

PUBLIC intake keeps server-configured catalog Organization resolution and the existing creation transaction, reference allocator and Activity. Staff geospatial routes retain their guards. A separate minimized intake configuration supplies only a fictional boundary and bounded synthetic search locations under explicit development configuration, never staff grants, request points or another Organization's data. Production search remains unconfigured; manual input remains available according to Issue policy.

MapLibre renders same-origin/local GeoJSON without third-party tiles, addresses or geocoding. Search uses a normalized provider contract with bounded results, minimum query length, debounce and stale-response protection. No query leaves the local provider. Map selection, search and explicit device action propose the same Service Location; manual text and coordinate input provide the non-map alternative. Draft state stays in memory, survives Back/Edit and resets when Issue changes.

Existing Issue location policies are required, optional and not applicable. `no_geographic_restriction` remains unrestricted: outside a displayed development boundary warns rather than creating a new blocking rule. Geographic restrictions retain server-side ineligible rejection and fail-closed unavailable/undetermined behavior. Coordinate-aware synthetic city/service-area checks reuse Organization-scoped F026 geometry. Other provider policies retain their existing behavior; no municipal policy or authoritative production GIS is invented.

## Validation and completion

Checkpoint verified: clean main, zero ahead/behind, 22 applied migrations, zero pending. See the [implementation report](F045-implementation-report.md) for executed automated suites, non-mutating browser UAT, privacy review, limitations and local commit evidence. This is not production readiness.
