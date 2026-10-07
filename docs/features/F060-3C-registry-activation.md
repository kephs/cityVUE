# F060.3C-1 — Code-complete registry activation (ADR-025)

Status: **implemented locally, stopped for final security review.** Not
staged, not committed, not pushed, not deployed.

> **Registry tenancy is code-complete and testable after this slice, but
> production deployment remains unauthorized and blocked by operational
> prerequisites.** Making registry mode bootable is not authorization to
> deploy it, onboard a production domain, cut over real DNS or TLS, or
> activate platform infrastructure.

## Authorization and baseline

Implemented under the F060.3C-1 authorization. Fresh branch
`claude/registry-activation` from `origin/main` at
`2f4e18312b4e34fbbf6c0adfeb907b54550e9615`, clean index and working tree.
Forty-six migrations exist and **none was added**. No dependency changes.
F060.3C-2 production operational readiness is not started.

## Bootstrap activation

`assertServableTenantStrategy(strategy, readiness?)` replaces the
unconditional refusal. The `development` strategy is untouched and returns
immediately. `registry` boots only when all of the following hold:

| Check | Refusal |
| ----- | ------- |
| Readiness supplied | `registry tenant resolution requires runtime tenancy readiness` |
| Tenancy wired | `...requires the tenancy module to be wired` |
| Valid `TENANT_HOST_SOURCE` | `...requires a valid TENANT_HOST_SOURCE` |
| `forwarded` has parseable CIDRs | `forwarded tenant host source requires trusted proxy CIDRs` |
| `CORS_ORIGINS` non-empty | `...requires CORS_ORIGINS` |

Wiring is proven by resolving `TenantResolutionMiddleware` from the
container: Nest throws when the provider is absent, so a successful resolve
is the evidence. Without it, every resident route would silently 404.

**Deliberately not duplicated** — `environment.ts` already refuses a lingering
`DEVELOPMENT_ORGANIZATION_ID` under registry, an invalid deployment profile,
and an unparseable proxy allowlist, and those run first.

**Deliberately absent: any database probe.** Readiness owns database
availability. Coupling boot to it would turn a transient outage into a failed
start, and registry mode is explicitly allowed to boot with zero bindings.

Development isolation is unchanged: development `NODE_ENV` and profile only,
explicit `DEVELOPMENT_ORGANIZATION_ID`, no registry fallback, no
production/client use. No existing environment guard was weakened.

## Tracking-hostname decision

Recorded in ADR-025: **requester tracking credentials remain
hostname-independent.** A valid credential determines its Organization from
persisted credential state, not from resident hostname tenancy.

No cross-tenant disclosure results, because credential resolution is
Organization-bound in storage. Hostname agreement would add little security —
the caller already holds the credential — while breaking bookmarked and
emailed links during domain migration and on platform fallback addresses. **No
configurable toggle** is introduced. The requester-tracking implementation is
unchanged; no doc or test mismatch was found.

## Trusted proxy

The F060.3A implementation is unchanged: `direct` reads only the literal
`Host`; `forwarded` requires a trusted immediate peer and a valid
`X-Forwarded-Host`, never falls back to `Host`, and has no hop-count trust.
Express `trust proxy` stays disabled.

Three production assumptions the application cannot verify are now recorded
in ADR-025: the edge must **overwrite, not append** `X-Forwarded-Host`; no
route may reach the app directly from inside a trusted CIDR except through
the approved edge; and the CIDR list must track the edge's real egress range
under infrastructure change control.

## CORS

Registry startup requires `CORS_ORIGINS` to be non-empty — a resident surface
with an empty allowlist would serve a tenant no browser could call. Startup
does **not** query tenant-domain bindings, does not require each origin to
match a verified row, and introduces no tenant-aware or shared-SaaS CORS.
Application boot stays independent of registry contents.

## Throttling

Unchanged. IP-based throttling is accepted for deployment-per-tenant, where
the process boundary is the tenant boundary. **Shared-process,
multi-Organization hosting would require tenant-dimensional rate limiting
before approval** — otherwise a single IP consumes one global budget across
tenants, a cross-tenant availability risk. `TenantContext` was not added to
throttle keys.

## Frontend same-origin API base

`readResidentIntakeConfig` now defaults `apiBaseUrl` to `/api/v1`. In API
mode, an absent variable yields the same-origin default; an explicit override
is still validated as an absolute `http:`/`https:` URL under the existing
rules. Environments that already set the absolute variable keep working, and
local development on 5173 → 3000 is preserved through that override.

The change is confined to the shared runtime-config function: all twelve
frontend consumers read `apiBaseUrl` from it, so none needed individual
modification.

## Zero active bindings

Registry mode boots with **zero active tenant-domain bindings**. No domain is
seeded and none is required at startup. With zero bindings every resident
tenant-dependent request returns a generic 404, health and readiness stay
reachable, and the process is healthy if its infrastructure is. Requiring a
binding would invert onboarding — a deployment must exist before DNS
verification can succeed.

## Health and readiness

