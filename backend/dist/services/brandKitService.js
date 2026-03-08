import fs from 'fs';
import path from 'path';
const resolveExistingPath = (candidates) => {
    for (const candidate of candidates) {
        if (candidate && fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return candidates[0];
};
const resolveBrandKitDir = () => {
    const override = process.env.BRAND_KIT_DIR?.trim();
    if (override)
        return override;
    return resolveExistingPath([
        path.join(process.cwd(), 'brand-kits'),
        path.join(process.cwd(), 'backend', 'brand-kits'),
        path.join(path.resolve(process.cwd(), '..'), 'backend', 'brand-kits'),
    ]);
};
const resolveBrandMapFile = () => {
    const override = process.env.BRAND_KIT_MAP_FILE?.trim();
    if (override)
        return override;
    return resolveExistingPath([
        path.join(resolveBrandKitDir(), 'client-map.json'),
        path.join(process.cwd(), 'backend', 'brand-kits', 'client-map.json'),
        path.join(path.resolve(process.cwd(), '..'), 'backend', 'brand-kits', 'client-map.json'),
    ]);
};
export const loadBrandKit = (brandId) => {
    const dir = resolveBrandKitDir();
    const filename = `${brandId}.json`;
    const filePath = path.join(dir, filename);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Brand kit not found: ${brandId}`);
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
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
export const resolveBrandIdForClient = (clientId) => {
    const mapPath = resolveBrandMapFile();
    if (!fs.existsSync(mapPath))
        return null;
    try {
        const raw = fs.readFileSync(mapPath, 'utf8');
        const parsed = JSON.parse(raw);
        const mapped = parsed.clients?.[clientId];
        return mapped ?? null;
    }
    catch (error) {
        console.warn('[brand-kit] Failed to parse brand kit map', error);
        return null;
    }
};
