import axios from 'axios';
import nodemailer from 'nodemailer';
import admin from 'firebase-admin';
import { config } from '../../config';
import { firestore } from '../../lib/firebase';
const notificationsCollection = firestore.collection('notifications');
const leadsCollection = firestore.collection('leads');
export class NotificationService {
    constructor() {
        this.slackWebhook = process.env.SLACK_WEBHOOK_URL;
        this.alertEmail = process.env.SALES_ALERT_EMAIL;
        this.mailer = config.smtp.user
            ? nodemailer.createTransport({
                host: config.smtp.host,
                port: config.smtp.port,
                secure: config.smtp.port === 465,
                auth: { user: config.smtp.user, pass: config.smtp.pass },
            })
            : null;
    }
    async notifyConversion(lead) {
        const message = `[HOT] New Lead from Outbound: ${lead.name ?? 'Prospect'} (${lead.company ?? 'unknown'}) via ${lead.channel ?? 'outbound'}.`;
        await this.persist('lead_converted', message, lead);
        await Promise.all([this.sendSlack(message), this.sendEmail(message)]);
    }
    async notifyBooking(lead, slot) {
        const message = `[CAL] Demo booked for ${lead.name ?? 'prospect'} on ${slot.label}.`;
        await this.persist('demo_booked', message, lead);
        await Promise.all([this.sendSlack(message), this.sendEmail(message)]);
    }
    async enqueueChannelMessage(channel, lead, text, metadata) {
        const recipient = await this.resolveRecipient(channel, lead, metadata);
        if (!recipient) {
            console.warn('Missing recipient for channel message', channel, lead.id);
            return;
        }
        await notificationsCollection.add({
            type: 'channel_message',
            channel,
            leadId: lead.id,
            recipient,
            payload: { text, metadata },
            status: 'pending',
            attempts: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    async resolveRecipient(channel, lead, metadata) {
        const recipient = typeof metadata?.recipient === 'string' ? metadata.recipient : undefined;
        if (recipient)
            return recipient;
        if (lead.recipient)
            return lead.recipient;
        if (channel === 'whatsapp') {
            const phone = typeof metadata?.phone === 'string' ? metadata.phone : undefined;
            return lead.phoneNumber ?? phone ?? (await this.lookupLeadField(lead.id, 'phoneNumber'));
        }
        if (channel === 'instagram') {
            const usernameField = typeof metadata?.username === 'string' ? metadata.username : undefined;
            const username = usernameField ?? extractInstagramHandle(lead.profileUrl ?? (await this.lookupLeadField(lead.id, 'profileUrl')));
            return username ?? null;
        }
        if (channel === 'linkedin') {
            return lead.profileUrl ?? (await this.lookupLeadField(lead.id, 'profileUrl'));
        }
        return lead.email ?? (await this.lookupLeadField(lead.id, 'email'));
    }
    async lookupLeadField(leadId, field) {
        if (!leadId)
            return null;
        const snap = await leadsCollection.doc(leadId).get();
        if (!snap.exists)
            return null;
        const data = snap.data();
        const value = data?.[field];
        return typeof value === 'string' ? value : null;
    }
    async persist(type, message, lead) {
        await notificationsCollection.add({
            type,
            message,
            lead,
            createdAt: new Date().toISOString(),
        });
    }
    async sendSlack(text) {
        if (!this.slackWebhook)
            return;
        try {
            await axios.post(this.slackWebhook, { text });
        }
        catch (error) {
            console.warn('Slack notification failed', error);
        }
    }
    async sendEmail(body) {
        if (!this.mailer || !this.alertEmail)
            return;
        try {
            await this.mailer.sendMail({
                from: config.smtp.from,
                to: this.alertEmail,
                subject: 'Dott Media outbound alert',
                text: body,
            });
        }
        catch (error) {
            console.warn('Alert email failed', error);
        }
    }
}
const extractInstagramHandle = (profileUrl) => {
    if (!profileUrl)
        return null;
    const match = profileUrl.match(/instagram\.com\/([^/?]+)/i);
    return match?.[1] ?? null;
};
