import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { DMButton } from '@components/DMButton';
import { DMCard } from '@components/DMCard';
import { DMTextInput } from '@components/DMTextInput';
import { colors } from '@constants/colors';
import { useAuth } from '@context/AuthContext';
import { useI18n } from '@context/I18nContext';
import { uploadProfileImage } from '@services/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { realtimeDb } from '@services/firebase';

const BWIN_ACCOUNT_CLOSURE_AT = '2026-05-08T08:00:00+03:00';

type AccountClosureState = {
  enabled?: boolean;
  visibleToClient?: boolean;
  shutdownAt?: string;
  message?: string;
};

const ProfileDetail = ({ label, value }: { label: string; value?: string }) => (
  <View style={styles.detailRow}>
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={styles.detailValue}>{value?.trim() || '—'}</Text>
  </View>
);

const isBwinAccount = (email?: string | null, company?: string | null, uid?: string | null) =>
  uid === '1zvY9nNyXMcfxdPQEyx0bIdK7r53' ||
  String(email ?? '').toLowerCase().includes('bwinbet') ||
  String(company ?? '').toLowerCase().includes('bwinbet');

const formatCountdown = (remainingMs: number) => {
  if (remainingMs <= 0) return 'Account closed';
  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return days > 0 ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m`;
};

export const ProfileScreen: React.FC = () => {
  const { state, signOut, updateAccountProfile } = useAuth();
  const { t } = useI18n();
  const navigation = useNavigation<any>();
  const user = state.user;
  const crm = state.crmData;
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoURL, setPhotoURL] = useState(user?.photoURL ?? '');
  const [name, setName] = useState(user?.name ?? '');
  const [companyName, setCompanyName] = useState(crm?.companyName ?? '');
  const [contactEmail, setContactEmail] = useState(crm?.email ?? user?.email ?? '');
  const [phone, setPhone] = useState(crm?.phone ?? '');
  const [website, setWebsite] = useState(crm?.website ?? '');
  const [businessAddress, setBusinessAddress] = useState(crm?.businessAddress ?? '');
  const [jobTitle, setJobTitle] = useState(crm?.jobTitle ?? '');
  const [bio, setBio] = useState(crm?.bio ?? '');
  const [closureState, setClosureState] = useState<AccountClosureState | null>(null);
  const [now, setNow] = useState(Date.now());
  const bwinAccount = useMemo(
    () => isBwinAccount(user?.email, crm?.companyName, user?.uid),
    [crm?.companyName, user?.email, user?.uid],
  );

  useEffect(() => {
    setPhotoURL(user?.photoURL ?? '');
    setName(user?.name ?? '');
    setCompanyName(crm?.companyName ?? '');
    setContactEmail(crm?.email ?? user?.email ?? '');
    setPhone(crm?.phone ?? '');
    setWebsite(crm?.website ?? '');
    setBusinessAddress(crm?.businessAddress ?? '');
    setJobTitle(crm?.jobTitle ?? '');
    setBio(crm?.bio ?? '');
  }, [crm, user]);

  useEffect(() => {
    if (!bwinAccount || !user?.uid || !realtimeDb) return;
    return onSnapshot(doc(realtimeDb, 'users', user.uid), snap => {
      setClosureState((snap.data()?.accountClosure ?? null) as AccountClosureState | null);
    });
  }, [bwinAccount, user?.uid]);

  useEffect(() => {
    if (!bwinAccount) return;
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [bwinAccount]);

  const choosePhoto = async () => {
    if (!user?.uid) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('Permission required'), t('Allow photo access to choose a profile image.'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.55,
      base64: true,
    });
    if (result.canceled || !result.assets[0]?.uri) return;
    setUploading(true);
    try {
      const asset = result.assets[0];
      if (!asset.base64) throw new Error(t('The selected profile image could not be encoded.'));
      const url = await uploadProfileImage(
        user.uid,
        `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`,
      );
      setPhotoURL(url);
    } catch (error: any) {
      Alert.alert(t('Upload failed'), error?.message ?? t('Unable to upload the profile image.'));
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!name.trim() || !companyName.trim() || !contactEmail.trim()) {
      Alert.alert(t('Required information'), t('Name, company, and contact email are required.'));
      return;
    }
    setSaving(true);
    try {
      await updateAccountProfile({
        name,
        photoURL,
        companyName,
        contactEmail,
        phone,
        website,
        businessAddress,
        jobTitle,
        bio,
      });
      setEditing(false);
      Alert.alert(t('Profile updated'), t('Your account information has been saved.'));
    } catch (error: any) {
      Alert.alert(t('Save failed'), error?.message ?? t('Unable to update your profile.'));
    } finally {
      setSaving(false);
    }
  };

  const cancelEditing = () => {
    setPhotoURL(user?.photoURL ?? '');
    setName(user?.name ?? '');
    setCompanyName(crm?.companyName ?? '');
    setContactEmail(crm?.email ?? user?.email ?? '');
    setPhone(crm?.phone ?? '');
    setWebsite(crm?.website ?? '');
    setBusinessAddress(crm?.businessAddress ?? '');
    setJobTitle(crm?.jobTitle ?? '');
    setBio(crm?.bio ?? '');
    setEditing(false);
  };

  const effectiveClosure = closureState ?? (bwinAccount ? {
    enabled: true,
    visibleToClient: true,
    shutdownAt: BWIN_ACCOUNT_CLOSURE_AT,
    message: 'All Bwin posting and automated replies are paused at the scheduled shutdown time.',
  } : null);
  const shutdownAt = effectiveClosure?.shutdownAt ? new Date(effectiveClosure.shutdownAt) : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <DMCard title={t('Profile')} subtitle={t('Keep your public account and business details current.')}>
        <View style={styles.profileRow}>
          {photoURL ? (
            <Image source={{ uri: photoURL }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarFallback}><Text style={styles.avatarText}>{name.charAt(0) || 'U'}</Text></View>
          )}
          <View style={styles.avatarActions}>
            <Text style={styles.profileName}>{name || t('User')}</Text>
            <Text style={styles.profileEmail}>{jobTitle || user?.email}</Text>
            {editing ? (
              <TouchableOpacity onPress={choosePhoto} disabled={uploading}>
                <Text style={styles.photoAction}>{uploading ? t('Uploading...') : t('Change profile image')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
        {!editing ? (
          <TouchableOpacity style={styles.editButton} onPress={() => setEditing(true)}>
            <Ionicons name="create-outline" size={18} color={colors.background} />
            <Text style={styles.editButtonText}>{t('Change profile')}</Text>
          </TouchableOpacity>
        ) : null}
      </DMCard>

      {bwinAccount && effectiveClosure?.enabled !== false && effectiveClosure?.visibleToClient !== false ? (
        <DMCard title="Bwin Account Closure">
          <Text style={styles.countdownValue}>
            {formatCountdown((shutdownAt?.getTime() ?? 0) - now)}
          </Text>
          <Text style={styles.helper}>{effectiveClosure?.message}</Text>
        </DMCard>
      ) : null}

      {editing ? (
        <>
          <DMCard title={t('Edit personal information')} subtitle={t('Update the information shown on your profile.')}>
            <DMTextInput label={t('Full name')} value={name} onChangeText={setName} />
            <DMTextInput label={t('Job title')} value={jobTitle} onChangeText={setJobTitle} />
            <DMTextInput label={t('Bio')} value={bio} onChangeText={setBio} multiline numberOfLines={4} style={styles.multiline} />
          </DMCard>
          <DMCard title={t('Edit business information')}>
            <DMTextInput label={t('Company')} value={companyName} onChangeText={setCompanyName} />
            <DMTextInput label={t('Contact email')} value={contactEmail} onChangeText={setContactEmail} keyboardType="email-address" autoCapitalize="none" />
            <DMTextInput label={t('Phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            <DMTextInput label={t('Website')} value={website} onChangeText={setWebsite} autoCapitalize="none" keyboardType="url" />
            <DMTextInput label={t('Business address')} value={businessAddress} onChangeText={setBusinessAddress} />
            <View style={styles.formActions}>
              <TouchableOpacity style={styles.cancelButton} onPress={cancelEditing} disabled={saving}>
                <Text style={styles.cancelText}>{t('Cancel')}</Text>
              </TouchableOpacity>
              <View style={styles.saveAction}><DMButton title={t('Save changes')} onPress={save} loading={saving} /></View>
            </View>
          </DMCard>
        </>
      ) : (
        <>
          <DMCard title={t('About')}>
            <Text style={styles.bioText}>{bio?.trim() || t('No biography added yet.')}</Text>
          </DMCard>
          <DMCard title={t('Profile information')} subtitle={t('Your saved personal and business details.')}>
            <ProfileDetail label={t('Full name')} value={name} />
            <ProfileDetail label={t('Job title')} value={jobTitle} />
            <ProfileDetail label={t('Company')} value={companyName} />
            <ProfileDetail label={t('Contact email')} value={contactEmail} />
            <ProfileDetail label={t('Phone')} value={phone} />
            <ProfileDetail label={t('Website')} value={website} />
            <ProfileDetail label={t('Business address')} value={businessAddress} />
          </DMCard>
        </>
      )}

      <DMCard title={t('Account & Billing')} subtitle={t('View your current plan, usage, invoices, and upgrade options.')}>
        <Text style={styles.planStatus}>{t('Subscription status')}: {state.subscriptionStatus}</Text>
        <DMButton title={t('Manage plan and usage')} onPress={() => navigation.navigate('AccountBilling')} />
      </DMCard>

      <DMCard title={t('Account')}>
        <TouchableOpacity style={styles.signOutButton} onPress={signOut}>
          <Text style={styles.signOutText}>{t('Sign out')}</Text>
        </TouchableOpacity>
      </DMCard>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 48 },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 76, height: 76, borderRadius: 38, borderWidth: 2, borderColor: colors.accent },
  avatarFallback: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: colors.cardOverlay,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: colors.text, fontSize: 26, fontWeight: '800' },
  avatarActions: { flex: 1 },
  profileName: { color: colors.text, fontSize: 18, fontWeight: '700' },
  profileEmail: { color: colors.subtext, marginTop: 4 },
  photoAction: { color: colors.accent, fontWeight: '700', marginTop: 10 },
  editButton: { marginTop: 20, backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  editButtonText: { color: colors.background, fontWeight: '800' },
  detailRow: { paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  detailLabel: { color: colors.subtext, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 5 },
  detailValue: { color: colors.text, fontSize: 16, fontWeight: '600' },
  bioText: { color: colors.text, fontSize: 16, lineHeight: 25 },
  formActions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  cancelButton: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingVertical: 13, alignItems: 'center' },
  cancelText: { color: colors.text, fontWeight: '700' },
  saveAction: { flex: 2 },
  multiline: { minHeight: 100, textAlignVertical: 'top' },
  helper: { color: colors.subtext, marginTop: 8, lineHeight: 20 },
  countdownValue: { color: colors.accent, fontSize: 26, fontWeight: '800' },
  planStatus: { color: colors.text, fontWeight: '700', marginBottom: 14, textTransform: 'capitalize' },
  signOutButton: { backgroundColor: colors.danger, paddingVertical: 13, borderRadius: 14, alignItems: 'center' },
  signOutText: { color: colors.text, fontWeight: '700' },
});
