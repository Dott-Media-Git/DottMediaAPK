const dayMs = 86_400_000;

export function metaAdsReportWindow(now: number, timeZone?: string) {
  let until = new Date(now).toISOString().slice(0, 10);
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(now);
      const dates = Object.fromEntries(parts.map(part => [part.type, part.value]));
      until = `${dates.year}-${dates.month}-${dates.day}`;
    } catch {
      // Use UTC if the account has no supported IANA time zone.
    }
  }
  const since = new Date(Date.parse(until) - 29 * dayMs).toISOString().slice(0, 10);
  return { since, until };
}

export function metaAdsReportingStatus(payload: { data?: unknown } | null | undefined) {
  if (!Array.isArray(payload?.data)) return 'unavailable';
  return payload.data.length ? 'reported' : 'pending';
}

export function metaAdsEffectiveStatus(ad: {
  status?: string;
  effective_status?: string;
  adset?: { start_time?: string; end_time?: string };
}, now: number) {
  const status = ad.effective_status ?? ad.status ?? null;
  if (status !== 'ACTIVE') return status;
  if (Date.parse(ad.adset?.end_time ?? '') <= now) return 'COMPLETED';
  if (Date.parse(ad.adset?.start_time ?? '') > now) return 'SCHEDULED';
  return status;
}
