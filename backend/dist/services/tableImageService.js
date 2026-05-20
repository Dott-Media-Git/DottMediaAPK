import sharp from 'sharp';
const WIDTH = 1600;
const HEIGHT = 900;
const ACCENT = '#facc15';
const SECONDARY_ACCENT = '#38bdf8';
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
export async function renderLeagueTableImage(input) {
    const width = 1800;
    const height = 1800;
    const league = input.league?.trim() || 'League Table';
    const rows = (input.rows ?? []).slice(0, 8);
    const source = input.source?.trim() || 'Live standings';
    const cta = input.cta?.trim() || 'More football updates in bio';
    const updatedLabel = parseTimestampLabel(input.updatedAt);
    const headerY = 205;
    const tableTop = 430;
    const rowHeight = 118;
    const rowsSvg = rows
        .map((row, index) => {
        const y = tableTop + index * rowHeight;
        const fill = index % 2 === 0 ? '#141414' : '#1d1d1d';
        const played = typeof row.played === 'number' && Number.isFinite(row.played) && row.played > 0 ? Math.trunc(row.played) : '-';
        return `
        <rect x="140" y="${y}" width="1520" height="${rowHeight - 10}" rx="18" fill="${fill}"/>
        <text x="188" y="${y + 72}" font-family="Arial, Helvetica, sans-serif" font-size="46" font-weight="800" fill="#38bdf8">${index + 1}</text>
        <text x="310" y="${y + 72}" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="700" fill="#ffffff">${escapeXml(clampText(row.name, 30))}</text>
        <text x="1400" y="${y + 72}" font-family="Arial, Helvetica, sans-serif" font-size="46" font-weight="800" fill="#38bdf8" text-anchor="end">${Math.trunc(row.points)}</text>
        <text x="1575" y="${y + 72}" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="700" fill="#d8d8d8" text-anchor="end">${played}</text>
      `;
    })
        .join('');
    const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#111827"/>
          <stop offset="100%" stop-color="#164e63"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bg)"/>
      <rect x="64" y="64" width="1672" height="1672" rx="34" fill="#0b1120"/>
      <rect x="64" y="64" width="1672" height="230" rx="34" fill="#111827"/>
      <rect x="64" y="288" width="1672" height="4" fill="#38bdf8"/>

      <text x="140" y="${headerY}" font-family="Arial, Helvetica, sans-serif" font-size="78" font-weight="900" fill="#e5f7ff">${escapeXml(league.toUpperCase())}</text>
      <text x="140" y="${headerY + 74}" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="600" fill="#cbd5e1">LIVE TABLE - Updated ${escapeXml(updatedLabel)} EAT</text>

      <rect x="140" y="345" width="1520" height="64" rx="14" fill="#172033"/>
      <text x="188" y="388" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="800" fill="#38bdf8">POS</text>
      <text x="310" y="388" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="800" fill="#38bdf8">TEAM</text>
      <text x="1400" y="388" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="800" fill="#38bdf8" text-anchor="end">PTS</text>
      <text x="1575" y="388" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="800" fill="#38bdf8" text-anchor="end">P</text>

      ${rowsSvg}

      <text x="140" y="1660" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="600" fill="#cbd5e1">Source: ${escapeXml(source)}</text>
      <text x="1660" y="1660" font-family="Arial, Helvetica, sans-serif" font-size="32" font-weight="800" fill="#38bdf8" text-anchor="end">${escapeXml(cta)}</text>
    </svg>
  `;
    return sharp(Buffer.from(svg)).jpeg({ quality: 95, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer();
}
export async function renderTopScorersImage(input) {
    const league = input.league?.trim() || 'Top Scorers';
    const rows = (input.rows ?? []).slice(0, 8);
    const source = input.source?.trim() || 'Live stats';
    const cta = input.cta?.trim() || 'More football updates in bio';
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
        <text x="155" y="${y + 42}" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="${ACCENT}">${index + 1}</text>
        <text x="240" y="${y + 42}" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="600" fill="#ffffff">${escapeXml(clampText(row.player, 26))}</text>
        <text x="980" y="${y + 42}" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="500" fill="#d8d8d8">${escapeXml(clampText(row.team, 18))}</text>
        <text x="1240" y="${y + 42}" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="${ACCENT}" text-anchor="end">${Math.trunc(row.goals)}</text>
        <text x="1420" y="${y + 42}" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="600" fill="#d8d8d8" text-anchor="end">${appearances}</text>
      `;
    })
        .join('');
    const svg = `
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#111827"/>
          <stop offset="58%" stop-color="#172554"/>
          <stop offset="100%" stop-color="#020617"/>
        </linearGradient>
      </defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
      <rect x="40" y="36" width="1520" height="828" rx="40" fill="#0b0b0b"/>
      <rect x="40" y="36" width="1520" height="120" rx="40" fill="#111111"/>
      <rect x="40" y="126" width="1520" height="2" fill="${ACCENT}"/>

      <text x="120" y="${headerY}" font-family="Arial, Helvetica, sans-serif" font-size="54" font-weight="800" fill="${ACCENT}">${escapeXml(`${league.toUpperCase()} TOP SCORERS`)}</text>
      <text x="120" y="${headerY + 42}" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="500" fill="#f2f2f2">LIVE RACE - Updated ${escapeXml(updatedLabel)} EAT</text>

      <rect x="120" y="188" width="1360" height="44" rx="10" fill="#171717"/>
      <text x="155" y="218" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="${SECONDARY_ACCENT}">POS</text>
      <text x="240" y="218" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="${SECONDARY_ACCENT}">PLAYER</text>
      <text x="980" y="218" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="${SECONDARY_ACCENT}">TEAM</text>
      <text x="1240" y="218" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="${SECONDARY_ACCENT}" text-anchor="end">G</text>
      <text x="1420" y="218" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="${SECONDARY_ACCENT}" text-anchor="end">APP</text>

      ${rowsSvg}

      <text x="120" y="828" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="500" fill="#d4d4d4">Source: ${escapeXml(source)}</text>
      <text x="1480" y="828" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700" fill="${ACCENT}" text-anchor="end">${escapeXml(cta)}</text>
    </svg>
  `;
    return sharp(Buffer.from(svg)).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}
