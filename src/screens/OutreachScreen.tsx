import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View, RefreshControl } from 'react-native';
import { DMButton } from '@components/DMButton';
import { colors } from '@constants/colors';
import { useAuth } from '@context/AuthContext';
import { getIdToken } from '@services/firebase';
import { env } from '@services/env';
import { useI18n } from '@context/I18nContext';

const API_BASE = env.apiUrl?.replace(/\/$/, '') ?? '';

export const OutreachScreen: React.FC = () => {
    const { state } = useAuth();
    const { t } = useI18n();
    const [stats, setStats] = useState({ sent: 0, replies: 0, conversions: 0, queue: 0 });
    const [logs, setLogs] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [running, setRunning] = useState(false);

    const fetchData = async () => {
        if (!state.user) return;
        setLoading(true);
        try {
            const token = await getIdToken();
            const headers = { Authorization: `Bearer ${token}` };

            const statsRes = await fetch(`${API_BASE}/api/outreach/stats`, { headers });
            const statsData = await statsRes.json();
            setStats(statsData);

            const logsRes = await fetch(`${API_BASE}/api/outreach/logs`, { headers });
            const logsData = await logsRes.json();
            setLogs(logsData.logs);
        } catch (error) {
            console.error('Failed to fetch outreach data', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const runOutreach = async () => {
        setRunning(true);
        try {
            const token = await getIdToken();
            const res = await fetch(`${API_BASE}/api/outreach/run`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
            });
            const result = await res.json();
            Alert.alert(
                t('Outreach Complete'),
                t('Sent: {{sent}}, Errors: {{errors}}', { sent: result.messagesSent, errors: result.errors.length })
            );
            fetchData();
        } catch (error) {
            Alert.alert(t('Error'), t('Failed to run outreach'));
        } finally {
            setRunning(false);
        }
    };

    return (
        <ScrollView
            style={styles.container}
            contentContainerStyle={styles.content}
            refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchData} />}
        >
            <View style={styles.header}>
                <Text style={styles.title}>{t('Outreach Manager')}</Text>
                <Text style={styles.subtitle}>{t('Automated prospecting & messaging')}</Text>
            </View>

            <View style={styles.statsRow}>
                <View style={styles.statCard}>
                    <Text style={styles.statValue}>{stats.sent}</Text>
                    <Text style={styles.statLabel}>{t('Sent')}</Text>
                </View>
                <View style={styles.statCard}>
                    <Text style={styles.statValue}>{stats.replies}</Text>
                    <Text style={styles.statLabel}>{t('Replies')}</Text>
                </View>
                <View style={styles.statCard}>
                    <Text style={styles.statValue}>{stats.conversions}</Text>
                    <Text style={styles.statLabel}>{t('Leads')}</Text>
                </View>
            </View>

            <View style={styles.card}>
                <Text style={styles.cardTitle}>{t('Actions')}</Text>
                <Text style={styles.cardText}>
                    {t('{{count}} prospects in queue. Ready to run daily batch?', { count: stats.queue })}
                </Text>
                <DMButton
                    title={running ? t('Running Agent...') : t('Run Outreach Now')}
                    onPress={runOutreach}
                    disabled={running}
                />
            </View>

            <View style={styles.card}>
                <Text style={styles.cardTitle}>{t('Recent Activity')}</Text>
                {logs.map((log, index) => (
                    <View key={index} style={styles.logItem}>
                        <View style={[styles.dot, { backgroundColor: log.type === 'sent' ? colors.accent : colors.success }]} />
                        <View style={{ flex: 1 }}>
                            <Text style={styles.logMessage}>{log.message}</Text>
                            <Text style={styles.logTime}>{new Date(log.timestamp).toLocaleTimeString()}</Text>
                        </View>
                    </View>
                ))}
                {logs.length === 0 && <Text style={styles.cardText}>{t('No recent activity.')}</Text>}
            </View>
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 20 },
    header: { marginBottom: 24 },
    title: { fontSize: 28, fontWeight: '800', color: colors.text },
    subtitle: { fontSize: 16, color: colors.subtext, marginTop: 4 },
    statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
    statCard: {
        flex: 1,
        backgroundColor: colors.backgroundAlt,
        padding: 16,
        borderRadius: 16,
        alignItems: 'center',
        marginHorizontal: 4,
        borderWidth: 1,
        borderColor: colors.border
    },
    statValue: { fontSize: 24, fontWeight: '700', color: colors.text },
    statLabel: { fontSize: 12, color: colors.subtext, textTransform: 'uppercase', marginTop: 4 },
    card: {
        backgroundColor: colors.backgroundAlt,
        padding: 20,
        borderRadius: 20,
        marginBottom: 20,
        borderWidth: 1,
        borderColor: colors.border
    },
    cardTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 12 },
    cardText: { color: colors.subtext, marginBottom: 16, lineHeight: 20 },
    logItem: { flexDirection: 'row', marginBottom: 16, alignItems: 'flex-start' },
    dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6, marginRight: 12 },
    logMessage: { color: colors.text, fontSize: 14, lineHeight: 20 },
    logTime: { color: colors.subtext, fontSize: 12, marginTop: 2 }
});
