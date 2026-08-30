# F004 — React Stage 6 Edit and Delete Workflows

**Status:** Implemented prototype compatibility workflow  
**Scope:** React migration Stage 6

## Implemented Behavior

React provides `/issues/:issueId/edit` and confirmed deletion from `/issues`. Lookup, update, and deletion remain behind `IssueService`; React does not access the `cityvueIssues` local-storage key directly.

Existing issues are classified conservatively. A record is catalog-matched only when its trimmed title exactly and case-sensitively equals one active Service name and its trimmed category exactly equals that Service Category's legacy-compatible category. Any missing, malformed, mismatched, or uncertain record uses the legacy-compatible edit form.

Catalog-matched editing presents the current Category and Service context while allowing safe edits to the persisted legacy description, priority, reporter, and location. Legacy fallback editing exposes title, description, category, priority, reporter, and location. Both paths preserve the Issue ID, original `dateReported`, and current status.

Deletion uses a React-controlled accessible confirmation dialog and calls `IssueService.deleteIssue()`. Successful deletion updates the current derived list without a reload, preserving search, filters, and sort state.

## Compatibility Limits

- Existing `Issue` records do not contain canonical Service IDs or ServiceDefinition versions.
- Stage 5.1 compatibility descriptions are lossy plain text and cannot be reversed safely into structured answers.
- Matching deliberately returns no match when exact Service and legacy Category identity cannot be established.
- Full-fidelity editing of future dynamic answers requires the separately approved canonical ServiceRequest/API/domain migration.
- Attachments, GIS, routing, authentication, notifications, backend persistence, and enterprise integration remain deferred.

## Non-Changes

Stage 6 does not change the `Issue` schema, `cityvueIssues`, IssueService persistence semantics, Firebase Hosting, or the Stage 5.1 create workflow.
