import admin from 'firebase-admin';
import { firestore } from '../../db/firestore';
import { OutboundCrmSyncService, LeadRecord } from './crmSyncService';

const leadsCollection = firestore.collection('leads');

export type ChannelLeadPayload = {
  channel: string;
  channelUserId: string;
  name?: string;
  company?: string;
  email?: string;
  phoneNumber?: string;
  profileUrl?: string;
  industry?: string;
  source?: string;
  lastMessage?: string;
  sentiment?: number;
  stage?: string;
};

export class LeadService {
  private crmSync = new OutboundCrmSyncService();

  async createOrUpdateLeadByChannel(payload: ChannelLeadPayload): Promise<LeadRecord> {
    const docId = payload.channelUserId ? `${payload.channel}_${payload.channelUserId}` : firestore.collection('leads').doc().id;
    const now = Date.now();
    const docRef = leadsCollection.doc(docId);
    const snapshot = await docRef.get();
    const existing = snapshot.exists ? (snapshot.data() as LeadRecord) : undefined;

    const leadRecord: LeadRecord = {
      id: docId,
      name: payload.name ?? existing?.name,
      company: payload.company ?? existing?.company,
      email: payload.email ?? existing?.email,
      phoneNumber: payload.phoneNumber ?? existing?.phoneNumber,
      profileUrl: payload.profileUrl ?? existing?.profileUrl,
      channel: payload.channel,
      stage: payload.stage ?? existing?.stage ?? 'New',
      score: existing?.score,
      tier: existing?.tier,
      interest: payload.industry ?? existing?.interest,
      source: payload.source ?? existing?.source ?? 'inbound',
      recipient: existing?.recipient ?? payload.channelUserId,
      updatedAt: now,
      lastMessage: payload.lastMessage ?? existing?.lastMessage,
      sentiment: payload.sentiment ?? existing?.sentiment,
      lastActive: now,
    } as LeadRecord & { updatedAt: number; lastMessage?: string; sentiment?: number; lastActive: number };

    const sanitized = Object.fromEntries(Object.entries(leadRecord).filter(([, value]) => value !== undefined));
    await docRef.set(
      {
        ...sanitized,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastActive: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await this.crmSync.mirrorLead(leadRecord);
    return leadRecord;
  }
}
