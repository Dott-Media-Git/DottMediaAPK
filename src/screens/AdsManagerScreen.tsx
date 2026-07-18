import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@constants/colors';
import {
  decideMetaAdsApproval,
  fetchAdRuns,
  fetchBoostRule,
  fetchMetaAdsApprovals,
  fetchMetaAdsAudit,
  fetchMetaAdsConnection,
  fetchMetaAdsPolicy,
  fetchMetaAdAccounts,
  requestMetaAdsAction,
  saveBoostRule,
  saveMetaAdsPolicy,
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

  const load = async () => {
    setLoading(true);
    try {
      const [ruleResponse, runsResponse, connectionResponse, policyResponse, approvalsResponse, auditResponse] = await Promise.all([
        fetchBoostRule(),
        fetchAdRuns(20),
        fetchMetaAdsConnection(),
        fetchMetaAdsPolicy(),
        fetchMetaAdsApprovals(30),
        fetchMetaAdsAudit(30),
      ]);
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
      setConnection(connectionResponse.connection);
      setPolicy(policyResponse.policy);
      setApprovals(approvalsResponse.approvals ?? []);
      setAudit(auditResponse.audit ?? []);
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
      await load();
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
      await load();
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
      await load();
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
      setConnectingAds(false);
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
        <View style={styles.headerRow}>
          <View style={styles.flexCopy}>
            <Text style={styles.sectionTitle}>Meta Ads AI Connector</Text>
            <Text style={styles.helper}>Dotti uses Meta MCP when authorized and automatically falls back to the connected Meta Marketing API.</Text>
          </View>
          <View style={[styles.statusBadge, connection?.provider !== 'none' && styles.statusBadgeActive]}>
            <Text style={styles.statusBadgeText}>{connection?.provider === 'meta_mcp' ? 'MCP LIVE' : connection?.provider === 'meta_graph' ? 'GRAPH LIVE' : 'NOT CONNECTED'}</Text>
          </View>
        </View>
        <View style={styles.connectionGrid}>
          <View style={styles.metricBox}>
            <Text style={styles.metricValue}>{connection?.accountCount ?? 0}</Text>
            <Text style={styles.helper}>Ad accounts</Text>
          </View>
          <View style={styles.metricBox}>
            <Text style={styles.metricValue}>{connection?.mcpConnected ? 'Yes' : 'Fallback'}</Text>
            <Text style={styles.helper}>Official MCP</Text>
          </View>
        </View>
        <Text style={styles.helper}>Endpoint: {connection?.endpoint ?? 'https://mcp.facebook.com/ads'}</Text>
        {!connection?.graphConnected ? <Text style={styles.warning}>Connect Facebook in Social Connections with ads permissions, then return here and refresh.</Text> : null}
        <TouchableOpacity style={[styles.connectButton, connectingAds && styles.disabled]} onPress={() => void handleConnectAds()} disabled={connectingAds}>
          <Ionicons name="logo-facebook" size={19} color="#ffffff" />
          <Text style={styles.saveText}>{connectingAds ? 'Opening Meta...' : connection?.graphConnected ? 'Connect Another Ads Account' : 'Connect Meta Ads Account'}</Text>
        </TouchableOpacity>
        <Text style={styles.helper}>You will sign in with Meta, approve Ads access, and then return here to choose an ad account.</Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Safety & Spending Controls</Text>
        <Text style={styles.helper}>Every Dotti write request is checked against these limits and recorded in the audit trail.</Text>
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

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Pending Approvals</Text>
        {approvals.filter(item => item.status === 'pending').length ? approvals.filter(item => item.status === 'pending').map(item => (
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
        )) : <Text style={styles.helper}>No actions are waiting for approval.</Text>}
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
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 14 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
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
  connectionGrid: { flexDirection: 'row', gap: 10 },
  metricBox: { flex: 1, borderRadius: 8, padding: 12, backgroundColor: colors.cardOverlay, borderWidth: 1, borderColor: colors.border },
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
