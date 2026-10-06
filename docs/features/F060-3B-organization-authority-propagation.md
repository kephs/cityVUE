# F060.3B — Organization authority propagation and cross-tenant isolation (ADR-025 Slice 1b-B)

Status: **architecture/security review PASSED, approved for one source-control
checkpoint with an explicit blocker.** Not merged to `main`, not deployed. No
migration was created or authorized. F060.3C is not started.

**This slice does not close every resident path, and registry mode is not
production-ready.** `bootstrap.ts` is untouched and still refuses the
`registry` strategy.

### Completed in this checkpoint

- Resident Organization propagation for **alerts**
- **Catalog** / issue discovery
- **Resident Experience public read**
- **Service Request creation authority** (the anonymous write path)
- **Location eligibility** intake configuration
- **Participation** areas
- **Staff list, detail and actions** using staff-identity Organization
- Removal of the relevant **service-level development Organization
  fallbacks**
- **Cross-tenant isolation proofs** across two Organizations
- **Forged Organization input resistance** on the anonymous write path
- **Tracking credential analysis**

### Still blocking F060.3C

- The **anonymous attachment lifecycle still captures the configured
  Organization internally**, and uses it as the authority for the whole
  anonymous flow rather than only at batch creation.
- **Resident request creation with evidence therefore cannot safely rely on
  registry-derived tenancy yet**, because intake calls into that attachment
  flow.
- **Attachment authority must be refactored before registry serving is
  enabled.**

## Authorization and baseline

Implemented under the F060.3B authorization. Fresh branch
`claude/request-tenant-propagation` from `origin/main` at
`e30b4f17c3646d4f61d6eabd07bfb9f2f92b35dd`, clean index and working tree.
Forty-six migrations exist and none was added. No dependency changes.

Current main was re-inspected rather than assumed: the newest commit,
`e30b4f1 fix(intake): restore location configuration behavior`, is
React-only and does not touch any backend path refactored here.

## Authority model

| Route class | Organization authority |
| ----------- | ---------------------- |
| Anonymous / resident | **Resolved request `TenantContext` only** — no configuration fallback, no browser-supplied selector |
| Staff / admin | **Verified Entra identity → `staff_identity` → `staffAccess.organizationId`** — hostname plays no part |

Under the development strategy the middleware produces a development
`TenantContext` from the explicitly configured `DEVELOPMENT_ORGANIZATION_ID`,
so local development resolves the same Organization as before. That value now
reaches services **only** through the middleware; no service reads it.

No staff/hostname consistency enforcement was added, and
`staff-access.guard.ts` is untouched.

## Resident consumers refactored

| Consumer | Before | After |
| -------- | ------ | ----- |
| `alerts.service` | constructor-captured configuration | `listActive(organizationId)` |
| `catalog.service` | constructor-captured configuration | `listCategories(organizationId, search?)`, `listIssues(organizationId, categoryId, search?)`; the configuration-bound `getIssue(id)` is **removed** in favour of the existing explicit `getIssueForOrganization(organizationId, id)` |
| `resident-experience.public.service` | constructor-captured configuration | `getPublished(organizationId)` |
| `create-service-request.service` | constructor-captured configuration on the anonymous path | `execute(organizationId, input, now?)` |
| `intake-location.controller` | direct configuration read | `@ResidentTenant()`; the existing development-environment gate is unchanged |
| `participation.service` | **optional** `organizationId?` with configuration fallback | `areas(organizationId)` — mandatory |

Each resident controller now visibly obtains `@ResidentTenant() tenant` and
passes `tenant.organizationId` downstream.

## Staff consumers refactored

| Consumer | Before | After |
| -------- | ------ | ----- |
| `list-service-requests.service` | `access?.organizationId ?? this.organizationId` | `execute(query, access)` with `access` mandatory |
| `get-service-request-details.service` | `access?.organizationId ?? this.organizationId` | `execute(id, access)` with `access` mandatory |
| `staff-actions.service` | `access?.organizationId ?? this.organizationId` in both `assign` and `workflow` | `access` mandatory; Organization and actor both identity-derived |

