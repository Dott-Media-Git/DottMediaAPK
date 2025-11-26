import React, { useRef, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    TextInput,
    ScrollView,
    KeyboardAvoidingView,
    Platform,
    ActivityIndicator,
    Animated,
    Dimensions,
    type TextStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@constants/colors';
import { useAssistant } from '@context/AssistantContext';

const { height } = Dimensions.get('window');

export const ChatInterface: React.FC = () => {
    const {
        isChatOpen,
        toggleChat,
        messages,
        sendMessage,
        isTyping,
    } = useAssistant();
    const [inputText, setInputText] = React.useState('');
    const slideAnim = useRef(new Animated.Value(height)).current;
    const scrollViewRef = useRef<ScrollView>(null);

    useEffect(() => {
        if (isChatOpen) {
            Animated.spring(slideAnim, {
                toValue: 0,
                useNativeDriver: true,
                tension: 65,
                friction: 11,
            }).start();
        } else {
            Animated.timing(slideAnim, {
                toValue: height,
                duration: 300,
                useNativeDriver: true,
            }).start();
        }
    }, [isChatOpen]);

    const handleSend = () => {
        if (!inputText.trim()) return;
        sendMessage(inputText.trim());
        setInputText('');
    };

    return (
        <>
            {/* Floating Action Button */}
            {!isChatOpen && (
                <TouchableOpacity
                    style={styles.fab}
                    onPress={() => toggleChat(true)}
                    activeOpacity={0.8}
                >
                    <Ionicons name="chatbubble-ellipses" size={28} color="#fff" />
                </TouchableOpacity>
            )}

            {/* Chat Modal / Sheet */}
            <Animated.View
                style={[
                    styles.container,
                    { transform: [{ translateY: slideAnim }] },
                ]}
            >
                <View style={styles.header}>
                    <View style={styles.headerTitleContainer}>
                        <Ionicons name="sparkles" size={20} color={colors.accent} />
                        <Text style={styles.headerTitle}>Dotti Assistant</Text>
                    </View>
                    <TouchableOpacity onPress={() => toggleChat(false)}>
                        <Ionicons name="close" size={24} color={colors.subtext} />
                    </TouchableOpacity>
                </View>

                <ScrollView
                    ref={scrollViewRef}
                    style={styles.messagesContainer}
                    contentContainerStyle={styles.messagesContent}
                    onContentSizeChange={() =>
                        scrollViewRef.current?.scrollToEnd({ animated: true })
                    }
                >
                    {messages.length === 0 && (
                        <View style={styles.emptyState}>
                            <Ionicons
                                name="chatbubbles-outline"
                                size={48}
                                color={colors.border}
                            />
                            <Text style={styles.emptyStateText}>
                                Hi! I'm Dotti. Ask me anything about your leads, performance, or
                                navigation.
                            </Text>
                        </View>
                    )}
                    {messages.map((msg, index) => (
                        <View
                            key={index}
                            style={[
                                styles.messageBubble,
                                msg.role === 'user' ? styles.userBubble : styles.botBubble,
                            ]}
                        >
                            {msg.role === 'assistant' && (
                                <View style={styles.botIcon}>
                                    <Ionicons name="sparkles" size={12} color="#fff" />
                                </View>
                            )}
                            <View style={styles.messageContent}>
                                {msg.role === 'user' ? (
                                    <Text style={styles.userText}>{msg.content}</Text>
                                ) : (
                                    <Text style={styles.botText}>{msg.content}</Text>
                                )}
                            </View>
                        </View>
                    ))}
                    {isTyping && (
                        <View style={styles.typingIndicator}>
                            <ActivityIndicator size="small" color={colors.accent} />
                            <Text style={styles.typingText}>Dotti is thinking...</Text>
                        </View>
                    )}
                </ScrollView>

                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0}
                >
                    <View style={styles.inputContainer}>
                        <TextInput
                            style={styles.input}
                            placeholder="Ask Dotti..."
                            placeholderTextColor={colors.subtext}
                            value={inputText}
                            onChangeText={setInputText}
                            onSubmitEditing={handleSend}
                            returnKeyType="send"
                        />
                        <TouchableOpacity
                            style={[
                                styles.sendButton,
                                !inputText.trim() && styles.sendButtonDisabled,
                            ]}
                            onPress={handleSend}
                            disabled={!inputText.trim()}
                        >
                            <Ionicons
                                name="arrow-up"
                                size={20}
                                color={!inputText.trim() ? colors.subtext : '#fff'}
                            />
                        </TouchableOpacity>
                    </View>
                </KeyboardAvoidingView>
            </Animated.View>
        </>
    );
};

const styles = StyleSheet.create({
    fab: {
        position: 'absolute',
        bottom: 30,
        right: 20,
        width: 60,
        height: 60,
        borderRadius: 30,
        backgroundColor: colors.accent,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
        zIndex: 1000,
    },
    container: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '85%',
        backgroundColor: colors.background,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.2,
        shadowRadius: 12,
        elevation: 20,
        zIndex: 1001,
        borderWidth: 1,
        borderColor: colors.border,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    headerTitleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: colors.text,
        marginLeft: 8,
    },
    messagesContainer: {
        flex: 1,
        backgroundColor: colors.backgroundAlt,
    },
    messagesContent: {
        padding: 16,
        paddingBottom: 32,
    },
    emptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 60,
        paddingHorizontal: 40,
    },
    emptyStateText: {
        textAlign: 'center',
        color: colors.subtext,
        marginTop: 16,
        lineHeight: 22,
    },
    messageBubble: {
        maxWidth: '85%',
        marginBottom: 16,
        flexDirection: 'row',
        alignItems: 'flex-end',
    },
    userBubble: {
        alignSelf: 'flex-end',
        backgroundColor: colors.accent,
        borderRadius: 18,
        borderBottomRightRadius: 4,
        padding: 12,
    },
    botBubble: {
        alignSelf: 'flex-start',
        backgroundColor: colors.cardOverlay,
        borderRadius: 18,
        borderBottomLeftRadius: 4,
        padding: 12,
        borderWidth: 1,
        borderColor: colors.border,
    },
    botIcon: {
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: colors.accent,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 8,
        marginBottom: 4,
    },
    messageContent: {
        flex: 1,
    },
    userText: {
        color: '#fff',
        fontSize: 16,
    },
    botText: {
        color: colors.text,
        fontSize: 16,
    },
    typingIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 16,
        marginBottom: 16,
    },
    typingText: {
        color: colors.subtext,
        marginLeft: 8,
        fontSize: 12,
    },
    inputContainer: {
        flexDirection: 'row',
        padding: 16,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.background,
        alignItems: 'center',
    },
    input: {
        flex: 1,
        backgroundColor: colors.backgroundAlt,
        borderRadius: 24,
        paddingHorizontal: 16,
        paddingVertical: 10,
        color: colors.text,
        fontSize: 16,
        maxHeight: 100,
        borderWidth: 1,
        borderColor: colors.border,
    },
    sendButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: colors.accent,
        justifyContent: 'center',
        alignItems: 'center',
        marginLeft: 12,
    },
    sendButtonDisabled: {
        backgroundColor: colors.border,
    },
});
