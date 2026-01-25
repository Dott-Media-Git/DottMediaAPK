# Facebook Page Connection Onboarding — Dott Media

**Overview:** Connect a Facebook Page for publishing, messaging, and analytics.

**Estimated time:** 20-40 minutes

## Account prerequisites
- Facebook Page (not a personal profile).
- Admin or full control of the Page in Meta Business Manager.
- Page has no restrictions and is verified for publishing.
- Two-factor authentication enabled for Page admins (recommended).

## Technical prerequisites
- Meta Developer app with Graph API and Webhooks enabled.
- App status is Live and Advanced Access granted for required permissions.
- Webhook verify token configured.

## Required permissions
- pages_show_list — List Pages owned by the user
- pages_read_engagement — Read Page engagement and insights
- pages_manage_posts — Publish posts to the Page
- pages_manage_engagement — Reply to comments and manage engagement
- pages_manage_metadata — Subscribe the Page to webhooks
- pages_messaging — Send and reply to Page messages

## Data stored
- Facebook Page access token
- Facebook Page ID
- Optional Page name for display

## Verification checklist
- Facebook status shows Connected in Integrations screen
- Test post succeeds
- Comment reply and Page DM reply work
- Engagement metrics appear in analytics
