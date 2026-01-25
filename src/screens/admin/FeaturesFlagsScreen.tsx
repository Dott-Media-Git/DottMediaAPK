import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View, Switch } from 'react-native';
import { colors } from '@constants/colors';
import { useAuth } from '@context/AuthContext';
import { fetchSettings, updateSettings } from '@services/admin/settingsService';
import { useI18n } from '@context/I18nContext';

export const FeaturesFlagsScreen: React.FC = () => {
  const { orgId } = useAuth();
  const { t } = useI18n();
  const [features, setFeatures] = useState<any>({});

  useEffect(() => {
    if (!orgId) return;
    fetchSettings(orgId)
      .then(data => setFeatures(data.features))
      .catch(error => Alert.alert(t('Error'), error.message));
  }, [orgId]);

  const toggle = async (key: string) => {
    if (!orgId) return;
    const next = { ...features, [key]: !features[key] };
    setFeatures(next);
    try {
      await updateSettings(orgId, { features: next });
    } catch (error: any) {
      Alert.alert(t('Error'), error.message);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {Object.keys(features || {}).map(key => (
        <View key={key} style={styles.row}>
          <View>
            <Text style={styles.label}>{key}</Text>
            <Text style={styles.subtitle}>{t('Controls {{key}} experience', { key })}</Text>
          </View>
          <Switch
            value={features[key]}
            onValueChange={() => toggle(key)}
            thumbColor={features[key] ? colors.accent : colors.border}
          />
        </View>
      ))}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
  },
  label: { color: colors.text, fontWeight: '700', textTransform: 'capitalize' },
  subtitle: { color: colors.subtext, marginTop: 4 },
});
