# Device and TestFlight testing

## Expo Go now

1. `npm ci`
2. `npx expo login`, then sign in to the same account in Expo Go on the phone.
3. `npm start -- --go`
4. Open the QR code in Expo Go for **SDK 57**. For a physical iPhone, both the SDK version and the signed-in account must match. The computer and phone should share a network; use the remote tunnel flow below when that is not possible.

The custom launcher icon/splash belong to a built app. Expo Go runs this project inside the Expo Go container; it does not replace the Expo Go home-screen icon.

## Remote Expo Go testing

When the phone is on a different network from the Mac:

```sh
npm run start:remote
```

First sign in on both devices. If the Mac is being controlled remotely, run `npx eas-cli login --device` and complete the displayed Expo sign-in URL on the phone. Keep passwords and access tokens out of chat and Git. The remote launcher checks the Mac's account before starting, because an anonymous tunnel can return HTTP 200 while still being rejected by iPhone Expo Go.

This starts an Expo tunnel on port 8082 and prints a public Expo Go link and QR code. Open that link on the phone with Expo Go installed and signed in to the same account. The tunnel uses a generated `exp.direct` hostname; a fixed public IP is not required. The Mac, Metro server and tunnel must stay running and connected to the internet. Stop the session with Ctrl+C. To choose another local port, use `npm run start:remote -- 8083`.

A tunnel is a development server, not an EAS cloud build. It does not create a build entry in the Expo dashboard. See [Expo's current iPhone sign-in rules](https://docs.expo.dev/troubleshooting/expo-go-sign-in-required/).

The launcher skips an incomplete local Android SDK for this process only because remote Expo Go does not require ADB. It does not modify the SDK or shell settings. The local team inbox is not exposed through this tunnel; contact delivery in the native preview remains unconnected.

## Expo-hosted preview

An EAS Update can host this app's JavaScript and assets for Expo Go without keeping the Mac running. This is a published preview, not an Apple-signed app or an entry under EAS Builds. The project uses Expo Go-compatible libraries and SDK 57.

The project is now linked to [@coortgroup/immigration-eagle](https://expo.dev/accounts/coortgroup/projects/immigration-eagle), ID `9fc8959b-6ce7-436b-b512-8d0f7fe2e081`. The current published preview group is `b719349c-1095-457a-8f98-19ee9e315940`: [open in Expo Go](https://expo.dev/preview/update/expo-go?projectId=9fc8959b-6ce7-436b-b512-8d0f7fe2e081&group=b719349c-1095-457a-8f98-19ee9e315940). Sign in to Expo Go as `coortgroup`; Expo requires authorized account access to this preview. The hosted iOS and Android manifests identify SDK 57, and the downloaded bundles, icon artwork and font match their SHA-256 hashes. Physical phone testing still needs confirmation on the device.

For subsequent updates, preserve the project configuration and run step 4 below. Steps 1–3 describe the initial setup and recovery on another computer:

1. Sign in with `npx eas-cli@latest login --device` (or `npx expo login`).
2. Create or link the project with `npx eas-cli@latest init --account YOUR_EXPO_ACCOUNT --non-interactive --json`.
3. Preserve the returned project ID in `app.config.ts`: set `owner` to the authenticated account, `extra.eas.projectId` to that ID, `updates.url` to `https://u.expo.dev/PROJECT_ID`, and `runtimeVersion` to `{policy:'appVersion'}`. Keep the existing `extra` fields. Dynamic TypeScript config may need these changes applied manually. The `expo-updates` dependency is already installed.
4. Publish with `npm run eas:preview -- --message "FILLOUT IMMIGRATION FORMS SDK 57 preview" --non-interactive --json`.
5. Use the actual project and update-group IDs returned by Expo at `https://qr.expo.dev/eas-update?projectId=PROJECT_ID&groupId=GROUP_ID`. Omit the `slug` parameter to target Expo Go. Appending `&format=url` returns the corresponding direct app link. Verify on a physical phone before reporting device testing as complete.

Publishing needs an authenticated Expo account and a real linked project. Merely installing the dependency or running a local bundle export does not publish an update. The SDK 57 preview continues to have the feature limits documented in the README.

References: [EAS Update](https://docs.expo.dev/eas-update/introduction/), [Expo preview QR codes](https://docs.expo.dev/more/qr-codes/).

## Local Xcode build

The Apple/Xcode license must be reviewed and accepted by the user. After Xcode's first-run setup and installation of an iOS Simulator runtime:

```sh
npm run ios:build
```

Expo generates `ios/`, installs pods and compiles the development app. The generated native directories are ignored; `app.config.ts` is the source of truth. CocoaPods or the iOS runtime may require additional downloads. Device signing requires a development team.

## EAS development build

```sh
npx eas-cli login
npx eas-cli init
npm run eas:development
```

`eas init` links the real Expo project. Preserve its resulting project ID. Do not put account passwords, API keys, signing certificates or provisioning profiles into Git. The `simulator` profile builds an unsigned simulator target; use `npx eas-cli build --platform ios --profile simulator` when needed.

After installing the development build, use `npm start -- --dev-client`.

## TestFlight

1. Verify ownership/availability of the bundle ID `com.coortgroup.immigrationeagle` in your Apple account, and change it in `app.config.ts` if necessary before the first release.
2. Create the corresponding App Store Connect app and configure your Apple team/signing through EAS's secure prompts.
3. Review current SDK and dependency support, privacy disclosures, legal claims, accessibility, data handling and feature limitations before inviting testers. This initial build sends no form data or payments.
4. Build and then submit:

```sh
npm run eas:testflight
npm run eas:submit
```

EAS asks for the App Store Connect app identifier when it is not configured. Production uses EAS-managed remote build numbers and auto-increments them for subsequent builds. Remote versioning avoids trying to rewrite the dynamic `app.config.ts` configuration, which the CLI cannot auto-increment locally. A successful upload still requires Apple's processing and, for external testers, applicable beta review.

No TestFlight upload is performed by simply exporting the JavaScript bundle or committing this configuration.

Official references: [development builds](https://docs.expo.dev/develop/development-builds/create-a-build/), [EAS iOS submission](https://docs.expo.dev/submit/ios/), [Expo Go compatibility](https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/).
