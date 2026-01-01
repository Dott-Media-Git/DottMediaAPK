import admin from 'firebase-admin';
import { Storage } from '@google-cloud/storage';
import crypto from 'crypto';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') });
dotenv.config();

type ServiceAccount = admin.ServiceAccount & { project_id?: string };

const loadServiceAccount = (): ServiceAccount => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw && raw.trim().length > 0) {
    try {
      return JSON.parse(raw) as ServiceAccount;
    } catch (error) {
      throw new Error(`Unable to parse FIREBASE_SERVICE_ACCOUNT_JSON: ${(error as Error).message}`);
    }
  }

  const filePath = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (filePath) {
    try {
      const resolved = path.resolve(filePath);
      const contents = fs.readFileSync(resolved, 'utf8');
      return JSON.parse(contents) as ServiceAccount;
    } catch (error) {
      throw new Error(`Unable to read FIREBASE_SERVICE_ACCOUNT file: ${(error as Error).message}`);
    }
  }

  throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT env var');
};

const getBucketName = (projectId: string) => {
  const envBucket =
    process.env.FIREBASE_STORAGE_BUCKET?.trim() ?? process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim();
  if (envBucket) return envBucket;
  return `${projectId}.appspot.com`;
};

const getContentType = (fileName: string) => {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return 'application/octet-stream';
  }
};

const isImageFile = (fileName: string) => /\.(png|jpe?g|webp|gif)$/i.test(fileName);

const main = async () => {
  const fallbackDir = process.env.AUTOPOST_FALLBACK_DIR?.trim();
  if (!fallbackDir) {
    throw new Error('AUTOPOST_FALLBACK_DIR is not set.');
  }
  const resolvedDir = path.resolve(fallbackDir);
  if (!fs.existsSync(resolvedDir)) {
    throw new Error(`Fallback image directory not found: ${resolvedDir}`);
  }

  const entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
  const files = entries.filter(entry => entry.isFile()).map(entry => entry.name).filter(isImageFile);
  if (!files.length) {
    throw new Error(`No fallback images found in ${resolvedDir}`);
  }

  const serviceAccount = loadServiceAccount();
  const projectId = serviceAccount.projectId ?? serviceAccount.project_id;
  if (!projectId) {
    throw new Error('Service account is missing projectId.');
  }

  const bucketName = getBucketName(projectId);
  const clientEmail = (serviceAccount as any).client_email ?? (serviceAccount as any).clientEmail;
  const privateKey = (serviceAccount as any).private_key ?? (serviceAccount as any).privateKey;
  if (!clientEmail || !privateKey) {
    throw new Error('Service account is missing client_email or private_key.');
  }

  const storageClient = new Storage({
    projectId,
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
  });
  const bucket = storageClient.bucket(bucketName);
  const [bucketExists] = await bucket.exists();
  if (!bucketExists) {
    const location = process.env.FIREBASE_STORAGE_LOCATION?.trim() || 'us-central1';
    console.warn(`[upload] Bucket ${bucketName} missing; creating in ${location}.`);
    await storageClient.createBucket(bucketName, { location, uniformBucketLevelAccess: true });
  }

  const urls: string[] = [];
  for (const fileName of files) {
    const token = crypto.randomUUID();
    const destination = `fallback-images/${fileName}`;
    const filePath = path.join(resolvedDir, fileName);
    const contentType = getContentType(fileName);

    await bucket.upload(filePath, {
      destination,
      metadata: {
        contentType,
        cacheControl: 'public, max-age=3600',
        metadata: {
          firebaseStorageDownloadTokens: token,
        },
      },
    });

    const encoded = encodeURIComponent(destination);
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media&token=${token}`;
    urls.push(url);
  }

  const outputPath =
    process.env.AUTOPOST_FALLBACK_URLS_FILE?.trim() || path.resolve(process.cwd(), 'autopost-fallback-urls.txt');
  fs.writeFileSync(outputPath, urls.join('\n'));

  console.log(`Uploaded ${urls.length} images to ${bucket.name}.`);
  console.log(`Wrote fallback URLs to ${outputPath}.`);
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
