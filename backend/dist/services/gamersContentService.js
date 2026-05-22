import axios from 'axios';
const STEAM_APPS = [
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
    { appId: 553850, name: 'HELLDIVERS 2' },
    { appId: 1086940, name: "Baldur's Gate 3" },
    { appId: 1091500, name: 'Cyberpunk 2077' },
    { appId: 2358720, name: 'Black Myth: Wukong' },
    { appId: 2246340, name: 'Monster Hunter Wilds' },
    { appId: 1364780, name: 'Street Fighter 6' },
    { appId: 1778820, name: 'TEKKEN 8' },
    { appId: 381210, name: 'Dead by Daylight' },
    { appId: 1172620, name: 'Sea of Thieves' },
    { appId: 238960, name: 'Path of Exile' },
    { appId: 1142710, name: 'Total War: WARHAMMER III' },
    { appId: 1604030, name: 'V Rising' },
    { appId: 1966720, name: 'Lethal Company' },
    { appId: 526870, name: 'Satisfactory' },
    { appId: 413150, name: 'Stardew Valley' },
    { appId: 582010, name: 'Monster Hunter: World' },
    { appId: 1174180, name: 'Red Dead Redemption 2' },
    { appId: 1222670, name: 'The Sims 4' },
    { appId: 1238810, name: 'Battlefield V' },
    { appId: 1282100, name: 'Remnant II' },
    { appId: 1934680, name: 'Age of Mythology: Retold' },
    { appId: 1284210, name: 'Guild Wars 2' },
    { appId: 1151340, name: 'Fallout 76' },
    { appId: 377160, name: 'Fallout 4' },
    { appId: 489830, name: 'The Elder Scrolls V: Skyrim Special Edition' },
    { appId: 2215430, name: "Ghost of Tsushima DIRECTOR'S CUT" },
    { appId: 2420110, name: 'Horizon Forbidden West Complete Edition' },
    { appId: 1817070, name: "Marvel's Spider-Man Remastered" },
    { appId: 2651280, name: 'Marvel Rivals' },
];
const USER_AGENT = process.env.GAMERS_SOURCE_USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const unique = (items) => {
    const seen = new Set();
    return items.filter(item => {
        const normalized = item.trim();
        if (!normalized || seen.has(normalized))
            return false;
        seen.add(normalized);
        return true;
    });
};
const shuffled = (items) => [...items].sort(() => Math.random() - 0.5);
const decodeHtml = (value) => value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\\\//g, '/')
    .replace(/\\/g, '');
async function fetchSteamApp(appId) {
    const response = await axios.get('https://store.steampowered.com/api/appdetails', {
        params: {
            appids: appId,
            filters: 'basic,screenshots',
        },
        headers: { 'User-Agent': USER_AGENT },
        timeout: 30000,
    });
    const data = response.data?.[String(appId)]?.data;
    if (!data)
        throw new Error(`No Steam app details for ${appId}`);
    return data;
}
async function fetchSteamAppPage(appId) {
    const response = await axios.get(`https://store.steampowered.com/app/${appId}/`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
        timeout: 30000,
    });
    return String(response.data ?? '');
}
const screenshotHistoryKey = (appId) => `steam-game:${appId}`;
export async function pickGamersSteamScreenshots(options = {}) {
    const recent = options.recentKeys ?? new Set();
    const pickFromApps = async (apps, allowRecentImages) => {
        for (const app of shuffled(apps)) {
            try {
                const data = await fetchSteamApp(app.appId);
                const sourceImages = unique((data.screenshots ?? [])
                    .map(screenshot => screenshot.path_full || screenshot.path_thumbnail || '')
                    .filter(Boolean)
                    .map(url => decodeHtml(url)));
                const images = allowRecentImages ? sourceImages : sourceImages.filter(url => !recent.has(url));
                if (images.length < 2)
                    continue;
                return {
                    game: data.name?.trim() || app.name,
                    appId: app.appId,
                    url: `https://store.steampowered.com/app/${app.appId}/`,
                    images: images.slice(0, 6),
                    description: data.short_description?.replace(/<[^>]+>/g, '').trim(),
                };
            }
            catch {
                // Try the next game.
            }
        }
        return null;
    };
    const freshApps = STEAM_APPS.filter(app => !recent.has(screenshotHistoryKey(app.appId)));
    const freshPost = await pickFromApps(freshApps, false);
    if (freshPost)
        return freshPost;
    const recycledPost = await pickFromApps(STEAM_APPS, true);
    if (recycledPost)
        return recycledPost;
    throw new Error('No Steam gameplay screenshots found');
}
function extractSteamMp4Urls(html) {
    const decoded = decodeHtml(html);
    return unique([
        ...Array.from(decoded.matchAll(/mp4="(https?:\/\/[^"]+?\.mp4(?:\?[^"]*)?)"/gi)).map(match => match[1]),
        ...Array.from(decoded.matchAll(/https?:\/\/[^"'\s<>]+?\.mp4(?:\?[^"'\s<>]*)?/gi)).map(match => match[0]),
    ]
        .map(url => decodeHtml(url))
        .filter(url => /(?:steamstatic|akamaihd|fastly)\.com\//i.test(url)));
}
async function isUsableMp4(url) {
    try {
        const response = await axios.head(url, {
            headers: { 'User-Agent': USER_AGENT },
            maxRedirects: 5,
            timeout: 12000,
            validateStatus: status => status >= 200 && status < 400,
        });
        const type = String(response.headers['content-type'] ?? '').toLowerCase();
        const length = Number(response.headers['content-length'] ?? 0);
        return (type.startsWith('video/') || type === 'application/octet-stream') && (!length || length > 100000);
    }
    catch {
        return false;
    }
}
export async function pickGamersSteamVideo(options = {}) {
    const recent = options.recentVideos ?? new Set();
    for (const app of shuffled(STEAM_APPS)) {
        try {
            const html = await fetchSteamAppPage(app.appId);
            const videos = extractSteamMp4Urls(html).filter(url => !recent.has(url));
            for (const videoUrl of videos) {
                if (!(await isUsableMp4(videoUrl)))
                    continue;
                return {
                    game: app.name,
                    appId: app.appId,
                    url: `https://store.steampowered.com/app/${app.appId}/`,
                    videoUrl,
                };
            }
        }
        catch {
            // Try the next game.
        }
    }
    return null;
}
export function buildGamersSteamCaption(post) {
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
export function buildGamersSteamVideoCaption(video) {
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
export function gamersSteamHistoryKey(post) {
    return screenshotHistoryKey(post.appId);
}
