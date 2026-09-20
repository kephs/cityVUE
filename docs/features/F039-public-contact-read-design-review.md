# F039 — Approved PUBLIC protected-contact read design

**Status: approved by the operator on 2026-09-20; implemented and validated in F039. Populated manual live API UAT, audit/log correlation, contact revocation/restoration and final PUBLIC denial with preserved INTERNAL access passed. Temporary PUBLIC view is removed.** Approval covers the narrow endpoint, an explicit temporary PUBLIC view grant, one fictional staff-assisted PUBLIC request, and the procedure below. Commit is authorized only after all required UAT, audit/log correlation, grant cleanup and validation pass. F040/F041 remain excluded.

## Original blocking prerequisite and approved resolution

- F029 INTERNAL creation is staff self-service. `CreateServiceRequestService.executeStaff` requires identified reporting and rejects any `contact` object with “Internal intake requires the authenticated staff requester without resident contact.” The requester is the authenticated staff principal. Changing that rule solely for UAT is excluded.
- Existing `POST /api/v1/staff/service-requests` can create an identified PUBLIC request with structured **name** and optional **email**, using normal Entra authentication and `service_request.create`. There is no structured phone field. Service/version, questions, location, requester policy and redirect validation still apply.
- Existing PUBLIC ordinary reads use `service_request.view`, trusted Organization and catalog Department/Division scope. F039 removes structured contact from those ordinary payloads. Creation permission does not confer PUBLIC read access.
- Before this extension, the F039 contact controller exposed only `GET /api/v1/staff/internal-service-requests/:serviceRequestId/contact`. Its server-owned policy explicitly selects INTERNAL. A PUBLIC ID remains inaccessible even with contact permission. That boundary remains unchanged; the approved PUBLIC controller is separate.
- Before the approved UAT, the personal principal has seven permissions including contact.read and no `service_request.view`. The updated F036 manifest accepts view only as an explicit optional selection. The seven-key FULL_UAT_OPERATOR bundle is unchanged by this extension.

Consequently, merely creating a PUBLIC request cannot supply the requested positive protected-contact HTTP/audit/log proof. Calling the service with a permissive test policy, fabricating StaffAccess, reading PostgreSQL directly, or reclassifying a request would not constitute legitimate live endpoint UAT.

Source: [F029 intake service](../../server/src/service-request/create-service-request.service.ts), [staff intake controller](../../server/src/service-request/staff-intake.controller.ts), [contact DTO](../../server/src/service-request/service-request.dto.ts), [existing PUBLIC controller](../../server/src/service-request/service-request.controller.ts), [PUBLIC detail scope](../../server/src/service-request/get-service-request-details.service.ts), [F039 contact service](../../server/src/service-request/request-contact.service.ts), [INTERNAL scope](../../server/src/service-request/internal-request-scope.ts), and [F036 manifest](../../server/src/database/development-staff-input.ts).

## Implemented contract

The extension adds exactly one explicit audience-specific read endpoint:

```text
GET /api/v1/staff/public-service-requests/:serviceRequestId/contact
```

Use the existing F039 `RequestContactService`, structured projection, transaction and security audit. Supply a new server-owned PUBLIC access policy. Keep the INTERNAL endpoint and its policy unchanged. No browser-provided audience/policy selector and no generic fallback from INTERNAL to PUBLIC.

Admission requires all of:

1. Existing validated Entra access token and delegated API scope; explicit Entra-only guard, no development fallback.
2. Active mapped staff identity and trusted Organization from normal database-backed authorization.
3. Existing `service_request.view` permission for PUBLIC request read.
4. Independent `service_request.contact.read` permission.
5. A matching PUBLIC request in the same active Organization and authorized Department/Division scope.

Both permissions are checked on every request. The service must enforce its supplied PUBLIC policy even if invoked outside its controller. Creation, internal.read/update, assignment, watcher relationships and operational membership confer neither PUBLIC read nor contact permission.

| Authorized PUBLIC request access | contact.read | Contact result                                                 |
| -------------------------------- | ------------ | -------------------------------------------------------------- |
| No                               | No           | Denied                                                         |
| No                               | Yes          | Denied                                                         |
| Yes                              | No           | Denied; ordinary PUBLIC detail remains independently available |
| Yes                              | Yes          | Only authorized name/email projection, after audit commit      |

Response remains `{ name: string | null, email: string | null }`. Do not invent phone, address, submitter identity, resident-profile fields or contact-presence hints. Use `Cache-Control: no-store`, including failure responses from this endpoint. Keep the existing server-generated `x-correlation-id` response header. Reject unknown query parameters; match the existing PUBLIC detail UUID-v4 validation rather than accepting a human reference or a broader identifier shape.

