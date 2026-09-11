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

The upload/build workflows upload the binary only. They do not submit to beta review,
submit to App Review, cancel existing submissions, or release the app automatically.
Before choosing **Add for Review** in App Store Connect, complete the version's
screenshots, app privacy answers, support/privacy URLs, content rights, age rating,
export-compliance questions and review contact/demo-login details. Select build 38
on the App Store version page after it finishes processing.

## App Review submission

Latest verified update, 11 September 2026:
- App download price is FREE; in-app service pricing was not changed.
- Content rights and the age questionnaire are saved, including UGC, messaging,
  advertising, and social features. Apple's returned general age rating is `FOUR_PLUS`.
- Review contact is Dott Media, `info@dott-media.org`, `+256775067216`, using the
  company's published contact information. Review login remains separate and verified.
- App Privacy answers are prepared in [app-store-privacy-answers.md](app-store-privacy-answers.md)
  and `scripts/ios/app-privacy-details.json`. They still require publication using an
  Apple ID session; the connected API key cannot publish this label.
- The required iPad screenshot is still missing. Firestore account-data reads still
  return `Quota exceeded`; Firebase login succeeds but full access is not verified.

After upload, `ios-submit-review` submits the existing 1.0.0 (38) build and sets
release to `AFTER_APPROVAL`. The owner authorized submission and release on
8 September 2026. It does not upload the same binary again or cancel prior reviews.
Apple app ID: `6755872330`.

Verified on 9 September 2026:
- Build 38 is uploaded. Version 1.0.0 remains `PREPARE_FOR_SUBMISSION`.
- Business category, the working privacy-policy URL, and `AFTER_APPROVAL` are saved.
- Dedicated login `apple-review@dott-media.org` is created and its password is saved
  and verified in the private App Review details. No password is stored in this repository.
- Firebase password sign-in and the authenticated live profile endpoint succeed.
  Firestore profile reads return `Quota exceeded` and the billing endpoint returned
  HTTP 500, so full in-app review access is not yet verified.
- Apple review contact fields remain incomplete. Four iPhone screenshots are present;
  the required iPad screenshot is missing.

The first submission reached Apple but was blocked by missing listing information:

- An iPad screenshot (`APP_IPAD_PRO_3GEN_129`); existing iPhone screenshots are present.
- App Review contact details (review/demo credentials have since been supplied).
- A privacy policy URL, primary category, and content-rights declaration.
- The age-rating questionnaire, published app privacy/data-use answers, and pricing.

`ios-complete-listing` applies the verified Business category and live privacy URL
`https://dotti.dott-media.org/privacy`, and verifies release-after-approval settings.
It intentionally does not invent contact details, demo credentials, legal declarations,
or screenshots. Complete those remaining requirements before retrying submission.

An actual iPad screenshot may be 2048 x 2732 or 2064 x 2752 pixels in portrait;
capture the app running on an iPad or iPad simulator. Publish the privacy answers
in App Store Connect's App Privacy section, not only the privacy-policy URL.

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
