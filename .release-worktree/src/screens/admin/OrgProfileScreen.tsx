import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { DMButton } from '@components/DMButton';
import { colors } from '@constants/colors';
import { getOrgProfile, updateOrgProfile } from '@services/admin/orgService';
import { useAuth } from '@context/AuthContext';

export const OrgProfileScreen: React.FC = () => {
  const { orgId } = useAuth();
  const [form, setForm] = useState({ name: '', logoUrl: '', lang: 'en', tz: 'UTC', currency: 'USD' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    getOrgProfile(orgId)
      .then(org =>
        setForm({
          name: org.name ?? '',
          logoUrl: org.logoUrl ?? '',
          lang: org.locale?.lang ?? 'en',
          tz: org.locale?.tz ?? 'UTC',
          currency: org.locale?.currency ?? 'USD',
        }),
      )
      .catch(error => Alert.alert('Error', error.message));
  }, [orgId]);

  const submit = async () => {
    if (!orgId) return;
    setSaving(true);
    try {
      await updateOrgProfile(orgId, {
        name: form.name,
        logoUrl: form.logoUrl,
        locale: { lang: form.lang, tz: form.tz, currency: form.currency },
      });
      Alert.alert('Saved', 'Organization profile updated');
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {(['name', 'logoUrl', 'lang', 'tz', 'currency'] as const).map(field => (
        <View key={field} style={styles.group}>
          <Text style={styles.label}>{field.toUpperCase()}</Text>
          <TextInput
            value={form[field]}
            onChangeText={value => setForm(prev => ({ ...prev, [field]: value }))}
            style={styles.input}
          />
        </View>
      ))}
      <DMButton title={saving ? 'Saving...' : 'Save'} onPress={submit} disabled={saving} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20 },
  group: { marginBottom: 16 },
  label: { color: colors.subtext, marginBottom: 6, fontSize: 12 },
  input: {
    backgroundColor: colors.backgroundAlt,
    borderRadius: 12,
    padding: 12,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
