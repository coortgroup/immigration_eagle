# AI payments — implementation and activation

## Current release configuration — October 17, 2026 (1.0.0 source)

The owner confirmed **one payment per application; reopening the same application is free**. The existing `fillout-staging` backend now defaults to **production** while accepting verified Apple sandbox purchases in an isolated test context. One genuine App Store sandbox I-90 transaction was verified earlier in RevenueCat and the ledger; **no real production transaction or public release has been verified**. Final native 1.0.0 build, website publication and App Store review submission remain pending.

- Applied `20261017000100_payment_environments.sql` and `20261017000200_attorney_referral_consent.sql`; eight migrations are now applied. Redeployed `ai-payment`, `form-review`, `revenuecat-webhook` and `submit-request`.
- Active server configuration: `AI_PAYMENTS_ENABLED=true`, `REVENUECAT_ENVIRONMENT=production`, `PAYMENTS_STAGING=false`, `REVENUECAT_ACCEPT_APP_STORE_SANDBOX=true`. App Review acceptance is restricted to verified **App Store** sandbox transactions; client-supplied environment/paid claims cannot grant access. Purchases, cases, package/add-on rights and reviews retain their environment. Sandbox review requires the explicit test queue and produces a labelled TEST file; unknown historical paid provenance is quarantined rather than treated as production.
- RevenueCat integration **FillOut Supabase** (`whintgrfa4c86a97c`) now uses **Both** environments with authorization and HMAC signing enabled. Actual provider `TEST` event `C40382A6-ABE4-44A7-BD0D-36BDB794035A` returned **HTTP 200**, `{received:true,test:true}`. TEST handling grants no access.
- Hosted checks passed before and after the production switch: authentication/RPC boundaries, forbidden client environment/owner/paid claims, status/prepare/cancel/reconcile, denied customer access to both operator queues, and **402** for an unpaid review. Synthetic accounts were deleted; these checks sent no email and made no store purchase or RevenueCat write. Evidence: `tmp/payment-environments/hosted-sandbox-validation.json` and `hosted-production-validation.json`.
- Read-only verification in `tmp/payment-environments/original-sandbox-after-cutover.json` preserves the original active sandbox transaction and its single case binding. It did **not** refresh the original user's expired reconciliation context or prove a successful reopen; that needs a normal owner session.
- Published the 0.8.0 compatibility OTA to the existing test channel: update `01a14afe-2cb7-70ea-8e7b-622d47b3438a`, group `1c4fa112-ad2b-45a4-a053-8db65a7911bf`. Delivery to a particular phone is not independently confirmed. The source is now **1.0.0**; EAS `production` enables native payments with `EXPO_PUBLIC_PAYMENT_TEST_BUILD=false`. The final 1.0.0 native build has not started; the OTA is not that binary.
- Attorney requests remain **free**, with `attorneyConsent=share-contact-and-question-v1` required by both handler and SQL. The owner manually forwards only consented contact details, selected form and question to independent attorneys; no automatic assignment or legal-service charge is implemented. Hosted validation and cleanup passed (`tmp/attorney-consent-hosted-smoke.jsonl`). Legacy requests without consent are not permission to forward.
- Remaining: final native/device tests including sandbox approval/download, reopening/restore/refund; Apple app/IAP metadata and submission; publish policy/support URLs; finish App Privacy; confirm the real operator account and public support email. See [launch readiness](LAUNCH_READINESS.md).

### Historical setup and initial sandbox activation — October 12–17, 2026

The following records preserve the earlier checks. Their sandbox-only flags, function versions and six-migration snapshot were superseded by the cutover above.

