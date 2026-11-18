export function optedInAfter(setting: { payload?: unknown; received_at?: unknown } | null | undefined): string | null {
  const payload = setting?.payload as { enabled?: unknown } | undefined;
  const since = typeof setting?.received_at === 'string' ? setting.received_at : '';
  return payload?.enabled === true && since && Number.isFinite(Date.parse(since)) ? since : null;
}

export function replyIsAfterOptIn(timestamp: string | undefined, since: string | undefined): boolean {
  if (!since) return true;
  const time = timestamp ? Date.parse(timestamp) : NaN;
  return Number.isFinite(time) && time > Date.parse(since);
}