Unauthenticated/invalid authentication returns 401. Missing required permission returns 403. After permission admission, nonexistent, malformed, INTERNAL, cross-Organization, inactive-Organization and out-of-scope records return the same safe 404. Failed required audit persistence returns the existing sanitized server error with no contact response. No error echoes supplied contact or database details.

## PUBLIC scope and transaction

The new policy performs a narrow authorized parent query, selecting only the request ID. Match the existing PUBLIC detail semantics: Organization-bound request/category/department joins, PUBLIC audience, the category's Department in trusted memberships, and either no category Division or that Division in trusted memberships. Empty Department membership denies all; empty Division membership admits only Department-level requests. Require an active Organization as an additional fail-closed condition.

Do not reuse `loadDetails` to fetch the full request, answers, history, assignment or location. Do not substitute INTERNAL effective-routing rules for the current PUBLIC scope model: existing PUBLIC reads authorize against category Department/Division. Future PUBLIC routing must revisit all related read policies together. Test the new policy against the existing PUBLIC detail behavior to prevent scope drift; keep any common predicate extraction tightly bounded.

Reuse the F039 transaction: authorized parent select with shared request/category/Organization locks, Organization/request-constrained contact select, then durable audit insert. Return only after commit. Use existing request keys and contact uniqueness; no Organization-wide scan or identity-provider contact lookup. Concurrent permission revocation retains the existing next-request semantics; do not claim retroactive cancellation of an already authorized request.

Audit remains `service_request_contact_viewed` in the security `activity` table, with Organization, technical request, internal staff principal, staff actor type, timestamp, null actor reference, and `{ policy: "F039", action: "contact_viewed", correlationId }`. No name/email/phone, contact DTO, description or raw Entra metadata. Authorized empty reads are audited too. Ordinary reads and denied contact reads do not create a successful contact-view event. F035 operational Activity is untouched.

## Permission provisioning consequence

F036 accepts the **existing** `service_request.view` key as an explicit optional permission. Preserve all local profile/database/principal/scope checks and targeted provenance-based deprovisioning. No new permission key or database migration is needed for this extension; the current F039 migration remains unchanged.

Keep `FULL_UAT_OPERATOR` at its current seven permissions. The implementation retains one explicit seven-key UAT manifest, derives FULL_UAT_OPERATOR from it, and constructs the accepted permission list from that manifest plus separately selectable `service_request.view` and `geospatial.read`. Tests assert the exact expansion. No new bundle is needed and no stored grant changes automatically.

For approved personal UAT only, explicitly provision `service_request.view` in the existing fictional Organization/scopes after a dry run. This key also enables the existing scoped PUBLIC list/detail endpoints, not just the proposed contact route. That additional operational visibility is a material part of the review; it must not be presented as a contact-only privilege. It does not confer PUBLIC workflow/assignment or broaden scope membership.

Required final state after UAT: retain contact.read as already authorized, revoke the additional F036-owned PUBLIC view grant, and leave the original seven permissions/scopes intact. Any independent pre-existing PUBLIC view grant must be preserved. Retaining PUBLIC view would require a separate explicit decision.

## Bounded implementation footprint

| Area                 | Implemented work                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Contact API          | One PUBLIC controller registered in the existing service-request module; no contact-write route                          |
| Contact policy       | One narrow PUBLIC policy using existing PUBLIC read semantics and the F039 service                                       |
| Cache/error boundary | Verify no-store on success and guard/service failures; add a narrowly scoped mechanism only if required                  |
| F036 tooling         | Optional existing PUBLIC read key; preserve the exact seven-key FULL_UAT_OPERATOR expansion                              |
| Tests                | PUBLIC creation/contact HTTP matrix, scope parity, audit/log correlation, cache/error behavior and explicit provisioning |
| Documentation        | Record approved boundary, actual UAT evidence and final grant state                                                      |

No PUBLIC staff workspace, list/detail UI route, queue, navigation, capability field on PUBLIC ordinary detail, or PUBLIC workflow is proposed. No contact editing/search/export, INTERNAL intake change, phone schema, new grant endpoint, bypass, default grant, role administration, migration or production deployment is proposed. The existing INTERNAL contact UI remains unchanged; populated rendering remains React-test evidence for this PUBLIC UAT path.

## Approved acceptance and manual live UAT procedure

