# F065 — Public submission tracking confirmation

Automatic, expiring tracking credentials for PUBLIC Service Requests, issued inside the authorizing request-creation transaction, with a resident-facing confirmation that hands the link over exactly once.

**Status: implemented locally, shipped disabled.** The capability is gated behind `REQRO_ENABLE_REQUESTER_INTAKE_TRACKING`, which is OFF by default. Migration application, activation and deployment are separate authorizations. [ADR-009](../architecture/decisions/ADR-009-secure-requester-tracking.md) carries the amended decision; this record carries the implementation detail.

## Why the feature is gated

Submission idempotency today covers only submissions that carry attachments. The de-duplication key is the attachment batch token plus a `submission_digest` content checksum, so a retried attachment-free submission after a lost response creates a second Service Request — and, with automatic issuance, would mint a second credential. That is pre-existing behavior, not introduced here, but automatic issuance makes it more consequential.

**Reqro is not represented as having complete submission idempotency.** Activation waits on the separately approved all-submission idempotency milestone.

## Issuer attribution

A resident has no `staff_identity` row, so `request_tracking_credential.created_by_staff_identity_id` could not previously hold a resident author. Rather than fabricate a staff identity, the column became nullable and an explicit `issuer_type` discriminator records the issuer. A CHECK keeps the two combinations exact:

| `issuer_type` | `created_by_staff_identity_id` |
| --- | --- |
| `staff` | must be present |
| `requester_intake` | must be absent |

A staff row can therefore never lose its author, and a requester-intake row can never borrow one. The existing tenant-scoped foreign key still fully constrains staff rows, because a foreign key does not constrain NULL.

## Expiry as a predicate

Expiry is an absolute `expires_at` timestamp, evaluated as a predicate and never stored as a status. Keeping `status` to `('active','revoked')` leaves the active-to-revoked immutability rule and the one-active-credential partial unique index untouched, and means no background expiry job exists.

The consequence is deliberate: an expired credential still reads `status='active'` and simply stops resolving. Staff management therefore derives an `expired` flag from the database clock and presents "Expired" separately, so nobody is told a dead link still works.

Expiry is evaluated in SQL, against `clock_timestamp()`, in **both** the digest lookup and the post-lock recheck — mirroring how `status='active'` was already checked twice. A skewed application server cannot admit a dead credential, and a credential that lapses between the lookup and the lock cannot still resolve.

## Lifetime policy

| Parameter | Value |
| --- | --- |
| Default | 180 days |
| Minimum configurable | 30 days |
| Platform maximum | 365 days |
| Fixed at issuance | yes |

`request_tracking_policy` is keyed on `organization_id`, with the platform bound as a database CHECK so no tenant value can exceed the maximum even by direct SQL. The application clamps whatever it reads as well, so a relaxed constraint could not widen a lifetime. Existing Organizations were backfilled by the migration; new Organizations are initialized by trigger, following the `organization_branding` and `organization_resident_experience` precedent, because a backfill alone would leave future tenants without a policy.

Lifetime is fixed at issuance from the policy then in force. Extending a stored expiry would resurrect a dead bearer credential; shortening one would revoke access with no audit record. Rotation issues a fresh lifetime and is the sanctioned renewal path.

Credentials issued before this feature have no expiry and keep none. No expiry is backfilled onto them, because that would be a retroactive mass revocation. The asymmetry is recorded here as a known inconsistency for a later reviewed decision.

**No policy administration endpoint was added**, and no permission key was created. A management route would require a new staff permission, which F065 is not authorized to grant, so the table ships with platform defaults only.

## Issuance path

`RequestTrackingService.issueAtIntake` is reachable only from inside `CreateServiceRequestService.create()`, and only when the audience is `public` and the context carries `requesterIntake` — which only the resident web intake path sets. Staff intake and the trusted provider path are excluded explicitly.

