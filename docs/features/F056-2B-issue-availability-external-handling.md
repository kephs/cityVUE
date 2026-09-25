# F056.2B — Issue availability and external handling

Status: implemented locally; automated validation and live mutation/handoff checks passed. The user personally performed manual responsive/keyboard UAT and inspected live API logs, confirming all PASS. See the [validation record](F056-2B-implementation-report.md) and [security review](F056-2B-security-review.md). Starting checkpoint: `a917de52a0fe61cfb5620e7da31e9a33f56368ad`. No push, deployment, F056.2C or F057.

## Accepted design decisions

The user reconciled the third protected answer-read audit as intentional manual UAT. Preserve all three and all other accepted database fingerprints. This is user activity between checkpoints, not an F056.2B mutation.

Availability belongs to the stable Issue, is explicitly selected at creation and is immutable afterward. Values are `INTERNAL_ONLY`, `EXTERNAL_ONLY`, `INTERNAL_AND_EXTERNAL`. Existing Reqro Intake Issues backfill to dual availability without changing their revisions or history. Existing redirects in other environments map to external-only, with an accurately marked current-state history baseline rather than invented past revisions.

`internal_intake` retains its F032 stored meaning: Reqro Intake. Redirect is valid only for external-only Issues. Request audience, channel and requester policy remain separate. Server-owned resident and trusted development-provider PUBLIC creation use external context; authorized staff PUBLIC uses external and authorized INTERNAL uses internal. Channel never determines context.

§149 Option A was explicitly approved: create an inactive Issue using a compatible same-Organization Reqro Intake Template and explicitly selected availability. Configure redirect afterward. No template-free creation, redirect templates or propagation from subsequent source-template changes. Preserve copied historical configuration/questions.

§88 security compatibility migration was explicitly approved: both F032 POST and modern handling writes require Admin read, Issue write and `catalog.issue_action.manage`, preserving trusted Organization and Department/Division scope. Both use one transactional domain command with expected action revision, validation, no-op detection, history and audit. Keep the F032 route and request/response shape. Action-only principals intentionally lose write capability; existing grants and provisioning bundles remain unchanged.

§158 preserves the scoped F032 GET contract. Broad Admin projection contains safe handling/hostname metadata, not full redirect configuration. Full configuration needs existing action-management authority. Resident handoff has its separate public contract. No new permission is needed.

§90 equivalent writes preserve revision and create neither history nor successful mutation audit; stale revisions still conflict. No supported caller dependency on revision churn was found.

## Required implementation and verification

Compose modern Save atomically with independent core/action/policy/assignment revisions. Preserve current/published questions and protected answers. Add constrained availability and immutable redirect history, guarded rollback, apply/rollback/reapply tests, query-level discovery filters, health diagnostics and explicit Add Issue availability. Revalidate current handoff on Continue, require another deliberate Continue after configuration changes, and fail closed for inactive/invalid Issues.

HTTPS validation retains static paths/query/fragments and valid ports, checks normalized length and rejects userinfo, malformed authority and parsed literal local/private addresses. No destination fetch, DNS probe, iframe, interpolation or requester forwarding. DNS rebinding, domain allowlisting and homograph governance remain deferred; URL syntax does not establish trust.

Protocol suites, migration/concurrency/failure tests, authenticated UAT, logging privacy confirmation, responsive/keyboard checks, preservation comparison and final documentation are required before local commit. At most one fictional external-only Issue may be retained from UAT with its legitimate audits/history. Redirect UAT must create no requests, answers, Contact, locations, attachments or tracking credentials.
