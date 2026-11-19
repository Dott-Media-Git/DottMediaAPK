type Account = Record<string, unknown> | null | undefined;

function firstLabel(account: Account, fields: string[], handle = false): string | null {
  for (const field of fields) {
    const value = account?.[field];
    if (typeof value !== 'string' || !value.trim()) continue;
    const label = value.trim();
    return handle && field === 'username' && !label.startsWith('@') ? `@${label}` : label;
  }
  return null;
}

/** Only expose explicitly selected display metadata; never return account credentials. */
export function socialAccountLabels(accounts: Record<string, Account>, youtubeTitle?: string | null) {
  return {
    facebook: firstLabel(accounts.facebook, ['pageName', 'name']),
    instagram: firstLabel(accounts.instagram, ['username', 'name', 'displayName'], true),
    threads: firstLabel(accounts.threads, ['username', 'name', 'displayName'], true),
    linkedin: firstLabel(accounts.linkedin, ['organizationName', 'companyName', 'name', 'displayName', 'username']),
    twitter: firstLabel(accounts.twitter, ['username', 'name', 'displayName'], true),
    whatsapp: firstLabel(accounts.whatsapp, ['displayPhoneNumber', 'verifiedName', 'name']),
    tiktok: firstLabel(accounts.tiktok, ['username', 'displayName', 'name'], true),
    youtube: typeof youtubeTitle === 'string' && youtubeTitle.trim() ? youtubeTitle.trim() : null,
  };
}
