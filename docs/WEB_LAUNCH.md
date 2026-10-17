# Website release — October 17, 2026

The existing domain is **https://fillout.net/**, hosted by GitHub Pages from `coortgroup/immigration_eagle`. The browser app is `/app/`. No Sites project, new hosting account or DNS change is needed. Public HTTPS checks returned 200 for `/` and `/app/`; the six new policy URLs are not published yet. Evidence: `tmp/web-launch-hosting.json`.

## Prepared URLs

| Page | English | Russian |
| --- | --- | --- |
| Privacy | https://fillout.net/privacy/ | https://fillout.net/ru/privacy/ |
| Support | https://fillout.net/support/ | https://fillout.net/ru/support/ |
| Terms | https://fillout.net/terms/ | https://fillout.net/ru/terms/ |

All six pages are generated as static HTML and work without JavaScript or login. The homepage links follow the chosen language. They describe email/phone authentication, local drafts without separate app encryption or cross-device sync, private submitted PDFs/answer snapshots and Chat, Apple/RevenueCat verification, one payment per application, and deletion limits. Payment/provider records are not represented as fully erased or anonymized. There is no invented review deadline, retention period or refund guarantee. Apple refund requests link to [Apple's instructions](https://support.apple.com/en-us/118223) and [Report a Problem](https://reportaproblem.apple.com/).

The homepage no longer promises a preparation guarantee or displays obsolete approximate prices. It offers a free attorney contact request, with no in-app legal-service charge or automatic assignment. Privacy, Terms and Support describe separate explicit consent for the owner to manually share contact details, the selected form and question with independent attorneys who may contact the user directly. Paid products show “In-app price”; the Apple confirmation screen supplies the localized amount. The G-639 card directs users to USCIS because the current [FOIA instructions](https://www.uscis.gov/records/request-records-through-the-freedom-of-information-act-or-privacy-act) generally require online requests. This does not assert legal eligibility or filing readiness.

## Contact readiness

The confirmed service channel is Chat in the current native app after sign-in. A public support/privacy email is awaiting the owner's answer. `web/policy-pages.mjs` exports `supportEmail = null`; replace it only with the owner's confirmed public address and rebuild. No address has been invented. The existing `no-reply@auth.fillout.net` sender is identified only as automated account email, not as a support inbox. The owner OTP-test address is not published.

The repository does not establish a legal entity name or postal address, so these are not invented in the policies. The original website preparation made no operator grants or email deliveries. Separately, the October 17 backend release deployed payment isolation and mandatory attorney consent; see [current backend status](SUPABASE_STAGING.md). The real operator account is still awaiting confirmation.

## Website files for the coordinated release

`tmp/web-launch-manifest.json` records SHA-256 hashes for these nine deployable source files:

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

For compatibility verification, a clean archive of published HEAD `8867ca4d1b39fe1961120a582f8b1caae6c4446e` plus this subset passed `PAGES_BASE_PATH='' npm run build` (TypeScript, Expo web export, website generation and site checks). The final site checks cover 21 form cards, 42 preparation columns, six EN/RU policy documents, the G-639 online route and 104 local references. Chrome QA covered desktop English Privacy, switching to Russian, and 320px Privacy/Support/Terms and Russian homepage layouts. No publication was performed by this task.

A fresh full website/browser build and QA passed after the current source changes, as confirmed by the release coordinator. The source is now 1.0.0 and the coordinated release is being prepared with the current browser app, attorney-request consent and native changes. The final native build has not started; neither the website nor an App Review submission has been published/completed. Include these website files in that release; do not publish the old 0.4.0 browser app as the final release. A website-only commit on the earlier baseline would retain its obsolete guarantee/contact behavior even though the policy pages are new.

A push to `main` triggers `.github/workflows/pages.yml`. The GitHub CLI is not signed in, but root verified the existing SSH remote. After the coordinated source passes required checks, root can publish through that remote, monitor the Pages workflow and verify all six HTTPS URLs return 200 with the prepared content. Add the English/Russian Privacy and Support URLs to their App Store Connect localizations after live verification. App Privacy completion is pending with the owner on iPhone; [APP_PRIVACY_DECLARATION.md](APP_PRIVACY_DECLARATION.md) records the audited selections. A confirmed public support email remains needed as an accessible alternative for users who cannot sign in; the current native app's Chat and the new browser app should be verified separately.

## USCIS edition audit

The read-only audit found **21/21 local PDF editions match current official USCIS sources**, with no concrete outdated edition identified. The local PDFs match their manifest hashes. The current G-639 PDF still exists, but its availability does not override the online FOIA filing instruction. Details, source URLs and edition transition dates: `tmp/web-launch-uscis-editions.json`. This verifies editions only, not completed-form answers or legal eligibility.
