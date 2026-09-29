import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '@constants/colors';
import { DMButton } from '@components/DMButton';
import type { MediaLibraryAsset } from '@services/mediaLibrary';
import { fetchGalleryAutoPost, startGalleryAutoPost, stopGalleryAutoPost,
  type GalleryAutoPostJob, type GalleryAutoPostPlatform } from '@services/social';

const names: Record<GalleryAutoPostPlatform, string> = {
  facebook: 'Facebook', instagram: 'Instagram', threads: 'Threads', linkedin: 'LinkedIn',
  twitter: 'X / Twitter', youtube: 'YouTube (videos)', tiktok: 'TikTok (videos)',
};
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Unable to update Auto-post. Please try again.';

export function GalleryAutoPost({ assets, uploading }: { assets: MediaLibraryAsset[]; uploading: boolean }) {
  const [job, setJob] = useState<GalleryAutoPostJob | null>(null);
  const [platforms, setPlatforms] = useState<GalleryAutoPostPlatform[]>([]);
  const [chosen, setChosen] = useState<GalleryAutoPostPlatform[]>([]);
  const [hours, setHours] = useState('1');
  const [caption, setCaption] = useState('');
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(true);
  const mutating = useRef(false);
  const version = useRef(0);
  const interval = Number(hours.trim());
  const validInterval = hours.trim().length > 0 && Number.isFinite(interval) && interval >= 1 && interval <= 24;
  const photosSupported = !assets.some(asset => asset.kind === 'image') || chosen.some(platform => !['youtube', 'tiktok'].includes(platform));

  const refresh = useCallback(async () => {
    const requestVersion = version.current;
    try {
      const response = await fetchGalleryAutoPost();
      if (!mounted.current || mutating.current || requestVersion !== version.current) return;
      setJob(response.job);
      setPlatforms(response.platforms);
      setLoaded(true);
      setError('');
    } catch (cause) {
      if (mounted.current && !mutating.current && requestVersion === version.current) setError(errorText(cause));
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => { if (!mutating.current) void refresh(); }, 30_000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, [refresh]);

  const open = () => {
    setHours(String(job?.intervalHours ?? 1));
    setCaption(job?.caption ?? '');
    setChosen(job?.platforms.filter(platform => platforms.includes(platform)) ?? platforms);
    setError('');
    setNotice('');
    setVisible(true);
  };
  const start = async () => {
    if (mutating.current || !validInterval || !chosen.length || !photosSupported) return;
    mutating.current = true;
    version.current += 1;
    setBusy(true);
    setError('');
    try {
      const response = await startGalleryAutoPost({ intervalHours: interval, platforms: chosen, caption: caption.trim(),
        assets: assets.map(({ id, url, kind, name }) => ({ id, url, kind, name: name ?? '' })) });
      if (!mounted.current) return;
      setJob(response.job);
      setVisible(false);
      setNotice('Auto-post started. Your gallery will repeat until you stop it.');
    } catch (cause) {
      if (mounted.current) setError(errorText(cause));
    } finally {
      mutating.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const stop = async () => {
    if (mutating.current) return;
    mutating.current = true;
    version.current += 1;
    setBusy(true);
    setError('');
    try {
      const response = await stopGalleryAutoPost();
      if (!mounted.current) return;
      setJob(response.job);
      setNotice('Auto-post stopped. A post already being sent may still finish.');
    } catch (cause) { if (mounted.current) setError(errorText(cause)); }
    finally { mutating.current = false; if (mounted.current) setBusy(false); }
  };
  const active = Boolean(job?.active);
  const hasChanged = active && (assets.length !== job?.assets.length || assets.some((asset, index) => asset.url !== job?.assets[index]?.url));

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Auto-post your gallery</Text>
      <Text style={styles.copy}>Post one item at a time, then repeat your gallery—even when Dotti is closed.</Text>
      {active && job ? <>
        <Text style={styles.status}>Active · Every {job.intervalHours === 24 ? 'day' : `${job.intervalHours} hour${job.intervalHours === 1 ? '' : 's'}`} · {job.assets.length} items</Text>
        <Text style={styles.copy}>{job.platforms.map(platform => names[platform]).join(', ')}</Text>
        <Text style={styles.copy}>{job.runToken ? 'Posting now…' : job.nextRunAt ? `Next post: ${new Date(job.nextRunAt).toLocaleString()}` : ''}</Text>
        <DMButton title="Stop Auto-post" onPress={() => void stop()} loading={busy} style={styles.button} />
      </> : <DMButton title="Auto-post" onPress={open} style={styles.button}
        disabled={!loaded || uploading || !assets.length || busy || Boolean(job?.runToken)} />}
      {!active && job?.runToken ? <Text style={styles.copy}>Finishing the current post…</Text> : null}
      {hasChanged ? <Text style={styles.copy}>Your gallery has changed. Stop and restart Auto-post to use the updated gallery.</Text> : null}
      {job?.error ? <Text accessibilityRole="alert" style={styles.error}>Auto-post paused: {job.error}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.copy}>{notice}</Text> : null}
      {error && !visible ? <View><Text accessibilityRole="alert" style={styles.error}>{error}</Text>
        <Pressable accessibilityRole="button" onPress={() => void refresh()}><Text style={styles.link}>Refresh Auto-post status</Text></Pressable></View> : null}
      {!assets.length ? <Text style={styles.copy}>Upload photos or videos to get started.</Text> : null}
      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => { if (!busy) setVisible(false); }}>
        <View style={styles.overlay}>
          <ScrollView style={styles.dialog} contentContainerStyle={styles.dialogContent} keyboardShouldPersistTaps="handled" accessibilityViewIsModal>
            <Text accessibilityRole="header" style={styles.title}>Start Auto-post</Text>
            <Text style={styles.copy}>Use all {assets.length} gallery items in the order shown. The first post starts within about a minute; the gallery repeats until you turn it off.</Text>
            <Text style={styles.label}>Time between posts (hours)</Text>
            <TextInput accessibilityLabel="Time between posts in hours" value={hours} onChangeText={setHours}
              keyboardType="decimal-pad" style={styles.input} editable={!busy} maxLength={5} />
            <Text style={validInterval ? styles.copy : styles.error}>Choose 1–24 hours (24 hours = one day).</Text>
            <View style={styles.options}>{[1, 3, 6, 12, 24].map(value => <Pressable key={value} disabled={busy}
              accessibilityRole="radio" accessibilityState={{ selected: interval === value }} onPress={() => setHours(String(value))}
              style={[styles.chip, interval === value && styles.selected]}><Text style={styles.chipText}>{value === 24 ? '1 day' : `${value}h`}</Text></Pressable>)}</View>
            <Text style={styles.label}>Post to connected accounts</Text>
            {!platforms.length ? <Text style={styles.error}>Connect a social account in Social Connections, then return here.</Text> : null}
            <View style={styles.options}>{platforms.map(platform => <Pressable key={platform} disabled={busy}
              accessibilityRole="checkbox" accessibilityLabel={names[platform]} accessibilityState={{ checked: chosen.includes(platform) }}
              onPress={() => setChosen(current => current.includes(platform) ? current.filter(item => item !== platform) : [...current, platform])}
              style={[styles.chip, chosen.includes(platform) && styles.selected]}><Text style={styles.chipText}>{names[platform]}</Text></Pressable>)}</View>
            {!photosSupported ? <Text style={styles.error}>Select an account that supports photos. YouTube and TikTok receive videos only.</Text> : null}
            <Text style={styles.copy}>Instagram videos are posted as Reels. Your plan's posting allowance applies.</Text>
            <Text style={styles.label}>Caption for these posts (optional)</Text>
            <TextInput accessibilityLabel="Caption for gallery posts" value={caption} onChangeText={setCaption} multiline
              maxLength={2200} style={[styles.input, styles.caption]} editable={!busy} placeholder="Add a caption" placeholderTextColor={colors.subtext} />
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <DMButton title="Confirm & start Auto-post" onPress={() => void start()} loading={busy}
              disabled={!validInterval || !chosen.length || !photosSupported || !assets.length || assets.length > 200 || uploading || active} />
            {assets.length > 200 ? <Text style={styles.error}>Auto-post supports up to 200 gallery items.</Text> : null}
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => setVisible(false)} style={styles.cancel}><Text style={styles.link}>Cancel</Text></Pressable>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { padding: 20, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.backgroundAlt, gap: 10 },
  title: { fontSize: 21, fontWeight: '800', color: colors.text },
  copy: { color: colors.subtext, fontSize: 14, lineHeight: 21 },
  status: { color: colors.text, fontWeight: '700', fontSize: 15 },
  button: { width: 200, maxWidth: '100%' },
  error: { color: colors.danger, lineHeight: 21 },
  link: { color: colors.text, fontWeight: '700', paddingVertical: 8 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  dialog: { flexGrow: 0, width: '100%', maxWidth: 540, maxHeight: '90%', backgroundColor: colors.backgroundAlt, borderRadius: 22, borderWidth: 1, borderColor: colors.border },
  dialogContent: { padding: 24, gap: 12 },
  label: { color: colors.text, fontWeight: '700', marginTop: 6 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, color: colors.text, fontSize: 16, backgroundColor: colors.background },
  caption: { minHeight: 80, textAlignVertical: 'top' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 12 },
  selected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontWeight: '600' },
  cancel: { alignItems: 'center' },
});
