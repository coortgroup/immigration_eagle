# FillOut accounts, intake and human Chat

Updated October 17, 2026. Accounts, intake, human Chat, deletion, operator inbox, review and application payments are deployed on `fillout-staging` (`ceoliqoctkgwkphbmkiv`), the shared release backend used by EAS production. **Eight migrations through `20261017000200` are applied**. Payment now defaults to production with isolated, verified App Store sandbox support; no actual production transaction or public launch is verified. The latest confirmed internal binary is **0.8.0 (11)**, with a compatibility OTA published; source is **1.0.0**, whose final native build has not started. Website publication and Apple review submission are pending. See [deployment evidence](../docs/SUPABASE_STAGING.md), [payments](../docs/PAYMENTS_IMPLEMENTATION.md), and [team replies](SUPPORT_CHAT.md).

## Boundaries

- `submit-request` verifies the caller through Supabase Auth `/auth/v1/user`. Only authenticated, nonanonymous users with a confirmed email can submit. A phone number in the contact payload is a callback preference, not the account identity.
- `Authorization` must contain the user's access token, and `apikey` must contain the project's publishable/anon key. The service key is server-only. Opaque `sb_secret_` keys are sent to the Data API only as `apikey`; legacy service-role JWTs use both headers.
- Native clients without `Origin` are accepted after authentication. Browser origins are exactly `https://fillout.net` and `https://www.fillout.net`. A separate development project may explicitly enable loopback origins. No wildcard or arbitrary production origin is supported.
- POST JSON is limited to 16 KiB. Contact fields have independent limits. Form IDs must exist in the current catalog; free attorney intake requires a form ID and exact `attorneyConsent=share-contact-and-question-v1`. Contact requests cannot carry attorney consent. Legacy requests without consent are preserved without retroactive permission.
- `public.requests` allows authenticated users to read their own rows. They cannot insert, update, delete, list other users' rows, or execute service RPCs. Writes require the Edge Function and its service key. Private SECURITY DEFINER implementations have an empty search path and are outside exposed API schemas; public wrappers use SECURITY INVOKER and service-only grants.
- A transaction serializes submissions by user, enforces five new requests per rolling hour, and creates an outbox row atomically. Reusing `requestId` with the same normalized payload returns the saved receipt without consuming quota. A changed payload returns 409.
- The owner may manually forward consented attorney contact details, selected form and question to independent attorneys. No automatic assignment, response promise or legal-service charge is implemented.
- Outbox records contain request IDs and processing metadata only. No email worker exists yet; `externalNotification: false` is intentional. Authorized team members can inspect `public.requests` in the Supabase dashboard. Dashboard access requires restricted team roles and MFA; do not share service keys with reviewers.
- `support-chat` verifies the same confirmed account identity, stores customer messages under that user and returns a matching storage receipt. Customer clients can read only their own conversation and cannot directly insert or change messages. The server allows 30 new customer messages per rolling hour, with idempotent retry per message UUID. Authorized operators can reply through the new in-app inbox or the dashboard fallback. The owner's confirmed account email is still needed for operator activation. No automated assistant or external notification worker is part of this Chat flow.

## Configure or deploy another environment

The current project has completed these deployment steps. For a new target, select the intended project explicitly and check migration history before applying changes.

1. Keep the `private` schema out of Exposed schemas. Use a separate development project for loopback browser origins. Confirm the chosen region and team access for the target environment.
2. Enable email confirmation and disable anonymous sign-in. Set site URL to `https://fillout.net/app/`. Configure production SMTP before enabling general signups: Supabase's built-in mail transport is not a production customer mail service.
3. In hosted Auth Email Templates, use `templates/email-code.html` for both **Confirm signup** and **Magic Link**. Configure eight-digit OTPs, a ten-minute expiration and at least one minute between sends. Signup with a password and OTP recovery use these code templates. **Change email address** is a separate template: preserve its confirmation links; the user follows the messages and refreshes their profile in the app. The local `config.toml` and templates do **not** automatically update hosted Auth settings. Update only the intended hosted fields, as described in [SMTP setup](../docs/RESEND_SETUP.md).
4. Authenticate the official Supabase CLI locally and link the intended project. Review the migration before applying it:

   ```sh
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push --dry-run
   npx supabase db push
   npx supabase functions deploy submit-request --project-ref YOUR_PROJECT_REF --use-api
   npx supabase functions deploy support-chat --project-ref YOUR_PROJECT_REF --use-api
   npx supabase functions deploy delete-account --project-ref YOUR_PROJECT_REF --use-api
   npx supabase functions deploy support-inbox --project-ref YOUR_PROJECT_REF --use-api
   npx supabase functions deploy form-review --project-ref YOUR_PROJECT_REF --use-api
   npx supabase functions deploy ai-payment --project-ref YOUR_PROJECT_REF --use-api
   npx supabase functions deploy revenuecat-webhook --project-ref YOUR_PROJECT_REF --use-api
   ```

   `--use-api` bundles functions on Supabase and does not require Docker. CLI login is separate from dashboard login. Apply the eight migrations in order, from `20261010000100_cloud_intake.sql` through `20261017000200_attorney_referral_consent.sql`. Coordinate payment functions and native clients as described in the payment guide. If applying a migration through the SQL Editor instead of the CLI, use a transaction and reconcile that migration's history before a later `db push`. Do not reapply these creation migrations on the current staging project: all eight are already recorded as applied. The function deployment commands need CLI account authorization but do not require database credentials or project linking.

   On this Mac, CLI versions 2.120.0 and 2.117.0 hang before displaying help. Version 2.90.0 works and supports `--use-api`; use `npx --yes supabase@2.90.0` for the commands above until a newer version is verified to start correctly. No OS security settings need to be changed.

