import axios from 'axios';
import nodemailer from 'nodemailer';
import admin from 'firebase-admin';
import { config } from '../../config';
import { firestore } from '../../db/firestore';

const notificationsCollection = firestore.collection('notifications');
const leadsCollection = firestore.collection('leads');

export type LeadDescriptor = {
  id: string;
  name?: string;
  company?: string;
  email?: string;
  channel?: string;
  phoneNumber?: string;
  profileUrl?: string;
  recipient?: string;
};

export class NotificationService {
  private slackWebhook = process.env.SLACK_WEBHOOK_URL;
  private alertEmail = process.env.SALES_ALERT_EMAIL;
  private mailer = config.smtp.user
    ? nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.port === 465,
        auth: { user: config.smtp.user, pass: config.smtp.pass },
      })
    : null;

  async notifyConversion(lead: LeadDescriptor) {
    const message = `[HOT] New Lead from Outbound: ${lead.name ?? 'Prospect'} (${lead.company ?? 'unknown'}) via ${
      lead.channel ?? 'outbound'
    }.`;
    await this.persist('lead_converted', message, lead);
    await Promise.all([this.sendSlack(message), this.sendEmail(message)]);
  }

  async notifyBooking(lead: LeadDescriptor, slot: { label: string }) {
    const message = `[CAL] Demo booked for ${lead.name ?? 'prospect'} on ${slot.label}.`;
    await this.persist('demo_booked', message, lead);
    await Promise.all([this.sendSlack(message), this.sendEmail(message)]);
  }

  async enqueueChannelMessage(channel: string, lead: LeadDescriptor, text: string, metadata?: Record<string, unknown>) {
    const recipient = await this.resolveRecipient(channel, lead, metadata);
    if (!recipient) {
      console.warn('Missing recipient for channel message', channel, lead.id);
      return;
    }
    const payload: Record<string, unknown> = { text };
    if (metadata !== undefined) {
      payload.metadata = metadata;
    }
    await notificationsCollection.add({
      type: 'channel_message',
      channel,
      leadId: lead.id,
      recipient,
      payload,
      status: 'pending',
      attempts: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  private async resolveRecipient(channel: string, lead: LeadDescriptor, metadata?: Record<string, unknown>) {
    const recipient = typeof metadata?.recipient === 'string' ? metadata.recipient : undefined;
    if (recipient) return recipient;
    if (lead.recipient) return lead.recipient;
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

  private async lookupLeadField(leadId: string, field: string): Promise<string | null> {
    if (!leadId) return null;
    const snap = await leadsCollection.doc(leadId).get();
    if (!snap.exists) return null;
    const data = snap.data() as LeadDescriptor | undefined;
    const value = (data as Record<string, unknown> | undefined)?.[field];
    return typeof value === 'string' ? value : null;
  }

  private async persist(type: string, message: string, lead: LeadDescriptor) {
    const sanitizedLead = Object.fromEntries(Object.entries(lead).filter(([, value]) => value !== undefined));
    await notificationsCollection.add({
      type,
      message,
      lead: sanitizedLead,
      createdAt: new Date().toISOString(),
    });
  }

  private async sendSlack(text: string) {
    if (!this.slackWebhook) return;
    try {
      await axios.post(this.slackWebhook, { text });
    } catch (error) {
      console.warn('Slack notification failed', error);
    }
  }

  private async sendEmail(body: string) {
    if (!this.mailer || !this.alertEmail) return;
    try {
      await this.mailer.sendMail({
        from: config.smtp.from,
        to: this.alertEmail,
        subject: 'Dott Media outbound alert',
        text: body,
      });
    } catch (error) {
      console.warn('Alert email failed', error);
    }
  }
}

const extractInstagramHandle = (profileUrl?: string | null) => {
  if (!profileUrl) return null;
  const match = profileUrl.match(/instagram\.com\/([^/?]+)/i);
  return match?.[1] ?? null;
};