Health routes consume no tenant context and are reachable on any hostname,
including an unresolvable one. Readiness was **not** made tenant-dependent;
an empty registry must not report the process unhealthy.

## Logging reason field

The server-side tenant-resolution event gains `tenantReason`, drawn from a
closed allowlist registered in the log sanitizer: `resolved`, `unknown_host`,
`malformed_host`, `untrusted_forwarded_peer`, `registry_unavailable`.

This lets an operator separate "a customer's DNS is wrong" from "our proxy
allowlist is wrong" at 2am. The **HTTP response remains a generic 404 or
503** and is unchanged. No raw `Host`, no raw `X-Forwarded-Host`, no
forwarded chain, no Organization id, no credential, token or staff identity
is logged, and the existing canonical-hostname rule is preserved — the
hostname field still accepts only the normalizer's output grammar.

## Activated-runtime isolation evidence

`server/test/e2e/registry-tenancy.e2e.test.ts` boots the real application
under `TENANT_RESOLUTION_STRATEGY=registry` against the disposable database,
with two synthetic Organizations and two verified, active bindings driven
through the genuine audited lifecycle, and exercises it over real HTTP.

**12/12 passed**, proving:

| Proof | Result |
| ----- | ------ |
| Host A → A alerts; Host B → B alerts, neither leaking the other | pass |
| Host A → A catalog; B's category id yields nothing under A; B's published issue 404s under A | pass |
| Resident Experience read is hostname scoped | pass |
| Request created under the hostname Organization | pass |
| Forged `organizationId` / `organization_id` / `tenant` body fields cannot redirect authority, and B holds zero requests | pass |
| Resident attachment batch belongs to the hostname Organization; B's issue is not addressable from A | pass |
| Unknown hostname → generic 404 exposing no Organization id | pass |
| `X-Forwarded-Host` ignored in direct mode; comma-joined and wildcard hosts → 404 | pass |
| Deactivating a binding immediately stops resolution; A unaffected | pass |
| Health reachable on any hostname | pass |
| Staff routes stay identity-authoritative and are not opened by any verified hostname | pass |

The lower-level F060.3B and F060.3B-A suites remain required and are not
substituted by this; they prove service and repository isolation, while this
proves the booted pipeline routes a real `Host` to the right Organization.

**Not covered:** published Resident Experience branding differentiation. Both
Organizations return a null configuration because publication requires the
full review workflow, which this fixture does not seed. Per-Organization
*branding content* therefore rests on the existing Resident Experience
integration coverage, not on this suite.

**Not covered:** a live resolver/database failure producing a 503. Inducing
one against a booted application without weakening a control was not
practical here; the 503 path is proven at the middleware and accessor level
in the F060.3A unit suites.

## Validation record

| Suite | Result |
| ----- | ------ |
| Activated-runtime registry E2E — invocation 1 | **failed** (fixture omitted `verification_token_id`) |
| Activated-runtime registry E2E — final | **12/12 passed** |
| Cross-tenant isolation regression | **8/8 passed** |
| Full serial disposable PostgreSQL | **703/703 passed** |
| Backend units, serial | recorded below |
| React suite — invocation 1 | 889/892, **3 failed** |
| React suite — final | **892/892 passed** |
| Typecheck, test compilation, backend build, lint | passed |

The first registry E2E invocation failed because the fixture omitted
`verification_token_id`, which Migration 46 requires for the
`unverified → pending` transition — a defect in the new test fixture, and
evidence the database control works. No assertion was weakened.

Of the three initial React failures, **one was a real contract change**: the
config test asserted that API mode without `VITE_CITYVUE_API_BASE_URL`
throws, which this slice deliberately changes. It now asserts the same-origin
default and still asserts that a malformed or non-HTTP override is rejected.
The other two passed in isolation and on rerun, and are runner interference
rather than regressions.

Database work used only `reqro_f0592_test` as `reqro_test_user`, serially
with `--test-concurrency=1` because TEST-MAINT remains open. `reqro_dev` was
not accessed.

## Production operator path

The tenant-domain CLI remains **development and local-database only**. There
is **no production operator path** to register, issue a challenge, verify,
activate, deactivate or revoke a hostname.

This is a **production deployment blocker**, not an implementation blocker.
It will be handled under the production operator, bootstrap and recovery
workstream aligned with ADR-027, which carries the same unresolved identity
and approval questions. **Registry activation code may merge before that
blocker is resolved; production deployment may not.**

## Remaining production blockers after F060.3C-1

1. **Production operator path** (above) — the dominant one
2. Actual infrastructure provisioning
3. A real verified production domain
4. Real-zone DNS verification exercise
5. TLS and certificate automation
6. Trusted-edge CIDRs and configuration, under change control
7. CDN and proxy cache-key verification including the hostname
8. Automated DNS re-verification and deactivation — deferred, no scheduler
9. Hostname release and reassignment — deferred
10. `platform_delegation` for platform fallback domains — deferred
11. Tenant-dimensional throttling, if shared-process hosting is ever approved
