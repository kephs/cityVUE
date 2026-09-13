# SEC-001 — Deferred Multer dependency remediation

**Reviewed:** 2026-09-13. **Status:** Open tracked follow-up; remediation deferred under the prerequisite task's explicit authorization. This is a repository risk assessment, not City production risk acceptance. No package versions changed.

## Audit inventory

The root `npm audit --package-lock-only --json` reports zero vulnerabilities. The server audit reports five high package findings, all propagated from one installed Multer dependency with four advisories. These are not five independent exploits. Multer 2.2.0 was already present before F018/F020 at `241a65c`.

| Package | Installed | Audit affected range | Severity | Relationship and relevance | Reachability and decision |
| --- | --- | --- | --- | --- | --- |
| `multer` | 2.2.0 | `<=2.2.0` aggregate; advisory ranges below | High | Transitive production dependency through Nest's Express adapter; server runtime package, not React | No application multipart parser is registered. Defer; future uploads would expose the vulnerable path. |
| `@nestjs/platform-express` | 11.2.3 | `*` | High | Direct production HTTP adapter, pins Multer 2.2.0 | Adapter is used; its optional Multer interceptors are not. Defer inherited finding. |
| `@nestjs/core` | 11.2.3 | `>=7.6.0-next.1` | High | Direct production server framework; audit propagates adapter dependency | Core is used, but does not itself make multipart parsing reachable. Defer inherited finding. |
| `@nestjs/swagger` | 11.4.7 | `>=5.0.9` | High | Direct production API documentation dependency via core | Documentation is used; no multipart ingestion through this package. Defer inherited finding. |
| `@nestjs/testing` | 11.2.3 | `>=7.6.0-next.1` | High | Direct development/test dependency through core and adapter | Test tooling only; runtime core/adapter remain separately assessed above. Defer inherited finding. |

The broad Nest ranges are npm dependency-chain calculations, not separate Nest CVEs. All five findings originate in the following upstream advisories:

| Advisory / CVE | Impact | Affected Multer | Fixed Multer |
| --- | --- | --- | --- |
| [GHSA-wc9g-mqfw-jrwm / CVE-2026-77078](https://github.com/advisories/GHSA-wc9g-mqfw-jrwm) | High: crafted multipart field names can crash the process | `<2.3.0` | 2.3.0 |
| [GHSA-qfvm-cv95-jqjf / CVE-2026-77037](https://github.com/advisories/GHSA-qfvm-cv95-jqjf) | High: aborted uploads leak file descriptors | `=2.2.0` | 2.3.0 |
| [GHSA-qvfw-j98x-7q72 / CVE-2026-77063](https://github.com/advisories/GHSA-qvfw-j98x-7q72) | Low: asynchronous file filtering can bypass size limits | `<2.3.0` | 2.3.0 |
| [GHSA-535w-7cp7-47q4 / CVE-2026-82333](https://github.com/advisories/GHSA-535w-7cp7-47q4) | High: oversized array index field names cause denial of service | `<2.3.0` | 2.3.0 |

## Reachability evidence and limits

Source review of `server/src` found no Multer imports, upload interceptors, Multer module registration, or custom multipart parsing middleware. The only multipart string is an allowed content-type label in sanitized logging; it does not parse bodies. The installed Express adapter registers JSON and URL-encoded parsers by default. Its separate `FileInterceptor` constructs Multer and invokes it only when that interceptor is configured. F020 has no upload or prompt-ingestion endpoint. No exploit was sent to a live application.

This supports a currently unreachable vulnerable parsing path in the reviewed application, not a claim that the installed dependency is safe. It is present in the server production dependency tree. Any future multipart route, interceptor, middleware, or upload feature invalidates this assessment; Entra alone would not mitigate an authenticated upload attack.

## Remediation decision

Multer 2.3.0 is a same-major upstream fix. However, registry metadata for installed `@nestjs/platform-express@11.2.3` pins exactly `multer: 2.2.0`; the current latest adapter, 12.0.1, also pins 2.2.0. No supported patched adapter version was identified. The non-mutating `npm --prefix server audit fix --dry-run --ignore-scripts --json` still reports all five high findings. Plain `npm audit fix` cannot currently resolve them through the supported dependency graph.

Audit suggests cross-major downgrades: core/testing 7.5.5 and Swagger 5.0.8. Those are not recommended patched versions for CityVUE. Applying the suggested outside-range changes would require force and break the current Nest 11 dependency contract; `npm audit fix --force` was not run. A deliberate Multer override would not require force or a major Multer upgrade, but would bypass Nest's exact dependency pin and needs compatibility validation. It is deferred here because no currently reachable production upload path justifies that override risk. Upgrading Nest to 12 would add breaking-change risk without fixing its Multer pin.

Recommended action for all five findings: adopt a supported compatible Nest release that consumes Multer >=2.3.0 when available, or separately review a narrowly scoped Multer override with multipart compatibility/aborted-upload/limit tests and full regressions. Do not downgrade the framework merely to clear the count.

## Follow-up gates

- Reassess this open item at the next dependency review and before any production API activation or multipart/upload implementation.
- Confirm an upstream compatible adapter fix, or validate a scoped override in a separate dependency change; rerun root/server audits and all regression suites.
- Preserve the current absence of multipart ingestion until the risk is reassessed; do not infer upload approval from this deferral.
- City operational risk owner and production exception approval remain unassigned/pending. No production readiness or deployment approval is established here.

Evidence commands: root/server `npm audit --package-lock-only --json`; `npm --prefix server ls multer @nestjs/core @nestjs/platform-express @nestjs/swagger @nestjs/testing --all`; `npm view multer version --json`; `npm view @nestjs/platform-express@11.2.3 dependencies --json`; `npm view @nestjs/platform-express version dependencies --json`; audit-fix dry run above; source and installed-adapter inspection. Audit data is time-specific and must be refreshed when revisiting this item.
