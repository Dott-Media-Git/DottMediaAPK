import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DMCard } from '@components/DMCard';
import { colors } from '@constants/colors';
import { useAuth } from '@context/AuthContext';
import {
  fetchInstagramInbox,
  replyToInstagramInboxMessage,
  updateInstagramAutoResponse,
  type InstagramInboxMessage,
  type InstagramInboxResponse,
} from '@services/social';

const statusLabel: Record<string, string> = {
  pending: 'Waiting for reply',
  sent: 'Dotti replied',
  manual_sent: 'Manual reply sent',
  failed: 'Reply failed',
  disabled: 'Auto-response off',
};

const formatDate = (value: string | null) => {
  if (!value) return 'Just now';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Just now';
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

export const InstagramInboxScreen: React.FC = () => {
  const { state } = useAuth();
  const [data, setData] = useState<InstagramInboxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toggleLoading, setToggleLoading] = useState(false);
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (showRefresh = false) => {
    if (!state.user) return;
    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      setData(await fetchInstagramInbox());
      setNotice(null);
    } catch (error: any) {
      setNotice(error?.message ?? 'Unable to load Instagram messages.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [state.user]);

  useEffect(() => {
    void load();
  }, [load]);

  const messages = useMemo(() => data?.messages ?? [], [data?.messages]);

  const handleAutoResponse = async (enabled: boolean) => {
    setToggleLoading(true);
    try {
      const result = await updateInstagramAutoResponse(enabled);
      setData(current => current ? { ...current, autoResponseEnabled: result.enabled } : current);
      setNotice(result.enabled ? 'Dotti auto-response is on.' : 'Dotti auto-response is off. Messages will still appear here.');
    } catch (error: any) {
      setNotice(error?.message ?? 'Unable to update auto-response.');
    } finally {
      setToggleLoading(false);
    }
  };

  const handleReply = async (message: InstagramInboxMessage) => {
    const text = (drafts[message.id] ?? '').trim();
    if (!text) return;
    setReplyingId(message.id);
    try {
      const result = await replyToInstagramInboxMessage(message.id, text);
      setData(current => current ? {
        ...current,
        messages: current.messages.map(item => item.id === message.id ? result.message : item),
      } : current);
      setDrafts(current => ({ ...current, [message.id]: '' }));
      setNotice('Reply sent to Instagram.');
    } catch (error: any) {
      setNotice(error?.message ?? 'Unable to send the Instagram reply.');
    } finally {
      setReplyingId(null);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />}
    >
      <View style={styles.heroRow}>
        <View style={styles.heroIcon}><Ionicons name="logo-instagram" size={30} color="#fff" /></View>
        <View style={styles.heroCopy}>
          <Text style={styles.title}>Instagram Inbox</Text>
          <Text style={styles.subtitle}>Read incoming DMs, reply from Dotti, and control automatic responses.</Text>
        </View>
        <TouchableOpacity style={styles.refreshButton} onPress={() => load(true)} accessibilityLabel="Refresh Instagram inbox">
          <Ionicons name="refresh-outline" size={21} color={colors.text} />
        </TouchableOpacity>
      </View>

      {notice ? <View style={styles.notice}><Ionicons name="information-circle-outline" size={18} color={colors.accentMuted} /><Text style={styles.noticeText}>{notice}</Text></View> : null}

      <DMCard title="Connection" subtitle="Messages stay on the server; access tokens never appear in this inbox.">
        <View style={styles.connectionRow}>
          <View style={[styles.connectionDot, data?.connection.connected && styles.connectionDotOn]} />
          <View style={styles.connectionCopy}>
            <Text style={styles.connectionTitle}>{data?.connection.connected ? 'Instagram connected' : 'Instagram not connected'}</Text>
            <Text style={styles.muted}>{data?.connection.username ? `@${data.connection.username}` : 'Connect an Instagram account in Social Integrations.'}</Text>
          </View>
          <Ionicons name={data?.connection.connected ? 'checkmark-circle' : 'alert-circle-outline'} size={22} color={data?.connection.connected ? colors.success : colors.warning} />
        </View>
      </DMCard>

      <DMCard title="Auto-response" subtitle="When on, Dotti replies to new Instagram DMs. When off, messages remain available for manual replies.">
        <View style={styles.toggleRow}>
          <View style={styles.toggleCopy}>
            <Text style={styles.connectionTitle}>{data?.autoResponseEnabled ? 'Auto-response is on' : 'Auto-response is off'}</Text>
            <Text style={styles.muted}>{data?.autoResponseEnabled ? 'New messages are answered automatically.' : 'New messages are saved without sending an automatic reply.'}</Text>
          </View>
          <Switch value={Boolean(data?.autoResponseEnabled)} onValueChange={handleAutoResponse} disabled={toggleLoading} trackColor={{ false: colors.border, true: colors.accentMuted }} thumbColor={data?.autoResponseEnabled ? colors.accent : colors.subtext} />
        </View>
      </DMCard>

      <View style={styles.sectionHeader}>
        <View><Text style={styles.sectionTitle}>Recent messages</Text><Text style={styles.muted}>The inbox refreshes from your connected account.</Text></View>
        <Text style={styles.count}>{messages.length}</Text>
      </View>

      {loading ? <ActivityIndicator color={colors.accent} style={styles.loader} /> : messages.length === 0 ? (
        <DMCard title="No Instagram DMs yet" subtitle="Send a message to your connected Instagram account from a tester account, then refresh this page. The background listener checks regularly too." />
      ) : messages.map(message => (
        <DMCard key={message.id} style={styles.messageCard}>
          <View style={styles.messageHeader}>
            <View style={styles.avatar}><Ionicons name="person-outline" size={18} color={colors.accentMuted} /></View>
            <View style={styles.messageIdentity}><Text style={styles.sender}>{message.senderUsername ? `@${message.senderUsername}` : 'Instagram user'}</Text><Text style={styles.muted}>{formatDate(message.createdAt)}</Text></View>
            <Text style={[styles.status, message.replyStatus === 'failed' && styles.statusDanger]}>{statusLabel[message.replyStatus] ?? message.replyStatus}</Text>
          </View>
          <Text style={styles.messageText}>{message.text}</Text>
          {message.replyText ? <View style={styles.replyPreview}><Text style={styles.replyLabel}>Dotti reply</Text><Text style={styles.replyText}>{message.replyText}</Text></View> : null}
          {message.replyError ? <Text style={styles.errorText}>{message.replyError}</Text> : null}
          <View style={styles.replyRow}>
            <TextInput
              value={drafts[message.id] ?? ''}
              onChangeText={text => setDrafts(current => ({ ...current, [message.id]: text }))}
              placeholder="Write a reply…"
              placeholderTextColor={colors.subtext}
              style={styles.input}
              multiline
              maxLength={2000}
            />
            <TouchableOpacity style={styles.sendButton} onPress={() => handleReply(message)} disabled={replyingId === message.id || !(drafts[message.id] ?? '').trim()}>
              {replyingId === message.id ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="send" size={18} color="#fff" />}
            </TouchableOpacity>
          </View>
        </DMCard>
      ))}
      <Text style={styles.footer}>Instagram permissions control what Dotti can receive and send. Review every automated reply before relying on it.</Text>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 40, maxWidth: 900, width: '100%', alignSelf: 'center' },
  heroRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  heroIcon: { width: 58, height: 58, borderRadius: 19, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  heroCopy: { flex: 1 },
  title: { color: colors.text, fontSize: 25, fontWeight: '900' },
  subtitle: { color: colors.subtext, marginTop: 5, lineHeight: 20 },
  refreshButton: { width: 42, height: 42, borderRadius: 14, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardOverlay, padding: 12, marginVertical: 8 },
  noticeText: { flex: 1, color: colors.text, lineHeight: 19 },
  connectionRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  connectionDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: colors.warning },
  connectionDotOn: { backgroundColor: colors.success },
  connectionCopy: { flex: 1 },
  connectionTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  muted: { color: colors.subtext, marginTop: 3, lineHeight: 19 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  toggleCopy: { flex: 1 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 4 },
  sectionTitle: { color: colors.text, fontSize: 19, fontWeight: '900' },
  count: { color: colors.accentMuted, fontWeight: '900', fontSize: 18 },
  loader: { marginVertical: 36 },
  messageCard: { marginVertical: 7 },
  messageHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 13, backgroundColor: colors.cardOverlay, alignItems: 'center', justifyContent: 'center' },
  messageIdentity: { flex: 1 },
  sender: { color: colors.text, fontWeight: '800' },
  status: { color: colors.success, fontSize: 12, fontWeight: '800' },
  statusDanger: { color: colors.danger },
  messageText: { color: colors.text, fontSize: 16, lineHeight: 23, marginTop: 14 },
  replyPreview: { borderLeftWidth: 2, borderLeftColor: colors.accent, paddingLeft: 11, marginTop: 14 },
  replyLabel: { color: colors.accentMuted, fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  replyText: { color: colors.subtext, lineHeight: 20, marginTop: 3 },
  errorText: { color: colors.danger, marginTop: 10 },
  replyRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 15 },
  input: { flex: 1, minHeight: 44, maxHeight: 110, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, backgroundColor: colors.backgroundAlt },
  sendButton: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  footer: { color: colors.subtext, textAlign: 'center', fontSize: 12, lineHeight: 18, marginTop: 18 },
});
