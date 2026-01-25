# BwinBet UG Brand Kit (Draft)

Source: https://m.bwinbetug.com (mobile web app)

## Brand Overview
- Brand name: bwinbet (shown in lowercase wordmark)
- Category: sports betting / gaming
- Visual personality: bold, high-contrast, energetic, data-driven
- Primary vibe: confident, fast, match-day intensity

## Logo
- Primary logo: black "bwinbet" wordmark on a solid yellow background.
- Structure: "bwin" sits inside a black rectangle; "bet" follows in black.
- Clear space: keep at least the height of the "b" around all sides.
- Minimum size: avoid rendering below 120px wide for digital legibility.
- Logo file: `docs/brand-kits/assets/bwinbetug-logo.jpeg` (369x136).
- Backgrounds:
  - Preferred: solid yellow (brand gold).
  - Secondary: solid dark green with logo in yellow.
  - Avoid: busy photos or gradients behind the wordmark.

## Color Palette
Primary colors (from theme + CSS):
- Brand Gold: #FFCA08 (primary background)
- Brand Green: #005540 (primary accent / theme)
- Brand Black: #000000 (logo / headline)

Secondary colors (UI accents):
- Alert Red: #F53D3D
- Deep Green: #14634F
- Mid Gray: #343434
- Dark Gray: #222222
- Light Gray: #F4F4F4
- Neutral Gray: #E0E0E0

Suggested usage:
- Gold for major surfaces, banners, CTA blocks.
- Green for navigation, confirmations, odds highlights.
- Black for text on gold.
- Red for losses, alerts, or key warnings.
- Grays for cards, dividers, secondary text.

CSS variables (example):
```
:root {
  --bwin-gold: #ffca08;
  --bwin-green: #005540;
  --bwin-black: #000000;
  --bwin-red: #f53d3d;
  --bwin-gray-900: #222222;
  --bwin-gray-700: #343434;
  --bwin-gray-100: #f4f4f4;
  --bwin-gray-200: #e0e0e0;
}
```

## Typography
Primary (headlines):
- FreightSansProSemibold
- FreightSans (fallback for headlines)

Secondary (body/UI):
- Roboto
- Noto Sans (fallback)

Suggested stack:
- Headline: "FreightSansProSemibold", "FreightSans", "Roboto", "Noto Sans", sans-serif
- Body: "Roboto", "Noto Sans", "Helvetica Neue", sans-serif

## Layout & UI Style
- Bold blocks and clear sections (cards, tiles, and tabs).
- High contrast text on gold or dark backgrounds.
- Strong CTA buttons with full-width blocks on mobile.
- Use black labels on gold for emphasis.
- Keep spacing tight but consistent (mobile-first).

## Imagery & Graphics
- Match-day energy: stadium lights, pitch textures, football close-ups.
- Use dynamic crops and motion blur sparingly.
- Poster style: bold headline block, player silhouette or action pose, clear odds or key stat.
- Keep overlays minimal and legible; reserve a safe zone for the logo.

## Iconography
- Uses Ionic/Ionicons + custom sports icons.
- Prefer simple, filled icons with solid strokes.
- Avoid thin-outline icons on busy backgrounds.

## Tone of Voice
- Confident, fast, and outcome-focused.
- Short, punchy lines; avoid fluff.
- Use betting terms fans recognize (odds, slips, matchday, boost).
- Always include responsible betting wording when required by platform or region.

## Accessibility & Compliance
- Maintain WCAG contrast for text on gold and green backgrounds.
- Avoid excessive red/green-only indicators; include text or icons.
- Add responsible betting reminders where required.

## Social Content Guidelines
- Posters: big headline, key stat, small subline, logo bottom-left or bottom-right.
- Reels/TikTok: quick hooks, visual scoreline, short CTA.
- Memes: bold captions, neutral tone, avoid risky or irresponsible calls.

## Templates (Ready Layouts)
- Instagram poster: `docs/brand-kits/templates/bwinbetug/instagram-poster.md`
- Instagram square: `docs/brand-kits/templates/bwinbetug/instagram-square.md`
- Instagram story: `docs/brand-kits/templates/bwinbetug/instagram-story.md`
- X image: `docs/brand-kits/templates/bwinbetug/x-image.md`
- YouTube thumbnail: `docs/brand-kits/templates/bwinbetug/youtube-thumbnail.md`
- TikTok/Reels cover: `docs/brand-kits/templates/bwinbetug/tiktok-cover.md`

## Notes
- Theme colors from manifest: background #FFCA08, theme #005540.
- Wordmark sampled from launcher icon in manifest.
