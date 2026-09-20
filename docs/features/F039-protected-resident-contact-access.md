# F039 — Protected Resident Contact Access

Status: implemented and validated, including populated manual live API UAT, audit/log correlation, contact revocation/restoration and final PUBLIC denial with preserved INTERNAL access. The operator approved a narrow PUBLIC contact endpoint requiring existing PUBLIC read plus independent contact permission. This resolves the populated-UAT dependency without changing F029 INTERNAL intake or starting the F040 PUBLIC workspace. See [the approved design](F039-public-contact-read-design-review.md).

## Privacy boundary

REQUEST ACCESS DOES NOT IMPLY CONTACT ACCESS.

ASSIGNMENT AND WATCHING DO NOT GRANT CONTACT ACCESS.

SERVICE LOCATION AND REQUESTER CONTACT ARE DISTINCT DATA CONCEPTS.

F039 PROTECTS STRUCTURED CONTACT FIELDS; FREE-TEXT REQUEST CONTENT MAY STILL CONTAIN INCIDENTAL PII.

The existing `requester_contact` model stores a required name and optional email, related by Organization and request. There is no structured phone or requester-address field. F039 does not add fields, normalize historical values, or infer contact from staff submitter/requester identity. Staff-assisted PUBLIC intake retains its separate resident contact and staff submitter. INTERNAL staff intake continues to reject resident contact. Imported/legacy structured contact can be protected without changing intake policy.

Service location remains operational data in authorized request projections; it is distinct from a requester's address/contact and can itself be sensitive. Name/email are protected structured contact. Reference is an operational identifier, never proof of access. Staff attribution has its own identity rules. Descriptions and follow-up answers may contain incidental PII; future notes, attachments and communication will need their own handling. No redaction or AI detection is implemented or claimed. These are conceptual handling expectations, not a formal regulatory classification.

## Authorization and HTTP contract

`GET /api/v1/staff/internal-service-requests/:serviceRequestId/contact` requires normal Entra verification, trusted database-resolved Organization/staff identity, `service_request.internal.read`, current department/division scope, INTERNAL audience, and independent `service_request.contact.read`. Development fallback is refused. Assignment, watching, operational roles/teams and update permission do not supply either key. References are not used to retrieve contact. Caller-supplied query parameters are rejected.

`GET /api/v1/staff/public-service-requests/:serviceRequestId/contact` separately requires Entra authentication, existing `service_request.view`, independent `service_request.contact.read`, PUBLIC audience and existing category Department/Division scope in the trusted active Organization. INTERNAL and PUBLIC IDs cannot cross these routes. PUBLIC view retains its existing scoped list/detail meaning; it is not reinterpreted as contact-only authorization. No PUBLIC workspace/navigation/workflow UI is added.

The allowlisted response is `{ name: string | null, email: string | null }`. An authorized request without a contact row returns both fields null. Partial data retains only its authoritative stored values. No masking, field-presence hints, resident identity-provider lookup or broader profile is returned. Ordinary request list/detail projections omit contact, including the older PUBLIC detail route. The older detail UI shows Protected rather than rendering injected name/email fields.

Unauthenticated calls return 401; missing permission returns 403. Unknown, malformed, wrong-audience, other-Organization and out-of-scope requests return safe 404 after permission admission. Unauthorized responses reveal no contact presence. Both contact routes use `Cache-Control: no-store` on success, guard denial, validation errors and server failures through narrowly registered pre-guard middleware.

Authorized internal detail adds only server-derived `canReadContact`. It is not a client permission source and cannot authorize the endpoint. No capability is returned for an inaccessible parent.

## Reusable service, query and audit

`RequestContactService` accepts a trusted server-owned access policy. Each controller supplies its audience-specific policy; the browser cannot choose it. The PUBLIC policy selects only the parent ID using the same category Department/Division boundary as existing PUBLIC detail. A future PUBLIC workspace can reuse this reviewed contact boundary without copying contact into ordinary detail. The contact permission remains separate for both audiences. Shared parent/category/Organization locks preserve the selected scope during disclosure; permission revocation follows existing next-request semantics rather than retroactively cancelling an admitted request.

The service checks both permission keys before querying. In one transaction it resolves the scoped parent, takes shared locks on request/category/Organization to prevent concurrent routing across the checked boundary, selects only name/email by Organization and technical request ID, and inserts a security audit. The promise resolves only after commit. Audit failure returns no protected payload, including no partial success, and changes no request/contact/operational activity.

The existing append-only security table `activity` records `service_request_contact_viewed`, Organization ID, request ID, staff actor type, internal staff principal ID, database timestamp and metadata `{ policy: "F039", action: "contact_viewed", correlationId }`. The correlation ID comes from normal server request middleware. `actor_reference` is null. No contact values, description, narrative, email, token or directory identifiers enter audit metadata. Empty authorized contact reads are also audited. Ordinary list/detail does not create contact-view events. Denials use existing sanitized request/error logs; no second denial-audit subsystem is introduced. Operational Activity remains separate and contains no contact-view event; the legacy detail activity query also excludes this security event.

Normal retrieval performs a scoped parent select, indexed contact select and audit insert, in addition to established database-backed authorization. Existing request primary/composite keys and requester-contact uniqueness support lookup. There is no Organization-wide contact scan, N+1 lookup, history retrieval or directory call. Audit writes and database permission resolution have a per-disclosure cost. Future production abuse monitoring/rate controls and retention require separate design; bulk enumeration is not added.

