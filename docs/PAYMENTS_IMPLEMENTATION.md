# Payment implementation plan

Checked October 10, 2026 against official Apple and RevenueCat documentation. This is a technical plan, not a registered product catalog or approval of legal-service terms. No products, accounts, agreements, charges or refunds were created in this review.

## Recommended payment boundary

Use StoreKit purchases through RevenueCat for the iOS app's paid digital AI preparation features. Apple guideline 3.1.1 covers digital functionality unlocked inside an app. The current rules also allow external purchase links in the US storefront without the link entitlement; other storefronts have different conditions. Do not assume a single worldwide external-checkout rule. A StoreKit-first implementation avoids making launch depend on those regional alternatives. [Apple payment guidelines](https://developer.apple.com/app-store/review/guidelines/#payments)

Real-time services between two individuals may use other payment methods under 3.1.3(d). Services consumed outside the app fall under 3.1.3(e). **Asynchronous attorney document preparation is not automatically a real-time consultation.** Describe the actual service, delivery and included digital access before selecting its checkout route; obtain a classification review for the proposed attorney package. Keep attorney intake free and payment disabled until that scope is settled. This is an implementation inference from the rules, not an Apple approval. [Apple other purchase methods](https://developer.apple.com/app-store/review/guidelines/#other-purchase-methods)

The free self-preparation path stays free. Government fees are separate from company preparation fees and must not be collected or represented as paid by this integration.

## Decide what a one-time AI purchase buys

Apple defines a non-consumable as a purchase that does not expire or diminish through use. Therefore, one non-consumable per form fits permanent access to that form's supported preparation features. It does **not** fit repeatedly charging the same purchaser for a new case, renewal or another household member's application. If the intended offer is one completed application per purchase, use a consumable with a server-side redemption ledger instead, or define a different reviewed product model. Do not register the proposed permanent SKUs until the owner confirms that meaning, including future edition support and any separately disclosed AI usage limits. [Apple purchase types](https://developer.apple.com/help/app-store-connect/reference/in-app-purchases-and-subscriptions/in-app-purchase-types/)

RevenueCat supports one-time purchases, offerings and entitlements. A non-consumable can grant a durable entitlement. Attaching a consumable directly to that same durable entitlement is unsuitable for counting individual applications: RevenueCat can report access after the first purchase without tracking service consumption. Consumable fulfillment needs application-owned accounting. [RevenueCat non-subscription purchases](https://www.revenuecat.com/docs/platform-resources/non-subscriptions)

## Draft standalone AI product matrix

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

## Prices and attorney scope

Choose real App Store Connect price points, base storefront, countries and tax category after owner approval. Exact target amounts may not exist as selectable points; show the concrete available choices before changing a business price. At checkout display StoreKit's localized product price through the SDK, not a hardcoded `$` amount or a runtime 30% markup. Handle unavailable products by disabling purchase. [Apple price schedules](https://developer.apple.com/help/app-store-connect/manage-in-app-purchases/set-a-price-for-an-in-app-purchase/)

The stored 30% assumption is not evidence of this account's actual commercial terms. Apple's reduced 15% program requires enrollment and qualifying account circumstances; do not switch prices or claim enrollment from the app being new. [Apple Small Business Program](https://developer.apple.com/app-store/small-business-program/)

Existing fixed attorney targets in `data/attorney-pricing.json`: G-639 $1,350; I-90 $725; I-129F $1,933; I-130 $1,838; I-131 $1,050; I-485 $2,750; I-751 $1,950; I-765 $1,125; I-821D $650; I-864 $850; N-400 $1,690; N-565 $1,175; N-600 $1,000. The other entries require a quote. These are current owner-selected design prices derived from researched benchmarks. They do not establish a contracted firm's commitment, supported case scope, included services or a client engagement. Do not turn them into billable products until those terms are supplied and approved.

## Purchase verification and fulfillment

The following is the proposed application design:

1. Bind RevenueCat to the authenticated user's stable random account UUID, never an email, device-global string or submitted immigration identity. Decide and test account-switch, restore and transaction-transfer behavior. Keep immigration answers and document identifiers out of payment metadata. [RevenueCat customer identity](https://www.revenuecat.com/docs/customers/identifying-customers)
2. The app fetches configured products/offerings. A successful SDK callback triggers server reconciliation; it must not directly write a client-controlled `paid: true`. The authenticated server looks up that account's provider purchase state and checks app, product, store, environment, ownership and revocation before granting the allowlisted capability. Sandbox purchases never unlock production service fulfillment.
3. Store immutable transaction identity separately from derived entitlements. Enforce uniqueness for transactions and webhook events. For a consumable, grant a credit once and atomically reserve/redeem it against a case; retries cannot charge or consume twice. Reject arbitrary product IDs, case IDs and entitlement names from clients.
4. Configure platform server notifications so one-time purchase refunds reach RevenueCat. Its documented one-time purchase flow requires these notifications for reliable refund updates on most stores. [RevenueCat refund notification requirement](https://www.revenuecat.com/docs/platform-resources/non-subscriptions)
5. Receive RevenueCat webhooks over HTTPS with authorization and enabled HMAC verification over the original request bytes, bounded timestamp tolerance and constant-time comparison. Durably enqueue before acknowledging; deduplicate and reconcile with the provider because events can arrive late or be replayed. Monitor failures and reconcile on purchase/restore as well. [RevenueCat webhook setup and verification](https://www.revenuecat.com/docs/integrations/webhooks)
6. Handle `NON_RENEWING_PURCHASE`, relevant cancellation/refund events, refund reversals and transfers. Recompute access from verified current state and the applicable product model; do not treat every subscription cancellation as immediate expiration. Preserve user-authored records while changing future paid access according to disclosed terms. [RevenueCat event meanings](https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields)

Keep the provider's secret API keys and webhook secret on the server. The mobile app receives only the designated public SDK configuration. Store transaction references, status and amounts needed for accounting; never log answers, full receipts or credentials. No unverified webhook may grant paid access.

## Setup and release gates

- Owner confirms permanent access versus per-case purchase, bundle scope, repeat-case/upgrade policy, refund terms and attorney delivery model.
- RevenueCat account/project and appropriate webhook-capable plan; App Store connection credentials; approved public/secret configuration placement; authenticated backend and reliable event processing.
- Apple Account Holder completes the Paid Apps Agreement and business/banking/tax setup. Product metadata, real price points and supported storefronts are configured, then products are submitted through App Store review. The existing TestFlight build is not proof that these commercial steps are complete. [Apple pricing prerequisites](https://developer.apple.com/help/app-store-connect/manage-in-app-purchases/set-a-price-for-an-in-app-purchase/)
- Install compatible RevenueCat native SDK and make a new development/TestFlight build. Expo Go only provides mock preview APIs for purchases; it cannot validate real StoreKit transactions. [RevenueCat Expo integration](https://www.revenuecat.com/docs/getting-started/installation/expo)
- Test success, cancellation, pending purchase, interrupted network, server delay, restored/reinstalled app, account switching, unknown product, duplicate/out-of-order events, refund/reversal, bundle duplication and consumable concurrency where applicable.
- Complete and review each advertised service before enabling payment for it. The PDF readiness report defines the outstanding document-generation gates: [PDF implementation](PDF_IMPLEMENTATION.md).

No dummy checkout, paid flag or real-money transaction is part of this review. Unconfigured products must remain unavailable rather than simulate a successful order.
