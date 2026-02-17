import axios from 'axios';

const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v19.0';

type FacebookPageInfo = {
  pageId: string;
  pageName?: string;
  pageToken?: string;
};

type InstagramAccountInfo = {
  accountId: string;
  username?: string;
};

export async function resolveFacebookPageId(
  accessToken: string,
  preferredPageId?: string,
): Promise<FacebookPageInfo | null> {
  const token = accessToken?.trim();
  if (!token) return null;
  try {
    const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`, {
      params: { fields: 'id,name,access_token', access_token: token },
    });
    const pages = (response.data?.data as Array<{ id?: string; name?: string; access_token?: string }>) ?? [];
    const desiredId = preferredPageId?.trim();
    const page = desiredId ? pages.find(item => item.id === desiredId) : pages.find(item => Boolean(item.id));
    if (page?.id) {
      return { pageId: page.id, pageName: page.name, pageToken: page.access_token };
    }
  } catch (error) {
    console.warn('[social] failed to resolve Facebook page id via /me/accounts', (error as Error).message);
  }

  try {
    const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/me`, {
      params: { fields: 'id,name', access_token: token },
    });
    const id = response.data?.id as string | undefined;
    if (id) {
      return { pageId: id, pageName: response.data?.name as string | undefined };
    }
  } catch (error) {
    console.warn('[social] failed to resolve Facebook page id via /me', (error as Error).message);
  }

  return null;
}

export async function resolveInstagramAccountId(accessToken: string): Promise<InstagramAccountInfo | null> {
  const token = accessToken?.trim();
  if (!token) return null;
  try {
    const response = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`, {
      params: {
        fields: 'instagram_business_account{id,username}',
        access_token: token,
      },
    });
    const pages = (response.data?.data as Array<{ instagram_business_account?: { id?: string; username?: string } }>) ?? [];
    const igAccount = pages.map(page => page.instagram_business_account).find(Boolean);
    if (igAccount?.id) {
      return { accountId: igAccount.id, username: igAccount.username };
    }
  } catch (error) {
    console.warn('[social] failed to resolve Instagram account id', (error as Error).message);
  }

  return null;
}
