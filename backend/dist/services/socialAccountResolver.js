import axios from 'axios';
const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v19.0';
export async function resolveFacebookPageId(accessToken, preferredPageId) {
    const token = accessToken?.trim();
    if (!token)
        return null;
    try {
        const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`, {
            params: { fields: 'id,name,access_token', access_token: token },
        });
        const pages = response.data?.data ?? [];
        const desiredId = preferredPageId?.trim();
        const page = desiredId ? pages.find(item => item.id === desiredId) : pages.find(item => Boolean(item.id));
        if (page?.id) {
            return { pageId: page.id, pageName: page.name, pageToken: page.access_token };
        }
    }
    catch (error) {
        console.warn('[social] failed to resolve Facebook page id via /me/accounts', error.message);
    }
    try {
        const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/me`, {
            params: { fields: 'id,name', access_token: token },
        });
        const id = response.data?.id;
        if (id) {
            return { pageId: id, pageName: response.data?.name };
        }
    }
    catch (error) {
        console.warn('[social] failed to resolve Facebook page id via /me', error.message);
    }
    return null;
}
export async function resolveInstagramAccountId(accessToken) {
    const token = accessToken?.trim();
    if (!token)
        return null;
    try {
        const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`, {
            params: {
                fields: 'instagram_business_account{id,username}',
                access_token: token,
            },
        });
        const pages = response.data?.data ?? [];
        const igAccount = pages.map(page => page.instagram_business_account).find(Boolean);
        if (igAccount?.id) {
            return { accountId: igAccount.id, username: igAccount.username };
        }
    }
    catch (error) {
        console.warn('[social] failed to resolve Instagram account id', error.message);
    }
    return null;
}
