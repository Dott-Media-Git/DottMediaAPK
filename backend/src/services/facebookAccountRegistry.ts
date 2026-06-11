export type FacebookPageAccount = {
  key: string;
  userId: string;
  pageId: string;
  tokenEnv: string[];
};

const DEFAULT_FACEBOOK_PAGE_ACCOUNTS: FacebookPageAccount[] = [
  {
    key: 'shecare',
    userId: 'tCE1FQ1cOFgdupOXP23mPUMQRAz1',
    pageId: '1114686181730831',
    tokenEnv: ['SHECARE_FACEBOOK_PAGE_TOKEN', 'SHECARE_FACEBOOK_ACCESS_TOKEN'],
  },
  {
    key: 'dotthr',
    userId: '80bYIeiuukNFtUvXTUobXmfC7pu1',
    pageId: '1154065791120794',
    tokenEnv: ['DOTT_HR_FACEBOOK_PAGE_TOKEN', 'DOTT_HR_FACEBOOK_ACCESS_TOKEN', 'DOTTHR_FACEBOOK_PAGE_TOKEN'],
  },
  {
    key: 'dottenergy',
    userId: 'LVR7p3WzdFM51ds92Kacf6S40og2',
    pageId: '1201086759745632',
    tokenEnv: ['DOTTENERGY_FACEBOOK_PAGE_TOKEN', 'DOTTENERGY_FACEBOOK_ACCESS_TOKEN'],
  },
  {
    key: 'carmarketplace',
    userId: 'acmVetCcOiTHeGk5D7eDYieamDF3',
    pageId: '1033657279841186',
    tokenEnv: ['CARMARKETPLACE_FACEBOOK_PAGE_TOKEN', 'CARMARKETPLACE_FACEBOOK_ACCESS_TOKEN'],
  },
  {
    key: 'staysphere',
    userId: 'D1iNgjLKNRaQhH35M0NmGfw1LVD2',
    pageId: '1191303874068642',
    tokenEnv: ['STAYSPHERE_FACEBOOK_PAGE_TOKEN', 'STAYSPHERE_FACEBOOK_ACCESS_TOKEN'],
  },
  {
    key: 'gamers44life',
    userId: 'vzdH1DnfFLVjlY8bBgC26WACmmw2',
    pageId: '1121885391014110',
    tokenEnv: ['GAMERS44LIFE_FACEBOOK_PAGE_TOKEN', 'GAMERS44LIFE_FACEBOOK_ACCESS_TOKEN'],
  },
];

const parseExtraAccounts = (): FacebookPageAccount[] => {
  const raw = process.env.FACEBOOK_PAGE_ACCOUNTS_JSON?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry): FacebookPageAccount | null => {
        const key = String(entry?.key ?? '').trim();
        const userId = String(entry?.userId ?? '').trim();
        const pageId = String(entry?.pageId ?? '').trim();
        const tokenEnv = Array.isArray(entry?.tokenEnv)
          ? entry.tokenEnv.map((value: unknown) => String(value).trim()).filter(Boolean)
          : [String(entry?.tokenEnv ?? '').trim()].filter(Boolean);
        if (!key || !userId || !pageId || !tokenEnv.length) return null;
        return { key, userId, pageId, tokenEnv };
      })
      .filter(Boolean) as FacebookPageAccount[];
  } catch (error) {
    console.warn('[facebook-registry] failed to parse FACEBOOK_PAGE_ACCOUNTS_JSON', (error as Error).message);
    return [];
  }
};

export const getFacebookPageToken = (account: FacebookPageAccount) => {
  for (const envKey of account.tokenEnv) {
    const value = process.env[envKey]?.trim();
    if (value) return value;
  }
  return '';
};

export const getFacebookPageAccounts = () => {
  const accounts = [...DEFAULT_FACEBOOK_PAGE_ACCOUNTS, ...parseExtraAccounts()];
  const seen = new Set<string>();
  return accounts.filter(account => {
    const key = account.key.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const resolveFacebookPageAccount = (options: { userId?: string; accountKey?: string; pageId?: string } = {}) => {
  const userId = options.userId?.trim().toLowerCase();
  const accountKey = options.accountKey?.trim().toLowerCase();
  const pageId = options.pageId?.trim();
  const accounts = getFacebookPageAccounts();
  return (
    accounts.find(account => accountKey && account.key.toLowerCase() === accountKey) ??
    accounts.find(account => userId && account.userId.toLowerCase() === userId) ??
    accounts.find(account => pageId && account.pageId === pageId) ??
    null
  );
};
