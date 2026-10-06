# F060.3A — Trusted request tenancy foundation (ADR-025 Slice 1b-A)

Status: **architecture/security review PASSED.** Approved for one
source-control checkpoint on `claude/request-tenant-resolution`, parent
`0c879ee7535ddbe64050c41d800801478f5bff01`. Not merged to `main`, not
deployed. **The registry strategy remains unservable**: `bootstrap.ts` is
untouched and still refuses it. No migration was created or authorized.
F060.3B and F060.3C are not started.

## Authorization and baseline

Implemented under the F060.3A authorization following the approved assessment.
Fresh branch `claude/request-tenant-resolution` from `origin/main` at
`0c879ee7535ddbe64050c41d800801478f5bff01`, clean index and working tree.
Forty-six migrations exist and none was added. No dependency changes —
`node:net` and `node:crypto` are built in.

## What this slice adds

Request-tenancy plumbing only, and the scope is worth stating precisely
rather than as "no runtime change":

- The middleware, context construction and tenant-resolution log event
  **do execute in the current application runtime**, on every route, and add
  one sanitized log record per request.
- **No existing service, controller or guard consumes `TenantContext`** or the
  attached resolution state.
- **No application business operation changes its Organization authority
  source.** Anonymous surfaces still read the configured development
  Organization; staff and admin surfaces still derive it from verified
  identity.
- **No production registry-serving path exists.**
- `TENANT_RESOLUTION_STRATEGY=registry` still fails closed at bootstrap, so
  the registry branch of the middleware is unreachable in a normally booted
  application and is exercised by tests only.

## TenantContext model

A discriminated union on `source`, so the development strategy never needs
fabricated domain metadata:

```ts
type TenantContext =
  | { source: 'development'; organizationId; correlationId }
  | { source: 'registry'; organizationId; hostname; domainId; role; correlationId };
```

`source` is load-bearing. A consumer needing registry provenance must narrow
on it rather than read an optional field that happens to be populated — a
development context is therefore structurally distinguishable from a verified
registry one, not merely different by convention.

Resolution outcome is modelled separately so the middleware can record "we
looked and found nothing" without inventing a context:

```ts
type TenantResolutionState =
  | { status: 'resolved'; context: TenantContext }
  | { status: 'not_found' }
  | { status: 'unavailable' };
```

`not_found` deliberately carries **no reason**. Unknown, malformed, missing,
inactive, unverified, ambiguous and untrusted-peer cases collapse into one
outcome, so resolution cannot become a tenant-enumeration oracle.
`unavailable` is separate only because infrastructure failure is independent
of whether a hostname belongs to a customer. Successful states and their
contexts are frozen.

State is attached to the request via an exported `RequestWithTenant`
interface, matching the existing inline augmentation convention used for
`staffAccess` rather than a global declaration.

## Trusted host-source policy

```
TENANT_HOST_SOURCE=direct|forwarded          # default: direct
TENANT_TRUSTED_PROXY_CIDRS=<comma list>      # required iff forwarded
```

**Direct (default).** Reads only the literal `Host`. `X-Forwarded-Host` is
ignored entirely — not merely deprioritised. A missing or malformed `Host`
fails closed. This matches current behavior exactly.

**Forwarded.** The forwarded host is read **only** when the immediate socket
peer is inside the configured allowlist. If the peer is untrusted, the
forwarded host is missing, or it is repeated or comma-joined, the result is
`not_found` and **the literal `Host` is never used as a fallback**. A request
that bypassed the trusted edge must not be able to select a tenant, which is
the entire purpose of the boundary. This is deliberately stricter than the
fallback-to-`Host` behavior the assessment originally proposed.

Both modes delegate canonicalization to the existing `normalizeHostname`, so
there is exactly one hostname grammar: uppercase, ports, trailing dots and
IDN are canonicalized, while wildcards, underscores, IP literals, control
characters and comma-joined values are rejected before any lookup.

