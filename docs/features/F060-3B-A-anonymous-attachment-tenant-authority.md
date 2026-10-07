# F060.3B-A — Anonymous attachment tenant authority (ADR-025)

Status: **implemented locally, stopped for security review.** Not staged, not
committed, not pushed, not deployed. **F060.3C remains blocked until this
slice is reviewed and accepted.** No migration was created or authorized.

## Authorization and baseline

Implemented under the F060.3B-A authorization. Fresh branch
`claude/attachment-tenant-authority` from `origin/main` at
`d8dc40c11c348da8c737272cf859f9442e006275`, clean index and working tree.
Forty-six migrations exist and none was added. No dependency changes.

This slice exists because anonymous attachment intake was the remaining
blocker F060.3B recorded before registry activation.

## Attachment authority model

Authority is now a **discriminated union**, not an optional parameter:

```ts
type AttachmentAuthority =
  | { kind: 'resident'; organizationId: string }
  | { kind: 'staff'; access: StaffAccess };
```

with `residentAuthority(organizationId)` and `staffAuthority(access)`
constructors. A caller must state exactly one authority, so **"both" and
"neither" are unrepresentable** — the previous `access?: StaffAccess` shape
allowed either by accident, and an absent access silently meant "anonymous".

| Surface | Organization source |
| ------- | ------------------- |
| Resident / anonymous | `@ResidentTenant()` → `tenant.organizationId` → `residentAuthority(...)` |
| Staff | `staffAccess.organizationId` → `staffAuthority(...)` |

Resident authority cannot override staff authority, staff access cannot stand
in for anonymous authority, no browser-supplied Organization is accepted, and
there is no `DEVELOPMENT_ORGANIZATION_ID` fallback inside attachment services.

## Shared core refactor

The admission core — the private `batch(trx, claim, authority, allowFinal)`
that performs token comparison, row locking, expiry and state checks for
**every** attachment operation — now branches on the authority kind rather
than on the presence of an optional parameter:

- **Resident**: the batch must be `REQUEST_EVIDENCE` **and** belong to the
  authority's Organization. A staff-owned context is not addressable at all,
  even within the same Organization.
- **Staff**: the batch must **not** be `REQUEST_EVIDENCE`, must belong to the
  access Organization, and must match the acting staff identity, after which
  the existing parent authorization runs unchanged.

Both checks are applied twice — once on the candidate row and again on the
locked row — exactly as before. Token digest comparison remains
`timingSafeEqual`, and expiry, `STAGED`/`FINALIZED` state rules, per-Organization
advisory locking and admission caps are untouched.

Previously the resident branch was expressed as "context is `REQUEST_EVIDENCE`
and the Organization equals the captured configuration value and no access was
supplied". The Organization now comes from the caller, and the staff branch
additionally refuses `REQUEST_EVIDENCE` explicitly rather than by falling into
an `else`.

### API changes

| Method | Before | After |
| ------ | ------ | ----- |
| `startPublic` | `(issueId, versionId)` using captured Organization | `(organizationId, issueId, versionId)` |
| `admit` | `(claim, access?)` | `(claim, authority)` |
| `upload` | `(claim, fileId, file, access?)` | `(claim, fileId, file, authority)` |
| `preview` | `(claim, fileId, access?)` | `(claim, fileId, authority)` |
| `remove` | `(claim, fileId, access?)` | `(claim, fileId, authority)` |
| `prepare` | `(trx, claim, owner, digest, access?, prepared?)` | `(trx, claim, owner, digest, authority, prepared?)` |
| `prepareFiles` | `(claim, access?)` | `(claim, authority)` |

`startStaff`, `evidence` and `download` already required a `StaffAccess` and
are unchanged. `finalize` and `assertPriorBatch` act on an already-admitted
batch and are unchanged.

`AttachmentUploadGuard` serves both resident and staff upload routes, so it
now names the authority itself: verified staff identity when present,
otherwise the resolved resident tenant via `residentTenantFromRequest`, which
**fails closed with a generic 404** when no tenant resolved.

## Removed fallback

