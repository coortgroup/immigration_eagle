# Device and TestFlight testing

## Expo Go now

1. `npm ci`
2. `npm start -- --go`
3. Open the QR code in an SDK 54-compatible Expo Go. For iPhone this is currently the App Store release. The computer and phone should share a network; use Expo's supported tunnel flow when that is not possible.

The custom launcher icon/splash belong to a built app. Expo Go runs this project inside the Expo Go container; it does not replace the Expo Go home-screen icon.

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

EAS asks for the App Store Connect app identifier when it is not configured. Production auto-increments the build number. A successful upload still requires Apple's processing and, for external testers, applicable beta review.

No TestFlight upload is performed by simply exporting the JavaScript bundle or committing this configuration.

Official references: [development builds](https://docs.expo.dev/develop/development-builds/create-a-build/), [EAS iOS submission](https://docs.expo.dev/submit/ios/), [Expo Go compatibility](https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/).