`staff-actions.service` also loses its now-dead `developmentActorId` field:
the actor is `access.staffIdentityId`, which the guard always populates.

Repositories were already explicit about Organization and are unchanged.
Services remain singletons; no Express request object is injected into any
business service.

## Removed Organization fallbacks

Every `catalog.developmentOrganizationId` read in an application service or
controller is gone. The only remaining readers are
`src/config/configuration.ts`, `src/config/environment.ts`, the tenancy
middleware (the sole resident-context source) and
`src/auth/staff-access.guard.ts` — where it is confined to the development
non-Entra branch that environment validation already forbids in production
and in any client profile. A test asserts the absence across all seven
refactored services.

## Attachment authority — STOPPED, not partially changed

**Anonymous attachment intake was deliberately not refactored**, as the
authorization directs when the change would materially widen scope.

`attachment.service` uses its captured Organization as the authority for the
whole anonymous lifecycle, not just batch creation: `startPublic`, and then
`prepare`/`admit` on behalf of `upload`, `preview`, `remove`, `prepareFiles`
and `finalize`. Those internal functions are **dual-authority** — they take an
optional `access?: StaffAccess` and branch between staff and anonymous
handling inside one body. Threading a resident Organization through them
would add a second, mutually exclusive optional authority parameter to the
same functions, which is precisely the implicit mixing the authorization
warns against. Doing it properly means splitting the token-verification,
locking and state-machine core into resident and staff variants.

**Consequence for F060.3C, and it is a blocker.** Because the attachment
service still reads `catalog.developmentOrganizationId`, and that value is
empty under the registry strategy, anonymous attachment intake would fail
under registry-backed serving. `create-service-request.service` also calls
`attachments.prepareFiles(...)` during intake, so resident request creation
with evidence inherits the same limitation. Under the development strategy
the two Organizations are identical and behaviour is unchanged.

**Anonymous attachments must become tenant-aware before F060.3C activates
registry serving.** Recorded here rather than half-done.

## Tracking credential finding — already Organization-bound

`RequestTrackingRepository.resolve` keys on the credential digest alone and
derives Organization from the stored credential, joining the request on a
matching `organization_id` and requiring an active Organization. It accepts no
caller-supplied Organization and no hostname. A credential issued for
Organization A therefore resolves only A's request, and this is proven in the
isolation suite for both Organizations plus an unknown credential.

**No behaviour was invented, and no hostname consistency rule is introduced
here.** The finding, stated precisely:

- Tracking credentials are **Organization-bound in persistence**: the stored
  credential carries its Organization, and the lookup joins the request on a
  matching `organization_id`.
- A credential for Organization A used **while visiting Organization B's
  hostname still resolves A's request**, because the tracking surface is
  **hostname-independent**.
- This is **not treated as a disclosure vulnerability in this slice**: the
  caller already holds A's credential, and no data belonging to B is reachable
  through it.
- **ADR-025 leaves hostname-bound tracking as an open product and security
  decision**, and this slice leaves it open.

## Cross-tenant isolation evidence

`test/database/cross-tenant-isolation.integration.test.ts` seeds two complete,
independent synthetic Organizations on the disposable database and proves,
**8/8**:

- **Alerts** — each Organization sees only its own; neither payload contains
  the other's marker string.
- **Catalog** — categories and published issues are scoped; B's category id
  used under A's context returns nothing rather than B's content, and B's
  published issue cannot be loaded through A.
- **Participation** — areas never cross.
- **Resident Experience** — reads are Organization scoped.
- **Staff reads** — a staff identity in A lists only A's requests and is
  refused B's request by id, because the predicate comes from identity rather
  than the path.
- **Tracking credentials** — each resolves only its own Organization's
  request; an unknown credential resolves nothing rather than falling back.
- **Inactive Organization** — stops serving resident data.

Anonymous creation under a forged Organization body field is proven in
`test/unit/tenant-authority-propagation.test.ts`: a request body carrying
`organizationId`, `organization_id` and `tenant` pointing at B still creates
under A, because the controller passes only `tenant.organizationId`.

## Browser-forged Organization defences

