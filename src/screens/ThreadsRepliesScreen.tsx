import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DMCard } from '@components/DMCard';
import { colors } from '@constants/colors';
import { fetchThreadsReplies, updateThreadsAutoResponse, type ThreadsRepliesResponse } from '@services/social';

const labels: Record<string, string> = { sent: 'Replied', pending: 'Processing', failed: 'Reply failed', skipped: 'Not sent' };
export const ThreadsRepliesScreen: React.FC = () => {
  const [data, setData] = useState<ThreadsRepliesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const requestVersion = useRef(0);
  const savingRef = useRef(false);
  const load = useCallback(async () => {
    if (savingRef.current) return;
    const version = ++requestVersion.current;
    try { const result = await fetchThreadsReplies(); if (version === requestVersion.current) { setData(result); setError(null); } }
    catch (e: any) { if (version === requestVersion.current) setError(e?.message ?? 'Could not load Threads replies.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); const timer = setInterval(() => { void load(); }, 30000); return () => clearInterval(timer); }, [load]);
  const setEnabled = async (enabled: boolean) => {
    savingRef.current = true;
    requestVersion.current += 1;
    setSaving(true);
    try {
      const result = await updateThreadsAutoResponse(enabled);
      setData(current => current ? { ...current, autoResponseEnabled: result.enabled } : current);
      setError(null);
    } catch (e: any) { setError(e?.message ?? 'Could not update auto-response.'); }
    finally { savingRef.current = false; setSaving(false); }
  };
  return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
    <View style={styles.header}><View style={styles.heading}><Text style={styles.title}>Threads Replies</Text><Text style={styles.muted}>See replies Dotti has processed and manage automatic responses.</Text></View>
      <TouchableOpacity accessibilityLabel="Refresh Threads replies" onPress={() => void load()} style={styles.refresh}><Ionicons name="refresh-outline" color={colors.text} size={21} /></TouchableOpacity></View>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {loading && !data ? <ActivityIndicator color={colors.accent} /> : data ? <>
      <DMCard title="Threads connection"><Text style={styles.text}>{data.connection.connected ? `Connected${data.connection.username ? ` as @${data.connection.username}` : ''}` : 'Not connected. Connect Threads in Social Integrations.'}</Text></DMCard>
      <DMCard title="Auto-response" subtitle="When enabled, Dotti can respond to new replies on your Threads posts."><View style={styles.row}><View style={styles.heading}><Text style={styles.text}>{data.autoResponseEnabled ? 'Auto-response is on' : 'Auto-response is off'}</Text><Text style={styles.muted}>New replies are processed while auto-response is on.</Text></View><Switch accessibilityLabel="Threads auto-response" value={data.autoResponseEnabled} disabled={saving} onValueChange={setEnabled} trackColor={{ false: colors.border, true: colors.accentMuted }} thumbColor={data.autoResponseEnabled ? colors.accent : colors.subtext} /></View></DMCard>
      <Text style={styles.section}>Recent replies</Text><Text style={styles.muted}>Shows replies processed by Dotti. Earlier replies and replies received while off may not appear.</Text>
      {data.replies.length === 0 ? <DMCard title="No processed replies yet" subtitle="Once auto-response is on, new eligible replies appear here after Dotti processes them." /> : data.replies.map(item => <DMCard key={item.id}><View style={styles.row}><Text style={styles.sender}>{item.sender ? `@${item.sender}` : 'Threads user'}</Text><Text style={styles.status}>{labels[item.status] ?? 'Processed'}</Text></View><Text style={styles.muted}>{item.receivedAt ? new Date(item.receivedAt).toLocaleString() : ''}</Text><Text style={styles.comment}>{item.text}</Text>{item.reply ? <View style={styles.reply}><Text style={styles.replyLabel}>Dotti’s reply</Text><Text style={styles.text}>{item.reply}</Text></View> : item.status === 'sent' ? <Text style={styles.muted}>Reply sent. The response text was not saved for this older entry.</Text> : null}</DMCard>)}
    </> : null}
  </ScrollView>;
};
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background }, content: { width: '100%', maxWidth: 900, alignSelf: 'center', padding: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 12 }, heading: { flex: 1 }, title: { fontSize: 25, fontWeight: '900', color: colors.text }, muted: { color: colors.subtext, marginTop: 5, lineHeight: 20 },
  refresh: { width: 44, height: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, text: { color: colors.text, lineHeight: 21 }, section: { color: colors.text, fontSize: 19, fontWeight: '900', marginTop: 18 },
  sender: { color: colors.text, fontWeight: '800', flex: 1 }, status: { color: colors.accentMuted, fontWeight: '800' }, comment: { color: colors.text, fontSize: 16, marginTop: 12, lineHeight: 23 },
  reply: { borderLeftWidth: 2, borderLeftColor: colors.accent, paddingLeft: 12, marginTop: 14 }, replyLabel: { color: colors.accentMuted, fontWeight: '800', marginBottom: 4 }, error: { color: colors.danger, marginBottom: 12 },
});
