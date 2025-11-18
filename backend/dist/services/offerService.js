import admin from 'firebase-admin';
import { firestore } from '../lib/firebase';
import { OpenAIService } from './openAIService';
const conversationsCollection = firestore.collection('conversations');
const offersCollection = firestore.collection('offers');
export class OfferService {
    constructor() {
        this.openAI = new OpenAIService();
    }
    async generateOffer(request) {
        const convoSnap = await conversationsCollection.doc(request.conversationId).get();
        if (!convoSnap.exists) {
            throw new Error('Conversation not found');
        }
        const conversation = convoSnap.data();
        const lead = conversation.meta;
        const price = request.price ?? '$499/mo';
        const deliverables = request.deliverables ?? ['AI CRM automations', 'Chat + voice assistant', 'Make.com integration', 'Weekly reporting'];
        const pitch = await this.openAI.generateReply({
            platform: conversation.platform,
            intentCategory: 'Lead Inquiry',
            lead,
            message: `Compose a concise mini proposal for ${lead.company ?? 'this client'} about ${lead.goal ?? 'AI automation'} priced at ${price}. Highlight ${deliverables.join(', ')}.`,
        });
        const docRef = offersCollection.doc();
        const offer = {
            id: docRef.id,
            conversationId: conversation.conversationId,
            platform: conversation.platform,
            lead: {
                name: lead.name,
                company: lead.company,
                email: lead.email,
            },
            title: request.title ?? `AI CRM plan for ${lead.company ?? 'your team'}`,
            price,
            deliverables,
            body: pitch.reply,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        await docRef.set(offer);
        return offer;
    }
}
