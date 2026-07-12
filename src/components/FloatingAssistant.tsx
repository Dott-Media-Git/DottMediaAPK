import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Defs, Ellipse, G, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@constants/colors';
import { useAuth } from '@context/AuthContext';
import { useAssistant } from '@context/AssistantContext';
import { useI18n } from '@context/I18nContext';
import {
  fetchAnalytics,
  fetchEngagementStats,
  fetchFollowupStats,
  fetchInboundStats,
  fetchLiveSocialStats,
  fetchOutboundStats,
  fetchWebLeadStats,
  resolveAnalyticsScopeId,
  type DashboardAnalytics,
  type EngagementStats,
  type FollowupStats,
  type InboundStats,
  type LiveSocialStats,
  type OutboundStats,
  type WebLeadStats,
} from '@services/analytics';
import { isMainDottMediaAccount } from '@services/accountAccess';
import { askAssistant } from '@services/assistant';

type Message = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
};

type DottiState = 'idle' | 'happy' | 'thinking' | 'analyzing' | 'empathetic' | 'excited' | 'focused' | 'closing';

type AssistantSnapshotInput = {
  companyName?: string;
  subscriptionStatus?: string;
  currentScreen?: string;
  fallbackChannels: string[];
  businessGoals?: string;
  targetAudience?: string;
  liveSocial: LiveSocialStats | null;
  analytics: DashboardAnalytics | null;
  outbound: OutboundStats | null;
  inbound: InboundStats | null;
  engagement: EngagementStats | null;
  followups: FollowupStats | null;
  webLeads: WebLeadStats | null;
};

