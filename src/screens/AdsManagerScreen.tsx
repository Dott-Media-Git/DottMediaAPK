import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@constants/colors';
import {
  boostMetaPost,
  fetchAdRuns,
  fetchBoostRule,
  fetchMetaAdAccounts,
  saveBoostRule,
  type BoostRule,
  type MetaAdAccount,
} from '@services/metaAds';
import { useAuth } from '@context/AuthContext';

const DEFAULT_WHATSAPP = '+447463010235';
const SHECARE_USER_ID = 'tCE1FQ1cOFgdupOXP23mPUMQRAz1';
const SHECARE_EMAIL = 'shecaredoctor@gmail.com';
const SHECARE_AD_ACCOUNT_ID = 'act_4886098734954394';
const SHECARE_AD_ACCOUNT_NAME = 'Shecare-Doctor Ads Account';
const AUTO_BOOST_PLATFORMS = [
  { key: 'facebook', label: 'Facebook feed' },
  { key: 'instagram', label: 'Instagram feed' },
  { key: 'facebook_story', label: 'Facebook story' },
  { key: 'instagram_story', label: 'Instagram story' },
];

const parseUsdBudget = (value: string) => {
  const normalized = value.replace(/[^\d.]/g, '');
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? Math.max(Math.round(numeric * 100) / 100, 0) : 0;
};

const budgetUsdFromRule = (rule: BoostRule) => {
  if (typeof rule.dailyBudgetUsd === 'number') return rule.dailyBudgetUsd;
  if (typeof rule.dailyBudgetMinor === 'number') return Math.round((rule.dailyBudgetMinor / 100) * 100) / 100;
  return 5;
};

