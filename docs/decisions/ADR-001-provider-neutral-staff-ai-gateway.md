# ADR-001 — Provider-neutral server-side staff AI gateway

**Status:** Accepted for F020's local foundation by the implementation request. Production/provider/gateway selection remains subject to City approval.
**Date:** 2026-09-13
**Feature:** [F020](../features/F020-enterprise-ai-workspace-foundation.md)

## Context

CityVUE needs a bounded workforce AI workspace that can support multiple approved model providers using City identity. Browser vendor SDKs, individual unmanaged accounts and shared credentials would fragment governance, auditing, cost control and data protections. Existing architecture already favors server-side vendor-neutral modules and documents ADR conventions.

## Decision

CityVUE will use a provider-neutral server-side AI gateway architecture. React communicates with authenticated CityVUE APIs; server authentication/RBAC precedes AI policy and routing. Future adapters translate CityVUE-owned contracts to approved gateways/providers. Neither browser nor individual unmanaged provider sessions are the integration boundary.

Reuse Microsoft Entra identity, existing StaffIdentity mapping and application permissions. Keep AI separate from resident domains. Ordinary logs exclude prompts/responses. F020 has an empty static registry, explicit routing only, hard-disabled generation and no provider adapter or network call. There is no content persistence or upload.

Evaluate Azure API Management in front of Microsoft Foundry and/or other approved providers later. No Azure product or preview capability is an irrevocable core dependency.

## Alternatives

- Direct browser/provider integration: rejected because it exposes credentials or fragments policy enforcement.
- Shared employee AI accounts: rejected because accountability and individual authorization are lost.
- Provider-specific core contracts: rejected because they increase replacement cost and embed vendor assumptions.
- Database-backed model/history configuration now: deferred because no approved models or content-retention policy require it.

## Consequences

Centralized identity, governance, auditing, future quotas/cost controls and DLP have explicit server boundaries. Provider/gateway replacement does not require a new frontend domain. There are no shared AI credentials or browser API keys.

The backend becomes a security-sensitive processing boundary and future gateway operations add cost and operational ownership. Production requires approved provider terms, data policy, identity UAT, networking, secrets, monitoring, failure handling and deployment review. F020 alone provides no usable AI inference or production certification.
