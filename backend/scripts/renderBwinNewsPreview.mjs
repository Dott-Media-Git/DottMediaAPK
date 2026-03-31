import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import axios from 'axios';
import { load } from 'cheerio';
import sharp from 'sharp';

const RSS_FEEDS = [
  'https://feeds.bbci.co.uk/sport/football/rss.xml',
  'https://www.espn.com/espn/rss/soccer/news',
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const logoPath = path.join(repoRoot, 'docs', 'brand-kits', 'assets', 'bwinbetug-logo.jpeg');
const outputPath = path.join(repoRoot, 'exports', 'bwin-news-green-caption-preview.jpg');

async function fetchFeedItems(feedUrl) {
  const response = await axios.get(feedUrl, {
    timeout: 30000,
    headers: {
      'User-Agent': 'DottMedia-BwinPreview/1.0',
      Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    },
  });
  const $ = load(response.data, { xmlMode: true });
  return $('item')
    .toArray()
    .map(item => {
      const node = $(item);
      return {
        title: node.find('title').first().text().trim(),
        link: node.find('link').first().text().trim(),
        pubDate: node.find('pubDate').first().text().trim(),
        image:
          node.find('media\\:thumbnail, thumbnail').attr('url') ||
          node.find('media\\:content, content').attr('url') ||
          '',
      };
    })
    .filter(item => item.title && item.link);
}

function normalizeNewsImageUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) return '';
  if (/bbc\.co\.uk|bbci\.co\.uk/i.test(url)) {
    return url
      .replace(/\/\d+\/cpsprodpb\//i, '/1024/cpsprodpb/')
      .replace(/\/\d+\/\w+\//i, '/1024/')
      .replace(/\/240\//g, '/1024/')
      .replace(/\/320\//g, '/1024/')
      .replace(/\/480\//g, '/1024/');
  }
  return url.replace(/([?&])w=\d+/gi, '$1w=1600').replace(/([?&])h=\d+/gi, '$1h=900');
}

async function extractArticleImage(articleUrl) {
  const response = await axios.get(articleUrl, {
    timeout: 30000,
    headers: {
      'User-Agent': 'DottMedia-BwinPreview/1.0',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  const $ = load(response.data);
  const candidates = [
    $('meta[property="og:image"]').attr('content'),
    $('meta[name="twitter:image"]').attr('content'),
    $('meta[property="og:image:url"]').attr('content'),
  ]
    .map(normalizeNewsImageUrl)
    .filter(Boolean);
  return candidates[0] || '';
}

async function chooseLatestNews() {
  const allItems = [];
  for (const feedUrl of RSS_FEEDS) {
    try {
      const items = await fetchFeedItems(feedUrl);
      allItems.push(...items);
    } catch (error) {
      console.warn('[preview] feed failed', feedUrl, error instanceof Error ? error.message : String(error));
    }
  }

  const dated = allItems
    .map(item => ({
      ...item,
      image: normalizeNewsImageUrl(item.image),
      publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(0),
    }))
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

  for (const item of dated.slice(0, 12)) {
    let imageUrl = item.image;
    if (!imageUrl) {
      try {
        imageUrl = await extractArticleImage(item.link);
      } catch {
        imageUrl = '';
      }
    }
    if (!imageUrl) continue;
    try {
      await axios.get(imageUrl, {
        timeout: 20000,
        responseType: 'arraybuffer',
        headers: { 'User-Agent': 'DottMedia-BwinPreview/1.0' },
      });
      return { ...item, imageUrl };
    } catch {
      continue;
    }
  }
  throw new Error('No football news image candidate found');
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapText(text, maxCharsPerLine = 34, maxLines = 3) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[.?!,:;]+$/,'').trim()}...`;
  }
  return lines;
}

async function renderPreview() {
  const candidate = await chooseLatestNews();
  const imageResp = await axios.get(candidate.imageUrl, {
    responseType: 'arraybuffer',
    timeout: 60000,
    headers: { 'User-Agent': 'DottMedia-BwinPreview/1.0' },
  });
  const source = Buffer.from(imageResp.data);
  const base = sharp(source).rotate();
  const metadata = await base.metadata();
  const width = metadata.width || 1296;
  const height = metadata.height || 729;

  const logoWidth = Math.max(Math.round(width * 0.18), 180);
  const logo = await sharp(logoPath).resize({ width: logoWidth, withoutEnlargement: true }).png().toBuffer();
  const logoMeta = await sharp(logo).metadata();
  const margin = Math.max(Math.round(width * 0.028), 22);
  const logoLeft = Math.max(width - (logoMeta.width || logoWidth) - margin, 0);
  const logoTop = margin;

  const panelWidth = Math.min(Math.round(width * 0.76), 920);
  const panelHeight = Math.min(Math.round(height * 0.28), 220);
  const panelLeft = margin;
  const panelTop = height - panelHeight - margin;

  const titleLines = wrapText(candidate.title, width >= 1200 ? 34 : 28, 3);
  const titleSvg = titleLines
    .map((line, index) => {
      const y = 104 + index * 48;
      return `<text x="42" y="${y}" fill="#f7fff8" font-size="42" font-weight="800" font-family="Arial, Segoe UI, sans-serif">${escapeXml(line)}</text>`;
    })
    .join('');

  const overlaySvg = `
  <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="newsCard" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="rgba(11,63,40,0.92)"/>
        <stop offset="52%" stop-color="rgba(18,112,63,0.88)"/>
        <stop offset="100%" stop-color="rgba(111,214,145,0.82)"/>
      </linearGradient>
      <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#b5ffd0"/>
        <stop offset="100%" stop-color="#23d16b"/>
      </linearGradient>
      <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%">
        <feDropShadow dx="0" dy="10" stdDeviation="16" flood-color="rgba(0,0,0,0.28)"/>
      </filter>
    </defs>
    <g filter="url(#shadow)">
      <rect x="${panelLeft}" y="${panelTop}" rx="28" ry="28" width="${panelWidth}" height="${panelHeight}" fill="url(#newsCard)"/>
      <rect x="${panelLeft + 22}" y="${panelTop + 20}" rx="12" ry="12" width="222" height="34" fill="rgba(255,255,255,0.12)"/>
      <text x="${panelLeft + 38}" y="${panelTop + 43}" fill="#d6ffe5" font-size="18" font-weight="700" font-family="Arial, Segoe UI, sans-serif" letter-spacing="1.1">BWINBET FOOTBALL NEWS</text>
      <rect x="${panelLeft + 22}" y="${panelTop + 72}" rx="3" ry="3" width="${Math.min(panelWidth - 44, 250)}" height="6" fill="url(#accent)"/>
      ${titleSvg.replaceAll('x="42"', `x="${panelLeft + 36}"`).replaceAll('y="104"', `y="${panelTop + 118}"`).replaceAll('y="152"', `y="${panelTop + 166}"`).replaceAll('y="200"', `y="${panelTop + 214}"`)}
    </g>
  </svg>`;

  const output = await base
    .composite([
      { input: Buffer.from(overlaySvg), top: 0, left: 0 },
      { input: logo, top: logoTop, left: logoLeft },
    ])
    .jpeg({ quality: 94, mozjpeg: true })
    .toBuffer();

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, output);

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputPath,
        title: candidate.title,
        sourceUrl: candidate.link,
        sourceImageUrl: candidate.imageUrl,
      },
      null,
      2,
    ),
  );
}

renderPreview().catch(error => {
  console.error('[preview] failed', error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
