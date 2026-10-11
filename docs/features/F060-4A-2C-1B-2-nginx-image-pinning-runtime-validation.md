# F060.4A-2C-1B-2 — NGINX Image Pinning & Runtime Validation

Status: local runtime validation complete, subject to final supply-chain/runtime review. Vulnerability scanning remains blocked on scanner authentication; no production readiness or Azure verification is claimed.

**THE IMAGE IS PINNED BY DIGEST.**

**THE CONTAINER RUNS NON-ROOT.**

**THE MSAL BRIDGE REMAINS INACTIVE.**

**NO ENTRA CONFIGURATION CHANGED.**

**NO CSP OR HSTS POLICY WAS ADDED.**

**NO AZURE RESOURCE WAS CREATED.**

**NO IMAGE WAS PUSHED TO A REGISTRY.**

**NO DEPLOYMENT OCCURRED.**

## Baseline and authority

Authoritative fetched origin/main and starting HEAD: **1d773d8032eb5520206b02c9770b78385f94dbe2**. Reviewed configuration commit 31801ba57d5c0c0baa8975a2d86cc04508f0334c is an ancestor. Branch codex/f060-nginx-image-runtime-validation was created in an isolated worktree with clean tree/index and 0 ahead / 0 behind.

Authority: [static-origin ownership](F060-4A-2C-1B-0A-static-origin-header-ownership-decision.md), [configuration foundation](F060-4A-2C-1B-1-nginx-routing-spa-fallback-coop-foundation.md), [ADR-030](../architecture/decisions/ADR-030-production-serving-contract.md) and [bridge foundation](F060-4A-2C-2A-auth-1-msal-redirect-bridge-foundation.md). The current task explicitly authorizes digest selection and local container execution, with runtime-proven minimal configuration fixes.

Docker Desktop 4.88.1 / Engine 29.7.2 was already installed. Host is Windows/amd64; desktop-linux daemon is Linux/amd64. Buildx 0.36.1-desktop.1 and Docker Scout 1.24.0 are installed. Initial sandbox access errors were resolved by running authorized Docker operations outside the sandbox; no workstation installation/configuration change occurred. Git again emitted the unrelated stale-worktree cleanup permission warning; no repair was attempted.

## Verified image provenance