- RevenueCat project **FillOut USCIS**, REST API v2 project ID **`projc4d60d92`** (dashboard URL uses `c4d60d92`), App Store app `app4ad646c435`, bundle `com.coortgroup.immigrationeagle`. Use the full `proj`-prefixed ID for `REVENUECAT_PROJECT_ID`. Uploaded the owner-approved Apple in-app purchase key; RevenueCat reports **Valid credentials**. The broader App Store Connect metadata/import API credential is not configured; products were added manually.
- Apple app `6821241435` now has **14 consumable product drafts**, each with a draft version and English localization. Their `.case.v1` identifiers exactly match the 14 RevenueCat consumables. Initial prices and USA-only availability are saved and verified; automatic availability in new territories is off. Review screenshots and product review submission remain outstanding.
- `data/revenuecat-products.json` records the verified store SKU, RevenueCat product ID and app ID for every supported paid form. Use its JSON array as `REVENUECAT_PRODUCTS_JSON`; it contains no secrets. Direct SKU purchases do not require an offering or permanent entitlement.
- Saved and verified RevenueCat restore behavior **Keep with original App User ID**, with the same behavior for sandbox. Purchases remain associated with their original account.
- Apple production and sandbox Server Notification URLs both point to this RevenueCat app, with **V2** selected and API readback verified. The separate RevenueCat-to-Supabase sandbox webhook was configured and verified on October 17.
- The public iOS SDK key is set as the EAS project production variable `EXPO_PUBLIC_REVENUECAT_IOS_KEY`. The dedicated `payments-sandbox` EAS profile enables the native payment gate and test-build banner, uses its own update channel, and rejects a paid backend response unless its environment is sandbox. At that stage the production payment flags had not yet been changed. Native **0.8.0 (11)** passed all 33 IPA checks and is available in internal TestFlight: Apple `VALID`, `IN_BETA_TESTING`, not expired; EN/RU notes and existing Team (Expo) assignment verified. The user reports a successful purchase in this build; server evidence is recorded below.
- With the owner's explicit confirmation, created the v2 backend key **FillOut backend purchase verification**, with only purchase-read and product-read scopes. Live API verification returned HTTP 200 and matching active consumable metadata for all 14 products. A fresh nonexistent UUID returned HTTP 404 `resource_missing` from the purchase endpoint, confirming permission without reading a real customer's purchases. This is API connectivity verification, not a completed purchase.
- At initial sandbox activation, Supabase project `ceoliqoctkgwkphbmkiv` stored the server key, `REVENUECAT_PROJECT_ID=projc4d60d92`, the 14-product allowlist, `REVENUECAT_ENVIRONMENT=sandbox`, and `PAYMENTS_STAGING=true`. The initial six configuration digests matched before activation; `AI_PAYMENTS_ENABLED` was changed from `false` to `true` on October 17. Both webhook secrets are now stored and their digests matched. The temporary credential file was deleted; no secret is in app config, source or this document.
- Initially, RevenueCat integration **FillOut Supabase sandbox** (`whintgrfa4c86a97c`) targets this project's `/functions/v1/revenuecat-webhook`, with sandbox environment, app `app4ad646c435`, authorization and HMAC signing. An actual RevenueCat `TEST` returned **HTTP 200** with `{received:true,test:true}`. Missing authorization and an invalid signature each returned **401**. The signed `TEST` does not read purchases or grant access.
- Before the later cutover, CLI read-back on October 17 confirmed all six migrations through `20261012000100` applied, with none pending. `ai-payment` and `revenuecat-webhook` are **ACTIVE v3**; the updated `form-review` is **ACTIVE v5**. The migration enforces paid-case review access; old clients without `caseId` must update before submitting new paid reviews. Existing review lists and approved files remain available.
- Hosted checks before purchase passed with one synthetic verified account: password sign-in, sandbox I-90 status, purchase reservation, cancellation and reconciliation all succeeded; submitting an unpaid paid-form review returned **402**. The synthetic Auth user was deleted and absence verified. No email, store purchase or RevenueCat write occurred during this smoke test. The ledger may retain an anonymous unpurchased-case tombstone by design.
- Sanitized activation evidence: `tmp/revenuecat-setup/sandbox-activation-verification.json`, `webhook-secret-verification.json`, `webhook-delivery-verification.json`, `webhook-negative-checks.json`, and `hosted-payment-smoke.jsonl`. These retain the earlier checks before purchase. Later read-only purchase evidence is in `tmp/revenuecat-setup/sandbox-purchase-verification.json`.
- On October 17, the server ledger independently confirmed one active App Store sandbox purchase of `net.fillout.ai.i90.case.v1` at **17:05:21 UTC**, bound to exactly one I-90 case with matching ownership and no pending purchase reservation. Direct RevenueCat dashboard inspection matched the account, SKU, purchase time and `NON_RENEWING_PURCHASE` event in **SANDBOX DATA**, with a USD 140.99 test price and webhook status **Sent**. The same event was processed by Supabase at **17:05:25 UTC**, and reconciliation completed. At the read-only audit at 17:12 UTC, the five-minute verification window had expired, so the raw access check returned false while the active purchase binding remained intact; the next normal app request reconciles RevenueCat before checking access. The audit made no remote changes. Device completion in 0.8.0 (11) is user-reported; reopening, restore and refund still require testing. A Mac and iPhone Mirroring are optional; the agent cannot directly control the remote iPhone.
- The initial single-environment restriction was identified as an App Review blocker. The October 17 environment migration and deployed acceptance flag above resolve that routing limitation; end-to-end testing in the final native build remains outstanding.
- Saved and verified USA prices: I-485 **$399**, I-751 **$199**, I-864A **$43**; I-90/I-131/I-131A/I-134/N-565 **$140.99**; I-129F/I-130 **$214.99**; I-765 **$112.99**; I-864 **$183.99**; N-400/N-600 **$284.99**. These are actual configured store price points. The local verification report is `tmp/revenuecat-setup/apple-commerce-apply-result.json`.
- Native Release smoke verification passed on the iPhone 18 Pro simulator: home, the synthetic I-90 preliminary check, and the test payment gate with sign-in requirement. A launch failure with local Xcode 27 was fixed using Expo's supported `expo-build-properties` `ios.enableSceneSupport` option. The local native binary contains RevenueCat and the generated scene delegate. These checks do not confirm StoreKit purchase completion. The replacement 0.8.0 (11) EAS build is `e57d607a-22f2-4b28-a9cd-2bb91d5c2aad`; build 10 is superseded and was not submitted to Apple.