5. Keep server credentials in Supabase, never Expo, GitHub Pages, public environment variables or source control. Hosted functions receive Supabase URL/key variables automatically. `_shared/http.mjs` supports singular/plural publishable and secret keys, with legacy anon/service-role fallbacks. Human Chat needs no OpenAI key or model configuration.
6. Configure only the public Supabase URL and publishable key in the app build. Verify that the build and hosted acceptance checks target the same project.

## Client configuration and accounts

The public app build reads `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (an `sb_publishable_` key). Leave both blank for local guest preparation. Partial or invalid configuration fails closed; a cloud error never redirects a request into a local inbox. Sign-in itself never sends a contact request or a Chat message.

Native sessions persist in SecureStore with token refresh while the app is active; browser sessions persist in browser storage. A fresh email code is not required on every restart. Logout requires login before the app reopens. Drafts stay in account-scoped device storage; the first verified account receives the guest drafts, and later accounts remain separate. Sign-in and session refresh do not upload preparation answers.

Registration accepts a profile and password, then requires email confirmation. Existing OTP-only accounts receive an explicit Set password step after verification instead of assuming a submitted signup password replaced their previous credentials. Email-code recovery signs in an existing account without creating a new one. Changing the login email requires the current password and email confirmation; Refresh profile also persists the confirmed address for the next app launch.

For web deployment, `.github/workflows/pages.yml` supplies the matching public Supabase configuration to a fresh Expo export; browser checkout is disabled. Native releases use the intended EAS environment. These values are public, but changing them does not update an installed app. Source 1.0.0 has its own app-version runtime. The published 0.8.0 compatibility OTA updates the existing test runtime; it does not install the future 1.0.0 binary.

`EXPO_PUBLIC_ENABLE_LIVE_AI` does not enable human Chat. The older `ai-assistant` function and its quota RPC remain in the repository and the initial staging deployment, but the current UI does not call them. They are not prerequisites for accounts, guided forms or team replies.

For a separate development project only, `CORS_ALLOWED_ORIGINS` can list exact loopback origins and `ALLOW_LOCAL_DEVELOPMENT=true` permits them. Leave these overrides unset on the shared release backend.

## Verification status

On October 17, both new migrations and four payment/review/intake functions were deployed. Hosted tests passed on the sandbox configuration and after the switch to production with App Store sandbox acceptance. Unpaid review remains 402, client claims cannot override owner/environment/payment, and ordinary customers cannot access either operator queue. The original real sandbox purchase remains isolated. Hosted consent tests also passed; synthetic accounts and requests were cleaned up without email or attorney forwarding. Evidence: `tmp/payment-environments/hosted-production-validation.json`, `hosted-sandbox-validation.json`, `original-sandbox-after-cutover.json`, and `tmp/attorney-consent-hosted-smoke.jsonl`.

The following October 11–12 checks are historical evidence, not verification of the unbuilt 1.0.0 binary.

Hosted acceptance passed 13 checks covering password and eight-digit OTP access, recovery, session restoration and refresh, customer Chat, a team reply and account isolation. All three synthetic users were deleted and no test messages remain. The signed 0.6.0 (8) IPA separately passed signature, SecureStore, public configuration and bundled PDF asset checks. Apple confirms internal TestFlight availability; physical-device behavior still requires testing.

On October 12, 13 additional grouped hosted checks passed for operator replies/revocation, concurrent review retries, pending/superseded download gates, corrections/resubmission, exact approved PDFs, Auth/CORS/RPC boundaries, deletion cascades and another account's isolation. All three synthetic users, related records and test deletion receipts were removed; no email was sent and no real operator was granted. The 0.7.0 (9) signed IPA passed verification and Apple confirms internal TestFlight availability. Evidence is in `tmp/release-0.7.0/hosted-acceptance.json`, `binary-verification.json` and `apple-status.json`.

Resend custom SMTP and the two code templates are configured. The earlier authorized email has provider-confirmed delivery; generated-code Auth acceptance does not additionally prove inbox placement or email-change message delivery. See [SMTP evidence](../docs/RESEND_SETUP.md). Authentication SMTP does not notify operators about Chat or intake requests. No outbox email worker is configured.

Preparation drafts use account-scoped AsyncStorage without application-level encryption or cross-device sync. Account deletion and its active-data cascades are deployed and passed hosted acceptance. Independently exported PDFs, other-device drafts and backup/production retention remain separate limits and owner decisions. [Launch readiness](../docs/LAUNCH_READINESS.md) distinguishes those limits from completed acceptance checks.

### Remaining workflow checks

- Build and verify final 1.0.0 on a physical phone: sign-in restoration, retained drafts, Chat, review/download and deletion. Test sandbox reopening/restore/refund and explicit sandbox approval/download after cutover.
- Activate only the owner's confirmed account for operator inboxes; confirm a public support/privacy email. Both remain pending.
- Check signup/recovery mail inbox placement, resend throttling and email-change confirmation messages separately from generated-token Auth testing.
- Verify the final native free-attorney request UI and its separate consent. Hosted storage/rejection/retry checks passed; no real request has been forwarded by the test.
- Retry an identical request after a simulated network interruption; confirm one row and one outbox event. Send concurrent retries/new requests from separate sessions and check quota/concurrency behavior.
- Directly query with two different users' tokens and the anon key; verify owner-only reads and rejected writes/service RPCs. Confirm the private schema is not exposed by the hosted API.
- Confirm CORS failures from an unrelated site, malformed/oversized body rejection, no sensitive payload/token logs, and rotation/revocation of keys.
- Keep team notifications disabled until a recipient is explicitly configured and a worker's retry/idempotency behavior is verified. A saved request does not confirm any lawyer engagement, payment or government filing.

## Local checks and limitations

`node scripts/check-cloud-intake.mjs` exercises intake with mocked Auth/network calls and the actual intake/consent migrations and SQL functions in PGlite, including direct SQL bypass rejection, exact stored consent, legacy preservation and retries. `node scripts/check-support-chat.mjs` does the same for Chat storage, replies, RLS, retry, pagination and quotas. `node scripts/check-cloud-client.cjs` includes an actual Supabase SDK check that refreshed profile details survive session restoration, with an offline transport. `npm run test:accounts` covers native/browser session storage, account transitions, guest association and draft isolation. These local tests do not contact hosted Auth or send email; the separate hosted acceptance results are recorded above.

Run `scripts/verify-cloud-schema.sql` in the hosted SQL Editor to check deployed tables, grants, policies and functions without reading customer records. Run `node scripts/check-cloud-hosted.mjs --url https://PROJECT_REF.supabase.co` to verify the deployed HTTP authentication and CORS boundaries without an account or user data. Neither check confirms email delivery or a successful authenticated submission.

