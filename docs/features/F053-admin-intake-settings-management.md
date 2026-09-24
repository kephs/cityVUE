# F053 — Admin Intake Settings Management

Status: implemented and validated; see the [implementation report](F053-implementation-report.md). Started from clean synchronized `main` at `c67c38d0823c4b1e781653c9069b487c7b6abecb`. Verified personal development baseline: 29 migrations / zero pending; collection enabled, revision 1; three active Areas at revision 1; one Admin read grant and one analytics grant; no intake-write grant; tracking 1 active / 5 revoked. No push, deployment or F054.

## Narrow write contract

`PATCH /api/v1/admin/intake-settings/service-participation` accepts only `{enabled: boolean, expectedRevision: integer}`. Entra authentication and trusted active Organization are mandatory. Route admission requires `admin.configuration.read`; the service requires both it and `admin.intake_settings.write`. This follows existing route-plus-resource authorization without changing guard semantics. Neither permission implies the other or any operational/analytics capability. The write permission has zero default grants and no broad-bundle membership.

Within one transaction: lock the existing Organization collection resource; compare expected revision; return a safe no-op for the same value; when enabling, lock one active own-Organization Area; update through the shared collection helper and existing revision trigger; insert required immutable safe audit; commit. Stale revision is 409 even if the submitted value now matches. No-op is 200 with unchanged revision and no change audit. Audit failure rolls back everything. Expected revisions use positive PostgreSQL integer bounds; exhausted revisions fail safely. No global configuration revision.

Audit persistence is resource-specific, following F048/F049 append-only tables: action, trusted Organization/internal staff actor, safe old/new boolean, old/new revision, sanitized correlation UUID and timestamp. No requester data, provider identity, arbitrary JSON, full configuration or secrets. No GET audit, no audit editing/deletion API. Required legitimate UAT audits remain permanently in development.

Enabling requires at least one active own-Organization Area. Disabling an invalid enabled/no-area state remains possible. The development CLI retains explicit target/profile controls and shares setting validation/revision semantics; it remains a separate provisioning path rather than an authenticated Admin actor. Area/Issue/privacy/permission writes are excluded.

## UI and intake

Only Intake Settings gains editing, guided by an authoritative capability boolean. Current value stays distinct from the pending choice. Save requires a change; Cancel resets without writing. Disable requires a native accessible confirmation dialog. Success uses the backend revision; 403 removes editability, 409 requires explicit Refresh and never retries automatically. Refresh clearly discards edits. No local/session storage persistence. Other Admin views refresh their authoritative snapshot after save. Preview remains separate.

Disabling stops new participation collection, not historical retention. Existing F051 submission validation remains authoritative for stale resident/API/assisted drafts. It does not delete Areas, requester geography, analytics, or grants; it does not change suppression. No new request or tracking operation is authorized for live UAT.

## Required validation and live sequence

Automated gates: strict DTO, both permissions, Organization isolation, no-op/stale/concurrent writes, revision independence, migration preservation, immutable audit and audit-failure rollback, active-area validation, intake and analytics regression, UI dialog/conflict/privacy and full protocol suites. Live gates: developer API outside sandbox, user-confirmed pre-grant PATCH 403, narrow F036 grant, independent stale-editor snapshots (two tabs or controlled harness) during Enabled → Disabled → Enabled, fresh resident intake and authorized analytics checks without creating requests, five viewports/both themes/keyboard, user-confirmed logs, final integrity and temporary-file cleanup. Only then local commit.

Production administrator governance/provisioning, retention/change management, security review, support/recovery and broader configuration ownership remain prerequisites. This is a development Admin write foundation, not complete production administration.
