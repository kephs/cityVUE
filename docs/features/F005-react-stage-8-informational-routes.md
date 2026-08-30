# F005 — React Stage 8 Informational Routes and MVP Scope Closure

**Status:** Complete  
**Scope:** React migration Stage 8 product review; no informational route migration

## Decision

`/about` and `/contact` are intentionally excluded from the current React MVP. The legacy `pages/about.html` and `pages/contact.html` files are nearly identical skeletal navigation documents: neither contains substantive informational content, a working contact experience, or evidence of approved CityVUE copy. Their relative asset and navigation paths also assume a different location. The one-line legacy JavaScript entry files add no page behavior.

Migrating these shells would present incomplete content as a finished product. The legacy files remain available for Parcel rollback and are not deleted by Stage 8.

## Feedback Assessment

The React Home page previously displayed a Share Feedback `mailto:` action using a hard-coded address whose approval and support ownership are not established in the repository. Stage 8 removes that panel from the current MVP rather than implying a supported feedback channel. No replacement form, email workflow, destination, or backend is introduced.

## Current React MVP Routes

| Route | Supported experience |
| --- | --- |
| `/` | Home |
| `/report` | Report an Issue |
| `/issues` | Issue List |
| `/issues/:issueId/edit` | Edit Issue |
| `/dashboard` | Dashboard |
| `*` | Not Found |

Primary navigation remains Home, Report an Issue, Issue List, and Dashboard. The shared footer retains only its supported Report a community issue link to `/report`. About and Contact are not added to navigation or the footer.

## Current and Future Boundaries

The current route set is the React MVP scope for Stage 9 cutover validation. Legacy `.html` compatibility, Hosting rewrites, route-level code splitting, Parcel removal, and deployment are Stage 9 or later work.

Future informational content requires an identified City content owner and approved, maintained copy or destinations. Potential areas include About CityVUE, resident support/contact guidance, privacy notice, accessibility statement, terms/use guidance, service availability/help, emergency-use guidance, and a supported feedback channel. This document does not provide legal, policy, contact, or emergency copy and does not approve any URL, address, phone number, or email destination.

## Non-Changes

Stage 8 does not change `Issue`, `IssueService`, `cityvueIssues`, Firebase Hosting, persistence, authentication, backend/API behavior, future domain requirements, or legacy Parcel rollback files. It implements no contact, email, or feedback backend.
