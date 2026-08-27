# CityVUE

CityVUE is an internal development prototype for a vendor-neutral resident-engagement platform. It provides a browser-based experience for reporting community issues, reviewing and managing locally stored requests, and viewing issue statistics.

CityVUE is intended to remain independent of any one enterprise asset management (EAM) vendor. Future integrations may include VUEWorks, Cityworks, Cartegraph, MGO, VistaShare, or other City systems, but no EAM integration is currently implemented.

## Current status

The current application is a front-end MVP. It supports issue creation, editing, deletion, search, filtering, sorting, dashboard statistics, charts, toast notifications, and dark mode.

Issue data is stored only in the browser's `localStorage`. It is not shared across browsers or devices and must not be treated as an authoritative City record. The prototype currently has no authentication, authorization, CityVUE API, Firebase database, or EAM integration.

## Technology stack

- HTML5 and JavaScript ES modules; no front-end framework
- Parcel 2 for local development and production bundling
- Bootstrap 5 and Bootstrap Icons
- Chart.js for dashboard charts
- Browser `localStorage` for prototype persistence
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

Copy `.env.example` to `.env` and provide the Firebase web configuration for the appropriate approved environment. Do not commit `.env` or place privileged server or enterprise credentials in browser configuration.

Start the Parcel development server:

```powershell
npm start
```

The explicit legacy alias runs the same working MVP:

```powershell
npm run legacy:start
```

## Build

Create the production bundle in the ignored `dist` directory:

```powershell
npm run build
```

`npm run legacy:build` is an explicit alias for the same Parcel build. During the parallel migration, `npm run build` remains the validated legacy/deployment build.

## Parallel React/Vite shell

Stage 1 includes an isolated React/Vite technical shell under `react/`. It does not replace or migrate the working Parcel MVP.

Start the React development application:

```powershell
npm run react:start
```

Create its production bundle in the separately ignored `dist-react` directory:

```powershell
npm run react:build
```

Preview the built React shell locally:

```powershell
npm run react:preview
```

The React shell currently demonstrates only the root and not-found routes. Report Issue, Issue List, Dashboard, and other MVP workflows remain exclusively in the Parcel application.

## Automated tests

Run the framework-independent Node regression suite:

```powershell
npm test
```

These tests remain independent of React and Vite.

## Firebase Hosting emulator

Serve the configured Hosting output through the Firebase emulator:

```powershell
npm run serve
```

Run `npm run build` first when `dist` does not contain a current production bundle. This command uses the Firebase Hosting configuration but does not deploy the application.

## Deployment

The deployment script builds the application and deploys `dist` to the Firebase project selected by the repository's existing Firebase configuration:

```powershell
npm run deploy
```

Run deployment only with explicit authorization, an authenticated Firebase CLI session, and the correct approved project access. Firebase Hosting currently serves the static front end; it is not being used as the application's database, authentication provider, or API layer.

## Project guidance

Read these documents before significant work:

- `AGENTS.md`
- `docs/CITYVUE_CONTEXT.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`

The canonical development name is **CityVUE**. Vendor-specific schemas and integration behavior must remain outside the core CityVUE domain model.
