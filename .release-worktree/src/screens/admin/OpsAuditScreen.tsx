import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { DMButton } from '@components/DMButton';
import { colors } from '@constants/colors';
import { useAuth } from '@context/AuthContext';
import { runJob, testWebhook } from '@services/admin/opsService';
import { fetchAuditEvents } from '@services/admin/auditService';

const jobs = [
  { type: 'followups', label: 'Run Follow-ups' },
  { type: 'reindexKB', label: 'Reindex Knowledge Base' },
  { type: 'testWebhook', label: 'Test Webhooks' },
];

export const OpsAuditScreen: React.FC = () => {
  const { orgId } = useAuth();
  const [audit, setAudit] = useState<any[]>([]);
  const [webhookUrl, setWebhookUrl] = useState('');

  const refresh = () => {
    if (!orgId) return;
    fetchAuditEvents(orgId)
      .then(setAudit)
      .catch(error => Alert.alert('Error', error.message));
  };

  useEffect(refresh, [orgId]);

  const triggerJob = async (type: string) => {
    if (!orgId) return;
    try {
      if (type === 'testWebhook') {
        await testWebhook(orgId, { url: webhookUrl || 'https://example.com/webhook' });
      } else {
        await runJob(orgId, type);
      }
      Alert.alert('Success', `${type} enqueued`);
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.title}>Ops Tools</Text>
        <TextInput
          placeholder="Webhook URL"
          placeholderTextColor={colors.subtext}
          value={webhookUrl}
          onChangeText={setWebhookUrl}
          style={styles.input}
        />
        {jobs.map(job => (
          <DMButton key={job.type} title={job.label} onPress={() => triggerJob(job.type)} style={{ marginTop: 8 }} />
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Audit Log</Text>
        {audit.map(event => (
          <View key={event.id} style={styles.auditRow}>
            <Text style={styles.auditAction}>{event.action}</Text>
            <Text style={styles.auditMeta}>
              {event.uid} • {event.resource}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20 },
  card: {
    backgroundColor: colors.backgroundAlt,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 16,
  },
  title: { color: colors.text, fontWeight: '700', marginBottom: 10 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    color: colors.text,
    marginBottom: 12,
  },
  auditRow: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 8,
  },
  auditAction: { color: colors.text, fontWeight: '600' },
  auditMeta: { color: colors.subtext, fontSize: 12 },
});
