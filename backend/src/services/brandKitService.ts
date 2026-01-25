import fs from 'fs';
import path from 'path';
import { BrandKit } from '../types/footballTrends';

type StoredBrandKit = BrandKit & { id?: string; logoPath?: string; templates?: Record<string, unknown> };

const resolveBrandKitDir = () => {
  const override = process.env.BRAND_KIT_DIR?.trim();
  if (override) return override;
  return path.join(process.cwd(), 'brand-kits');
};

const resolveBrandMapFile = () => {
  const override = process.env.BRAND_KIT_MAP_FILE?.trim();
  if (override) return override;
  return path.join(resolveBrandKitDir(), 'client-map.json');
};

export const loadBrandKit = (brandId: string): BrandKit => {
  const dir = resolveBrandKitDir();
  const filename = `${brandId}.json`;
  const filePath = path.join(dir, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Brand kit not found: ${brandId}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as StoredBrandKit;
  return {
    name: parsed.name,
    handle: parsed.handle,
    tone: parsed.tone,
    colors: parsed.colors,
    typography: parsed.typography,
    logoPlacement: parsed.logoPlacement,
    logoPath: parsed.logoPath,
    templates: parsed.templates,
  };
};

export const resolveBrandIdForClient = (clientId: string): string | null => {
  const mapPath = resolveBrandMapFile();
  if (!fs.existsSync(mapPath)) return null;
  try {
    const raw = fs.readFileSync(mapPath, 'utf8');
    const parsed = JSON.parse(raw) as { clients?: Record<string, string> };
    const mapped = parsed.clients?.[clientId];
    return mapped ?? null;
  } catch (error) {
    console.warn('[brand-kit] Failed to parse brand kit map', error);
    return null;
  }
};