`attachment.service.ts` no longer reads `catalog.developmentOrganizationId`
and no longer holds an `organizationId` field. A test asserts the absence of
both, and of any remaining `access?: StaffAccess` entry point.

Development behaviour is unchanged because `@ResidentTenant()` already
produces the explicitly configured development Organization.

## Resident creation evidence flow

`create-service-request.service` threads the request's Organization through
the complete evidence lifecycle: `prepareFiles(claim, residentAuthority(context.organizationId))`
and `prepare(..., residentAuthority(context.organizationId), ...)`. The
Organization used is the same `context.organizationId` the request is
persisted under — taken from the resolved resident tenant on the anonymous
path and from the verified trusted context on the trusted path — so a batch
cannot redirect the persisted Service Request Organization, and a forged
Organization body field influences neither.

`executeStaff` continues to reject attachments outright.

## Staff authority preservation

Staff attachment operations still derive Organization only from
`staffAccess.organizationId`. `authorizeParent` and its permission checks,
the note and communication privacy middleware, audit records and private
storage behaviour are unchanged. Hostname `TenantContext` does not reach any
staff attachment path.

## Cross-tenant evidence

`test/unit/attachment-tenant-authority.test.ts` (**11/11** with the existing
attachment unit suite) proves against the admission predicate:

- A resident of Organization A cannot reach an A-vs-B evidence batch other
  than its own, in either direction.
- Resident authority cannot reach a staff-owned batch **even in its own
  Organization**.
- Staff authority cannot stand in for anonymous evidence authority.
- Staff authority is bounded by both Organization and acting identity; a
  different operator in the same Organization is refused.
- The service holds no Organization and exposes no optional-access entry
  point.
- An unresolved resident tenant fails closed before any attachment work.

Existing attachment integration coverage in `participation-checks` and
`trusted-requester-history-checks` exercises the real resident lifecycle —
batch creation, upload, metadata stripping, finalization through request
creation — now under explicit resident authority.

## Preserved behaviour

File-count and size limits, MIME restrictions, EXIF metadata stripping, token
expiry, private local storage, the scanner stub, admission concurrency caps,
per-Organization hourly caps, audit records and logging privacy are all
unchanged. No assertion covering them was modified.

## Validation record

| Suite | Result |
| ----- | ------ |
| Attachment authority + existing attachment units | **11/11 passed** |
| Backend units, serial | **603/603 passed** |
| API E2E — ambient | 51 enumerated, 48 passed, **3 failed** |
| API E2E — ambient variable removed | **68/68 passed** |
| Typecheck, test compilation, backend build, lint | passed |

The ambient E2E failures remain the inherited `CITYVUE_ENABLE_EXTERNAL_IDENTITY`
condition recorded in every slice since F060.1: the suites clear `ENTRA_*` but
not that variable. Two fail directly and one is a cascade.

Database validation, run only against `reqro_f0592_test` as
`reqro_test_user`, serially with `--test-concurrency=1` because TEST-MAINT
remains open. `reqro_dev` was not accessed.

| Suite | Result |
| ----- | ------ |
| Attachment-bearing integration (`request-audience`, which runs the participation and trusted-requester-history checks) | **404/404 passed** |
| Cross-tenant isolation regression | **8/8 passed** |
| Full serial disposable PostgreSQL | **703/703 passed** |
| Shared tests | **64/64 passed** |

Every database invocation passed on its first run; there were no database
failures or reruns to preserve for this slice. The resident attachment
lifecycle — batch creation, upload, EXIF stripping, finalization through
request creation, evidence isolation and tracking-projection exclusion —
is exercised under explicit resident authority and remains green.

## F060.3C remains blocked

**F060.3C is not unblocked by writing this code.** It remains blocked until
this slice is reviewed and accepted. Registry serving also still requires the
remaining F060.3C work itself — bootstrap activation, trusted-proxy
configuration, CORS and throttling decisions, and the frontend same-origin API
base — none of which is in scope here. `bootstrap.ts` is untouched and
continues to refuse the `registry` strategy.
