# FILLOUT IMMIGRATION FORMS

An Expo / React Native app for exploring immigration forms, with a small GitHub Pages website. The native app and browser preview share the same React Native screens and reviewed form data.

- Website: **https://fillout.net/**
- Browser app: **https://fillout.net/app/**
- Repository: https://github.com/coortgroup/immigration_eagle
- Expo project: https://expo.dev/accounts/coortgroup/projects/immigration-eagle
- [Open the published SDK 57 preview in Expo Go](https://expo.dev/preview/update/expo-go?projectId=9fc8959b-6ce7-436b-b512-8d0f7fe2e081&group=ecf20fd0-3512-4f5d-8476-32c93ccdafa6)

The custom domain is live with a valid HTTPS certificate and **Enforce HTTPS** enabled. The website and `/app/` load securely, HTTP redirects to HTTPS, and the website-to-app form link has been verified in a browser. See [custom domain setup](docs/CUSTOM_DOMAIN.md).

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

Open **http://127.0.0.1:4176/immigration_eagle/**. This preview uses the default GitHub project subpath. For the custom domain's root layout, build and preview with `PAGES_BASE_PATH=''` as described in [custom domain setup](docs/CUSTOM_DOMAIN.md).

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

This is an initial implementation, not a production immigration service. The published preview has no live AI, cloud accounts/intake, full USCIS PDF generation, payments, shipping or government filing. Use sample information when evaluating it. Unsaved answers and chat stay in memory. Explicitly saved drafts persist on the device/browser until removed. On the local website, requests submitted after review go to the loopback server and its local inbox.

The source includes optional Supabase email-code authentication, cloud contact/attorney intake, and an OpenAI-backed general-information chat. The staging database and both Edge Functions are deployed; custom SMTP and code templates are configured, and Resend confirmed delivery of one authorized test email. Published clients have not been connected to this staging project. Verified-user sign-in, two-user isolation and authenticated request acceptance tests remain open, and no live AI-provider call has been made. See [staging results](docs/SUPABASE_STAGING.md) and [cloud setup](supabase/README.md). The cloud request flow verifies email, asks for explicit submission, and returns a server receipt only after storage. A receipt does not mean an email was sent or an attorney was booked. The AI chat is separate from the introductory form interviews and cannot fill or file a USCIS PDF.

Copy `.env.example` to `.env.local` only for public build-time configuration. Never put a Supabase secret/service-role key or an OpenAI key in Expo environment variables. The default unconfigured app keeps its existing local/demo behavior. `npm run test:cloud` runs the actual SQL migration/RLS checks in embedded PostgreSQL plus client and mocked-provider contract tests. Hosted schema, unauthenticated gateway boundaries and SMTP delivery are verified; successful authenticated workflows and provider acceptance still require testing. [Launch readiness](docs/LAUNCH_READINESS.md), [PDF implementation coverage](docs/PDF_IMPLEMENTATION.md) and [payment implementation decisions](docs/PAYMENTS_IMPLEMENTATION.md) distinguish completed work, engineering gaps and required owner input.

Saved drafts currently use device-wide AsyncStorage, without application-level encryption or account-scoped storage. Use synthetic information in this preview. Review and implement the production storage, retention and account-deletion design before collecting customer immigration data.

The form check is preliminary and does not determine legal eligibility or guarantee USCIS approval. Exceptions and uncertain cases go to review. TPS/DACA paths require individual review. Form rules, service scopes and displayed business claims need legal/product validation before a public service launch. Pricing is the approved design data, not an active checkout.

The project uses SDK 57, with unresolved audit findings in its build/development dependency tree. An `xcode → uuid` override targets the patched `11.1.1` release; the final installed audit and build results determine its verified status. Remaining `braces` and `node-forge` findings need release-specific reachability review. The static exported website has no server-side document/CSS upload processor; do not use this starter as a production upload/processing backend. The icon tool uses the patched sharp release. Reassess dependencies and test the signed build before a production release.

## GitHub Pages

`.github/workflows/pages.yml` builds and deploys on pushes to `main` and manual runs. Repository **Settings → Pages → Source** must be **GitHub Actions**. The workflow reads the configured Pages URL before building, so Expo assets work at either `/immigration_eagle/app/` on the default address or `/app/` on a custom domain.

The custom domain **fillout.net** is saved in GitHub Pages. DNS validation, the deployment with Expo assets under `/app/`, certificate issuance, HTTPS enforcement, and live website/app checks have completed. See [custom domain setup](docs/CUSTOM_DOMAIN.md).

After authenticating with `gh auth login`, an administrator can configure Pages and the About link:

```sh
gh repo edit coortgroup/immigration_eagle --homepage https://fillout.net/ --description "FILLOUT IMMIGRATION FORMS — Expo app and immigration form preparation preview"
gh api --method POST repos/coortgroup/immigration_eagle/pages -f build_type=workflow
gh workflow run pages.yml --repo coortgroup/immigration_eagle
```

If Pages already exists, use `PUT` instead of `POST` to update its build type. Confirm the workflow's successful deployment before sharing the URL as live.

## TestFlight

Version **0.2.0 (3)**, including the redesigned homepage, is available for internal testing in [TestFlight / App Store Connect](https://appstoreconnect.apple.com/apps/6821241435/testflight). On October 10, 2026, the signed [EAS iOS build](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/builds/5425b130-5c8f-41ba-ad7c-856141f50bc1) and [Apple submission](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/submissions/d1f15da4-6a34-4743-b4c2-7d1c3afda78f) finished successfully; Apple reports `VALID`, `IN_BETA_TESTING`, and `expired: false`. Internal access is configured through **Team (Expo)**. External testing still requires Apple's beta review; this is not a public App Store release.

See [release instructions](docs/RELEASE.md) for the configured app, future builds and what to test. `eas.json` includes development, simulator, preview and production profiles. EAS manages the real signing credentials; private keys are not committed. The TestFlight version has the preview limits described above, and installation on a physical iPhone still needs tester confirmation.

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
