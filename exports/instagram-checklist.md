# Instagram Connection Onboarding — Dott Media

**Overview:** Connect an Instagram Business/Creator account for publishing, analytics, and DMs.

**Estimated time:** 20-40 minutes

## Account prerequisites
- Instagram account is Business or Creator.
- Instagram is linked to a Facebook Page.
- Client has admin or full control of the Page in Meta Business Manager.
- Dott Media user account is active and verified.

## Technical prerequisites
- Meta Developer app with Instagram Graph API enabled.
- App status is Live and Advanced Access granted for required permissions.
- Webhook verify token configured for Instagram events.

## Required permissions
- instagram_basic — Access profile and media basics
- pages_show_list — List Facebook Pages linked to the IG account
- instagram_content_publish — Publish posts and reels
- pages_read_engagement — Read Page engagement for analytics
- instagram_manage_comments — Reply to comments and moderate engagement
- instagram_manage_messages — Send and reply to Instagram DMs
- instagram_manage_insights — Access Instagram insights
- pages_manage_metadata — Subscribe the Page to Instagram webhooks

## Data stored
- Instagram access token
- Instagram Business Account ID
- Optional username for display

## Verification checklist
- Instagram status shows Connected in Integrations screen
- Test post succeeds (media/publish)
- DM and comment replies work
- Insights appear in analytics