The native/shared app now places payment after a **passed preliminary check** and before paid AI questions, including resumed and legacy guided drafts. Free self-preparation and attorney intake do not enter checkout. AR-11 and G-1145 remain free. Review-only paths never ask for a payment; unsupported products remain unavailable. The preliminary check is not a legal eligibility determination.

- `src/payments.ts` uses RevenueCat's native SDK, the authenticated account UUID and the store's actual localized consumable price. Expo Go, browser previews, missing configuration and unavailable products cannot simulate a purchase.
- `AiPaymentGate.tsx` opens the questionnaire only after the authenticated backend confirms the case. It reconciles on opening, explicit checking and app foreground; cancellation and pending confirmation preserve the draft. The application must save successfully before checkout can appear.
- Each draft persists a random `paymentCaseId`, never a `paid` flag. The server assigns a verified transaction to one account, form and application. An existing paid case can be recovered after local state is lost instead of offering a second charge. Recovery restores **access**, not the locally stored answers.
- A purchase reservation and a local pending journal prevent another store charge after a double tap, delayed callback, restart or uncertain network result. A pending purchase is checked, never purchased again automatically. A reservation stranded before the store opened requires reconciliation/support; it is not discarded on an arbitrary timer. Account deletion erases that account's local pending journals after remote deletion succeeds.
- The backend reads RevenueCat API v2 current purchase state, verifies configured product/app/store/environment/ownership, and atomically redeems a unique purchase. Production and sandbox are separated. Signed webhooks verify the original bytes and timestamp, persist and deduplicate event identity, and reconcile current state; event delivery order does not grant access.
- Server package rights cover I-130 → I-130A, I-485 → I-130/I-130A, and the separately purchased I-864A add-on to I-864. Each included component has its own preliminary check and one component slot in the parent application; package payment does not establish eligibility. DACA/TPS and unpriced standalone resources are not offered for purchase.
- New review submissions require current paid-case access, including after a refund. The exact already-approved PDFs and legacy delivered files remain readable; refunds do not delete user documents. Corrections and resubmissions of the same application remain in the same purchase scope. The app currently stores one active local draft per form; this change does not introduce a multiple-applicant/case-management UI.

