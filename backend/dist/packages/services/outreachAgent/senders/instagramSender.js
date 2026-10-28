import axios from 'axios';
import { config } from '../../../../config.js';
import { getInstagramLoginToken, resolveInstagramLoginAccount } from '../../../../services/instagramAccountRegistry.js';
const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v18.0';
const resolveIgUserId = async (username) => {
    try {
        const lookupUrl = `https://graph.facebook.com/${GRAPH_VERSION}/ig_username`;
        const response = await axios.get(lookupUrl, {
            params: { username, fields: 'id', access_token: config.channels.instagram.accessToken },
        });
        return typeof response.data?.id === 'string' ? response.data.id : null;
    }
    catch (error) {
        console.warn('[instagram] failed to resolve username to id', error);
        return null;
    }
};
/**
 * Sends a Meta Graph API DM using the IG business account message endpoint.
 * Prefers recipient.id; will attempt to resolve username to id, otherwise skips to avoid API 400.
 */
export async function sendInstagramMessage(recipient, text, options = {}) {
    if (!recipient) {
        throw new Error('Instagram recipient missing for prospect.');
    }
    const account = resolveInstagramLoginAccount(options);
    const loginToken = account ? getInstagramLoginToken(account) : '';
    if (account && loginToken && /^\d+$/.test(recipient)) {
        await axios.post('https://graph.instagram.com/me/messages', {
            recipient: { id: recipient },
            message: { text },
        }, {
            params: { access_token: loginToken },
            headers: { 'Content-Type': 'application/json' },
        });
        return;
    }
    const businessId = config.channels.instagram.businessId;
    if (!businessId || !config.channels.instagram.accessToken) {
        if (account && loginToken) {
            throw new Error('Instagram Login outbound requires a numeric Instagram recipient ID from an existing conversation.');
        }
        console.info('[instagram] skipping send; channel disabled');
        return;
    }
    let recipientId = null;
    // If the caller passed a numeric/string id, use it; otherwise try lookup by username.
    if (/^\d+$/.test(recipient)) {
        recipientId = recipient;
    }
    else {
        recipientId = await resolveIgUserId(recipient);
    }
    if (!recipientId) {
        console.warn('[instagram] unable to resolve recipient id; skipping DM');
        return;
    }
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${businessId}/messages`;
    await axios.post(url, {
        recipient: { id: recipientId },
        messaging_type: 'UPDATE',
        message: { text },
    }, {
        headers: {
            Authorization: `Bearer ${config.channels.instagram.accessToken}`,
            'Content-Type': 'application/json',
        },
    });
}
export async function likeInstagramMedia(mediaId) {
    if (!mediaId || !config.channels.instagram.accessToken)
        return;
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}/likes`;
    await axios.post(url, null, {
        params: { access_token: config.channels.instagram.accessToken },
    });
}
export async function commentInstagramMedia(mediaId, text) {
    if (!mediaId || !config.channels.instagram.accessToken)
        return;
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}/comments`;
    await axios.post(url, null, {
        params: { access_token: config.channels.instagram.accessToken, message: text },
    });
}
