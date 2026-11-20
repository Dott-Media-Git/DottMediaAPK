import axios from 'axios';

type Client = Pick<typeof axios, 'get' | 'post'>;

export async function readFacebookPageSubscription(options: {
  pageId: string; pageToken: string; appId: string; graphVersion: string; client?: Client;
}) {
  const { pageId, pageToken, appId, graphVersion } = options;
  if (!pageId || !pageToken || !appId) throw new Error('Page subscription configuration is incomplete');
  const client = options.client ?? axios;
  const url = `https://graph.facebook.com/${encodeURIComponent(graphVersion)}/${encodeURIComponent(pageId)}/subscribed_apps`;
  const headers = { Authorization: `Bearer ${pageToken}` };
  const existing = await client.get(url, { headers, params: { fields: 'id,subscribed_fields' }, timeout: 15000 });
  const app = (Array.isArray(existing.data?.data) ? existing.data.data : []).find((entry: any) => String(entry.id) === appId);
  const fields: string[] = Array.isArray(app?.subscribed_fields) ? app.subscribed_fields.filter((field: unknown) => typeof field === 'string') : [];
  return { appExists: Boolean(app), fields };
}

/** Subscribe the already-connected Page, preserving any existing app fields. */
export async function ensureFacebookPageSubscription(options: {
  pageId: string; pageToken: string; appId: string; graphVersion: string; messagingGranted: boolean; client?: Client;
}) {
  const { pageId, pageToken, appId, graphVersion, messagingGranted } = options;
  if (!pageId || !pageToken || !appId) throw new Error('Page subscription configuration is incomplete');
  const client = options.client ?? axios;
  const url = `https://graph.facebook.com/${encodeURIComponent(graphVersion)}/${encodeURIComponent(pageId)}/subscribed_apps`;
  const headers = { Authorization: `Bearer ${pageToken}` };
  const { appExists, fields: previous } = await readFacebookPageSubscription(options);
  const desired = Array.from(new Set<string>([...previous, 'feed', ...(messagingGranted ? ['messages'] : [])]));
  if (appExists && desired.every(field => previous.includes(field))) return { fields: desired, changed: false };
  const result = await client.post(url, { subscribed_fields: desired }, { headers, timeout: 15000 });
  if (result.data?.success !== true) throw new Error('Meta did not confirm the Page subscription');
  return { fields: desired, changed: true };
}
