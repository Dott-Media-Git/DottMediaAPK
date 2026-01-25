import React, { useEffect, useState } from 'react';
import { Alert, Linking, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { doc, getDoc } from 'firebase/firestore';
import { DMButton } from '@components/DMButton';
import { colors } from '@constants/colors';

import { useAuth } from '@context/AuthContext';
import { isFirebaseEnabled, realtimeDb } from '@services/firebase';
import { fetchSocialStatus, saveSocialCredentials, type SocialConnectionStatus } from '@services/social';
import { useI18n } from '@context/I18nContext';
import {
  fetchYouTubeConfig,
  fetchYouTubeStatus,
  fetchYouTubeConnectUrl,
  pasteYouTubeToken,
  updateYouTubeDefaults,
  revealYouTubeToken,
  disconnectYouTube,
  type YouTubeConfig,
  type YouTubeStatus
} from '@services/youtubeIntegration';
import {
  fetchTikTokConfig,
  fetchTikTokStatus,
  fetchTikTokConnectUrl,
  pasteTikTokToken,
  revealTikTokToken,
  disconnectTikTok,
  type TikTokConfig,
  type TikTokStatus
} from '@services/tiktokIntegration';

type ManualPlatform = 'facebook' | 'linkedin' | 'instagram' | 'twitter';
type PlatformKey = ManualPlatform | 'tiktok' | 'youtube';

const PLATFORM_ORDER: PlatformKey[] = ['facebook', 'linkedin', 'instagram', 'twitter', 'tiktok', 'youtube'];
const PLATFORM_LABELS: Record<PlatformKey, string> = {
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  twitter: 'X / Twitter',
  tiktok: 'TikTok',
  youtube: 'YouTube'
};

const MANUAL_FIELDS: Record<ManualPlatform, Array<{ key: string; label: string; placeholder: string }>> = {
  facebook: [
    { key: 'accessToken', label: 'Access token', placeholder: 'Paste Facebook access token' },
    { key: 'pageId', label: 'Page ID', placeholder: 'Paste Facebook page ID' }
  ],
  linkedin: [
    { key: 'accessToken', label: 'Access token', placeholder: 'Paste LinkedIn access token' },
    { key: 'urn', label: 'Organization URN', placeholder: 'urn:li:organization:123456' }
  ],
  instagram: [
    { key: 'accessToken', label: 'Access token', placeholder: 'Paste Instagram access token' },
    { key: 'accountId', label: 'Account ID', placeholder: 'Paste Instagram account ID' }
  ],
  twitter: [
    { key: 'accessToken', label: 'Access token', placeholder: 'Paste X access token' },
    { key: 'accessSecret', label: 'Access secret', placeholder: 'Paste X access secret' }
  ]
};

const EMPTY_DRAFTS: Record<ManualPlatform, Record<string, string>> = {
  facebook: { accessToken: '', pageId: '' },
  linkedin: { accessToken: '', urn: '' },
  instagram: { accessToken: '', accountId: '' },
  twitter: { accessToken: '', accessSecret: '' }
};

export const AccountIntegrationsScreen: React.FC = () => {
  const { state, orgId } = useAuth();
  const { t } = useI18n();
  const [socialAccounts, setSocialAccounts] = useState<Record<string, any>>({});
  const [socialStatus, setSocialStatus] = useState<SocialConnectionStatus | null>(null);
  const [expandedPlatform, setExpandedPlatform] = useState<PlatformKey | null>(null);
  const [savingPlatform, setSavingPlatform] = useState<PlatformKey | null>(null);
  const [drafts, setDrafts] = useState<Record<ManualPlatform, Record<string, string>>>(EMPTY_DRAFTS);
  const [youtubeConfig, setYouTubeConfig] = useState<YouTubeConfig | null>(null);
  const [youtubeStatus, setYouTubeStatus] = useState<YouTubeStatus | null>(null);
  const [youtubeLoading, setYouTubeLoading] = useState(false);
  const [youtubeTokenInput, setYouTubeTokenInput] = useState('');
  const [privacyStatus, setPrivacyStatus] = useState<'private' | 'public' | 'unlisted'>('unlisted');
  const [revealToken, setRevealToken] = useState<string | null>(null);
  const [showRevealModal, setShowRevealModal] = useState(false);
  const [tiktokConfig, setTikTokConfig] = useState<TikTokConfig | null>(null);
  const [tiktokStatus, setTikTokStatus] = useState<TikTokStatus | null>(null);
  const [tiktokLoading, setTikTokLoading] = useState(false);
  const [tiktokTokenInput, setTikTokTokenInput] = useState('');
  const [tiktokRevealToken, setTikTokRevealToken] = useState<string | null>(null);
  const [showTikTokRevealModal, setShowTikTokRevealModal] = useState(false);

  const loadYouTube = async () => {
    setYouTubeLoading(true);
    try {
      const [configResponse, statusResponse] = await Promise.all([
        fetchYouTubeConfig(orgId),
        fetchYouTubeStatus(orgId)
      ]);
      setYouTubeConfig(configResponse as YouTubeConfig);
      setYouTubeStatus((statusResponse as { status?: YouTubeStatus }).status ?? null);
      const nextPrivacy = (statusResponse as { status?: YouTubeStatus }).status?.privacyStatus;
      if (nextPrivacy) setPrivacyStatus(nextPrivacy);
    } catch (error: any) {
      Alert.alert(t('Error'), error.message ?? t('Failed to load YouTube status'));
    } finally {
      setYouTubeLoading(false);
    }
  };

  const loadTikTok = async () => {
    setTikTokLoading(true);
    try {
      const [configResponse, statusResponse] = await Promise.all([
        fetchTikTokConfig(orgId),
        fetchTikTokStatus(orgId)
      ]);
      setTikTokConfig(configResponse as TikTokConfig);
      setTikTokStatus((statusResponse as { status?: TikTokStatus }).status ?? null);
    } catch (error: any) {
      Alert.alert(t('Error'), error.message ?? t('Failed to load TikTok status'));
    } finally {
      setTikTokLoading(false);
    }
  };

  const loadSocialAccounts = async () => {
    if (!state.user || !isFirebaseEnabled || !realtimeDb) {
      setSocialAccounts({});
      return;
    }
    try {
      const snapshot = await getDoc(doc(realtimeDb, 'users', state.user.uid));
      const data = snapshot.data() as { socialAccounts?: Record<string, any> } | undefined;
      setSocialAccounts(data?.socialAccounts ?? {});
    } catch (error) {
      console.warn('Failed to load social accounts', error);
      setSocialAccounts({});
    }
  };

  const loadSocialStatus = async () => {
    if (!state.user) {
      setSocialStatus(null);
      return;
    }
    try {
      const response = await fetchSocialStatus();
      setSocialStatus(response.status ?? null);
    } catch (error) {
      console.warn('Failed to load social status', error);
    }
  };

  useEffect(() => {
    void loadYouTube();
    void loadTikTok();
  }, [orgId]);

  useEffect(() => {
    void loadSocialAccounts();
    void loadSocialStatus();
  }, [state.user?.uid]);

  const handleConnect = async () => {
    try {
      const response = await fetchYouTubeConnectUrl(orgId);
      const url = response?.url as string | undefined;
      if (!url) {
        Alert.alert(t('Error'), t('Missing connect URL'));
        return;
      }
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        Alert.alert(t('Error'), t('Unable to open the YouTube connect URL.'));
        return;
      }
      await Linking.openURL(url);
    } catch (error: any) {
      Alert.alert(t('Error'), error.message ?? t('Unable to open the YouTube connect URL.'));
    }
  };

  const handlePasteToken = async () => {
    const trimmed = youtubeTokenInput.trim();
    if (!trimmed) {
      Alert.alert(t('Error'), t('Paste a refresh token or JSON payload.'));
      return;
    }
    setYouTubeLoading(true);
    try {
      const payload = trimmed.startsWith('{')
        ? { json: trimmed, privacyStatus }
        : { token: trimmed, privacyStatus };
      await pasteYouTubeToken(payload, orgId);
      setYouTubeTokenInput('');
      await loadYouTube();
      Alert.alert(t('Success'), t('YouTube token saved.'));
    } catch (error: any) {
      Alert.alert(t('Error'), error.message ?? t('Failed to save YouTube token'));
    } finally {
      setYouTubeLoading(false);
    }
  };

  const handleDefaults = async () => {
    setYouTubeLoading(true);
    try {
      await updateYouTubeDefaults({ privacyStatus }, orgId);
      await loadYouTube();
      Alert.alert(t('Success'), t('Defaults updated.'));
    } catch (error: any) {
      Alert.alert(t('Error'), error.message ?? t('Failed to update defaults'));
    } finally {
      setYouTubeLoading(false);
    }
  };

  const handleReveal = async () => {
    setYouTubeLoading(true);
    try {
      const result = await revealYouTubeToken(orgId);
      if (result?.revealed && result?.refreshToken) {
        setRevealToken(result.refreshToken as string);
        setShowRevealModal(true);
        await loadYouTube();
      } else {
        Alert.alert(t('Notice'), t('Refresh token already revealed or unavailable.'));
      }
    } catch (error: any) {
      Alert.alert(t('Error'), error.message ?? t('Failed to reveal token'));
    } finally {
      setYouTubeLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setYouTubeLoading(true);
    try {
      await disconnectYouTube(orgId);
      await loadYouTube();
      Alert.alert(t('Success'), t('YouTube disconnected.'));
    } catch (error: any) {
      Alert.alert(t('Error'), error.message ?? t('Failed to disconnect YouTube'));
    } finally {
      setYouTubeLoading(false);
    }
  };

  const handleTikTokConnect = async () => {
    try {
      const response = await fetchTikTokConnectUrl(orgId);
      const url = response?.url as string | undefined;
      if (!url) {
        Alert.alert(t('Error'), t('Missing connect URL'));
        return;
      }
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        Alert.alert(t('Error'), t('Unable to open the TikTok connect URL.'));
        return;
      }
      await Linking.openURL(url);
    } catch (error: any) {
      Alert.alert(t('Error'), error.message ?? t('Unable to open the TikTok connect URL.'));
    }
  };

  const handleTikTokPaste = async () => {
    const trimmed = tiktokTokenInput.trim();
    if (!trimmed) {
      Alert.alert(t('Error'), t('Paste an access token or JSON payload.'));
      return;
    }
    setTikTokLoading(true);
    try {
      const payload = trimmed.startsWith('{')
        ? { json: trimmed }
        : { accessToken: trimmed };
      await pasteTikTokToken(payload, orgId);
      setTikTokTokenInput('');
      await loadTikTok();
      Alert.alert(t('Success'), t('TikTok token saved.'));
    } catch (error: any) {
      Alert.alert(t('Error'), error.message ?? t('Failed to save TikTok token'));
    } finally {
      setTikTokLoading(false);
    }
  };

  const handleTikTokReveal = async () => {
    setTikTokLoading(true);
    try {
      const result = await revealTikTokToken(orgId);
      if (result?.revealed && result?.refreshToken) {
        setTikTokRevealToken(result.refreshToken as string);
        setShowTikTokRevealModal(true);
        await loadTikTok();
      } else {
        Alert.alert(t('Notice'), t('Refresh token already revealed or unavailable.'));
      }
    } catch (error: any) {
      Alert.alert(t('Error'), error.message ?? t('Failed to reveal token'));
    } finally {
      setTikTokLoading(false);
    }
  };

  const handleTikTokDisconnect = async () => {
    setTikTokLoading(true);
    try {
      await disconnectTikTok(orgId);
      await loadTikTok();
      Alert.alert(t('Success'), t('TikTok disconnected.'));
    } catch (error: any) {
      Alert.alert(t('Error'), error.message ?? t('Failed to disconnect TikTok'));
    } finally {
      setTikTokLoading(false);
    }
  };

  const isManualConnected = (platform: ManualPlatform) => {
    const current = (socialAccounts?.[platform] ?? {}) as Record<string, string>;
    return MANUAL_FIELDS[platform].every(field => Boolean(current[field.key]));
  };

  const getManualMissing = (platform: ManualPlatform) => {
    const current = (socialAccounts?.[platform] ?? {}) as Record<string, string>;
    const draft = drafts[platform] ?? {};
    const combined = { ...current, ...draft };
    return MANUAL_FIELDS[platform]
      .filter(field => !combined[field.key])
      .map(field => field.label);
  };

  const updateDraft = (platform: ManualPlatform, key: string, value: string) => {
    setDrafts(prev => ({
      ...prev,
      [platform]: {
        ...(prev[platform] ?? {}),
        [key]: value
      }
    }));
  };

  const pruneAccounts = (accounts: Record<string, any>) => {
    const next: Record<string, any> = {};
    Object.entries(accounts).forEach(([key, value]) => {
      if (!value || typeof value !== 'object') return;
      const hasValue = Object.values(value as Record<string, unknown>).some(v => Boolean(v));
      if (hasValue) next[key] = value;
    });
    return next;
  };

  const handleManualSave = async (platform: ManualPlatform) => {
    if (!state.user) return;
    const current = (socialAccounts?.[platform] ?? {}) as Record<string, string>;
    const draft = drafts[platform] ?? {};
    const nextPlatform = { ...current, ...draft };
    const missing = MANUAL_FIELDS[platform].filter(field => !nextPlatform[field.key]).map(field => field.label);
    if (missing.length) {
      Alert.alert(t('Error'), t('Please fill in all required fields.'));
      return;
    }
    setSavingPlatform(platform);
    try {
      const nextAccounts = pruneAccounts({ ...socialAccounts, [platform]: nextPlatform });
      await saveSocialCredentials(state.user.uid, nextAccounts);
      setSocialAccounts(nextAccounts);
      setDrafts(prev => ({ ...prev, [platform]: { ...EMPTY_DRAFTS[platform] } }));
      setExpandedPlatform(null);
      await loadSocialStatus();
      Alert.alert(t('Success'), t('Credentials saved.'));
    } catch (error: any) {
      Alert.alert(t('Error'), error.message ?? t('Failed to save credentials.'));
    } finally {
      setSavingPlatform(null);
    }
  };

  const handleManualDisconnect = async (platform: ManualPlatform) => {
    if (!state.user) return;
    setSavingPlatform(platform);
    try {
      const nextAccounts = { ...socialAccounts };
      delete nextAccounts[platform];
      const pruned = pruneAccounts(nextAccounts);
      await saveSocialCredentials(state.user.uid, pruned);
      setSocialAccounts(pruned);
      setExpandedPlatform(null);
      await loadSocialStatus();
      Alert.alert(t('Success'), t('Disconnected.'));
    } catch (error: any) {
      Alert.alert(t('Error'), error.message ?? t('Failed to disconnect.'));
    } finally {
      setSavingPlatform(null);
    }
  };

  const confirmDisconnect = (platform: PlatformKey, action: () => void) => {
    Alert.alert(t('Disconnect'), t('Are you sure?'), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Disconnect'), style: 'destructive', onPress: action }
    ]);
  };

  const copyToken = async () => {
    if (!revealToken) return;
    const clipboard = (globalThis as any)?.navigator?.clipboard;
    if (clipboard?.writeText) {
      await clipboard.writeText(revealToken);
      Alert.alert(t('Copied'), t('Refresh token copied to clipboard.'));
    } else {
      Alert.alert(t('Copy'), t('Press and hold to copy the token.'));
    }
  };

  const copyTikTokToken = async () => {
    if (!tiktokRevealToken) return;
    const clipboard = (globalThis as any)?.navigator?.clipboard;
    if (clipboard?.writeText) {
      await clipboard.writeText(tiktokRevealToken);
      Alert.alert(t('Copied'), t('Refresh token copied to clipboard.'));
    } else {
      Alert.alert(t('Copy'), t('Press and hold to copy the token.'));
    }
  };

  const togglePlatform = (platform: PlatformKey) => {
    setExpandedPlatform(prev => (prev === platform ? null : platform));
  };

  const youtubeConnected = Boolean(youtubeStatus?.connected);
  const tiktokConnected = Boolean(tiktokStatus?.connected);
  const youtubeMissing = [
    !youtubeConfig?.clientIdConfigured ? 'Client ID' : null,
    !youtubeConfig?.clientSecretConfigured ? 'Client secret' : null,
    !youtubeConfig?.redirectUri ? 'Redirect URI' : null,
    !youtubeConnected ? 'OAuth connection' : null,
  ].filter(Boolean) as string[];
  const tiktokMissing = [
    !tiktokConfig?.clientKeyConfigured ? 'Client key' : null,
    !tiktokConfig?.clientSecretConfigured ? 'Client secret' : null,
    !tiktokConfig?.redirectUri ? 'Redirect URI' : null,
    !tiktokConnected ? 'OAuth connection' : null,
  ].filter(Boolean) as string[];

  const handleDisconnectPress = (platform: PlatformKey) => {
    if (platform === 'youtube') {
      confirmDisconnect(platform, () => void handleDisconnect());
      return;
    }
    if (platform === 'tiktok') {
      confirmDisconnect(platform, () => void handleTikTokDisconnect());
      return;
    }
    confirmDisconnect(platform, () => void handleManualDisconnect(platform as ManualPlatform));
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.title}>{t('Link Channels')}</Text>
        <Text style={styles.subtext}>{t('Connect a social account to unlock outbound metrics.')}</Text>
      </View>

      <View style={styles.integrationsGrid}>
        {PLATFORM_ORDER.map(platform => {
          const manualPlatform = platform as ManualPlatform;
          const connected =
            platform === 'youtube'
              ? youtubeConnected
              : platform === 'tiktok'
                ? tiktokConnected
                : (socialStatus?.[manualPlatform] ?? isManualConnected(manualPlatform));
          const isExpanded = expandedPlatform === platform;
          const missing =
            platform === 'youtube'
              ? youtubeMissing
              : platform === 'tiktok'
                ? tiktokMissing
                : getManualMissing(manualPlatform);
          const isSaving = savingPlatform === platform;
          return (
            <View key={platform} style={styles.integrationCard}>
              <View style={styles.integrationHeader}>
                <View style={styles.integrationInfo}>
                  <Text style={styles.integrationTitle}>{PLATFORM_LABELS[platform]}</Text>
                  <View style={styles.integrationStatusRow}>
                    <Text style={styles.statusLabel}>{t('Status')}</Text>
                    <View
                      style={[
                        styles.connectionPill,
                        connected ? styles.connectionPillOn : styles.connectionPillOff,
                      ]}
                    >
                      <Text style={styles.connectionPillText}>
                        {connected ? t('Connected') : t('Not connected')}
                      </Text>
                    </View>
                  </View>
                </View>
                {connected ? (
                  <DMButton
                    title={t('Disconnect')}
                    onPress={() => handleDisconnectPress(platform)}
                    style={styles.headerButton}
                    size="compact"
                    disabled={isSaving || (platform === 'youtube' && youtubeLoading) || (platform === 'tiktok' && tiktokLoading)}
                  />
                ) : (
                  <DMButton
                    title={t('Connect')}
                    onPress={() => togglePlatform(platform)}
                    style={styles.headerButton}
                    size="compact"
                  />
                )}
              </View>

              {!connected && isExpanded ? (
                <View style={styles.integrationBody}>
                  {missing.length ? (
                    <View style={styles.missingPanel}>
                      <Text style={styles.missingLabel}>{t('Missing')}</Text>
                      <Text style={styles.missingText}>{missing.join(', ')}</Text>
                    </View>
                  ) : null}

                  {platform === 'youtube' ? (
                    <View style={styles.inlineActions}>
                      <DMButton
                        title={t('Connect YouTube')}
                        onPress={handleConnect}
                        disabled={youtubeLoading}
                      />
                    </View>
                  ) : platform === 'tiktok' ? (
                    <View style={styles.inlineActions}>
                      <DMButton
                        title={t('Connect TikTok')}
                        onPress={handleTikTokConnect}
                        disabled={tiktokLoading}
                      />
                    </View>
                  ) : (
                    <>
                      {MANUAL_FIELDS[manualPlatform].map(field => (
                        <View key={field.key} style={styles.fieldBlock}>
                          <Text style={styles.label}>{field.label}</Text>
                          <TextInput
                            value={drafts[manualPlatform]?.[field.key] ?? ''}
                            onChangeText={value => updateDraft(manualPlatform, field.key, value)}
                            placeholder={field.placeholder}
                            placeholderTextColor={colors.subtext}
                            style={styles.input}
                            autoCapitalize="none"
                            autoCorrect={false}
                          />
                        </View>
                      ))}
                      <DMButton
                        title={isSaving ? t('Saving...') : t('Save')}
                        onPress={() => handleManualSave(manualPlatform)}
                        disabled={isSaving}
                      />
                    </>
                  )}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>

      {expandedPlatform === 'youtube' && !youtubeConnected ? (
        <>
          <View style={styles.card}>
            <Text style={styles.title}>{t('YouTube Integration Wizard')}</Text>
            <Text style={styles.subtext}>
              {t('Connect YouTube with OAuth credentials and a refresh token stored securely on the server.')}
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('Step 1: Create Google OAuth Credentials')}</Text>
            <Text style={styles.subtext}>
              {t('Create OAuth credentials in Google Cloud Console. Paste the redirect URI below into Authorized redirect URIs.')}
            </Text>
            <View style={styles.rowBetween}>
              <Text style={styles.label}>{t('YOUTUBE_CLIENT_ID')}</Text>
              <StatusPill ok={Boolean(youtubeConfig?.clientIdConfigured)} />
            </View>
            <View style={styles.rowBetween}>
              <Text style={styles.label}>{t('YOUTUBE_CLIENT_SECRET')}</Text>
              <StatusPill ok={Boolean(youtubeConfig?.clientSecretConfigured)} />
            </View>
            <Text style={styles.label}>{t('YOUTUBE_REDIRECT_URI')}</Text>
            <TextInput
              value={youtubeConfig?.redirectUri ?? ''}
              editable={false}
              selectTextOnFocus
              style={styles.input}
            />
            <DMButton
              title={youtubeLoading ? t('Refreshing...') : t('Refresh Status')}
              onPress={loadYouTube}
              disabled={youtubeLoading}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('Step 2: Connect')}</Text>
            <Text style={styles.subtext}>
              {t('Start the OAuth flow. You will be asked to consent to YouTube upload access.')}
            </Text>
            <DMButton title={t('Connect YouTube')} onPress={handleConnect} disabled={youtubeLoading} />
            <View style={styles.statusRow}>
              <Text style={styles.label}>{t('Status')}</Text>
              <Text style={styles.statusValue}>
                {youtubeStatus?.connected
                  ? `${youtubeStatus.channelTitle ?? t('Connected')} (${youtubeStatus.channelId ?? 'n/a'})`
                  : t('Not connected')}
              </Text>
            </View>
            {youtubeStatus?.refreshTokenRevealPending ? (
              <DMButton title={t('Reveal Refresh Token (one-time)')} onPress={handleReveal} disabled={youtubeLoading} />
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('Step 3: Token Paste (fallback)')}</Text>
            <Text style={styles.subtext}>
              {t('Paste a refresh token string or JSON payload with refreshToken.')}
            </Text>
            <TextInput
              value={youtubeTokenInput}
              onChangeText={setYouTubeTokenInput}
              placeholder={t('Paste refresh token or JSON')}
              placeholderTextColor={colors.subtext}
              style={styles.input}
              multiline
            />
            <DMButton title={youtubeLoading ? t('Saving...') : t('Save Token')} onPress={handlePasteToken} disabled={youtubeLoading} />
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('Step 4: Defaults')}</Text>
            <Text style={styles.subtext}>{t('Choose the default privacy status for uploads.')}</Text>
            <View style={styles.pillRow}>
              {(['private', 'unlisted', 'public'] as const).map(option => (
                <TouchableOpacity
                  key={option}
                  style={[styles.pill, privacyStatus === option && styles.pillActive]}
                  onPress={() => setPrivacyStatus(option)}
                >
                  <Text style={[styles.pillText, privacyStatus === option && styles.pillTextActive]}>
                    {t(option)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <DMButton title={t('Save Defaults')} onPress={handleDefaults} disabled={youtubeLoading} />
          </View>
        </>
      ) : null}

      {expandedPlatform === 'tiktok' && !tiktokConnected ? (
        <>
          <View style={styles.card}>
            <Text style={styles.title}>{t('TikTok Integration Wizard')}</Text>
            <Text style={styles.subtext}>
              {t('Connect TikTok with OAuth credentials and securely store tokens for posting.')}
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('Step 1: Create TikTok App')}</Text>
            <Text style={styles.subtext}>
              {t('Create a TikTok developer app and paste the redirect URI below into Authorized redirect URIs.')}
            </Text>
            <View style={styles.rowBetween}>
              <Text style={styles.label}>{t('TIKTOK_CLIENT_KEY')}</Text>
              <StatusPill ok={Boolean(tiktokConfig?.clientKeyConfigured)} />
            </View>
            <View style={styles.rowBetween}>
              <Text style={styles.label}>{t('TIKTOK_CLIENT_SECRET')}</Text>
              <StatusPill ok={Boolean(tiktokConfig?.clientSecretConfigured)} />
            </View>
            <Text style={styles.label}>{t('TIKTOK_REDIRECT_URI')}</Text>
            <TextInput
              value={tiktokConfig?.redirectUri ?? ''}
              editable={false}
              selectTextOnFocus
              style={styles.input}
            />
            <Text style={styles.label}>{t('Scopes')}</Text>
            <TextInput
              value={(tiktokConfig?.scopes ?? []).join(', ')}
              editable={false}
              selectTextOnFocus
              style={styles.input}
            />
            <DMButton
              title={tiktokLoading ? t('Refreshing...') : t('Refresh Status')}
              onPress={loadTikTok}
              disabled={tiktokLoading}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('Step 2: Connect')}</Text>
            <Text style={styles.subtext}>
              {t('Start the TikTok OAuth flow and grant posting permissions.')}
            </Text>
            <DMButton title={t('Connect TikTok')} onPress={handleTikTokConnect} disabled={tiktokLoading} />
            <View style={styles.statusRow}>
              <Text style={styles.label}>{t('Status')}</Text>
              <Text style={styles.statusValue}>
                {tiktokStatus?.connected
                  ? `${t('Connected')} (${tiktokStatus.openId ?? 'n/a'})`
                  : t('Not connected')}
              </Text>
            </View>
            {tiktokStatus?.refreshTokenRevealPending ? (
              <DMButton title={t('Reveal Refresh Token (one-time)')} onPress={handleTikTokReveal} disabled={tiktokLoading} />
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('Step 3: Token Paste (fallback)')}</Text>
            <Text style={styles.subtext}>
              {t('Paste a TikTok access token or JSON payload with access_token/refresh_token.')}
            </Text>
            <TextInput
              value={tiktokTokenInput}
              onChangeText={setTikTokTokenInput}
              placeholder={t('Paste access token or JSON')}
              placeholderTextColor={colors.subtext}
              style={styles.input}
              multiline
            />
            <DMButton
              title={tiktokLoading ? t('Saving...') : t('Save Token')}
              onPress={handleTikTokPaste}
              disabled={tiktokLoading}
            />
          </View>
        </>
      ) : null}

      <Modal
        transparent
        visible={showRevealModal}
        animationType="fade"
        onRequestClose={() => setShowRevealModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.sectionTitle}>{t('Refresh Token (one-time)')}</Text>
            <Text style={styles.subtext}>
              {t('Store this token securely. It will not be shown again after closing this modal.')}
            </Text>
            <TextInput value={revealToken ?? ''} editable={false} style={styles.input} multiline />
            <DMButton title={t('Copy')} onPress={copyToken} />
            <DMButton title={t('Close')} onPress={() => setShowRevealModal(false)} />
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        visible={showTikTokRevealModal}
        animationType="fade"
        onRequestClose={() => setShowTikTokRevealModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.sectionTitle}>{t('TikTok Refresh Token (one-time)')}</Text>
            <Text style={styles.subtext}>
              {t('Store this token securely. It will not be shown again after closing this modal.')}
            </Text>
            <TextInput value={tiktokRevealToken ?? ''} editable={false} style={styles.input} multiline />
            <DMButton title={t('Copy')} onPress={copyTikTokToken} />
            <DMButton title={t('Close')} onPress={() => setShowTikTokRevealModal(false)} />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const StatusPill: React.FC<{ ok: boolean }> = ({ ok }) => (
  <View style={[styles.statusPill, ok ? styles.statusPillOk : styles.statusPillWarn]}>
    <Text style={styles.statusPillText}>{ok ? 'Configured' : 'Missing'}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20 },
  card: {
    backgroundColor: colors.backgroundAlt,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  integrationsGrid: {
    gap: 12,
    marginBottom: 16,
  },
  integrationCard: {
    backgroundColor: colors.backgroundAlt,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  integrationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  integrationInfo: {
    flex: 1,
    minWidth: 0,
  },
  integrationTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  headerButton: {
    alignSelf: 'flex-start',
  },
  integrationStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusLabel: {
    color: colors.subtext,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  connectionPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  connectionPillOn: {
    backgroundColor: '#1f3d2b',
  },
  connectionPillOff: {
    backgroundColor: '#3d2a1f',
  },
  connectionPillText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  integrationBody: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  missingPanel: {
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
  },
  missingLabel: {
    color: colors.subtext,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  missingText: {
    color: colors.text,
    fontSize: 13,
  },
  fieldBlock: {
    marginBottom: 12,
  },
  inlineActions: {
    gap: 10,
  },
  title: { color: colors.text, fontSize: 20, fontWeight: '700', marginBottom: 12 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 8 },
  label: { color: colors.text, marginBottom: 4 },
  subtext: { color: colors.subtext, marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    color: colors.text,
    backgroundColor: colors.background,
    marginBottom: 12,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  statusRow: {
    marginTop: 12,
    marginBottom: 12,
  },
  statusValue: {
    color: colors.subtext,
    marginTop: 4,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillActive: {
    borderColor: colors.accent,
    backgroundColor: `${colors.accent}22`,
  },
  pillText: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: '600',
  },
  pillTextActive: {
    color: colors.accent,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusPillOk: {
    backgroundColor: '#1f3d2b',
  },
  statusPillWarn: {
    backgroundColor: '#3d2a1f',
  },
  statusPillText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: colors.backgroundAlt,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    borderWidth: 1,
    borderColor: colors.border,
  },
});