1. Run focused safety tests before local provisioning or data creation. Reconfirm localhost:5432 / reqro_dev / reqro_dev_user, development profile, migrations and exact selected principal/scopes. Capture read-only hashes of existing requests, contacts, configuration, history and ownership. Never modify the named existing requests.
2. Explicitly provision only PUBLIC view through F036. Use an existing fictional eligible Issue and normal `POST /api/v1/staff/service-requests` with PUBLIC audience, PHONE channel, identified reporting, fictional name/email, description and the Issue's required answers/location. Record the new reference. Use no phone field because none exists. Verify staff submitter and resident requester remain separate. Creation may legitimately advance the reference counter; existing references and reference-format configuration must remain unchanged.
3. Use the normal personal Entra flow and API client. If a temporary local UAT harness is needed because staff intake has no UI, it must only invoke existing intake/read APIs and the approved contact API, using the existing AuthRoot/MSAL client. It must display safe status/field-match verdicts, reference and correlation only, not become a PUBLIC detail/contact presentation route. Do not extract/copy tokens, inject identity, create alternate server auth, expose a browser grant editor, or call a permissive policy directly. Browser steps remain manual unless the normal automation safety requirements are satisfied.
4. Remove only contact.read through F036 while retaining PUBLIC view. Verify ordinary scoped PUBLIC reads succeed without contact values and the new endpoint returns 403. Existing INTERNAL contact state must also obey the revoked permission. Confirm no contact values in list/detail, operational Activity or available logs.
5. Restore contact.read through F036, without re-login. On the same new request, verify 200, exact populated name/email and no extra fields, no-store, and one contact-view security audit. Verify IDOR, audience and authorization failures through disposable automated fixtures; do not broaden live scopes for negative tests.
6. Correlate that actual successful HTTP response, security audit and normal API log using the server-generated ID. The operator may read only `x-correlation-id`, HTTP status and cache policy from Chrome Network response headers. If only the preflight is identified, use the captured actual successful GET log and matching audit ID instead; do not claim an independent browser-header observation. Do not copy Authorization headers, cookies, tokens, full HARs or contact bodies. The current frontend client looks for `x-request-id` and CORS does not expose `x-correlation-id` to frontend JavaScript; do not assume the current client can supply it or add unrelated client/CORS changes solely for this check.
7. Arrange normal API stdout capture before the test using the established local launch command and an ignored temporary log. Inspect by correlation ID and scan contact values in memory without printing them or placing them in shell search commands. Record only safe findings. Without a captured live record, do not call correlation complete. A synthetic/disposable test log cannot substitute for this live evidence.
8. Verify audit actor/Organization/request/timestamp/action/correlation and absence of contact/description; compare operational history before/after contact viewing. The new request's normal creation history is legitimate; contact reads add no operational event. Preserve the fictional request rather than deleting history for cleanup.
9. After the positive proof, remove contact.read while retaining view and repeat the ordinary-read-success/contact-denial checks. Restore contact.read explicitly. Then remove only the newly added PUBLIC view grant. Verify ordinary PUBLIC list/detail and the contact endpoint are denied with contact.read retained; existing INTERNAL access must still succeed. Verify the original seven permissions/scopes and all pre-existing data are preserved. Remove temporary harness/log/helper files; keep permanent tests/docs. Run the full requested backend/API/PostgreSQL/shared/React/provisioning/type/lint/format/build/diff/private-configuration validation, with zero unexplained PostgreSQL skips.

Populated HTTP/audit/log evidence through this approved PUBLIC boundary plus React populated-rendering tests will replace the impossible INTERNAL populated live path described in the latest requested fallback. It would not constitute live PUBLIC staff UI validation. Commit eligibility still depends on successful evidence, all required checks, and the operator's approved scope; the operator has approved a commit only after those conditions pass.

## Validation evidence

The focused run passed **97 checks, zero failures/skips**, including the eight new PUBLIC PostgreSQL HTTP cases, the PUBLIC service permission test and targeted F036 PUBLIC-view grant/removal test. It verifies both-key admission, same-Organization/category Department/Division scope, cross-audience/IDOR denial, populated/partial/empty projections, no-store on errors, durable audit/log correlation, forced-audit-failure sanitation and immediate next-request revocation. Production backend build passes. Full suites passed 180 backend unit, 36 E2E, 114 PostgreSQL (zero skips), 62 shared and 278 React tests. Populated live disclosure and contact revocation/restoration passed; two successful HTTP200 records each correlate to one safe audit. Captured logs contain no fictional contact or description. Temporary view is removed while contact and the original six grants remain. The operator confirmed final PUBLIC list/detail/contact 403 and INTERNAL detail/contact 200; captured HTTP logs and final grant/data-integrity verification agree. See [the validation report](F039-validation-checkpoint.md) for evidence and limitations. These automated results are not live personal-Entra UAT.
