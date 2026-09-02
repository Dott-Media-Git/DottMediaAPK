import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import { colors } from '@constants/colors';
import { DMButton } from '@components/DMButton';
import { useAuth } from '@context/AuthContext';
import { uploadMediaFiles } from '@services/social';
import {
  addMediaLibraryFiles,
  loadMediaLibrary,
  saveMediaLibrary,
  type MediaLibraryAsset,
} from '@services/mediaLibrary';

type Filter = 'all' | 'image' | 'video';

export const ContentGalleryScreen: React.FC = () => {
  const { state } = useAuth();
  const navigation = useNavigation<any>();
  const fileInputRef = useRef<any>(null);
  const [assets, setAssets] = useState<MediaLibraryAsset[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');

  const userId = state.user?.uid ?? '';

  useEffect(() => {
    if (!userId) return;
    loadMediaLibrary(userId).then(setAssets).catch(() => setMessage('Unable to load your gallery.'));
  }, [userId]);

  const visibleAssets = useMemo(
    () => assets.filter(asset => filter === 'all' || asset.kind === filter),
    [assets, filter],
  );

  const handleFiles = async (files: File[]) => {
    if (!files.length || !userId) return;
    setUploading(true);
    setMessage(`Uploading ${files.length} file${files.length === 1 ? '' : 's'}…`);
    try {
      const response = await uploadMediaFiles(files);
      const next = await addMediaLibraryFiles(userId, response.files ?? []);
      setAssets(next);
      setMessage(`${response.files?.length ?? 0} file${response.files?.length === 1 ? '' : 's'} ready to use.`);
    } catch (error: any) {
      setMessage(error?.message ?? 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const chooseFiles = async () => {
    if (Platform.OS === 'web') {
      fileInputRef.current?.click();
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMessage('Allow gallery access to upload photos and videos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (!result.canceled) {
      const nativeFiles = result.assets.map(asset => ({
        uri: asset.uri,
        name: asset.fileName || `upload-${Date.now()}.${asset.type === 'video' ? 'mp4' : 'jpg'}`,
        type: asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg'),
      })) as any;
      await handleFiles(nativeFiles);
    }
  };

  const toggleAsset = (id: string) => {
    setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  };

  const removeSelected = async () => {
    const next = assets.filter(asset => !selected.includes(asset.id));
    setAssets(next);
    setSelected([]);
    await saveMediaLibrary(userId, next);
    setMessage('Removed from your gallery.');
  };

  const useInSchedule = () => {
    const chosen = assets.filter(asset => selected.includes(asset.id));
    if (!chosen.length) {
      setMessage('Select at least one photo or video first.');
      return;
    }
    navigation.navigate('SchedulePost', {
      gallerySelection: chosen,
      gallerySelectionKey: Date.now(),
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.hero}>
        <View style={styles.heroIcon}><Ionicons name="images-outline" size={28} color="#ffffff" /></View>
        <View style={styles.heroCopy}>
          <Text style={styles.title}>Content Gallery</Text>
          <Text style={styles.subtitle}>Upload once, then quickly select content whenever you schedule a post.</Text>
        </View>
        <DMButton title={uploading ? 'Uploading…' : 'Upload photos & videos'} onPress={() => void chooseFiles()} disabled={uploading} />
        {Platform.OS === 'web' && React.createElement('input', {
          ref: fileInputRef,
          type: 'file',
          multiple: true,
          accept: 'image/*,video/*',
          style: { display: 'none' },
          onChange: (event: any) => void handleFiles(Array.from(event.target.files ?? []) as File[]),
        })}
      </View>

      {message ? <View style={styles.message}><Text style={styles.messageText}>{message}</Text></View> : null}

      <View style={styles.toolbar}>
        <View style={styles.filters}>
          {(['all', 'image', 'video'] as Filter[]).map(value => (
            <TouchableOpacity key={value} onPress={() => setFilter(value)} style={[styles.filter, filter === value && styles.filterActive]}>
              <Text style={[styles.filterText, filter === value && styles.filterTextActive]}>{value === 'all' ? 'All' : value === 'image' ? 'Photos' : 'Videos'}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.count}>{selected.length ? `${selected.length} selected` : `${assets.length} items`}</Text>
      </View>

      {uploading && !assets.length ? <ActivityIndicator color={colors.accent} size="large" /> : null}
      {!uploading && !assets.length ? (
        <Pressable style={styles.empty} onPress={() => void chooseFiles()}>
          <Ionicons name="cloud-upload-outline" size={48} color={colors.accent} />
          <Text style={styles.emptyTitle}>Add your content</Text>
          <Text style={styles.emptyText}>Select many photos and videos at once. They will stay here ready for future posts.</Text>
        </Pressable>
      ) : (
        <View style={styles.grid}>
          {visibleAssets.map(asset => {
            const isSelected = selected.includes(asset.id);
            return (
              <TouchableOpacity key={asset.id} style={[styles.card, isSelected && styles.cardSelected]} onPress={() => toggleAsset(asset.id)} activeOpacity={0.82}>
                {asset.kind === 'image' ? (
                  <Image source={{ uri: asset.url }} style={styles.preview} resizeMode="cover" />
                ) : (
                  <View style={styles.videoPreview}>
                    <Ionicons name="play-circle" size={50} color="#ffffff" />
                    <Text style={styles.videoLabel}>VIDEO</Text>
                  </View>
                )}
                <View style={[styles.check, isSelected && styles.checkSelected]}>
                  {isSelected ? <Ionicons name="checkmark" size={17} color="#ffffff" /> : null}
                </View>
                <View style={styles.cardFooter}>
                  <Text numberOfLines={1} style={styles.fileName}>{asset.name || (asset.kind === 'image' ? 'Photo' : 'Video')}</Text>
                  <Text style={styles.fileMeta}>{asset.size ? `${(asset.size / 1024 / 1024).toFixed(1)} MB` : 'Ready'}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {selected.length ? (
        <View style={styles.actions}>
          <TouchableOpacity style={styles.removeButton} onPress={() => void removeSelected()}>
            <Ionicons name="trash-outline" size={18} color="#ff7b8d" />
            <Text style={styles.removeText}>Remove</Text>
          </TouchableOpacity>
          <DMButton title="Use in Schedule Posts" onPress={useInSchedule} style={styles.scheduleButton} />
        </View>
      ) : null}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 120, width: '100%', maxWidth: 1180, alignSelf: 'center', gap: 18 },
  hero: { padding: 22, borderRadius: 22, backgroundColor: colors.backgroundAlt, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
  heroIcon: { width: 56, height: 56, borderRadius: 18, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  heroCopy: { flex: 1, minWidth: 220 },
  title: { color: colors.text, fontSize: 27, fontWeight: '900' },
  subtitle: { color: colors.subtext, fontSize: 15, marginTop: 5, lineHeight: 22 },
  message: { backgroundColor: 'rgba(140,88,255,0.14)', borderColor: colors.accent, borderWidth: 1, borderRadius: 12, padding: 12 },
  messageText: { color: colors.text, fontWeight: '600' },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  filters: { flexDirection: 'row', gap: 8 },
  filter: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  filterActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterText: { color: colors.subtext, fontWeight: '700' },
  filterTextActive: { color: '#ffffff' },
  count: { color: colors.subtext, fontWeight: '700' },
  empty: { minHeight: 300, borderRadius: 22, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.accent, backgroundColor: colors.backgroundAlt, alignItems: 'center', justifyContent: 'center', padding: 30 },
  emptyTitle: { color: colors.text, fontSize: 21, fontWeight: '900', marginTop: 12 },
  emptyText: { color: colors.subtext, fontSize: 15, textAlign: 'center', maxWidth: 440, marginTop: 8, lineHeight: 22 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  card: { width: Platform.OS === 'web' ? 210 : '47%', minWidth: 145, borderRadius: 17, overflow: 'hidden', backgroundColor: colors.backgroundAlt, borderWidth: 2, borderColor: colors.border },
  cardSelected: { borderColor: colors.accent },
  preview: { width: '100%', height: 155, backgroundColor: '#111122' },
  videoPreview: { width: '100%', height: 155, backgroundColor: '#18102d', alignItems: 'center', justifyContent: 'center' },
  videoLabel: { color: '#ffffff', fontSize: 11, fontWeight: '900', letterSpacing: 1.4, marginTop: 5 },
  check: { position: 'absolute', top: 10, right: 10, width: 27, height: 27, borderRadius: 14, borderWidth: 2, borderColor: '#ffffff', backgroundColor: 'rgba(0,0,0,0.36)', alignItems: 'center', justifyContent: 'center' },
  checkSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  cardFooter: { padding: 11 },
  fileName: { color: colors.text, fontWeight: '800', fontSize: 14 },
  fileMeta: { color: colors.subtext, fontSize: 12, marginTop: 4 },
  actions: { position: Platform.OS === 'web' ? 'sticky' as any : 'relative', bottom: 16, backgroundColor: colors.backgroundAlt, borderColor: colors.border, borderWidth: 1, borderRadius: 17, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 12 },
  removeButton: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 11 },
  removeText: { color: '#ff7b8d', fontWeight: '800' },
  scheduleButton: { minWidth: 210 },
});
