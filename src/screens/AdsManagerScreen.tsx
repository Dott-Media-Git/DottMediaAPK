import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@constants/colors';
import {
  decideMetaAdsApproval,
  fetchAdPerformance,
  fetchBoostRule,
  fetchMetaAdsApprovals,
  fetchMetaAdsAudit,
  fetchMetaAdsConnection,
  fetchMetaAdsPolicy,
  fetchMetaAdAccounts,
  requestMetaAdsAction,
  saveBoostRule,
  saveMetaAdsPolicy,
  type AdPerformance,
  type AdPerformanceRow,
  type BoostRule,
  type MetaAdAccount,
  type MetaAdsApproval,
  type MetaAdsAuditEntry,
  type MetaAdsConnection,
  type MetaAdsPolicy,
} from '@services/metaAds';
import { useAuth } from '@context/AuthContext';
import { fetchMetaConnectUrl } from '@services/social';

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

const adsTabs = [
  { key: 'performance', title: 'Performance' },
  { key: 'approvals', title: 'Approvals' },
  { key: 'setup', title: 'Ad setup' },
] as const;

type AdsTab = typeof adsTabs[number]['key'];

export const AdsManagerScreen: React.FC = () => {
  const { state } = useAuth();
  return <AdsManagerContent key={state.user?.uid ?? 'signed-out'} />;
};

