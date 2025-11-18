import React, { useMemo, useState } from 'react';
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
import { askAssistant } from '@services/assistant';

type Message = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
};

const quickPrompts = [
  'How is my performance this week?',
  'What should I check next?',
  'Give me tips to boost conversions.'
];

export const FloatingAssistant: React.FC = () => {
  const { state } = useAuth();
  const { enabled, hydrated, currentScreen } = useAssistant();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<Message[]>(() => [
    {
      id: 'welcome',
      role: 'assistant',
      text: buildPerformanceSummary(state.crmData?.analytics, state.crmData?.companyName)
    }
  ]);

  const canDisplay = hydrated && enabled && Boolean(state.user);

  const context = useMemo(
    () => ({
      userId: state.user?.uid ?? 'guest',
      company: state.crmData?.companyName,
      analytics: state.crmData?.analytics,
      currentScreen
    }),
    [state.user?.uid, state.crmData?.companyName, state.crmData?.analytics, currentScreen]
  );

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
        text: 'I ran into an issue answering that. Please try again shortly.'
      });
    } finally {
      setSending(false);
    }
  };

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
                  <Text style={styles.panelTitle}>Dott Assistant</Text>
                  <Text style={styles.panelSubtitle}>Ask about performance or where to go next.</Text>
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
                    <Text style={styles.messageLabel}>{message.role === 'user' ? 'You' : 'Dott'}</Text>
                    <Text style={styles.messageText}>{message.text}</Text>
                  </View>
                ))}
                {sending ? (
                  <View style={[styles.messageBubble, styles.assistantBubble, styles.typingBubble]}>
                    <ActivityIndicator size="small" color={colors.accent} />
                    <Text style={[styles.messageText, { marginLeft: 8 }]}>Thinking...</Text>
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
                  placeholder="Ask me anything..."
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
        accessibilityLabel="Open AI assistant"
      >
        <Ionicons name="sparkles-outline" size={26} color={colors.background} />
      </TouchableOpacity>
    </>
  );
};

const buildPerformanceSummary = (
  analytics?: { leads: number; engagement: number; conversions: number; feedbackScore: number },
  companyName?: string
) => {
  if (!analytics) {
    return 'Hi! I am your Dott assistant. Ask me about performance metrics or where to head next in the app.';
  }
  return `Hi${companyName ? ` ${companyName} team` : ''}! Leads are at ${analytics.leads}, engagement ${analytics.engagement}%, conversions ${analytics.conversions} and feedback ${analytics.feedbackScore}/5. Ask for deeper insight or guidance.`;
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
