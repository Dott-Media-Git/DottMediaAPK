# Release verification ? 12 September 2026

Dotti 1.0.0 (build 38) was successfully submitted on 12 September 2026 at 13:50:18 UTC. Apple returned WAITING_FOR_REVIEW. Release is AFTER_APPROVAL; the app is not publicly live until Apple approves it.

Submission: https://appstoreconnect.apple.com/apps/6755872330/appstore/reviewsubmissions/details/76b44f3d-fa30-43ae-9859-8ef4f122a15e

Verified iPad screenshot ID: 7677a869-4d59-44ee-a18a-18dcb94d2fe6. Successful upload/submission Codemagic run: 6aa5585a9822e73005e20a3e.

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

The first fix exposed a second incompatibility with the removed useAnimatedGestureHandler API. Reanimated 3.19.5 was pinned for compatibility with the existing drawer and React Native 0.81. The fourth capture run, 6aa5553fae4fcc6fd367c74e, succeeded. The 2064x2752 native welcome screen was inspected and uploaded. Apple processing completed and review submission succeeded.

## Remaining migration work

The broader mobile account and billing migration remains uncommitted and undeployed.
Do not activate it until transaction tests pass and existing balances/usage are
preserved. Local PostgreSQL TCP connections time out; authenticated Management API
SQL and REST both work. Firebase Authentication remains the identity provider.
