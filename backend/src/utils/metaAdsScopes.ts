export const defaultAdsScopes = [
  'ads_read',
  'ads_management',
  'business_management',
  'pages_show_list',
  'pages_read_engagement',
];

export function withPageAdsScopes(configuredScopes: string[]): string[] {
  return [...new Set([...configuredScopes, ...defaultAdsScopes, 'pages_manage_ads'])];
}
