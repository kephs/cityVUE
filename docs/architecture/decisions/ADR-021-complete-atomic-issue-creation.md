# ADR-021 — Complete atomic Issue creation

Status: Accepted and validated for F056.5. Supersedes only ADR-019's two-step creation workflow and mandatory-template creation rule. Its Availability matrix, immutable Availability, F032 authorization and handoff governance remain accepted.

## Decision

POST /admin/issues accepts the complete reviewed Add draft in one command owned by the existing AdminIssueService transaction. Category is explicit and authoritative. Priority, Service Location policy, Geographic Eligibility and Availability are explicit. Source copying is optional, limited to eligible active Reqro Intake Issues in the selected Category, and requires the reviewed source catalog version. A changed version conflicts rather than copying unseen configuration. This source eligibility was reconfirmed by the user; External Redirect sources are rejected, correcting the contradictory test example in §372.

No authoritative restricted-policy selection registry exists in the current provider/configuration. Creation therefore supports only a deliberate no_geographic_restriction selection with null policy reference; synthetic boundary support is not a policy registry. Restricted policies are rejected, including on creation from a source unless the administrator deliberately chooses a supported final policy. Future configured restrictions must require Service Location; no optional/not-applicable restricted combination is approved.

Template-free technical initialization uses file-earmark-text, empty aliases/keywords, null routing metadata, block on undetermined eligibility, and an empty question list unless authored. Existing question helpers generate keys and active rows; unsupported custom condition/validation authoring is not added. Copy retains approved icon and reviewed question metadata, but not source Category authority, identity, Availability, Handling, handoff, requester policy, assignment, order, operational records or history. Category/source changes protect edited copied drafts.

## Transaction and authority

Validate the complete draft even though the Issue starts Inactive. Lock/revalidate Organization, Category hierarchy and any source; validate source version and Category-based assignment with existing eligibility. Insert the new stable Issue, independent catalog version/questions, policy and optional assignment. Invoke the existing configureIssueAction command on the same transaction for External Redirect. Required creation/action audit and action history participate in rollback. No second browser mutation or preliminary committed Issue exists.

Ordinary intake creation retains Admin read and Issue write authority. Redirect additionally requires existing action-management permission and F032 Department/Division scope on the selected Category. No new permissions, grants or provisioning changes. The matrix remains internal-only/dual = intake; external-only = intake or redirect.

Core initialization retains the existing insert/publish-pointer behavior. Policy initialization and absent-assignment no-op semantics remain. Redirect legitimately moves the uncommitted default action revision 1 to revision 2 through F032 and records its existing history/audit. Do not fabricate revision-1 history or rewrite independent revisions for appearance. Existing schema is sufficient; no migration is authorized.

## Compatibility and validation

The previous mandatory-template-only request shape is deliberately replaced for repository callers: explicit category/priority/location/geography/handling/questions are required, with optional templateId plus expectedSourceVersion. Existing template scenarios remain supported through this reviewed extended contract. Do not claim wire compatibility for the old incomplete shape.

Completion requires unit/API/PostgreSQL/React regressions, failure injection proving no surviving creation artifacts, scope and stale-source tests, authenticated UAT/privacy, responsive keyboard review, and baseline reconciliation. Earlier compatible workspace polish stays in the same new follow-up commit. F057, push and deployment are not authorized.

Related: [ADR-019](ADR-019-issue-availability-governed-handoff.md), [ADR-017](ADR-017-atomic-issue-configuration.md), [F056.5](../../features/F056-5-issue-management-workspace-ux.md), [F045](../../features/F045-requester-issue-location-experience.md).
