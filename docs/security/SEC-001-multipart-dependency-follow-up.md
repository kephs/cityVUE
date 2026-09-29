# SEC-001 — Multer multipart dependency follow-up

**Original assessment:** 2026-09-13. **Reassessed:** 2026-09-29 at baseline `f235f8b02b34e231261807113fa0d29d8bdca14a`.

**Status:** Open tracked follow-up. Remediation remains deferred and **not performed**; no package version, lockfile entry or override changed in the reassessment. This is a repository risk assessment, not City production risk acceptance.

**Current headline:** all five Multer advisories now recorded against the installed tree are assessed **NOT REACHABLE through Reqro's currently configured multipart upload paths, under the inspected and tested configuration** — which is *not* a claim that the affected Multer code can never be reached (see [Precision of the reachability conclusion](#precision-of-the-reachability-conclusion)). A **supported same-major patched adapter now exists** (`@nestjs/platform-express@11.2.6` pins `multer@2.4.0`), which invalidates the original remediation conclusion. Reachability is a property of the current interceptor configuration, not of the dependency, and one configuration change would re-expose a remote unauthenticated process crash. See [Residual risks](#7-residual-risks).

---

## 1. Original assessment (2026-09-13) — retained as historical evidence

The statements in this section are preserved as they were recorded. They are **superseded** by sections 3–7 and must not be cited as current posture.

The root `npm audit --package-lock-only --json` reported zero vulnerabilities. The server audit reported five high package findings, all propagated from one installed Multer dependency with four advisories. These were not five independent exploits. Multer 2.2.0 was already present before F018/F020 at `241a65c`.

| Package | Installed | Audit affected range | Severity | Relationship and relevance | Reachability and decision (as recorded then) |
| --- | --- | --- | --- | --- | --- |
| `multer` | 2.2.0 | `<=2.2.0` aggregate | High | Transitive production dependency through Nest's Express adapter; server runtime package, not React | No application multipart parser is registered. Defer; future uploads would expose the vulnerable path. |
| `@nestjs/platform-express` | 11.2.3 | `*` | High | Direct production HTTP adapter, pins Multer 2.2.0 | Adapter is used; its optional Multer interceptors are not. Defer inherited finding. |
| `@nestjs/core` | 11.2.3 | `>=7.6.0-next.1` | High | Direct production server framework | Core is used, but does not itself make multipart parsing reachable. Defer inherited finding. |
| `@nestjs/swagger` | 11.4.7 | `>=5.0.9` | High | Direct production API documentation dependency via core | Documentation is used; no multipart ingestion through this package. Defer inherited finding. |
| `@nestjs/testing` | 11.2.3 | `>=7.6.0-next.1` | High | Direct development/test dependency | Test tooling only. Defer inherited finding. |

Reachability evidence recorded then: source review of `server/src` found no Multer imports, upload interceptors, Multer module registration, or custom multipart parsing middleware. F020 had no upload or prompt-ingestion endpoint.

The original record also stated its own invalidation trigger:

> Any future multipart route, interceptor, middleware, or upload feature invalidates this assessment; Entra alone would not mitigate an authenticated upload attack.

and its remediation conclusion:

> No supported patched adapter version was identified. … Recommended action for all five findings: adopt a supported compatible Nest release that consumes Multer >=2.3.0 when available, or separately review a narrowly scoped Multer override.

Both statements are addressed below. The second is now **obsolete**: a supported patched adapter exists, and `2.3.0` is no longer a sufficient target.

---

## 2. Invalidation by F046 multipart ingestion

F046 introduced application multipart ingestion, which met SEC-001's own stated invalidation trigger. The premise "no application multipart parser is registered" is **false as of this baseline**.

`server/src/attachments/attachment.controller.ts` registers exactly one parser:

```ts
const upload = FileInterceptor('file', {
  limits: { fileSize: attachmentLimits.fileBytes, files: 1, fields: 0,
            parts: 2, fieldNameSize: 40, headerPairs: 20 },
});
```

It is applied to two routes, one of them anonymous:

| Route | Identity | Interceptor |
| --- | --- | --- |
| `POST /api/v1/intake/attachments/batches/:batchId/files/:fileId` | Anonymous resident (capability token) | `upload` |
| `POST /api/v1/staff/attachments/batches/:batchId/files/:fileId` | Entra workforce identity | `upload` |