**No hop-count mode exists, and Express `trust proxy` is not enabled.**
Express's numeric form counts entries in a client-controllable header, so an
attacker able to prepend hops shifts which entry is read; the peer address is
the only value the far side cannot forge. `trust proxy` is also avoided
because it rewrites `req.ip` and `req.protocol`, which would silently change
throttling as a side effect of a tenancy setting.

### Peer matching

`req.socket.remoteAddress` only, matched with `node:net`'s `BlockList`. IPv4,
IPv6, bare addresses and CIDR ranges are supported. An IPv6 zone index is
stripped and the IPv4-mapped IPv6 form Node reports on dual-stack sockets
(`::ffff:10.0.0.1`) is unwrapped, so it matches an IPv4 range as an operator
would expect. An unparseable peer is never trusted, and an empty allowlist
trusts nobody.

Configuration is validated at startup: `forwarded` without an allowlist, an
unparseable allowlist, and an allowlist supplied without `forwarded` are all
refused. The last case matters because configuration that looks like it
grants trust but cannot is a trap.

## Middleware lifecycle

`TenantResolutionMiddleware` is applied to `*` in `AppModule`, after
`RequestLoggingMiddleware` so it can reuse the server-owned correlation id
that middleware assigns.

**It never terminates a request.** It attaches state and calls `next()` on
every path, including infrastructure failure. Terminating here would impose
resident tenancy on staff and admin routes, which is exactly the boundary
ADR-025 forbids crossing. Any thrown error is caught and recorded as
`unavailable` — never as a default tenant.

Under the **development strategy** it attaches a development context from the
explicitly configured `DEVELOPMENT_ORGANIZATION_ID` and performs **no**
registry lookup and no hostname inspection. This is not a fallback: it is
valid only inside the already-gated development strategy, which environment
validation confines to a development `NODE_ENV` and profile with an explicit
Organization. Every existing production and client-profile restriction is
preserved.

Under the **registry strategy** it performs trusted host selection → canonical
normalization → the existing `TenantResolverService`. It never returns the
development Organization on any branch.

The injection graph stays singleton. State travels on the request object and
will be passed explicitly to services in a later slice, rather than making
the application request-scoped.

## Route authority separation

| Route class | Organization authority |
| ----------- | ---------------------- |
| Anonymous / resident | Trusted hostname registry (later slice) |
| Staff / admin | Verified Entra identity → `staff_identity` → `staffAccess.organizationId` |

Staff and admin routes are **entirely unchanged**. `staff-access.guard.ts` was
not modified, no hostname/staff consistency enforcement was added, and
hostname tenancy cannot grant, override, narrow or replace staff authority.
The accessor is named `ResidentTenant` precisely so the two authorities are
distinct primitives that cannot be confused at a call site.

## Accessor behavior

`@ResidentTenant()` (with a directly testable `residentTenantFromRequest`)
converts state to a context or refuses:

| State | Result |
| ----- | ------ |
| `resolved` | the `TenantContext` |
| `not_found`, or middleware never ran | generic `404 Not Found` |
| `unavailable` | generic `503 Service Unavailable` |

Errors carry no internal reason, hostname or Organization identifier. Absence
of state is treated as `not_found` rather than as permission to proceed.

**No controller consumes it in this slice.**

## Fail-closed outcomes

| Condition | Outcome |
| --------- | ------- |
| Unknown hostname | `not_found` |
| Malformed hostname | `not_found`, resolver never called |
| Missing `Host` | `not_found` |
| Comma-joined or repeated host | `not_found`, resolver never called |
| Inactive binding | `not_found` |
| Unverified binding | `not_found` |
| Inactive Organization | `not_found` |
| Ambiguous resolver result | `not_found` |
| Forwarded host from untrusted peer | `not_found`, no `Host` fallback |
| Resolver or database failure | `unavailable` |

## No cache

