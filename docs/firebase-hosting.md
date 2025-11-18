## Firebase Hosting (Expo web bundle)

1. Install the Firebase CLI once per machine:
   ```bash
   npm install -g firebase-tools
   firebase login
   ```
2. Point this repo at your Firebase project (the command writes the project id into `.firebaserc`):
   ```bash
   firebase use --add
   ```
3. Build the Expo web bundle. The build artifact is emitted to `dist/`, which Firebase Hosting serves according to `firebase.json`.
   ```bash
   npm run build:web
   ```
4. Deploy to Firebase Hosting:
   ```bash
   firebase deploy --only hosting
   ```

### Notes

- The SPA rewrite in `firebase.json` rewrites every route to `index.html`, which keeps React Navigation working on refresh.
- If you rely on environment variables, make sure `.env` is baked into the build (e.g., via `app.config.js`) before running `npm run build:web`.
