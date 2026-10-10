# FILLOUT cloud intake

Prepared locally; no hosted project, production credentials, or email notification worker is provisioned by these files.

## Boundaries

- `submit-request` verifies the caller through Supabase Auth `/auth/v1/user`. Only authenticated, nonanonymous users with a confirmed email can submit. A phone number in the contact payload is a callback preference, not the account identity.
- `Authorization` must contain the user's access token, and `apikey` must contain the project's publishable/anon key. The service key is server-only. Opaque `sb_secret_` keys are sent to the Data API only as `apikey`; legacy service-role JWTs use both headers.
- Native clients without `Origin` are accepted after authentication. Browser origins are exactly `https://fillout.net` and `https://www.fillout.net`. A separate development project may explicitly enable loopback origins. No wildcard or arbitrary production origin is supported.
- POST JSON is limited to 16 KiB. Contact fields have independent limits. Form IDs must exist in the current catalog; attorney intake requires a form ID.
- `public.requests` allows authenticated users to read their own rows. They cannot insert, update, delete, list other users' rows, or execute service RPCs. Writes require the Edge Function and its service key. Private SECURITY DEFINER implementations have an empty search path and are outside exposed API schemas; public wrappers use SECURITY INVOKER and service-only grants.
- A transaction serializes submissions by user, enforces five new requests per rolling hour, and creates an outbox row atomically. Reusing `requestId` with the same normalized payload returns the saved receipt without consuming quota. A changed payload returns 409.
- Outbox records contain request IDs and processing metadata only. No email worker exists yet; `externalNotification: false` is intentional. Authorized team members can inspect `public.requests` in the Supabase dashboard. Dashboard access requires restricted team roles and MFA; do not share service keys with reviewers.
- The AI quota RPC atomically enforces 20 calls per user and 200 calls project-wide per rolling 24 hours. It stores no message content. Failed provider calls consume a slot. Usage events older than 24 hours are removed during a successful quota check.

## Deploy after the owner creates the services

1. Create a separate Supabase development project, then a production project in the approved region. Keep production `private` schema out of Exposed schemas. Configure team access, backups, retention and account-deletion procedures before accepting real user data.
2. Enable email confirmation and disable anonymous sign-in. Set site URL to `https://fillout.net/app/`. Configure production SMTP before enabling general signups: Supabase's built-in mail transport is not a production customer mail service.
3. In hosted Auth Email Templates, replace both **Confirm signup** and **Magic Link** content with `templates/email-code.html`. Configure six-digit OTPs, a ten-minute expiration and at least one minute between sends. The local `config.toml` and templates do **not** automatically update hosted Auth dashboard settings.
4. Authenticate the official Supabase CLI locally and link the intended project. Review the migration before applying it:

   ```sh
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push --dry-run
   npx supabase db push
   npx supabase functions deploy submit-request
   npx supabase functions deploy ai-assistant
   ```

5. Configure server secrets in Supabase. Do not put them in Expo, GitHub Pages, a public environment variable, or source control. Hosted functions receive Supabase URL/key variables automatically. `_shared/http.mjs` supports singular/plural publishable and secret keys, with legacy anon/service-role fallbacks. Use the AI handler's documented provider settings for that function.
6. Configure only the public Supabase URL and publishable key in the app build. Keep the service disabled in published clients until the following checks pass against the staging project, then production.

## Required hosted acceptance checks

### Client and AI configuration