const AdsManagerContent: React.FC = () => {
  const { state } = useAuth();
  const isShecareAccount =
    state.user?.uid === SHECARE_USER_ID || String(state.user?.email ?? '').toLowerCase() === SHECARE_EMAIL;
  const defaultWhatsapp = isShecareAccount ? DEFAULT_WHATSAPP : '';
  const [tab, setTab] = useState<AdsTab>('performance');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [setupError, setSetupError] = useState('');
  const [approvalsError, setApprovalsError] = useState('');
  const [approvalsLoading, setApprovalsLoading] = useState(false);
  const [policyLoaded, setPolicyLoaded] = useState(false);
  const [boostLoaded, setBoostLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [boosting, setBoosting] = useState(false);
  const [accounts, setAccounts] = useState<MetaAdAccount[]>([]);
  const [connection, setConnection] = useState<MetaAdsConnection | null>(null);
  const [approvals, setApprovals] = useState<MetaAdsApproval[]>([]);
  const [audit, setAudit] = useState<MetaAdsAuditEntry[]>([]);
  const [policySaving, setPolicySaving] = useState(false);
  const [connectingAds, setConnectingAds] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState<string | null>(null);
  const [policy, setPolicy] = useState<MetaAdsPolicy>({
    dailySpendLimitUsd: 100,
    perActionLimitUsd: 25,
    requireApproval: true,
    allowActivation: false,
    allowBudgetChanges: true,
  });
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

  const load = useCallback(async () => {
    setLoading(true);
    setSetupError('');
    const [ruleResult, accountResult, connectionResult, policyResult] = await Promise.allSettled([
      fetchBoostRule(), fetchMetaAdAccounts(), fetchMetaAdsConnection(), fetchMetaAdsPolicy(),
    ]);
    if (ruleResult.status === 'fulfilled') {
      const saved = ruleResult.value.rule;
      setRule(current => ({
        ...current,
        ...saved,
        adAccountId: saved?.adAccountId || (isShecareAccount ? SHECARE_AD_ACCOUNT_ID : undefined),
        currency: saved?.currency || (isShecareAccount ? 'USD' : undefined),
        whatsappNumber: saved?.whatsappNumber || defaultWhatsapp,
        dailyBudgetUsd: budgetUsdFromRule(saved ?? current),
        autoBoostPlatforms: saved?.autoBoostPlatforms?.length ? saved.autoBoostPlatforms : current.autoBoostPlatforms,
      }));
      setBoostLoaded(true);
    }
    if (accountResult.status === 'fulfilled') setAccounts(accountResult.value.accounts ?? []);
    if (connectionResult.status === 'fulfilled') setConnection(connectionResult.value.connection ?? null);
    if (policyResult.status === 'fulfilled') {
      setPolicy(policyResult.value.policy);
      setPolicyLoaded(true);
    }
    if ([ruleResult, accountResult, connectionResult, policyResult].some(result => result.status === 'rejected')) {
      setSetupError('Some ad settings could not be loaded. Refresh to try again.');
    }
    setLoaded(true);
    setLoading(false);
  }, [defaultWhatsapp, isShecareAccount]);

  const loadApprovals = useCallback(async () => {
    setApprovalsLoading(true);
    const [approvalResult, auditResult] = await Promise.allSettled([fetchMetaAdsApprovals(30), fetchMetaAdsAudit(30)]);
    setApprovalsError(approvalResult.status === 'rejected' || auditResult.status === 'rejected'
      ? 'Some approval history could not be loaded. Refresh to try again.' : '');
    if (approvalResult.status === 'fulfilled') setApprovals(approvalResult.value.approvals ?? []);
    if (auditResult.status === 'fulfilled') setAudit(auditResult.value.audit ?? []);
    setApprovalsLoading(false);
  }, []);

  useEffect(() => {
    if (tab === 'setup' && !loaded) void load();
    if (tab === 'approvals') void loadApprovals();
  }, [tab, loaded, load, loadApprovals]);

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
      await requestMetaAdsAction('create_campaign_draft', {
        platform: 'facebook',
        postId,
        caption: manualCaption.trim(),
        adAccountId: rule.adAccountId,
        dailyBudgetUsd: budgetUsdFromRule(rule),
        durationHours: rule.durationHours,
        whatsappNumber: rule.whatsappNumber,
      }, 'ads_manager');
      setManualPostId('');
      setManualCaption('');
      setTab('approvals');
      Alert.alert('Ads Manager', 'Paused campaign draft sent for approval.');
    } catch (error: any) {
      Alert.alert('Ads Manager', error.message ?? 'Failed to boost post');
    } finally {
      setBoosting(false);
    }
  };

  const handleSavePolicy = async () => {
    setPolicySaving(true);
    try {
      const response = await saveMetaAdsPolicy(policy);
      setPolicy(response.policy);
      Alert.alert('Ads safety', 'Spending and approval controls saved.');
    } catch (error: any) {
      Alert.alert('Ads safety', error.message ?? 'Failed to save controls');
    } finally {
      setPolicySaving(false);
    }
  };

  const handleApproval = async (id: string, decision: 'approve' | 'reject') => {
    setApprovalBusy(id);
    try {
      await decideMetaAdsApproval(id, decision);
      await loadApprovals();
      Alert.alert('Ads approval', decision === 'approve' ? 'Approved and executed.' : 'Request rejected.');
    } catch (error: any) {
      Alert.alert('Ads approval', error.message ?? 'Failed to process approval');
    } finally {
      setApprovalBusy(null);
    }
  };

  const handleConnectAds = async () => {
    setConnectingAds(true);
    try {
      const response = await fetchMetaConnectUrl('ads');
      if (!response.url) throw new Error('Meta did not return an authorization URL');
      await Linking.openURL(response.url);
    } catch (error: any) {
      Alert.alert('Connect Meta Ads', error.message ?? 'Unable to start Meta Ads authorization');
    } finally {
      setConnectingAds(false);
    }
  };

  const pendingApprovals = approvals.filter(item => item.status === 'pending');

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.heading}>
        <Text style={styles.title}>Ads Manager</Text>
        <Text style={styles.subtitle}>Track Meta ad results and manage your boosts.</Text>
      </View>
      <View style={styles.segment}>
        {adsTabs.map(item => (
          <TouchableOpacity key={item.key} accessibilityRole="tab" accessibilityState={{ selected: tab === item.key }}
            onPress={() => setTab(item.key)} style={[styles.segmentButton, tab === item.key && styles.segmentButtonActive]}>
            <Text style={[styles.segmentText, tab === item.key && styles.segmentTextActive]}>{item.title}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'performance' && <AdsPerformancePanel onSetup={() => setTab('setup')} />}

      {tab === 'setup' && <>
        <View style={styles.panel}>
          <View style={styles.headerRow}>
            <View style={styles.flexCopy}>
              <Text style={styles.sectionTitle}>Meta ad accounts</Text>
              <Text style={styles.helper}>{connection?.graphConnected
                ? `${connection.accountCount} ad accounts available through Meta`
                : 'Sign in to Meta to view your ad accounts.'}</Text>
            </View>
            <RefreshButton loading={loading} onPress={() => void load()} />
          </View>
          {setupError ? <Text accessibilityRole="alert" style={styles.warning}>{setupError}</Text> : null}
          <TouchableOpacity accessibilityRole="button" style={[styles.connectButton, connectingAds && styles.disabled]}
            onPress={() => void handleConnectAds()} disabled={connectingAds}>
            <Ionicons name="logo-facebook" size={19} color="#ffffff" />
            <Text style={styles.saveText}>{connectingAds ? 'Opening Meta…' : connection?.graphConnected ? 'Manage Meta connection' : 'Connect Meta Ads'}</Text>
          </TouchableOpacity>
        </View>
        {policyLoaded && (
          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Safety & Spending Controls</Text>
            <Text style={styles.helper}>These limits apply to ad actions submitted for approval in Ads Manager.</Text>
            <Text style={styles.label}>Maximum daily spend USD</Text>
            <TextInput
              style={styles.input}
              value={String(policy.dailySpendLimitUsd)}
              onChangeText={value => setPolicy(current => ({ ...current, dailySpendLimitUsd: parseUsdBudget(value) }))}
              keyboardType="decimal-pad"
            />
            <Text style={styles.label}>Maximum spend per action USD</Text>
            <TextInput
              style={styles.input}
              value={String(policy.perActionLimitUsd)}
              onChangeText={value => setPolicy(current => ({ ...current, perActionLimitUsd: parseUsdBudget(value) }))}
              keyboardType="decimal-pad"
            />
            <View style={styles.switchRow}>
              <View style={styles.flexCopy}><Text style={styles.accountName}>Require approval</Text><Text style={styles.helper}>Keep all ad changes in the approval queue.</Text></View>
              <Switch value={policy.requireApproval} onValueChange={value => setPolicy(current => ({ ...current, requireApproval: value }))} />
            </View>
            <View style={styles.switchRow}>
              <View style={styles.flexCopy}><Text style={styles.accountName}>Allow ad activation</Text><Text style={styles.helper}>Dotti may request publishing after your confirmation.</Text></View>
              <Switch value={policy.allowActivation} onValueChange={value => setPolicy(current => ({ ...current, allowActivation: value }))} />
            </View>
            <View style={styles.switchRow}>
              <View style={styles.flexCopy}><Text style={styles.accountName}>Allow budget changes</Text><Text style={styles.helper}>Budget edits still require confirmation.</Text></View>
              <Switch value={policy.allowBudgetChanges} onValueChange={value => setPolicy(current => ({ ...current, allowBudgetChanges: value }))} />
            </View>
            <TouchableOpacity style={[styles.saveButton, policySaving && styles.disabled]} onPress={handleSavePolicy} disabled={policySaving}>
              <Ionicons name="shield-checkmark-outline" size={18} color="#ffffff" />
              <Text style={styles.saveText}>{policySaving ? 'Saving...' : 'Save Safety Controls'}</Text>
            </TouchableOpacity>
          </View>

        )}
        {boostLoaded && <>
          <View style={styles.panel}>
            <View style={styles.switchRow}>
              <View>
                <Text style={styles.sectionTitle}>Auto Boost</Text>
                <Text style={styles.helper}>Choose a rule for boosting eligible posts automatically.</Text>
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
            <Text style={styles.helper}>Choose which post types can enter the auto-boost pool. Dotti selects one post per boost.</Text>
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

            <Text style={styles.label}>Daily budget USD</Text>
            <TextInput
              style={styles.input}
              value={String(budgetUsdFromRule(rule))}
              onChangeText={value => updateRule({ dailyBudgetUsd: parseUsdBudget(value) })}
              keyboardType="decimal-pad"
              placeholder="5.00"
              placeholderTextColor={colors.subtext}
            />

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
              <Text style={styles.saveText}>{boosting ? 'Creating…' : 'Send draft for approval'}</Text>
            </TouchableOpacity>
          </View>

        </>}
      </>}

      {tab === 'approvals' && <>
        <View style={styles.panel}>
          <View style={styles.headerRow}>
            <Text style={styles.sectionTitle}>Pending approvals</Text>
            <RefreshButton loading={approvalsLoading} onPress={() => void loadApprovals()} />
          </View>
          {approvalsError ? <Text accessibilityRole="alert" style={styles.warning}>{approvalsError}</Text> : null}
          {pendingApprovals.length ? pendingApprovals.map(item => (
            <View key={item.id} style={styles.approvalCard}>
              <View style={styles.flexCopy}>
                <Text style={styles.accountName}>{item.action.replace(/_/g, ' ')}</Text>
                <Text style={styles.helper}>{item.payload?.adId || item.payload?.postId || item.payload?.adSetId || 'Dotti Ads request'} · {item.source}</Text>
                {item.payload?.dailyBudgetUsd ? <Text style={styles.helper}>Budget: ${Number(item.payload.dailyBudgetUsd).toFixed(2)}/day</Text> : null}
              </View>
              <View style={styles.approvalActions}>
                <TouchableOpacity style={styles.rejectButton} disabled={approvalBusy === item.id} onPress={() => void handleApproval(item.id, 'reject')}>
                  <Text style={styles.rejectText}>Reject</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.approveButton} disabled={approvalBusy === item.id} onPress={() => void handleApproval(item.id, 'approve')}>
                  <Text style={styles.saveText}>{approvalBusy === item.id ? 'Working...' : 'Approve'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )) : approvalsLoading || approvalsError ? null : <Text style={styles.helper}>No actions are waiting for approval.</Text>}
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Ads Activity Log</Text>
          {audit.length ? audit.slice(0, 20).map(entry => (
            <View key={entry.id} style={styles.runRow}>
              <View style={styles.flexCopy}>
                <Text style={styles.accountName}>{entry.action.replace(/_/g, ' ')}</Text>
                <Text style={styles.helper}>{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : 'Just now'}</Text>
              </View>
              <Text style={[styles.auditStatus, entry.status === 'completed' || entry.status === 'success' ? styles.auditSuccess : null]}>{entry.status}</Text>
            </View>
          )) : <Text style={styles.helper}>No controlled ad actions recorded yet.</Text>}
        </View>
      </>}
    </ScrollView>
  );
};

