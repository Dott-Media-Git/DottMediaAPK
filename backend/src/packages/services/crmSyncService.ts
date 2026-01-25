import admin from 'firebase-admin';
import { firestore } from '../../db/firestore';

const leadsCollection = firestore.collection('leads');
const pipelineDoc = firestore.collection('analytics').doc('pipeline');

export type LeadRecord = {
  id: string;
  name?: string;
  company?: string;
  email?: string;
  phoneNumber?: string;
  profileUrl?: string;
  recipient?: string;
  channel?: string;
  stage?: string;
  score?: number;
  tier?: string;
  interest?: string;
  source?: string;
  lastMessage?: string;
  sentiment?: number;
  lastActive?: number;
};

export class OutboundCrmSyncService {
  async mirrorLead(lead: LeadRecord) {
    const sanitized = Object.fromEntries(Object.entries(lead).filter(([, value]) => value !== undefined));
    await leadsCollection.doc(lead.id).set(
      {
        ...sanitized,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await this.updatePipelineCounts();
  }

  async updatePipelineCounts() {
    const snapshot = await leadsCollection.get();
    const totals: Record<string, number> = {};
    snapshot.forEach(doc => {
      const stage = (doc.data().stage as string) ?? 'New';
      totals[stage] = (totals[stage] ?? 0) + 1;
    });

    await pipelineDoc.set(
      {
        stages: totals,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
}