- Organization and request identity come from the authorizing creation transaction, never from a caller.
- No permission is consulted and none is granted.
- Generation and digesting reuse the existing `generateTrackingCredential` and `trackingDigest`; only the digest is persisted.
- The insert shares the caller's transaction, so request, credential and audit commit together. A failure rolls the submission back rather than leaving a request whose credential was never recorded.
- INTERNAL requests are excluded by the caller and, independently, by the insert trigger's PUBLIC-parent requirement.
- Audit writes `requester_tracking_issued` with `actor_type` of `anonymous_resident` or `identified_resident` and a null staff identity. Both existing CHECK constraints already admitted that combination, so no audit migration was needed.

Automatic issuance adds no HTTP surface, so it introduces no new rate-limit vector: the only trigger is a successful `POST /service-requests`, already bounded by the global throttle.

## Staff management

Unchanged in authority: rotation and revocation still require `service_request.tracking.manage`, and no permission was widened. Behavior that did change:

- With the feature enabled, every new PUBLIC request holds an active credential from creation, so the one-active-credential index makes initial issuance unreachable until after a revocation. The normal action becomes **rotation**.
- Management now reports `expired`, `expiresAt` and `issuerType` as safe metadata — never a digest or a usable link.
- Rotation applies the tenant's current lifetime policy to the new credential while preserving staff issuer attribution and leaving the revoked row as history.
- The rotation confirmation states plainly that the requester's existing link stops working immediately.

## Idempotency and lost responses

| Scenario | Behavior |
| --- | --- |
| First successful submission | Request, credential and audit commit atomically; the raw credential is returned once. |
| Duplicate with the same batch and identical content | The prior receipt is returned with **no** tracking object. Nothing is minted or rotated. |
| Duplicate with changed content | Existing `Attachment submission changed.` conflict, unchanged. |
| Response lost after commit | The raw credential is unrecoverable from its digest. A retry returns the receipt without a credential; the confirmation shows the fallback. |
| Concurrent duplicates | The attachment batch row lock serializes them; the loser replays the winner's receipt. The partial unique index is the final backstop. |
| Failure before commit | Everything rolls back — no request, no credential, no audit, and no confirmation screen. |
| Attachment-free retry | A second request is created. Pre-existing, documented, and the reason this feature is gated. |
| Expired or revoked at read | 404, indistinguishable from an unknown credential. |

The two replay paths return before issuance is reached, so a retry cannot mint a second credential, and the original raw value is never re-derived.

## Response contract

`POST /service-requests` gains an optional `tracking` object, present only on a genuine first creation of a resident PUBLIC submission while the feature is enabled:

```json
{ "tracking": { "credential": "<43-char base64url>", "expiresAt": "<ISO-8601>" } }
```

It is absent when the flag is OFF, on an idempotent replay, on INTERNAL requests, and on staff or provider intake. The response carries `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

## Resident confirmation

The existing confirmation gained a requester-safe initial status via the shared `StatusBadge`, and a one-time tracking handoff that reuses the established `/track#<credential>` fragment format and the staff dialog's copy pattern. It shows the link, a Track Request action, a Copy Tracking Link action with success and failure feedback, the expiry date, the shown-once warning, and a statement that anyone holding the link can view the request.

Navigation is a full document load, so the existing session scrubber consumes the fragment and strips it from history before the router is constructed — the same path a pasted link takes. The raw credential lives in component state only: never in storage, router state, the document title, analytics or a query string. Refreshing the confirmation loses it, which is intended.

When no credential is returned — including whenever the flag is OFF — the normal confirmation is preserved and a fallback explains that tracking is not available. No link is ever synthesized from the reference number, and the resident is never told tracking was issued when it was not.

## Known limitations

1. Attachment-free submissions have no idempotency; duplicate submission after a lost response remains possible. This gates activation.
2. There is no recovery path for a lost link. Staff rotation is the only replacement, and it requires an already-authorized channel to reach the requester.
3. An anonymous submission's credential has no verified recipient. Possession is request-scoped access, not identity — consistent with ADR-009, but generalized by automatic issuance from zero credentials to one per PUBLIC request.
4. Pre-F065 credentials remain non-expiring.
5. No tenant lifetime administration surface exists; the policy table holds defaults only.
6. Expiry has no notification, so a resident learns of it only by using a dead link.
