# Device and TestFlight testing

## App Store 1.0.0 status — October 24, 2026

Release source is `11c3391c9d5edfe645acf075e9284d6bec534968`. **Build 1.0.0 (13)** is `VALID`, attached to the draft App Store version and available for beta testing. **Build 12 is superseded and must not be selected for submission.** All 8 public screenshots are `COMPLETE`; all 14 In-App Purchases are `READY_TO_SUBMIT`. The app remains `PREPARE_FOR_SUBMISSION`. Nothing in these checks confirms an App Review submission, approval or public App Store release.

The production EAS profile uses the `production` channel, native purchases enabled and `EXPO_PUBLIC_PAYMENT_TEST_BUILD=false`. The website/browser app is live with all 21 forms, 63 preparation columns and restored FillOut/attorney prices. Pages run `39056860863` succeeded for this source, and live HTML/assets, the new browser bundle and six policy URLs were verified. Evidence: `tmp/web-launch-restored-prices-live-verification.json`, `tmp/app-store-launch-audit.json`, and `tmp/app-store-metadata/corrected-release-assets-result.json`.

App Privacy is still unpublished, and the Mac App Store Connect session has expired. Account Holder, Admin or App Manager can complete the privacy declaration after sign-in. The **first app version and all 14 IAPs must be submitted together through the App Store Connect UI**. [Apple's API guide](https://developer.apple.com/documentation/appstoreconnectapi/managing-in-app-purchases) expressly excludes the first submission from the review-submission API; [the UI instructions](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-in-app-purchase/) describe adding the version and purchases to the same submission. The October 24 readback at 18:33:55 UTC confirmed free download (USD 0), USA-only availability, automatic new-country availability disabled and no pre-order. Category `PRODUCTIVITY` and content rights `USES_THIRD_PARTY_CONTENT` are confirmed. Evidence: `tmp/release-launch/readiness-summary.json`. No fresh Business, paid-agreement, tax or bank status is asserted here.

The owner confirmed `peoplechat2@gmail.com` for public support/privacy contact and their FillOut operator account. This change includes that contact on all six EN/RU policy pages; publication runs through GitHub Pages, and actual delivery is verified separately. The exact account was absent in the October 24 check; registration and email verification must precede an operator grant. The October 24 hosted operations check found two active sandbox purchases, zero production purchases, no form review submissions or approvals, and zero operators. The in-app operator role covers Chat and form reviews; attorney requests are handled separately through Supabase Dashboard → `public.requests` using existing project access. Evidence: `tmp/launch-operations/owner-operator-check.json`. See [launch readiness](LAUNCH_READINESS.md) and [App Privacy selections](APP_PRIVACY_DECLARATION.md).

The current OTA for installed TestFlight 0.8.0 (11) is update `01a14b0e-7e30-76ff-9013-ff58061ec33d`, group `193a48df-6eb1-4386-9f0d-9f84fdf32524`, runtime `0.8.0`, published October 17 at 18:10 UTC. It restores all three price columns and includes the payment-environment fix. Installation on the specific iPhone is not independently verified; it does not replace native build 1.0.0 (13).

### Historical preparation and backend evidence — October 17, 2026

The installed TestFlight 0.8.0 (11) remains a separate runtime. Its earlier compatibility update `01a14afe-2cb7-70ea-8e7b-622d47b3438a` (group `1c4fa112-ad2b-45a4-a053-8db65a7911bf`) was published and read back at 17:52 UTC on `payments-sandbox`. It includes the revised profile, free attorney contact request with explicit consent, and isolated sandbox review records. It was superseded by the 18:10 UTC OTA above. Subsequent pricing restoration is included in release source `11c3391` and the live website.

The existing Supabase project accepts production purchases and verified App Store sandbox purchases in separate environments. Both October 17 migrations and the four affected functions were deployed. RevenueCat's signed webhook accepts both environments; its provider-generated `TEST` event returned HTTP 200 with `received=true,test=true`. Hosted checks before and after cutover verified unpaid denial, reservations/cancellation, authentication and account isolation. This technical test did not purchase a product or grant paid access. The genuine October 17 TestFlight purchase remains recorded in sandbox; reopening, restoration and refund on the owner's phone still need confirmation. No commercial production transaction has been verified.

The full application test suite, all 21 PDF templates (5,226 editable fields), guided PDF round trips, TypeScript, localization and fresh website build passed. The free-flow test checks the G-639 official online route and direct free attorney intake. The dependency audit still reports toolchain findings; bounded inspection found no affected operation reachable from application runtime and does not claim a clean security audit.

## Expo Go now

1. `npm ci`
2. `npx expo login`, then sign in to the same account in Expo Go on the phone.
3. `npm start -- --go`
4. Open the QR code in Expo Go for **SDK 57**. For a physical iPhone, both the SDK version and the signed-in account must match. The computer and phone should share a network; use the remote tunnel flow below when that is not possible.

The custom launcher icon/splash belong to a built app. Expo Go runs this project inside the Expo Go container; it does not replace the Expo Go home-screen icon.

## Remote Expo Go testing

When the phone is on a different network from the Mac:

```sh
npm run start:remote
```

First sign in on both devices. If the Mac is being controlled remotely, run `npx eas-cli login --device` and complete the displayed Expo sign-in URL on the phone. Keep passwords and access tokens out of chat and Git. The remote launcher checks the Mac's account before starting, because an anonymous tunnel can return HTTP 200 while still being rejected by iPhone Expo Go.

This starts an Expo tunnel on port 8082 and prints a public Expo Go link and QR code. Open that link on the phone with Expo Go installed and signed in to the same account. The tunnel uses a generated `exp.direct` hostname; a fixed public IP is not required. The Mac, Metro server and tunnel must stay running and connected to the internet. Stop the session with Ctrl+C. To choose another local port, use `npm run start:remote -- 8083`.

A tunnel is a development server, not an EAS cloud build. It does not create a build entry in the Expo dashboard. See [Expo's current iPhone sign-in rules](https://docs.expo.dev/troubleshooting/expo-go-sign-in-required/).

The launcher skips an incomplete local Android SDK for this process only because remote Expo Go does not require ADB. It does not modify the SDK or shell settings. The local team inbox is not exposed through this tunnel; contact delivery in the native preview remains unconnected.

## Expo-hosted preview

An EAS Update can host this app's JavaScript and assets for Expo Go without keeping the Mac running. This is a published preview, not an Apple-signed app or an entry under EAS Builds. The project uses Expo Go-compatible libraries and SDK 57.

The project is now linked to [@coortgroup/immigration-eagle](https://expo.dev/accounts/coortgroup/projects/immigration-eagle), ID `9fc8959b-6ce7-436b-b512-8d0f7fe2e081`. The current published preview group is `ecf20fd0-3512-4f5d-8476-32c93ccdafa6`: [open in Expo Go](https://expo.dev/preview/update/expo-go?projectId=9fc8959b-6ce7-436b-b512-8d0f7fe2e081&group=ecf20fd0-3512-4f5d-8476-32c93ccdafa6). Sign in to Expo Go as `coortgroup`; Expo requires authorized account access to this preview. The hosted iOS and Android manifests identify SDK 57, and the downloaded bundles, icon artwork and font match their SHA-256 hashes. Physical phone testing still needs confirmation on the device.

For subsequent updates, preserve the project configuration and run step 4 below. Steps 1–3 describe the initial setup and recovery on another computer:

1. Sign in with `npx eas-cli@latest login --device` (or `npx expo login`).
2. Create or link the project with `npx eas-cli@latest init --account YOUR_EXPO_ACCOUNT --non-interactive --json`.
3. Preserve the returned project ID in `app.config.ts`: set `owner` to the authenticated account, `extra.eas.projectId` to that ID, `updates.url` to `https://u.expo.dev/PROJECT_ID`, and `runtimeVersion` to `{policy:'appVersion'}`. Keep the existing `extra` fields. Dynamic TypeScript config may need these changes applied manually. The `expo-updates` dependency is already installed.
4. Publish with `npm run eas:preview -- --message "FILLOUT IMMIGRATION FORMS SDK 57 preview" --non-interactive --json`.
5. Use the actual project and update-group IDs returned by Expo at `https://qr.expo.dev/eas-update?projectId=PROJECT_ID&groupId=GROUP_ID`. Omit the `slug` parameter to target Expo Go. Appending `&format=url` returns the corresponding direct app link. Verify on a physical phone before reporting device testing as complete.

Publishing needs an authenticated Expo account and a real linked project. Merely installing the dependency or running a local bundle export does not publish an update. The SDK 57 preview continues to have the feature limits documented in the README.

References: [EAS Update](https://docs.expo.dev/eas-update/introduction/), [Expo preview QR codes](https://docs.expo.dev/more/qr-codes/).

## Local Xcode build

The Apple/Xcode license must be reviewed and accepted by the user. After Xcode's first-run setup and installation of an iOS Simulator runtime:

```sh
npm run ios:build
```

Expo generates `ios/`, installs pods and compiles the development app. The generated native directories are ignored; `app.config.ts` is the source of truth. CocoaPods or the iOS runtime may require additional downloads. Device signing requires a development team.

## EAS development build

```sh
npx eas-cli login
npx eas-cli init
npm run eas:development
```

`eas init` links the real Expo project. Preserve its resulting project ID. Do not put account passwords, API keys, signing certificates or provisioning profiles into Git. The `simulator` profile builds an unsigned simulator target; use `npx eas-cli build --platform ios --profile simulator` when needed.

After installing the development build, use `npm start -- --dev-client`.

## TestFlight

The bundle ID `com.coortgroup.immigrationeagle` is registered, its distribution certificate and provisioning profile are active, and the app record is [FILLOUT IMMIGRATION FORMS in App Store Connect](https://appstoreconnect.apple.com/apps/6821241435/testflight). The verified app ID is saved in `submit.production.ios.ascAppId`. EAS manages the signing credentials and an App Store Connect API key with the App Manager role; no private signing files or key material belong in this repository. Internal testing uses the **Team (Expo)** group.

The first signed release, **0.1.0 (2)**, was verified on October 10, 2026 (America/New_York): [EAS build](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/builds/8b476f1d-652c-4d2a-a850-3ed4f3da0a6d) and [submission](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/submissions/61bd8a68-15db-41a0-9108-9eb7b8e3b370) are both `FINISHED`; Apple reports processing state `VALID`, internal state `IN_BETA_TESTING`, and `expired: false`. External state is `READY_FOR_BETA_SUBMISSION`: external beta review and a public App Store release have not been requested. A tester must still confirm installation and behavior on a physical device.

The first redesigned release was **0.2.0 (3)**: [EAS build](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/builds/5425b130-5c8f-41ba-ad7c-856141f50bc1) and [submission](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/submissions/d1f15da4-6a34-4743-b4c2-7d1c3afda78f) both finished successfully. Apple confirmed `VALID`, `IN_BETA_TESTING`, and `expired: false` on October 10, 2026. The runtime is `0.2.0`, so this native-dependency update is isolated from the previous `0.1.0` app. The production and preview EAS environments currently contain no public backend configuration: both releases remain sample-data previews. The Expo Go iOS manifest published with that release reports SDK 57 and runtime `0.2.0`; the launch bundle and five assets were downloaded using the manifest-provided asset headers and their SHA-256 hashes verified.

The mobile layout update **0.2.0 (4)** was built and uploaded on October 10, 2026: [EAS build](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/builds/a4e34075-7b36-426c-8a77-64fdda8a286d) and [submission](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/submissions/4df98b30-31bc-4076-94d8-d01d0facf996) are `FINISHED`. Apple now confirms `VALID`, `IN_BETA_TESTING`, and `expired: false`. The update halves the header logo size and increases the eagle-to-wordmark gap, removes the repeated footer branding/button, tightens spacing and price cards, and fills both banners to their edges. FILLOUT AI opens with a centered eagle and greeting above a bottom composer. My Application lists all 21 forms without prices and opens preparation options within the same tab, retaining saved drafts.

Validation for build 4: TypeScript and the full existing test suite passed; iOS/Android JavaScript exports and the production web build succeeded. Browser checks at 393px and 320px covered the banners, price cards, footer, all 21 list entries, AR-11/N-400 preparation options, return from a review result, demo chat, and contact navigation. No browser console errors or horizontal text overflow were found. Physical iPhone installation, keyboard behavior, and final native image layout still require device confirmation. This upload does not update the separate Expo Go preview or publish the website.

The I-90 PDF update **0.3.0 (5)** was built and uploaded on October 10, 2026: [EAS build](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/builds/3efeecab-dd4f-43e2-bf66-b87aa13797b8) and [automatic submission](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/submissions/bae3094d-45f0-41ed-9e56-b743631468a6). Both EAS operations are `FINISHED` (build 17:05:58 UTC, submission 17:06:14 UTC). Runtime `0.3.0` separates the new native asset/file/print/share dependencies from build 4. Apple confirms `VALID`, `IN_BETA_TESTING`, and `expired: false`; version 0.3.0 (5) is available for internal testing in Team (Expo). The final check was completed October 10, 2026 around 17:08 UTC. External state remains `READY_FOR_BETA_SUBMISSION`; no external review was requested.

This build connects the full I-90 questionnaire to official static PDF generation. Other forms retain introductory interviews; the explanation text is source-based guidance, and no live model receives full-form answers. Answers stay in the current session. Mailing is a separate, disabled preview until its price, destination and fulfillment/payment service are configured. No fee is collected or application filed.

Validation for build 5: existing tests, questionnaire/engine/adapter/delivery/session tests, TypeScript, production web build and both native exports passed. A 393px browser run completed all 33 applicable questions, generated and downloaded a seven-page filled PDF, and verified the mailing gate and tab preservation. A 320px check verified the full-question layout and that pasted overlong input remains intact with a validation error. Every page of full baseline and interpreter/preparer examples was visually inspected. The browser's final download was separately checked as seven Letter pages with no JavaScript, encryption or interactive widgets. Physical iPhone installation, native save/share and AirPrint still need device verification.

The initial automatic submit attempt for this release included `--what-to-test`, which the current Expo plan rejected as an Enterprise-only changelog feature. The same existing build was then submitted normally with `--id`, without rebuilding or upgrading the plan. Do not add that flag to unattended releases on this plan. Test notes can be maintained separately in App Store Connect.

1. Preserve the registered bundle ID and App Store Connect app ID for subsequent releases.
2. Use the existing EAS-managed credentials. Run `npx eas-cli credentials --platform ios` only if credentials need renewal or repair.
3. Review current SDK and dependency support, privacy disclosures, legal claims, accessibility, data handling and feature limitations before inviting testers. This initial build sends no form data or payments.
4. Build and then submit:

```sh
npm run eas:testflight
npm run eas:submit
```

To build and schedule submission together, use `npm run eas:testflight -- --auto-submit` instead of the two separate commands above. Do not submit the same build again while its automatic submission is pending.

Production uses EAS-managed remote build numbers and auto-increments them for subsequent builds. Remote versioning avoids trying to rewrite the dynamic `app.config.ts` configuration, which the CLI cannot auto-increment locally. A successful upload still requires Apple's processing and, for external testers, applicable beta review.

Check a submission with `npx eas-cli submit:list --platform ios` and read Apple's processing/TestFlight state with `npx eas-cli submit:status --platform ios --profile production`. The latter uses the configured EAS-managed API key.

### What to test

Use sample information only. For 0.7.0, test the 21-form catalog and status/goal finder; compare free, FillOut and attorney choices; try pass, stop and review outcomes in the preliminary form check; complete a free form check, enter sample data directly in the PDF, save the filled file, and open it for printing. Complete a guided interview, edit answers, save a draft and resume it from My Application. With disposable verified accounts and an authorized operator, test submission, the pending download gate, corrections, resubmission and download of the exact approved PDF. Check account restoration, human Chat and account deletion without using real customer data. Report crashes, broken links, clipped content and keyboard problems with the device model and iOS version.

Live AI, payments, external attorney delivery and government filing are not connected in this preview. Guided questionnaires cover all 21 forms; the free manual editor is separate and does not require team approval. The owner account still needs operator activation. Preliminary checks and field coverage do not determine legal eligibility or filing readiness.

No TestFlight upload is performed by simply exporting the JavaScript bundle or committing this configuration.

Official references: [development builds](https://docs.expo.dev/develop/development-builds/create-a-build/), [EAS iOS submission](https://docs.expo.dev/submit/ios/), [Expo Go compatibility](https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/).

## Free PDF editor release 0.4.0

This release opens the free manual PDF editor automatically after a successful preliminary check. Users fill fields on official pages, download an editable PDF, and print the current filled copy. Entries stay in the current session, including tab switches; closing requires discard confirmation. The existing stopped/review checks and AI/attorney paths are retained.

Runtime 0.4.0 includes the new native WebView dependency. An OTA update for the earlier 0.3.0 binary cannot install it. Production uses EAS auto-incremented build numbers and the existing internal Team (Expo) testing group; no public App Store or external beta review is requested.

Pre-publication validation: full application tests, PDF regression tests for all 21 templates, TypeScript, web build and iOS/Android exports passed. Chrome tests verified automatic opening, text/checkbox entry, page/zoom changes, tab preservation, editable save, printing from current values, validation recovery, discard protection and responsive layout. The native editor message bridge was simulated, but physical iPhone save/share and AirPrint still need device verification. GitHub checks and Pages deployment now include the PDF regression suite.

Publication evidence for 0.4.0: source commit `a6b038710690dbbbd0d148ac77891e48f656aeea` was deployed to [fillout.net](https://fillout.net/) by [Pages run 38075792566](https://github.com/coortgroup/immigration_eagle/actions/runs/38075792566), completed successfully on October 10, 2026 at 18:30:06 UTC. A production Chrome smoke test at 18:30:29 UTC passed the free I-90 workflow, exact saved/printed values, state preservation and error recovery; the live editor and template hashes matched the committed assets.

[EAS build 0.4.0 (6)](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/builds/43186557-ccaa-4bfc-b84c-9d87c98af0b3) completed successfully at 18:31:08 UTC, and its [automatic submission](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/submissions/afd6b0f0-69d7-405e-9e2c-7ddbd64c70f4) completed at 18:31:24 UTC. Apple confirmed `VALID`, `IN_BETA_TESTING`, and `expired: false` at 2026-10-10 18:34 UTC; version **0.4.0 (6)** is available to internal TestFlight testers in Team (Expo). External state remains `READY_FOR_BETA_SUBMISSION`; no external beta review or public App Store release was requested.

## FillOut 0.5.0 — languages and saved drafts

Version **0.5.0 (7)** is available for internal testing in [TestFlight](https://appstoreconnect.apple.com/apps/6821241435/testflight/ios), verified on October 11, 2026. The [EAS build](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/builds/d246f9ef-71b1-42c0-9e90-df233822ceaa) finished at 11:53:56 UTC and the [automatic Apple submission](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/submissions/69c496a2-c9f3-4042-9b63-a3f734a98e71) finished at 11:54:10 UTC. Apple confirms processing state `VALID`, internal state `IN_BETA_TESTING`, and `expired: false`. External state remains `READY_FOR_BETA_SUBMISSION`; external review and public App Store release were not requested.

This release changes the launcher label to **FillOut** and adds a globe language selector on Home, English/Russian interface text, questions, guidance, statuses, and errors. Language preference persists without changing answers or drafts. Official USCIS PDF pages and their field descriptions remain in English. Every started form saves from the first answer, Continue application restores the next unanswered question, and attorney drafts show a non-interactive three-step tracker. Preliminary answers use dark blue for paths that continue and light styling for stopped or review outcomes. Restoring a draft cannot replace newer in-memory answers after an outstanding save fails.

Validation: application and translation tests (1,732 translation entries), all 21 official PDF regression cases, TypeScript, web build, and iOS/Android bundle exports passed. Browser checks covered language persistence, Russian/English round trips, mobile layout, website-to-app language links, draft resume and the localized PDF editor. The EAS upload archive was checked against the working tree, including new localization sources. The downloaded signed IPA reports `CFBundleDisplayName=FillOut`, version `0.5.0`, build `7`, bundle ID `com.coortgroup.immigrationeagle`; its embedded bundle contains both languages and draft/tracker strings. IPA SHA-256: `4a6a1e5344270f6004ca014c17114ee1a16e0d4ecb85031f08469ebf222ba06b`. Physical iPhone installation, keyboard behavior, native save/share, and AirPrint still require device verification.

This TestFlight release was built from the current working tree. It does not publish the separate website or Expo Go preview. Production credentials and backend configuration are unchanged. Runtime version is `0.5.0`; EAS manages and increments the native build number remotely.

External testing follow-up on October 11, 2026: build **0.5.0 (7)** was assigned to the closed **Invited testers** group (public links disabled), and the requested tester was added. The supplied review contact, beta description, feedback email and testing notes were saved in App Store Connect. Apple accepted beta review submission `6c6bdf96-750c-452c-af25-0dd9922c58cf`; verified states are `WAITING_FOR_REVIEW` and `WAITING_FOR_BETA_REVIEW`. Automatic notification is enabled (`autoNotifyEnabled: true`). An invitation could not be sent before approval because Apple reported no installable external build; delivery is not yet confirmed. Contact and tester details are intentionally kept out of this repository.

## FillOut 0.6.0 — connected accounts and Chat

The source adds a persistent My Application return button, guided-draft percentage and remaining-question counts, single-line Russian Free prices, FillOut preparation labels, human Chat, and Login/profile access. New users start with a local guest profile. Verified email/password accounts retain their session on the device until logout; logout locks application access. Guest drafts move to the first verified account, and registered accounts keep separate device drafts. Failed saves retain the editor, including during reauthentication; late PDF callbacks save under the editor's original owner.

The free-PDF iOS error was reproduced at the installed Expo Crypto boundary: the old code passed an ArrayBuffer where the native digest function requires a TypedArray. Both template paths now pass Uint8Array. The PDF.js editor also supplies missing Promise.withResolvers and ArrayBuffer.transferToFixedLength APIs before loading the renderer, targeting Safari 16.4. The latter missing API could silently omit PDF text even after a successful load.

Local validation covers native crypto contracts, all 21 PDF templates, old-WebView API compatibility with drawing/text parity, account persistence and isolation, failed-save recovery, draft progress, navigation, localization and human Chat with real local SQL/RLS checks and mocked authentication. TypeScript, the website build and iOS/Android bundle exports pass. Browser checks on 320px/393px layouts confirmed single-line Free labels, return/resume, progress, guest-profile persistence and AR-11 field restoration. Physical iPhone installation, keyboard behavior, native save/share, and AirPrint still require device verification.

The support migration and `support-chat` function were deployed to the existing `fillout-staging` project on October 11, 2026. The EAS project production environment now supplies only the public Supabase URL and publishable key; no service key is bundled. Preview and account-level EAS environments are unchanged. Hosted acceptance passed 13 checks: eight-digit signup/login codes, password login and recovery, restored/refreshed sessions, stored Chat receipts, idempotent retries, team replies, account isolation, denied client writes, invalid tokens, and CORS. All three synthetic test accounts and their messages were removed; no verification emails were sent by this test. Evidence is saved locally in `tmp/release-0.6.0/hosted-acceptance.json`.

Version **0.6.0 (8)** is available for internal [TestFlight](https://appstoreconnect.apple.com/apps/6821241435/testflight/ios) testing, verified on October 11, 2026. The [EAS build](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/builds/654e1208-b965-4ff7-b5a1-4aad59e60e58) finished at 20:11:01 UTC and its [automatic submission](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/submissions/45d39448-71e8-4460-9ad0-2a2388299ecd) finished at 20:11:15 UTC. Apple confirms `VALID`, `IN_BETA_TESTING`, and `expired: false`. External state is `READY_FOR_BETA_SUBMISSION`; this release has not been submitted for external beta review.

The existing internal **Team (Expo)** group already contains build 8; read-back confirmed its availability and preserved earlier build assignments. English and Russian testing notes were saved and verified. No new testers or invitations were created.

The downloaded signed IPA passed `codesign --verify --deep --strict`, reports `FillOut`, `com.coortgroup.immigrationeagle`, version `0.6.0`, build `8`, minimum iOS `16.4`, and runtime `0.6.0`. Its native binary contains SecureStore; its Hermes bundle contains the expected public Supabase configuration and the account, Chat, return and progress features. The PDF editor and all 21 official PDF assets match the audited source archive byte for byte. IPA SHA-256: `9c12a1fdbf67cd11959ee0f003425c3ddc7481288f94404d41657c538b8f6898`. Evidence is in `tmp/release-0.6.0/binary-verification.json`.

Runtime is **0.6.0**, because SecureStore adds a native module. The build includes the current working tree and requires an installed TestFlight update. This release does not publish the separate website or Expo Go preview. See [Chat setup and operator reply workflow](../supabase/SUPPORT_CHAT.md).

## FillOut 0.7.0 — guided forms, review and account deletion

Version **0.7.0 (9)** is available for internal [TestFlight](https://appstoreconnect.apple.com/apps/6821241435/testflight/ios) testing, verified on October 12, 2026 around **23:44 UTC**. The signed [EAS build](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/builds/2d683882-584d-4f20-ae70-a6505a79e886) finished at **03:20:15 UTC**, and [Apple submission](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/submissions/46e897f9-62fd-4d4f-96b2-9c146ab379b1) finished at **23:41:26 UTC**. Apple confirms `VALID`, `IN_BETA_TESTING`, and `expired: false`. External state remains `READY_FOR_BETA_SUBMISSION`; no external beta review was requested. Evidence: `tmp/release-0.7.0/apple-status.json`.

Read-back verified build 9 is already assigned to the internal **Team (Expo)** group; no assignment change was needed and earlier build assignments remain intact. English (`en-US`) and Russian (`ru`) testing notes were saved and verified at **23:44:33 UTC**. Evidence: `tmp/release-0.7.0/testflight-group.json` and `test-notes.json`.

This update adds guided questionnaires for all 21 forms, a compact PDF editor and saved return navigation, mandatory human review of FillOut submissions, in-app account/data deletion, and operator inboxes for messages and form reviews. Approved downloads and printing use the exact reviewed PDF; new submissions require new approval. The owner's confirmed FillOut account email is still needed to activate operator access.

The three migrations for deletion, operator access and form review are recorded as applied on the existing `fillout-staging` project. The corresponding `delete-account`, `support-inbox` and `form-review` functions are `ACTIVE`, version 1. Hosted acceptance completed at **2026-10-12 23:40:57 UTC** with 13 grouped checks covering review corrections/resubmission, exact approved bytes, pending and superseded download gates, concurrent retries, operator replies/revocation, Auth/CORS/RPC boundaries, and deletion cascades with another account preserved. All three synthetic accounts, their records and deletion receipts were removed. No email was sent and no real operator was granted. Evidence: `tmp/release-0.7.0/backend-deployment.json` and `hosted-acceptance.json`.

TypeScript, application tests, all 21 PDF/guided-form regressions, the full web/site build, iOS export and Expo Doctor (21/21) passed. The source archive contained 261 files; all 114 audited runtime files still match after validation. The signed IPA passed code-signature verification, reports `FillOut`, `com.coortgroup.immigrationeagle`, version **0.7.0**, build **9**, minimum iOS **16.4**, runtime **0.7.0**, and contains the expected public configuration, SecureStore and new feature markers. Its PDF editor and all 21 official templates match the audited sources. IPA SHA-256: `b0d7bffc3843f7824f79b902199883b4291eb7bb5b995002f8a8e80bf650863c`. Evidence: `tmp/release-0.7.0/local-validation.json` and `binary-verification.json`.

Physical iPhone installation, keyboard behavior, native save/share and AirPrint remain untested. This release does not publish the separate website or Expo Go preview, request external beta review, or create tester invitations.

## FillOut 0.8.0 — native sandbox payment testing

Version **0.8.0 (11)** is available for internal [TestFlight](https://appstoreconnect.apple.com/apps/6821241435/testflight/ios) testing, verified on October 13, 2026 (UTC): [EAS build](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/builds/e57d607a-22f2-4b28-a9cd-2bb91d5c2aad), [Apple submission](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/submissions/bf270b03-0664-4b16-9c2d-9a52be4ae11f). Apple build `20a439e5-3bb5-4592-a8b1-7eeb85f4fb58` is `VALID`, `IN_BETA_TESTING`, and not expired. Read-back confirmed it is assigned to the existing **Team (Expo)** group with earlier builds preserved. English and Russian testing notes were saved and verified. No tester invitations, external beta review or public release were requested. Superseded build 10 was not submitted.

The dedicated `payments-sandbox` build profile includes RevenueCat's native SDK, per-application purchase state, a visible test-environment banner, the public iOS SDK key and the existing staging Supabase configuration. It uses runtime **0.8.0** and the `payments-sandbox` update channel. Test builds reject paid backend responses outside sandbox. Global production payment flags remain unchanged.

Local native Release compilation and UI verification passed on the iPhone 18 Pro simulator: home, a synthetic I-90 preliminary check, and the payment gate requiring sign-in. The local Xcode 27 launch failure was corrected with the supported `expo-build-properties` 57.0.22 scene-lifecycle option; both the local app and cloud IPA contain `EXExpoAppSceneDelegate` and its generated scene configuration. TypeScript, localization, client payment/gate tests, backend payment tests and form-review tests passed.

The downloaded IPA passed **33 static checks**, including code signature, exact app/version/build identity, audited configuration, native RevenueCat, scene support, staging public configuration and credential-pattern checks over all 44,287 complete Hermes strings. The scanner distinguishes SDK prefix literals from complete secrets across packed string boundaries; tests still reject complete fake credentials in ASCII and UTF-16 strings. IPA SHA-256: `81ab1efcedb6b58a414fabcdb5b549c868bb1955e89c4efb7cf88a75a9e4a1fa`. Evidence: `tmp/release-0.8.0/native-client-validation.json`, `local-binary-verification.json`, and `binary-verification.json`.

The 14 Apple/RevenueCat consumables, USA prices and Apple-to-RevenueCat notifications are configured. The two payment functions were initially deployed with purchases disabled; the following October 17 activation supersedes that initial backend state.

### Sandbox backend activation — October 17, 2026

RevenueCat-to-Supabase integration **FillOut Supabase sandbox** (`whintgrfa4c86a97c`) is configured with authorization, HMAC signing, sandbox environment and App Store app `app4ad646c435`. Both stored webhook-secret digests matched. An actual RevenueCat `TEST` event returned **HTTP 200** with `{received:true,test:true}`; missing authorization and invalid-signature checks each returned **401**. No test event grants access. Temporary credential storage was removed.

On the existing `fillout-staging` project `ceoliqoctkgwkphbmkiv`, migration `20261012000100_ai_payments.sql` is applied, and fresh CLI read-back confirms all six migrations with none pending. `ai-payment` and `revenuecat-webhook` are **ACTIVE v3**, and the updated `form-review` is **ACTIVE v5**. Configuration is `AI_PAYMENTS_ENABLED=true`, `REVENUECAT_ENVIRONMENT=sandbox`, `PAYMENTS_STAGING=true`. Production billing has not been activated. Old clients without a paid-case identifier must update before submitting new paid reviews; existing review lists and approved documents remain accessible.

Hosted checks before purchase passed: one synthetic confirmed account signed in with a password; I-90 status, reservation, cancellation and reconciliation returned the expected sandbox product and required payment; an unpaid review submission returned **402**. The synthetic Auth user was deleted and absence verified. The smoke test sent no email, attempted no store purchase and performed no RevenueCat write. An anonymous unpurchased-case tombstone may remain under the ledger's retention rules. Evidence: `tmp/revenuecat-setup/sandbox-activation-verification.json`, `webhook-secret-verification.json`, `webhook-delivery-verification.json`, `webhook-negative-checks.json`, and `hosted-payment-smoke.jsonl`.

### First sandbox purchase — October 17, 2026

The user reports completing a purchase in TestFlight **0.8.0 (11)**. A separate read-only server audit confirmed one active App Store sandbox purchase of `net.fillout.ai.i90.case.v1` at **17:05:21 UTC**, bound to exactly one I-90 case with matching ownership and no pending reservation. Direct RevenueCat dashboard inspection matched the account, product, purchase time and `NON_RENEWING_PURCHASE` event in **SANDBOX DATA**, showing a USD 140.99 test price and webhook delivery status **Sent**. The same event was processed by Supabase at **17:05:25 UTC**, and reconciliation completed. Evidence: `tmp/revenuecat-setup/sandbox-purchase-verification.json`.

At the 17:12 UTC audit, the five-minute verification window had elapsed: the raw access check returned false while the active paid-case binding remained recorded. Normal app payment/review requests reconcile RevenueCat before checking access; this audit made no remote changes. **Reopening, restoration and refund remain unverified.** A Mac and iPhone Mirroring are optional for testing directly on iPhone; the agent cannot control the remote device. See [payment activation state](PAYMENTS_IMPLEMENTATION.md).

### Profile update for TestFlight 0.8.0 (11) — October 17, 2026

The profile now collects required email and phone details and creates a password on the same page. The name field and separate guest-profile save/registration steps are removed. Existing names are preserved; saving the phone does not overwrite other account metadata. Email confirmation, draft ownership, account switching and signed-in account controls remain in place.

Client password length limits and input truncation are removed. Passwords are sent unchanged to Auth, with translated provider errors. Read-only inspection confirmed the hosted Supabase policy already uses its lowest supported minimum of six characters with no required character classes. Supabase Auth still imposes its own six-character minimum and 72-byte UTF-8 maximum; this update does not change authentication service policy.

TypeScript, account storage/context/screen, cloud-client, localization and payment-client/gate checks passed. The Russian profile was visually checked at 430×932 in the production-mode web renderer, including required email, phone and password errors; no account was created by that UI check. The iOS Hermes export preserves the native build's public configuration, payment-test flags, runtime and channel. Evidence: `tmp/profile-update-2026-10-17/profile-validation.json` and `delivery-verification.json`.

The audited iOS export was published to **payments-sandbox**, runtime **0.8.0**, as update `01a14ade-6ae2-7508-86da-60b037b7207c`, group `e8958930-ada9-4a2e-bdfe-bc5de6129319`. It updates the installed TestFlight build without a new native binary. EAS read-back confirmed the exact update, group, iOS runtime and channel. Direct manifest retrieval was blocked by Cloudflare (403/1010), so installation on the user's physical iPhone is not yet confirmed. Build 11 checks for updates on launch with no startup wait: open online, let the update download, then fully close and reopen. Delivery evidence: `tmp/profile-update-2026-10-17/delivered-verification.json`.
