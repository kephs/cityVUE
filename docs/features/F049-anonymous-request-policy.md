# F049 — Anonymous Request Policy

Status: implemented and locally validated from synchronized `58453d18ef2e4e4c8e2b0419cac983fd224d6a13`. The user explicitly approved the two-policy design after the required redundancy review. See [ADR-011](../architecture/decisions/ADR-011-explicit-requester-identity.md) and the [completion evidence](F049-implementation-report.md). No push, deployment or F050 work is authorized.

## Approved policy

`IDENTIFIED_REQUIRED`: identified requester with existing Contact name requirement; email remains optional. `ANONYMOUS_ALLOWED`: explicit choice of identified or anonymous; identified uses the same Contact requirement and anonymous forbids all Contact. No IDENTIFIED_OPTIONAL policy.

Reuse immutable request-level `reporting_identity` values `identified` / `anonymous`. They already exist as required enum-constrained columns from the initial request migration; no missing-Contact inference or blanket historical reclassification is needed. INTERNAL retains identified authenticated staff requester/submitter without resident Contact. Assisted anonymous PUBLIC intake retains its authenticated staff submitter separately.

## Implementation design

Organization-scoped stable Issue policy configuration uses a dedicated typed/revisioned row and guarded development CLI, with the same Issue lock and explicit revision pattern as F048. Initial configuration preserves the current published version's behavior: `not_allowed` becomes IDENTIFIED_REQUIRED; `allowed` and the behaviorally equivalent historical `allowed_with_limitations` become ANONYMOUS_ALLOWED. For a newly published Issue without an explicit configuration row, that same current-published-version mapping preserves existing catalog administration behavior; no published version means identification required. A configured policy takes precedence over every submitted intake version. No new production administration API, grant or UI is introduced.

New creation validates policy under the Issue shared lock, after a valid finalized F046 retry has returned its original receipt. Anonymous Contact contradictions are rejected before persistence. Database guards make request identity immutable and reject Contact attached to an anonymous request. Migration must refuse existing contradictory data rather than repair it. Historical requests, contacts, Activity and F048 ownership remain unchanged.

Only the safe two-valued effective policy is projected to intake. Allowed intake begins with no identity selection; switching to anonymous erases the Contact draft, and switching back does not recover it. Review and confirmation are explicit; no new browser storage or correlation identifiers. Staff detail projects identity only after normal request authorization; lists/search/tracking stay unchanged. Anonymous Contact has no View action and no successful contact-read audit. Identified Contact retains F039 authorization/audit.

F042 is a recorded-correspondence foundation, not delivery. Anonymous requests cannot create new correspondence or stage new correspondence attachments. Existing correspondence and finalized attachment reads retain their independent authorization and immutable history. No anonymous portal channel or automatic tracking issuance is added.

## Boundaries and evidence

Application-level anonymity means no structured requester Contact is collected or linked. It does not promise infrastructure-level untraceability or remove incidental identifying content from free text/images. Service Location remains the issue location, never requester residence. No IP/device fingerprinting, tracking-based identity, requester history/profile, Requester Geography, content matching or hidden correlation is introduced. F047 searchable fields and F048 ownership remain independent.

Required evidence: disposable migration apply/down/reapply, policy/configuration concurrency, immutable identity and Contact contradictions, retry after policy changes, protected Contact contrast, assisted/INTERNAL attribution, F042/F044/F045/F046/F047/F048 regressions, full automated suites, responsive light/dark/keyboard UAT, at most one retained anonymous request, safe database readback and developer-observed logging privacy. Preserve tracking 1 active / 5 revoked, retained F048 request and configuration, all pre-existing data and grants. Completion and local commit remain gated by those checks.

## Development configuration

Run from `server` using the existing ignored personal-development `.env` and `.env.f036` inputs; never copy their contents into documentation. The existing F036 safeguards require an explicitly selected fictional Organization, mapped personal staff identity and current hierarchy scope. The CLI verifies the actual local database/role/profile. No configuration route or automatic grant is added.

```powershell
$env:F049_ACTION = 'inspect'
$env:F049_ISSUE_ID = '<existing-fictional-Issue-UUID>'
node --env-file=.env --env-file=.env.f036 dist/database/development-staff-cli.js issue-identity --dry-run

$env:F049_ACTION = 'set'
$env:F049_POLICY = 'ANONYMOUS_ALLOWED' # or IDENTIFIED_REQUIRED
$env:F049_EXPECTED_REVISION = '<revision-from-inspect>'
node --env-file=.env --env-file=.env.f036 dist/database/development-staff-cli.js issue-identity --dry-run
# Only for a deliberately reviewed configuration change:
node --env-file=.env --env-file=.env.f036 dist/database/development-staff-cli.js issue-identity --confirm
```

Build the server before using `dist`; the equivalent package command is `dev:issue:identity-policy`. A no-op existing policy keeps its revision and creates no audit. First explicit configuration of an unconfigured Issue materializes a revisioned row even when its effective fallback already matches. Policy audit failure rolls back the whole configuration change. Production configuration administration remains deferred.

## Query impact

No new list query or filter is introduced. Single-Issue catalog reads and creation resolve policy with bounded Organization/Issue-keyed lookups, using primary keys and the current-published-version relationship. Creation adds one bounded policy query after its existing Issue lock; finalized retries bypass it. No per-list-row lookup, unbounded history load, content index or speculative search index is added. Larger-volume performance was not benchmarked for F049.

## F056 integration (2026-09-24)

The approved [F056 Issue editor](F056-admin-issue-configuration-management.md) composes stable core/catalog, action, requester-policy and default-assignment resources in one atomic transaction with independent expected revisions. It preserves this feature’s historical contract, permissions and domain audits. F048/F049 internal helpers explicitly permit inactive configuration only for the authorized coordinator; existing CLI defaults remain unchanged. See [ADR-017](../architecture/decisions/ADR-017-atomic-issue-configuration.md) and the [validation record](F056-implementation-report.md).