## Configuration reference for another environment

The shared release project completed the cutover above. Do not reapply its creation migrations. The following steps are a reference for another environment, not pending actions for the current project.

1. In **App Store Connect**, verify the Paid Apps Agreement, tax and banking prerequisites through the Account Holder (shown active during this setup). The 14 supported consumable products are registered as drafts. Choose actual available store price points and review their localized prices. Do not create the historical `.permanent.v1` SKUs below: this implementation uses the registered per-application `.case.v1` identifiers in `data/revenuecat-products.json`.
2. The **RevenueCat** project, iOS app, consumable catalog and Apple server notifications are configured as recorded above. Use the authenticated UUID as App User ID; verify restore/transfer behavior preserves ownership rather than moving paid applications between accounts. Configure Google Play notifications separately if enabling Android. [Expo installation](https://www.revenuecat.com/docs/getting-started/installation/expo), [one-time purchases](https://www.revenuecat.com/docs/platform-resources/non-subscriptions), [customer identity](https://www.revenuecat.com/docs/customers/identifying-customers).
3. Apply the migration chain in order through `20261017000200_attorney_referral_consent.sql`, including the payment ledger and environment migration. Deploy `ai-payment`, `revenuecat-webhook`, `form-review` and `submit-request` together. Keep the gate disabled until its backend configuration is ready. Old native clients without `caseId` cannot submit new paid reviews after enforcement is deployed; coordinate the new native release with this migration.
4. Configure only server secrets in Supabase: `AI_PAYMENTS_ENABLED`, `REVENUECAT_SECRET_API_KEY` (a **v2** secret with purchase-read and product-read permissions), `REVENUECAT_PROJECT_ID`, `REVENUECAT_ENVIRONMENT`, `PAYMENTS_STAGING`, `REVENUECAT_ACCEPT_APP_STORE_SANDBOX`, `REVENUECAT_PRODUCTS_JSON`, `REVENUECAT_WEBHOOK_AUTHORIZATION`, and `REVENUECAT_WEBHOOK_SIGNING_SECRET`. See `supabase/functions/.env.example`. Register the HTTPS `/functions/v1/revenuecat-webhook` URL in RevenueCat, enable HMAC signing, and use its signing secret. Both webhook secrets must be at least 32 characters. Do not paste secret keys into chat or public Expo variables.
5. The server allowlist contains real provider IDs, not just store SKUs:

```json
[
  {
    "formId": "I-90",
    "store": "app_store",
    "productId": "<actual consumable store SKU>",
    "revenueCatProductId": "<RevenueCat internal product ID>",
    "appId": "<RevenueCat iOS app ID>"
  }
]
```

6. A sandbox-only backend uses `REVENUECAT_ENVIRONMENT=sandbox`, `PAYMENTS_STAGING=true`. A shared release backend uses `REVENUECAT_ENVIRONMENT=production`, `PAYMENTS_STAGING=false`, and `REVENUECAT_ACCEPT_APP_STORE_SANDBOX=true` for App Review/TestFlight. Configure its RevenueCat webhook for Both environments. Sandbox provenance stays sandbox, including operator queue and PDF delivery. Enable `AI_PAYMENTS_ENABLED` only after the allowlist and secrets are ready.
7. Put only public platform SDK keys into the native build: `EXPO_PUBLIC_REVENUECAT_IOS_KEY=appl_…`, optionally `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=goog_…`, and `EXPO_PUBLIC_ENABLE_AI_PAYMENTS=true`. The current release source is **1.0.0** with a separate app-version runtime. The older 0.8.0 native binary already contains RevenueCat and received the compatibility OTA described above; 0.7.0 lacks that native module. Build and install a new native development/TestFlight binary; an OTA update or Expo Go cannot validate StoreKit payment.
8. Test a sandbox purchase, cancellation, pending approval, app restart, same-account restoration, account switch, lost local case ID, included package, duplicate/out-of-order webhook and refund. Confirm the actual approved PDF submission is denied without verified payment. The current production backend configuration is not evidence of a live charged transaction or Apple approval. Browser checkout remains unavailable in this implementation.

Local verification: `npm run test:payments`, `npm run test:review`, `npm run test:pdf`, `npm run typecheck`, `npm run build`. The tests exercise real embedded PostgreSQL migrations and application handlers with simulated store/provider responses; they are not evidence of a successful sandbox or live store purchase.

## Original planning reference — October 10, 2026

The following historical analysis explains the initial alternatives. The October 12 per-application choice and October 17 free attorney referral model supersede the permanent-access SKUs, attorney price targets and open decisions below. These historical prices are not offers in the current app.

Checked October 10, 2026 against official Apple and RevenueCat documentation. This is a technical plan, not a registered product catalog or approval of legal-service terms. No products, accounts, agreements, charges or refunds were created in this review.

### Recommended payment boundary

Use StoreKit purchases through RevenueCat for the iOS app's paid digital AI preparation features. Apple guideline 3.1.1 covers digital functionality unlocked inside an app. The current rules also allow external purchase links in the US storefront without the link entitlement; other storefronts have different conditions. Do not assume a single worldwide external-checkout rule. A StoreKit-first implementation avoids making launch depend on those regional alternatives. [Apple payment guidelines](https://developer.apple.com/app-store/review/guidelines/#payments)

Real-time services between two individuals may use other payment methods under 3.1.3(d). Services consumed outside the app fall under 3.1.3(e). **Asynchronous attorney document preparation is not automatically a real-time consultation.** Describe the actual service, delivery and included digital access before selecting its checkout route; obtain a classification review for the proposed attorney package. Keep attorney intake free and payment disabled until that scope is settled. This is an implementation inference from the rules, not an Apple approval. [Apple other purchase methods](https://developer.apple.com/app-store/review/guidelines/#other-purchase-methods)

The free self-preparation path stays free. Government fees are separate from company preparation fees and must not be collected or represented as paid by this integration.

### Decide what a one-time AI purchase buys

Apple defines a non-consumable as a purchase that does not expire or diminish through use. Therefore, one non-consumable per form fits permanent access to that form's supported preparation features. It does **not** fit repeatedly charging the same purchaser for a new case, renewal or another household member's application. If the intended offer is one completed application per purchase, use a consumable with a server-side redemption ledger instead, or define a different reviewed product model. Do not register the proposed permanent SKUs until the owner confirms that meaning, including future edition support and any separately disclosed AI usage limits. [Apple purchase types](https://developer.apple.com/help/app-store-connect/reference/in-app-purchases-and-subscriptions/in-app-purchase-types/)

RevenueCat supports one-time purchases, offerings and entitlements. A non-consumable can grant a durable entitlement. Attaching a consumable directly to that same durable entitlement is unsuitable for counting individual applications: RevenueCat can report access after the first purchase without tracking service consumption. Consumable fulfillment needs application-owned accounting. [RevenueCat non-subscription purchases](https://www.revenuecat.com/docs/platform-resources/non-subscriptions)

### Draft standalone AI product matrix

Numbers below exactly reproduce `eagleAi.serviceAmountUsd30` from `data/form-pricing.json`, the current default preview amounts. They are proposed USD business prices, not actual StoreKit prices or proof of the account's commission rate. All SKU strings are **unregistered drafts**. No product is ready for sale until its advertised interview/PDF scope is implemented and reviewed.

| Form/package | Draft permanent-access SKU | Existing USD target | Status / package constraint |
| --- | --- | ---: | --- |
| I-90 | `net.fillout.ai.i90.permanent.v1` | $141 | Candidate for first complete implementation |
| I-129F | `net.fillout.ai.i129f.permanent.v1` | $213 | Draft; supported K-1 scope needs review |
| I-130 | `net.fillout.ai.i130.permanent.v1` | $213 | Draft; includes I-130A |
| I-131 | `net.fillout.ai.i131.permanent.v1` | $141 | Draft; supported travel-document scenarios need definition |
| I-131A | `net.fillout.ai.i131a.permanent.v1` | $141 | Draft |
| I-134 | `net.fillout.ai.i134.permanent.v1` | $141 | Draft; process-specific scope needs definition |
| I-485 | `net.fillout.ai.i485.permanent.v1` | $399 | Draft bundle; G-1145, conditional I-130/I-130A included |
| I-751 | `net.fillout.ai.i751.permanent.v1` | $199 | Draft; routine and exceptional cases must be distinguished |
| I-765 | `net.fillout.ai.i765.permanent.v1` | $113 | Draft; avoid charging again within the DACA package |
| I-821D | `net.fillout.ai.i821d.permanent.v1` | $170 | Draft bundle; I-765/I-765WS/G-1145 included; current review-only route remains blocked |
| I-864 | `net.fillout.ai.i864.permanent.v1` | $184 | Draft; I-864A is additional, not included |
| N-400 | `net.fillout.ai.n400.permanent.v1` | $284 | Draft; supported scenarios need review |
| N-565 | `net.fillout.ai.n565.permanent.v1` | $141 | Draft |
| N-600 | `net.fillout.ai.n600.permanent.v1` | $284 | Draft; citizenship-basis review required |

These 14 sellable-price candidates are not 21 independent products. The other catalog entries require distinct treatment:

| Form | Existing AI price | Product treatment |
| --- | ---: | --- |
| AR-11 | Free | No paid SKU |
| G-1145 | Free | No paid SKU |
| G-639 | None | Official resource; no AI SKU |
| I-130A | Included | Grant only as the applicable component of I-130 or qualifying I-485 bundle; no separate charge |
| I-765WS | Included | DACA bundle component; no standalone price established |
| I-821 | None | Official resource; no AI SKU |
| I-864A | $43 per additional form | Requires I-864; repeated quantity makes a permanent unlock inconsistent with current per-form wording. Candidate consumable ID: `net.fillout.ai.i864a.case.v1`, pending quantity/redemption design |

Maintain a versioned server package graph. Package access is scoped to the purchased supported workflow; it must not silently grant unrelated standalone cases. A bundle purchase suppresses charges for its included components. Existing purchases, bundle upgrades and repeat cases need an explicit duplication/credit policy before checkout. For conditional I-485 components, do not infer qualification merely because the bundle was purchased.

### Prices and attorney scope

Choose real App Store Connect price points, base storefront, countries and tax category after owner approval. Exact target amounts may not exist as selectable points; show the concrete available choices before changing a business price. At checkout display StoreKit's localized product price through the SDK, not a hardcoded `$` amount or a runtime 30% markup. Handle unavailable products by disabling purchase. [Apple price schedules](https://developer.apple.com/help/app-store-connect/manage-in-app-purchases/set-a-price-for-an-in-app-purchase/)

The stored 30% assumption is not evidence of this account's actual commercial terms. Apple's reduced 15% program requires enrollment and qualifying account circumstances; do not switch prices or claim enrollment from the app being new. [Apple Small Business Program](https://developer.apple.com/app-store/small-business-program/)

Existing fixed attorney targets in `data/attorney-pricing.json`: G-639 $1,350; I-90 $725; I-129F $1,933; I-130 $1,838; I-131 $1,050; I-485 $2,750; I-751 $1,950; I-765 $1,125; I-821D $650; I-864 $850; N-400 $1,690; N-565 $1,175; N-600 $1,000. The other entries require a quote. These were historical owner-selected design targets derived from researched benchmarks; the October 17 free attorney contact request supersedes them in the release. They do not establish a contracted firm's commitment, supported case scope, included services or a client engagement. Do not turn them into billable products until those terms are supplied and approved.

### Purchase verification and fulfillment

The following is the proposed application design:

1. Bind RevenueCat to the authenticated user's stable random account UUID, never an email, device-global string or submitted immigration identity. Decide and test account-switch, restore and transaction-transfer behavior. Keep immigration answers and document identifiers out of payment metadata. [RevenueCat customer identity](https://www.revenuecat.com/docs/customers/identifying-customers)
2. The app fetches configured products/offerings. A successful SDK callback triggers server reconciliation; it must not directly write a client-controlled `paid: true`. The authenticated server looks up that account's provider purchase state and checks app, product, store, environment, ownership and revocation before granting the allowlisted capability. Sandbox purchases never unlock production service fulfillment.
3. Store immutable transaction identity separately from derived entitlements. Enforce uniqueness for transactions and webhook events. For a consumable, grant a credit once and atomically reserve/redeem it against a case; retries cannot charge or consume twice. Reject arbitrary product IDs, case IDs and entitlement names from clients.
4. Configure platform server notifications so one-time purchase refunds reach RevenueCat. Its documented one-time purchase flow requires these notifications for reliable refund updates on most stores. [RevenueCat refund notification requirement](https://www.revenuecat.com/docs/platform-resources/non-subscriptions)
5. Receive RevenueCat webhooks over HTTPS with authorization and enabled HMAC verification over the original request bytes, bounded timestamp tolerance and constant-time comparison. Durably enqueue before acknowledging; deduplicate and reconcile with the provider because events can arrive late or be replayed. Monitor failures and reconcile on purchase/restore as well. [RevenueCat webhook setup and verification](https://www.revenuecat.com/docs/integrations/webhooks)
6. Handle `NON_RENEWING_PURCHASE`, relevant cancellation/refund events, refund reversals and transfers. Recompute access from verified current state and the applicable product model; do not treat every subscription cancellation as immediate expiration. Preserve user-authored records while changing future paid access according to disclosed terms. [RevenueCat event meanings](https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields)

Keep the provider's secret API keys and webhook secret on the server. The mobile app receives only the designated public SDK configuration. Store transaction references, status and amounts needed for accounting; never log answers, full receipts or credentials. No unverified webhook may grant paid access.

### Setup and release gates

- Owner confirms permanent access versus per-case purchase, bundle scope, repeat-case/upgrade policy, refund terms and attorney delivery model.
- RevenueCat account/project and appropriate webhook-capable plan; App Store connection credentials; approved public/secret configuration placement; authenticated backend and reliable event processing.
- Apple Account Holder completes the Paid Apps Agreement and business/banking/tax setup. Product metadata, real price points and supported storefronts are configured, then products are submitted through App Store review. The existing TestFlight build is not proof that these commercial steps are complete. [Apple pricing prerequisites](https://developer.apple.com/help/app-store-connect/manage-in-app-purchases/set-a-price-for-an-in-app-purchase/)
- Install compatible RevenueCat native SDK and make a new development/TestFlight build. Expo Go only provides mock preview APIs for purchases; it cannot validate real StoreKit transactions. [RevenueCat Expo integration](https://www.revenuecat.com/docs/getting-started/installation/expo)
- Test success, cancellation, pending purchase, interrupted network, server delay, restored/reinstalled app, account switching, unknown product, duplicate/out-of-order events, refund/reversal, bundle duplication and consumable concurrency where applicable.
- Complete and review each advertised service before enabling payment for it. The PDF readiness report defines the outstanding document-generation gates: [PDF implementation](PDF_IMPLEMENTATION.md).

No dummy checkout, paid flag or real-money transaction is part of this review. Unconfigured products must remain unavailable rather than simulate a successful order.