## Staff UI and state lifecycle

The Requester Contact card uses F038 presentation primitives below the primary request information. Contact is supporting information. Without capability it shows **Protected** and “You don't have permission to view requester contact information.” It does not reveal which fields exist or put hidden contact in the DOM.

An authorized user explicitly activates **View requester contact**. This avoids automatic disclosure, Strict Mode duplicate audit requests and list prefetch. The initial explanation is “View protected structured contact for this request. Access is audited.” Loading says “Loading requester contact…”. Full/partial results display only populated Name/Email fields. Empty results say “No contact information was provided.” Error says “Requester contact could not be loaded. Please try again.” The refresh/retry controls are explicit; no polling occurs.

Values remain escaped plain text, preserve Unicode and useful whitespace, and wrap long strings. No HTML injection, mailto/tel links, bulk copy, analytics or contact storage is added. Plain text avoids interpreting stored values as commands or URLs. Phone display is not applicable to the current schema. Labels, semantic definition lists, headings, disabled pending buttons and status/alert feedback support keyboard and assistive reading; no WCAG certification is claimed.

Contact is held only in request-scoped React memory. Navigation remounts detail, aborts in-flight contact and ignores late results. Auth identity change/sign-out unmounts protected state. Request access failures clear contact and parent. A contact-only 403 clears contact and rechecks the parent, preserving normal detail only if it remains authorized. A transient contact error clears prior contact but preserves authorized detail. Known capability loss clears contact. Revocation is observed on the next API request; no push revocation mechanism exists. Workflow/activity refresh does not refetch contact. Routing still rechecks parent authorization; known access loss clears protected state.

## Migration and development provisioning

`20260920010000-add-request-contact-access` adds the permission key and permits the contact-view security audit type. It changes no contact schema/data and creates no grants. Rollback/reapply is supported before use. Rollback refuses if contact grants or contact-view security events exist, preserving meaningful privacy audit. Disposable tests cover preservation of requests, contact, existing grants, ownership/watchers and operational history.

F036 accepts `service_request.contact.read` explicitly. FULL_UAT_OPERATOR expands from the previous six permissions to seven: `service_request.create`, `service_request.create_internal`, `service_request.internal.read`, `service_request.contact.read`, `service_request.internal.update`, `catalog.issue_action.manage`, `service_request.reference.manage`. Existing `service_request.view` and geospatial remain optional individual selections, excluded from that seven-key bundle. Other bundles are unchanged. Updating code/migration does not change stored grants. Runtime never interprets bundle names. PUBLIC view is temporarily authorized only for the approved fictional UAT and must be removed afterward; contact.read is retained.

Use the existing F036 runbook and ignored personal configuration. Select only `F036_PERMISSIONS=service_request.contact.read`, unset bundle selection, then run provision dry-run and explicit confirmation after validation/migration. Retain the existing fictional Organization/scopes and principal. Revoke only that permission with the matching targeted deprovision commands to prove ordinary request access remains; re-provision explicitly if retaining for future UAT. No sign-in/startup/migration automatically provisions anything.

## Validation and release gate

Automated coverage exercises the two-key matrix, same-Organization/current-scope constraints, cross-audience exclusion, forged query rejection, no-default-grant migration, assignment/watcher/team independence, no/partial/populated contact, minimized projections, safe audit/correlation, failure injection, log sanitation, immediate grant revocation and safe rollback. React tests cover protected DOM absence, explicit single-flight fetch under Strict Mode, separate workflow refresh, plain-text XSS fixtures, errors, auth loss and stale navigation responses.

Live validation is limited to normally authenticated personal Entra access against localhost reqro_dev with explicit F036 grants and fictional requests. The approved extension permits one new fictional PUBLIC/PHONE request through normal staff-assisted intake, temporarily provisioning PUBLIC view, and comparing actual protected name/email in memory through the normal API client. No real contact is used and no INTERNAL contact is manufactured. Browser coordination remains manual; no token copying or browser-control safety workaround is permitted. Populated disposable/React evidence must not be described as live UAT. These live gates passed: populated success, contact revocation/restoration, safe audit/log correlation, temporary PUBLIC view removal and final normal authorization checks. F040/F041 remain unstarted.

Manual browser coordination completed the existing request's Protected → authorized no-contact → Protected after targeted revocation → authorized no-contact after restoration sequence. The operator confirmed restored detail/contact access without re-login. Two successful no-contact reads produced two safe security audits; the 25 operational events and existing request/contact/ownership data remained unchanged. Contact permission is explicitly retained alongside the original six development permissions. The subsequently approved populated PUBLIC API UAT passed disclosure, contact revocation/restoration and live HTTP/audit/log correlation. Two fictional PUBLIC/PHONE requests were created through normal intake; both are disclosed and preserved in the report. Temporary PUBLIC view was removed, restoring the seven-key development grant set. The operator confirmed final PUBLIC list/detail/contact 403 and existing INTERNAL detail/contact 200. Captured normal HTTP logs agree, and the final grant/data-integrity check passed. See [the validation checkpoint](F039-validation-checkpoint.md) for the exact evidence and limitations.

No contact editing, contact search, profile/household model, field-specific permissions, exports, messaging, consent/preferences, notes, retention changes, notifications, PUBLIC workspace or production permission administration is added. Contact visibility does not authorize resident communication. See the completion report for measured test/UAT/database results and remaining limitations.
