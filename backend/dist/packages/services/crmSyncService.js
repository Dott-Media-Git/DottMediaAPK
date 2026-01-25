import admin from 'firebase-admin';
import { firestore } from '../../db/firestore.js';
const leadsCollection = firestore.collection('leads');
const pipelineDoc = firestore.collection('analytics').doc('pipeline');
export class OutboundCrmSyncService {
    async mirrorLead(lead) {
        const sanitized = Object.fromEntries(Object.entries(lead).filter(([, value]) => value !== undefined));
        await leadsCollection.doc(lead.id).set({
            ...sanitized,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        await this.updatePipelineCounts();
    }
    async updatePipelineCounts() {
        const snapshot = await leadsCollection.get();
        const totals = {};
        snapshot.forEach(doc => {
            const stage = doc.data().stage ?? 'New';
            totals[stage] = (totals[stage] ?? 0) + 1;
        });
        await pipelineDoc.set({
            stages: totals,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    }
}
