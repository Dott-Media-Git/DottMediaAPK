import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { DrawerScreenProps } from '@react-navigation/drawer';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '@constants/colors';
import { useAssistant } from '@context/AssistantContext';
import { useAuth } from '@context/AuthContext';
import { useI18n } from '@context/I18nContext';

type Props = DrawerScreenProps<any, any>;

const suggestions = [
  { icon: 'sparkles-outline', title: 'Create a campaign', prompt: 'Create a fresh campaign for my business this week.' },
  { icon: 'analytics-outline', title: 'Review performance', prompt: 'Review my performance and tell me what matters most.' },
  { icon: 'calendar-outline', title: 'Plan my week', prompt: 'Plan my marketing activity for the next seven days.' },
  { icon: 'people-outline', title: 'Grow my leads', prompt: 'What should I do next to generate and convert more leads?' },
] as const;

type ChatAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  uri?: string;
  text?: string;
};

export const WebChatScreen: React.FC<Props> = ({ navigation }) => {
  const { messages, conversations, activeConversationId, sendMessage, isTyping, startNewChat, openConversation, deleteConversation } = useAssistant();
  const { state } = useAuth();
  const { t } = useI18n();
  const [input, setInput] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [listening, setListening] = useState(false);
  const [typedWelcome, setTypedWelcome] = useState('');
  const { width } = useWindowDimensions();
  const compact = width < 700;
  const scrollRef = useRef<ScrollView>(null);
  const firstName = state.crmData?.companyName || state.user?.email?.split('@')[0] || '';
  const welcomeText = firstName ? `${t('Hello')}, ${firstName}` : t('Hello, I am Dotti');

  useEffect(() => {
    if (messages.length > 0) return;
    setTypedWelcome('');
    let index = 0;
    const timer = setInterval(() => {
      index += 1;
      setTypedWelcome(welcomeText.slice(0, index));
      if (index >= welcomeText.length) clearInterval(timer);
    }, 54);
    return () => clearInterval(timer);
  }, [welcomeText, messages.length]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages, isTyping]);

  const submit = async (value = input) => {
    const text = value.trim();
    if ((!text && attachments.length === 0) || isTyping) return;
    const visibleText = text || `Shared ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`;
    const attachmentContext = attachments.map(file => {
      const details = `${file.name} (${file.mimeType}${file.size ? `, ${Math.ceil(file.size / 1024)} KB` : ''})`;
      return file.text ? `${details}\nContent:\n${file.text.slice(0, 8000)}` : details;
    }).join('\n\n');
    setInput('');
    setAttachments([]);
    setAttachmentMenuOpen(false);
    await sendMessage(visibleText, attachmentContext);
  };

  const chooseWebFiles = (kind: 'document' | 'image') => {
    if (typeof document === 'undefined') return;
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.multiple = true;
    picker.accept = kind === 'image' ? 'image/*' : '.pdf,.doc,.docx,.txt,.csv,.md,.rtf,application/pdf,text/*';
    picker.onchange = async () => {
      const files = Array.from(picker.files ?? []);
      const next = await Promise.all(files.map(async file => ({
        id: `${file.name}-${file.lastModified}-${Math.random()}`,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        uri: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
        text: !file.type.startsWith('image/') && file.size <= 500_000 ? await file.text().catch(() => undefined) : undefined,
      })));
      setAttachments(current => [...current, ...next].slice(0, 8));
      setAttachmentMenuOpen(false);
    };
    picker.click();
  };

  const chooseGallery = async () => {
    if (Platform.OS === 'web') return chooseWebFiles('image');
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Alert.alert('Gallery access', 'Allow gallery access to share images with Dotti.');
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 0.8 });
    if (!result.canceled) {
      setAttachments(current => [...current, ...result.assets.map(asset => ({
        id: asset.assetId || `${asset.uri}-${Math.random()}`,
        name: asset.fileName || 'Gallery image',
        mimeType: asset.mimeType || 'image/jpeg',
        size: asset.fileSize,
        uri: asset.uri,
      }))].slice(0, 8));
    }
    setAttachmentMenuOpen(false);
  };

  const chooseDocument = () => {
    if (Platform.OS === 'web') return chooseWebFiles('document');
    setAttachmentMenuOpen(false);
    Alert.alert('Document sharing', 'Document selection is available in Dotti web. Gallery images are available here.');
  };

  const toggleVoice = () => {
    if (listening) return;
    const browser = globalThis as any;
    const Recognition = browser.SpeechRecognition || browser.webkitSpeechRecognition;
    if (!Recognition) return Alert.alert('Voice chat', 'Voice transcription is available in Chrome, Edge, and supported mobile browsers.');
    const recognition = new Recognition();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onstart = () => setListening(true);
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results ?? []).map((result: any) => result?.[0]?.transcript ?? '').join('');
      setInput(transcript);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognition.start();
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.topbar, compact && styles.topbarCompact]}>
        <TouchableOpacity
          style={styles.menuButton}
          onPress={() => navigation.toggleDrawer()}
          accessibilityRole="button"
          accessibilityLabel={t('Toggle navigation menu')}
        >
          <Ionicons name="menu-outline" size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.brandRow}>
          <LinearGradient colors={[colors.accent, colors.accentSecondary]} style={styles.brandMark}>
            <Ionicons name="sparkles" size={16} color="#FFFFFF" />
          </LinearGradient>
          <View>
            <Text style={styles.brandTitle}>Dotti</Text>
            <View style={styles.statusRow}>
              <View style={styles.statusDot} />
              <Text style={styles.statusText}>{t('Ready to help')}</Text>
            </View>
          </View>
        </View>
        <View style={styles.topbarActions}>
          <TouchableOpacity style={[styles.newChatButton, compact && styles.newChatButtonCompact]} accessibilityRole="button" onPress={() => setHistoryOpen(true)}>
            <Ionicons name="time-outline" size={18} color={colors.text} />
            {!compact ? <Text style={styles.newChatLabel}>{t('Previous conversations')}</Text> : null}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.newChatButton, compact && styles.newChatButtonCompact]} accessibilityRole="button" onPress={startNewChat}>
            <Ionicons name="create-outline" size={18} color={colors.text} />
            {!compact ? <Text style={styles.newChatLabel}>{t('New chat')}</Text> : null}
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.thread}
        contentContainerStyle={[styles.threadContent, compact && styles.threadContentCompact, messages.length === 0 && styles.emptyThreadContent]}
        keyboardShouldPersistTaps="handled"
      >
        {messages.length === 0 ? (
          <View style={styles.welcome}>
            <LinearGradient colors={[colors.accent, colors.accentSecondary]} style={styles.heroMark}>
              <Ionicons name="sparkles" size={30} color="#FFFFFF" />
            </LinearGradient>
            <Text style={[styles.welcomeTitle, compact && styles.welcomeTitleCompact]}>{typedWelcome}<Text style={styles.typingCursor}>|</Text></Text>
            <Text style={styles.welcomeCopy}>{t('What would you like to create, understand, or grow today?')}</Text>
            <View style={styles.suggestionGrid}>
              {suggestions.map(item => (
                <TouchableOpacity key={item.title} style={[styles.suggestion, compact && styles.suggestionCompact]} onPress={() => void submit(t(item.prompt))}>
                  <View style={styles.suggestionIcon}>
                    <Ionicons name={item.icon} size={19} color={colors.accent} />
                  </View>
                  <Text style={styles.suggestionTitle}>{t(item.title)}</Text>
                  <Ionicons name="arrow-forward" size={17} color={colors.subtext} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : (
          <View style={styles.messageList}>
            {messages.map((message, index) => (
              <View key={`${message.role}-${index}`} style={[styles.messageRow, message.role === 'user' && styles.userMessageRow]}>
                {message.role === 'assistant' ? (
                  <LinearGradient colors={[colors.accent, colors.accentSecondary]} style={styles.avatar}>
                    <Ionicons name="sparkles" size={15} color="#FFFFFF" />
                  </LinearGradient>
                ) : null}
                <View style={[styles.message, message.role === 'user' ? styles.userMessage : styles.assistantMessage]}>
                  {message.role === 'assistant' ? <Text style={styles.messageAuthor}>Dotti</Text> : null}
                  <Text style={styles.messageText}>{message.content}</Text>
                </View>
              </View>
            ))}
            {isTyping ? (
              <View style={styles.messageRow}>
                <LinearGradient colors={[colors.accent, colors.accentSecondary]} style={styles.avatar}>
                  <Ionicons name="sparkles" size={15} color="#FFFFFF" />
                </LinearGradient>
                <View style={[styles.message, styles.assistantMessage, styles.typing]}>
                  <ActivityIndicator size="small" color={colors.accent} />
                  <Text style={styles.typingText}>{t('Dotti is thinking...')}</Text>
                </View>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>

      <View style={[styles.composerArea, compact && styles.composerAreaCompact]}>
        {attachments.length ? (
          <ScrollView horizontal style={styles.attachmentStrip} contentContainerStyle={styles.attachmentStripContent} showsHorizontalScrollIndicator={false}>
            {attachments.map(file => (
              <View key={file.id} style={styles.attachmentChip}>
                {file.uri && file.mimeType.startsWith('image/') ? <Image source={{ uri: file.uri }} style={styles.attachmentPreview} /> : <View style={styles.fileIcon}><Ionicons name="document-text-outline" size={18} color={colors.accent} /></View>}
                <View style={styles.attachmentCopy}><Text style={styles.attachmentName} numberOfLines={1}>{file.name}</Text><Text style={styles.attachmentMeta}>{file.mimeType.startsWith('image/') ? 'Image' : 'Document'}</Text></View>
                <TouchableOpacity onPress={() => setAttachments(current => current.filter(item => item.id !== file.id))}><Ionicons name="close" size={18} color={colors.subtext} /></TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        ) : null}
        <View style={styles.composer}>
          <TouchableOpacity style={styles.composerToolButton} onPress={() => setAttachmentMenuOpen(value => !value)} accessibilityLabel="Attach files">
            <Ionicons name={attachmentMenuOpen ? 'close' : 'add'} size={23} color={colors.text} />
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder={t('Message Dotti...')}
            placeholderTextColor={colors.subtext}
            multiline
            onSubmitEditing={() => void submit()}
            blurOnSubmit={false}
          />
          <TouchableOpacity style={[styles.composerToolButton, listening && styles.voiceButtonActive]} onPress={toggleVoice} accessibilityLabel="Talk to Dotti">
            <Ionicons name={listening ? 'mic' : 'mic-outline'} size={21} color={listening ? '#FFFFFF' : colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sendButton, (!input.trim() && attachments.length === 0 || isTyping) && styles.sendButtonDisabled]}
            onPress={() => void submit()}
            disabled={(!input.trim() && attachments.length === 0) || isTyping}
            accessibilityLabel={t('Send message')}
          >
            <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
        <Text style={styles.disclaimer}>{t('Dotti can make mistakes. Review important information before acting.')}</Text>
        {attachmentMenuOpen ? (
          <View style={[styles.attachmentMenu, compact && styles.attachmentMenuCompact]}>
            <TouchableOpacity style={styles.attachmentMenuItem} onPress={chooseDocument}><View style={styles.attachmentMenuIcon}><Ionicons name="document-outline" size={20} color={colors.text} /></View><View><Text style={styles.attachmentMenuTitle}>Upload document</Text><Text style={styles.attachmentMenuSubtitle}>PDF, Word, text or CSV</Text></View></TouchableOpacity>
            <TouchableOpacity style={styles.attachmentMenuItem} onPress={() => void chooseGallery()}><View style={styles.attachmentMenuIcon}><Ionicons name="images-outline" size={20} color={colors.text} /></View><View><Text style={styles.attachmentMenuTitle}>Add from gallery</Text><Text style={styles.attachmentMenuSubtitle}>Photos and images</Text></View></TouchableOpacity>
          </View>
        ) : null}
      </View>

      <Modal visible={historyOpen} transparent animationType="fade" onRequestClose={() => setHistoryOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setHistoryOpen(false)}>
          <View style={[styles.historyPanel, compact && styles.historyPanelCompact]} onStartShouldSetResponder={() => true}>
            <View style={styles.historyHeader}><View><Text style={styles.historyTitle}>Previous conversations</Text><Text style={styles.historySubtitle}>{conversations.length} saved chats</Text></View><TouchableOpacity style={styles.headerIconButton} onPress={() => setHistoryOpen(false)}><Ionicons name="close" size={21} color={colors.text} /></TouchableOpacity></View>
            <ScrollView style={styles.historyList} contentContainerStyle={styles.historyListContent}>
              {conversations.length ? conversations.map(conversation => (
                <TouchableOpacity key={conversation.id} style={[styles.historyItem, activeConversationId === conversation.id && styles.historyItemActive]} onPress={() => { openConversation(conversation.id); setHistoryOpen(false); }}>
                  <View style={styles.historyItemIcon}><Ionicons name="chatbubble-outline" size={18} color={colors.accent} /></View>
                  <View style={styles.attachmentCopy}><Text style={styles.historyItemTitle} numberOfLines={1}>{conversation.title}</Text><Text style={styles.historyItemDate}>{new Date(conversation.updatedAt).toLocaleString()}</Text></View>
                  <TouchableOpacity style={styles.deleteHistoryButton} onPress={(event) => { event.stopPropagation?.(); void deleteConversation(conversation.id); }}><Ionicons name="trash-outline" size={17} color={colors.subtext} /></TouchableOpacity>
                </TouchableOpacity>
              )) : <View style={styles.emptyHistory}><Ionicons name="chatbubbles-outline" size={32} color={colors.subtext} /><Text style={styles.historyItemTitle}>No previous conversations yet</Text><Text style={styles.historySubtitle}>Your chats with Dotti will appear here.</Text></View>}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  topbar: { height: 72, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.background },
  topbarCompact: { height: 64, paddingHorizontal: 12 },
  menuButton: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardOverlay, marginRight: 18, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : null) },
  brandRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 11 },
  brandMark: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  brandTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  statusText: { color: colors.subtext, fontSize: 11 },
  topbarActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  newChatButton: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, height: 40, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  newChatButtonCompact: { width: 40, paddingHorizontal: 0, justifyContent: 'center' },
  newChatLabel: { color: colors.text, fontSize: 13, fontWeight: '700' },
  thread: { flex: 1 },
  threadContent: { flexGrow: 1, paddingHorizontal: 24, paddingVertical: 34 },
  threadContentCompact: { paddingHorizontal: 16, paddingVertical: 24 },
  emptyThreadContent: { justifyContent: 'center' },
  welcome: { width: '100%', maxWidth: 820, alignSelf: 'center', alignItems: 'center', paddingBottom: 24 },
  heroMark: { width: 62, height: 62, borderRadius: 21, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  welcomeTitle: { color: colors.text, fontSize: 36, lineHeight: 43, fontWeight: '800', letterSpacing: -1 },
  welcomeTitleCompact: { fontSize: 28, lineHeight: 34, textAlign: 'center' },
  typingCursor: { color: colors.accent, fontWeight: '400' },
  welcomeCopy: { color: colors.subtext, fontSize: 17, lineHeight: 26, textAlign: 'center', marginTop: 10 },
  suggestionGrid: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 34 },
  suggestion: { width: '48%', minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardOverlay },
  suggestionCompact: { width: '100%', minHeight: 66, padding: 13 },
  suggestionIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.backgroundAlt },
  suggestionTitle: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '700' },
  messageList: { width: '100%', maxWidth: 880, alignSelf: 'center' },
  messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 28 },
  userMessageRow: { justifyContent: 'flex-end' },
  avatar: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  message: { maxWidth: '82%', paddingHorizontal: 17, paddingVertical: 13 },
  assistantMessage: { flex: 1, paddingTop: 5 },
  userMessage: { backgroundColor: colors.surface, borderRadius: 18, borderBottomRightRadius: 6 },
  messageAuthor: { color: colors.text, fontWeight: '800', fontSize: 13, marginBottom: 7 },
  messageText: { color: colors.text, fontSize: 15, lineHeight: 24 },
  typing: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  typingText: { color: colors.subtext, fontSize: 13 },
  composerArea: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16, backgroundColor: colors.background },
  composerAreaCompact: { paddingHorizontal: 12, paddingBottom: 10 },
  attachmentStrip: { width: '100%', maxWidth: 880, alignSelf: 'center', marginBottom: 9, flexGrow: 0 },
  attachmentStripContent: { gap: 8, paddingHorizontal: 1 },
  attachmentChip: { width: 218, minHeight: 58, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardOverlay, padding: 7, flexDirection: 'row', alignItems: 'center', gap: 9 },
  attachmentPreview: { width: 43, height: 43, borderRadius: 9, backgroundColor: colors.backgroundAlt },
  fileIcon: { width: 43, height: 43, borderRadius: 9, backgroundColor: colors.backgroundAlt, alignItems: 'center', justifyContent: 'center' },
  attachmentCopy: { flex: 1, minWidth: 0 },
  attachmentName: { color: colors.text, fontSize: 12, fontWeight: '700' },
  attachmentMeta: { color: colors.subtext, fontSize: 10, marginTop: 3 },
  composer: { width: '100%', maxWidth: 880, minHeight: 62, maxHeight: 160, alignSelf: 'center', flexDirection: 'row', alignItems: 'flex-end', borderRadius: 22, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardOverlay, padding: 9, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  composerToolButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.backgroundAlt },
  voiceButtonActive: { backgroundColor: colors.accent },
  input: { flex: 1, minHeight: 42, maxHeight: 130, color: colors.text, fontSize: 15, lineHeight: 22, paddingHorizontal: 12, paddingVertical: 10, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : null) },
  sendButton: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  sendButtonDisabled: { opacity: 0.38 },
  disclaimer: { color: colors.subtext, fontSize: 11, textAlign: 'center', marginTop: 9 },
  attachmentMenu: { position: 'absolute', left: 24, bottom: 94, width: 290, padding: 8, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.backgroundAlt, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 20 },
  attachmentMenuCompact: { left: 12, bottom: 84, width: 270 },
  attachmentMenuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 11, borderRadius: 12 },
  attachmentMenuIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.cardOverlay, alignItems: 'center', justifyContent: 'center' },
  attachmentMenuTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  attachmentMenuSubtitle: { color: colors.subtext, fontSize: 11, marginTop: 2 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.52)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  historyPanel: { width: '100%', maxWidth: 620, maxHeight: '78%', minHeight: 360, borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.backgroundAlt, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.36, shadowRadius: 30, shadowOffset: { width: 0, height: 16 }, elevation: 30 },
  historyPanelCompact: { maxHeight: '88%', minHeight: 420, borderRadius: 20 },
  historyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: colors.border },
  historyTitle: { color: colors.text, fontSize: 19, fontWeight: '800' },
  historySubtitle: { color: colors.subtext, fontSize: 12, marginTop: 3 },
  headerIconButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cardOverlay },
  historyList: { flex: 1 },
  historyListContent: { padding: 10, gap: 5 },
  historyItem: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 14, borderWidth: 1, borderColor: 'transparent' },
  historyItemActive: { backgroundColor: colors.cardOverlay, borderColor: colors.border },
  historyItemIcon: { width: 39, height: 39, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cardOverlay },
  historyItemTitle: { color: colors.text, fontSize: 13, fontWeight: '700' },
  historyItemDate: { color: colors.subtext, fontSize: 10, marginTop: 4 },
  deleteHistoryButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  emptyHistory: { minHeight: 270, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 30 },
});
