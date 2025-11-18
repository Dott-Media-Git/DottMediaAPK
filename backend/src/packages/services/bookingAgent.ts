import { google } from 'googleapis';
import admin from 'firebase-admin';
import { firestore } from '../../lib/firebase';
import { config } from '../../config';
import { Prospect } from './prospectFinder';
import { incrementMetric } from '../../services/analyticsService';
import { NotificationService, LeadDescriptor } from './notificationService';
import { OutboundCrmSyncService } from './crmSyncService';

const bookingsCollection = firestore.collection('bookings');
const leadsCollection = firestore.collection('leads');
const bookingOffersCollection = firestore.collection('bookingOffers');

export type Slot = {
  start: string;
  end: string;
  label: string;
};

export type BookingContext = {
  lead: LeadDescriptor & {
    channel: Prospect['channel'];
  };
  metadata?: Record<string, unknown>;
};

export class BookingAgent {
  private notification = new NotificationService();
  private crmSync = new OutboundCrmSyncService();

  async autoPropose(lead: BookingContext['lead'], channel: Prospect['channel'], metadata?: Record<string, unknown>) {
    try {
      const slots = await this.proposeSlots();
      if (!slots.length) {
        console.warn('No slots available for demo proposal');
        return;
      }
      const slotsWithTokens = slots.map((slot, index) => ({ ...slot, token: `${index + 1}` }));
      const offerId = await this.recordOffer(lead, channel, slotsWithTokens);
      const message = this.buildProposal(slotsWithTokens);
      await this.notification.enqueueChannelMessage(channel, lead, message, {
        ...metadata,
        bookingOfferId: offerId,
      });
    } catch (error) {
      console.error('Failed to auto propose slots', error);
    }
  }

  async proposeSlots(daysAhead = 5): Promise<Slot[]> {
    const timezone = config.calendar.timezone ?? 'UTC';
    const slots: Slot[] = [];
    const start = new Date();
    for (let day = 1; day <= Math.max(2, daysAhead); day += 1) {
      const base = new Date(start);
      base.setDate(base.getDate() + day);
      ['10:00', '15:00'].forEach(time => {
        const iso = base.toISOString().split('T')[0];
        const startTime = `${iso}T${time}:00Z`;
        const endTime = `${iso}T${time === '10:00' ? '10:45' : '15:45'}:00Z`;
        slots.push({
          start: startTime,
          end: endTime,
          label: `${iso} ${time} (${timezone})`,
        });
      });
    }
    return slots.slice(0, 4);
  }

  async confirmSlot(slot: Slot, context: BookingContext) {
    const event = await this.bookCalendar(slot, context.lead);
    const bookingRef = bookingsCollection.doc();
    await bookingRef.set({
      leadId: context.lead.id,
      slot,
      eventId: event?.id ?? null,
      status: 'confirmed',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await incrementMetric('demos_booked', 1, { industry: undefined });
    await leadsCollection.doc(context.lead.id).set(
      {
        stage: 'DemoBooked',
        demoSlot: slot,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await this.crmSync.mirrorLead({
      id: context.lead.id,
      name: context.lead.name,
      email: context.lead.email,
      channel: context.lead.channel,
      stage: 'DemoBooked',
    });
    await this.notification.notifyBooking(context.lead, slot);
  }

  async handleReply(lead: BookingContext['lead'], reply: string) {
    const offerSnap = await bookingOffersCollection
      .where('leadId', '==', lead.id)
      .where('status', '==', 'pending')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    if (offerSnap.empty) return false;
    const doc = offerSnap.docs[0];
    const offer = doc.data() as { slots: Array<Slot & { token: string }>; channel: Prospect['channel'] };
    const selection = matchSlotChoice(offer.slots, reply);
    if (!selection) return false;

    await doc.ref.update({
      status: 'confirming',
      selectedToken: selection.token,
      lastReply: reply,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await this.confirmSlot(selection, { lead, metadata: { bookingOfferId: doc.id } });

    await doc.ref.update({
      status: 'confirmed',
      confirmedSlot: selection,
      confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  }

  private async bookCalendar(slot: Slot, lead: BookingContext['lead']) {
    if (!config.calendar.google.calendarId || !config.calendar.google.serviceAccount) {
      console.warn('Google Calendar is not configured; skipping booking.');
      return null;
    }
    const credentials = JSON.parse(config.calendar.google.serviceAccount);
    const client = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key?.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });
    const calendar = google.calendar({ version: 'v3', auth: client });
    const response = await calendar.events.insert({
      calendarId: config.calendar.google.calendarId,
      requestBody: {
        summary: 'Dott Media Demo',
        description: `Outbound lead demo for ${lead.name ?? 'prospect'} via ${lead.channel}.`,
        start: { dateTime: slot.start },
        end: { dateTime: slot.end },
        attendees: lead.email
          ? [
              {
                email: lead.email,
                displayName: lead.name,
              },
            ]
          : undefined,
      },
    });
    return response.data;
  }

  private async recordOffer(lead: LeadDescriptor, channel: Prospect['channel'], slots: Array<Slot & { token: string }>) {
    const ref = bookingOffersCollection.doc();
    await ref.set({
      leadId: lead.id,
      channel,
      slots,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return ref.id;
  }

  private buildProposal(slots: Array<Slot & { token: string }>) {
    if (slots.length === 1) {
      const slot = slots[0];
      return `Amazing! I can show you a quick AI automation demo. Would ${slot.label} work for you? Reply with ${slot.token} to confirm.`;
    }
    const [first, second] = slots;
    return `Amazing! I can show you a quick AI automation demo. Would you prefer option ${first.token} (${first.label}) or option ${second.token} (${second.label})? Reply with ${first.token} or ${second.token}.`;
  }
}

function matchSlotChoice(slots: Array<Slot & { token: string }>, reply: string) {
  const normalized = reply.toLowerCase();
  const numericMatch = normalized.match(/\b([1-9])\b/);
  if (numericMatch) {
    const slot = slots.find(item => item.token === numericMatch[1]);
    if (slot) return slot;
  }
  return slots.find(slot => normalized.includes(slot.label.toLowerCase().split('(')[0].trim()));
}
