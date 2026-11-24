type Action = { action_type: string; value: string | number };
type ReportRow = { date_start?: string; date_stop?: string; impressions?: string | number; actions?: Action[] };
type WebsiteAd = {
  creative?: { object_story_spec?: { link_data?: { link?: string } } };
  overview_report?: { data?: ReportRow[] };
};

type ReportWindow = { since: string; until: string };

export function summarizeCarMarketAds(ads: WebsiteAd[], window: ReportWindow, website: string) {
  let views = 0;
  let interactions = 0;
  let conversions = 0;
  for (const ad of ads) {
    // The rotation's website creatives are separate ads. Exclude legacy boosts
    // of published posts because their events can also appear in social metrics.
    if (ad.creative?.object_story_spec?.link_data?.link !== website) continue;
    for (const row of ad.overview_report?.data ?? []) {
      if (!row.date_start || !row.date_stop || row.date_start < window.since || row.date_stop > window.until) continue;
      const actions = new Map((row.actions ?? []).map(action => [action.action_type, Number(action.value) || 0]));
      const firstReported = (types: string[]) => types.map(type => actions.get(type)).find(value => value !== undefined) ?? 0;
      views += Number(row.impressions) || 0;
      interactions += firstReported(['post_engagement']);
      // Meta can return the same event under aggregate and source-specific names.
      conversions += firstReported(['omni_lead', 'lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead']);
      conversions += firstReported(['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase']);
    }
  }
  return { ...window, views, interactions, conversions };
}
