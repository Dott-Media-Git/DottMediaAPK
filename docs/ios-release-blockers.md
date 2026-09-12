# Release verification ? 12 September 2026

The app has not yet been submitted successfully or released.

## Verified today

- Recovered working Supabase management access from prior user messages.
- Verified the active Dotti project, repaired its local and Render service key.
- Applied account storage SQL with RLS; anonymous/authenticated roles have no direct access.
- Created and verified the isolated Apple review profile in Supabase, active Business plan.
- Live Firebase review password login, profile read and billing overview all passed.
- Apple submission check now reports only missing APP_IPAD_PRO_3GEN_129 screenshot;
  the App Privacy error is resolved.

## iPad capture

Initial native capture showed the home screen. Simulator diagnostics identified a
fatal drawer/Reanimated legacy implementation mismatch. Commit 29737e752 sets
useLegacyImplementation=false. Corrected capture run:
https://codemagic.io/app/6aa00245f62b9a0c6e5f4251/build/6aa50f46639251d698f6e358

Inspect the image before upload. upload-ipad.py reserves/uploads/checksums and verifies
processing. After upload, retry ios-submit-review (existing signed build 38).

## Remaining migration work

The broader mobile account and billing migration remains uncommitted and undeployed.
Do not activate it until transaction tests pass and existing balances/usage are
preserved. Local PostgreSQL TCP connections time out; authenticated Management API
SQL and REST both work. Firebase Authentication remains the identity provider.
