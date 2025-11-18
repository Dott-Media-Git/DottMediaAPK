# Deployment Kit (Milestone 5)

## 1. agentSetup.js
`initLeadAgent` exposes a tiny helper to bootstrap a client project.
```js
import { initLeadAgent } from './agentSetup';

const agent = initLeadAgent({
  apiUrl: 'https://api.your-domain.com',
  widgetSecret: process.env.WIDGET_SHARED_SECRET
});

await agent.configure({ goal: '25 demos/mo', budget: '$3k-$5k' });
await agent.generateOffer('conversation-id-123');
await agent.runFollowUps();
```

## 2. Required Environment
- `WIDGET_SHARED_SECRET` for widget + agentSetup auth
- Meta + LinkedIn tokens (see `.env.example`)
- `GOOGLE_SERVICE_ACCOUNT`, `GOOGLE_CALENDAR_ID` for live bookings
- `CALENDLY_*` if using Calendly

## 3. Client Configuration UI
The mobile **Controls** screen now includes a “Lead Agent Config” card where operators can set goals, budget, and widget secret so onboarding teams can mirror settings in agentSetup.

## 4. Offer Engine
`POST /api/offers` accepts `{ conversationId, price?, title?, deliverables? }` and stores the GPT-generated mini proposal in `/offers`. Link this to your CRM or email workflows via Make.com.

## 5. Push Alerts
When analytics detects new hot leads or pending follow-ups, the React Native app schedules local Expo notifications so teams never miss a touchpoint.
