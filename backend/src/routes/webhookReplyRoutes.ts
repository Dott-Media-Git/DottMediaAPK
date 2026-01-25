import { Router } from 'express';
import type { firestore as FirestoreNS } from 'firebase-admin';
import { firestore } from '../db/firestore';
import { classifyReply } from '../packages/brain/nlu/replyClassifier';
import { ConversionService } from '../packages/services/conversionService';
import { incrementMetric } from '../services/analyticsService';
import { Prospect } from '../packages/services/prospectFinder';

type ProspectChannel = Prospect['channel'] | 'web';

type NormalizedReply = {
  channel: ProspectChannel;
  text: string;
  prospectId?: string;
  email?: string;
  phone?: string;
  profileUrl?: string;
  username?: string;
  metadata?: Record<string, unknown>;
};

const conversionService = new ConversionService();
const prospectsCollection = firestore.collection('prospects');

const router = Router();

router.post('/webhook/reply/:channel', async (req, res, next) => {
  try {
    const channelParam = (req.params.channel?.toLowerCase() ?? '') as ProspectChannel;
    const channel = isSupportedChannel(channelParam) ? channelParam : 'web';
    const normalized = normalizePayload(channel, req.body);
    if (!normalized.text) {
      return res.status(400).json({ message: 'Missing reply text' });
    }

    const prospect = await findProspect(normalized);
    if (!prospect) {
      return res.status(404).json({ message: 'Prospect not found' });
    }

    const classification = await classifyReply(normalized.text);
    await incrementMetric('outbound_reply', 1, { industry: prospect.industry });
    if (classification.intent === 'INTERESTED' || classification.intent === 'BOOK_DEMO' || classification.sentiment > 0.2) {
      await incrementMetric('outbound_positive_reply', 1, { industry: prospect.industry });
    }

    const result = await conversionService.handleReplyWithClassification(
      {
        prospectId: prospect.id,
        channel: channel as Prospect['channel'],
        text: normalized.text,
        metadata: normalized.metadata,
      },
      classification,
    );

    res.json({ ok: true, prospectId: prospect.id, result });
  } catch (error) {
    next(error);
  }
});

export default router;

function normalizePayload(channel: ProspectChannel, body: any): NormalizedReply {
  if (channel === 'whatsapp') {
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];
    const contact = change?.value?.contacts?.[0];
    return {
      channel,
      text: message?.text?.body ?? '',
      phone: message?.from,
      prospectId: body?.prospectId,
      metadata: { messageId: message?.id, contact },
    };
  }

  if (channel === 'instagram') {
    return {
      channel,
      text: body?.text ?? body?.message ?? '',
      username: body?.username ?? body?.from,
      prospectId: body?.prospectId,
      metadata: body,
    };
  }

  if (channel === 'linkedin') {
    return {
      channel,
      text: body?.text ?? body?.message ?? '',
      profileUrl: body?.profileUrl ?? body?.user?.profileUrl,
      email: body?.email,
      prospectId: body?.prospectId,
      metadata: body,
    };
  }

  return {
    channel,
    text: body?.text ?? body?.message ?? '',
    email: body?.email,
    prospectId: body?.prospectId,
    metadata: body,
  };
}

function isSupportedChannel(channel: string): channel is ProspectChannel {
  return ['linkedin', 'instagram', 'whatsapp', 'web', 'csv'].includes(channel);
}

async function findProspect(input: NormalizedReply): Promise<Prospect & { id: string } | null> {
  if (input.prospectId) {
    const snap = await prospectsCollection.doc(input.prospectId).get();
    if (snap.exists) return materialize(snap);
  }

  if (input.email) {
    const snap = await prospectsCollection.where('email', '==', input.email.toLowerCase()).limit(1).get();
    if (!snap.empty) return materializeSnap(snap.docs[0]);
  }

  if (input.profileUrl) {
    const snap = await prospectsCollection.where('profileUrl', '==', input.profileUrl).limit(1).get();
    if (!snap.empty) return materializeSnap(snap.docs[0]);
  }

  if (input.phone) {
    const snap = await prospectsCollection.where('phone', '==', input.phone).limit(1).get();
    if (!snap.empty) return materializeSnap(snap.docs[0]);
  }

  if (input.username && input.channel === 'instagram') {
    const snap = await prospectsCollection.where('channel', '==', 'instagram').limit(50).get();
    const match = snap.docs.map(materializeSnap).find(prospect => prospect.profileUrl?.includes(input.username ?? ''));
    if (match) return match;
  }

  return null;
}

type DocumentSnapshot = FirestoreNS.DocumentSnapshot;
type QueryDocumentSnapshot = FirestoreNS.QueryDocumentSnapshot;

function materialize(doc: DocumentSnapshot): (Prospect & { id: string }) | null {
  const data = doc.data() as Prospect | undefined;
  if (!data) return null;
  return { ...data, id: doc.id };
}

function materializeSnap(doc: QueryDocumentSnapshot): Prospect & { id: string } {
  const data = doc.data() as Prospect;
  return { ...data, id: doc.id };
}
