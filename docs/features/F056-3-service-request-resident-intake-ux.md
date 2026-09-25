# F056.3 — Service Request and Resident Intake UX Refinement

Status: COMPLETE LOCALLY — NOT SYNCHRONIZED; automated and user-confirmed authenticated UAT/privacy gates passed. Starting checkpoint: `bda451481e95374a375f4e5587a154f261fa2fce`, clean synchronized main. Follow the [protocol](../development/REQRO_CODEX_PROTOCOL.md). See the [implementation report](F056-3-implementation-report.md) for actual validation, limitations and the local commit gate. No push, deployment, migration, grant change or F057.

## Resolved design stops

- §70: the existing wizard already models Issue → Details → Additional Information → Review. Retain it. Zero schema rows skip Additional Information; Information-only schemas retain it; authoritative External Redirect uses the existing handoff branch. Only heading capitalization changes.
- §136: API category accents previously depended on result index. Use one fixed five-color palette and a deterministic category-ID mapping, retaining the existing named legacy category colors. The ID is already in the authorized server list/detail projection; the frontend allowlist now retains it. No additional network calls, configuration, persistence, authorization or status meaning. The palette/hash algorithm is fixed, independent of order, names and render count. Reordering categories cannot change their accent. Color always supplements icon and text.
- §137: outcome A for the apparent duplicate address. Search query is discovery-only; result/map/device selection writes the same `values.location` text consumed by manual editing and `location.enteredAddress`. There is no second separately persisted search-address field. Show Selected Location and retain editable description under a manual disclosure, including coordinate-preserving edits. Do not merge coordinates and text or remove the manual path.
- §138: explicitly approved by the user: selector **25, 50, 100**, default **25**, maximum **100**. The earlier 150/250/500 proposal is superseded. Preserve the existing API acceptance of integer sizes 1–100 and rejection above 100; the UI offers only the approved three choices. No backend maximum or validation changes.
- §139: audience is already in the authorized list row. Request Type needs no protected resource or per-row query.
- §140: the shared main container defaults to 1440px. Only `/staff/requests` and its detail routes gain a 1600px maximum; `/report` uses 1280px instead of its prior 1120px inner maximum. Existing responsive gutters remain. Admin, Home, AI and unrelated routes retain their widths.

## Staff presentation and pagination

Desktop hierarchy: #, Issue / Reference, Request Type, Status, Department / Division, Assignment, Created. Issue is strongest; displayable Service Location appears beneath it, followed by the opaque reference. Missing location omits the row and icon entirely; it is legitimate, not an error. No replacement is inferred. Public/Internal badges move into Request Type, reflecting existing request audience rather than Issue availability, requester identity or channel.

Search Requests gets an icon and a subtle theme-aware blue border/surface. Filters remain separate. Search/filter/sort → server query → authorized projection → page/page size → React presentation. No browser-wide dataset fetch, client-side sorting or full-data pagination.

`GET /api/v1/staff/service-requests` retains `page`, `pageSize`, authoritative `total`, `hasPreviousPage` and `hasNextPage`. Existing `q`, exact Reference `search`, audience, view, assignment, status, departmentId, divisionId, sort and direction compose unchanged. Default sort is created descending, with the existing stable UUID tie-breaker. PUBLIC/INTERNAL permissions, trusted Organization and Department/Division scope constrain both count and rows before presentation.

Page size joins existing URL state. Changes to size/search/filter/sort reset page 1; empty out-of-range pages recover to page 1 with history replacement. Back/Forward/Refresh restore or retain applied state. Reset retains its existing default-reset meaning, now including size 25. AbortController and full query-key matching retain newest-response-wins behavior. The selector remains mounted during loading to preserve keyboard focus and permit rapid changes. Zero results show 0–0 of 0 and Page 1 of 1. Below 992px the existing labeled stacked-table pattern preserves all row fields.

## Submitted Information

The shared protected component uses a normal content card in the primary column, before Request Evidence. Ordinary request detail loads without answers. The explicit View Submitted Information action calls the existing no-store protected endpoint, which independently requires parent authorization plus `service_request.answers.read` and commits its audit before disclosure. No prompts, values, options or counts are inferred or prefetched for decoration.

Loading and sanitized retry/unavailable messages stay within the card. Historical scalar, Multi-select and Date content wraps naturally without fixed heights. Information remains display-only, never a fake submitted answer. Request/auth context changes and aborted responses retain protected-state isolation. A denied protected read removes previously loaded content without breaking ordinary detail.

## Resident flow and copy

```text
Search / explicit Device Location / Map / Manual Entry
                         |
                         v
                  Selected Location
                         |
                         v
                F045 Service Location
                         |
                         v
                   Service Request
```

Typing search text does not commit a location. Change Location returns focus to discovery; manual description remains available without geocoding, keeps existing coordinates and opens on validation error. No automatic device-location request. Geographic eligibility, required/optional/not-applicable policy, server validation and DTO remain unchanged. Participation and Requester identity remain independent. Empty location is omitted in Review.

Category cards use three columns at 1200px+, two at intermediate widths, and one below 576px. Details sections have distinct cards and readable spacing. Identification-required Issues show the required name input directly; anonymous-allowed Issues retain explicit choice and existing Contact clearing/validation. Attachment count, type, per-file/total limits and fictional-only/no-malware warning remain. Development messages are visually separated from resident instructions.

Title Case is an editorial convention for page/section/card/table headings and major control groups; ordinary instructions/actions remain natural sentence case. No global capitalization rule changes user content. Existing uppercase desktop table styling is removed. Unrelated branding/runtime identifiers remain untouched.

## Security and scope freeze

Preserve F032 handling/handoff, F045 validation/eligibility, F046 evidence/finalized retry, F047 search authorization/fields, F048 assignment, F049 requester policy, F050 identity/history, F051 participation/privacy, F052–F056 Admin authorization and configuration, F056.1 discovery, F056.2A protected answers, F056.2B availability and F056.2C question semantics/history. No new permission, permission meaning, grant, provisioning, API route, migration, database field, analytics, tracking, provider, dependency or production resource change. No F057.
