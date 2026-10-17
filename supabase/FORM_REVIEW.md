# FillOut form review

The FillOut guided flow submits a completed PDF to a human reviewer before the customer can download or print it. This applies to all 21 supported form codes. The separate free/manual editor is unchanged. Saving a local draft does not submit it. The customer must verify an email account and explicitly send the completed form and answer snapshot.

## Deployment

Migrations through `20261011000400_form_review.sql`, including support operator access, are recorded as applied on `fillout-staging`; `form-review` is `ACTIVE`, version 1, verified on October 12, 2026. For another environment, apply those migrations and deploy the function there. The function verifies its Bearer token with Supabase Auth; `verify_jwt = false` in the gateway is intentional. The app requires the matching release and public Supabase configuration; 0.7.0 (9) is available for internal TestFlight testing. No real owner was assigned or real customer's form submitted by the release checks.

The same private `support_operators` membership used for client messages grants access to the review queue. Provision the owner's exact verified Auth user ID using the administrator procedure in [SUPPORT_CHAT.md](SUPPORT_CHAT.md). An email address, `user_metadata` claim, or client-supplied role never grants access. Every data RPC rechecks membership. No owner identity has been selected automatically.

## Lifecycle

1. The customer confirms the answers and selects **Send for review**. The app generates the completed PDF, then sends it with its answer snapshot and a UUID request ID over authenticated HTTPS.
2. The server stores an immutable revision as `pending`. The PDF, SHA-256 hash, answer snapshot and original request ID stay together. The customer's account is taken from the verified token.
3. A team member opens the exact submitted PDF in the review inbox. The team member can approve it or request corrections with a note. A correction note is required; approval notes are optional. Decisions are attributed to the verified reviewer.
4. Only `approved` current revisions are downloadable by their owner. The file endpoint rechecks authorization on every read and returns the exact stored bytes and hash. The backend also verifies the stored file's hash before delivering it. Download and print use this approved file.
5. A corrected form is a new submission with a new request ID. It supersedes the previous revision, including any previous approval, and requires review again. Superseded revisions cannot be approved or downloaded by either customers or reviewers. Older copies already exported outside the app cannot be revoked.

Submissions and decisions serialize on the customer's form, so an old open reviewer screen cannot approve a revision after it has been replaced. Lost-response retries with the same request ID and exact PDF/answers return the original revision, even when that revision is now superseded. Reusing a request ID with different content fails. Decision retries are accepted only for the same reviewer, decision and note; a competing or altered decision fails.

The inbox is the delivery mechanism. No external email or push notification is implied, and no background notification worker is enabled by this change. Review status updates appear when the customer refreshes or reopens the application.

## Storage and access

`private.form_review_submissions` stores PDFs as bounded Postgres `bytea` values rather than a public bucket or signed public links. The table has RLS, no customer or anonymous table grants, and service-only RPCs. The API never returns answer snapshots or raw file bytes in metadata summaries. Customers cannot assign statuses, choose another owner, or directly call the service-only RPCs. Reviewer metadata includes the customer's email only in the role-protected inbox.

Each PDF is limited to 8 MiB, must be canonical base64, and must have a PDF header and an EOF marker near the end. These are transport/integrity checks, not a legal-content check or a complete PDF security sanitizer; reviewers should treat submitted PDFs as untrusted documents. The answer object is limited to 512 KiB and string or string-array values. Notes are limited to 2,000 characters and 6,000 UTF-8 bytes. Submissions are limited to 10 per hour, 30 per day and 256 MiB of retained PDF data per account. Idempotent retries do not consume another quota entry.

Only this Edge Function accepts a 12 MiB request envelope. Only its file RPC permits a 12 MiB upstream JSON response; its list and inbox RPCs permit 256 KiB to fit bounded Unicode notes. All other service RPCs retain their existing 64 KiB limit. Both request and upstream fetches retain the shared time limits and no-store responses. Logs do not include forms, answers, PDFs, tokens or raw database diagnostics.

Account deletion cascades from `auth.users` to every submission, including old revisions, answer snapshots and PDF bytes, in the same database operation. There is no separate storage object to orphan and no additional cleanup token. Deleting a reviewer removes their attribution while retaining other customers' submissions and review decisions. Previously downloaded files and ordinary platform backup-retention policies are outside this application's active-data cascade.

## Endpoint contract

`POST /functions/v1/form-review` accepts a JSON object:

- `submit`: `{ action, requestId, formId, pdfBase64, answers }` returns HTTP 201 `{ submission }`.
- `list`: `{ action: "list" }` returns `{ submissions }`, one current revision per form, at most 21.
- `inbox`: `{ action: "inbox", before?: { submittedAt, id } }` returns `{ submissions, hasMore, nextBefore }`, newest first with up to 20 current revisions. Inbox summaries also include `userId` and `email`.
- `file`: `{ action: "file", submissionId }` returns `{ submissionId, formId, pdfBase64, sha256 }`. A verified owner can fetch only an approved current revision; a verified operator can fetch any current revision.
- `decide`: `{ action: "decide", submissionId, decision: "approved" | "changes_requested", note }` returns `{ submission }`.

A submission summary is `{ id, requestId, formId, status, submittedAt, reviewedAt, reviewNote, sha256 }`. Statuses are `pending`, `changes_requested`, `approved` and `superseded`. `reviewedAt` is nullable. `reviewNote` is an empty string until review. Timestamps preserve their original database representation for pagination. Unknown input keys are rejected.

Run `node scripts/check-form-review.mjs` for the local PGlite endpoint/database tests. They cover all form codes, verified ownership, blocked pre-approval download, exact bytes, correction/resubmission, stale approvals, retries and conflicts, quota preservation, reviewer revocation, cursor ties, bounded responses, role grants/RLS and account deletion. They use synthetic content only.

## Local verification — October 11, 2026

`npm test`, `npm run test:pdf`, `npm run build` and `npm run export:native` passed. `test:review` includes the backend, transport/integrity, reviewer and My Application lifecycle checks. Guided-screen checks cover consent, completion, saved guest sign-in handoff, exact-payload retries, approved-file delivery after local edits, account changes and stale asynchronous downloads. The mobile browser check used synthetic G-1145 answers and verified the review consent/login screen, with no immediate download or print action. No live form was submitted and no real account was changed. Hosted gateway/concurrent-session acceptance and physical-device printing remain release checks.

## Hosted verification — October 12, 2026

The release acceptance passed 13 grouped checks, including concurrent idempotent submissions, customer isolation, pending and superseded download gates, reviewer access to exact submitted bytes, corrections and resubmission, stale-decision rejection, exact approved downloads, approval replacement, operator revocation and deletion cascades. Three synthetic users and their records/receipts were removed afterward; no email was sent and no real operator was granted. Evidence: `tmp/release-0.7.0/hosted-acceptance.json`. Local application/PDF tests, the web/site build, iOS export and signed IPA checks also passed. Physical-device printing and the owner's operator activation remain open.
