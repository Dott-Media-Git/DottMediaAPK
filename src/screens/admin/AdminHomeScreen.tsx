import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '@constants/colors';
import { getOrgProfile } from '@services/admin/orgService';
import { useAuth } from '@context/AuthContext';
import { useNavigation } from '@react-navigation/native';
import { useI18n } from '@context/I18nContext';

type Section = {
  title: string;
  screen: string;
  description: string;
};

const sections: Section[] = [
  { title: 'Organization', screen: 'OrgProfile', description: 'Name, branding, locale' },
  { title: 'Users & Roles', screen: 'UsersRoles', description: 'Invite teammates, manage RBAC' },
  { title: 'Channels', screen: 'Channels', description: 'Connect WhatsApp, Meta, LinkedIn, Web' },
  { title: 'Features & Flags', screen: 'FeaturesFlags', description: 'Toggle feature sets per plan' },
  { title: 'Booking & KB', screen: 'BookingKB', description: 'Calendar + knowledge sources' },
  { title: 'Plans & Usage', screen: 'PlansUsage', description: 'Usage charts, billing & plan swap' },
  { title: 'Ops & Audit', screen: 'OpsAudit', description: 'Webhooks, jobs, audit trails' },
];

export const AdminHomeScreen: React.FC = () => {
  const { orgId } = useAuth();
  const navigation = useNavigation();
  const { t } = useI18n();
  const [org, setOrg] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    getOrgProfile(orgId)
      .then(data => setOrg(data))
      .catch(error => Alert.alert(t('Error'), error.message))
      .finally(() => setLoading(false));
  }, [orgId]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>{org?.name ?? t('Organization')}</Text>
        <Text style={styles.heroSubtitle}>
          {t('Plan: {{plan}}', { plan: org?.plan ?? t('Free') })} {org?.locale?.tz ? `- ${org.locale.tz}` : ''}
        </Text>
        {loading && <ActivityIndicator color={colors.accent} style={{ marginTop: 12 }} />}
      </View>
      {sections.map(section => (
        <TouchableOpacity
          key={section.title}
          style={styles.card}
          onPress={() => navigation.navigate(section.screen as never)}
        >
          <Text style={styles.cardTitle}>{t(section.title)}</Text>
          <Text style={styles.cardSubtitle}>{t(section.description)}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 80 },
  hero: {
    borderRadius: 24,
    padding: 20,
    backgroundColor: colors.backgroundAlt,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
  },
  heroTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
  },
  heroSubtitle: {
    color: colors.subtext,
    marginTop: 6,
  },
  card: {
    backgroundColor: '#0A2540',
    padding: 18,
    borderRadius: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,122,0,0.3)',
  },
  cardTitle: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  cardSubtitle: {
    color: 'rgba(255,255,255,0.7)',
    marginTop: 6,
  },
});
