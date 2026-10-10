# Local review

Run `npm run local` from the repository. This builds the web app and landing page, then starts the local service. If the site is already built, use `npm run local:serve`.

| Page | Address |
| --- | --- |
| Website and form finder | http://127.0.0.1:4177/immigration_eagle/ |
| Expo app in the browser | http://127.0.0.1:4177/immigration_eagle/app/ |
| Team inbox on this Mac | http://127.0.0.1:4177/local-inbox/ |

The original design prototype on port 4175 and static preview on port 4176 are older preview entry points. Use 4177 for testing local contact delivery. Only the local computer can reach the inbox; nothing is emailed or sent to an outside team.

## Things to try

1. On the website choose a status and goal. Results show three parallel preparation choices and prices. Open a result with **Start filling out form**; the app opens that specific form.
2. Compare the eight main forms and expand **All other forms** for the remaining thirteen. Amounts are whole dollars, and attorney prices have no approximate symbol. Government fees are separate.
3. Open I-129F and choose any preparation option. Answer **No** to “Is the petitioner a U.S. citizen?” to see the stopped path. **I’m not sure** leads to individual review. No preparation action opens until the preliminary check passes.
4. For a sample K-1 path, answer **Yes, Yes, No, Yes, Yes, Yes**. The congratulations screen leads to the official fillable PDF, the guided interview, or attorney intake depending on your chosen option. These are test answers, not advice about a real case.
5. In guided preparation enter sample details and choose **Save for later**. Open **My Application**, reload the browser, and continue the saved form. Multiple different forms can be saved on the device. Removing a saved draft asks for confirmation.
6. Open **FILLOUT AI → Contact us**, enter a sample name, an email address or phone number, and a question. Review it, then choose **Send request to local team**. Its receipt ID should appear in the local inbox. The attorney path follows the same local delivery pattern.

## Data and service boundaries

- Saved drafts use browser/device storage. They are not backed up to a cloud account. Use sample details on shared computers.
- Requests are stored in `.local/requests.json`, which is excluded from Git and the website build. The inbox shows their local receipt IDs and makes no claim that an email or call occurred.
- FILLOUT AI chat uses clearly labeled example responses. Guided interviews collect introductory answers; they do not yet create a complete USCIS filing PDF. Self-preparation opens the official USCIS PDF or service.
- Qualification checks are preliminary. Complicated or uncertain cases require review; the app does not issue legal eligibility decisions.
- No payments, government submission, shipping, live AI provider, production contact delivery, or cloud accounts are connected.
- GitHub Pages can serve the website and browser app. It cannot run the local inbox API. Deployment can be completed after normal GitHub sign-in.

## Checks

```sh
npm test
npm run build
npm run export:native
npm run doctor
```

For Expo Go use `npm start -- --go`. Native compilation and TestFlight setup are described in [RELEASE.md](RELEASE.md).

## Verification on October 9, 2026

The production web build and iOS/Android JavaScript exports pass. Automated checks cover all 21 forms, qualification paths, search and saved-draft resume, concurrent durable storage, local API boundaries, and generated website asset links. Expo Doctor passes all 18 checks. Builds use Metro's Node watcher so an unavailable Watchman daemon does not stall them.

The updated port-4177 page has not been visually checked in the browser: browser access was refused. Native iOS compilation still requires the user to accept Xcode's license; JavaScript exports are not signed application binaries. GitHub publishing is intentionally deferred until the user returns and signs in.
