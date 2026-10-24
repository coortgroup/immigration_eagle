# Website release — updated October 24, 2026

The existing domain is **https://fillout.net/**, hosted by GitHub Pages from `coortgroup/immigration_eagle`. The browser app is `/app/`. No Sites project, new hosting account or DNS change is needed. The complete site/browser app and all six policy pages are published. Pages run `39056860863` succeeded for release source `11c3391c9d5edfe645acf075e9284d6bec534968`; HTTPS checks verified `/`, `/app/` and the six policy URLs, the updated browser bundle, all 21 form cards and 63 preparation columns. Evidence: `tmp/web-launch-restored-prices-live-verification.json`.

## Published URLs

| Page | English | Russian |
| --- | --- | --- |
| Privacy | https://fillout.net/privacy/ | https://fillout.net/ru/privacy/ |
| Support | https://fillout.net/support/ | https://fillout.net/ru/support/ |
| Terms | https://fillout.net/terms/ | https://fillout.net/ru/terms/ |

All six pages are generated as static HTML and work without JavaScript or login. The homepage links follow the chosen language. They describe email/phone authentication, local drafts without separate app encryption or cross-device sync, private submitted PDFs/answer snapshots and Chat, Apple/RevenueCat verification, one payment per application, and deletion limits. Payment/provider records are not represented as fully erased or anonymized. There is no invented review deadline, retention period or refund guarantee. Apple refund requests link to [Apple's instructions](https://support.apple.com/en-us/118223) and [Report a Problem](https://reportaproblem.apple.com/).

The homepage displays three columns for every form: free self-preparation, FillOut and attorney services, with all previously selected prices restored from the pricing data. Missing attorney prices remain “Quote required”; displayed service estimates are in USD and Apple confirms the final localized FillOut price. Attorney requests are free; legal services are paid directly to the attorney. Separate explicit consent authorizes the owner to manually share contact details, the selected form and question with independent attorneys. No automatic assignment, preparation guarantee or guaranteed refund is promised. The G-639 card retains the official online USCIS route.

## Contact readiness

The owner confirmed **peoplechat2@gmail.com** as the public support/privacy email. `web/policy-pages.mjs` now uses that address, with one mailto link on every EN/RU Privacy, Support and Terms page. Local generation verified all six pages; compared with the live policy pages, only the contact and updated date changed. This change includes the address on those pages; publication runs through GitHub Pages, and actual delivery is verified separately. Chat remains available after sign-in, and `no-reply@auth.fillout.net` remains an automated sender rather than a support inbox.

The same email is the intended FillOut operator account. The October 24 check found no registered account with that exact address, so registration and email verification are required before granting operator access. The hosted check found zero operators. The in-app role covers Chat and form reviews; attorney requests remain in Supabase Dashboard → `public.requests`, accessed separately through existing project permissions. No grant or message was performed by the website task. The repository does not establish a legal entity name or postal address; none was invented in the policies. The October 17 backend release deployed payment isolation and mandatory attorney consent; see [backend status](SUPABASE_STAGING.md).

## Website files for the coordinated release

The website source consists of these nine files. `tmp/web-launch-manifest.json` is a historical preparation snapshot; do not treat its older hashes as the current release manifest:

- `web/index.html`
- `web/main.js`
- `web/styles.css`
- `web/i18n.js`
- `web/translations-ru.json`
- `web/policy-pages.mjs`
- `web/policies.css`
- `scripts/build-website.mjs`
- `scripts/check-site.mjs`

`docs/WEB_LAUNCH.md` is release documentation. The coordinated release includes the current app/backend source and `.github/workflows/pages.yml` in addition to this website subset. Exclude `.local`, `tmp`, generated `site`/`dist-web` and credentials from the source commit. The website localization is self-contained and does not import the uncommitted app translation files.

Historical preparation: a clean archive of baseline `8867ca4d1b39fe1961120a582f8b1caae6c4446e` plus the initial website subset passed the full build. That earlier layout had 42 preparation columns and was later superseded by the restored three-column design. Current checks cover **21 form cards and 63 preparation columns**, all original numeric prices, six EN/RU policy documents, the G-639 online route and 104 local references. Chrome QA covered desktop and 320px EN/RU price layouts; earlier policy QA covered Privacy/Support/Terms without JavaScript. Existing historical evidence is retained.

The coordinated application release is now built as **1.0.0 (13)**, `VALID` and attached for review; build 12 is superseded. All 8 screenshots are `COMPLETE` and all 14 IAPs are `READY_TO_SUBMIT`. The app remains `PREPARE_FOR_SUBMISSION`: website publication is separate from App Review submission. The October 24 readback at 18:33:55 UTC confirmed free download (USD 0), USA-only availability, no automatic addition of new countries and no pre-order. Category `PRODUCTIVITY` and content rights `USES_THIRD_PARTY_CONTENT` are confirmed. Evidence: `tmp/release-launch/readiness-summary.json`.

A push to `main` triggers `.github/workflows/pages.yml`. This coordinated change includes the public contact and updated documentation; verify all six live mailto links after deployment. App Privacy is still unpublished and the Mac App Store Connect session has expired. The declaration can be completed by Account Holder, Admin or App Manager after sign-in; [APP_PRIVACY_DECLARATION.md](APP_PRIVACY_DECLARATION.md) records the selections. The initial app version and 14 IAPs must be submitted together through the App Store Connect UI: [Apple's API guide](https://developer.apple.com/documentation/appstoreconnectapi/managing-in-app-purchases) excludes this first submission from the review-submission API, while [the UI instructions](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-in-app-purchase/) describe the joint submission. No review submission or fresh Business status check is claimed here.

## USCIS edition audit

The October 17 read-only audit found **21/21 local PDF editions match current official USCIS sources**, with no concrete outdated edition identified. The local PDFs match their manifest hashes. The current G-639 PDF still exists, but its availability does not override the online FOIA filing instruction. Details, source URLs and edition transition dates: `tmp/web-launch-uscis-editions.json`. This verifies editions only, not completed-form answers or legal eligibility.
