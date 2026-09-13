# ADR-002 — AI governance metadata and test-only execution

**Date:** 2026-09-13. **Status:** Implemented local foundation under the F021 request; live provider/production approval pending.

## Decision

Extend F020's CityVUE-owned request, response, model, policy and router contracts. Keep provider implementations behind `AiProvider`, with server-only resolution. Ship empty provider/model/quota registries, no generation controller, and a production-forbidden test-execution flag. Compile the deterministic provider and HTTP lifecycle harness only with tests. Preserve the existing inert React workspace and Entra-only metadata endpoints.

Store one organization-scoped usage record per server correlation UUID plus linked audit transition rows. Explicit column projection excludes request/response content, arbitrary metadata, identity claims and exceptions. Do not add a second operational logger: existing Pino sanitation and correlation remain unchanged; persisted audit events reference usage for structured governance details. Identity/RBAC failures at the HTTP boundary retain sanitized HTTP logging and never fabricate a staff usage identity.

Serialize quota admission per organization with a PostgreSQL transaction advisory lock. Check accepted request counts since a UTC daily/monthly window using the database clock after lock acquisition, then atomically insert pending usage and its accepted event. Count pending, completed and failed accepted attempts conservatively; denied requests consume no quota. Complete usage and append its terminal event atomically before returning content. Require an explicitly supplied server policy; none is configured by default. Reserve role/department scope names but deny them until approved membership aggregation is implemented.

## Alternatives and consequences

An in-memory counter would not protect concurrent processes or survive restart. Separate counter tables are unnecessary for this request-count foundation; indexed usage rows supply counters. Independent best-effort audit writes would permit execution without evidence, so recording failures block execution or release of output. Content/history storage and arbitrary JSON audit payloads are excluded because no retention or data-handling approval exists.

The organization lock favors correctness over throughput for this foundation. A crashed process can leave pending records which continue consuming quota; reconciliation, retention, operational ownership and audit export/access are future reviewed work. Usage is not billing, token counts can be null, and role/department/token/cost quotas are not implemented. Persistence is append-oriented through services, not a tamper-proof audit archive against privileged database administrators. Rollback removes only the two F021 tables and their metadata, never resident tables or AI permission grants; real retained audit data would require backup/retention approval before rollback.

No provider receives StaffAccess, database handles, secrets, tool permissions or City-system access. Provider calls receive only portable messages/selection, the correlation ID and cancellation signal. This interface is not a sandbox for arbitrary trusted server code. A future live adapter requires explicit approval and appropriate network/secret/data safeguards; changing its label to `test` is not approval.

See [F021](../features/F021-implementation-report.md) for lifecycle details, tests and the Provider Connection Gate.