export async function renderPredictionsImage(input) {
    const rows = (input.rows ?? []).slice(0, 8);
    const source = input.source?.trim() || 'Fixture scan';
    const cta = input.cta?.trim() || 'More football updates in bio';
    const updatedLabel = parseTimestampLabel(input.updatedAt);
    const headerY = 120;
    const tableTop = 240;
    const rowHeight = 64;
    const rowsSvg = rows
        .map((row, index) => {
        const y = tableTop + index * rowHeight;
        const fill = index % 2 === 0 ? '#141414' : '#1d1d1d';
        const odds = row.odds?.trim() || '-';
        return `
        <rect x="120" y="${y}" width="1360" height="${rowHeight - 4}" rx="12" fill="${fill}"/>
        <text x="155" y="${y + 42}" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="${ACCENT}">${index + 1}</text>
        <text x="240" y="${y + 42}" font-family="Arial, Helvetica, sans-serif" font-size="27" font-weight="600" fill="#ffffff">${escapeXml(clampText(row.fixture, 42))}</text>
        <rect x="1240" y="${y + 14}" width="180" height="34" rx="17" fill="${ACCENT}"/>
        <text x="1330" y="${y + 39}" font-family="Arial, Helvetica, sans-serif" font-size="21" font-weight="800" fill="#111111" text-anchor="middle">${escapeXml(clampText(odds, 16))}</text>
      `;
    })
        .join('');
    const svg = `
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#111827"/>
          <stop offset="58%" stop-color="#172554"/>
          <stop offset="100%" stop-color="#020617"/>
        </linearGradient>
      </defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
      <rect x="40" y="36" width="1520" height="828" rx="40" fill="#0b0b0b"/>
      <rect x="40" y="36" width="1520" height="120" rx="40" fill="#111111"/>
      <rect x="40" y="126" width="1520" height="2" fill="${ACCENT}"/>

      <text x="120" y="${headerY}" font-family="Arial, Helvetica, sans-serif" font-size="54" font-weight="800" fill="${ACCENT}">MATCH PICKS</text>
      <text x="120" y="${headerY + 42}" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="500" fill="#f2f2f2">PREDICTIONS BOARD - Updated ${escapeXml(updatedLabel)} EAT</text>

      <rect x="120" y="188" width="1360" height="44" rx="10" fill="#171717"/>
      <text x="155" y="218" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="${SECONDARY_ACCENT}">#</text>
      <text x="240" y="218" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="${SECONDARY_ACCENT}">FIXTURE</text>
      <text x="1420" y="218" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="${SECONDARY_ACCENT}" text-anchor="end">PICK / ODDS</text>

      ${rowsSvg}

      <text x="120" y="828" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="500" fill="#d4d4d4">Source: ${escapeXml(source)}</text>
      <text x="1480" y="828" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700" fill="${ACCENT}" text-anchor="end">${escapeXml(cta)}</text>
    </svg>
  `;
    return sharp(Buffer.from(svg)).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}