Tenant resolution is **not cached**. The lookup is a single indexed equality
query against a table that, under deployment-per-tenant, holds a handful of
rows. ADR-025 requires that failures are never cached and that deactivation
takes effect promptly; a cache must also be invalidated across processes on
revoke or deactivate. An incorrect cache is a cross-tenant breach, and there
is no evidence one is needed. Add it only against measurement, as its own
reviewed change.

## Logging

One sanitized event per request through the existing logging facilities:
`component`, `requestId` (the server-owned correlation id), `durationMs`,
`tenantResolution` outcome, and on success `tenantSource` plus — for registry
resolutions — `tenantHostname` and `tenantRole`.

The log sanitizer is a strict allowlist, so these fields were registered in
`log-sanitization.ts`. The hostname field accepts **only** strings matching
the normalizer's canonical grammar, so a raw `Host`, a forwarded chain or any
attacker-supplied text cannot reach the log through it. Raw headers, forwarded
chains, tokens, credentials, staff identity data and Organization identifiers
are never logged.

## Registry strategy remains unservable

`bootstrap.ts` is untouched and `assertServableTenantStrategy` still throws on
`registry`. A normally booted application therefore never reaches the registry
branch of this middleware; it is exercised by tests only. **This slice creates
no production-serving path.**

## Validation record

Every invocation that occurred is recorded. A clean rerun is supplemental
evidence, never a correction of a failed invocation.

| Suite | Result |
| ----- | ------ |
| Focused F060.3A units | **37/37 passed** |
| All tenancy units | **100/100 passed** |
| Backend units, parallel — invocation 1 | 584/586, **2 failed** |
| Backend units, parallel — invocation 2 | 584/586, **2 failed** |
| Backend units, parallel — invocation 3 | 585/586, **1 failed** |
| Backend units, **serial** (`--test-concurrency=1`) | **586/586 passed** |
| The two affected files in isolation | **9/9 passed** |
| API E2E — invocation 1 | 48 passed / **3 failed** |
| API E2E — invocation 2 | **68/68 passed** |
| Backend typecheck | passed |
| Test compilation | passed |
| Backend build | passed |
| Lint | passed |
| Shared tests | **64/64** |
| `git diff --check` | passed |
| Formatting, changed files | passed |

**The parallel backend failures are not rewritten as passes.** Both affected
tests — `development-startup` and `logging-sanitization` — `spawnSync` child
processes that boot the application under fixed 60-second and 10-second
budgets, and both failed by timeout.

Evidence that this is runner contention rather than a functional regression:
both pass in isolation, including the case that **boots the full Nest
application with `TenancyModule` wired in**; the serial full run is 586/586;
and the two test files this slice adds cost only 0.4 s and 1.0 s, so they
enlarge the parallel pool rather than add slow work. No timeout was raised and
no test was disabled or weakened.

This is the same class of problem already tracked as **TEST-MAINT** for the
disposable database suite, now observable in the unit suite. Whether
TEST-MAINT should extend to unit-test execution is recorded here as a
question for test-infrastructure work, not addressed by this slice.

The API E2E failures share the cause recorded in F060.1 and F060.2: an
inherited `CITYVUE_ENABLE_EXTERNAL_IDENTITY` in the executing shell without
the complete Entra configuration the suites expect. The suites clear `ENTRA_*`
but not that variable. Invocation 2 removed only that unrelated variable; no
source, assertion or test changed.

No database integration run was required, because this slice changes no
persistence. Changed files were formatted individually; repo-wide
`npm run format` was deliberately not run.

## Known limitations

1. Nothing consumes the context yet — anonymous services still read the
   configured development Organization. That is F060.3B.
2. CORS remains process-wide, throttling remains IP-keyed, and the React API
   base remains an absolute build-time URL. Those are F060.3C.
3. The registry branch cannot be exercised end to end in a booted application
   until bootstrap activation lands.
4. Hostname/staff consistency is intentionally not enforced.
