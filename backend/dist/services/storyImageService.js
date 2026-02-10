import sharp from 'sharp';
const WIDTH = 1080;
const HEIGHT = 1920;
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
        const nextLimit = Math.max(100, candidate.length - 40);
        candidate = summarizeToLength(candidate, nextLimit);
    }
    return wrapText(summarizeToLength(text, maxChars * maxLines - 10), maxChars, maxLines).lines;
};
export async function renderStoryImage(input) {
    const headline = input.headline?.trim() || 'AI Update';
    const summary = input.summary?.trim() || '';
    const source = input.source?.trim() || '';
    const headlineLines = wrapText(headline, 28, 3).lines;
    const summaryLines = summary ? fitSummaryLines(summary, 40, 4) : [];
    const headlineStartY = 360;
    const headlineLineHeight = 78;
    const summaryStartY = headlineStartY + headlineLines.length * headlineLineHeight + 40;
    const summaryLineHeight = 46;
    const footerY = HEIGHT - 140;
    const headlineTspans = headlineLines
        .map((line, idx) => `<tspan x="96" dy="${idx === 0 ? 0 : headlineLineHeight}">${escapeXml(line)}</tspan>`)
        .join('');
    const summaryTspans = summaryLines
        .map((line, idx) => `<tspan x="96" dy="${idx === 0 ? 0 : summaryLineHeight}">${escapeXml(line)}</tspan>`)
        .join('');
    const sourceText = source ? `Source: ${source}` : 'Source: AI news highlights';
    const svg = `
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0b1026"/>
          <stop offset="60%" stop-color="#161b36"/>
          <stop offset="100%" stop-color="#1f2542"/>
        </linearGradient>
        <radialGradient id="glow" cx="20%" cy="10%" r="60%">
          <stop offset="0%" stop-color="#2fe3ff" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#2fe3ff" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow)"/>
      <rect x="64" y="220" width="952" height="1150" rx="40" fill="rgba(12,16,32,0.65)" stroke="rgba(124,231,255,0.25)" stroke-width="2"/>

      <text x="96" y="260" font-family="Inter, Arial, sans-serif" font-size="30" fill="#7ce7ff" letter-spacing="2">
        AI NEWS • TRENDING
      </text>
      <text x="96" y="${headlineStartY}" font-family="Inter, Arial, sans-serif" font-size="64" font-weight="700" fill="#ffffff">
        ${headlineTspans}
      </text>
      ${summaryLines.length
        ? `<text x="96" y="${summaryStartY}" font-family="Inter, Arial, sans-serif" font-size="36" fill="#d9e3ff">
        ${summaryTspans}
      </text>`
        : ''}
      <rect x="96" y="${footerY - 44}" width="600" height="56" rx="28" fill="rgba(124,231,255,0.12)"/>
      <text x="120" y="${footerY - 6}" font-family="Inter, Arial, sans-serif" font-size="28" fill="#7ce7ff">
        ${escapeXml(sourceText)}
      </text>
    </svg>
  `;
    return sharp(Buffer.from(svg)).png().toBuffer();
}
