type EventRecord = { id: string; channel: string; senderId: string; message: string; messageType: string;
  status: string; payload: Record<string, unknown> };

export async function storeFacebookPageEvents(body: any, dependencies: {
  findOwner: (pageId: string) => Promise<string | null>;
  reserve: (event: EventRecord) => Promise<boolean>;
}) {
  for (const entry of body.entry) {
    const pageId = String(entry?.id ?? '');
    const ownerId = await dependencies.findOwner(pageId);
    if (!ownerId) continue;
    for (const change of entry.changes ?? []) {
      const value = change?.value;
      const id = String(value?.comment_id ?? '');
      const senderId = String(value?.from?.id ?? '');
      if (change?.field !== 'feed' || value?.item !== 'comment' || !id || !value?.message || senderId === pageId) continue;
      if (value?.verb && value.verb !== 'add') continue;
      await dependencies.reserve({ id: `facebook_page_comment_${pageId}_${id}`, channel: 'facebook',
        senderId: senderId || 'unknown', message: String(value.message), messageType: 'comment', status: 'received',
        payload: { ownerId, accountId: pageId, commentId: id, source: 'page_webhook' } });
    }
    for (const event of entry.messaging ?? []) {
      const senderId = String(event?.sender?.id ?? '');
      const id = String(event?.message?.mid ?? '');
      if (!id || !senderId || senderId === pageId || event?.message?.is_echo || !event?.message?.text) continue;
      await dependencies.reserve({ id: `facebook_page_dm_${pageId}_${id}`, channel: 'facebook',
        senderId, message: String(event.message.text), messageType: 'dm', status: 'received',
        payload: { ownerId, accountId: pageId, source: 'page_webhook' } });
    }
  }
}