The public app build reads `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (an `sb_publishable_` key). Leave both blank to preserve the offline/local preview. Partial or invalid configuration fails closed; a cloud error never redirects a request into a local inbox. Sessions are held only in memory: users verify email again after restarting or reloading. Sign-in itself never sends a contact request or a chat message.

For web deployment, set the matching **repository Variables** in GitHub; the Pages workflow already passes them to the Expo build. For native releases, set them in the intended EAS environment. They are public values, not secrets. Enable `EXPO_PUBLIC_ENABLE_LIVE_AI=true` only in a reviewed build after the backend acceptance checks pass. The new `expo-crypto` dependency requires a new native binary before distributing these changes through TestFlight; do not send an OTA update to the older binary.

Configure these **server-only** values in the Supabase Edge Function secrets manager:

| Name | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | A restricted project API key; never place it in client builds or chat |
| `OPENAI_MODEL` | A model available to the project; `gpt-5.4-mini` is an initial staging candidate, subject to output/latency evaluation |
| `AI_ENABLED` | Exact value `true` after configuration; omitted/false returns unavailable without calling the provider |
| `CORS_ALLOWED_ORIGINS` | Optional exact loopback origin(s) for a **separate development project** only |
| `ALLOW_LOCAL_DEVELOPMENT` | Exact value `true` to allow those loopback origins; leave unset on production |

`ai-assistant` authenticates a verified user, requires the chat-sharing consent flag, bounds message length/history, consumes a server-side quota, and calls OpenAI Responses with `store:false`. It returns completed text only and does not save chat content to Postgres. The user sees an explicit explanation before enabling chat. `store:false` is **not** a zero-retention claim: provider abuse-monitoring retention still applies. Do not send personal form drafts or uploaded documents to this endpoint.

No live model call has been tested yet. Run representative English/Russian navigation, legal uncertainty, prompt-injection, long-answer and timeout cases on staging before enabling AI for testers. Set provider budget alerts and retain the application quotas; a dashboard budget alert alone is not an enforced spend cap.

Choose Resend for custom SMTP and verify an owner-approved sending subdomain of `fillout.net` before configuring Supabase. This is service selection only: no account, subscription, sender identity, DNS record or mailbox has been created. The team's notification recipient remains unassigned. Automatic email delivery from the outbox needs a worker with retry/deduplication and a confirmed destination.

Before a public account-enabled release, implement and verify in-app account deletion/data erasure, publish approved privacy/retention terms, configure SMTP abuse protection, and review team permissions/backups. The current server/client changes are a staging integration, not a completed production launch.

References: [OpenAI Responses](https://developers.openai.com/api/docs/guides/text), [OpenAI data retention](https://developers.openai.com/api/docs/guides/your-data), [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini), [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Resend SMTP integration](https://resend.com/docs/send-with-supabase-smtp).

### Staging checks

- Sign up and sign in with an email OTP on both a phone and `fillout.net`; reject an expired/invalid token and an unconfirmed or anonymous account.
- Send a sample contact and attorney request, verify its stored row as an authorized reviewer, and confirm the receipt says saved without claiming email notification.
- Retry an identical request after a simulated network interruption; confirm one row and one outbox event. Send concurrent retries/new requests from separate sessions and check quota/concurrency behavior.
- Directly query with two different users' tokens and the anon key; verify owner-only reads and rejected writes/service RPCs. Confirm the private schema is not exposed by the hosted API.
- Confirm CORS failures from an unrelated site, malformed/oversized body rejection, no sensitive payload/token logs, and rotation/revocation of keys.
- Keep team notifications disabled until a recipient is explicitly configured and a worker's retry/idempotency behavior is verified. A saved request does not confirm any lawyer engagement, payment or government filing.

## Local checks and limitations

`node scripts/check-cloud-intake.mjs` exercises the handler through mocked Auth/network calls and executes the actual migration and SQL functions in PGlite's PostgreSQL engine. It verifies RLS/grants, receipts, replay/conflict behavior, database validation, intake limits and both AI quotas. PGlite uses minimal Auth fixtures; this does not verify hosted Supabase Auth, SMTP, the Edge gateway or multiple database sessions. No live credentials or real customer information are required for these tests.

Official references: [Auth on Edge Functions](https://supabase.com/docs/guides/functions/auth), [API keys](https://supabase.com/docs/guides/api/api-keys), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [database functions](https://supabase.com/docs/guides/database/functions), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [passwordless email](https://supabase.com/docs/guides/auth/auth-email-passwordless).
