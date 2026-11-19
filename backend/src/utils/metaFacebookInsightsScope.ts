/** Request Page insights when connecting Facebook without making it a login prerequisite. */
export function withFacebookInsightsScope(scopes: string[], platform: string): string[] {
  if (platform !== 'facebook' && platform !== 'all') return scopes;
  return [...new Set([...scopes, 'read_insights'])];
}

export function isOptionalMetaScope(scope: string, platform: string): boolean {
  return scope === 'read_insights' && (platform === 'facebook' || platform === 'all');
}
