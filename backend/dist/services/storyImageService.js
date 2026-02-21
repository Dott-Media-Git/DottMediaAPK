import axios from 'axios';
import sharp from 'sharp';
const WIDTH = 1080;
const HEIGHT = 1920;
const IMAGE_FRAME = {
    x: 96,
    y: 940,
    width: 888,
    height: 430,
    radius: 34,
};
const escapeXml = (value) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&apos;');
const wrapText = (text, maxChars, maxLines) => {
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let current = '';
    let truncated = false;
    for (let i = 0; i < words.length; i += 1) {
        const word = words[i];
        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length <= maxChars) {
            current = candidate;
            continue;
        }
        if (current)
            lines.push(current);
        current = word;
        if (lines.length >= maxLines) {
            truncated = true;
            current = '';
            break;
        }
        if (lines.length >= maxLines - 1 && i < words.length - 1) {
            truncated = true;
            break;
        }
    }
    if (current && lines.length < maxLines)
        lines.push(current);
    if (lines.length === maxLines && words.length) {
        const used = lines.join(' ').split(/\s+/).length;
        if (used < words.length)
            truncated = true;
    }
    return { lines, truncated };
};
const summarizeToLength = (text, maxChars) => {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned)
        return '';
    if (cleaned.length <= maxChars)
        return cleaned;
    const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
    let summary = '';
    for (const sentence of sentences) {
        const candidate = summary ? `${summary} ${sentence}` : sentence;
        if (candidate.length > maxChars)
            break;
        summary = candidate;
        if (summary.length >= maxChars * 0.75)
            break;
    }
    if (!summary) {
        const truncated = cleaned.slice(0, maxChars);
        const lastSpace = truncated.lastIndexOf(' ');
        summary = lastSpace > 60 ? truncated.slice(0, lastSpace) : truncated;
    }
    const trimmed = summary.trim();
    if (!/[.!?]$/.test(trimmed))
        return `${trimmed}.`;
    return trimmed;
};
const fitSummaryLines = (text, maxChars, maxLines) => {
    let candidate = text;
    for (let i = 0; i < 4; i += 1) {
        const result = wrapText(candidate, maxChars, maxLines);
        if (!result.truncated)
            return result.lines;
        const nextLimit = Math.max(90, candidate.length - 35);
        candidate = summarizeToLength(candidate, nextLimit);
    }
    return wrapText(summarizeToLength(text, maxChars * maxLines - 10), maxChars, maxLines).lines;
};
const fetchCardImage = async (url) => {
    const target = url.trim();
    if (!target)
        return null;
    try {
        const response = await axios.get(target, {
            timeout: 10000,
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; DottMediaBot/1.0)',
                Accept: 'image/*,*/*;q=0.8',
            },
            maxRedirects: 3,
        });
        const raw = Buffer.from(response.data);
        const fitted = await sharp(raw)
            .rotate()
            .resize(IMAGE_FRAME.width, IMAGE_FRAME.height, { fit: 'cover' })
            .png()
            .toBuffer();
        const roundedMask = Buffer.from(`<svg width="${IMAGE_FRAME.width}" height="${IMAGE_FRAME.height}" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="${IMAGE_FRAME.width}" height="${IMAGE_FRAME.height}" rx="${IMAGE_FRAME.radius}" ry="${IMAGE_FRAME.radius}" fill="#ffffff"/>
      </svg>`);
        return sharp(fitted).composite([{ input: roundedMask, blend: 'dest-in' }]).png().toBuffer();
    }
    catch (error) {
        console.warn('[story-image] source image fetch failed', error.message);
        return null;
    }
};
export async function renderStoryImage(input) {
    const headline = input.headline?.trim() || 'AI Update';
    const summary = input.summary?.trim() || '';
    const source = input.source?.trim() || '';
    const sourceImageUrl = input.imageUrl?.trim() || '';
    const headlineLines = wrapText(headline, 28, 3).lines;
    const summaryLines = summary ? fitSummaryLines(summary, 40, 4) : [];
    const headlineStartY = 360;
    const headlineLineHeight = 74;
    const summaryStartY = headlineStartY + headlineLines.length * headlineLineHeight + 34;
    const summaryLineHeight = 44;
    const sourceText = source ? `Source: ${source}` : 'Source: AI news highlights';
    const headlineTspans = headlineLines
        .map((line, idx) => `<tspan x="96" dy="${idx === 0 ? 0 : headlineLineHeight}">${escapeXml(line)}</tspan>`)
        .join('');
    const summaryTspans = summaryLines
        .map((line, idx) => `<tspan x="96" dy="${idx === 0 ? 0 : summaryLineHeight}">${escapeXml(line)}</tspan>`)
        .join('');
    const svg = `
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#080d22"/>
          <stop offset="50%" stop-color="#141a37"/>
          <stop offset="100%" stop-color="#202a4d"/>
        </linearGradient>
        <radialGradient id="glowA" cx="18%" cy="8%" r="55%">
          <stop offset="0%" stop-color="#30e6ff" stop-opacity="0.28"/>
          <stop offset="100%" stop-color="#30e6ff" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="glowB" cx="90%" cy="92%" r="60%">
          <stop offset="0%" stop-color="#7b5cff" stop-opacity="0.22"/>
          <stop offset="100%" stop-color="#7b5cff" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glowA)"/>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glowB)"/>

      <rect x="64" y="220" width="952" height="1250" rx="40" fill="rgba(10,14,32,0.68)" stroke="rgba(125,233,255,0.24)" stroke-width="2"/>

      <text x="96" y="276" font-family="Inter, Arial, sans-serif" font-size="30" fill="#7de9ff" letter-spacing="2">LIVE AI NEWS</text>
      <text x="96" y="${headlineStartY}" font-family="Inter, Arial, sans-serif" font-size="64" font-weight="700" fill="#ffffff">
        ${headlineTspans}
      </text>
      ${summaryLines.length
        ? `<text x="96" y="${summaryStartY}" font-family="Inter, Arial, sans-serif" font-size="35" fill="#dbe6ff">
              ${summaryTspans}
            </text>`
        : ''}

      <rect x="${IMAGE_FRAME.x}" y="${IMAGE_FRAME.y}" width="${IMAGE_FRAME.width}" height="${IMAGE_FRAME.height}" rx="${IMAGE_FRAME.radius}" fill="rgba(36,45,81,0.55)" stroke="rgba(125,233,255,0.32)" stroke-width="2"/>
      <text x="124" y="${IMAGE_FRAME.y + 58}" font-family="Inter, Arial, sans-serif" font-size="28" fill="rgba(221,233,255,0.9)">Related Image</text>

      <rect x="96" y="1410" width="760" height="54" rx="27" fill="rgba(125,233,255,0.12)"/>
      <text x="122" y="1447" font-family="Inter, Arial, sans-serif" font-size="26" fill="#7de9ff">${escapeXml(sourceText)}</text>
      <text x="96" y="1498" font-family="Inter, Arial, sans-serif" font-size="24" fill="rgba(220,228,248,0.86)">Updated just now</text>
    </svg>
  `;
    const cardImage = sourceImageUrl ? await fetchCardImage(sourceImageUrl) : null;
    const baseBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
    if (!cardImage) {
        return baseBuffer;
    }
    return sharp(baseBuffer)
        .composite([
        {
            input: cardImage,
            left: IMAGE_FRAME.x,
            top: IMAGE_FRAME.y,
        },
    ])
        .png()
        .toBuffer();
}
