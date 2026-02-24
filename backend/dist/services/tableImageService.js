import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
const WIDTH = 1600;
const HEIGHT = 900;
const escapeXml = (value) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
const clampText = (value, max = 22) => {
    const trimmed = value.trim();
    if (trimmed.length <= max)
        return trimmed;
    return `${trimmed.slice(0, Math.max(max - 3, 1))}...`;
};
const parseTimestampLabel = (updatedAt) => {
    const parsed = updatedAt ? Date.parse(updatedAt) : Date.now();
    const date = Number.isNaN(parsed) ? new Date() : new Date(parsed);
    return date.toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Africa/Kampala',
    });
};
const resolveLogoPath = () => {
    const configured = process.env.BWINBET_LOGO_PATH?.trim();
    const candidates = [
        configured ? path.resolve(configured) : null,
        path.resolve(process.cwd(), '../docs/brand-kits/assets/bwinbetug-logo.jpeg'),
        path.resolve(process.cwd(), 'docs/brand-kits/assets/bwinbetug-logo.jpeg'),
    ].filter((value) => Boolean(value));
    return candidates.find(candidate => fs.existsSync(candidate)) ?? null;
};
async function addLogoOverlay(buffer, logTag) {
    const logoPath = resolveLogoPath();
    if (!logoPath)
        return buffer;
    try {
        const logo = await sharp(logoPath).resize({ width: 280, withoutEnlargement: true }).png().toBuffer();
        return sharp(buffer)
            .composite([{ input: logo, left: WIDTH - 340, top: 44 }])
            .png()
            .toBuffer();
    }
    catch (error) {
        console.warn(`[${logTag}] failed to load logo`, error.message);
        return buffer;
    }
}
export async function renderLeagueTableImage(input) {
    const league = input.league?.trim() || 'League Table';
    const rows = (input.rows ?? []).slice(0, 8);
    const source = input.source?.trim() || 'Live standings';
    const cta = input.cta?.trim() || 'www.bwinbetug.info';
    const updatedLabel = parseTimestampLabel(input.updatedAt);
    const headerY = 120;
    const tableTop = 240;
    const rowHeight = 64;
    const rowsSvg = rows
        .map((row, index) => {
        const y = tableTop + index * rowHeight;
        const fill = index % 2 === 0 ? '#141414' : '#1d1d1d';
        const played = typeof row.played === 'number' && Number.isFinite(row.played) && row.played > 0 ? Math.trunc(row.played) : '-';
        return `
        <rect x="120" y="${y}" width="1360" height="${rowHeight - 4}" rx="12" fill="${fill}"/>
        <text x="155" y="${y + 42}" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="#ffca08">${index + 1}</text>
        <text x="240" y="${y + 42}" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="600" fill="#ffffff">${escapeXml(clampText(row.name, 28))}</text>
        <text x="1240" y="${y + 42}" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="#ffca08" text-anchor="end">${Math.trunc(row.points)}</text>
        <text x="1420" y="${y + 42}" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="600" fill="#d8d8d8" text-anchor="end">${played}</text>
      `;
    })
        .join('');
    const svg = `
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#ffca08"/>
          <stop offset="100%" stop-color="#f1b900"/>
        </linearGradient>
      </defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
      <rect x="40" y="36" width="1520" height="828" rx="40" fill="#0b0b0b"/>
      <rect x="40" y="36" width="1520" height="120" rx="40" fill="#111111"/>
      <rect x="40" y="126" width="1520" height="2" fill="#ffca08"/>

      <text x="120" y="${headerY}" font-family="Arial, Helvetica, sans-serif" font-size="54" font-weight="800" fill="#ffca08">${escapeXml(league.toUpperCase())}</text>
      <text x="120" y="${headerY + 42}" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="500" fill="#f2f2f2">LIVE TABLE - Updated ${escapeXml(updatedLabel)} EAT</text>

      <rect x="120" y="188" width="1360" height="44" rx="10" fill="#171717"/>
      <text x="155" y="218" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#ffca08">POS</text>
      <text x="240" y="218" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#ffca08">TEAM</text>
      <text x="1240" y="218" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#ffca08" text-anchor="end">PTS</text>
      <text x="1420" y="218" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#ffca08" text-anchor="end">P</text>

      ${rowsSvg}

      <text x="120" y="828" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="500" fill="#d4d4d4">Source: ${escapeXml(source)}</text>
      <text x="1480" y="828" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700" fill="#ffca08" text-anchor="end">${escapeXml(cta)}</text>
    </svg>
  `;
    const output = await sharp(Buffer.from(svg)).png().toBuffer();
    return addLogoOverlay(output, 'table-image');
}
export async function renderTopScorersImage(input) {
    const league = input.league?.trim() || 'Top Scorers';
    const rows = (input.rows ?? []).slice(0, 8);
    const source = input.source?.trim() || 'Live stats';
    const cta = input.cta?.trim() || 'www.bwinbetug.info';
    const updatedLabel = parseTimestampLabel(input.updatedAt);
    const headerY = 120;
    const tableTop = 240;
    const rowHeight = 64;
    const rowsSvg = rows
        .map((row, index) => {
        const y = tableTop + index * rowHeight;
        const fill = index % 2 === 0 ? '#141414' : '#1d1d1d';
        const appearances = typeof row.appearances === 'number' && Number.isFinite(row.appearances) && row.appearances > 0
            ? Math.trunc(row.appearances)
            : '-';
        return `
        <rect x="120" y="${y}" width="1360" height="${rowHeight - 4}" rx="12" fill="${fill}"/>
        <text x="155" y="${y + 42}" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="#ffca08">${index + 1}</text>
        <text x="240" y="${y + 42}" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="600" fill="#ffffff">${escapeXml(clampText(row.player, 26))}</text>
        <text x="980" y="${y + 42}" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="500" fill="#d8d8d8">${escapeXml(clampText(row.team, 18))}</text>
        <text x="1240" y="${y + 42}" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="#ffca08" text-anchor="end">${Math.trunc(row.goals)}</text>
        <text x="1420" y="${y + 42}" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="600" fill="#d8d8d8" text-anchor="end">${appearances}</text>
      `;
    })
        .join('');
    const svg = `
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#ffca08"/>
          <stop offset="100%" stop-color="#f1b900"/>
        </linearGradient>
      </defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
      <rect x="40" y="36" width="1520" height="828" rx="40" fill="#0b0b0b"/>
      <rect x="40" y="36" width="1520" height="120" rx="40" fill="#111111"/>
      <rect x="40" y="126" width="1520" height="2" fill="#ffca08"/>

      <text x="120" y="${headerY}" font-family="Arial, Helvetica, sans-serif" font-size="54" font-weight="800" fill="#ffca08">${escapeXml(`${league.toUpperCase()} TOP SCORERS`)}</text>
      <text x="120" y="${headerY + 42}" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="500" fill="#f2f2f2">LIVE RACE - Updated ${escapeXml(updatedLabel)} EAT</text>

      <rect x="120" y="188" width="1360" height="44" rx="10" fill="#171717"/>
      <text x="155" y="218" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#ffca08">POS</text>
      <text x="240" y="218" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#ffca08">PLAYER</text>
      <text x="980" y="218" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#ffca08">TEAM</text>
      <text x="1240" y="218" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#ffca08" text-anchor="end">G</text>
      <text x="1420" y="218" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#ffca08" text-anchor="end">APP</text>

      ${rowsSvg}

      <text x="120" y="828" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="500" fill="#d4d4d4">Source: ${escapeXml(source)}</text>
      <text x="1480" y="828" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700" fill="#ffca08" text-anchor="end">${escapeXml(cta)}</text>
    </svg>
  `;
    const output = await sharp(Buffer.from(svg)).png().toBuffer();
    return addLogoOverlay(output, 'top-scorers-image');
}
