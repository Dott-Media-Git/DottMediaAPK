import axios from 'axios';
import { config } from '../../../../config';
const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v18.0';
/**
 * Sends a Meta Graph API DM using the IG business account message endpoint.
 */
export async function sendInstagramMessage(username, text) {
    if (!username) {
        throw new Error('Instagram username missing for prospect.');
    }
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${config.channels.instagram.businessId}/messages`;
    await axios.post(url, {
        recipient: { username },
        messaging_type: 'UPDATE',
        message: { text },
    }, {
        headers: {
            Authorization: `Bearer ${config.channels.instagram.accessToken}`,
            'Content-Type': 'application/json',
        },
    });
}
