type PageRow = { user_id?: unknown; accounts?: { facebook?: { webhookEventsOnly?: unknown } } };
type PageControl = { status?: unknown; payload?: { ownerId?: unknown } } | null;

export function resolveFacebookPageBinding(rows: PageRow[], control: PageControl) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length >= 20) return null;
  const controlOwner = control?.payload?.ownerId;
  const matches = control ? rows.filter(row => row.user_id === controlOwner) : rows;
  if (matches.length !== 1 || typeof matches[0].user_id !== 'string') return null;
  const userId = matches[0].user_id;
  if (control && (controlOwner !== userId || control.status !== 'events_only')) return null;
  return { userId, eventsOnly: control?.status === 'events_only' || matches[0].accounts?.facebook?.webhookEventsOnly === true };
}