const RefreshButton = ({ loading, onPress }: { loading: boolean; onPress: () => void }) => (
  <TouchableOpacity accessibilityLabel="Refresh" accessibilityRole="button" accessibilityState={{ busy: loading }}
    style={styles.iconButton} onPress={onPress} disabled={loading}>
    {loading ? <ActivityIndicator size="small" color={colors.accent} />
      : <Ionicons name="refresh-outline" size={20} color={colors.text} />}
  </TouchableOpacity>
);

const channelFilters = [
  { key: 'all', label: 'All ads' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
] as const;
type ChannelFilter = typeof channelFilters[number]['key'];

const adStatusLabels: Record<string, string> = {
  ACTIVE: 'Active',
  SCHEDULED: 'Scheduled',
  COMPLETED: 'Ended',
  CAMPAIGN_PAUSED: 'Campaign paused',
  ADSET_PAUSED: 'Ad set paused',
  IN_PROCESS: 'Processing',
  PENDING_REVIEW: 'In review',
  PENDING_BILLING_INFO: 'Billing required',
  DISAPPROVED: 'Disapproved',
  WITH_ISSUES: 'Needs attention',
};

const adStatus = (row: AdPerformanceRow) => {
  const status = (row.effectiveStatus || row.status)?.toUpperCase();
  return status ? adStatusLabels[status] ?? status.toLowerCase().replace(/_/g, ' ') : 'Status unavailable';
};

const formatCount = (value: number) => value.toLocaleString();
const formatSpend = (value: number, currency: AdPerformance['currency']) =>
  currency && /^[A-Z]{3}$/.test(currency)
    ? value.toLocaleString(undefined, { style: 'currency', currency, currencyDisplay: 'code' })
    : '—';

function reportDate(date: string, year = false) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: year ? 'numeric' : undefined, timeZone: 'UTC',
  });
}

