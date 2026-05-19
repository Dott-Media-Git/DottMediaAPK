import axios from 'axios';

export type GamersSteamPost = {
  game: string;
  appId: number;
  url: string;
  images: string[];
  description?: string;
};

export type GamersSteamVideo = {
  game: string;
  appId: number;
  url: string;
  videoUrl: string;
};

const STEAM_APPS: Array<{ appId: number; name: string }> = [
  { appId: 730, name: 'Counter-Strike 2' },
  { appId: 570, name: 'Dota 2' },
  { appId: 1172470, name: 'Apex Legends' },
  { appId: 578080, name: 'PUBG: Battlegrounds' },
  { appId: 1085660, name: 'Destiny 2' },
  { appId: 230410, name: 'Warframe' },
  { appId: 2073850, name: 'THE FINALS' },
  { appId: 1203220, name: 'NARAKA: BLADEPOINT' },
  { appId: 271590, name: 'Grand Theft Auto V Enhanced' },
  { appId: 1245620, name: 'ELDEN RING' },
  { appId: 252490, name: 'Rust' },
  { appId: 359550, name: "Tom Clancy's Rainbow Six Siege X" },
  { appId: 1938090, name: 'Call of Duty' },
  { appId: 1551360, name: 'Forza Horizon 5' },
  { appId: 236390, name: 'War Thunder' },
];

const USER_AGENT =
  process.env.GAMERS_SOURCE_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const unique = (items: string[]) => {
  const seen = new Set<string>();
  return items.filter(item => {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
};

const shuffled = <T>(items: T[]) => [...items].sort(() => Math.random() - 0.5);

const decodeHtml = (value: string) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\\\//g, '/')
    .replace(/\\/g, '');

async function fetchSteamApp(appId: number) {
  const response = await axios.get('https://store.steampowered.com/api/appdetails', {
    params: {
      appids: appId,
      filters: 'basic,screenshots',
    },
    headers: { 'User-Agent': USER_AGENT },
    timeout: 30000,
  });
  const data = response.data?.[String(appId)]?.data;
  if (!data) throw new Error(`No Steam app details for ${appId}`);
  return data as {
    name?: string;
    steam_appid?: number;
    short_description?: string;
    screenshots?: Array<{ path_full?: string; path_thumbnail?: string }>;
  };
}

async function fetchSteamAppPage(appId: number) {
  const response = await axios.get(`https://store.steampowered.com/app/${appId}/`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    timeout: 30000,
  });
  return String(response.data ?? '');
}

const screenshotHistoryKey = (appId: number) => `steam-game:${appId}`;

export async function pickGamersSteamScreenshots(options: { recentKeys?: Set<string> } = {}) {
  const recent = options.recentKeys ?? new Set<string>();
  for (const app of shuffled(STEAM_APPS)) {
    if (recent.has(screenshotHistoryKey(app.appId))) continue;
    try {
      const data = await fetchSteamApp(app.appId);
      const images = unique(
        (data.screenshots ?? [])
          .map(screenshot => screenshot.path_full || screenshot.path_thumbnail || '')
          .filter(Boolean)
          .map(url => decodeHtml(url)),
      ).filter(url => !recent.has(url));
      if (images.length < 2) continue;
      return {
        game: data.name?.trim() || app.name,
        appId: app.appId,
        url: `https://store.steampowered.com/app/${app.appId}/`,
        images: images.slice(0, 6),
        description: data.short_description?.replace(/<[^>]+>/g, '').trim(),
      } satisfies GamersSteamPost;
    } catch {
      // Try the next game.
    }
  }
  throw new Error('No fresh Steam gameplay screenshots found');
}

function extractSteamMp4Urls(html: string) {
  const decoded = decodeHtml(html);
  return unique(
    [
      ...Array.from(decoded.matchAll(/mp4="(https?:\/\/[^"]+?\.mp4(?:\?[^"]*)?)"/gi)).map(match => match[1]),
      ...Array.from(decoded.matchAll(/https?:\/\/[^"'\s<>]+?\.mp4(?:\?[^"'\s<>]*)?/gi)).map(match => match[0]),
    ]
      .map(url => decodeHtml(url))
      .filter(url => /(?:steamstatic|akamaihd|fastly)\.com\//i.test(url)),
  );
}

async function isUsableMp4(url: string) {
  try {
    const response = await axios.head(url, {
      headers: { 'User-Agent': USER_AGENT },
      maxRedirects: 5,
      timeout: 12000,
      validateStatus: status => status >= 200 && status < 400,
    });
    const type = String(response.headers['content-type'] ?? '').toLowerCase();
    const length = Number(response.headers['content-length'] ?? 0);
    return (type.startsWith('video/') || type === 'application/octet-stream') && (!length || length > 100_000);
  } catch {
    return false;
  }
}

export async function pickGamersSteamVideo(options: { recentVideos?: Set<string> } = {}) {
  const recent = options.recentVideos ?? new Set<string>();
  for (const app of shuffled(STEAM_APPS)) {
    try {
      const html = await fetchSteamAppPage(app.appId);
      const videos = extractSteamMp4Urls(html).filter(url => !recent.has(url));
      for (const videoUrl of videos) {
        if (!(await isUsableMp4(videoUrl))) continue;
        return {
          game: app.name,
          appId: app.appId,
          url: `https://store.steampowered.com/app/${app.appId}/`,
          videoUrl,
        } satisfies GamersSteamVideo;
      }
    } catch {
      // Try the next game.
    }
  }
  return null;
}

export function buildGamersSteamCaption(post: GamersSteamPost) {
  const lines = [
    `${post.game} gameplay spotlight`,
    '',
    post.description
      ? `${post.description.slice(0, 220)}${post.description.length > 220 ? '...' : ''}`
      : 'Actual gameplay screenshots from the official game page. Swipe through and tell us what moment you would clip.',
    '',
    'What are you playing today? Drop your game, rank, platform, or next highlight idea.',
    '',
    post.url,
    '',
    '#Gamers44life #Gameplay #GamingCommunity #GamingLife #PCGaming #ConsoleGaming',
  ];
  return lines.filter((line, index) => line || lines[index - 1]).join('\n');
}

export function buildGamersSteamVideoCaption(video: GamersSteamVideo) {
  return [
    `${video.game} gameplay clip`,
    '',
    'Actual gameplay footage from the official game page. Rate the action and tell us what game should come next.',
    '',
    video.url,
    '',
    '#Gamers44life #Gameplay #GamingReels #GamingCommunity #GamingLife',
  ].join('\n');
}

export function gamersSteamHistoryKey(post: Pick<GamersSteamPost, 'appId'>) {
  return screenshotHistoryKey(post.appId);
}