The [NGINX stable release listing](https://nginx.org/en/download.html) and [NGINX-maintained stable Debian Dockerfile](https://raw.githubusercontent.com/nginx/docker-nginx-unprivileged/main/stable/debian/Dockerfile) both identify 1.30.5. The [upstream project](https://github.com/nginx/docker-nginx-unprivileged) identifies GHCR distribution, non-root execution, port 8080 and temporary-directory requirements.

| Property                        | Verified value                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| Registry/repository             | ghcr.io/nginx/nginx-unprivileged                                                             |
| Tag                             | 1.30.5-trixie                                                                                |
| Variant                         | Plain stable Debian Trixie unprivileged; no Perl/OTel variant                                |
| Date verified                   | 2026-10-11                                                                                   |
| Multi-platform OCI index digest | sha256:d715f7a85cdfea820fec743ea5aee8a22f91e00ff310ad6275d2638112d8cf8d                      |
| Local amd64 child digest        | sha256:35c16ddeb87a192a1fa2aaabff404f532aa4268367922277ed0bd28d3685974f                      |
| Runnable manifest platforms     | linux/amd64, linux/arm/v7, linux/arm64, linux/386, linux/ppc64le, linux/riscv64, linux/s390x |

Registry verification used docker buildx imagetools inspect against the exact tag, followed by a pull using the verified index digest. Unknown/unknown entries are attestation manifests, not runnable architectures. The Dockerfile pins the multi-platform index, not the local child. No production architecture is selected and no --platform override is used.

[image-pin.json](../../deploy/frontend/nginx/image-pin.json) records provenance. [The Dockerfile](../../deploy/frontend/Dockerfile) uses the exact tag@sha256 reference. Future upgrades require explicit review; there is no automatic updater. This is registry/source verification, not a claim of cryptographic signature or attestation verification.

## Runtime packaging and contents

The existing frontend build remains vite build react --outDir ../dist-react --emptyOutDir. The installed Vite CLI was invoked through Node because npm is absent from the task shell PATH. No Node build stage, package installation or second base image is introduced.

The image copies generated dist-react artifacts to /usr/share/nginx/html and the reviewed [configuration](../../deploy/frontend/nginx/nginx.conf) to /etc/nginx/nginx.conf. COPY --chown=101:101 and explicit USER 101:101 require no root step. The [Dockerfile-specific ignore file](../../deploy/frontend/Dockerfile.dockerignore) restricts build context to those inputs and the Dockerfile. Only clean-worktree generated frontend artifacts are packaged.

ENTRYPOINT runs nginx directly with daemon off, avoiding upstream entrypoint templating/writes to /etc. EXPOSE is 8080/tcp. No health probe or startup dependency on the API exists.

Docker-reported final local image size: **66,200,848 bytes**. Runtime nginx -v reports **nginx/1.30.5**. Image environment contains only upstream PATH and NGINX/NJS/package version metadata; no application ARG/ENV is introduced. Image history shows only the two Reqro COPY steps and runtime user/port/command changes. Copied frontend contents contain no .env, PEM/key/PFX/CRT credential files. No application secret, tenant credential, Entra registration data or private certificate is supplied to build/run. Upstream system CA trust material is distinct from application credentials. Public authentication-library code is not tenant configuration.

These are scoped inspection findings, not an exhaustive secret or software inventory. Generated assets must continue to be reviewed as public content; Vite public variables must never carry secrets.

## Runtime-proven configuration corrections

All corrections were made only after actual pinned-image validation demonstrated a problem:

1. **Temporary paths:** unchanged nginx -t under --read-only failed creating /var/cache/nginx/proxy_temp. Added proxy/fastcgi/uwsgi/scgi temporary paths under /tmp alongside the existing client-body/PID paths. These compiled-in module paths do not add proxy_pass, upstreams or API behavior.
2. **Container listener:** nginx -t passed, but the published host endpoint returned an empty reply. /proc/net/tcp showed 127.0.0.1:8080 inside the container. Changed the container listener to port 8080; Docker host publishing remains strictly 127.0.0.1 on an allocated test port. Container-wide binding is not authorization for public origin exposure.
3. **404 body/MIME:** an actual missing JS response was 404 text/html with NGINX's generated error page. Added a named 404 handler returning fixed plain text, preserving status and inherited headers. The first HTTP suite then passed 11/15: four error cases retained extension-derived MIME despite default_type. Clearing types only inside that handler fixed those cases; unchanged runtime assertions subsequently passed 15/15.

The existing source contract test was updated only for these reviewed runtime corrections: container listener, explicit non-SPA 404 handler and its empty MIME map. Normal successful MIME mappings, exact bridge handling, COOP omission, cache classes, API rejection and SPA exclusions remain intact.

## Non-root and filesystem evidence

Both image metadata and running id report UID/GID **101:101 (nginx)**. /proc status for master and all eight workers shows real/effective UID/GID 101, CapEff zero and NoNewPrivs 1.

Validation used --read-only, --tmpfs /tmp, --cap-drop ALL and --security-opt no-new-privileges. No privileged mode, root override, NET_ADMIN, SYS_ADMIN or DAC_OVERRIDE was added. Inspection confirmed read-only root and localhost-only host bindings. /tmp contained the PID and five NGINX temporary directories owned by nginx; docker diff was empty after HTTP tests.

The actual container socket listened on port 8080 (hex 1F90). The tested host mapping was 127.0.0.1:57980 → container:8080. No service was published on a public host interface. These local restrictions passed; production packaging/ingress restrictions still need their own approval and verification.

## Actual HTTP evidence

All requests used the actual built Vite output in the final pinned-base image. Tests compare response bytes with local artifacts, not merely status or HTML markers.

| Request class                                    | Status/body                                  | MIME/cache                       | COOP          |
| ------------------------------------------------ | -------------------------------------------- | -------------------------------- | ------------- |
| / and /index.html                                | 200, exact index bytes                       | text/html; no-store              | same-origin   |
| /staff and /admin/example                        | 200, exact index fallback                    | text/html; no-store              | same-origin   |
| /redirect.html and synthetic query variant       | 200, exact bridge bytes, distinct from index | text/html; no-store              | Absent        |
| Actual emitted JS                                | 200, exact asset bytes                       | application/javascript; no-cache | Normal policy |
| Actual emitted CSS                               | 200, exact asset bytes                       | text/css; no-cache               | Normal policy |
| Missing JS/CSS under /assets and missing root JS | 404, fixed Not found text, never index       | text/plain; no-store             | same-origin   |
| /api and /api/test                               | 404, no proxy/API fabrication                | text/plain; no-store             | same-origin   |
| /REDIRECT.HTML and /redirect.html/extra          | 404, no bridge/fallback                      | text/plain; no-store             | same-origin   |

Every tested response, including errors and the bridge, retains SAMEORIGIN, nosniff and no-referrer. CSP, CSP Report-Only and HSTS are absent. Bridge script/preload URLs serve the actual built bridge assets; the existing build-graph test separately proves no React/Router/business SPA module enters that graph.

Real .html, .js and .css MIME passed. The source retains the explicit .mjs mapping; this build emits .js rather than .mjs, so no emitted .mjs runtime result is claimed. The test requirement permits actual JS or MJS. No max-age, immutable, s-maxage or cache optimization is added.

## Reproduction and test scope

From a clean checkout with existing dependencies, build artifacts using the approved frontend build command, then:

```text
docker build -f deploy/frontend/Dockerfile -t reqro-f060-nginx-runtime:local .
docker run --rm --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges reqro-f060-nginx-runtime:local -t
docker run -d --name reqro-f060-nginx-validation --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges -p 127.0.0.1::8080 reqro-f060-nginx-runtime:local
docker port reqro-f060-nginx-validation 8080
```

Set REQRO_NGINX_TEST_URL to http://127.0.0.1:<reported-port> and run node --test test/NginxContainerRuntime.test.mjs. The runtime test refuses non-loopback targets and fails if no URL is supplied. Remove only the named task container after collecting evidence. No registry push command is involved.

| Validation                                              | Result                                                                                                    |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Registry digest, source release and image pull          | Verified approved tag and multi-platform digest                                                           |
| Vite production build                                   | Passed; index.html, redirect.html and assets emitted; existing chunk-size/plugin-timing warnings retained |
| Local Docker build and nginx -t                         | Passed on final configuration                                                                             |
| Real HTTP runtime suite                                 | 15/15 passed, zero failed/skipped; 357.608 ms                                                             |
| Pinning + existing routing + bridge suites              | 5 + 13 + 4 = 22 passed, zero failed/skipped; 2.490 seconds                                                |
| Existing MSAL compatibility suite                       | 7/7 passed, zero failed; 44.95 seconds                                                                    |
| Formatting, documentation, whitespace, git diff --check | Required before commit                                                                                    |

Initial syntax/operational failures and the 11/15 intermediate HTTP run above are retained; final success does not erase them. Final suites contain 44 distinct passing tests (15 runtime + 22 source/bridge + 7 compatibility). Focused reruns are not additional distinct tests. No database/F062/backend full-unit suite was run.

## Scanner limitation and deployment gates

Docker Scout 1.24.0 was invoked against the local image with critical/high severity selection. It exited without scanning because Docker account login is required. No login, account creation, scanner installation, update or suppression occurred. Trivy/Grype were not found on PATH. **No vulnerability-free claim is made.**

An authenticated approved vulnerability scan is a **pre-registry/pre-deployment gate**. Any critical/high base-image findings require review. This local implementation commit does not authorize publication or production use.

Remaining gates include image promotion/signature/provenance policy, approved production CPU/platform choice, private Container Apps configuration with public network access disabled, Front Door/WAF/Private Link/TLS, origin admission and real-hostname/edge verification. No Azure/IaC work is started.

Auth runtime and bridge source remain unchanged against the baseline: root redirectUri/postLogoutRedirectUri, loginRedirect and acquireTokenSilent are preserved. No Entra operation or authenticated UAT occurs. Bridge activation and CSP work remain separately gated.

Exact scope comprises Dockerfile, Dockerfile.dockerignore, image-pin record, runtime-proven nginx.conf corrections, two new focused test files, the corresponding existing routing-contract update and this document. No F061/F062, database, migration, API, auth runtime, package/dependency or Azure IaC changes.

**STOP FOR F060.4A-2C-1B-2 SUPPLY-CHAIN / RUNTIME REVIEW.**
