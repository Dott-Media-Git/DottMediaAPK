import axios from 'axios';
import { config } from '../../../../config';
const WHATSAPP_GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION ?? 'v18.0';
/**
 * Sends a WhatsApp Cloud API text message using the configured Business account.
 */
export async function sendWhatsAppMessage(phoneNumber, text) {
    if (!phoneNumber) {
        throw new Error('WhatsApp phone number missing for prospect.');
    }
    const url = `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${config.whatsapp.phoneNumberId}/messages`;
    await axios.post(url, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phoneNumber,
        type: 'text',
        text: { body: text, preview_url: false },
    }, {
        headers: {
            Authorization: `Bearer ${config.whatsapp.token}`,
            'Content-Type': 'application/json',
        },
    });
}
