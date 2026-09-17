# F022 — Client-Neutral Architecture and Development Isolation

**Status:** Implemented local architecture safeguard. No client deployment or live provider connection.

## Purpose and scope

CityVUE is developed as a client-neutral software platform. Client-specific capabilities are supplied through configurable provider/adapter boundaries and deployment configuration. Independent development does not require access to client production infrastructure, credentials, internal networks, or non-public data. The CityVUE client-neutral core has no required dependency on City of Rockville infrastructure or vendor-specific services. A future authorized Rockville deployment may intentionally use approved City services through deployment-specific adapters and configuration. CityVUE remains the canonical development/project name.

F022 is an incremental configuration and governance change. It does not alter the canonical ServiceRequest model, browser legacy Issue compatibility model, authentication verifier, authorization guard, AI router, or resident flows. It does not introduce EAM, CRM, GIS, notification, or AI network adapters. Existing City-branded stakeholder previews remain isolated demonstrations; their branding and synthetic content do not define the platform core.

## Current boundaries

- Staff identity: existing Entra token validation and server-owned StaffIdentity, Organization and RBAC mapping. Entra remains an optional configured implementation. Protected APIs still validate identity and permissions server-side. The existing local staff fallback remains gated and is rejected in client profiles.
- Location: existing vendor-neutral eligibility contract and deterministic development implementation. No ArcGIS connection is present. Future map presentation should evaluate MapLibre GL JS with synthetic GeoJSON/PostGIS development data; authorized ArcGIS resources would need a deployment adapter and separate review.
- AI: reuse F020/F021 provider contracts and empty registries. AI and chat remain disabled by default; F021 test execution remains production-forbidden. F022 does not select or connect a model provider.
- EAM/CRM and notification: no live adapter is added. Future contracts should follow actual supported capabilities and keep vendor schemas, credentials and mapping out of the core and browser.

## Deployment configuration

The backend uses its existing Joi startup validation and Nest ConfigModule. `CITYVUE_DEPLOYMENT_PROFILE` accepts `development` (default) or `client`. Production requires explicit `client`; client profiles reject development staff actions, development request reads, and the deterministic location provider or gate, even in a nonproduction client test environment. Existing production TLS and feature restrictions still apply.

`CITYVUE_ENABLE_EXTERNAL_IDENTITY` defaults false. In a `development` profile with `NODE_ENV=development`, configured Entra settings require this explicit opt-in. Use it only with personally controlled test identity resources. An independently developed local API needs no Entra settings. A client profile cannot use this development opt-in. Existing Entra settings remain all-or-nothing, and token validation and RBAC are unchanged. Test harnesses may supply synthetic Entra settings under `NODE_ENV=test` without external access. This flag is an operator declaration, not proof of tenant ownership or a network egress firewall.

The frontend retains its existing legacy/local data-source default and optional MSAL configuration. Do not put provider secrets or client endpoints in Vite settings. Client profile selection is server-side; deployment pipelines must explicitly align frontend and backend configuration.

There is no preconfigured Rockville profile. Client configuration, authorization, data ownership, approved integrations, public content, and security review must precede any future deployment. Do not use City credentials, Entra tenant, ArcGIS organization, non-public GIS data, SMTP, internal network, DNS, hosting, production EAM/CRM, or databases in independent development.

## Acceptance and validation

Unit tests cover safe defaults, explicit production profile, invalid profile, external identity opt-in, and blocking development providers/gates in client profiles. Existing Entra, AI, location, TLS, server authorization, React, and persistence checks remain regression gates. No live City system is needed for validation.

## Next work

Define a separately reviewed provider evaluation or a generic map presentation implementation using synthetic data. Before any client deployment, approve identity resources, authoritative data, adapter capabilities, secrets, environment isolation, and authorization/UAT. F022 itself grants none of those approvals.
