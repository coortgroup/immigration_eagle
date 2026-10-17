# Supabase shared release backend — deployment history

Updated October 17, 2026. The existing project named `fillout-staging` is the shared release backend selected by the EAS production environment; it has not been replaced with a separate project. Its payment default is now production with explicit Apple sandbox isolation. Initial October 10–12 deployment records below are preserved as history; current state follows.

## Resources

- Organization: FILLOUT IMMIGRATION FORMS, Free plan.
- Project: `fillout-staging`, reference `ceoliqoctkgwkphbmkiv`.
- Region observed in dashboard: Canada (Central), `ca-central-1`. Review the production region separately before storing customer information.
- [Project dashboard](https://supabase.com/dashboard/project/ceoliqoctkgwkphbmkiv).
- Public API root: `https://ceoliqoctkgwkphbmkiv.supabase.co`.
- Public client configuration is saved locally in ignored `.env.staging.local`. The matching public URL and publishable key are now configured in the EAS production environment for the native build. Server credentials are not bundled with the app. The legacy live-AI flag is not used by human Chat.

## Current deployment — October 17, 2026

- Eight migrations are applied, through `20261017000200_attorney_referral_consent.sql`. The initial payment ledger `20261012000100` was followed by `20261017000100_payment_environments` and the attorney consent migration. Do not rerun their creation SQL.
- Redeployed `ai-payment`, `form-review`, `revenuecat-webhook` and `submit-request` after the two October 17 migrations. Existing Auth/Chat/deletion/operator services remain deployed. Endpoint handlers enforce authorization; gateway `verify_jwt=false` is intentional.
- Payment flags are `AI_PAYMENTS_ENABLED=true`, `REVENUECAT_ENVIRONMENT=production`, `PAYMENTS_STAGING=false`, `REVENUECAT_ACCEPT_APP_STORE_SANDBOX=true`. Only verified App Store sandbox purchases enter the App Review exception; sandbox cases/reviews remain separate from production fulfillment. Client environment/owner/paid claims are rejected.
- RevenueCat integration **FillOut Supabase** delivers **Both** environments with authorization and HMAC signing. Provider `TEST` `C40382A6-ABE4-44A7-BD0D-36BDB794035A` returned HTTP 200 and `{received:true,test:true}`; this grants no purchase or service.
- Hosted checks passed in sandbox and again after the production switch: Auth/RPC boundaries, customer denial from both operator queues, status/prepare/cancel/reconcile, and unpaid-review 402. Synthetic users were removed; no email, store purchase or RevenueCat write occurred. Evidence: `tmp/payment-environments/hosted-sandbox-validation.json` and `hosted-production-validation.json`.
- The user's earlier I-90 sandbox purchase remains active, bound to one case and marked sandbox after cutover. Read-only evidence `original-sandbox-after-cutover.json` did not refresh the original account's expired verification context; successful owner reopen remains unverified. The original actual purchase proof remains in `tmp/revenuecat-setup/sandbox-purchase-verification.json`.
- Free attorney intake now requires exact versioned consent `share-contact-and-question-v1` in the HTTP handler and SQL. Hosted smoke verified missing/wrong consent rejection, valid storage, contact-consent rejection and idempotent retry; the synthetic user and requests were removed (`tmp/attorney-consent-hosted-smoke.jsonl`). No forwarding/email occurred. Historical requests without consent remain history, not permission to disclose.
- A 0.8.0 compatibility OTA was published: update `01a14afe-2cb7-70ea-8e7b-622d47b3438a`, group `1c4fa112-ad2b-45a4-a053-8db65a7911bf`. The source is now 1.0.0, with production native payments enabled and test-build mode off. Final 1.0.0 build has not started; website publication and App Review submission are pending. The latest confirmed internal native binary remains 0.8.0 (11); OTA installation on a particular device is not proved by publication.

## Initial deployment evidence — 2026-10-10

- Applied `supabase/migrations/20261010000100_cloud_intake.sql` once through the SQL Editor as `postgres`, wrapped in one transaction. Result: success.
- The initial SQL Editor application did not register CLI migration history. This was reconciled during the 2026-10-11 update below; do not execute the creation migration a second time.
- `scripts/verify-cloud-schema.sql`: all **47 of 47** catalog checks passed against the hosted database. This verifies RLS, grants, policy structure, function security settings, uniqueness and cascade constraints. It is not a two-user live JWT test.
- `submit-request`: ACTIVE, version 1; function ID `b6246543-17d8-4c31-a232-2bf1c95da44b`.
- `ai-assistant`: ACTIVE, version 1; function ID `4451fd3f-7448-44be-b589-0c6a44a4cdea`.
- Both deployed with official Supabase CLI 2.90.0 and `--use-api`. Gateway `verify_jwt=false` is intentional: both handlers validate user tokens using Supabase Auth before any action.
- Both functions passed allowed preflight (204), missing/invalid authentication (401), and unrelated-origin rejection (403). Responses have `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
- Using only the publishable key, anonymous request reads and privileged RPC calls returned permission denied (401 / `42501`); the private schema returned not exposed (406 / `PGRST106`). These boundary checks made no authenticated writes, user creation or provider calls.
- Auth: email confirmation on; anonymous sign-in off; eight-digit OTP retained; expiration changed to 600 seconds. Site URL set to `https://fillout.net/app/`.
- Resend registration is complete. All three sending-domain DNS records are saved in Namecheap, `auth.fillout.net` is **Verified** in Resend, and TLS is **Enforced**. Public/authoritative DNS checks confirmed the records and the existing website and root mail settings remain unchanged. See [Resend setup](RESEND_SETUP.md).
- Created `FILLOUT staging Supabase SMTP`, a **Sending access** key restricted to `auth.fillout.net`. The owner entered and saved it directly in Supabase SMTP. A fresh browser tab confirmed SMTP enabled, the stored password hidden, and no unsaved changes. No key value was recorded in chat or the repository; no paid plan has been selected.
- Both **Confirm signup** and **Magic Link** email templates were saved, reloaded and previewed with the exact local `supabase/templates/email-code.html` body. Subjects are `Your FILLOUT verification code` and `Your FILLOUT sign-in code`; the body uses the eight-digit token with a ten-minute expiry and no old sign-in links.
- Exactly one owner-authorized OTP request returned **HTTP 200** at **2026-10-10T06:48:07.752Z**, with no retries. Resend confirmed delivery. Owner receipt, inbox placement and verified-user sign-in were not confirmed by that delivery check.
- Local cloud tests, TypeScript checking, complete website build and generated-site checks passed after the eight-digit OTP update.

## Accounts and human Chat — 2026-10-11

- Applied `supabase/migrations/20261011000100_support_chat.sql` after the existing cloud-intake migration.
- Repaired migration history for `20261010000100` and `20261011000100`; both migrations are recorded as applied.
- Deployed `support-chat`; the function is active. Its handlers verify the user's access token, and customer reads remain scoped to that account.
- Configured the public Supabase URL and publishable key in the EAS production environment to point to the existing `fillout-staging` project.
- Hosted acceptance passed **13 checks** covering password and eight-digit OTP access, recovery, session restoration and refresh, customer Chat, a team reply and account isolation. The three synthetic test users were deleted and no test messages remain. These Auth/Chat checks do not establish inbox placement or physical-iPhone behavior.
- Native sessions persist through SecureStore; browser sessions use browser storage. Drafts remain local and account-scoped. Profile refresh persists confirmed email changes, and accounts created through an older OTP-only flow are prompted to set a password.
- The current Chat UI uses the team conversation endpoint. The earlier `ai-assistant` deployment is retained historical infrastructure and is not called by this UI; no AI provider is required to enable human Chat.
- The [0.6.0 (8) EAS build](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/builds/654e1208-b965-4ff7-b5a1-4aad59e60e58) finished at **20:11:01 UTC** on October 11, 2026; its [automatic submission](https://expo.dev/accounts/coortgroup/projects/immigration-eagle/submissions/45d39448-71e8-4460-9ad0-2a2388299ecd) finished at **20:11:15 UTC**.
- Apple confirms **0.6.0 (8)** is available for internal TestFlight testing: `VALID`, `IN_BETA_TESTING`, `expired: false`. External state is `READY_FOR_BETA_SUBMISSION`; this does not confirm external beta review or public App Store availability.
- The signed IPA passed signature verification and checks for SecureStore, the expected public Supabase configuration, the PDF editor and all 21 official PDF assets. Local evidence is recorded in `tmp/release-0.6.0/apple-status.json` and `tmp/release-0.6.0/binary-verification.json`. Physical-iPhone behavior is not established by these checks.

## Deletion, operator inbox and form review — 2026-10-12

- Migration history confirms all five migrations through `20261011000400`, including account deletion, support operators and form review. Do not reapply their creation SQL.
- `delete-account`, `support-inbox` and `form-review` are each `ACTIVE`, version 1. Their `verify_jwt=false` gateway setting is intentional; authorization is enforced inside the handlers.
- Hosted acceptance passed **13 grouped checks** at **2026-10-12 23:40:57 UTC** using two synthetic customers and a synthetic operator. Checks covered isolated replies and retries, concurrent review submission retries, blocked pending/superseded downloads, exact immutable PDF delivery, corrections/resubmission, stale decisions, approval replacement, immediate operator revocation, Auth/CORS/private-schema/RPC boundaries, OTP deletion cascades, lost-response deletion retry and preservation of another customer's data.
- Cleanup verified all three synthetic Auth users absent, zero related messages/operator memberships/requests/reviews, and zero test deletion receipts. No email was sent and no real owner/operator was granted access. The owner's confirmed FillOut account email is still required for operator activation.
- Evidence is saved in `tmp/release-0.7.0/backend-deployment.json` and `hosted-acceptance.json`. Local checks and the signed **0.7.0 (9)** IPA passed. Apple confirmed internal TestFlight availability around **23:44 UTC** on October 12: `VALID`, `IN_BETA_TESTING`, `expired: false`; external state is `READY_FOR_BETA_SUBMISSION`. See [release evidence](RELEASE.md#fillout-070--guided-forms-review-and-account-deletion).

## Remaining verification and service limits

1. Build/upload the final 1.0.0 native binary and verify its physical-iPhone workflow: accounts, drafts, review/download, deletion, Chat and the free attorney request with explicit consent. Use the already-published 0.8.0 bridge only for the existing test binary.
2. Verify the original owner's sandbox reopen/restore and the final-build sandbox review → explicit test approval → TEST PDF flow. Server smoke tests do not prove those UI actions or a live production transaction.
3. Keep email delivery evidence separate from generated-code Auth tests. Inbox placement, resend throttling and email-change confirmation messages still need a mailbox check.
4. Assign operator access only to the owner's confirmed FillOut account; that email and the public support/privacy email are still pending. The owner manually forwards attorney requests only after separate consent. No external notification worker or automatic attorney assignment exists.
5. Publish the full website/browser build and policy/support pages, finish App Privacy on the owner's iPhone, and complete Apple app/IAP metadata and review submission. No public release or Apple approval is claimed here.

Backend deployment does not install a new binary or prove an OTA was loaded. The production default does not convert a sandbox purchase into production service. Payment details, remaining tests and evidence are in [PAYMENTS_IMPLEMENTATION.md](PAYMENTS_IMPLEMENTATION.md); current release blockers are in [LAUNCH_READINESS.md](LAUNCH_READINESS.md).
