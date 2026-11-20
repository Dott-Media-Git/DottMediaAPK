import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { DMButton } from '@components/DMButton';
import { fetchFacebookPageEvents, type FacebookPageEvent } from '@services/social';

export function FacebookPageActivity() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<FacebookPageEvent[]>([]);
  const [error, setError] = useState('');
  const load = async () => {
    setLoading(true); setError('');
    try { const result = await fetchFacebookPageEvents(); setEvents(result.events); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load Facebook activity.'); }
    finally { setLoading(false); }
  };
  return <View style={styles.panel}>
    <DMButton title={open ? 'Hide Page activity' : 'View Page activity'} size="compact" onPress={() => {
      if (!open) void load(); setOpen(!open);
    }} />
    {open ? <View style={styles.content}>
      <Text style={styles.title}>Recent Facebook Page activity</Text>
      <Text style={styles.muted}>New notifications received for this Page appear here. This view does not send replies.</Text>
      <DMButton title="Refresh activity" size="compact" onPress={() => void load()} loading={loading} disabled={loading} />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {!loading && !error && !events.length ? <Text style={styles.muted}>No new Page activity received yet.</Text> : null}
      {events.map(event => <View style={styles.item} key={event.id}>
        <Text style={styles.title}>{event.type === 'dm' ? 'Messenger message' : 'Comment'}</Text>
        <Text style={styles.message}>{event.text || 'No text'}</Text>
        {event.receivedAt ? <Text style={styles.muted}>{new Date(event.receivedAt).toLocaleString()}</Text> : null}
      </View>)}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  panel: { marginTop: 12 }, content: { gap: 10, marginTop: 12 },
  title: { color: '#f7f5ff', fontWeight: '700' }, muted: { color: '#aeb9d7', lineHeight: 20 },
  message: { color: '#f7f5ff', lineHeight: 20 }, error: { color: '#ff8d9f' },
  item: { padding: 12, gap: 5, borderRadius: 12, backgroundColor: '#101833' },
});
