# Follow-Up Sequencer (Milestone 3)

## How it works
1. When a conversation with a **hot** or **warm** lead finishes, `FollowUpService.scheduleForConversation` stores follow-ups for +1, +3, +7 days in `follow_ups`.
2. Each document includes platform, user id, lead tier, and goal.
3. A Make.com cron or serverless job can hit `POST /api/followups/run` to process due follow-ups.
4. For every due task, GPT generates a contextual nudge and sends it via the same channel through `OutboundMessenger`.
5. Deliveries + failures are logged in `follow_up_logs` for analytics/learning metrics.

## Triggering
```bash
curl -X POST https://api.dott.media/api/followups/run -H "Content-Type: application/json" -d '{"limit":20}'
```

## Scheduler API
Use `/api/scheduler/slots` to fetch available demo slots and `/api/scheduler/book` to reserve one (Calendly/Google or mock fallback). Both endpoints record bookings in Firestore for ROI tracking.
