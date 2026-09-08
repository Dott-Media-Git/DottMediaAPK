# Dotti iOS release through Codemagic

Repository: https://github.com/Dott-Media-Git/DottMediaAPK

Release branch: `codex/ios-codemagic-release`

Dotti uses Expo SDK 54 / React Native, not Flutter. The iOS bundle identifier is
`com.dottmedia.dottmediaapk`; the Apple team is `VDUKXWBYVR`.

## Upload the already-built app first

The `ios-upload-existing` workflow downloads the existing App Store-signed
version **1.0.0 (38)** from Expo, verifies its SHA-256 and provisioning profile,
checks its code signature on the cloud Mac, and uploads it to App Store Connect.
It does not rebuild or re-sign the app. No distribution certificate import or
Firebase environment variables are needed for this workflow.

1. In [Codemagic](https://codemagic.io/apps), choose **Add application**, connect
   GitHub, select `Dott-Media-Git/DottMediaAPK`, and choose **React Native**.
2. In [App Store Connect](https://appstoreconnect.apple.com/access/integrations/api),
   open **Users and Access → Integrations → App Store Connect API**. Create a team
   key with **App Manager** access and download its `.p8` file. Keep the file private.
3. In Codemagic **Team settings → Team integrations → Developer Portal**, add
   that key with its Key ID and Issuer ID. Name the integration exactly
   **Dotti App Store Connect**.
4. Open the Codemagic application, select branch `codex/ios-codemagic-release`,
   check for `codemagic.yaml`, and run **Upload Dotti 1.0.0 (38) to App Store Connect**
   (`ios-upload-existing`).
5. After upload and Apple's processing finish, open Dotti in App Store Connect
   and check **TestFlight** for version **1.0.0 (38)**. Add internal testers there.

If build 38 is already present in App Store Connect, use that build; uploading
the same version/build pair again will be rejected. If Expo's artifact has expired,
use the local `ios-store-assets/Dotti-AI-1.0.0-build-38.ipa` via a secure artifact
URL and keep the checksum unchanged, or use the new-build workflow below.

The workflows upload the binary only. They do not submit to beta review, submit
to App Review, cancel existing submissions, or release the app automatically.
Before choosing **Add for Review** in App Store Connect, complete the version's
screenshots, app privacy answers, support/privacy URLs, content rights, age rating,
export-compliance questions and review contact/demo-login details. Select build 38
on the App Store version page after it finishes processing.

## Build a new IPA from GitHub

Run `ios-release` for source changes after build 38. This workflow installs the
locked Expo-compatible dependencies, increments the build number from TestFlight,
generates the iOS project, installs CocoaPods, archives, signs and uploads the IPA.

First configure the same Apple integration, then:

- In Codemagic **Team settings → Code signing identities**, import an existing
  Apple Distribution certificate **with its private key** (`.p12`) and its App Store
  provisioning profile, or generate a distribution certificate and matching profile
  in Codemagic. Both must belong to team `VDUKXWBYVR` and cover the bundle ID above.
- Add the environment group `dotti_mobile` to the Codemagic app/team. Set
  `APP_STORE_APPLE_ID` to Dotti's numeric Apple ID from **App Information**.
- In the same group, copy these existing mobile client settings:
  `EXPO_PUBLIC_FIREBASE_API_KEY`, `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`,
  `EXPO_PUBLIC_FIREBASE_PROJECT_ID`, `EXPO_PUBLIC_FIREBASE_APP_ID`.
  Also carry over `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` and
  `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` if configured for the app.
  Do not use Firebase Admin credentials or backend service keys.
- Run **Build Dotti iOS and upload to App Store Connect** (`ios-release`).

The bundle ID is preserved, new builds start at 39 or above, and the workflow
uses App Store distribution (not an internal-only or ad-hoc IPA).

## Validation performed locally

- Both workflow definitions checked against Codemagic's official JSON schema.
- Build 38's checksum, bundle ID, build number, team and unexpired App Store
  provisioning profile checked from the IPA contents. Cryptographic signature
  verification runs on the Mac workflow.
- Package and lockfile dependency declarations checked for consistency.
- Expo configuration evaluated locally. A full signed Xcode archive still requires
  the configured cloud Mac and Apple integration.
- Metro resolved the iOS JavaScript, but the Windows Hermes compiler crashed.
  A JavaScript-only retry was stopped while still bundling; neither run counts as
  a successful release build. Validate the new-source workflow on Codemagic before
  using its IPA. This does not alter the existing signed build 38.

Sources: [Codemagic React Native setup](https://docs.codemagic.io/yaml-quick-start/building-a-react-native-app/),
[Codemagic App Store publishing](https://docs.codemagic.io/yaml-publishing/app-store-connect/),
[Apple build uploads](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/).