export const FloatingAssistant: React.FC = () => {
  const { state } = useAuth();
  const { enabled, hydrated, currentScreen, assistantTone, assistantVoice } = useAssistant();
  const { locale, t } = useI18n();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [input, setInput] = useState('');
  const [hasStartedTyping, setHasStartedTyping] = useState(false);
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceConversation, setVoiceConversation] = useState(false);
  const [liveSocial, setLiveSocial] = useState<LiveSocialStats | null>(null);
  const [accountSnapshot, setAccountSnapshot] = useState('');
  const analyticsScopeId = useMemo(
    () => resolveAnalyticsScopeId(state.user?.uid, ((state.user as any)?.orgId ?? state.crmData?.orgId) as string | undefined),
    [state.user?.uid, state.user, state.crmData?.orgId]
  );
  const [messages, setMessages] = useState<Message[]>(() => [
    {
      id: 'welcome',
      role: 'assistant',
      text: buildPerformanceSummary(state.crmData?.companyName, liveSocial, t)
    }
  ]);

  const canDisplay = hydrated && enabled && Boolean(state.user);
  const hasUserMessage = useMemo(() => messages.some(message => message.role === 'user'), [messages]);
  const dottiState = useMemo(
    () =>
      resolveDottiState({
        input,
        messages,
        sending,
        listening,
        accountSnapshot,
        currentScreen,
      }),
    [accountSnapshot, currentScreen, input, listening, messages, sending]
  );
  const showDotti = open || hasStartedTyping || hasUserMessage || sending || listening;

  const quickPrompts = useMemo(
    () => [
      t('Summarize my account today'),
      t('Which channels are connected right now?'),
      t('How is my performance this week?'),
      t('Recommend a growth strategy'),
      t('What should I optimize next?')
    ],
    [t]
  );

  const baseConnectedChannels = useMemo(
    () =>
      [
        state.crmData?.instagram ? 'instagram' : null,
        state.crmData?.facebook ? 'facebook' : null,
        state.crmData?.linkedin ? 'linkedin' : null,
      ].filter(Boolean) as string[],
    [state.crmData?.instagram, state.crmData?.facebook, state.crmData?.linkedin]
  );

  const context = useMemo(() => {
    return {
      userId: state.user?.uid ?? 'guest',
      company: state.crmData?.companyName,
      orgId: ((state.user as any)?.orgId ?? state.crmData?.orgId) as string | undefined,
      businessGoals: state.crmData?.businessGoals,
      targetAudience: state.crmData?.targetAudience,
      accountSnapshot,
      analytics: state.crmData?.analytics,
      subscriptionStatus: state.subscriptionStatus,
      connectedChannels: baseConnectedChannels,
      currentScreen,
      locale,
      assistantTone,
      assistantVoice,
    };
  }, [
    state.user?.uid,
    state.crmData?.companyName,
    state.user,
    state.crmData?.orgId,
    state.crmData?.businessGoals,
    state.crmData?.targetAudience,
    accountSnapshot,
    state.crmData?.analytics,
    baseConnectedChannels,
    state.subscriptionStatus,
    currentScreen,
    locale,
    assistantTone,
    assistantVoice,
  ]);

  const handleOpen = () => setOpen(true);
  const handleClose = () => {
    setOpen(false);
    setFullScreen(false);
  };

  const pushMessage = (message: Message) => {
    setMessages(prev => [...prev, message]);
  };

  const handleSend = async (prompt?: string, speakResponse = voiceConversation) => {
    const question = (prompt ?? input).trim();
    if (!question) return;
    setInput('');
    const userMessage: Message = { id: `user-${Date.now()}`, role: 'user', text: question };
    pushMessage(userMessage);
    setSending(true);
    try {
      const answer = await askAssistant(question, context);
      pushMessage({ id: `assistant-${Date.now()}`, role: 'assistant', text: answer });
      if (speakResponse && Platform.OS === 'web') {
        const synth = (globalThis as any)?.speechSynthesis;
        if (synth) {
          synth.cancel();
          const utterance = new (globalThis as any).SpeechSynthesisUtterance(answer);
          utterance.lang = locale || 'en';
          utterance.rate = 1;
          synth.speak(utterance);
        }
      }
    } catch (error) {
      console.warn('Assistant failed', error);
      pushMessage({
        id: `assistant-error-${Date.now()}`,
        role: 'assistant',
        text: t('I ran into an issue answering that. Please try again shortly.')
      });
    } finally {
      setSending(false);
    }
  };

  const handleVoiceInput = () => {
    if (Platform.OS !== 'web') {
      pushMessage({
        id: `assistant-voice-${Date.now()}`,
        role: 'assistant',
        text: t('Voice conversation is available in the web app on supported browsers.'),
      });
      return;
    }
    const browser = globalThis as any;
    const Recognition = browser.SpeechRecognition || browser.webkitSpeechRecognition;
    if (!Recognition) {
      pushMessage({
        id: `assistant-voice-${Date.now()}`,
        role: 'assistant',
        text: t('Voice input is not supported by this browser. Try Chrome or Edge.'),
      });
      return;
    }
    const recognition = new Recognition();
    recognition.lang = locale || 'en';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onstart = () => {
      setListening(true);
      setVoiceConversation(true);
      setHasStartedTyping(true);
    };
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results ?? [])
        .map((result: any) => result?.[0]?.transcript ?? '')
        .join('');
      setInput(transcript);
      if (event.results?.[event.results.length - 1]?.isFinal && transcript.trim()) {
        void handleSend(transcript, true);
      }
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognition.start();
  };

  useEffect(() => {
    let cancelled = false;
    if (!state.user?.uid) {
      setLiveSocial(null);
      setAccountSnapshot('');
      return () => {
        cancelled = true;
      };
    }

    const canUseOutboundPipeline = isMainDottMediaAccount(state.user);
    void Promise.all([
      fetchLiveSocialStats(state.user.uid, analyticsScopeId, 24),
      fetchAnalytics(state.user.uid),
      canUseOutboundPipeline ? fetchOutboundStats(state.user.uid, analyticsScopeId) : Promise.resolve(null),
      fetchInboundStats(state.user.uid, analyticsScopeId),
      fetchEngagementStats(state.user.uid, analyticsScopeId),
      fetchFollowupStats(state.user.uid, analyticsScopeId),
      fetchWebLeadStats(state.user.uid, analyticsScopeId),
    ])
      .then(([stats, analytics, outbound, inbound, engagement, followups, webLeads]) => {
        if (!cancelled) {
          setLiveSocial(stats);
          setAccountSnapshot(
            buildAccountSnapshot({
              companyName: state.crmData?.companyName,
              subscriptionStatus: state.subscriptionStatus,
              currentScreen,
              fallbackChannels: baseConnectedChannels,
              businessGoals: state.crmData?.businessGoals,
              targetAudience: state.crmData?.targetAudience,
              liveSocial: stats,
              analytics,
              outbound,
              inbound,
              engagement,
              followups,
              webLeads,
            })
          );
        }
      })
      .catch(error => {
        console.warn('Failed to load live assistant summary', error);
        if (!cancelled) {
          setLiveSocial(null);
          setAccountSnapshot(
            buildAccountSnapshot({
              companyName: state.crmData?.companyName,
              subscriptionStatus: state.subscriptionStatus,
              currentScreen,
              fallbackChannels: baseConnectedChannels,
              businessGoals: state.crmData?.businessGoals,
              targetAudience: state.crmData?.targetAudience,
              liveSocial: null,
              analytics: null,
              outbound: null,
              inbound: null,
              engagement: null,
              followups: null,
              webLeads: null,
            })
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    state.user?.uid,
    analyticsScopeId,
    state.crmData?.companyName,
    state.crmData?.businessGoals,
    state.crmData?.targetAudience,
    state.subscriptionStatus,
    currentScreen,
    baseConnectedChannels,
  ]);

  useEffect(() => {
    setMessages(prev => {
      if (prev.length === 1 && prev[0].id === 'welcome') {
        return [
          {
            ...prev[0],
            text: buildPerformanceSummary(state.crmData?.companyName, liveSocial, t)
          }
        ];
      }
      return prev;
    });
  }, [state.crmData?.companyName, liveSocial, t]);

  if (!canDisplay) {
    return null;
  }

  return (
    <>
      {open ? (
        <View style={styles.overlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={[styles.avoider, fullScreen && styles.fullScreenAvoider]}
          >
            <View
              style={[
                styles.panel,
                fullScreen && styles.fullScreenPanel,
                {
                  paddingTop: fullScreen ? 16 + insets.top : 16,
                  paddingBottom: 16 + insets.bottom,
                },
              ]}
            >
              <View style={styles.panelHeader}>
                <View style={styles.headerCopy}>
                  <Text style={styles.panelTitle}>{t('Dotti Assistant')}</Text>
                  <Text style={styles.panelSubtitle}>{t('Ask about your account, performance, or next move.')}</Text>
                </View>
                {showDotti ? (
                  <View style={styles.dottiSlot} pointerEvents="none">
                    <DottiAvatar state={dottiState} size={62} />
                  </View>
                ) : null}
                <View style={styles.headerActions}>
                  <TouchableOpacity
                    onPress={() => setFullScreen(value => !value)}
                    style={styles.headerButton}
                    accessibilityRole="button"
                    accessibilityLabel={t(fullScreen ? 'Exit full screen' : 'Open full screen')}
                  >
                    <Ionicons
                      name={fullScreen ? 'contract-outline' : 'expand-outline'}
                      size={19}
                      color={colors.text}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleClose}
                    style={styles.headerButton}
                    accessibilityRole="button"
                    accessibilityLabel={t('Close assistant')}
                  >
                    <Ionicons name="close" size={20} color={colors.text} />
                  </TouchableOpacity>
                </View>
              </View>
              <ScrollView
                style={[styles.thread, fullScreen && styles.fullScreenThread]}
                contentContainerStyle={[
                  styles.threadContent,
                  fullScreen && styles.fullScreenThreadContent,
                ]}
              >
                {messages.map(message => (
                  <View
                    key={message.id}
                    style={[styles.messageBubble, message.role === 'user' ? styles.userBubble : styles.assistantBubble]}
                  >
                    <Text style={styles.messageLabel}>{message.role === 'user' ? t('You') : t('Dotti')}</Text>
                    <Text style={styles.messageText}>{message.text}</Text>
                  </View>
                ))}
                {sending ? (
                  <View style={[styles.messageBubble, styles.assistantBubble, styles.typingBubble]}>
                    <ActivityIndicator size="small" color={colors.accent} />
                    <Text style={[styles.messageText, { marginLeft: 8 }]}>{t('Thinking...')}</Text>
                  </View>
                ) : null}
              </ScrollView>
              {!hasStartedTyping && !messages.some(message => message.role === 'user') ? (
                <View style={styles.quickPromptRow}>
                  {quickPrompts.map(prompt => (
                    <TouchableOpacity key={prompt} onPress={() => handleSend(prompt)} style={styles.quickPrompt}>
                      <Text style={styles.quickPromptText}>{prompt}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
              <View style={styles.inputRow}>
                <TouchableOpacity
                  onPress={handleVoiceInput}
                  style={[styles.voiceButton, listening && styles.voiceButtonActive]}
                  disabled={sending || listening}
                  accessibilityRole="button"
                  accessibilityLabel={t(listening ? 'Listening' : 'Talk to Dotti Assistant')}
                >
                  <Ionicons name={listening ? 'mic' : 'mic-outline'} size={20} color={listening ? colors.background : colors.accent} />
                </TouchableOpacity>
                <TextInput
                  style={styles.input}
                  placeholder={t('Ask me anything...')}
                  placeholderTextColor={colors.subtext}
                  value={input}
                  onChangeText={value => {
                    setInput(value);
                    if (value.length > 0) setHasStartedTyping(true);
                  }}
                  editable={!sending}
                  multiline
                />
                <TouchableOpacity onPress={() => handleSend()} style={styles.sendButton} disabled={sending}>
                  <Ionicons name="send" size={18} color={colors.background} />
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      ) : null}
      {!open ? (
        <TouchableOpacity
          style={[
            styles.fab,
            {
              bottom: 24 + insets.bottom,
              shadowColor: '#000'
            }
          ]}
          onPress={handleOpen}
          accessibilityRole="button"
          accessibilityLabel={t('Open Dotti assistant')}
        >
          <Ionicons name="sparkles-outline" size={26} color={colors.background} />
        </TouchableOpacity>
      ) : null}
    </>
  );
};

const DOTTI_CONFIG: Record<DottiState, { blush: number; bob: number; brow: number; mouth: number; eye: number }> = {
  idle: { blush: 0.28, bob: 0.5, brow: 0, mouth: 0, eye: 1 },
  happy: { blush: 0.55, bob: 0.75, brow: -2, mouth: 1, eye: 1 },
  thinking: { blush: 0.32, bob: 0.35, brow: 3, mouth: -0.2, eye: 0.92 },
  analyzing: { blush: 0.35, bob: 0.55, brow: 1, mouth: 0.35, eye: 0.96 },
  empathetic: { blush: 0.5, bob: 0.25, brow: 4, mouth: 0.2, eye: 0.82 },
  excited: { blush: 0.75, bob: 1, brow: -4, mouth: 1.35, eye: 1.06 },
  focused: { blush: 0.26, bob: 0.2, brow: -1, mouth: -0.35, eye: 0.86 },
  closing: { blush: 0.62, bob: 0.65, brow: -2, mouth: 0.8, eye: 1 },
};

const DottiAvatar: React.FC<{ state: DottiState; size?: number }> = ({ state, size = 62 }) => {
  const cfg = DOTTI_CONFIG[state] ?? DOTTI_CONFIG.idle;
  const float = useRef(new Animated.Value(0)).current;
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, {
          toValue: 1,
          duration: Math.max(900, 1700 - cfg.bob * 450),
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(float, {
          toValue: 0,
          duration: Math.max(900, 1700 - cfg.bob * 450),
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [cfg.bob, float]);

  useEffect(() => {
    const interval = setInterval(() => {
      setBlink(true);
      setTimeout(() => setBlink(false), 150);
    }, state === 'focused' ? 4600 : 3400);
    return () => clearInterval(interval);
  }, [state]);

  const translateY = float.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -4 * cfg.bob],
  });
  const eyeHeight = blink ? 2 : 13 * cfg.eye;

  return (
    <Animated.View style={[styles.dottiAvatar, { width: size, height: size + 8, transform: [{ translateY }] }]}>
      <Svg width={size} height={size + 8} viewBox="0 0 260 300">
        <Defs>
          <RadialGradient id="dottiBody" cx="42%" cy="32%" r="75%">
            <Stop offset="0%" stopColor="#FFFFFF" />
            <Stop offset="48%" stopColor="#F3F7FF" />
            <Stop offset="100%" stopColor="#DDE8FF" />
          </RadialGradient>
          <RadialGradient id="dottiFace" cx="45%" cy="28%" r="72%">
            <Stop offset="0%" stopColor="#FFFFFF" />
            <Stop offset="62%" stopColor="#FFF8F2" />
            <Stop offset="100%" stopColor="#F0E6DE" />
          </RadialGradient>
          <RadialGradient id="dottiEye" cx="40%" cy="38%" r="70%">
            <Stop offset="0%" stopColor="#FFFFFF" />
            <Stop offset="24%" stopColor="#78F6FF" />
            <Stop offset="100%" stopColor="#13294B" />
          </RadialGradient>
        </Defs>
        <Ellipse cx="130" cy="270" rx="60" ry="12" fill="#0B1220" opacity="0.16" />
        <Path d="M54 218 C44 183 46 124 74 82 C101 40 159 35 191 69 C226 106 224 173 207 221 C190 267 75 266 54 218Z" fill="url(#dottiBody)" stroke="#ABC2EE" strokeWidth="5" />
        <Path d="M70 74 C60 58 57 38 68 26 C83 9 107 30 102 60" fill="#EAF1FF" stroke="#ABC2EE" strokeWidth="5" />
        <Path d="M189 70 C199 53 203 36 192 25 C176 9 153 31 159 62" fill="#EAF1FF" stroke="#ABC2EE" strokeWidth="5" />
        <Circle cx="130" cy="151" r="73" fill="url(#dottiFace)" stroke="#F0DCD1" strokeWidth="4" />
        <Path d={`M84 ${118 + cfg.brow} C99 ${108 + cfg.brow} 113 ${108 + cfg.brow} 126 ${118 + cfg.brow}`} fill="none" stroke="#25324A" strokeWidth="6" strokeLinecap="round" opacity="0.65" />
        <Path d={`M135 ${118 - cfg.brow} C149 ${108 - cfg.brow} 165 ${108 - cfg.brow} 179 ${118 - cfg.brow}`} fill="none" stroke="#25324A" strokeWidth="6" strokeLinecap="round" opacity="0.65" />
        <Ellipse cx="104" cy="148" rx="17" ry={eyeHeight} fill="url(#dottiEye)" />
        <Ellipse cx="156" cy="148" rx="17" ry={eyeHeight} fill="url(#dottiEye)" />
        {!blink ? (
          <>
            <Circle cx="99" cy="143" r="5" fill="#FFFFFF" opacity="0.9" />
            <Circle cx="151" cy="143" r="5" fill="#FFFFFF" opacity="0.9" />
          </>
        ) : null}
        <Circle cx="78" cy="174" r="13" fill="#FF8FA5" opacity={cfg.blush} />
        <Circle cx="182" cy="174" r="13" fill="#FF8FA5" opacity={cfg.blush} />
        <Path d={buildDottiMouthPath(cfg.mouth)} fill="#26324C" transform="translate(130 201)" opacity="0.88" />
        {state === 'analyzing' || state === 'thinking' ? (
          <G opacity="0.82">
            <Circle cx="206" cy="84" r="8" fill="#55D6BE" />
            <Circle cx="222" cy="70" r="5" fill="#7C5CFF" />
            <Rect x="214" y="92" width="22" height="6" rx="3" fill="#F7B955" />
          </G>
        ) : null}
        {state === 'closing' || state === 'excited' ? (
          <G opacity="0.9">
            <Path d="M48 96 L56 110 L72 113 L60 124 L63 140 L48 132 L34 140 L37 124 L25 113 L41 110Z" fill="#F7B955" />
            <Circle cx="213" cy="111" r="7" fill="#55D6BE" />
          </G>
        ) : null}
      </Svg>
    </Animated.View>
  );
};

const buildDottiMouthPath = (smile: number) => {
  const width = 20 + Math.max(0, smile) * 4;
  const dip = 6 + smile * 10;
  const thickness = 6 + Math.max(0, smile) * 3;
  return `M ${-width} 0 Q 0 ${dip} ${width} 0 Q 0 ${dip + thickness} ${-width} 0 Z`;
};

const resolveDottiState = ({
  input,
  messages,
  sending,
  listening,
  accountSnapshot,
  currentScreen,
}: {
  input: string;
  messages: Message[];
  sending: boolean;
  listening: boolean;
  accountSnapshot: string;
  currentScreen?: string;
}): DottiState => {
  if (listening) return 'focused';
  if (sending) return 'thinking';

  const latestText = input.trim() || [...messages].reverse().find(message => message.text.trim())?.text || '';
  const contextText = `${latestText} ${currentScreen ?? ''} ${accountSnapshot}`.toLowerCase();
  return inferDottiStateFromText(contextText);
};

const inferDottiStateFromText = (text: string): DottiState => {
  const value = text.toLowerCase();
  if (/\b(deal|closed|closing|sale|sold|conversion|signup|subscribed|won)\b/.test(value)) return 'closing';
  if (/\b(great|awesome|amazing|excellent|nice|love|wow|congrats|growth|viral|win)\b/.test(value)) return 'excited';
  if (/\b(analy|report|metric|performance|views|engagement|conversion|channels|connected|stats|summary)\b/.test(value)) return 'analyzing';
  if (/\b(sorry|issue|problem|failed|error|quota|understand|help|stuck|blocked)\b/.test(value)) return 'empathetic';
  if (/\b(focus|priority|optimize|strategy|next move|campaign|plan|schedule)\b/.test(value)) return 'focused';
  if (/\b(hmm|think|thinking|maybe|what if|why|how)\b/.test(value)) return 'thinking';
  if (/\b(hi|hello|hey|thanks|thank you)\b/.test(value)) return 'happy';
  return 'idle';
};

const buildPerformanceSummary = (
  companyName: string | undefined,
  liveSocial: LiveSocialStats | null,
  t: (key: string, params?: Record<string, string | number>) => string
) => {
  if (!liveSocial) {
    return t('Hi! I am Dotti, your Dott assistant. Ask me about your account, performance, or where to focus next.');
  }
  const companyTag = companyName ? ` ${companyName}` : '';
  return t(
    'Hi{{company}} team! Views are at {{views}}, interactions {{interactions}}, conversions {{conversions}}. Ask for your account summary, growth strategy, or next move.',
    {
      company: companyTag,
      views: Math.round(liveSocial.summary.views ?? 0),
      interactions: Math.round(liveSocial.summary.interactions ?? 0),
      conversions: Math.round(liveSocial.summary.conversions ?? 0)
    }
  );
};

const whole = (value: number | undefined | null) => Math.round(Number(value ?? 0));

const rate = (value: number | undefined | null) => `${Math.round(Number(value ?? 0) * 100)}%`;

const buildAccountSnapshot = ({
  companyName,
  subscriptionStatus,
  currentScreen,
  fallbackChannels,
  businessGoals,
  targetAudience,
  liveSocial,
  analytics,
  outbound,
  inbound,
  engagement,
  followups,
  webLeads,
}: AssistantSnapshotInput) => {
  const liveChannels = liveSocial
    ? Object.entries(liveSocial.platforms)
        .filter(([name, stats]) => name !== 'web' && stats.connected)
        .map(([name]) => name)
    : [];
  const connectedChannels = Array.from(new Set([...fallbackChannels, ...liveChannels]));

  const channelBreakdown = liveSocial
    ? Object.entries(liveSocial.platforms)
        .filter(([name, stats]) => name !== 'web' && stats.connected)
        .map(
          ([name, stats]) =>
            `${name}: ${whole(stats.views)} views, ${whole(stats.interactions)} interactions, ${whole(
              stats.conversions,
            )} conversions`,
        )
        .join('; ')
    : 'No live channel metrics available.';

  const jobs = analytics?.jobBreakdown
    ? `Jobs: ${whole(analytics.jobBreakdown.active)} active, ${whole(analytics.jobBreakdown.queued)} queued, ${whole(
        analytics.jobBreakdown.failed,
      )} failed.`
    : 'Jobs: unavailable.';

  const history = analytics?.history?.length
    ? analytics.history
        .slice(-3)
        .map(
          row => `${row.date}: ${whole(row.engagement)} engagement, ${whole(row.conversions)} conversions`,
        )
        .join(' | ')
    : 'Recent history unavailable.';

  return [
    companyName ? `Business: ${companyName}.` : '',
    subscriptionStatus ? `Plan: ${subscriptionStatus}.` : '',
    currentScreen ? `Current screen: ${currentScreen}.` : '',
    connectedChannels.length ? `Connected channels: ${connectedChannels.join(', ')}.` : 'Connected channels: none.',
    businessGoals ? `Business goals: ${businessGoals}.` : '',
    targetAudience ? `Target audience: ${targetAudience}.` : '',
    liveSocial
      ? `Today live: ${whole(liveSocial.summary.views)} views, ${whole(liveSocial.summary.interactions)} interactions, ${whole(
          liveSocial.summary.conversions,
        )} conversions, engagement rate ${rate(liveSocial.summary.engagementRate)}.`
      : 'Today live: unavailable.',
    liveSocial
      ? `Web: ${whole(liveSocial.web.visitors)} visitors, ${whole(liveSocial.web.interactions)} interactions, ${whole(
          liveSocial.web.redirectClicks,
        )} bet/info clicks.`
      : '',
    `Channel breakdown: ${channelBreakdown}`,
    outbound
      ? `Outbound: ${whole(outbound.prospectsContacted)} contacted, ${whole(outbound.responders)} responders, ${whole(
          outbound.replies,
        )} replies, ${whole(outbound.conversions)} conversions.`
      : 'Outbound: unavailable.',
    inbound
      ? `Inbound: ${whole(inbound.messages)} messages, ${whole(inbound.leads)} leads, sentiment ${whole(
          inbound.avgSentiment,
        )}.`
      : 'Inbound: unavailable.',
    engagement
      ? `Engagement: ${whole(engagement.comments)} comments, ${whole(engagement.replies)} replies, ${whole(
          engagement.conversions,
        )} conversions.`
      : 'Engagement: unavailable.',
    followups
      ? `Follow-ups: ${whole(followups.sent)} sent, ${whole(followups.replies)} replies, ${whole(
          followups.conversions,
        )} conversions.`
      : 'Follow-ups: unavailable.',
    webLeads
      ? `Web leads: ${whole(webLeads.leads)} leads from ${whole(webLeads.messages)} messages.`
      : 'Web leads: unavailable.',
    jobs,
    `Recent performance: ${history}`,
  ]
    .filter(Boolean)
    .join('\n');
};

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.accent,
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end'
  },
  avoider: {
    width: '100%'
  },
  fullScreenAvoider: {
    flex: 1,
  },
  panel: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 16,
    borderWidth: 1,
    borderColor: colors.border
  },
  fullScreenPanel: {
    flex: 1,
    borderRadius: 0,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  headerCopy: {
    flex: 1,
    paddingRight: 12,
  },
  dottiSlot: {
    width: 66,
    height: 72,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dottiAvatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  panelTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700'
  },
  panelSubtitle: {
    color: colors.subtext,
    marginTop: 2
  },
  headerButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.backgroundAlt
  },
  thread: {
    marginTop: 16,
    maxHeight: 260
  },
  threadContent: {
    paddingBottom: 16,
  },
  fullScreenThread: {
    flex: 1,
    flexGrow: 1,
    minHeight: 0,
    maxHeight: 10000,
  },
  fullScreenThreadContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingTop: 16,
  },
  messageBubble: {
    borderRadius: 16,
    padding: 12,
    marginBottom: 12
  },
  assistantBubble: {
    backgroundColor: colors.cardOverlay,
    borderWidth: 1,
    borderColor: colors.border
  },
  userBubble: {
    backgroundColor: colors.surface,
    alignSelf: 'flex-end'
  },
  messageLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    color: colors.subtext,
    marginBottom: 4
  },
  messageText: {
    color: colors.text
  },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 8
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 100,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: colors.cardOverlay,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text
  },
  voiceButton: {
    width: 44,
    height: 44,
    marginRight: 8,
    borderRadius: 22,
    backgroundColor: colors.backgroundAlt,
    borderWidth: 1,
    borderColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  voiceButtonActive: {
    backgroundColor: colors.accent,
  },
  sendButton: {
    marginLeft: 8,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center'
  },
  quickPromptRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8
  },
  quickPrompt: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.backgroundAlt,
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border
  },
  quickPromptText: {
    color: colors.subtext,
    fontSize: 12
  }
});
