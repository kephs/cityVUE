# SEC-002 — Development API loopback listener

**Recorded:** 2026-10-21 at baseline `a022a4ea1adc4563f38507c0ba22ea35f5ac12de` (PR #73).

**Status:** Source correction implemented and validated **offline**. The running F067 UAT API is **not** yet loopback-bound: it still runs the baseline listener until a separately authorized restart, and the network blocker is cleared only when that restarted socket is verified (see [section 7](#7-remaining-verification-and-activation)).

## 1. Original behavior

`server/src/main.ts` started the API with `app.listen(port)` and no host. Node then listens on every interface: `0.0.0.0` and `[::]`. That was true for every `NODE_ENV`, including local development.

## 2. Threat scenario

The F067 UAT workstation was on Wi-Fi categorised as a **Public** network. Its API was listening on `0.0.0.0:3001` and `[::]:3001`, with these protections:

- Windows Firewall blocks inbound traffic by default on that profile, **but** the API's real executable (`nvm\v20.20.2\node.exe`) has enabled inbound **Allow** rules on the Public profile. Their port and address scope cannot be read without Administrator rights.
- A third-party firewall is also active, and its rules were not inspectable.

The protection therefore could not be established. Anyone on the same network might reach a development API that:

- holds a live Entra-bound staff identity;
- connects to a database seeded with synthetic data.

CORS restricts browsers only; it is not network isolation. A workstation API must not depend on host firewall state for its isolation.

## 3. Listener contract

The decision lives in `server/src/config/listen-address.ts`. `main.ts` calls `listenApplication` there, which is now the API's only `listen` call.

| `NODE_ENV` (validated `app.environment`)                    | Profile                                    | Listener                                                                 |
| ----------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------ |
| `production`                                                | `client` (required by existing validation) | **Unchanged:** `listen(port)` with no host                               |
| `development`                                               | `development`                              | `127.0.0.1:<PORT>`, IPv4 loopback only                                   |
| `development`                                               | `client`                                   | `127.0.0.1:<PORT>` (fails closed)                                        |
| `test`                                                      | either                                     | `127.0.0.1:<PORT>`                                                       |
| Missing                                                     | —                                          | Validation defaults it to `development`, so `127.0.0.1`                  |
| Anything else (`staging`, `Production`, `" production"`, …) | —                                          | Refused by environment validation. The policy also treats it as loopback |

- **Only the exact string `production`** keeps the original listener.
- **No override exists.** No new environment variable was added. `HOST`, `LISTEN_HOST` and `BIND_HOST` have no effect, and no configuration can widen a non-production listener to `0.0.0.0`, `::` or any other address.
- **IPv4 loopback, not `localhost`.** `localhost` can resolve to `::1` or to more than one address depending on the host.

## 4. Production and client behavior

- **Listener unchanged.** Production containers (`server/Dockerfile` sets `NODE_ENV=production`) keep `listen(port)` exactly, so ingress reachability is the same.
- **Other production controls unchanged:**
  - the production serving validator: public hostnames, trusted proxy peers, HTTPS CORS origins;
  - tenant host selection and TLS;
  - database requirements.
- **Earlier statement still holds.** The production observation in [F060-4A-2B-0](../features/F060-4A-2B-0-edge-private-ingress-iac-readiness.md), that loopback-only Nest is not implemented for production, remains accurate. This record does not change the production ingress design.
- **Nothing new outside code.** No cloud resource, privilege, route, controller, authentication, tenant-resolution, CORS, Entra, database, F065 issuance or staff-authorization change.

## 5. Regression tests

`server/test/unit/listen-address.test.ts` exercises `listenApplication`, the function `main.ts` calls:

- **Development and test** pass `(port, '127.0.0.1')`.
- **Real socket:** an empty Nest application on an ephemeral port reports `127.0.0.1` / `IPv4` from its HTTP server address. No wildcard socket is ever opened.
- **Fail closed:**
  - missing, empty, wrong-case, padded and non-string environments resolve to loopback;
  - wildcard-looking values (`0.0.0.0`, `::`, `[::]`, a LAN address, `::1`) resolve to loopback;
  - `HOST`, `LISTEN_HOST` and `BIND_HOST` set to wildcards don't change the call.
- **Production** passes exactly one argument, `(port)`.
- **Profile rules:**
  - a validated production/client serving configuration keeps the original listener;
  - validated and defaulted development configurations bind loopback;
  - production with the development profile is still refused;
  - an invalid `NODE_ENV` is still refused.
- **`main.ts` has no direct `.listen(` call**; it passes `app.environment` to the policy.
- **The policy is isolated:** it reads no CORS, Entra, database, tracking, staff or `process.env` setting, and imports only a Nest type.

## 6. Offline validation

Run in an isolated worktree on branch `claude/f067-development-loopback-security`, without PostgreSQL, Docker or network services.

| Check                                                        | Result                                                    |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| `listen-address.test.ts`                                     | 11 / 11 passed, 0 skipped                                 |
| With `environment.test.ts` and `serving-environment.test.ts` | 66 / 66 passed                                            |
| `production-serving.e2e.test.ts`                             | 2 / 2 passed                                              |
| Full backend unit suite (`npm test`)                         | 1,407 / 1,407 passed, 0 skipped (1,396 baseline + 11 new) |
| Typecheck, ESLint (full), production build, test compilation | Exit 0                                                    |
| Prettier (changed files), `git diff --check`                 | Clean                                                     |

Database-backed suites and `npm run validate` were not run, because they provision PostgreSQL.

A unit-test pass proves the startup decision, not the state of any running process.

## 7. Remaining verification and activation

1. **Review and publication.** Independent review, then publication, each separately authorized.
2. **Controlled restart of the active F067 UAT API**, separately authorized:
   - **Code:** the active worktree must run code containing this commit, for example by moving its detached HEAD to it. Its `dev.mjs` watcher rebuilds and restarts the API child.
   - **Configuration:** the existing process-scoped configuration is unchanged.
3. **Verify the real socket**, for example with `Get-NetTCPConnection -LocalPort 3001 -State Listen`:
   - only `127.0.0.1:3001` is listening;
   - nothing is listening on `0.0.0.0:3001` or `[::]:3001`;
   - live and ready checks return 200;
   - an unauthenticated staff route returns 401.
4. **Frontend API base**, in that same milestone: restart Vite with `VITE_CITYVUE_API_BASE_URL=http://127.0.0.1:3001/api/v1`.
   - The frontend stays at `http://localhost:5174`, and `CORS_ORIGINS=http://localhost:5174` stays as it is, since CORS matches the page origin, not the API host.
   - Entra redirect URIs, registrations and scopes are unchanged.
5. **The network blocker for authenticated Entra UAT is cleared only after step 3** passes against the restarted process.
