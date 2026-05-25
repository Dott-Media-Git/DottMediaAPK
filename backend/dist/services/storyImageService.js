import axios from 'axios';
import sharp from 'sharp';
const WIDTH = 1080;
const HEIGHT = 1920;
const CARD = {
    x: 62,
    y: 138,
    width: 956,
    height: 1644,
    radius: 46,
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
    for (let i = 0; i < words.length; i += 1) {
        const word = words[i];
        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length <= maxChars || !current) {
            current = candidate;
            continue;
        }
        lines.push(current);
        current = word;
        if (lines.length >= maxLines - 1)
            break;
    }
    if (current && lines.length < maxLines)
        lines.push(current);
    return lines.slice(0, maxLines);
};
const fetchFullBleedImage = async (url) => {
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
        return sharp(Buffer.from(response.data))
            .rotate()
            .resize(CARD.width, CARD.height, { fit: 'cover', position: 'attention' })
            .png()
            .toBuffer();
    }
    catch (error) {
        console.warn('[story-image] source image fetch failed', error.message);
        return null;
    }
};
export async function renderStoryImage(input) {
    const headline = input.headline?.trim() || 'Football update';
    const sourceImageUrl = input.imageUrl?.trim() || '';
    const background = sourceImageUrl ? await fetchFullBleedImage(sourceImageUrl) : null;
    const headlineLines = wrapText(headline, 15, 5);
    const headlineLineHeight = 82;
    const headlineTspans = headlineLines
        .map((line, idx) => `<tspan x="${CARD.x + 56}" dy="${idx === 0 ? 0 : headlineLineHeight}">${escapeXml(line.toUpperCase())}</tspan>`)
        .join('');
    const cardMask = Buffer.from(`<svg width="${CARD.width}" height="${CARD.height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${CARD.width}" height="${CARD.height}" rx="${CARD.radius}" ry="${CARD.radius}" fill="#ffffff"/>
    </svg>`);
    const overlaySvg = `
    <svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="fallback" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#111827"/>
          <stop offset="100%" stop-color="#0f766e"/>
        </linearGradient>
        <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#020617" stop-opacity="0.02"/>
          <stop offset="45%" stop-color="#020617" stop-opacity="0.16"/>
          <stop offset="100%" stop-color="#020617" stop-opacity="0.92"/>
        </linearGradient>
      </defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="#050816"/>
      <rect x="${CARD.x - 10}" y="${CARD.y - 10}" width="${CARD.width + 20}" height="${CARD.height + 20}" rx="${CARD.radius + 10}" fill="#000000" opacity="0.38"/>
      ${background ? '' : `<rect x="${CARD.x}" y="${CARD.y}" width="${CARD.width}" height="${CARD.height}" rx="${CARD.radius}" fill="url(#fallback)"/>`}
      <rect x="${CARD.x}" y="${CARD.y}" width="${CARD.width}" height="${CARD.height}" rx="${CARD.radius}" fill="url(#shade)"/>
      <rect x="${CARD.x + 56}" y="${CARD.y + CARD.height - 520}" width="148" height="12" rx="6" fill="#38bdf8"/>
      <text x="${CARD.x + 56}" y="${CARD.y + CARD.height - 426}" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="72" font-weight="900" fill="#ffffff">
        ${headlineTspans}
      </text>
    </svg>
  `;
    const overlay = await sharp(Buffer.from(overlaySvg)).png().toBuffer();
    if (!background)
        return overlay;
    const roundedBackground = await sharp(background).composite([{ input: cardMask, blend: 'dest-in' }]).png().toBuffer();
    return sharp(background)
        .resize(WIDTH, HEIGHT, { fit: 'cover' })
        .blur(18)
        .modulate({ brightness: 0.42, saturation: 0.75 })
        .composite([
        { input: roundedBackground, left: CARD.x, top: CARD.y },
        { input: overlay, left: 0, top: 0 },
    ])
        .png()
        .toBuffer();
}