export const AdsManagerScreen: React.FC = () => {
  const { state } = useAuth();
  const isShecareAccount =
    state.user?.uid === SHECARE_USER_ID || String(state.user?.email ?? '').toLowerCase() === SHECARE_EMAIL;
  const defaultWhatsapp = isShecareAccount ? DEFAULT_WHATSAPP : '';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [boosting, setBoosting] = useState(false);
  const [accounts, setAccounts] = useState<MetaAdAccount[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [manualPostId, setManualPostId] = useState('');
  const [manualCaption, setManualCaption] = useState('');
  const [rule, setRule] = useState<BoostRule>({
    enabled: false,
    mode: 'manual',
    whatsappNumber: defaultWhatsapp,
    dailyBudgetUsd: 5,
    durationHours: 24,
    statusOnCreate: 'PAUSED',
    autoBoostPlatforms: AUTO_BOOST_PLATFORMS.map(platform => platform.key),
    autoBoostStrategy: 'best_performing',
    performanceWindowHours: 48,
    minCandidateAgeMinutes: 15,
    autoBoostCooldownHours: 6,
    audience: { countries: ['UG'], ageMin: 18, ageMax: 65 },
  });

  const displayAccounts = useMemo(() => {
    if (!isShecareAccount) return accounts;
    const hasShecareAccount = accounts.some(account => account.id === SHECARE_AD_ACCOUNT_ID);
    if (hasShecareAccount) return accounts;
    return [
      {
        id: SHECARE_AD_ACCOUNT_ID,
        name: SHECARE_AD_ACCOUNT_NAME,
        account_status: 1,
        currency: 'USD',
        timezone_name: 'Africa/Kampala',
      },
      ...accounts,
    ];
  }, [accounts, isShecareAccount]);

  const selectedAccount = useMemo(
    () => displayAccounts.find(account => account.id === rule.adAccountId),
    [displayAccounts, rule.adAccountId],
  );

  const load = async () => {
    setLoading(true);
    try {
      const [ruleResponse, runsResponse] = await Promise.all([fetchBoostRule(), fetchAdRuns(20)]);
      setRule(current => ({
        ...current,
        ...ruleResponse.rule,
        adAccountId: isShecareAccount ? ruleResponse.rule?.adAccountId || SHECARE_AD_ACCOUNT_ID : ruleResponse.rule?.adAccountId,
        currency: isShecareAccount ? ruleResponse.rule?.currency || 'USD' : ruleResponse.rule?.currency,
        whatsappNumber: ruleResponse.rule?.whatsappNumber || defaultWhatsapp,
        dailyBudgetUsd: budgetUsdFromRule(ruleResponse.rule ?? current),
        autoBoostPlatforms: ruleResponse.rule?.autoBoostPlatforms?.length
          ? ruleResponse.rule.autoBoostPlatforms
          : current.autoBoostPlatforms,
        autoBoostStrategy: ruleResponse.rule?.autoBoostStrategy ?? current.autoBoostStrategy,
        performanceWindowHours: ruleResponse.rule?.performanceWindowHours ?? current.performanceWindowHours,
        minCandidateAgeMinutes: ruleResponse.rule?.minCandidateAgeMinutes ?? current.minCandidateAgeMinutes,
        autoBoostCooldownHours: ruleResponse.rule?.autoBoostCooldownHours ?? current.autoBoostCooldownHours,
      }));
      setRuns(runsResponse.runs ?? []);
      try {
        const accountResponse = await fetchMetaAdAccounts();
        setAccounts(accountResponse.accounts ?? []);
      } catch (error) {
        console.warn('Failed to load Meta ad accounts', error);
      }
    } catch (error: any) {
      Alert.alert('Ads Manager', error.message ?? 'Failed to load ads settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [defaultWhatsapp]);

  const updateRule = (patch: Partial<BoostRule>) => setRule(current => ({ ...current, ...patch }));

  const toggleAutoBoostPlatform = (platform: string) => {
    setRule(current => {
      const selected = new Set(current.autoBoostPlatforms?.length ? current.autoBoostPlatforms : []);
      if (selected.has(platform)) selected.delete(platform);
      else selected.add(platform);
      return { ...current, autoBoostPlatforms: Array.from(selected) };
    });
  };

  const handleSave = async () => {
    if (!String(rule.whatsappNumber ?? '').trim()) {
      Alert.alert('Ads Manager', isShecareAccount ? 'Confirm the Shecare WhatsApp number.' : 'Enter this client’s WhatsApp number before saving boost settings.');
      return;
    }
    if (budgetUsdFromRule(rule) < 1) {
      Alert.alert('Ads Manager', 'Daily budget must be at least $1.');
      return;
    }
    setSaving(true);
    try {
      const response = await saveBoostRule(rule);
      setRule(current => ({ ...current, ...response.rule }));
      Alert.alert('Ads Manager', 'Boost settings saved.');
    } catch (error: any) {
      Alert.alert('Ads Manager', error.message ?? 'Failed to save boost settings');
    } finally {
      setSaving(false);
    }
  };

  const handleManualBoost = async () => {
    const postId = manualPostId.trim();
    if (!postId) {
      Alert.alert('Ads Manager', 'Paste the Facebook post ID to boost.');
      return;
    }
    if (!String(rule.whatsappNumber ?? '').trim()) {
      Alert.alert('Ads Manager', isShecareAccount ? 'Confirm the Shecare WhatsApp number.' : 'Enter this client’s WhatsApp number before creating a boost.');
      return;
    }
    if (budgetUsdFromRule(rule) < 1) {
      Alert.alert('Ads Manager', 'Daily budget must be at least $1.');
      return;
    }
    setBoosting(true);
    try {
      await boostMetaPost({
        platform: 'facebook',
        postId,
        caption: manualCaption.trim(),
        adAccountId: rule.adAccountId,
        dailyBudgetUsd: budgetUsdFromRule(rule),
        durationHours: rule.durationHours,
        whatsappNumber: rule.whatsappNumber,
      });
      setManualPostId('');
      setManualCaption('');
      await load();
      Alert.alert('Ads Manager', 'Boost created.');
    } catch (error: any) {
      Alert.alert('Ads Manager', error.message ?? 'Failed to boost post');
    } finally {
      setBoosting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Ads Manager</Text>
        <Text style={styles.subtitle}>Boost Facebook posts with USD budget and client WhatsApp controls.</Text>
        </View>
        <TouchableOpacity style={styles.iconButton} onPress={() => void load()}>
          <Ionicons name="refresh-outline" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.panel}>
        <View style={styles.switchRow}>
          <View>
            <Text style={styles.sectionTitle}>Auto Boost</Text>
            <Text style={styles.helper}>When enabled, DottMedia scores eligible posts and boosts one winner after the cooldown.</Text>
          </View>
          <Switch value={Boolean(rule.enabled)} onValueChange={value => updateRule({ enabled: value })} />
        </View>

        <View style={styles.segment}>
          {(['manual', 'auto'] as const).map(mode => (
            <TouchableOpacity
              key={mode}
              style={[styles.segmentButton, rule.mode === mode && styles.segmentButtonActive]}
              onPress={() => updateRule({ mode })}
            >
              <Text style={[styles.segmentText, rule.mode === mode && styles.segmentTextActive]}>
                {mode === 'manual' ? 'Manual' : 'Auto'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Auto Selection</Text>
        <Text style={styles.helper}>Choose which post types can enter the auto-boost pool. The system will not boost all of them at the same time.</Text>
        <View style={styles.platformGrid}>
          {AUTO_BOOST_PLATFORMS.map(platform => {
            const active = Boolean(rule.autoBoostPlatforms?.includes(platform.key));
            return (
              <TouchableOpacity
                key={platform.key}
                style={[styles.platformChip, active && styles.platformChipActive]}
                onPress={() => toggleAutoBoostPlatform(platform.key)}
              >
                <Ionicons
                  name={active ? 'checkmark-circle-outline' : 'ellipse-outline'}
                  size={17}
                  color={active ? '#ffffff' : colors.subtext}
                />
                <Text style={[styles.platformChipText, active && styles.platformChipTextActive]}>{platform.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.segment}>
          {(['best_performing', 'latest'] as const).map(strategy => (
            <TouchableOpacity
              key={strategy}
              style={[styles.segmentButton, rule.autoBoostStrategy === strategy && styles.segmentButtonActive]}
              onPress={() => updateRule({ autoBoostStrategy: strategy })}
            >
              <Text style={[styles.segmentText, rule.autoBoostStrategy === strategy && styles.segmentTextActive]}>
                {strategy === 'best_performing' ? 'Best post' : 'Latest post'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.label}>Performance window hours</Text>
        <TextInput
          style={styles.input}
          value={String(rule.performanceWindowHours ?? 48)}
          onChangeText={value => updateRule({ performanceWindowHours: Number(value.replace(/[^\d]/g, '')) || 1 })}
          keyboardType="number-pad"
          placeholder="48"
          placeholderTextColor={colors.subtext}
        />
        <Text style={styles.label}>Minimum age before scoring (minutes)</Text>
        <TextInput
          style={styles.input}
          value={String(rule.minCandidateAgeMinutes ?? 15)}
          onChangeText={value => updateRule({ minCandidateAgeMinutes: Number(value.replace(/[^\d]/g, '')) || 0 })}
          keyboardType="number-pad"
          placeholder="15"
          placeholderTextColor={colors.subtext}
        />
        <Text style={styles.label}>Cooldown between boosts (hours)</Text>
        <TextInput
          style={styles.input}
          value={String(rule.autoBoostCooldownHours ?? 6)}
          onChangeText={value => updateRule({ autoBoostCooldownHours: Number(value.replace(/[^\d]/g, '')) || 0 })}
          keyboardType="number-pad"
          placeholder="6"
          placeholderTextColor={colors.subtext}
        />
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Ad Account</Text>
        {displayAccounts.length ? (
          <View style={styles.accountList}>
            {displayAccounts.map(account => (
              <TouchableOpacity
                key={account.id}
                style={[styles.accountRow, rule.adAccountId === account.id && styles.accountRowActive]}
                onPress={() => updateRule({ adAccountId: account.id, currency: account.currency ?? rule.currency })}
              >
                <Ionicons
                  name={rule.adAccountId === account.id ? 'radio-button-on-outline' : 'radio-button-off-outline'}
                  size={18}
                  color={colors.accent}
                />
                <View style={styles.accountText}>
                  <Text style={styles.accountName}>{account.name || account.id}</Text>
                  <Text style={styles.helper}>{[account.id, account.currency, account.timezone_name].filter(Boolean).join(' | ')}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <Text style={styles.warning}>No ad accounts loaded yet. Reconnect Meta with ads permissions, then refresh.</Text>
        )}
        {selectedAccount ? <Text style={styles.helper}>Selected: {selectedAccount.name || selectedAccount.id}</Text> : null}
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Boost Defaults</Text>
        <Text style={styles.label}>WhatsApp number</Text>
        <TextInput
          style={styles.input}
          value={rule.whatsappNumber ?? ''}
          onChangeText={value => updateRule({ whatsappNumber: value })}
          keyboardType="phone-pad"
          placeholder={isShecareAccount ? '+447463010235' : 'Enter client WhatsApp number'}
          placeholderTextColor={colors.subtext}
        />
        <Text style={styles.helper}>
          {isShecareAccount
            ? 'Shecare uses its assigned WhatsApp number. Other accounts must use their own client number.'
            : 'This number belongs to the current client. Shecare’s number is not shared with other accounts.'}
        </Text>
        <Text style={styles.label}>Daily budget USD</Text>
        <TextInput
          style={styles.input}
          value={String(budgetUsdFromRule(rule))}
          onChangeText={value => updateRule({ dailyBudgetUsd: parseUsdBudget(value) })}
          keyboardType="decimal-pad"
          placeholder="5.00"
          placeholderTextColor={colors.subtext}
        />
        <Text style={styles.helper}>Example: enter 5 for $5/day. DottMedia converts this to cents for Meta.</Text>
        <Text style={styles.label}>Duration hours</Text>
        <TextInput
          style={styles.input}
          value={String(rule.durationHours ?? '')}
          onChangeText={value => updateRule({ durationHours: Number(value.replace(/[^\d]/g, '')) || 1 })}
          keyboardType="number-pad"
          placeholder="24"
          placeholderTextColor={colors.subtext}
        />
        <View style={styles.segment}>
          {(['PAUSED', 'ACTIVE'] as const).map(status => (
            <TouchableOpacity
              key={status}
              style={[styles.segmentButton, rule.statusOnCreate === status && styles.segmentButtonActive]}
              onPress={() => updateRule({ statusOnCreate: status })}
            >
              <Text style={[styles.segmentText, rule.statusOnCreate === status && styles.segmentTextActive]}>
                {status === 'PAUSED' ? 'Create paused' : 'Create active'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <TouchableOpacity style={[styles.saveButton, saving && styles.disabled]} onPress={handleSave} disabled={saving}>
        <Ionicons name="save-outline" size={18} color="#ffffff" />
        <Text style={styles.saveText}>{saving ? 'Saving...' : 'Save Boost Settings'}</Text>
      </TouchableOpacity>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Manual Boost</Text>
        <Text style={styles.label}>Facebook post ID</Text>
        <TextInput
          style={styles.input}
          value={manualPostId}
          onChangeText={setManualPostId}
          placeholder="page_post_id or post id"
          placeholderTextColor={colors.subtext}
          autoCapitalize="none"
        />
        <Text style={styles.label}>Ad caption</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={manualCaption}
          onChangeText={setManualCaption}
          placeholder="Warm ad caption for this boost"
          placeholderTextColor={colors.subtext}
          multiline
        />
        <TouchableOpacity style={[styles.saveButton, boosting && styles.disabled]} onPress={handleManualBoost} disabled={boosting}>
          <Ionicons name="megaphone-outline" size={18} color="#ffffff" />
          <Text style={styles.saveText}>{boosting ? 'Creating...' : 'Create Boost'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Recent Boosts</Text>
        {runs.length ? (
          runs.map(run => (
            <View key={run.id ?? run.adId ?? `${run.sourcePostId}-${run.createdAt}`} style={styles.runRow}>
              <Text style={styles.accountName}>{run.status ?? 'unknown'}</Text>
              <Text style={styles.helper}>{run.adId || run.sourcePostId || run.errorMessage || 'No ad ID yet'}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.helper}>No boost runs recorded yet.</Text>
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 14 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { color: colors.text, fontSize: 24, fontWeight: '700' },
  subtitle: { color: colors.subtext, marginTop: 4, lineHeight: 20 },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 14, gap: 12, backgroundColor: colors.backgroundAlt },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  helper: { color: colors.subtext, fontSize: 13, lineHeight: 18 },
  warning: { color: '#f59e0b', fontSize: 13, lineHeight: 18 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  segment: { flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: 'hidden' },
  segmentButton: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  segmentButtonActive: { backgroundColor: colors.accent },
  segmentText: { color: colors.subtext, fontWeight: '600' },
  segmentTextActive: { color: '#ffffff' },
  accountList: { gap: 8 },
  accountRow: { flexDirection: 'row', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10 },
  accountRowActive: { borderColor: colors.accent },
  accountText: { flex: 1 },
  accountName: { color: colors.text, fontWeight: '700' },
  platformGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  platformChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  platformChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  platformChipText: { color: colors.subtext, fontWeight: '600', fontSize: 13 },
  platformChipTextActive: { color: '#ffffff' },
  label: { color: colors.text, fontSize: 13, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    backgroundColor: colors.background,
  },
  textArea: { minHeight: 88, textAlignVertical: 'top' },
  saveButton: {
    minHeight: 46,
    borderRadius: 8,
    backgroundColor: colors.accent,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.6 },
  saveText: { color: '#ffffff', fontWeight: '700' },
  runRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, gap: 3 },
});
