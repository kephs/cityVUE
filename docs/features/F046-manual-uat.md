# F046 — Personal development UAT record

Status: authenticated manual checks reported complete; the shared preview layout
was corrected and revalidated. Completed security and cleanup results are in the
[implementation report](F046-implementation-report.md).

## User-reported authenticated observations

These results were reported by the user in the normal signed-in personal
development staff session. They are separate from automated evidence. Exactly
one fictional PUBLIC Service Request, **SR-202609-000008**, was created for F046.
No additional request, Note or Communication was created for the layout fix.

| Check                              | Reported result                                                                                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| PUBLIC Request Evidence            | PASS: Selected → Prepare files → Ready, preview, Remove, re-selection/re-preparation, Back/Next draft preservation, submission and persisted evidence |
| Staff Request Evidence             | PASS: correct evidence, preview/download and refresh persistence                                                                                      |
| Internal Note attachment           | PASS: independent Note/Communication selections, draft/tab behavior, creation, refresh, preview/download                                              |
| Requester Communication attachment | PASS: independent Communication/Note files, refresh, preview/download and OUTBOUND / PORTAL / RECORDED semantics; no external delivery implied        |
| Invalid attachment                 | PASS: safe rejection, blocked operation while invalid file remained, recovery after Remove                                                            |
| Responsive, keyboard and themes    | PASS for functional interactions, with the preview alignment defect described below                                                                   |
| Actual mobile camera hardware      | Not tested; a capture-enabled browser input does not establish device hardware behavior                                                               |

Requester Tracking was not exercised. The approved baseline remains **1 active /
5 revoked**; only aggregate counts are used for final integrity verification.
No live grant mutation or negative-authorization session was performed. Negative
authorization and revocation are covered by disposable automated tests.

## Preview alignment correction

The user observed that image previews appeared at the far right edge of their
attachment rows. The shared presentation now places the preview first, followed
by an adjacent metadata/actions group, with natural wrapping on narrow screens.
Request Evidence, Internal Notes and Requester Communication reuse this layout,
including prepared draft files. Existing theme/spacing tokens are retained.

An isolated browser fixture rendered the actual shared components with single
images, long filenames, multiple attachments and prepared drafts at **1440,
1280, 1024, 768 and 390 px**, in both light and dark themes. All ten combinations
passed: 17 loaded previews stayed with their rows, filenames wrapped, controls
stayed in view, rows did not overlap and there was no horizontal overflow.
Keyboard activation of Download and Remove had visible focus and worked.
Focused React checks passed **94 tests across four files**. This validation used
synthetic in-memory fixtures with API traffic blocked; it created no data. It is
not a new authenticated manual observation or a WCAG certification.

## Post-remediation authenticated recheck

After the approved Vite private-directory protection was applied, the user
restarted the frontend and reported that Preview and Download passed again for
Request Evidence, the Note attachment and the Communication attachment on
SR-202609-000008. Independent synthetic probes confirmed 403 for direct/raw/
inline requests beneath both protected directories on that restarted server.
No request, Note, Communication, grant or tracking action was needed.

## Privacy, integrity and retained fixtures

Read-only development checks found one finalized CLEAN PNG in each context, all
associated with SR-202609-000008. Checksums and lengths matched the processed
objects, orientation was normalized and EXIF/GPS/XMP/IPTC/ICC metadata was absent.
The retained request remains open at revision 1, with updatedAt equal to its
creation time. Existing records and grants remain preserved.

The closed temporary API capture was checked locally without printing its
contents. No private values were detected. The user stopped the capture, and
the temporary log, synthetic source image and invalid fixture were deleted.
Minimal attachment audit contains only its allowed metadata, with no filenames,
paths, storage keys, checksums or capabilities.

Abandoned staging is removed only through the implemented 30-minute expiry and
one-hour object grace policy. The final inventory is recorded in the report.
The three immutable fictional attachments are intentional UAT evidence and must
not be deleted merely to reduce counts. No new UAT action is requested here.
