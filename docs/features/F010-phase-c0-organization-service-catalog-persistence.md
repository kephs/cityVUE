# F010 — Phase C0 Organization and Service Catalog Persistence

**Status:** Implemented locally; production authentication and deployment are not included

**Scope:** Canonical Organization and resident-readable Service Catalog persistence only

## Outcome

Phase C0 adds the first business schema and read-only catalog module to the isolated NestJS server. It does not connect React, replace its fixture, or implement ServiceRequest, reference numbers, Entra/RBAC, GIS, assignments, notifications, attachments, integrations, Admin CRUD, Firebase changes, or Azure deployment.

## Schema and Organization ownership

All IDs are immutable UUIDs and timestamps use `timestamptz`. Organization stores name, short name, globally unique slug, active state, business timezone, and timestamps. Departments belong to one Organization. Divisions are optional Department children with explicit Organization ownership. Categories carry Organization, Department, and optional Division IDs plus resident description, logical `iconKey`, lifecycle, order, aliases, and keywords.

Composite unique keys and foreign keys enforce Organization consistency throughout. A Category's `(organizationId, departmentId, divisionId)` must match one Division row, preventing a Division from another Department or Organization. Services, versions, questions, and options use the same explicit Organization-plus-parent pattern. Repository methods require `organizationId`.

Department names are unique per Organization; Division and Category names per Organization and Department; service keys per Organization; version numbers per ServiceDefinition; question keys per version; and option keys per question. Category aliases/keywords are PostgreSQL text arrays: compact and searchable at expected catalog scale without a premature metadata model.

## Versioning and lifecycle

ServiceDefinition is stable identity: Organization, Category, stable key, lifecycle, and current published-version reference. Mutable resident content lives in ServiceDefinitionVersion: name, description, icon, aliases/keywords, priority, location policy, geographic eligibility mode, anonymous-reporting policy, publication state/time, and a nullable internal routing placeholder.

Versions use `draft`, `published`, `inactive`, or `archived`. A PostgreSQL trigger makes published rows immutable and undeletable. Future publication inserts a version then atomically changes the stable identity pointer; historical published rows remain readable. Resident queries resolve only an active ServiceDefinition's explicit current published version, excluding drafts and unrelated historical versions.

Other catalog rows use inactive/archive semantics and there are no DELETE endpoints. Future draft editing can add revision predicates for optimistic concurrency; immutable published rows already prevent its highest-risk conflict.

## Questions and policies

Questions belong to an exact version and have stable UUID/key, label/help text, type, required flag, order, JSONB validation metadata, JSONB visibility condition, and lifecycle. Phase C0 supports short text, long text, number, yes/no, and single select and reserves approved future type values without behavior. Options have stable UUID/key, label, order, and active/deprecated/archive lifecycle.

Conditional visibility is constrained JSONB: `{ questionKey, operator: "equals", value }`. This keeps a small deterministic rule with its immutable version and avoids a rule-engine schema. A check rejects missing structure and operators other than equality. It is data, never executable code; dependency and cycle validation belongs to future publication logic.

Location collection (`required`, `optional`, `not_applicable`) remains distinct from constrained geographic eligibility modes. No GIS validation exists. Anonymous reporting is constrained to allowed, not allowed, or allowed with limitations. `iconKey` permits only lowercase kebab-case logical keys—not HTML, CSS, script, SVG, or URLs. Vendor mappings are absent. Routing JSON is an internal placeholder omitted from resident DTOs; typed references wait for future routing entities.

## Repository, service, API, and search

CatalogRepository owns typed Kysely reads and always requires Organization scope. CatalogService maps rows to public DTOs and obtains the temporary Organization ID only from validated configuration. CatalogController exposes:

- `GET /api/v1/catalog/categories?search=`
- `GET /api/v1/catalog/categories/:categoryId/issues?search=`
- `GET /api/v1/catalog/issues/:serviceDefinitionId`

Responses omit Organization IDs, ownership, lifecycle internals, routing, unpublished content, and integration data. OpenAPI documents only implemented reads. Search trims input and uses PostgreSQL `ILIKE` across names/descriptions and aliases/keywords. It excludes inactive Categories/Services and unpublished versions and is always Organization-scoped. Full-text search, pagination, Redis, and external search are deferred until scale justifies them.

`DEVELOPMENT_ORGANIZATION_ID` supplies a deterministic Phase C0 local scope. It is not public tenant selection or production isolation, and the API accepts no Organization query parameter. A future trusted identity/security phase must supply and authorize Organization context before multi-Organization production use.

## Migration, seed, and validation

Migration `20260902000000-create-organization-service-catalog.ts` creates eight tables, checks, composite FKs, indexes, and the immutability trigger; down removes Phase C0 objects. The sample seed uses one transaction, deterministic UUIDs, conflict-safe inserts, and guarded pointer updates, making reruns non-duplicating and non-overwriting. Its one development Organization, three Departments, five Categories, six Issues, questions/options, metadata, and policies are inspired by the prototype and are not official City configuration.

Database tests use a temporary PostgreSQL schema for migration up/down, cross-Organization rejection, version uniqueness/immutability, historical/draft coexistence, question ordering/conditions/options, scoped search, and published resolution. E2E tests cover lists, detail, malformed UUID, not found, and public response boundaries. The live React MVP remains fixture/localStorage-backed.

Phase D0 may separately implement ServiceRequest, Answer, Requester/contact, Location, atomic `SR-YYYYMM-NNNNNN`, request creation, and initial Activity. Phase C0 stops before all of them.