Add `--check-anon-data-api` to also verify anonymous table/RPC denial and the unexposed private schema. This optional mode reads only `.env.staging.local` and requires its public URL to match the supplied project. It never uses a service key or signed-in user token.

Official references: [Auth on Edge Functions](https://supabase.com/docs/guides/functions/auth), [API keys](https://supabase.com/docs/guides/api/api-keys), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [database functions](https://supabase.com/docs/guides/database/functions), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [passwordless email](https://supabase.com/docs/guides/auth/auth-email-passwordless).

Deployment references: [CLI function deployment](https://supabase.com/docs/reference/cli/supabase-functions-deploy), [migration naming](https://supabase.com/docs/guides/ai-tools/ai-prompts/database-create-migration).


## Application payments — deployed, with sandbox isolation

The ledger migration `20261012000100_ai_payments.sql` and `20261017000100_payment_environments.sql` are applied. The current flags are `AI_PAYMENTS_ENABLED=true`, `REVENUECAT_ENVIRONMENT=production`, `PAYMENTS_STAGING=false`, `REVENUECAT_ACCEPT_APP_STORE_SANDBOX=true`. RevenueCat integration **FillOut Supabase** uses Both environments with HMAC; signed provider TEST `C40382A6-ABE4-44A7-BD0D-36BDB794035A` returned HTTP 200. Case/package/review provenance and explicit test queues prevent sandbox fulfillment being mistaken for production. Client callbacks and local flags never authorize a service.

The owner reports the independently verified earlier sandbox purchase in TestFlight 0.8.0 (11). Production-mode hosted smoke did not make a store purchase. Final native 1.0.0 build, website publication, App Privacy and app/IAP review submission remain pending. See [current payment status and tests](../docs/PAYMENTS_IMPLEMENTATION.md).
