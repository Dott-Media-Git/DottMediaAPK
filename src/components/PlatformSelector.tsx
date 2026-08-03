import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '@constants/colors';

type Props = {
  options: readonly string[];
  selected: string[];
  onToggle: (platform: string) => void;
  translate?: (value: string) => string;
};

const GROUPS = [
  { title: 'Main feeds', subtitle: 'Standard feed posts', values: ['instagram', 'facebook', 'threads', 'linkedin', 'twitter'] },
  { title: 'Stories & short video', subtitle: 'Vertical and short-form formats', values: ['instagram_story', 'instagram_reels', 'facebook_story', 'tiktok'] },
  { title: 'Video & direct', subtitle: 'Long-form video and messages', values: ['youtube', 'whatsapp'] },
] as const;

const LABELS: Record<string, string> = {
  instagram: 'Instagram', instagram_story: 'Instagram Story', instagram_reels: 'Instagram Reels',
  facebook: 'Facebook', facebook_story: 'Facebook Story', threads: 'Threads', linkedin: 'LinkedIn',
  twitter: 'X', youtube: 'YouTube', tiktok: 'TikTok', whatsapp: 'WhatsApp',
};

const MARKS: Record<string, string> = {
  instagram: 'IG', instagram_story: 'IS', instagram_reels: 'IR', facebook: 'f', facebook_story: 'FS',
  threads: '@', linkedin: 'in', twitter: 'X', youtube: '▶', tiktok: '♪', whatsapp: 'WA',
};

export const PlatformSelector: React.FC<Props> = ({ options, selected, onToggle, translate = value => value }) => (
  <View style={styles.shell}>
    <View style={styles.header}>
      <View>
        <Text style={styles.title}>{translate('Choose platforms')}</Text>
        <Text style={styles.subtitle}>{translate('Select every channel that should receive this content.')}</Text>
      </View>
      <View style={styles.count}><Text style={styles.countText}>{selected.length} {translate('selected')}</Text></View>
    </View>
    {GROUPS.map(group => {
      const values = group.values.filter(value => options.includes(value));
      if (!values.length) return null;
      return (
        <View key={group.title} style={styles.group}>
          <Text style={styles.groupTitle}>{translate(group.title)}</Text>
          <Text style={styles.groupSubtitle}>{translate(group.subtitle)}</Text>
          <View style={styles.grid}>
            {values.map(platform => {
              const active = selected.includes(platform);
              return (
                <TouchableOpacity
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: active }}
                  key={platform}
                  onPress={() => onToggle(platform)}
                  style={[styles.option, active && styles.optionActive]}
                >
                  <View style={[styles.mark, active && styles.markActive]}><Text style={styles.markText}>{MARKS[platform]}</Text></View>
                  <Text style={[styles.optionText, active && styles.optionTextActive]} numberOfLines={2}>{translate(LABELS[platform])}</Text>
                  <View style={[styles.check, active && styles.checkActive]}><Text style={styles.checkText}>{active ? '✓' : ''}</Text></View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      );
    })}
  </View>
);

const styles = StyleSheet.create({
  shell: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 20, padding: 14, marginBottom: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  title: { color: colors.text, fontSize: 16, fontWeight: '800' },
  subtitle: { color: colors.subtext, fontSize: 12, lineHeight: 17, marginTop: 3, maxWidth: 440 },
  count: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: 'rgba(139,93,255,0.16)' },
  countText: { color: colors.accent, fontSize: 11, fontWeight: '800' },
  group: { marginTop: 8 }, groupTitle: { color: colors.text, fontSize: 13, fontWeight: '800' },
  groupSubtitle: { color: colors.subtext, fontSize: 11, marginTop: 2, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { width: 152, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.backgroundAlt, padding: 9 },
  optionActive: { borderColor: colors.accent, backgroundColor: 'rgba(139,93,255,0.14)' },
  mark: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  markActive: { backgroundColor: colors.accent }, markText: { color: colors.text, fontSize: 11, fontWeight: '900' },
  optionText: { color: colors.subtext, flex: 1, fontSize: 12, fontWeight: '700' }, optionTextActive: { color: colors.text },
  check: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checkActive: { borderColor: colors.accent, backgroundColor: colors.accent }, checkText: { color: '#fff', fontSize: 11, fontWeight: '900' },
});
