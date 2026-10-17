# FillOut

Unreleased local source **0.8.0** adds a per-application AI payment gate after a passed form check. Existing paid applications reopen without another charge. RevenueCat/native checkout and Supabase verification are implemented and disabled until store products, credentials and sandbox acceptance are configured. No payment deployment or new TestFlight release is implied. See [payment activation](docs/PAYMENTS_IMPLEMENTATION.md).

Latest internal TestFlight release: **0.7.0 (9)**, verified on October 12, 2026. It adds guided questionnaires for all 21 forms, mandatory human review of FillOut submissions, account/data deletion and operator inboxes. Apple confirms `VALID`, `IN_BETA_TESTING`, and not expired. The backend, hosted acceptance and signed IPA checks passed; physical-iPhone testing and owner operator activation remain open. [Open TestFlight in App Store Connect](https://appstoreconnect.apple.com/apps/6821241435/testflight/ios). See [release evidence](docs/RELEASE.md#fillout-070--guided-forms-review-and-account-deletion).

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

## Languages and app name

The launcher name is **FillOut**. The app and public website support English and Russian. Use the globe at the top right of Home to switch; the choice is saved on the device (`fillout.language`). Web links can set `?lang=en` or `?lang=ru`, and the website carries the language into the app. Switching languages preserves current answers and saved drafts.

Translations are in `data/locales/ru-*.json`; `src/i18n.ts` formats product text while identifiers and user input remain unchanged. Official USCIS PDF pages and their source field tooltips stay in English; the editor controls and guided explanations are localized. Run `npm run test:i18n` for language persistence, translation coverage and user-input preservation checks. Launcher-name changes require a new installed native build.

## Release update — October 12, 2026

Version 0.7.0 adds guided official-field questionnaires for all 21 forms, mandatory human review of FillOut submissions, in-app account/data deletion, and an operator inbox for personal replies. The three new migrations and functions are deployed and verified on the existing backend, and **0.7.0 (9)** is available for internal TestFlight testing. Operator activation still requires the owner's confirmed FillOut account email. This release does not publish the website or Expo Go preview.

## What is implemented

- Native React Native components, three persistent tabs, accessible controls and Android back handling.
- Navy/gold eagle branding, opaque 1024px app icon, Android adaptive icon, splash artwork and favicon.
- A catalog of 21 forms, status/goal finder, and free / FillOut / attorney preparation choices with whole-dollar prices.
- Form-specific preliminary yes/no checks, stop/review/pass outcomes, and correction of previous answers.
- Free self-preparation opens an in-app PDF editor automatically after a passed form check. Fill fields on the official pages, save an editable PDF, or print the current filled copy. The editor and blank templates are bundled locally; answers are not uploaded.
- Form preparation opens under My Application. Its bottom tab saves and returns to the application list. The compact PDF toolbar keeps actions in one row, uses automatic page fit, and has a dismissible help notice. Drafts save automatically from the first answer; progress and resume follow the current form and account.
- Guided preparation for all 21 forms. Completed FillOut questionnaires are sent, with consent, to the team for mandatory review. The private server releases the exact submitted PDF only after approval; correction requests and new submissions require a new review. Status and approved downloads are available in My Application. See [review workflow](supabase/FORM_REVIEW.md). I-90 keeps its reviewed conditional interview and static print output. The other 20 use source-backed official-field questions, explicit PDF mappings, page references, answer review and editable filled PDFs. Known source conditions hide inapplicable branches; the full official instructions remain necessary. Old introductory drafts remain readable and can continue into the full questionnaire. See [PDF coverage](docs/PDF_IMPLEMENTATION.md).
- Guest profiles, optional email/password registration, email-code recovery, profile editing, persistent sign-in and mandatory login after logout. Native sessions use SecureStore; draft storage is scoped to the account and guest drafts transfer to the first verified account on the device.
- Account/data deletion with email re-verification, explicit confirmation, server cascades, resumable cleanup and protection against stale editor writes. Guest deletion works locally. See [deletion deployment and scope](supabase/ACCOUNT_DELETION.md).
- Authorized operators can open Client messages in Chat, view customer conversations and send personal team replies. Membership is assigned only through the service administrator. The owner’s account email is still needed for activation.
- Attorney intake with validation, review, local inbox delivery and visible receipts. Chat is a human conversation with the FillOut team, backed by an optional Supabase service; it has no automated replies. See [Chat setup and reply workflow](supabase/SUPPORT_CHAT.md).
- Responsive static website with the shared 21-form finder and prices, direct form links, and an automatic GitHub Pages deployment workflow.

## Preview limits

This is an initial implementation, not a production immigration service. The default preview has no configured cloud accounts, live Chat/intake, payments, shipping or government filing. Guest profiles and local form preparation work without a server; registration, Chat and submission for review display their connection requirement until configured. Guided downloads and printing require server approval; there is no offline bypass. Draft answers, including preliminary checks, guided questions for every form and manual PDF fields, save automatically on the device/browser until removed. Continue application opens the next unanswered question; attorney drafts show an inline, non-interactive tracker (Awaiting a call → Preparing document package → Sent). New attorney drafts start at Awaiting a call; sending an intake request does not advance the package status. On the local website, requests submitted after review go to the loopback server and its local inbox.

Supabase email/password and email-code authentication, cloud contact/attorney intake, and human support Chat are implemented on the existing `fillout-staging` project. All migrations through `20261011000400` are recorded as applied; `delete-account`, `support-inbox` and `form-review` are active alongside Chat. The EAS production environment supplies that project's public client configuration. In addition to the earlier 13 Auth/Chat checks, hosted acceptance on October 12 passed 13 grouped checks for the review lifecycle, exact approved PDFs, operator replies/revocation, deletion cascades, retries and account isolation. All three synthetic users, their records and deletion receipts were removed; no email was sent or real operator granted. See [staging results](docs/SUPABASE_STAGING.md) and [cloud setup](supabase/README.md). Cloud requests return a receipt only after storage; this does not mean an email was sent or an attorney was booked.

Copy `.env.example` to `.env.local` only for public build-time configuration. Never put a Supabase secret/service-role key or an OpenAI key in Expo environment variables. An unconfigured local build retains guest profiles and local preparation. Chat uses the FillOut team service and does not require the legacy live-AI flag or an AI provider. `npm run test:cloud` runs SQL migration/RLS checks in embedded PostgreSQL plus client contracts; `npm run test:accounts` covers persistent account storage and draft isolation. Hosted Auth/Chat acceptance and the earlier SMTP delivery check are recorded separately from device and release verification. [Launch readiness](docs/LAUNCH_READINESS.md), [PDF implementation coverage](docs/PDF_IMPLEMENTATION.md) and [payment implementation decisions](docs/PAYMENTS_IMPLEMENTATION.md) distinguish completed work, engineering gaps and required owner input.

Saved drafts use account-scoped AsyncStorage on this device, without application-level encryption or cross-device sync. Signing in keeps the session until logout; it does not upload drafts. Choosing Send for review uploads the completed PDF and an immutable answer snapshot to the private team service. Approved files can be opened from another signed-in device; editable drafts remain local. Native auth tokens and account policy use Keychain/Keystore through SecureStore, while web sessions use browser storage. Account/data deletion is deployed and passed hosted synthetic acceptance; exported PDFs and drafts on other devices are outside its device-local cleanup. Production retention and backup policy still need an owner decision.

The form check is preliminary and does not determine legal eligibility or guarantee USCIS approval. Exceptions and uncertain cases go to review. TPS/DACA paths require individual review. Form rules, service scopes and displayed business claims need legal/product validation before a public service launch. Catalog pricing is the approved design data; the native payment gate fetches the actual localized store price when configured. Billing remains disabled in the current setup.

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

The latest release is **0.7.0 (9)**, available for internal testing as confirmed by Apple on October 12, 2026. External state is `READY_FOR_BETA_SUBMISSION`; this release has not been submitted for external beta review. See [current release evidence and testing instructions](docs/RELEASE.md#fillout-070--guided-forms-review-and-account-deletion). Earlier releases are recorded below.

Version **0.2.0 (3)**, including the redesigned homepage, is available for internal testing in [TestFlight / App Store Connect](https://appstoreconnect.apple.com/apps/6821241435/testflight). On October 10, 2026, the signed [EAS iOS build](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/builds/5425b130-5c8f-41ba-ad7c-856141f50bc1) and [Apple submission](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/submissions/d1f15da4-6a34-4743-b4c2-7d1c3afda78f) finished successfully; Apple reports `VALID`, `IN_BETA_TESTING`, and `expired: false`. Internal access is configured through **Team (Expo)**. External testing still requires Apple's beta review; this is not a public App Store release.

See [release instructions](docs/RELEASE.md) for the configured app, future builds and what to test. `eas.json` includes development, simulator, preview and production profiles. EAS manages the real signing credentials; private keys are not committed. The TestFlight version has the preview limits described above, and installation on a physical iPhone still needs tester confirmation.

The compact mobile layout update **0.2.0 (4)** has also been [built](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/builds/a4e34075-7b36-426c-8a77-64fdda8a286d) and [uploaded to Apple](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/submissions/4df98b30-31bc-4076-94d8-d01d0facf996). Apple now confirms it is available for internal TestFlight testing. It includes the smaller header logo, full-bleed banners, compact cards/footer, a centered AI welcome screen, and a price-free form list in My Application. The hosted website and Expo Go preview have not been republished with these changes.

The I-90 PDF update **0.3.0 (5)** has been [built](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/builds/3efeecab-dd4f-43e2-bf66-b87aa13797b8) and [uploaded to Apple](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/submissions/bae3094d-45f0-41ed-9e56-b743631468a6); Apple confirms it is available for internal TestFlight testing (`VALID`, `IN_BETA_TESTING`, not expired). It adds full I-90 questions and a filled official print PDF; the other 20 documents are not complete PDF interviews. See [release evidence and limitations](docs/RELEASE.md) and run `npm run test:pdf` for the new checks.

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

The free PDF editor update **0.4.0 (6)** is published on [fillout.net](https://fillout.net/) and available for internal testing in [TestFlight](https://appstoreconnect.apple.com/apps/6821241435/testflight). [Website deployment](https://github.com/coortgroup/immigration_eagle/actions/runs/38075792566), [iOS build](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/builds/43186557-ccaa-4bfc-b84c-9d87c98af0b3), and [submission](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/submissions/afd6b0f0-69d7-405e-9e2c-7ddbd64c70f4) succeeded; Apple confirmed `VALID` and `IN_BETA_TESTING`. After a passed free check, users can fill PDF fields, save an editable copy, and print the current filled document. Production browser checks passed; physical-device save/share and AirPrint still need verification. See [release evidence](docs/RELEASE.md).
