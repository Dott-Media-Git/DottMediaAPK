import { PredictiveOutreachService } from '../services/predictiveOutreachService';
import { firestore } from '../db/firestore';
const outreach = new PredictiveOutreachService();
export class OutreachController {
    constructor() {
        this.search = async (req, res, next) => {
            try {
                const { platform, query, limit } = req.body;
                if (!platform || !query) {
                    return res.status(400).json({ message: 'platform and query are required' });
                }
                const prospects = await outreach.findProspects({ platform, query, limit });
                res.json({ prospects });
            }
            catch (error) {
                next(error);
            }
        };
        this.send = async (req, res, next) => {
            try {
                const { platform, profileId, name, headline, goal } = req.body;
                if (!platform || !profileId || !name) {
                    return res.status(400).json({ message: 'platform, profileId, and name are required' });
                }
                const result = await outreach.sendOutreach({ platform, profileId, name, headline, goal });
                res.status(202).json({ outreach: result });
            }
            catch (error) {
                next(error);
            }
        };
        this.stats = async (req, res, next) => {
            try {
                const [queueSnap, convertedSnap, outreachSnap] = await Promise.all([
                    firestore.collection('prospects').where('status', '==', 'new').get(),
                    firestore.collection('prospects').where('status', '==', 'converted').get(),
                    firestore.collection('outreach').get(),
                ]);
                const sent = outreachSnap.docs.filter(doc => doc.data().status === 'sent').length;
                const replies = outreachSnap.docs.filter(doc => doc.data().status === 'reply').length;
                res.json({
                    sent,
                    replies,
                    conversions: convertedSnap.size,
                    queue: queueSnap.size,
                });
            }
            catch (error) {
                next(error);
            }
        };
        this.run = async (req, res, next) => {
            try {
                const token = process.env.OUTBOUND_RUN_TOKEN;
                const body = req.body;
                if (token) {
                    const provided = req.header('x-outbound-token') ??
                        req.query.token ??
                        body?.token;
                    if (provided !== token) {
                        return res.status(403).json({ message: 'Forbidden' });
                    }
                }
                if (body?.includeDiscovery) {
                    const { resolveDiscoveryLimit, resolveOutboundDiscoveryTarget } = await import('../services/outboundTargetingService');
                    const { runProspectDiscovery } = await import('../packages/services/prospectFinder');
                    const { outreachAgent } = await import('../packages/services/outreachAgent');
                    const target = await resolveOutboundDiscoveryTarget();
                    const limit = resolveDiscoveryLimit();
                    const prospects = await runProspectDiscovery({ industry: target.industry, country: target.country, limit });
                    const outreach = await outreachAgent.runDailyOutreach(prospects);
                    return res.json({ target, discovered: prospects.length, outreach });
                }
                // Trigger the agent
                // import { outreachAgent } from '../packages/services/outreachAgent';
                // const result = await outreachAgent.runDailyOutreach();
                // For now, we'll simulate a run or call the service if we can import it dynamically to avoid circular deps if any
                const { outreachAgent } = await import('../packages/services/outreachAgent');
                const result = await outreachAgent.runDailyOutreach();
                res.json(result);
            }
            catch (error) {
                next(error);
            }
        };
        this.logs = async (req, res, next) => {
            try {
                const snap = await firestore.collection('outreach').orderBy('sentAt', 'desc').limit(25).get();
                const logs = snap.docs.map(doc => {
                    const data = doc.data();
                    const rawTime = data.sentAt ?? data.createdAt;
                    const timestamp = normalizeTimestamp(rawTime)?.toISOString() ?? new Date().toISOString();
                    const message = typeof data.text === 'string' ? data.text.slice(0, 160) : 'Outreach activity';
                    const type = data.status === 'reply' ? 'reply' : 'sent';
                    return { id: doc.id, message, timestamp, type };
                });
                res.json({ logs });
            }
            catch (error) {
                next(error);
            }
        };
    }
}
const normalizeTimestamp = (value) => {
    if (!value)
        return null;
    if (value instanceof Date)
        return value;
    if (typeof value === 'number')
        return new Date(value);
    if (typeof value === 'string')
        return new Date(value);
    if (typeof value.toDate === 'function') {
        return value.toDate();
    }
    return null;
};