Unchanged and still enforced: the Resident Experience public route rejects any
query, body or content-bearing request; `TenantContext` is server-derived in
middleware; no resident service accepts an Organization argument from caller
input. The propagation test adds explicit proof that forged
Organization-shaped body fields do not influence the anonymous write path.

## Resident failure handling

Unchanged from F060.3A: `not_found` → generic `404`, `unavailable` → generic
`503`, with no Organization id, binding id, lookup reason or registration
status exposed.

## Registry strategy remains unservable

`bootstrap.ts` is untouched and `assertServableTenantStrategy` still refuses
the `registry` strategy. F060.3C is the activation gate, and the attachment
gap above is a prerequisite for it.

## Validation record

Every invocation is recorded; a clean rerun is supplemental evidence, never a
correction of a failure.

| Suite | Result |
| ----- | ------ |
| Tenancy authority propagation units | **9/9 passed** |
| Backend units, serial | **595/595 passed** |
| Cross-tenant isolation (disposable PostgreSQL) — invocations 1–5 | **failed**, fixture defects (see below) |
| Cross-tenant isolation — final | **8/8 passed** |
| Tenant-domain registry regression | **14/14 passed** |
| Full serial disposable PostgreSQL — invocation 1 | 300 enumerated, 294 passed, **6 failed** |
| Full serial disposable PostgreSQL — invocation 2 | 307 enumerated, 302 passed, **5 failed** |
| Full serial disposable PostgreSQL — invocation 3 (ambient variable removed) | 703 enumerated, 699 passed, **4 failed** |
| Full serial disposable PostgreSQL — final | **703/703 passed** |
| API E2E — invocation 1 (ambient) | 51 enumerated, 43 passed, **8 failed** |
| API E2E — invocation 2 (ambient variable removed) | 68 enumerated, 63 passed, **5 failed** |
| API E2E — final (ambient variable removed) | **68/68 passed** |
| API E2E — final (ambient, unchanged condition) | 51 enumerated, 48 passed, **3 failed** |
| Typecheck, test compilation, backend build, lint | passed |
| Shared tests | **64/64** |
| `git diff --check` | passed |
| Changed-file formatting | passed |

### Failures and what caused them

**Isolation-suite failures were defects in my own new fixture**, fixed in
sequence and none of them a product defect: a missing `availability` value, a
circular `service_definition`/`service_definition_version` foreign key needing
a two-step insert, an invalid `geographic_eligibility_mode`, a reference
number violating the uppercase-segment constraint, and a tracking credential
needing a real `staff_identity` row.

**One genuine regression was caused by this work and fixed properly.** The
F060.3A tenant-resolution log event adds one sanitized record per request
sharing the correlation id, and three existing checks asserted exactly one log
line per correlation id. Those assertions are about the single HTTP completion
record, so the tenancy event is now excluded from that count while **every**
correlated line — including the new one — remains privacy-asserted. That is
strictly stronger than before: no assertion was weakened, no timeout raised
and no test disabled.

**E2E failures were stale stubs**, not behaviour changes: `catalog.e2e` and
`service-request.e2e` overrode services with the old signatures. The stubs now
match the new ones and additionally record the Organization they receive.

**The residual ambient failures are unchanged from earlier slices**: an
inherited `CITYVUE_ENABLE_EXTERNAL_IDENTITY` without complete Entra
configuration, which the suites clear `ENTRA_*` for but not that variable.
Two fail directly and three are `parentAlreadyFinished` cascades.

Database validation used only `reqro_f0592_test` as `reqro_test_user`, run
serially with `--test-concurrency=1` because TEST-MAINT remains open.
`reqro_dev` was not accessed.

## Known limitations

1. **Anonymous attachments are not tenant-aware** — a prerequisite for
   F060.3C, documented above.
2. Registry-backed serving remains disabled; the resident path is exercised in
   development-strategy and test conditions only.
3. CORS, throttling and the React API base are unchanged, as F060.3C scope.
4. Hostname/staff consistency is intentionally not enforced.
5. The cross-tenant tracking-credential product decision remains open in
   ADR-025.
