# Human support Chat

The Chat tab sends messages to `support-chat` using a verified account. It does not call an AI provider. Guests may compose a message; Login opens account access and sending remains a separate action. A message is shown as Sent only after a matching server storage receipt. This label does not mean an operator has read it.

The `20261011000100_support_chat.sql` migration is applied to the existing `fillout-staging` project and `support-chat` is deployed and active. Migration history is reconciled for both the preceding cloud-intake migration and support Chat. The EAS production environment supplies this project's public URL/key to the new native build. This environment name does not refer to a separate production Supabase project. See [deployment evidence](../docs/SUPABASE_STAGING.md).

For another project, apply the cloud-intake migration before the support migration, deploy `functions/support-chat`, and configure the app's public Supabase URL/key. An unavailable service shows an error and retains the composer text. No external email/push notification worker is configured.

## Team replies

Version 0.7.0 includes **Client messages** inside the Chat tab for an authorized owner account. It lists client emails, latest messages and conversations awaiting a reply. Opening a client shows the history and an explicit Send reply action. Replies appear to customers as FillOut team. A failed send retains the reply and reuses its message ID on retry. Polling runs while the screen is active; this is not an external notification service.

The inbox migration `20261011000300_support_inbox.sql` is recorded as applied and `support-inbox` is `ACTIVE`, version 1, verified on October 12, 2026. The matching 0.7.0 (9) app is available for internal TestFlight testing. For another project, apply that migration after support Chat and deploy `functions/support-inbox`. The app receives only the normal public configuration. Provision the verified owner's existing Auth UUID in `private.support_operators` using a trusted administrator session:

```sql
insert into private.support_operators(user_id)
select id from auth.users
where id = 'REPLACE_WITH_VERIFIED_OWNER_AUTH_UUID'::uuid
  and email_confirmed_at is not null and is_anonymous = false
on conflict do nothing;
```

Resolve that UUID from the owner's confirmed FillOut email, verify the account match, then grant exactly that account. No owner email/UUID has been supplied or granted in this source change. Never put service keys in the client or authorize roles from editable user metadata. Normal clients cannot read/change the role table or call operator RPCs; each server request verifies Auth and each data RPC rechecks membership. Remove the membership to revoke access. Deleting a customer cascades their conversation; deleting an operator removes membership and nulls reply attribution while preserving other customers' conversations.

Hosted acceptance confirmed replies visible only to the intended synthetic customer, retries without duplication, immediate rejection after operator revocation, and preserved customer conversations after deleting the test operator. All synthetic accounts, role memberships and messages were removed. Repeat these checks with disposable accounts for another deployment; do not use real customer conversations.

### Existing dashboard fallback

Authorized operators can use the Supabase dashboard Table Editor for `public.support_messages`, sorted by `created_at`, and group or filter by `user_id`. To reply, insert a row with the conversation's existing `user_id`, `sender = team`, and the reply in `body`. Leave `id`, `created_at`, and `client_message_id` at their defaults. The database permits at most 2,000 characters and 6,000 UTF-8 bytes. Do not change existing rows to send a reply.

Customer clients have read access only to their own conversation. Only the server may create customer messages, with `user_id` derived from the verified access token and `sender` fixed to `customer`. Sending is idempotent per account/message UUID and limited to 30 new customer messages per rolling hour. The Chat screen refreshes while visible and active; earlier messages are available through pagination.

## Verification

- `node scripts/check-support-chat.mjs` exercises the HTTP boundary and actual migration in PGlite: storage, operator replies, owner isolation/RLS, denied customer writes, retries, pagination, Unicode size bounds, quotas and failed storage.
- `node scripts/check-support-chat-client.cjs` checks receipt validation, failed-send preservation, retry IDs, account disposal, concurrency and history catch-up.
- `node scripts/check-support-localization.cjs` checks the Russian Chat UI and preserves the user's message when switching languages or opening Login.
- `node scripts/check-support-inbox.mjs` and `node scripts/check-support-inbox-client.cjs` check operator access, conversation isolation, pagination, reply receipts and retries. They use synthetic local data only.

The local tests above use synthetic messages and mocked Auth. Separate hosted acceptance passed 13 checks covering password and eight-digit OTP access, recovery, session restoration and refresh, real customer-message storage, a team reply and account isolation. The three synthetic users were deleted and no test messages remain. Version **0.6.0 (8)** is available for internal TestFlight testing as of October 11, 2026, and its signed IPA passed signature, SecureStore, public configuration and PDF asset checks. These results validate the deployed Auth/Chat path and packaged release; physical-device testing remains open.

The October 12 release acceptance added 13 grouped hosted checks for operator inboxes, form reviews and deletion, including the reply/revocation checks above. Cleanup confirmed all three synthetic users absent and zero test records or deletion receipts; no email was sent and no real operator was granted. The signed **0.7.0 (9)** IPA passed verification; Apple confirms internal TestFlight availability (`VALID`, `IN_BETA_TESTING`, not expired). Evidence is in `tmp/release-0.7.0/hosted-acceptance.json` and [release notes](../docs/RELEASE.md#fillout-070--guided-forms-review-and-account-deletion). Owner activation and physical-device testing remain open.
