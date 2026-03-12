import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

const generatedMediaDir = path.resolve(process.env.GENERATED_MEDIA_DIR?.trim() || './public/generated-media');

type MediaSubdir = 'images' | 'videos';

const ensureDir = (subdir: MediaSubdir) => {
  const dir = path.join(generatedMediaDir, subdir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const publicBaseUrl = () => {
  const explicit =
    process.env.PUBLIC_API_BASE_URL?.trim() ||
    process.env.PUBLIC_BASE_URL?.trim() ||
    process.env.RENDER_EXTERNAL_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, '');
  }
  const renderHostname = process.env.RENDER_EXTERNAL_HOSTNAME?.trim();
  if (renderHostname) {
    return `https://${renderHostname}`;
  }
  return `http://localhost:${config.port}`;
};

const buildPublicUrl = (subdir: MediaSubdir, filename: string) =>
  `${publicBaseUrl()}/public/generated-media/${subdir}/${filename}`;

export const ensureGeneratedMediaRoot = () => {
  fs.mkdirSync(generatedMediaDir, { recursive: true });
  ensureDir('images');
  ensureDir('videos');
  return generatedMediaDir;
};

export const saveGeneratedImageBuffer = async (buffer: Buffer, extension = 'png') => {
  const filename = `${crypto.randomUUID()}.${extension.replace(/^\./, '')}`;
  const dir = ensureDir('images');
  const filePath = path.join(dir, filename);
  await fs.promises.writeFile(filePath, buffer);
  return buildPublicUrl('images', filename);
};

export const saveGeneratedVideoFile = async (sourcePath: string, extension = 'mp4') => {
  const filename = `${crypto.randomUUID()}.${extension.replace(/^\./, '')}`;
  const dir = ensureDir('videos');
  const destination = path.join(dir, filename);
  await fs.promises.copyFile(sourcePath, destination);
  return buildPublicUrl('videos', filename);
};

const normalizeExtension = (extension: string, fallback: string) =>
  extension.replace(/^\./, '').trim() || fallback;

export const saveUploadedMediaBuffer = async (
  buffer: Buffer,
  type: MediaSubdir,
  extension: string,
) => {
  const safeExtension = normalizeExtension(extension, type === 'images' ? 'png' : 'mp4');
  const filename = `${crypto.randomUUID()}.${safeExtension}`;
  const dir = ensureDir(type);
  const filePath = path.join(dir, filename);
  await fs.promises.writeFile(filePath, buffer);
  return buildPublicUrl(type, filename);
};
