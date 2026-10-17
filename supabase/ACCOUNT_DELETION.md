# Account and data deletion

Migration `20261011000200_account_deletion.sql` is recorded as applied on the existing `fillout-staging` project, and `delete-account` is `ACTIVE`, version 1, verified on October 12, 2026. Hosted synthetic acceptance passed; the matching 0.7.0 (9) app is available for internal TestFlight testing. See [deployment evidence](../docs/SUPABASE_STAGING.md).

The profile screen offers **Delete account and data**. It explains irreversible removal, requires the literal confirmation `DELETE`, and asks registered users to verify an email code. A guest can erase the local profile and drafts without a server connection.

The server authenticates an initial request through Supabase Auth `/user`, then checks that the same verified JWT contains a password/OTP authentication event within ten minutes. Refreshing a token or signing in on another device does not satisfy this check. The request never accepts a user ID. Browser CORS remains limited to the FillOut origins; native requests do not require an Origin header.

A service-only RPC records the SHA-256 hash of a randomly generated 256-bit deletion capability and the verified account ID. The Edge Function hard-deletes the account through the Auth Admin API. All existing account content is linked with cascading foreign keys: contact/attorney requests, notification outbox rows, customer/team Chat messages, AI usage records, and operator membership where installed. Auth also removes its associated identities/sessions. The receipt's account reference becomes null in the same database transaction. A failed cascade rolls back account deletion and leaves the receipt pending.

A lost response can be retried with the same secret even after the login session is removed. The receipt authorizes only the originally confirmed deletion; it cannot select another user. Only a committed receipt with a null owner confirms completion. The completed receipt contains no user ID, email, profile, or raw retry secret. No user content or tokens are logged by this function.

The device persists deletion intent before making the request, blocks form access and revokes old editor storage owners. It separately persists server confirmation, removes the account's drafts and associated guest data, securely erases the guest profile, removes the auth session, and creates an empty guest identity under a new draft namespace. Storage failures keep the operation pending and retryable after restart. Old PDF callbacks cannot recreate the deleted owner's drafts. Drafts belonging to other accounts on the device are preserved. Exported PDFs and drafts saved on other devices cannot be erased remotely by this device-local draft implementation.

## Deployment and acceptance

For another environment, review the migration and deploy to that intended project; do not reapply the migration on the current staging project:

```sh
npx supabase db push --dry-run
npx supabase db push
npx supabase functions deploy delete-account --project-ref YOUR_PROJECT_REF --use-api
```

`verify_jwt = false` is deliberate: initial authorization happens in the handler, and post-deletion retries may have no valid session. A random capability alone cannot initiate deletion of an account. Never expose a service key in the app or grant the deletion RPCs to `anon` or `authenticated`.

Run `node scripts/check-account-deletion.mjs`, `npm run test:accounts`, and `node scripts/check-cloud-client.cjs` locally. These tests use synthetic identities, mocked Auth transport, and real PostgreSQL migrations through PGlite. They do not send verification emails or delete live accounts.

Hosted acceptance on October 12 verified OTP-authorized deletion, Auth and related-record removal (including form reviews), lost-response retry, and preservation of another synthetic customer's data. Operator deletion also preserved the other customer's reviews and replies. Cleanup confirmed all three test users absent, zero related records and zero test deletion receipts. No email was sent. Evidence is in `tmp/release-0.7.0/hosted-acceptance.json`. Empty guest restart, local draft cleanup and failure recovery are covered by local tests; physical-iPhone behavior remains untested. Repeat hosted acceptance with disposable accounts when deploying another environment.

Deletion removes active application records. Infrastructure backup retention and any independently exported data require the published privacy/retention policy; the UI does not promise remote removal of exported files or other-device drafts.

Official references: [Supabase Admin deletion](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser), [user data and cascading references](https://supabase.com/docs/guides/auth/managing-user-data), [authenticated JWT AMR fields](https://supabase.com/docs/guides/auth/jwt-fields).

## Submitted form reviews

After migration `20261011000400_form_review.sql`, Auth hard deletion also cascades every `private.form_review_submissions` revision, including its answer snapshot and PDF bytes. Files are kept in this private table, with no external storage objects to orphan. Reviewer deletion clears the reviewer reference while preserving other clients’ submissions. Exported copies and database backup retention remain separate.
