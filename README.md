# FILLOUT IMMIGRATION FORMS

An Expo / React Native app for exploring immigration forms, with a small GitHub Pages website. The native app and browser preview share the same React Native screens and reviewed form data.

- Website deployment target: **https://coortgroup.github.io/immigration_eagle/**
- Browser app: **https://coortgroup.github.io/immigration_eagle/app/**
- Repository: https://github.com/coortgroup/immigration_eagle
- Expo project: https://expo.dev/accounts/coortgroup/projects/immigration-eagle
- [Open the published SDK 57 preview in Expo Go](https://expo.dev/preview/update/expo-go?projectId=9fc8959b-6ce7-436b-b512-8d0f7fe2e081&group=5d93a2e2-41ab-4e42-b329-74c4b135189f)

The Expo preview is hosted by EAS Update and works without a running Mac or a shared Wi-Fi network. Sign in as `coortgroup` in Expo Go and on Expo's launch page if asked. This is an update under the Expo project's `preview` branch, not a signed iOS build under Builds. See the repository Actions tab for website deployment status.

## Review locally

```sh
npm ci
npm run local
```

- Website: **http://127.0.0.1:4177/immigration_eagle/**
- App: **http://127.0.0.1:4177/immigration_eagle/app/**
- Local team inbox: **http://127.0.0.1:4177/local-inbox/**

This local server lets contact and attorney requests be saved and viewed on this Mac. It accepts loopback connections only, sends no email or external notification, and stores requests in the Git-ignored `.local/requests.json`. Use sample details. The static GitHub Pages build does not expose this server or its inbox. See [local review guide](docs/LOCAL_REVIEW.md).

## Run the Expo app

Requires Node.js 22.14+ and npm.

```sh
npm ci
npx expo login
npm start -- --go
```

Scan the QR code with **Expo Go for SDK 57**. On a physical iPhone, Expo Go and the Mac's Expo CLI must be signed in to the **same Expo account**. For a phone on another network, use `npm run start:remote`. For remote Mac authentication, use `npx eas-cli login --device` and complete Expo's sign-in in your phone's browser. See [Expo's compatibility instructions](https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/) and [iPhone sign-in requirement](https://docs.expo.dev/troubleshooting/expo-go-sign-in-required/).

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
- Introductory guided interviews, editable answer review, explicit device saves and resumable drafts in My Application.
- Attorney/contact intake with validation, review, local inbox delivery and visible receipts; minimal FILLOUT AI chat with clearly labeled example responses.
- Responsive static website with the shared 21-form finder and prices, direct form links, and an automatic GitHub Pages deployment workflow.

## Preview limits

This is an initial implementation, not a production immigration service. Live AI, full USCIS PDF generation, payments, accounts, cloud storage, external attorney intake delivery, shipping and government filing are not connected. Use sample information when evaluating it. Unsaved answers and chat stay in memory. Explicitly saved drafts persist on the device/browser until removed. On the local website, requests submitted after review are sent only to the loopback server and saved in its local inbox. Static GitHub Pages and Expo Go remain request-preview-only until a production delivery service is configured.

The form check is preliminary and does not determine legal eligibility or guarantee USCIS approval. Exceptions and uncertain cases go to review. TPS/DACA paths require individual review. Form rules, service scopes and displayed business claims need legal/product validation before a public service launch. Pricing is the approved design data, not an active checkout.

The project uses SDK 57, with unresolved audit findings in its dependency tree. The static exported website has no server-side document/CSS upload processor; do not use this starter as a production upload/processing backend. The icon tool uses the patched sharp release. Reassess dependencies and use a signed development build before a production release.

## GitHub Pages

`.github/workflows/pages.yml` builds and deploys on pushes to `main` and manual runs. Repository **Settings → Pages → Source** must be **GitHub Actions**. The workflow uses the repository's name as the Expo web base path.

After authenticating with `gh auth login`, an administrator can configure Pages and the About link:

```sh
gh repo edit coortgroup/immigration_eagle --homepage https://coortgroup.github.io/immigration_eagle/ --description "FILLOUT IMMIGRATION FORMS — Expo app and immigration form preparation preview"
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
- `server/` — loopback-only request API and local team inbox
- `prototype/`, `preview/` — earlier interactive design, retained as reference
- [Prototype notes](docs/PROTOTYPE.md) — design decisions and source history

Run `npm run icons` to regenerate platform assets from the existing transparent eagle artwork. No redesign is applied.
