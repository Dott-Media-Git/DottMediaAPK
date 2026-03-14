import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@constants/colors';
import { useAuth } from '@context/AuthContext';
import { useAssistant } from '@context/AssistantContext';
import { useI18n } from '@context/I18nContext';
import { fetchLiveSocialStats, resolveAnalyticsScopeId, type LiveSocialStats } from '@services/analytics';
import { askAssistant } from '@services/assistant';

type Message = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
};

export const FloatingAssistant: React.FC = () => {
  const { state } = useAuth();
  const { enabled, hydrated, currentScreen } = useAssistant();
  const { locale, t } = useI18n();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [liveSocial, setLiveSocial] = useState<LiveSocialStats | null>(null);
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

  const context = useMemo(() => {
    const connectedChannels = [
      state.crmData?.instagram ? 'instagram' : null,
      state.crmData?.facebook ? 'facebook' : null,
      state.crmData?.linkedin ? 'linkedin' : null
    ].filter(Boolean) as string[];
    return {
      userId: state.user?.uid ?? 'guest',
      company: state.crmData?.companyName,
      orgId: ((state.user as any)?.orgId ?? state.crmData?.orgId) as string | undefined,
      businessGoals: state.crmData?.businessGoals,
      targetAudience: state.crmData?.targetAudience,
      analytics: state.crmData?.analytics,
      subscriptionStatus: state.subscriptionStatus,
      connectedChannels,
      currentScreen,
      locale
    };
  }, [
    state.user?.uid,
    state.crmData?.companyName,
    state.user,
    state.crmData?.orgId,
    state.crmData?.businessGoals,
    state.crmData?.targetAudience,
    state.crmData?.analytics,
    state.crmData?.instagram,
    state.crmData?.facebook,
    state.crmData?.linkedin,
    state.subscriptionStatus,
    currentScreen,
    locale
  ]);

  const handleOpen = () => setOpen(true);
  const handleClose = () => setOpen(false);

  const pushMessage = (message: Message) => {
    setMessages(prev => [...prev, message]);
  };

  const handleSend = async (prompt?: string) => {
    const question = (prompt ?? input).trim();
    if (!question) return;
    setInput('');
    const userMessage: Message = { id: `user-${Date.now()}`, role: 'user', text: question };
    pushMessage(userMessage);
    setSending(true);
    try {
      const answer = await askAssistant(question, context);
      pushMessage({ id: `assistant-${Date.now()}`, role: 'assistant', text: answer });
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

  useEffect(() => {
    let cancelled = false;
    if (!state.user?.uid) {
      setLiveSocial(null);
      return () => {
        cancelled = true;
      };
    }

    void fetchLiveSocialStats(state.user.uid, analyticsScopeId, 24)
      .then(stats => {
        if (!cancelled) {
          setLiveSocial(stats);
        }
      })
      .catch(error => {
        console.warn('Failed to load live assistant summary', error);
        if (!cancelled) {
          setLiveSocial(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [state.user?.uid, analyticsScopeId]);

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
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.avoider}>
            <View style={[styles.panel, { paddingBottom: 16 + insets.bottom }]}>
              <View style={styles.panelHeader}>
                <View>
                  <Text style={styles.panelTitle}>{t('Dott Assistant')}</Text>
                  <Text style={styles.panelSubtitle}>{t('Ask about your account, performance, or next move.')}</Text>
                </View>
                <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
                  <Ionicons name="close" size={20} color={colors.text} />
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.thread} contentContainerStyle={{ paddingBottom: 16 }}>
                {messages.map(message => (
                  <View
                    key={message.id}
                    style={[styles.messageBubble, message.role === 'user' ? styles.userBubble : styles.assistantBubble]}
                  >
                    <Text style={styles.messageLabel}>{message.role === 'user' ? t('You') : t('Dott')}</Text>
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
              <View style={styles.quickPromptRow}>
                {quickPrompts.map(prompt => (
                  <TouchableOpacity key={prompt} onPress={() => handleSend(prompt)} style={styles.quickPrompt}>
                    <Text style={styles.quickPromptText}>{prompt}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  placeholder={t('Ask me anything...')}
                  placeholderTextColor={colors.subtext}
                  value={input}
                  onChangeText={setInput}
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
          accessibilityLabel={t('Open AI assistant')}
        >
          <Ionicons name="sparkles-outline" size={26} color={colors.background} />
        </TouchableOpacity>
      ) : null}
    </>
  );
};

const buildPerformanceSummary = (
  companyName: string | undefined,
  liveSocial: LiveSocialStats | null,
  t: (key: string, params?: Record<string, string | number>) => string
) => {
  if (!liveSocial) {
    return t('Hi! I am your Dott assistant. Ask me about your account, performance, or where to focus next.');
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
  panel: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 16,
    borderWidth: 1,
    borderColor: colors.border
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
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
  closeButton: {
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
