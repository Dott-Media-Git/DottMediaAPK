import * as functions from 'firebase-functions';
import { app } from 'dott-media-backend';

export const api = functions.https.onRequest(app);
