# ADR-003 — Client-Neutral Platform Architecture and Isolated Development Model

**Date:** 2026-09-16. **Status:** Accepted for F022 local development. Client production choices remain unapproved.

## Context

CityVUE has a vendor-neutral domain and existing narrow Entra, location eligibility and AI boundaries, while project history and prospective Rockville plans refer to City services. Independent development must not require City infrastructure or non-public data. F020/F021 used “F022” for a possible AI provider pilot; this F022 instead establishes architecture and isolation before any provider connection.

## Decision

CityVUE is developed as a client-neutral software platform. Client-specific capabilities are supplied through configurable provider/adapter boundaries and deployment configuration. Independent development does not require access to client production infrastructure, credentials, internal networks, or non-public data.

The CityVUE client-neutral core has no required dependency on City of Rockville infrastructure or vendor-specific services. A future authorized Rockville deployment may intentionally use approved City services through deployment-specific adapters and configuration.

Use the existing Joi/Nest configuration path for a default `development` profile and explicit `client` profile. Require explicit client selection in production, reject development providers and staff/read gates in any client profile, and require explicit opt-in before development Entra settings can activate. Keep the existing Entra verifier, server RBAC, location provider contract, and AI provider contract. Introduce other adapters only when a real capability and approved destination require them. Prefer MapLibre with synthetic GeoJSON/PostGIS for future neutral map work, subject to separate implementation review.

## Alternatives and consequences

Adding placeholder frameworks for identity, GIS, EAM, CRM, notification and AI was rejected: most have no live integration and AI/location already have contracts. Automatically choosing a client profile from `NODE_ENV=production` was rejected because a production process must state its deployment intent. Banning Entra in all development was rejected because personally controlled test tenants can support identity work; explicit opt-in records that choice but cannot independently verify ownership.

Local/default startup remains isolated from Entra. Existing local Entra setups must set the opt-in explicitly. Production startup must set the client profile. This is configuration policy, not network isolation, client authorization, production certification, or proof that a configured resource is approved. A client deployment still needs explicit security, data, operational, integration and UAT decisions. No repository name or application rename follows from this decision.
