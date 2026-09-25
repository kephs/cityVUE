# ADR-019 — Issue availability and governed external handoff

Status: Accepted and implemented in F056.2B; automated and live validation passed. The two-step creation/mandatory-template workflow is superseded by [ADR-021](ADR-021-complete-atomic-issue-creation.md); all other boundaries below remain accepted.

## Decision

Stable Issue availability is explicit at creation and immutable afterward. Internal-only and dual-context Issues use Reqro Intake; external-only Issues may use Reqro Intake or F032 External Redirect. Persisted `internal_intake` continues to mean Reqro-managed collection, not INTERNAL request audience. Existing intake Issues backfill to dual availability without revision churn. Availability is not inferred from an intake template.

Server-owned resident and trusted development-provider PUBLIC entry points use external context. Staff-assisted PUBLIC uses external context after existing staff authorization; authorized INTERNAL uses internal context. Channel never supplies authority. The staff catalog retains PUBLIC/external as its omitted-query compatibility contract; requesting `audience=internal` additionally requires existing internal-creation permission. Creation checks availability and action under the stable Issue lock.

The approved creation flow retains F056 templates and inactive defaults. A new redirect-capable Issue is explicitly created external-only, then an authorized administrator configures its handling before activation. Copied configuration is independent of later template changes; switching handling preserves historical and current question configuration.

Both F032 POST and modern Admin handling writes require Admin read, Issue write and action-management permission, retaining F032 Department/Division and Organization scope. This intentionally tightens the earlier F032 action-only write contract. Existing grants and provisioning bundles do not change. The F032 GET contract remains scoped action-management read; broad Admin projection does not acquire full destination access.

One transaction composes independent core, action, policy and assignment revisions. The shared handling command checks expected revision before no-op comparison. A legitimate change increments action revision and appends both restricted configuration history and bounded metadata audit. Either insert failing rolls everything back. No-op and rejected writes create neither history nor success audit. Current redirect fields clear on return to Reqro Intake; retained history is immutable. Earlier unstored revisions cannot be reconstructed and are not fabricated.

Continue is a button that reloads current server configuration by Issue identity. A changed revision or handoff presentation requires another explicit Continue. An inactive, invalid or unavailable Issue cannot navigate. Returning to Reqro Intake clears unsent answers and returns to intake. Successful navigation uses only the freshly resolved destination, in the same tab with no referrer. It creates no request or click telemetry and forwards no requester data or credentials.

## URL boundary and residual limitations

Use standards-based URL normalization and Node's parsed IP/subnet matching. Require HTTPS and reject credentials, malformed authorities, controls, backslashes, localhost/local hostnames and literal local/private addresses, including mapped IPv6 forms. Validate both supplied and normalized length. Valid nonstandard ports and static paths, queries and fragments remain supported. Text is plain text, never executed. Omitted legacy F032 message/label fields retain established defaults; explicitly blank fields are invalid, and the modern editor requires both.

No DNS lookup, server fetch, iframe or external preview is performed. Hostnames can resolve to private addresses; DNS rebinding enforcement and Organization allowlisting remain future production governance requirements. Parser normalization/punycode does not eliminate homograph risks. Arbitrary static query values cannot be reliably classified as secrets; administrators must not configure secrets or tokens in URLs. This is destination validation, not a destination trust guarantee.

## Related records

[F056.2B](../../features/F056-2B-issue-availability-external-handling.md), [F032](../../features/F032-issue-action-external-redirect-foundation.md), [atomic Issue configuration](ADR-017-atomic-issue-configuration.md), [protected Dynamic Question answers](ADR-018-dynamic-questions-protected-answers.md).
