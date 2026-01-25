import React, { useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { DMButton } from '@components/DMButton';
import { colors } from '@constants/colors';
import { useAuth } from '@context/AuthContext';
import { inviteOrgUser, listOrgUsers, removeOrgUser, updateOrgUser } from '@services/admin/usersService';
import { useI18n } from '@context/I18nContext';

const roles: Array<'Owner' | 'Admin' | 'Agent' | 'Viewer'> = ['Owner', 'Admin', 'Agent', 'Viewer'];

export const UsersRolesScreen: React.FC = () => {
  const { orgId } = useAuth();
  const { t } = useI18n();
  const [users, setUsers] = useState<any[]>([]);
  const [invite, setInvite] = useState<{ uid: string; role: (typeof roles)[number] }>({ uid: '', role: 'Agent' });
  const [loading, setLoading] = useState(false);

  const refresh = () => {
    if (!orgId) return;
    listOrgUsers(orgId)
      .then(setUsers)
      .catch(error => Alert.alert(t('Error'), error.message));
  };

  useEffect(refresh, [orgId]);

  const handleInvite = async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      await inviteOrgUser(orgId, invite);
      setInvite({ uid: '', role: 'Agent' });
      refresh();
    } catch (error: any) {
      Alert.alert(t('Error'), error.message);
    } finally {
      setLoading(false);
    }
  };

  const changeRole = async (uid: string, role: string) => {
    if (!orgId) return;
    await updateOrgUser(orgId, uid, role as any);
    refresh();
  };

  const remove = async (uid: string) => {
    if (!orgId) return;
    await removeOrgUser(orgId, uid);
    refresh();
  };

  return (
    <View style={styles.container}>
      <View style={styles.inviteCard}>
        <Text style={styles.label}>{t('Invite by UID / email')}</Text>
        <TextInput
          value={invite.uid}
          onChangeText={uid => setInvite(prev => ({ ...prev, uid }))}
          style={styles.input}
          placeholder="user@domain.com"
        />
        <View style={styles.roleRow}>
          {roles.map(role => (
            <Text
              key={role}
              style={[styles.roleChip, invite.role === role && styles.roleChipActive]}
              onPress={() => setInvite(prev => ({ ...prev, role }))}
            >
              {role}
            </Text>
          ))}
        </View>
        <DMButton title={t('Send Invite')} onPress={handleInvite} disabled={loading} />
      </View>
      <FlatList
        data={users}
        keyExtractor={item => item.uid}
        contentContainerStyle={{ paddingBottom: 40 }}
        renderItem={({ item }) => (
          <View style={styles.userRow}>
            <View>
              <Text style={styles.userName}>{item.uid}</Text>
              <Text style={styles.userRole}>{item.role}</Text>
            </View>
            <View style={styles.roleRow}>
              {roles.map(role => (
                <Text
                  key={role}
                  style={[styles.roleChipSmall, role === item.role && styles.roleChipActive]}
                  onPress={() => changeRole(item.uid, role)}
                >
                  {role[0]}
                </Text>
              ))}
              <Text style={styles.remove} onPress={() => remove(item.uid)}>
                {t('Remove')}
              </Text>
            </View>
          </View>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 20 },
  inviteCard: {
    backgroundColor: colors.backgroundAlt,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
  },
  label: { color: colors.subtext, marginBottom: 6 },
  input: {
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 12,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
  },
  roleRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 },
  roleChip: {
    color: colors.subtext,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    marginRight: 8,
  },
  roleChipSmall: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    marginRight: 6,
    color: colors.subtext,
  },
  roleChipActive: {
    borderColor: colors.accent,
    color: colors.accent,
  },
  userRow: {
    backgroundColor: colors.backgroundAlt,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  userName: { color: colors.text, fontWeight: '700' },
  userRole: { color: colors.subtext },
  remove: { color: colors.danger, marginLeft: 8 },
});