const AdsPerformancePanel = ({ onSetup }: { onSetup: () => void }) => {
  const [report, setReport] = useState<AdPerformance | null>(null);
  const [accountId, setAccountId] = useState<string>();
  const [channel, setChannel] = useState<ChannelFilter>('all');
  const [loading, setLoading] = useState(true);
  const [refreshError, setRefreshError] = useState(false);
  const request = useRef(0);

  const load = useCallback(async (id?: string) => {
    const currentRequest = ++request.current;
    setLoading(true);
    setRefreshError(false);
    try {
      const { performance } = await fetchAdPerformance(30, id);
      if (currentRequest === request.current) setReport(performance);
    } catch {
      if (currentRequest === request.current) setRefreshError(true);
    } finally {
      if (currentRequest === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(accountId);
    return () => { request.current += 1; };
  }, [accountId, load]);

  const reportDisplay = report && (!accountId || report.accountId === accountId) ? report : null;
  const accounts = report?.availableAccounts ?? [];
  const dateRange = reportDisplay?.dateRange;
  const summary = reportDisplay?.summary;
  const reported = reportDisplay?.reportingStatus === 'reported';
  const rows = reportDisplay?.rows ?? [];
  const selectableChannels = channelFilters.filter(filter =>
    filter.key === 'all' || rows.some(row => row.platform === filter.key));
  const visibleChannel = selectableChannels.some(filter => filter.key === channel) ? channel : 'all';
  const visibleRows = rows.filter(row => row.adId && (visibleChannel === 'all' || row.platform === visibleChannel))
    .sort((left, right) => {
      const priority = (row: AdPerformanceRow) => row.effectiveStatus === 'ACTIVE' ? 2 : row.effectiveStatus === 'SCHEDULED' ? 1 : 0;
      return priority(right) - priority(left) || (Date.parse(right.startsAt ?? right.createdAt ?? '') || 0) - (Date.parse(left.startsAt ?? left.createdAt ?? '') || 0);
    });
  const metaAccountId = /^act_(\d+)$/.exec(reportDisplay?.accountId ?? '')?.[1];
  const connectionStatus = report?.connectionStatus;
  const metrics = summary ? [
    { label: 'Spend', value: formatSpend(summary.spend, reportDisplay?.currency ?? null) },
    { label: 'Impressions', value: formatCount(summary.impressions) },
    { label: 'Reach', value: formatCount(summary.reach) },
    { label: 'Link clicks', value: formatCount(summary.inlineLinkClicks) },
    { label: 'Clicks (all)', value: formatCount(summary.clicks) },
    { label: 'All-click CTR', value: `${summary.ctr.toFixed(2)}%` },
  ] : [];

  return <>
    <View style={[styles.panel, styles.reportPanel]}>
      <View style={styles.headerRow}>
        <View style={styles.flexCopy}>
          <Text style={styles.sectionTitle}>{reportDisplay?.accountName || 'Meta ad performance'}</Text>
          <Text style={styles.helper}>{dateRange
            ? `${reportDate(dateRange.since)} – ${reportDate(dateRange.until, true)} · 30 days`
            : 'Last 30 days'}</Text>
        </View>
        <RefreshButton loading={loading} onPress={() => void load(accountId)} />
      </View>

      {accounts.length > 1 || (connectionStatus === 'choose_account' && accounts.length > 0) ? (
        <View style={styles.filterRow}>
          {accounts.map(account => (
            <TouchableOpacity key={account.id} accessibilityRole="button" style={[
              styles.platformChip, reportDisplay?.accountId === account.id && styles.platformChipActive,
            ]} accessibilityState={{ selected: reportDisplay?.accountId === account.id }}
              onPress={() => { setChannel('all'); setAccountId(account.id); }}>
              <Text style={[styles.platformChipText, reportDisplay?.accountId === account.id && styles.platformChipTextActive]}>
                {account.name || account.id}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {refreshError ? <Text accessibilityRole="alert" style={styles.warning}>{reportDisplay
        ? 'Refresh failed. Showing the most recent results loaded.' : 'Could not load Meta results. Try refreshing.'}</Text> : null}
      {loading && !reportDisplay ? <Text style={styles.helper}>Checking Meta…</Text> : null}
      {connectionStatus === 'not_connected' ? (
        <TouchableOpacity accessibilityRole="button" style={styles.secondaryButton} onPress={onSetup}>
          <Text style={styles.accountName}>Connect a Meta ad account</Text>
          <Ionicons name="arrow-forward-outline" size={16} color={colors.text} />
        </TouchableOpacity>
      ) : null}
      {!loading && connectionStatus === 'choose_account' ? <Text style={styles.helper}>Choose the ad account you want to view.</Text> : null}
      {!loading && connectionStatus === 'unavailable' ? <Text style={styles.warning}>Meta ad accounts are unavailable. Check your connection in Ad setup.</Text> : null}

      {metaAccountId && (
        <>
          <View style={styles.metricsGrid}>
            {metrics.map(metric => (
              <View key={metric.label} style={styles.metricBox}>
                <Text style={styles.helper}>{metric.label}</Text>
                <Text style={styles.metricValue}>{reported ? metric.value : '—'}</Text>
              </View>
            ))}
          </View>
          {reportDisplay?.reportingStatus === 'pending' ?
            <Text style={styles.helper}>Meta has no delivery results for this period yet.</Text> : null}
          {reportDisplay?.reportingStatus === 'unavailable' ?
            <Text style={styles.warning}>Meta delivery results are temporarily unavailable.</Text> : null}
          <View style={styles.reportFooter}>
            <Text style={styles.helper}>{reportDisplay?.generatedAt && `Checked ${new Date(reportDisplay.generatedAt).toLocaleString()}`}</Text>
            <TouchableOpacity accessibilityRole="link" style={styles.secondaryButton} onPress={() => {
              void Linking.openURL(`https://adsmanager.facebook.com/adsmanager/manage/ads?act=${metaAccountId}`)
                .catch(() => Alert.alert('Ads Manager', 'Could not open Meta Ads Manager.'));
            }}>
              <Text style={styles.accountName}>Open Meta Ads Manager</Text>
              <Ionicons name="open-outline" size={16} color={colors.text} />
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>

    {metaAccountId && (
      <View style={styles.panel}>
        <View>
          <Text style={styles.sectionTitle}>Recent ads</Text>
          <Text style={styles.helper}>Delivery is measured by impressions reported by Meta.</Text>
        </View>
        {selectableChannels.length > 1 ? (
          <View style={styles.filterRow}>
            {selectableChannels.map(filter => (
              <TouchableOpacity key={filter.key} accessibilityRole="button"
                accessibilityState={{ selected: visibleChannel === filter.key }}
                style={[styles.platformChip, visibleChannel === filter.key && styles.platformChipActive]}
                onPress={() => setChannel(filter.key)}>
                <Text style={[styles.platformChipText, visibleChannel === filter.key && styles.platformChipTextActive]}>{filter.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
        {reportDisplay?.adStatusesAvailable === false ?
          <Text style={styles.warning}>Some ad statuses are unavailable.</Text> : null}
        {visibleRows.map(row => {
          const channelLabel = channelFilters.find(filter => filter.key !== 'all' && filter.key === row.platform)?.label;
          const isReported = row.reportingStatus === 'reported';
          return (
            <View key={row.id} style={styles.adCard}>
              <View style={styles.headerRow}>
                <View style={styles.flexCopy}>
                  <Text style={styles.accountName}>{row.name?.replace(/\s*•\s*(facebook|instagram)$/i, '') || channelLabel || `Ad ${row.adId}`}</Text>
                  {channelLabel || row.startsAt || row.createdAt ? <Text style={styles.helper}>{[
                    channelLabel,
                    row.startsAt || row.createdAt
                      ? new Date((row.startsAt || row.createdAt) as string).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                      : null,
                  ].filter(Boolean).join(' · ')}</Text> : null}
                </View>
                <View style={[styles.statusBadge, row.effectiveStatus === 'ACTIVE' && styles.statusBadgeActive]}>
                  <Text style={styles.statusBadgeText}>{adStatus(row)}</Text>
                </View>
              </View>
              {isReported ? (
                <View style={styles.adMetrics}>
                  <Text style={styles.helper}><Text style={styles.accountName}>{formatCount(row.impressions)}</Text> impressions</Text>
                  <Text style={styles.helper}><Text style={styles.accountName}>{formatCount(row.inlineLinkClicks)}</Text> link clicks</Text>
                  <Text style={styles.helper}><Text style={styles.accountName}>{formatSpend(row.spend, reportDisplay?.currency ?? null)}</Text> spent</Text>
                </View>
              ) : <Text style={styles.helper}>{row.reportingStatus === 'pending' ? 'Awaiting delivery data' : 'Delivery data unavailable'}</Text>}
            </View>
          );
        })}
        {!visibleRows.length && reportDisplay?.adStatusesAvailable !== false ? <Text style={styles.helper}>No ads to show.</Text> : null}
      </View>
    )}
  </>;
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { width: '100%', maxWidth: 1080, alignSelf: 'center', padding: 16, gap: 16, paddingBottom: 32 },
  heading: { paddingVertical: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  flexCopy: { flex: 1, minWidth: 0 },
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
  statusBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.cardOverlay, borderWidth: 1, borderColor: colors.border },
  statusBadgeActive: { borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.12)' },
  statusBadgeText: { color: colors.text, fontSize: 10, fontWeight: '800' },
  metricBox: { flexBasis: '28%', minWidth: 120, flexGrow: 1, borderRadius: 10, padding: 12, gap: 6, backgroundColor: colors.cardOverlay, borderWidth: 1, borderColor: colors.border },
  reportPanel: { gap: 16, borderColor: colors.cardBorderStart },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reportFooter: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  secondaryButton: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 9, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  adCard: { backgroundColor: colors.cardOverlay, padding: 12, borderRadius: 10, gap: 8 },
  adMetrics: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 20, rowGap: 4 },
  metricValue: { color: colors.text, fontSize: 20, fontWeight: '800', marginBottom: 2 },
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
  approvalCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, gap: 12, backgroundColor: colors.cardOverlay },
  approvalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  rejectButton: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#ef4444' },
  rejectText: { color: '#ef4444', fontWeight: '700' },
  approveButton: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, backgroundColor: colors.accent },
  connectButton: { minHeight: 46, borderRadius: 9, backgroundColor: '#1877F2', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 16 },
  auditStatus: { color: colors.subtext, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  auditSuccess: { color: '#22c55e' },
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
