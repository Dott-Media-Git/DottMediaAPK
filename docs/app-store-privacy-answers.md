# Dotti App Privacy answers

Prepared 11 September 2026 for `com.dottmedia.dottmediaapk` (Apple ID `6755872330`).
These answers are prepared, **not yet published in App Store Connect**.

The app processes account information, customer records, prompts, uploaded media,
connected-platform messages and analytics. Protecting this information does not mean
it is uncollected. Select **Yes, we collect data**. Account-scoped information is
**linked to the user**. The reviewed code and policy do not indicate cross-company
tracking of Dotti users for advertising; do not select tracking merely because a
customer uses Dotti to manage its own advertising campaigns.

| Data type | Purpose |
| --- | --- |
| Name, email address | App functionality, product personalization, developer marketing |
| Phone number, physical/business address | App functionality |
| User ID | App functionality |
| Contacts supplied as CRM records | App functionality |
| Emails or text messages | App functionality |
| Photos or videos, audio, other user content | App functionality |
| Customer support | App functionality |
| Purchase history, payment information received from payment providers | App functionality |
| Advertising data from connected customer accounts | App functionality, analytics |
| Product interaction, other diagnostic data | App functionality, analytics |
| Coarse location inferred from IP, as stated in the policy | App functionality |

All rows above are linked to the account and are not declared as tracking.
Do not claim full card numbers, device address-book access, precise location,
health data, or advertising identifiers are collected merely because those
categories exist in Apple's questionnaire. The privacy policy does not establish
that those features are enabled. This declaration also does not claim SDK crash
or performance collection without verification that it occurs in the shipped app.

## Publish

In App Store Connect, open Dotti -> App Privacy. Enter the above data types,
purposes, and linkage answers and click **Publish**. The policy URL is already
`https://dotti.dott-media.org/privacy`.

Alternatively, `scripts/ios/app-privacy-details.json` supplies these answers to
Fastlane's `upload_app_privacy_details_to_app_store` action. That action requires
an authenticated Apple ID session with suitable permissions; the Codemagic
App Store Connect API key cannot publish these disclosures.

Sources: [Dotti privacy policy](https://dotti.dott-media.org/privacy),
[Apple data definitions](https://developer.apple.com/app-store/app-privacy-details/),
[Apple publishing instructions](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/),
[Fastlane authentication requirements](https://docs.fastlane.tools/uploading-app-privacy-details/).
