# Reqro — CityVUE Repository

Reqro is the current product name for this client-neutral resident-engagement and staff-work platform. CityVUE remains the historical repository name and existing technical/runtime identifier; no repository-wide rename has occurred.

Reqro remains independent of any one enterprise asset management (EAM) vendor. Future integrations may include VUEWorks, Cityworks, Cartegraph, MGO, VistaShare, or other municipal systems, but no EAM integration is currently implemented.

## Current status

The React/Vite application supports resident intake and a unified authenticated PUBLIC/INTERNAL staff workspace. The NestJS/PostgreSQL API supplies canonical requests, database-backed authorization, lifecycle/routing, assignment/watchers, Activity, protected requester contact and Internal Notes through F041.

Legacy/demo Issue workflows still use browser `localStorage`; those records are not canonical PostgreSQL requests and are not migrated automatically. Local implementation does not establish production readiness or a deployed backend. No live EAM integration is implemented.

## Technology stack

- React, React Router and Vite for the current frontend
- TypeScript/NestJS, Kysely and PostgreSQL for the API and canonical persistence
- Optional Microsoft Entra workforce identity with server/database authorization
- Parcel 2 retained for the legacy frontend/rollback build
- Bootstrap 5 and Bootstrap Icons
- Chart.js for dashboard charts
- Browser `localStorage` only for legacy Issue compatibility and existing preferences
- Firebase Hosting for static deployment
- npm for package management

Exact dependency versions are recorded in `package-lock.json`.

## Local setup

Prerequisites:

- A supported Node.js and npm installation
- Firebase CLI only when using the Hosting emulator or performing an authorized deployment

Install the locked dependencies:

```powershell
npm install
```

Use the checked-in environment examples and [server setup](server/README.md) for the intended local mode. React API mode and workforce identity require deliberate configuration; use only approved personal/synthetic resources for development. Do not commit local environment files or place privileged credentials in browser configuration.

Start the Parcel development server:

```powershell
npm start
```

The explicit legacy alias runs the same working MVP:

```powershell
npm run legacy:start
```

## Build

Create the React production bundle in the ignored `dist-react` directory:

```powershell
npm run build
```

`npm run legacy:build` produces the separate Parcel rollback bundle in `dist`.

## React/Vite application

The current frontend lives under `react/`; Parcel remains a separate compatibility path.

Start the React development application:

```powershell
npm run react:start
```

Create its production bundle in the separately ignored `dist-react` directory:

```powershell
npm run react:build
```

Preview the built React application locally:

```powershell
npm run react:preview
```

React includes resident, legacy Issue, dashboard and protected staff routes. See [Architecture](docs/ARCHITECTURE.md) for repository and authorization boundaries; frontend route guards do not authorize API access.

## Automated tests

Run the framework-independent Node regression suite:

```powershell
npm test
```

These tests remain independent of React and Vite. `npm run test:react` runs component tests. Backend, API, database, lint/type and build commands are documented in the [server workspace](server/README.md) and governed by the [development protocol](docs/development/REQRO_CODEX_PROTOCOL.md).

## Firebase Hosting emulator

Serve the configured Hosting output through the Firebase emulator:

```powershell
npm run serve
```

Run `npm run build` first when `dist-react` does not contain a current production bundle. The emulator does not deploy the application.

## Deployment

The deployment script builds React and deploys `dist-react` using the existing Firebase Hosting configuration. It is an explicit external-resource operation, not a validation command:

```powershell
npm run deploy
```

Run deployment only with explicit authorization, an authenticated Firebase CLI session, and the correct approved project access. Firebase Hosting currently serves the static front end; it is not being used as the application's database, authentication provider, or API layer.

## Development documentation

Read these before significant work; use the protocol's fresh-session recovery procedure:

- [Repository instructions](AGENTS.md)
- [Reqro Codex Protocol](docs/development/REQRO_CODEX_PROTOCOL.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Architecture decisions](docs/architecture/decisions/README.md)
- [Feature index](docs/features/README.md)
- [Product and historical context](docs/CITYVUE_CONTEXT.md)

Use Reqro for current product discussion and preserve existing CityVUE identifiers until a separately approved naming migration. Vendor-specific schemas remain outside the canonical domain. Commit/push approval does not authorize deployment.
