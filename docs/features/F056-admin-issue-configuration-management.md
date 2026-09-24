# F056 — Admin Issue Configuration Management

Subsequent [F056.1 discovery refinement](F056-1-issue-management-scalability-ux.md) replaces the UI’s current-page template dropdown and full-row list loading with dedicated summary/template search endpoints and authoritative detail on action entry. This F056 record retains its original checkpoint evidence; its mutation contract and existing list API remain compatible.

Status: implemented and validated locally from synchronized `79f26a111cba380c3620f1095919ee625934c9fb`. No push, deployment or F057. Follow the [development protocol](../development/REQRO_CODEX_PROTOCOL.md).

## Approved design decisions

The user's explicit follow-up supersedes the original specification's simplified single-revision and mutable-name assumptions. Stable Issue identity, immutable published catalog versions, action revision, requester-policy revision and default-assignment revision remain separate. A narrowly scoped core configuration revision covers current catalog version, state and ordering; it is not a global/page revision. One editor may submit one atomic command carrying every relevant expected revision. Lock the trusted Organization-scoped Issue, validate all revisions and the complete proposed configuration, persist changed resources and required audits, then commit together. Stale or failed commands leave every resource and audit unchanged. Existing F048/F049 revision and audit semantics remain authoritative.

Name/description edits publish a new immutable version and copy the existing form with fresh version/question/option identities. Existing requests retain their stored version, names/descriptions/forms and stable Issue relationship. No historical version or request is rewritten. Action configuration is not editable in F056.

Issue display order is a new nonnegative signed-32-bit integer, initially zero for existing Issues. Keep Category grouping and order within each Category by display order, display name, stable Issue ID. Ties are valid. Use numeric **Change order**, never adjacent Move Up/Down. Existing alphabetical presentation is preserved initially.

Display names are trimmed before validation/persistence, plain text, at most the existing 200-character limit, and database-unique under trimmed case-insensitive comparison within an Organization across active/inactive Issues. Preserve display capitalization and existing service-key uniqueness. Inactive names remain reserved: reactivate the original Issue. Other Organizations may independently use the same name. Existing data has no logical-name collisions; do not rename or merge records. Historical versions are outside the current-name namespace.

Creation uses an explicitly selected valid same-Organization internal-intake Issue template. Copy-on-create includes its Category relationship, icon, priority, location/geographic rules and form configuration, with fresh identities. Copy only an explicit field allowlist, never the entire domain. Requester policy and default assignment come from the form. Template changes never propagate. New Issues are Inactive until explicit activation and validation. No Category restructuring, action/redirect editing, new audience model or form designer is introduced.

Current active eligibility must be checked again under the creation transaction's stable-Issue lock. Preserve PUBLIC, assisted PUBLIC and INTERNAL behavior, current requester-policy authority, default assignment at creation, and original finalized attachment retry behavior. No existing requests are reassigned or reclassified.

## Authorization and baseline

Management requires both `admin.configuration.read` and new `admin.issues.write`, with zero default grants. Intake/area/analytics/operational assignment permissions confer no Issue-management authority. Scope derives from trusted server context; foreign Issue/template/target IDs never disclose foreign state. Preserve F048 staff/role/group eligibility and safe labels. Assignment is ownership, not authorization. No destructive Issue deletion.

Verified read-only baseline: clean synchronized main; 32 migrations/zero pending; six active Issues across five active Categories; all current versions 1; requester-policy revisions 1; Damaged Street Sign action revision 3/default-assignment revision 1, other action revisions 1/default-assignment revisions 0. Collection Enabled/revision 3; five active/zero inactive Participation Areas; West Demo District active/revision 8/order 3; Fictional North-East Area intentionally user-created/revision 1/order 4; F053 audits 2/F055 audits 9; five analytics-read audits previously reconciled; privacy threshold 5; Reqro default branding/revision 3; tracking 1 active/5 revoked; SR-202609-000013 exists. Existing Admin read, Intake write, area write and analytics grants each remain unchanged. No Issue-write grant yet.

## Required validation and stop points

Disposable migration apply/rollback/reapply, database-enforced create/rename uniqueness races, same-Issue revision conflicts, independent-Issue writes, no-op behavior, transaction/audit rollback, template/form independence, historical preservation, locked deactivation race, current policy/default assignment and F048–F055 regressions are required. Run the protocol suites, builds, lint/formatting, links, whitespace and private-value review.

Use normal personal Entra UAT. Before provisioning only Issue write, the user must confirm the valid pre-grant mutation returns HTTP 403. Retain one fictional F056 Issue and legitimate audits; avoid new retained requests. Verify create/edit/activate/deactivate/reactivate/conflict/no-op, requester intake visibility, responsive widths 1440/1280/1024/768/390, both themes and keyboard/focus. Live logging privacy and final data integrity must pass before local commit. Remove temporary helpers/captures. This is development validation, not WCAG certification or production-readiness certification.

Implementation, automated validation, development migration and confirmed pre-grant/grant sequence are complete. Authenticated mutation UAT, final data reconciliation and user-confirmed responsive/logging checks passed. See the [validation record](F056-implementation-report.md) for actual revisions, retained audits, limitations and local delivery. No push, deployment or F057.
