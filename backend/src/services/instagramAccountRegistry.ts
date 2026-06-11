export type InstagramLoginAccount = {
  key: string;
  userId: string;
  username: string;
  tokenEnv: string[];
};

const DEFAULT_INSTAGRAM_LOGIN_ACCOUNTS: InstagramLoginAccount[] = [
  {
    key: 'dotthr',
    userId: '80bYIeiuukNFtUvXTUobXmfC7pu1',
    username: 'dott_human_resource',
    tokenEnv: ['DOTT_HR_INSTAGRAM_LOGIN_TOKEN', 'DOTTHR_INSTAGRAM_LOGIN_TOKEN'],
  },
  {
    key: 'dottenergy',
    userId: 'LVR7p3WzdFM51ds92Kacf6S40og2',
    username: 'dottenergy100',
    tokenEnv: ['DOTTENERGY_INSTAGRAM_LOGIN_TOKEN', 'DOTT_ENERGY_INSTAGRAM_LOGIN_TOKEN'],
  },
  {
    key: 'carmarketplace',
    userId: 'acmVetCcOiTHeGk5D7eDYieamDF3',
    username: 'carmarketplace999',
    tokenEnv: ['CARMARKETPLACE_INSTAGRAM_LOGIN_TOKEN', 'CARMARKET_INSTAGRAM_LOGIN_TOKEN'],
  },
  {
    key: 'staysphere',
    userId: 'D1iNgjLKNRaQhH35M0NmGfw1LVD2',
    username: 'staysphere93',
    tokenEnv: ['STAYSPHERE_INSTAGRAM_LOGIN_TOKEN'],
  },
  {
    key: 'gamers44life',
    userId: 'vzdH1DnfFLVjlY8bBgC26WACmmw2',
    username: 'gamers44life',
    tokenEnv: ['GAMERS44LIFE_INSTAGRAM_LOGIN_TOKEN', 'GAMERS_INSTAGRAM_LOGIN_TOKEN'],
  },
  {
    key: 'ballanalytics',
    userId: '1zvY9nNyXMcfxdPQEyx0bIdK7r53',
    username: 'ball_analytics',
    tokenEnv: ['BALL_ANALYTICS_INSTAGRAM_LOGIN_TOKEN', 'FOOTBALL_ANALYTICS_INSTAGRAM_LOGIN_TOKEN'],
  },
  {
    key: 'shecare',
    userId: 'tCE1FQ1cOFgdupOXP23mPUMQRAz1',
    username: 'shecaredoctor',
    tokenEnv: ['SHECARE_INSTAGRAM_LOGIN_TOKEN', 'SHECARE_DOCTOR_INSTAGRAM_LOGIN_TOKEN'],
  },
];

const parseExtraAccounts = (): InstagramLoginAccount[] => {
  const raw = process.env.INSTAGRAM_LOGIN_ACCOUNTS_JSON?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry): InstagramLoginAccount | null => {
        const key = String(entry?.key ?? '').trim();
        const userId = String(entry?.userId ?? '').trim();
        const username = String(entry?.username ?? '').trim();
        const tokenEnv = Array.isArray(entry?.tokenEnv)
          ? entry.tokenEnv.map((value: unknown) => String(value).trim()).filter(Boolean)
          : [String(entry?.tokenEnv ?? '').trim()].filter(Boolean);
        if (!key || !userId || !username || !tokenEnv.length) return null;
        return { key, userId, username, tokenEnv };
      })
      .filter(Boolean) as InstagramLoginAccount[];
  } catch (error) {
    console.warn('[instagram-registry] failed to parse INSTAGRAM_LOGIN_ACCOUNTS_JSON', (error as Error).message);
    return [];
  }
};

export const getInstagramLoginToken = (account: InstagramLoginAccount) => {
  for (const envKey of account.tokenEnv) {
    const value = process.env[envKey]?.trim();
    if (value) return value;
  }
  return '';
};

export const getInstagramLoginAccounts = () => {
  const accounts = [...DEFAULT_INSTAGRAM_LOGIN_ACCOUNTS, ...parseExtraAccounts()];
  const seen = new Set<string>();
  return accounts.filter(account => {
    const key = account.key.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const resolveInstagramLoginAccount = (options: { userId?: string; accountKey?: string } = {}) => {
  const userId = options.userId?.trim().toLowerCase();
  const accountKey = options.accountKey?.trim().toLowerCase();
  const accounts = getInstagramLoginAccounts();
  return (
    accounts.find(account => accountKey && account.key.toLowerCase() === accountKey) ??
    accounts.find(account => userId && account.userId.toLowerCase() === userId) ??
    null
  );
};
