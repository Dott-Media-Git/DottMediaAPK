import { firestore } from '../lib/firebase';
import { config } from '../config';
import { withRetry } from '../utils/retry';
import { google } from 'googleapis';

type Slot = {
  start: string;
  end: string;
  channel: 'calendly' | 'google' | 'mock';
  display: string;
};

type SlotRequest = {
  startDate?: string;
  days?: number;
  timezone?: string;
};

type BookingRequest = {
  slot: Slot;
  attendee: {
    name: string;
    email: string;
    platform: string;
    conversationId?: string;
  };
};

const bookingsCollection = firestore.collection('scheduler_bookings');

const addDays = (date: Date, days: number) => {
  const clone = new Date(date);
  clone.setDate(clone.getDate() + days);
  return clone;
};

export class SchedulerService {
  async getAvailableSlots(request: SlotRequest = {}): Promise<Slot[]> {
    const timezone = request.timezone ?? config.calendar.timezone ?? 'UTC';
    const startDate = request.startDate ? new Date(request.startDate) : new Date();
    const days = request.days ?? 5;
    const slots: Slot[] = [];

    for (let i = 0; i < days; i += 1) {
      const base = addDays(startDate, i);
      const isoDate = base.toISOString().split('T')[0];
      ['10:00', '14:00'].forEach(time => {
        const start = `${isoDate}T${time}:00${this.offsetForTimezone(timezone)}`;
        const end = `${isoDate}T${time === '10:00' ? '10:45' : '14:45'}:00${this.offsetForTimezone(timezone)}`;
        slots.push({
          start,
          end,
          channel: config.calendar.calendly.apiKey ? 'calendly' : config.calendar.google.calendarId ? 'google' : 'mock',
          display: `${isoDate} ${time} (${timezone})`,
        });
      });
    }

    return slots;
  }

  async bookSlot(request: BookingRequest) {
    const slot = request.slot;
    const attendee = request.attendee;
    const booking = {
      slot,
      attendee,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    const bookingRef = bookingsCollection.doc();
    await bookingRef.set(booking);

    try {
      if (config.calendar.calendly.apiKey) {
        await this.bookCalendly(slot, attendee);
      } else if (config.calendar.google.calendarId && config.calendar.google.serviceAccount) {
        await this.bookGoogle(slot, attendee);
      }
      await bookingRef.update({
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
      });
    } catch (error) {
      await bookingRef.update({
        status: 'failed',
        error: (error as Error).message,
      });
      throw error;
    }

    return { id: bookingRef.id, ...booking, status: 'confirmed' };
  }

  private async bookCalendly(_slot: Slot, _attendee: BookingRequest['attendee']) {
    if (!config.calendar.calendly.apiKey || !config.calendar.calendly.schedulingLink) {
      return;
    }
    await withRetry(async () => Promise.resolve());
  }

  private async bookGoogle(slot: Slot, attendee: BookingRequest['attendee']) {
    if (!config.calendar.google.calendarId || !config.calendar.google.serviceAccount) return;
    const credentials = this.parseServiceAccount(config.calendar.google.serviceAccount);
    const client = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key?.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });
    const calendar = google.calendar({ version: 'v3', auth: client });

    await withRetry(async () => {
      await calendar.events.insert({
        calendarId: config.calendar.google.calendarId!,
        requestBody: {
          summary: 'Dott Media AI Demo',
          description: `Auto-booked for ${attendee.name} (${attendee.platform}).`,
          start: { dateTime: slot.start },
          end: { dateTime: slot.end },
          attendees: [{ email: attendee.email, displayName: attendee.name }],
        },
      });
    });
  }

  private offsetForTimezone(timezone: string) {
    if (timezone.toLowerCase().includes('gmt') || timezone.toLowerCase() === 'utc') return 'Z';
    return 'Z';
  }

  private parseServiceAccount(raw: string) {
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT JSON');
    }
  }
}
