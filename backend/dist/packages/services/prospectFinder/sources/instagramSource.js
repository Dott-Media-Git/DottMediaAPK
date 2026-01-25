import axios from 'axios';
const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v18.0';
let cachedBusinessId = null;
/**
 * Uses Meta Graph API when available, otherwise falls back to curated mocks.
 */
export async function searchInstagramProspects(params) {
    const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN ?? process.env.IG_ACCESS_TOKEN ?? process.env.META_GRAPH_TOKEN ?? '';
    const businessId = process.env.INSTAGRAM_BUSINESS_ID ??
        process.env.IG_BUSINESS_ACCOUNT_ID ??
        process.env.INSTAGRAM_ACCOUNT_ID ??
        '';
    const resolvedBusinessId = accessToken ? await resolveBusinessId(accessToken, businessId) : null;
    if (accessToken && resolvedBusinessId) {
        try {
            const response = await queryInstagramApi(params, { accessToken, businessId: resolvedBusinessId });
            if (response.length)
                return response;
        }
        catch (error) {
            console.warn('Instagram API lookup failed, using mock list', error);
        }
    }
    return mockInstagramProspects(params);
}
async function queryInstagramApi(params, auth) {
    const hashtag = params.hashtag ?? params.industry?.replace(/\s+/g, '') ?? 'automation';
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/ig_hashtag_search?user_id=${auth.businessId}&q=${encodeURIComponent(hashtag)}&access_token=${auth.accessToken}`;
    const response = await axios.get(url);
    const hashtags = response.data?.data ?? [];
    if (!hashtags.length)
        return [];
    const hashtagId = hashtags[0]?.id;
    if (!hashtagId)
        return [];
    const mediaUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${hashtagId}/top_media?user_id=${auth.businessId}&fields=id,caption,permalink,username&access_token=${auth.accessToken}`;
    const mediaResponse = await axios.get(mediaUrl);
    const media = mediaResponse.data?.data ?? [];
    return media.slice(0, params.limit ?? 20).map(item => ({
        id: `ig-${item.id}`,
        name: item['username'] ?? 'Instagram Prospect',
        company: item['caption']?.toString().split('|')[0]?.trim(),
        industry: params.industry,
        profileUrl: item['username'] ? `https://instagram.com/${item['username']}` : item['permalink'],
        latestMediaId: item['id'],
        channel: 'instagram',
    }));
}
async function resolveBusinessId(accessToken, fallback) {
    if (cachedBusinessId)
        return cachedBusinessId;
    if (fallback) {
        cachedBusinessId = fallback;
        return fallback;
    }
    try {
        const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`, {
            params: {
                fields: 'instagram_business_account{id,username}',
                access_token: accessToken,
            },
        });
        const pages = response.data?.data ?? [];
        const igAccount = pages.map(page => page.instagram_business_account).find(Boolean);
        if (igAccount?.id) {
            cachedBusinessId = igAccount.id;
            return cachedBusinessId;
        }
    }
    catch (error) {
        console.warn('Failed to resolve Instagram business account id', error);
    }
    return null;
}
function mockInstagramProspects(params) {
    const industry = params.industry ?? 'automation';
    return [
        {
            id: `mock-ig-${industry}-1`,
            name: 'Makena Creative',
            company: 'Makena Luxury Homes',
            position: 'Founder',
            industry,
            profileUrl: 'https://instagram.com/makena.lux',
            location: params.country ?? 'Kenya',
            channel: 'instagram',
        },
        {
            id: `mock-ig-${industry}-2`,
            name: 'Nomsa Studio',
            company: 'Nomsa Digital',
            position: 'Director',
            industry,
            profileUrl: 'https://instagram.com/nomsa.digital',
            location: 'South Africa',
            channel: 'instagram',
        },
    ];
}
