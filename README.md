# Immigration Eagle

An Expo / React Native app for exploring immigration forms, with a small GitHub Pages website. The native app and browser preview share the same React Native screens and reviewed form data.

- Website deployment target: **https://coortgroup.github.io/immigration_eagle/**
- Browser app: **https://coortgroup.github.io/immigration_eagle/app/**
- Repository: https://github.com/coortgroup/immigration_eagle

These addresses become live after the Pages workflow successfully deploys. See the repository Actions tab for deployment status.

## Run locally

Requires Node.js 22.14+ and npm.

```sh
npm ci
npm start -- --go
```

Scan the QR code with Expo Go. This project deliberately uses **Expo SDK 54** for compatibility with the current Apple App Store version of Expo Go. See [Expo's current compatibility instructions](https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/). Depending on your installed version, Expo Go may require signing in to the same Expo account as the development server.

```sh
npm run web                 # React Native web development
npm run ios                 # Open in an installed iOS Simulator
npm run android             # Open on Android
npm run ios:build           # Compile a native iOS development build with Xcode
```

An iOS Simulator/native build requires Xcode's license and initial setup, an installed iOS runtime, and CocoaPods. An Expo JavaScript export is not a signed iOS binary.

## Build and verify

```sh
npm run typecheck
npm test
npm run doctor
npm run export:native       # Bundle iOS + Android JavaScript/assets
npm run build               # Export web app, assemble website + app into site/
npm run preview:site
```

Open **http://127.0.0.1:4176/immigration_eagle/**. This preview uses the same subpath as GitHub Pages, including the `/app/` asset paths.

## What is implemented

- Native React Native components, three persistent tabs, accessible controls and Android back handling.
- Navy/gold eagle branding, opaque 1024px app icon, Android adaptive icon, splash artwork and favicon.
- A catalog of 21 forms, status/goal finder, and free / AI / attorney preparation choices with whole-dollar prices.
- Form-specific preliminary yes/no checks, stop/review/pass outcomes, and correction of previous answers.
- Direct links to official fillable USCIS PDFs for self-preparation.
- Introductory guided interviews, editable answer review and a session-only draft summary.
- Attorney/contact intake with validation and local review; minimal Eagle AI chat with clearly labeled example responses.
- Responsive static website and automatic GitHub Pages deployment workflow.

## Preview limits

This is an initial implementation, not a production immigration service. Live AI, full USCIS PDF generation, payments, accounts, durable storage, actual attorney intake delivery, shipping and government filing are not connected. Use sample information when evaluating it. Answers and contacts stay in memory and disappear on reload/app restart; they are not transmitted to a server.

The form check is preliminary and does not determine legal eligibility or guarantee USCIS approval. Exceptions and uncertain cases go to review. TPS/DACA paths require individual review. Form rules, service scopes and displayed business claims need legal/product validation before a public service launch. Pricing is the approved design data, not an active checkout.

SDK 54 keeps the easy Expo Go path, but its build-tool dependency tree has unresolved audit findings. The static exported website has no server-side document/CSS upload processor; do not use this starter as a production upload/processing backend. The icon tool was updated to the patched sharp release. Reassess dependencies and move to a supported development-build SDK before a production release.

## GitHub Pages

`.github/workflows/pages.yml` builds and deploys on pushes to `main` and manual runs. Repository **Settings → Pages → Source** must be **GitHub Actions**. The workflow uses the repository's name as the Expo web base path.

After authenticating with `gh auth login`, an administrator can configure Pages and the About link:

```sh
gh repo edit coortgroup/immigration_eagle --homepage https://coortgroup.github.io/immigration_eagle/ --description "Immigration Eagle — Expo app and immigration form preparation preview"
gh api --method POST repos/coortgroup/immigration_eagle/pages -f build_type=workflow
gh workflow run pages.yml --repo coortgroup/immigration_eagle
```

If Pages already exists, use `PUT` instead of `POST` to update its build type. Confirm the workflow's successful deployment before sharing the URL as live.

## TestFlight later

See [release instructions](docs/RELEASE.md). `eas.json` includes development, simulator, preview and production profiles. No Expo project ID or Apple credentials are invented or committed. TestFlight requires your Expo project, Apple Developer membership, App Store Connect record, signing credentials and an actual successful iOS build.

## Source map

- `App.tsx`, `src/` — native app and shared web UI
- `app.config.ts`, `eas.json` — app identity, icons, native/cloud build configuration
- `data/` — form catalog, preliminary checks, interview schemas and source/pricing records
- `web/` — public landing page
- `scripts/` — builds, asset generation, local preview and checks
- `prototype/`, `preview/` — earlier interactive design, retained as reference
- [Prototype notes](docs/PROTOTYPE.md) — design decisions and source history

Run `npm run icons` to regenerate platform assets from the existing transparent eagle artwork. No redesign is applied.
