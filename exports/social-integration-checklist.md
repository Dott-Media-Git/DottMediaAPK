# Social Integration Checklist — Dott Media

This document lists platform-specific requirements and verification steps to connect social media accounts to Dott Media.

## Common requirements

- Active Dott Media user account with permission to add integrations.
- Admin or appropriate role on the social account (page owner, page admin, super/content admin, etc.).
- Developer app / project created for the platform when required.
- OAuth redirect URI / callback URL configured to point to the Dott Media callback.
- Required scopes/permissions granted during OAuth or token creation.
- Tokens/credentials stored (short/long-lived tokens, refresh tokens, access tokens, client secret, access token secret, phone ID, etc.).
- Webhook callback & verify token configured when platform uses webhooks.
- Two-factor authentication recommended/required for some platforms.

---

## Instagram (Business / Creator)

**Account prerequisites:**
- Instagram account must be Business or Creator.
- Linked to a Facebook Page.
- Client must have admin/full control of the Page in Meta Business Manager.

**Technical prerequisites:**
- Meta developer app with Instagram Graph API enabled; app Live and Advanced Access granted.
- Webhook verify token configured.

**Required permissions:**
- instagram_basic, instagram_content_publish, instagram_manage_comments, instagram_manage_messages, instagram_manage_insights, pages_show_list, pages_read_engagement, pages_manage_metadata.

**Data stored:** Instagram access token, Business Account ID, (optional username).

**Verification checklist:** Integration shows Connected; test publish and DMs; analytics available.

---

## Facebook Page

**Account prerequisites:**
- Facebook Page (not a personal profile).
- Admin in Meta Business Manager; Page has publishing rights; 2FA for admins recommended.

**Technical prerequisites:**
- Meta developer app with Graph API & Webhooks enabled; Live and Advanced Access.
- Webhook verify token configured.

**Required permissions:**
- pages_show_list, pages_read_engagement, pages_manage_posts, pages_manage_engagement, pages_manage_metadata, pages_messaging.

**Data stored:** Page access token, Page ID, optional Page name.

**Verification checklist:** Page shows Connected; test post, comments and Page DM replies work; analytics present.

---

## WhatsApp Business

**Account prerequisites:**
- Meta Business Manager with verified business; WhatsApp Business Account and verified phone number.

**Technical prerequisites:**
- Meta app with WhatsApp product enabled; system user with permanent access token.
- Webhook callback URL and verify token configured.

**Required permissions:** whatsapp_business_messaging, whatsapp_business_management.

**Data stored:** WhatsApp access token, phone number ID, webhook verify token.

**Verification checklist:** Webhook verification succeeds; inbound messages received; test outbound message succeeds.

---

## LinkedIn (Organization)

**Account prerequisites:** LinkedIn Company Page; user is Super Admin or Content Admin; Marketing APIs approved.

**Technical prerequisites:** LinkedIn app with Sign In, OAuth redirect URI, Marketing access approved.

**Required permissions:** r_liteprofile, w_organization_social, r_organization_social, rw_organization_admin.

**Data stored:** LinkedIn access token, organization URN.

**Verification checklist:** Connected; test post and analytics.

---

## TikTok

**Account prerequisites:** Creator or Business account; owner approval for API publishing; TikTok Developer app live.

**Technical prerequisites:** TikTok app with Content Posting API; client key/secret; redirect URI.

**Required scopes:** user.info.basic, video.upload, video.publish.

**Data stored:** Access token, refresh token, open ID, scopes, expiry timestamps.

**Verification checklist:** Connected; test video upload; performance metrics present.

---

## X (Twitter)

**Account prerequisites:** X account with posting access; Developer Project + App created.

**Technical prerequisites:** OAuth 1.0a tokens (access token + secret); API key & secret; callback URLs.

**Required credentials:** Access token and access token secret.

**Data stored:** Access token and secret.

**Verification checklist:** Connected; test post; analytics present.

---

## Threads (via Instagram)

Uses Instagram Business account; same prerequisites and permissions as Instagram (instagram_basic, instagram_content_publish, pages_show_list).

**Data stored:** Instagram token and Business Account ID.

**Verification checklist:** Threads posts succeed and metrics appear.

---

## YouTube

**Account prerequisites:** YouTube channel with upload permissions; Google account owner/manager access; consent screen configured.

**Technical prerequisites:** Google Cloud project with YouTube Data API v3 enabled; OAuth client ID/secret; redirect URI.

**Required scope:** https://www.googleapis.com/auth/youtube.upload

**Data stored:** YouTube refresh token (primary), optional access token and channel metadata.

**Verification checklist:** Connected; test upload; channel metadata in reporting.

---

## Quick verification checklist (all platforms)

- Integration shows Connected in Integrations screen.
- Test post/upload or message succeeds.
- Webhooks / inbound messages received when applicable.
- Analytics/engagement metrics appear where expected.


---

Generated by Dott Media internal tooling.
