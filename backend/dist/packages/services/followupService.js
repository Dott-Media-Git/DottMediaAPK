import admin from 'firebase-admin';
import OpenAI from 'openai';
import { firestore } from '../../lib/firebase';
import { incrementFollowupAnalytics } from '../../services/analyticsService';
import { OutboundMessenger } from '../../services/outboundMessenger';
const leadsCollection = firestore.collection('leads');
const followupsCollection = firestore.collection('followups');
export class FollowupService {
    constructor() {
        this.messenger = new OutboundMessenger();
        this.aiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    async runDailyFollowups() {
        const staleLeads = await this.fetchStaleLeads();
        let sent = 0;
        for (const lead of staleLeads) {
            if (!lead.recipient || !lead.channel)
                continue;
            const message = await this.composeFollowup(lead);
            await this.messenger.send(lead.channel, lead.recipient, message);
            await this.logFollowup(lead, message);
            await leadsCollection.doc(lead.id).set({ lastActive: admin.firestore.FieldValue.serverTimestamp(), followupCount: admin.firestore.FieldValue.increment(1) }, { merge: true });
            sent += 1;
        }
        await incrementFollowupAnalytics({ sent });
        return { processed: staleLeads.length, sent };
    }
    async fetchStaleLeads() {
        const sevenDaysAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const snap = await leadsCollection
            .where('stage', 'in', ['Qualified', 'DemoOffered'])
            .where('lastActive', '<=', sevenDaysAgo)
            .limit(50)
            .get();
        return snap.docs.map(doc => {
            const data = doc.data();
            return { ...data, id: doc.id };
        });
    }
    async composeFollowup(lead) {
        const prompt = `
You are Dotti, following up with ${lead.name ?? 'a lead'} from ${lead.company ?? 'their team'} about AI automation.
Ask politely if they'd still like to explore Dott Media's automation, keep it under 2 sentences, light emoji allowed.
`;
        try {
            const completion = await this.aiClient.chat.completions.create({
                model: 'gpt-4o-mini',
                temperature: 0.6,
                messages: [
                    { role: 'system', content: 'You are a considerate follow-up bot for Dott Media.' },
                    { role: 'user', content: prompt },
                ],
            });
            return completion.choices?.[0]?.message?.content?.trim() ?? this.defaultFollowup(lead.name);
        }
        catch (error) {
            console.error('Follow-up generation failed', error);
            return this.defaultFollowup(lead.name);
        }
    }
    defaultFollowup(name) {
        return `Hey ${name ?? 'there'}, just checking in if you'd still like to see how Dott Media's AI automations can boost your team.`;
    }
    async logFollowup(lead, text) {
        await followupsCollection.add({
            leadId: lead.id,
            channel: lead.channel,
            text,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
}