A repository-wide search found no other `FileInterceptor`, `FilesInterceptor`, `AnyFilesInterceptor`, `MulterModule` registration, or custom multipart middleware. `MulterModule` is **not** registered anywhere, so Nest injects `{}` for `MULTER_MODULE_OPTIONS` and the literal above is the complete parser configuration.

---

## 3. Current reassessment

### 3.1 Dependency and version facts

Taken from `server/package-lock.json` and the installed tree; **no dependency was changed**.

| Package | Declared | Installed | Note |
| --- | --- | --- | --- |
| `multer` | (transitive) | **2.2.0** | Exactly pinned by the adapter |
| `@nestjs/platform-express` | `^11.2.3` | 11.2.3 | `dependencies.multer === "2.2.0"` |
| `busboy` | (transitive) | 1.6.0 | Multipart tokenizer |
| `streamsearch` | (transitive) | 1.1.0 | Boundary scanner |
| `append-field` | (transitive) | 1.0.0 | **The vulnerable function for two advisories** |
| `concat-stream` | (transitive) | 2.0.0 | Used only by memory storage |
| `@nestjs/core` / `@nestjs/common` / `@nestjs/testing` | `^11.2.3` | 11.2.3 | |
| `@nestjs/swagger` | `^11.4.7` | 11.4.7 | |

The root project lockfile contains **no** `multer` entry; multipart ingestion is server-only and React is not involved.

### 3.2 Audit inventory has changed since the original assessment

`npm --prefix server audit --package-lock-only` now reports **4 package findings (2 high, 2 moderate)** rather than five high, and the Multer advisory count is **five, not four**:

