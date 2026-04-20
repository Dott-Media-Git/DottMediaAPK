import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const WIDTH = 1080;
const HEIGHT = 1350;
const FOOTER_HEIGHT = 126;

const escapeXml = value =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const clampText = (value, max) => {
  const clean = String(value || '').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(max - 3, 1))}...`;
};

const toDisplayTime = value => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
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
    path.resolve(process.cwd(), 'docs/brand-kits/assets/bwinbetug-logo-from-pdf.png'),
    path.resolve(process.cwd(), 'docs/brand-kits/assets/bwinbetug-logo.jpeg'),
    path.resolve(process.cwd(), '../docs/brand-kits/assets/bwinbetug-logo-from-pdf.png'),
    path.resolve(process.cwd(), '../docs/brand-kits/assets/bwinbetug-logo.jpeg'),
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
};

async function addBrandOverlay(buffer) {
  const logoPath = resolveLogoPath();
  if (!logoPath) return buffer;
  try {
    const logo = await sharp(logoPath).resize({ width: 250, withoutEnlargement: true }).png().toBuffer();
    return sharp(buffer)
      .composite([{ input: logo, left: 56, top: 48 }])
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
  } catch (error) {
    console.warn('[bwin-prediction-render] logo overlay failed', error instanceof Error ? error.message : String(error));
    return buffer;
  }
}

function renderPredictionRows(picks) {
  const rowHeight = 165;
  const top = 246;
  return picks
    .slice(0, 5)
    .map((pick, index) => {
      const y = top + index * rowHeight;
      const kickoff = escapeXml(toDisplayTime(pick.kickoff));
      const fixture = escapeXml(clampText(pick.fixture, 34));
      const league = escapeXml(clampText(pick.leagueLabel, 24));
      const market = escapeXml(clampText(pick.marketLabel, 24));
      const confidence = escapeXml(`${pick.confidence} edge`);
      const odds = escapeXml(`${pick.estimatedOdds}`);
      const fill = index % 2 === 0 ? '#131313' : '#181818';
      return `
        <rect x="52" y="${y}" width="976" height="138" rx="34" fill="${fill}" stroke="#2a2a2a" stroke-width="2"/>
        <text x="86" y="${y + 52}" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" fill="#ffd43c">${league}</text>
        <text x="86" y="${y + 88}" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="800" fill="#ffffff">${fixture}</text>
        <text x="86" y="${y + 118}" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="500" fill="#d7d7d7">${kickoff} EAT</text>
        <rect x="662" y="${y + 28}" width="238" height="40" rx="20" fill="#ffca08"/>
        <text x="781" y="${y + 56}" font-family="Arial, Helvetica, sans-serif" font-size="19" font-weight="800" fill="#111111" text-anchor="middle">${market}</text>
        <rect x="914" y="${y + 28}" width="92" height="40" rx="20" fill="#1f8c46"/>
        <text x="960" y="${y + 56}" font-family="Arial, Helvetica, sans-serif" font-size="19" font-weight="800" fill="#ffffff" text-anchor="middle">${odds}</text>
        <text x="1004" y="${y + 116}" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="600" fill="#cfcfcf" text-anchor="end">${confidence}</text>
      `;
    })
    .join('');
}

export async function renderPredictionCardBuffer(batch) {
  const generatedLabel = toDisplayTime(batch.generatedAt);
  const subtitle = escapeXml(`AI model picks | Updated ${generatedLabel} EAT`);
  const rowsSvg = renderPredictionRows(batch.picks || []);
  const svg = `
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0b0b0b"/>
          <stop offset="55%" stop-color="#101010"/>
          <stop offset="100%" stop-color="#161616"/>
        </linearGradient>
        <linearGradient id="glow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ffca08" stop-opacity="0.16"/>
          <stop offset="100%" stop-color="#ffca08" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="footer" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#0d5b29"/>
          <stop offset="100%" stop-color="#0f6c30"/>
        </linearGradient>
      </defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
      <circle cx="850" cy="210" r="260" fill="url(#glow)"/>
      <circle cx="180" cy="1120" r="200" fill="url(#glow)"/>

      <text x="56" y="154" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="900" fill="#ffca08">PREDICTION BOARD</text>
      <text x="56" y="196" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="500" fill="#f3f3f3">${subtitle}</text>
      <text x="1024" y="88" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="800" fill="#ffca08" text-anchor="end">www.bwinbetug.com</text>
      <text x="56" y="228" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" fill="#d8d8d8">Fixtures, picks and estimated odds for the next board.</text>

      ${rowsSvg}

      <rect x="0" y="${HEIGHT - FOOTER_HEIGHT}" width="${WIDTH}" height="${FOOTER_HEIGHT}" fill="url(#footer)"/>
      <text x="56" y="${HEIGHT - 62}" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="600" fill="#ffffff">Betting is addictive and can be psychologically harmful.</text>
      <text x="56" y="${HEIGHT - 32}" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="500" fill="#d7f5df">Bwinbet is licensed and regulated by the National Lotteries and Gaming Regulatory Board.</text>
      <text x="1008" y="${HEIGHT - 42}" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="900" fill="#ffca08" text-anchor="end">25+</text>
      <text x="1014" y="${HEIGHT - 16}" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" fill="#ffffff" text-anchor="end">Play Responsibly</text>
    </svg>
  `;

  const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  return addBrandOverlay(buffer);
}

function renderRecapRows(winners) {
  const rowHeight = 152;
  const top = 320;
  return winners
    .slice(0, 5)
    .map((pick, index) => {
      const y = top + index * rowHeight;
      const fixture = escapeXml(clampText(pick.fixture, 30));
      const score = escapeXml(pick.scoreLine || '-');
      const pickLabel = escapeXml(clampText(pick.marketLabel, 24));
      const league = escapeXml(clampText(pick.leagueLabel, 22));
      const fill = index % 2 === 0 ? '#131313' : '#181818';
      return `
        <rect x="52" y="${y}" width="976" height="128" rx="32" fill="${fill}" stroke="#225f39" stroke-width="2"/>
        <text x="86" y="${y + 46}" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" fill="#7adf94">${league}</text>
        <text x="86" y="${y + 82}" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="800" fill="#ffffff">${fixture}</text>
        <rect x="686" y="${y + 22}" width="166" height="40" rx="20" fill="#ffca08"/>
        <text x="769" y="${y + 50}" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="800" fill="#111111" text-anchor="middle">${pickLabel}</text>
        <rect x="868" y="${y + 22}" width="72" height="40" rx="20" fill="#1f8c46"/>
        <text x="904" y="${y + 50}" font-family="Arial, Helvetica, sans-serif" font-size="19" font-weight="800" fill="#ffffff" text-anchor="middle">${score}</text>
        <rect x="872" y="${y + 74}" width="134" height="34" rx="17" fill="#0d5b29"/>
        <text x="939" y="${y + 98}" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="800" fill="#ffffff" text-anchor="middle">LANDED</text>
      `;
    })
    .join('');
}

export async function renderPredictionRecapBuffer(settlement) {
  const rowsSvg = renderRecapRows(settlement.winners || []);
  const headline = settlement.allWon
    ? `ALL ${settlement.totalCount} PICKS LANDED`
    : `${settlement.wonCount} OF ${settlement.totalCount} PICKS LANDED`;
  const subtitle = settlement.allWon
    ? 'Every pick on the earlier board went through.'
    : 'Here are the picks from the earlier board that went through.';
  const svg = `
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#07180d"/>
          <stop offset="48%" stop-color="#101010"/>
          <stop offset="100%" stop-color="#0e2014"/>
        </linearGradient>
        <linearGradient id="footer" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#0d5b29"/>
          <stop offset="100%" stop-color="#0f6c30"/>
        </linearGradient>
      </defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
      <text x="56" y="154" font-family="Arial, Helvetica, sans-serif" font-size="56" font-weight="900" fill="#7adf94">PICKS UPDATE</text>
      <text x="56" y="206" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="900" fill="#ffffff">${escapeXml(headline)}</text>
      <text x="56" y="246" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="500" fill="#dcefe1">${escapeXml(subtitle)}</text>
      <text x="1024" y="88" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="800" fill="#ffca08" text-anchor="end">www.bwinbetug.com</text>

      <rect x="56" y="266" width="306" height="34" rx="17" fill="#0d5b29"/>
      <text x="209" y="289" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="800" fill="#ffffff" text-anchor="middle">${escapeXml(
        `${settlement.wonCount} won | ${settlement.lostCount} missed | ${settlement.pendingCount} pending`,
      )}</text>

      ${rowsSvg}

      <rect x="0" y="${HEIGHT - FOOTER_HEIGHT}" width="${WIDTH}" height="${FOOTER_HEIGHT}" fill="url(#footer)"/>
      <text x="56" y="${HEIGHT - 62}" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="600" fill="#ffffff">Betting is addictive and can be psychologically harmful.</text>
      <text x="56" y="${HEIGHT - 32}" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="500" fill="#d7f5df">Bwinbet is licensed and regulated by the National Lotteries and Gaming Regulatory Board.</text>
      <text x="1008" y="${HEIGHT - 42}" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="900" fill="#ffca08" text-anchor="end">25+</text>
      <text x="1014" y="${HEIGHT - 16}" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" fill="#ffffff" text-anchor="end">Play Responsibly</text>
    </svg>
  `;

  const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  return addBrandOverlay(buffer);
}
