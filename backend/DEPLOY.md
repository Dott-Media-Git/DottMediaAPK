## Deployment Checklist

### 1. Environment Variables

1. Copy `.env.example` → `.env` (root + `backend/`).
2. Populate all secrets:
   - Firebase Admin: `FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.
   - WhatsApp Cloud API: `WHATSAPP_TOKEN`, `VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`.
   - OpenAI: `OPENAI_API_KEY`.
   - SMTP + Redis + Sentry as needed.
3. Set `EXPO_PUBLIC_API_URL=https://<backend-host>` so the app can reach `/stats`.

### 2. Firebase Hosting (Functions) Deployment

1. Install Firebase CLI and log in:
   ```bash
   npm install -g firebase-tools
   firebase login
   ```
2. Build the backend and copy the `dist` output:
   ```bash
   cd backend
   npm install
   npm run build
   ```
3. Configure a Firebase Hosting rewrite to the Express server (e.g., using Cloud Run or Cloud Functions). Minimal `firebase.json` snippet:
   ```json
   {
     "hosting": {
       "public": "dist",
       "rewrites": [
         { "source": "/webhook/whatsapp", "run": { "serviceId": "dott-media-api", "region": "us-central1" } },
         { "source": "/stats", "run": { "serviceId": "dott-media-api", "region": "us-central1" } }
       ]
     }
   }
   ```
4. Deploy Firestore rules + hosting:
   ```bash
   firebase deploy --only firestore:rules,hosting
   ```
5. Update the WhatsApp webhook callback URL to `https://<firebase-hosting-domain>/webhook/whatsapp` and confirm the `VERIFY_TOKEN`.

### 3. Vercel Deployment

1. Create a new Vercel project pointing at `backend/`.
2. In **Build & Output Settings**:
   - Build command: `npm run build`
   - Output directory: `dist`
   - Install command: `npm install`
3. Add all environment variables in Vercel’s dashboard (same list as above). Mark `WHATSAPP_*` and Firebase keys as production + preview.
4. Add a Vercel rewrite so the Express server receives `/webhook/whatsapp` and `/stats` without the `/api` prefix:
   ```json
   [
     { "source": "/(webhook/whatsapp|stats)", "destination": "/$1" }
   ]
   ```
5. After deploying, set `EXPO_PUBLIC_API_URL=https://<vercel-app-url>` and update the WhatsApp webhook callback URL.

### 4. Mobile App

1. Confirm Expo env values: Firebase client keys + `EXPO_PUBLIC_API_URL`.
2. Rebuild or publish with `expo prebuild && expo run:android` (or iOS) for store builds, or `expo publish` for OTA updates.

### 5. Health Checks

- `GET /healthz` → sanity check.
- `POST /webhook/whatsapp` → configure from Meta dashboard (use cURL + sample payload for tests).
- `GET /stats` → should return analytics JSON for the Bot Analytics screen.
