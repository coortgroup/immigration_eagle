# Supabase staging deployment

Recorded on 2026-10-10. This environment is for acceptance testing, not production customer intake.

## Resources

- Organization: FILLOUT IMMIGRATION FORMS, Free plan.
- Project: `fillout-staging`, reference `ceoliqoctkgwkphbmkiv`.
- Region observed in dashboard: Canada (Central), `ca-central-1`. Review the production region separately before storing customer information.
- [Project dashboard](https://supabase.com/dashboard/project/ceoliqoctkgwkphbmkiv).
- Public API root: `https://ceoliqoctkgwkphbmkiv.supabase.co`.
- Public client configuration is saved locally in ignored `.env.staging.local`; it contains only the URL, publishable key and `EXPO_PUBLIC_ENABLE_LIVE_AI=false`. It is not automatically loaded into the normal production build. No service key is in that file.

## Applied changes and evidence

- Applied `supabase/migrations/20261010000100_cloud_intake.sql` once through the SQL Editor as `postgres`, wrapped in one transaction. Result: success.
- Migration history has **not** been registered with the CLI. Reconcile it before any future `db push`; do not execute the creation migration a second time.
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
- Exactly one authorized OTP request to `coortgroup@gmail.com` returned **HTTP 200** at **2026-10-10T06:48:07.752Z**, with no retries. Resend confirms message **`01a12491-a6fa-794d-8d4a-457e3041fe7a`**, subject `Your FILLOUT verification code`, as **Delivered**. Owner receipt, inbox placement and verified-user sign-in remain unconfirmed.
- Local cloud tests, TypeScript checking, complete website build and generated-site checks passed after the eight-digit OTP update.

## Remaining before connected testing

1. Confirm owner receipt and inbox placement of the delivered test email, then verify eight-digit code sign-in, repeat request throttling and invalid/expired code handling.
2. Submit synthetic contact and attorney requests through authenticated clients; check receipts, idempotent retry, two-user isolation and simultaneous quota enforcement.
3. Configure the OpenAI project/key/model and test answers before enabling AI. The deployed function currently fails closed without provider configuration; no live AI provider request has been made.
4. Confirm the team's notification destination and implement the outbox worker. A saved request currently does not send an email.

No production website or TestFlight client was switched to this backend. The existing TestFlight binary needs replacement before distributing the new native dependency. Production readiness, PDF completion and payment work remain separately documented.
