import React from 'react';
import { Linking, StyleSheet } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { colors } from '@constants/colors';

export const AssistantMarkdown: React.FC<{ children: string }> = ({ children }) => (
  <Markdown
    style={markdownStyles}
    mergeStyle
    onLinkPress={url => {
      void Linking.openURL(url);
      return false;
    }}
  >
    {children}
  </Markdown>
);

const markdownStyles = StyleSheet.create({
  body: { color: colors.text, fontSize: 15, lineHeight: 23, flexShrink: 1 },
  paragraph: { marginTop: 0, marginBottom: 10 },
  heading1: { color: colors.text, fontSize: 22, lineHeight: 28, fontWeight: '800', marginTop: 8, marginBottom: 10 },
  heading2: { color: colors.text, fontSize: 19, lineHeight: 25, fontWeight: '800', marginTop: 8, marginBottom: 8 },
  heading3: { color: colors.text, fontSize: 17, lineHeight: 23, fontWeight: '700', marginTop: 6, marginBottom: 7 },
  strong: { color: colors.text, fontWeight: '700' },
  em: { fontStyle: 'italic' },
  bullet_list: { marginTop: 2, marginBottom: 10 },
  ordered_list: { marginTop: 2, marginBottom: 10 },
  list_item: { marginBottom: 4 },
  bullet_list_icon: { color: colors.accent, marginRight: 7 },
  ordered_list_icon: { color: colors.accent, marginRight: 7 },
  blockquote: {
    backgroundColor: colors.backgroundAlt,
    borderLeftColor: colors.accent,
    borderLeftWidth: 3,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginVertical: 8,
  },
  code_inline: {
    color: colors.text,
    backgroundColor: colors.backgroundAlt,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    paddingHorizontal: 4,
  },
  code_block: {
    color: colors.text,
    backgroundColor: colors.backgroundAlt,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 10,
    marginVertical: 8,
  },
  fence: {
    color: colors.text,
    backgroundColor: colors.backgroundAlt,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 10,
    marginVertical: 8,
  },
  link: { color: colors.accent, textDecorationLine: 'underline' },
  table: {
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    marginVertical: 10,
    flexShrink: 1,
  },
  thead: { backgroundColor: colors.backgroundAlt },
  tr: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
  },
  th: { color: colors.text, fontWeight: '700', padding: 7, flex: 1, flexShrink: 1 },
  td: { color: colors.text, padding: 7, flex: 1, flexShrink: 1 },
  hr: { backgroundColor: colors.border, height: StyleSheet.hairlineWidth, marginVertical: 12 },
});
