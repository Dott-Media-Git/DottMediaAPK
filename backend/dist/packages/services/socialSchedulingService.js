import admin from 'firebase-admin';
import { firestore } from '../../lib/firebase';
const scheduledPostsCollection = firestore.collection('scheduledPosts');
const socialLimitsCollection = firestore.collection('socialLimits');
export class SocialSchedulingService {
    async schedulePosts(payload) {
        if (!payload.platforms.length)
            throw new Error('At least one platform is required');
        const timesPerDay = Math.min(Math.max(payload.timesPerDay, 1), 5);
        const scheduledDate = new Date(payload.scheduledFor);
        if (Number.isNaN(scheduledDate.getTime()))
            throw new Error('Invalid scheduledFor date');
        const targetDate = scheduledDate.toISOString().slice(0, 10);
        const existingSnap = await scheduledPostsCollection
            .where('userId', '==', payload.userId)
            .where('targetDate', '==', targetDate)
            .get();
        const existingCount = existingSnap.size;
        const limitDoc = await socialLimitsCollection.doc(`${payload.userId}_${targetDate}`).get();
        const postedCount = limitDoc.data()?.postedCount ?? 0;
        const maxPerDay = 5;
        if (existingCount >= maxPerDay) {
            return { scheduled: [], trimmed: true, reason: 'limit_reached' };
        }
        const requestedTotal = payload.platforms.length * timesPerDay;
        const remaining = Math.max(0, maxPerDay - existingCount - postedCount);
        const totalToSchedule = Math.min(requestedTotal, remaining);
        if (totalToSchedule <= 0) {
            return { scheduled: [], trimmed: true, reason: 'limit_reached', remaining };
        }
        const slotCount = Math.max(1, Math.ceil(totalToSchedule / payload.platforms.length));
        const timeSlots = buildTimeSlots(scheduledDate, slotCount);
        const docsToCreate = [];
        outer: for (const slot of timeSlots) {
            for (const platform of payload.platforms) {
                if (docsToCreate.length >= totalToSchedule)
                    break outer;
                docsToCreate.push({ id: scheduledPostsCollection.doc().id, platform, scheduledFor: slot });
            }
        }
        const batch = firestore.batch();
        docsToCreate.forEach(doc => {
            batch.set(scheduledPostsCollection.doc(doc.id), {
                userId: payload.userId,
                platform: doc.platform,
                imageUrls: payload.images ?? [],
                caption: payload.caption,
                hashtags: payload.hashtags ?? '',
                scheduledFor: admin.firestore.Timestamp.fromDate(doc.scheduledFor),
                targetDate,
                status: 'pending',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                postedAt: null,
                errorMessage: null,
            });
        });
        batch.set(socialLimitsCollection.doc(`${payload.userId}_${targetDate}`), {
            userId: payload.userId,
            date: targetDate,
            scheduledCount: admin.firestore.FieldValue.increment(docsToCreate.length),
        }, { merge: true });
        await batch.commit();
        return { scheduled: docsToCreate.length, trimmed: docsToCreate.length < requestedTotal, remaining: remaining - docsToCreate.length };
    }
}
export const socialSchedulingService = new SocialSchedulingService();
function buildTimeSlots(base, count) {
    const slots = [];
    const start = new Date(base);
    const dayEnd = new Date(base);
    dayEnd.setHours(23, 59, 0, 0);
    if (count === 1) {
        slots.push(start);
        return slots;
    }
    const availableMinutes = Math.max(60, Math.floor((dayEnd.getTime() - start.getTime()) / 60000) - 30 /* buffer */);
    const interval = Math.max(60, Math.floor(availableMinutes / (count - 1)));
    for (let i = 0; i < count; i += 1) {
        const slot = new Date(start.getTime() + i * interval * 60000);
        if (slot > dayEnd) {
            slots.push(new Date(dayEnd));
            break;
        }
        slots.push(slot);
    }
    return slots;
}
