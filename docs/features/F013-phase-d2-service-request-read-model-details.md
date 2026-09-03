# F013 — Phase D2 Canonical ServiceRequest Read Model and Details

**Status:** Implemented for local development and testing; production exposure prohibited

## Outcome

Phase D2 adds a canonical, read-only ServiceRequest details boundary without changing the D0/D1 write model or the production browser-local MVP. The backend assembles a staff-oriented details DTO from canonical PostgreSQL records. React adds `/issues/:issueId` for explicitly enabled local API mode. The existing `/issues`, `/issues/:issueId/edit`, Dashboard, and legacy persistence paths are unchanged.

## Read-model architecture and Organization scope

`GetServiceRequestDetailsService` obtains the trusted `DEVELOPMENT_ORGANIZATION_ID` from validated server configuration and executes one read transaction. `ServiceRequestRepository.loadDetails` loads the request and exact persisted ServiceDefinitionVersion, Category, Department, and optional Division in one joined query, then loads Answers, requester contact, Location, and Activity in bounded collection queries. Every query includes Organization scope; an invalid UUID, missing record, or cross-Organization record produces the same safe 404 response. Clients cannot submit an Organization ID.

Existing primary, unique, and D0 indexes already support UUID/reference lookup, ordered Answers, and ordered Activity. No migration or new index was required.

## Security and PII boundary

`GET /api/v1/service-requests/:serviceRequestId` is available only when `ENABLE_DEVELOPMENT_SERVICE_REQUEST_READS=true`. The flag defaults to false, and configuration validation rejects it when `NODE_ENV=production`. This is a development test surface, not a production staff API. Request logging continues to record request metadata rather than bodies or response details. Activity metadata is allow-listed to the reference number; internal Organization data, raw rows, routing metadata, credentials, and unimplemented placeholders are omitted.

Requester name/email and entered location are sensitive. Anonymous requests return only `{ anonymous: true }`. Production staff exposure requires approved Entra identity, server-enforced RBAC, privacy review, operational hosting, and authorization-aware Organization context.

## Details contract

The DTO contains:

- `serviceRequest`: immutable ID, human reference, status, priority, UTC timestamps, and revision.
- `classification`: stable ServiceDefinition and version IDs, saved version name, Category, Department, and optional Division.
- `request`: resident description.
- `answers`: saved order, question ID/key/label/type, typed value, and human display snapshot. Select answers retain both the stable option key and saved label.
- optional `location`: only fields that are actually populated; no GIS inference or eligibility fabrication.
- `requester`: anonymous state or persisted identified name/email.
- `activity`: oldest-to-newest type, actor type, timestamp, and safe metadata.

Assignments, attachments, watchers, external references, integrations, and staff actions are omitted because they are not implemented.

## React details experience

The React data boundary requires all three local settings: API mode, an API base URL, and `VITE_CITYVUE_ENABLE_DEVELOPMENT_SERVICE_REQUEST_READS=true`. Otherwise `/issues/:issueId` displays a safe unavailable state and makes no details request. API-mode submission shows **View request details** only when this frontend flag is enabled. Direct UUID navigation remains the primary local test path; production Issue rows are not linked to canonical IDs.

The page uses one issue-name H1, a secondary reference number, textual status/priority badges, semantic sections and definition lists, optional-field omission, readable local date/time formatting, loading, safe not-found, generic error, and explicit retry states. It contains no edit/delete/workflow controls and no canvas dependency.

## Local development

After starting PostgreSQL, applying migrations, and seeding the development catalog, start the API with `ENABLE_DEVELOPMENT_SERVICE_REQUEST_READS=true`. Start React with:

```powershell
$env:VITE_CITYVUE_DATA_SOURCE='api'
$env:VITE_CITYVUE_API_BASE_URL='http://localhost:3000/api/v1'
$env:VITE_CITYVUE_ENABLE_DEVELOPMENT_SERVICE_REQUEST_READS='true'
npm run react:start
```

Create a request through `/report`, then use its returned UUID or the enabled success link to open `/issues/:issueId`.

## Validation and deferred work

Unit, E2E, database-integration, repository, and React component tests cover fail-closed configuration, Organization scope, safe 404 behavior, classification, historical Answer labels/order/select display values, anonymous and identified requesters, Location, Activity, repository transport, loading, success, optional sections, not-found, retry, and API-mode gating. Test identities and addresses are synthetic.

No Firebase preview/production deployment or backend deployment is authorized by D2. Entra/RBAC, production staff access, canonical Issue List cutover, workflow/actions, GIS, attachments, notifications, and EAM integrations remain separately deferred.
