# Gallery Auto-post

Content Gallery offers an Auto-post dialog with a 1–24 hour interval, connected
account selection, and an optional shared caption. Confirmation saves all current
gallery items (up to 200) in display order. The first item is due immediately and
the backend polls every minute. The next interval starts when the preceding item
finishes; outages do not trigger a burst of missed posts. After the last item,
the job repeats from the first until stopped.

The saved gallery is a snapshot. Adding/removing local gallery media does not
change an active job; the UI tells users to stop and restart to update it. Photos
are not sent to YouTube/TikTok; Instagram videos use the Reels publisher. Existing
account-specific content restrictions and subscription posting allowances apply.
Gallery posting uses the auto-post publishers, not the manual scheduler's
five-post daily queue cap. It does not modify existing automatic campaigns.

## Persistence and execution

- `GET/POST/DELETE /api/gallery/autopost` require verified Firebase ID tokens and
  derive ownership exclusively from the token, not from request-body user IDs.
- The Admin SDK stores one `galleryAutopostJobs/{uid}` document per user.
  Clients cannot write these documents directly. No composite index is needed.
- A Firestore transaction claims each due item. Multiple backend processes cannot
  claim the same run. Do not perform platform calls inside transaction callbacks.
- Each platform result is saved; any failure pauses the job with an error.
- A run interrupted for 30 minutes is paused for manual review, not automatically
  retried: remote APIs cannot guarantee exactly-once publishing after a crash.
- Stop prevents future calls. An external request already in flight can finish.
- Active jobs and settings survive backend restarts. No phone timers are used.
- Removing a Dotti account also removes its gallery job.

## Release requirements

Deploy the backend before releasing the app update. The backend needs its existing
Firebase Admin credentials, a writable Firestore database, connected social
credentials, and an always-running process for minute polling. Mock authentication
does not enable gallery jobs. `DISABLE_SOCIAL_QUEUE_AUTOMATION=true` disables the
gallery worker too. Deploy the matching Firestore rules with the backend release.

Build/release the mobile app separately for Play Store users; editing this source
does not update an already installed Android app. The web app also needs a new
build/deployment. No live post or production deployment is part of local tests.

## Verification

`cd backend && npm test` runs the existing suite and gallery tests covering interval
bounds, order and repetition, restart, concurrency, stop during posting, failure,
disconnected accounts, persistence errors, mixed media, and missed intervals.