| Advisory | Severity | Affected Multer | Fixed |
| --- | --- | --- | --- |
| [GHSA-wc9g-mqfw-jrwm](https://github.com/advisories/GHSA-wc9g-mqfw-jrwm) / CVE-2026-77078 | High 7.5 | `<2.3.0` | 2.3.0 |
| [GHSA-qfvm-cv95-jqjf](https://github.com/advisories/GHSA-qfvm-cv95-jqjf) / CVE-2026-77037 | High 7.5 | `=2.2.0` | 2.3.0 |
| [GHSA-535w-7cp7-47q4](https://github.com/advisories/GHSA-535w-7cp7-47q4) / CVE-2026-82333 | High 7.5 | `<2.3.0` | 2.3.0 |
| [GHSA-qvfw-j98x-7q72](https://github.com/advisories/GHSA-qvfw-j98x-7q72) / CVE-2026-77063 | Low 3.7 | `<2.3.0` | 2.3.0 |
| [GHSA-3pph-fpjx-jg34](https://github.com/advisories/GHSA-3pph-fpjx-jg34) / CVE-2026-88932 | **Moderate 5.3** | **`>=2.2.0 <2.4.0`** | **2.4.0** |

Three changes matter:

1. **A fifth Multer advisory (CVE-2026-88932) did not exist when SEC-001 was written.** Its range covers 2.3.0, so **Multer 2.3.0 is no longer a complete fix**. The correct target is **>= 2.4.0**.
2. `@nestjs/core` and `@nestjs/testing` no longer appear as Multer-propagated findings. The remaining propagated finding is `@nestjs/platform-express` (affected `<=11.2.5`).
3. `@nestjs/swagger` now appears for an **unrelated** reason — moderate [GHSA-r3ph-w7gj-g6xm](https://github.com/advisories/GHSA-r3ph-w7gj-g6xm) in `js-yaml@5.3.0`. This is **out of SEC-001's multipart scope** and is recorded in [Follow-up gates](#follow-up-gates) for the dependency-review workstream, not reassessed here. The root project audit also now reports 1 moderate finding where it previously reported zero.

### 3.3 Request pipeline order (the decisive control)

Verified by source and by executing the real HTTP stack. Multer runs as a Nest **interceptor**, so it parses the body only after every guard has admitted the request:

```text
RequestLoggingMiddleware, AttachmentPrivacyMiddleware   (middleware)
  -> ThrottlerGuard                                     (global APP_GUARD)
  -> AttachmentOriginGuard  [+ StaffAccessGuard]        (controller guards)
  -> AttachmentUploadGuard                              (route guard)
       acquire()  -> assertEnabled() + in-flight cap
       admit()    -> batch/token authorization in PostgreSQL
  -> FileInterceptor -> Multer -> busboy                (interceptor: FIRST BYTE PARSED HERE)
  -> handler AttachmentService.upload()
```

An unauthorized, wrong-origin, throttled or disabled request therefore **never reaches the multipart parser at all**. This was confirmed empirically, not merely by reading Nest's documented order (see section 8).

### 3.4 Parser configuration facts

Read from the **actual** interceptor attached to the production route (via Nest route metadata), not from a copy:

- **Storage engine: `MemoryStorage`.** No `storage` and no `dest` option is supplied, so `multer/index.js` falls through to `memoryStorage()`. `DiskStorage` is never constructed, so no destination write stream and no temporary file ever exists on this path.
- **`fileFilter`: Multer's built-in synchronous `allowAll`**, wrapped by Multer's synchronous `wrappedFileFilter`. No custom or asynchronous filter is supplied.
- **Limits, asserted exactly:** `fileSize: 5242880`, `files: 1`, `fields: 0`, `parts: 2`, `fieldNameSize: 40`, `headerPairs: 20`.

**`fields: 0` is the control that matters most.** In `busboy@1.6.0` (`lib/types/multipart.js`), a non-file part is gated before the field accumulator is created:

```js
if (fields === fieldsLimit) { … this.emit('fieldsLimit'); skipPart = true; return; }
++fields;
…
field = [];            // only reached past the gate
```

and the `field` event is emitted only `else if (field !== undefined)`. With `fieldsLimit === 0` the gate matches on the very first non-file part, `field` stays `undefined`, and busboy **never emits a `field` event**. Multer's `field` handler — the only caller of `appendField` — therefore never runs, and `req.body` remains an empty null-prototype object. This was verified by executing the production interceptor (section 8).

Downstream, Multer's errors are mapped by Nest's `transformException` to `PayloadTooLargeException` (413) / `BadRequestException` (400), and `HttpExceptionFilter` strips the parser message, so responses expose `{statusCode, error, requestId}` only.

---

## 4. Per-advisory current disposition

Each advisory is assessed against the reached code path, not against the version string.

### Precision of the reachability conclusion

**NOT REACHABLE** in this record means exactly one thing:

> The five reassessed SEC-001 advisories are NOT REACHABLE through Reqro's currently configured multipart upload paths, under the inspected and tested configuration.

It does **not** mean the affected Multer code can never be reached, that `multer@2.2.0` is safe, or that the finding is closed. The dependency remains vulnerable in the production tree. Each disposition depends on a named property of the current configuration. Those properties are named below, distinguishing configuration-dependent exclusions — which must be preserved deliberately — from structural ones:

| Qualification | Kind | Advisories it excludes |
| --- | --- | --- |
| **`fields: 0` is a security invariant.** Busboy never emits a `field` event, so Multer's `appendField` call site is never executed. | **Configuration invariant** — must be preserved deliberately | CVE-2026-77078, CVE-2026-82333 |
| **`MemoryStorage` structurally excludes the `diskStorage`-specific advisories.** No `storage`/`dest` option is supplied, so `DiskStorage` is never constructed and no destination write stream or temporary file exists. | **Structural** — re-exposure requires deliberately adopting disk storage | CVE-2026-77037, CVE-2026-88932 |
| **Synchronous/default file filtering excludes the async-`fileFilter` race under current configuration.** Multer's built-in `allowAll` runs in the same tick, so the `'limit'` listener is attached before data flows. | **Configuration-dependent** (with post-parse size re-checks behind it) | CVE-2026-77063 |

**Relaxing the `fields: 0` invariant, supplying an asynchronous `fileFilter`, adopting disk storage, or adding another multipart interceptor without equivalent limits requires reassessment of this record.** See [Residual risks](#7-residual-risks) and [Follow-up gates](#follow-up-gates).

### CVE-2026-77078 / GHSA-wc9g-mqfw-jrwm — crafted multipart field names crash the process (High 7.5)

- **Affected behavior:** two crafted **text field names** produce an uncaught `RangeError: Invalid array length` inside `append-field`. The advisory states it "is not routed to the application error handler and terminates the process".
- **Does Reqro reach the parser/path?** It reaches Multer, but **not** `append-field`. `fields: 0` stops busboy from emitting any `field` event, and `appendField` is called only from that handler.
- **Attacker prerequisites:** a request that survives origin, capability-token and enablement checks, and a configuration that permits at least one text field. The second prerequisite is not met.
- **Existing mitigating controls:** `limits.fields = 0` (eliminates); guard-before-interceptor ordering, batch-token authorization, Origin allowlist, throttling, development-only enablement (reduce exposure of the surrounding route).
- **Effect of controls:** **eliminates** for this route, because the vulnerable function is never invoked.
- **Disposition: NOT REACHABLE through the currently configured upload paths**, under the inspected and tested configuration. **Residual risk: low-but-brittle** — a single configuration change (any text field added to the upload form, or a new interceptor without these limits) restores a remote unauthenticated process-crash. There is no second layer behind `fields: 0`.
- **Confidence: High.** Static: busboy gate + Multer call graph. Dynamic: the production interceptor rejects both advisory shapes with `LIMIT_FIELD_COUNT` and zero appended field keys.

### CVE-2026-82333 / GHSA-535w-7cp7-47q4 — oversized array index in field names (High 7.5)

- **Affected behavior:** `items[4294967294]` allocates a maximum-size sparse array in `append-field`; a later non-numeric key on the same base object (`items[text]`) drives a synchronous full-length conversion, blocking the event loop.
- **Does Reqro reach the parser/path?** No — same `append-field` text-field path as above.
- **Attacker prerequisites:** identical, and the advisory's own mitigation (`limits.fieldArrayIndexLimit`) **does not exist in Multer 2.2.0**; it is a 2.3.0 feature. `fields: 0` is what closes this, not that option.
- **Effect of controls:** **eliminates** for this route.
- **Disposition: NOT REACHABLE through the currently configured upload paths**, under the inspected and tested configuration. Residual risk as above, and shared with CVE-2026-77078 — one configuration change re-exposes both.
- **Confidence: High.** Same static and dynamic evidence.

### CVE-2026-77037 / GHSA-qfvm-cv95-jqjf — file-descriptor leak on aborted uploads (High 7.5)

- **Affected behavior:** `diskStorage` does not close the destination write stream when an upload is aborted before completion; repeated aborts exhaust file descriptors. The advisory scopes it to `diskStorage`; memory storage is not affected.
- **Does Reqro reach the parser/path?** No. The route resolves to `MemoryStorage`, whose `_handleFile` pipes into `concat-stream`. `DiskStorage._handleFile` — which contains both the `if (file.stream.destroyed) return` early exit and the unclosed `fs.createWriteStream` — is never executed because `DiskStorage` is never constructed.
- **Attacker prerequisites:** a disk-backed upload route. None exists.
- **Existing mitigating controls:** structural choice of memory storage (eliminates). Separately, Multer's `handleRequestFailure` calls `abortWithError(err, true)` on `error`/`aborted`/`close`, so an aborted request does not wait on pending writes; and `AttachmentUploadGuard` releases its in-flight slot on both `res` `finish` and `close`.
- **Effect of controls:** **eliminates** the advisory's mechanism.
- **Disposition: NOT REACHABLE through the currently configured upload paths**, under the inspected and tested configuration. Residual risk: **low**, and structural rather than configuration-dependent — re-exposure would require deliberately adopting disk storage.
- **Confidence: High.** The storage engine is determined by the absence of `storage`/`dest` and was asserted directly on the production interceptor.

### CVE-2026-88932 / GHSA-3pph-fpjx-jg34 — orphaned disk writes on aborted uploads (Moderate 5.3) — *new since the original assessment*

- **Affected behavior:** incomplete cleanup in `diskStorage`; files orphaned in the window before a path is assigned accumulate until the upload or system temporary directory is exhausted. `diskStorage` only.
- **Does Reqro reach the parser/path?** No — memory storage, as above.
- **Attacker prerequisites:** a disk-backed route; widened by asynchronous `destination`/`filename` functions. Neither exists.
- **Effect of controls:** **eliminates** the advisory's mechanism.
- **Disposition: NOT REACHABLE through the currently configured upload paths**, under the inspected and tested configuration. **Its importance is to remediation, not to current exposure:** it is fixed only in **2.4.0**, so it invalidates the original "Multer >= 2.3.0" recommendation.
- **Confidence: High.**
- Note: Reqro's own attachment durability handling is independent of this advisory — `AttachmentService.upload` removes a written object on any failure, and `cleanup()` reconciles storage inventory against metadata with a one-hour grace period.

### CVE-2026-77063 / GHSA-qvfw-j98x-7q72 — file-size limit bypass via async `fileFilter` race (Low 3.7)

- **Affected behavior:** the `'limit'` listener is registered inside the `fileFilter` callback, so with an **asynchronous** filter an oversized file can complete transfer before the listener attaches. The advisory states synchronous filters are unaffected.
- **Does Reqro reach the parser/path?** The code is present, but the precondition is absent: no `fileFilter` is supplied, so Multer's synchronous `allowAll` is used, wrapped by the synchronous `wrappedFileFilter`. The callback completes in the same tick, so the `'limit'` listener is attached before any data flows.
- **Attacker prerequisites:** an asynchronous `fileFilter`. Not met.
- **Existing mitigating controls:** synchronous filter (eliminates the race). Independently, `assertAttachmentCount` re-checks the decoded byte length server-side after parsing, and `processImage` re-checks the re-encoded length — so even a hypothetical parser bypass would be caught before persistence. This is the one advisory with genuine defense in depth.
- **Effect of controls:** **eliminates** the race; a residual bypass would still be **reduced** to nothing by the post-parse size assertions.
- **Disposition: NOT REACHABLE through the currently configured upload paths**, under the inspected and tested configuration. Residual risk: **very low**.
- **Confidence: High.** Asserted directly: the production interceptor's `fileFilter` invokes its callback synchronously.

### Inherited package findings

`@nestjs/platform-express@11.2.3` is reported (affected `<=11.2.5`) solely because it pins `multer@2.2.0`. It carries no independent multipart defect, and the dispositions above govern. `@nestjs/core` and `@nestjs/testing` are no longer reported for Multer. `@nestjs/swagger@11.4.7` is now reported for `js-yaml`, which is unrelated to multipart ingestion and out of scope here.

---

## 5. Anonymous intake threat analysis

The resident intake upload route is the highest-value target because it requires no user identity. "Unauthenticated" here means **no user or workforce identity**, not unauthorized.

| Property | Finding |
| --- | --- |
| **Is a batch token required?** | Yes. `AttachmentUploadGuard` runs `admit()` before the interceptor; without a usable claim the request is rejected with 404 and Multer never parses. |
| **How is the token obtained?** | `POST /api/v1/intake/attachments/batches` with a valid `issueId`/`versionId` pair that resolves through `loadSubmissionDefinition` to a published service definition for the development Organization. Catalog identifiers are public, so **obtaining a token is open to any anonymous caller** — the token bounds abuse, it does not gate entry. |
| **Entropy** | `randomBytes(32).toString('base64url')` — 256 bits, 43 characters. Only the SHA-256 digest is stored; comparison uses `timingSafeEqual`. Guessing is not a practical path. |
| **Expiration** | 30 minutes (`attachmentLimits.lifetimeMs`), enforced on every claim check and swept by `cleanup()`. |
| **Replay** | The token is intentionally reusable within its batch until expiry or finalization — it is a staging capability, not a one-shot nonce. Reuse is bounded by `files: 5` and `totalBytes: 15 MiB` per batch, by per-file idempotency keyed on `fileId` plus checksum and filename (mismatch → 409), and by `state === 'STAGED'`. |
| **Organization / intake binding** | Bound at creation to `organization_id`, `context: 'REQUEST_EVIDENCE'`, `service_definition_id` and `service_definition_version_id`. On every use, `batch()` re-checks the row **under `forUpdate`** and rejects if `access` is present, so a resident token cannot be used on a staff batch or vice versa. |
| **Origin enforcement** | `AttachmentOriginGuard` rejects a **present** `Origin` outside the allowlist. A request with **no** `Origin` header passes — non-browser clients are unaffected. This is correct for a CSRF-shaped control and is **not** an authentication boundary; the capability token is. |
| **Rate limiting** | Global `ThrottlerGuard` (default 120 / 60 s) on the upload route; `@Throttle(10 / 60 s)` on anonymous batch creation. Both run before the interceptor. |
| **Concurrency limits** | `acquire()` caps in-flight parser admissions at 2 per process **before** Multer; `processing` caps decode/persist work at 2. Per-Organization admission is serialized by `pg_advisory_xact_lock`, with at most 20 `STAGED` batches and 100 batches opened per hour. |
| **Enablement** | The whole surface is fail-closed: `ServiceUnavailableException` unless `ENABLE_DEVELOPMENT_ATTACHMENTS=true` **and** `NODE_ENV !== 'production'` **and** `CITYVUE_DEPLOYMENT_PROFILE === 'development'`. `assertEnabled()` is called inside `acquire()`, i.e. **before** the interceptor. |
| **Does malformed multipart reach Multer before or after guards?** | **After.** Confirmed by test: an advisory-shaped body sent with a disallowed Origin returns **403**, with an invalid or absent token **404**, with the surface disabled **503**, and on the staff route without Entra **401** — in every case the parser is never invoked. |

**Net anonymous posture.** An anonymous attacker can obtain a token cheaply and reach the parser. Once there, `fields: 0` prevents the two process-crash advisories, memory storage prevents the two disk advisories, and the synchronous filter prevents the size-bypass advisory. The practical anonymous risk that remains is **not** a Multer advisory: because the caps are per-Organization and all anonymous residents share one Organization, an abuser can consume the 20-active / 100-per-hour staging budget and deny legitimate residents attachment staging. That is an availability concern in F046's own design, bounded by throttling, and is reported here rather than silently expanded into scope.

---

## 6. Existing mitigations, summarized

Controls actually verified at this baseline, with the advisory each addresses:

| Control | Location | Addresses |
| --- | --- | --- |
| `limits.fields = 0` — **security invariant** | `attachment.controller.ts` | CVE-2026-77078, CVE-2026-82333 (excludes while the invariant holds) |
| Memory storage (no `storage`/`dest`) — **structural** | `attachment.controller.ts` | CVE-2026-77037, CVE-2026-88932 (structurally excludes) |
| Default synchronous `fileFilter` | Multer default | CVE-2026-77063 (excludes under current configuration) |
| `limits.fileSize`, `files`, `parts`, `fieldNameSize`, `headerPairs` | `attachment.controller.ts` | Bounds parser work generally |
| Guards before interceptor | Nest pipeline | Keeps untrusted bodies away from the parser |
| Capability-token admission under `forUpdate` | `AttachmentService.batch` / `admit` | Anonymous authorization |
| `assertEnabled()` inside `acquire()` | `AttachmentService` | Fail-closed in production/client profiles |
| In-flight (2) and processing (2) caps | `AttachmentService` | Per-process parser/decode load |
| Throttling; per-Organization staging caps | `ThrottlerGuard`, `start()` | Abuse volume |
| Post-parse size re-checks | `assertAttachmentCount`, `processImage` | Defense in depth for CVE-2026-77063 |
| Sanitized error contract | `HttpExceptionFilter` | No parser detail disclosure |

---

## 7. Residual risks

1. **`fields: 0` is a single point of mitigation for two High advisories.** It is a one-line parser option with no second layer behind it. Adding any text field to the upload request, relaxing the limit, or introducing a second multipart interceptor without the same limits restores a **remote, unauthenticated, single-request process crash** (CVE-2026-77078) and an event-loop stall (CVE-2026-82333). The parser-level regression tests added in section 8 exist specifically to fail if this changes.
2. **The vulnerable dependency remains in the production tree.** Non-reachability is a property of current configuration, not of `multer@2.2.0`. Audit tooling will keep reporting it.
3. **New multipart surfaces do not inherit these limits.** Any future `FileInterceptor`/`FilesInterceptor`/`AnyFilesInterceptor` defaults to unlimited fields and to disk storage if given `dest` — which would make all five advisories reachable.
4. **`Origin` is only enforced when the header is present**, so it provides no protection against non-browser clients. Intended for a CSRF-shaped control; noted so it is not mistaken for authorization.
5. **Anonymous staging-budget exhaustion** (section 5) is a real availability path independent of Multer, arising from per-Organization caps shared by all anonymous residents.
6. **Memory-storage buffering** holds up to 5 MiB per admitted request in process memory. Bounded by the in-flight cap of 2 per process — a per-process bound, not distributed abuse protection, as the code comment already states.
7. **`fieldNestingDepth` is not configured**, and `fieldArrayIndexLimit` does not exist in 2.2.0. Both are moot while `fields: 0` holds, and both become relevant the moment fields are permitted.
8. **Observed parser boundary behavior (not a defect):** busboy flags a file the instant it reaches `fileSize`, so the largest body the parser accepts is `fileBytes - 1`, while `assertAttachmentCount` rejects only *above* `fileBytes`. The parser is stricter by one byte. Recorded so the one-byte difference is not later mistaken for a bug.
9. **Out-of-scope finding observed during reassessment:** moderate `js-yaml@5.3.0` advisory GHSA-r3ph-w7gj-g6xm via `@nestjs/swagger@11.4.7`, plus one new moderate finding in the root project audit. Neither was reassessed here; both are logged for the dependency-review workstream.
10. **City operational risk owner and production exception approval remain unassigned/pending.** No production readiness or deployment approval is established by this document.

---

## 8. Validation performed for the reassessment

Tests added (focused, non-destructive, no database, no production source change):

- `server/test/unit/attachment-multipart-parser.test.ts` — **5 tests.** Retrieves the **actual** interceptor from `IntakeAttachmentController.prototype.upload` route metadata and drives its real Multer instance, so the assertions bind to production configuration rather than a copy. Asserts memory storage and a synchronous `fileFilter`; asserts the exact limits; drives both advisory field-name shapes (`items[4294967294]` + `items[text]`, and `items[0]` + `items[4294967295]`) and asserts `LIMIT_FIELD_COUNT` with **zero appended field keys**; asserts file-size, file-count, field-name-length and unexpected-field limits; asserts malformed input (missing boundary, malformed part header, truncated body, nameless part) is rejected without terminating the process.
- `server/test/e2e/attachment-multipart-security.e2e.test.ts` — **7 tests.** Real HTTP stack, real guards, real interceptor; only `AttachmentService` and `DatabaseService` are substituted, so no PostgreSQL is required. Proves ordering: advisory-shaped bodies are rejected **403** (disallowed Origin), **404** (invalid and missing token), **503** (surface disabled) and **401** (staff route without Entra) with the parser never invoked; **400** when admitted (field-count limit, handler never reached); **413**/**400** for the size, count and field-name limits; and that the sanitized error body exposes only `{statusCode, error, requestId}`.
- `server/test/unit/attachment.service.test.ts` — **1 test appended.** Against the **real** `AttachmentService`: `acquire()` throws `ServiceUnavailableException` when attachments are disabled, when `NODE_ENV=production`, and when the deployment profile is `client`; and beyond the in-flight cap, recovering after release. This confirms the fail-closed gate that runs before the parser is genuinely in production code, not only modelled by the E2E stub.

A deliberate safety interlock: the parser test asserts the benign-field control **before** sending advisory shapes, so if `fields: 0` ever stops suppressing field emission the test fails at the control and never sends the dangerous inputs.

**Validation prerequisite.** This worktree had no installed dependencies, so no suite could run. `npm ci` was run in `server/` to install the **existing** lockfile. It resolved nothing and changed neither dependency manifest nor lockfile — `server/package.json` and `server/package-lock.json` were confirmed unmodified afterwards (`git status` clean for both paths). This is recorded as a validation prerequisite; it is **not** a dependency change, and it is not the deferred remediation described in section 9.

Exact results at this baseline:

| Invocation | Result |
| --- | --- |
| `npm --prefix server run typecheck` | **Clean** |
| `npm --prefix server run lint` | **Clean** |
| `npm --prefix server run test:e2e` (full) | **48 tests, 48 passed, 0 failed, 0 skipped** |
| `npm --prefix server test` (full unit) | **326 tests, 325 passed, 1 failed, 0 skipped** |
| `npm --prefix server run test:db` | **Not executed** — requires PostgreSQL; excluded by the task's database boundary. Reported as not run, not as passing. |
| `npm --prefix server run format:check` | **Pre-existing repository-wide failure** (341 files, including unmodified `package.json`, `README.md`, `tsconfig.json`), caused by `core.autocrlf=true` on this worktree. The three files changed here were verified individually clean with `npx prettier --check`. |

The one unit failure is **pre-existing and unrelated**: `logging-sanitization.test.ts` › "migration, seed and API startup configuration failures never echo credentials or CA paths" fails with `main.js: Error / null !== 1` (subprocess exit code `null`, i.e. killed) only under the full-suite run. It was reproduced in the full suite **with the new parser test file removed** (321 tests, 320 passed, 1 failed — the same test) and it **passes in isolation** (7/7). The isolated pass is supplemental evidence and does not rewrite the failed full-suite invocation. No assertion was weakened and no timeout was raised.

**Deliberate limitation.** The advisory inputs were never executed against an unlimited parser. The tests therefore prove that Reqro's configured path **never reaches `append-field`**; they do not independently demonstrate that these specific inputs would crash or stall an unmitigated parser. That claim rests on the upstream advisories and on static reading of `append-field@1.0.0`, and confirming it would require exactly the destructive behavior this task excludes.

Evidence commands: `npm --prefix server audit --package-lock-only --json`; `npm view multer version`; `npm view multer versions`; `npm view @nestjs/platform-express@{11.2.3,11.2.4,11.2.5,11.2.6,latest} dependencies`; inspection of installed `multer@2.2.0` (`index.js`, `lib/make-middleware.js`, `storage/memory.js`, `storage/disk.js`, `lib/multer-error.js`), `busboy@1.6.0` (`lib/types/multipart.js`) and `@nestjs/platform-express@11.2.3` (`multer/interceptors/file.interceptor.js`, `multer/multer/multer.utils.js`); the three test files above. Audit data is time-specific and must be refreshed when revisiting this item.

---

## 9. Remediation options and recommendation

**No remediation was performed.** `package.json`, both lockfiles and all production source are unchanged. The options below are for human decision.

The target is **Multer >= 2.4.0**, not 2.3.0, because CVE-2026-88932 covers `>=2.2.0 <2.4.0`.

| Option | Change | Trade-offs |
| --- | --- | --- |
| **A. Adapter patch (recommended)** | `@nestjs/platform-express` 11.2.3 → **11.2.6**, which pins `multer@2.4.0` | Same-major, already inside the declared `^11.2.3` range, so no `package.json` edit and no `--force`. Clears all five Multer advisories and the propagated adapter finding. Peer requirements (`@nestjs/common`/`@nestjs/core ^11.0.0`) are satisfied by installed 11.2.3. Lowest-risk path; still requires full regression validation because the adapter and Express are on the multipart path. |
| **B. Scoped `multer` override** | `overrides: { multer: "2.4.0" }` in `server/package.json` | Also avoids a major upgrade, but deliberately bypasses the adapter's exact pin, so the adapter runs against a version it did not declare. Strictly worse than A now that A exists. Only relevant if A is blocked. |
| **C. Nest 12 major upgrade** | `@nestjs/platform-express` → 12.1.1 (pins `multer@2.4.0`) | Also fixes the advisories, but pulls a framework major across core, swagger and testing with breaking-change risk far exceeding the advisory exposure. Not warranted for this purpose. |
| **D. Continue deferral** | No change | Defensible on *current* exposure — all five advisories are NOT REACHABLE through the currently configured upload paths. Not recommended, because option A is now cheap and in-range, and residual risk 1 means the mitigation is one configuration change from failing. |
| **E. Framework downgrade** | Audit-suggested cross-major downgrades | **Rejected.** Would require `--force`, break the Nest 11 contract, and reduce security to lower a count. |

**Recommendation: Option A**, as a separate authorized dependency change. Because option A exists, the original record's conclusion that "no supported patched adapter version was identified" is obsolete and should not be cited.

Validation that option A should carry, if authorized: refresh root and server audits; re-run the full unit, E2E and PostgreSQL suites; re-run the three SEC-001 test files above unchanged, since they assert parser configuration and limit behavior and would detect a Multer behavior change; and specifically re-confirm memory storage, the synchronous `fileFilter` and the `fields: 0` gate under 2.4.0, as `fieldArrayIndexLimit` and the 2.3.0 field-name fixes alter the code being asserted.

**Do not** weaken or remove `fields: 0`, the memory-storage choice, or the guard-before-interceptor ordering as part of any upgrade: they are the controls this assessment depends on.

---

## Follow-up gates

- Remediation of the five Multer advisories requires explicit authorization as a **separate dependency change**; it was excluded from this reassessment.
- Reassess again before any production API activation, before enabling attachments outside the development profile, and at the next dependency review.
- **Re-run this reassessment whenever the multipart configuration changes** — specifically on any change to the `FileInterceptor` limits, the storage engine, the `fileFilter`, the guard order on the upload routes, or the addition of any new multipart route. Residual risk 1 makes this the highest-value trigger.
- Triage separately, outside SEC-001's multipart scope: moderate `js-yaml@5.3.0` GHSA-r3ph-w7gj-g6xm via `@nestjs/swagger@11.4.7` (audit's fixed range implies a Swagger major bump), and the new moderate finding in the root project audit.
- Consider, as a separate F046 review item rather than a dependency change, whether anonymous per-Organization staging caps should be partitioned so one abuser cannot exhaust the shared budget.
- City operational risk owner and production exception approval remain unassigned/pending.
