import React, { useMemo } from 'react';
import * as Linking from 'expo-linking';
import { NavigationContainer, DefaultTheme, Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createDrawerNavigator, DrawerContentScrollView, DrawerItem } from '@react-navigation/drawer';
import { Ionicons } from '@expo/vector-icons';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { colors } from '@constants/colors';
import { useAuth } from '@context/AuthContext';
import { useI18n } from '@context/I18nContext';
import { LoginScreen, AuthStackParamList } from '@screens/LoginScreen';
import { SignupScreen } from '@screens/SignupScreen';
import { PasswordResetScreen } from '@screens/PasswordResetScreen';
import { SubscriptionScreen } from '@screens/SubscriptionScreen';
import { SetupFormScreen } from '@screens/SetupFormScreen';
import { DashboardScreen } from '@screens/DashboardScreen';
import { SupportScreen } from '@screens/SupportScreen';
import { CreateContentScreen } from '@screens/CreateContentScreen';
import { SchedulePostScreen } from '@screens/SchedulePostScreen';
import { PostingHistoryScreen } from '@screens/PostingHistoryScreen';
import { AccountIntegrationsScreen } from '@screens/AccountIntegrationsScreen';
import { TrendingNewsScreen } from '@screens/TrendingNewsScreen';
import { navigationRef } from '@navigation/navigationRef';
import { ProfileScreen } from '@screens/ProfileScreen';
import { AdminDashboardScreen } from '@screens/admin/AdminDashboardScreen';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const RootStack = createNativeStackNavigator();
const Drawer = createDrawerNavigator();
const navigationTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.backgroundAlt,
    text: colors.text,
    border: colors.border,
    primary: colors.accent
  }
};

const linking = {
  prefixes: [
    Linking.createURL('/'),
    'https://dottmediaapk.web.app',
    'https://dottmediaapk.firebaseapp.com'
  ],
  config: {
    screens: {
      Main: {
        screens: {
          Dashboard: '',
          Profile: 'profile',
          CreateContent: 'create',
          SchedulePost: 'schedule',
          PostingHistory: 'history',
          AccountIntegrations: 'integrations',
          TrendingNews: 'trending',
          Support: 'support',
          Admin: 'admin'
        }
      },
      Auth: {
        screens: {
          Login: 'login',
          Signup: 'signup',
          PasswordReset: 'reset'
        }
      },
      Subscription: 'subscription',
      Setup: 'setup'
    }
  }
};

const AuthStackNavigator = () => (
  <AuthStack.Navigator screenOptions={{ headerShown: false }}>
    <AuthStack.Screen name="Login" component={LoginScreen} />
    <AuthStack.Screen name="Signup" component={SignupScreen} />
    <AuthStack.Screen name="PasswordReset" component={PasswordResetScreen} />
  </AuthStack.Navigator>
);

const baseDrawerScreens = [
  { name: 'Dashboard', labelKey: 'Dashboard', component: DashboardScreen, icon: 'stats-chart-outline' },
  { name: 'Profile', labelKey: 'Profile', component: ProfileScreen, icon: 'person-circle-outline' },
  { name: 'CreateContent', labelKey: 'Create Content', component: CreateContentScreen, icon: 'color-palette-outline' },
  { name: 'SchedulePost', labelKey: 'Schedule Posts', component: SchedulePostScreen, icon: 'calendar-outline' },
  { name: 'PostingHistory', labelKey: 'Posting History', component: PostingHistoryScreen, icon: 'time-outline' },
  { name: 'TrendingNews', labelKey: 'Your trending News', component: TrendingNewsScreen, icon: 'pulse-outline' },
  {
    name: 'AccountIntegrations',
    labelKey: 'Social Integrations',
    component: AccountIntegrationsScreen,
    icon: 'link-outline'
  },
  { name: 'Support', labelKey: 'Support', component: SupportScreen, icon: 'chatbubbles-outline' }
];

const adminDrawerScreen = {
  name: 'Admin',
  labelKey: 'Admin',
  component: AdminDashboardScreen,
  icon: 'shield-checkmark-outline'
};

const DrawerNavigator = () => {
  const isDarkTheme = colors.background.toLowerCase() === '#05040f';
  const inactiveColor = isDarkTheme ? colors.subtext : colors.text;
  const labelColor = isDarkTheme ? colors.subtext : colors.text;
  const { t } = useI18n();
  const { state } = useAuth();
  const isAdminUser = useMemo(() => {
    const email = state.user?.email?.toLowerCase() ?? '';
    return email === 'brasioxirin@gmail.com' || Boolean((state.user as any)?.isAdmin);
  }, [state.user]);
  const drawerScreens = useMemo(
    () => (isAdminUser ? [...baseDrawerScreens, adminDrawerScreen] : baseDrawerScreens),
    [isAdminUser]
  );
  return (
    <Drawer.Navigator
      initialRouteName="Dashboard"
      drawerContent={props => <CustomDrawerContent {...props} screens={drawerScreens} />}
      screenOptions={({ navigation }) => ({
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        sceneContainerStyle: { backgroundColor: colors.background },
        drawerStyle: { backgroundColor: colors.backgroundAlt, width: 260 },
        drawerInactiveTintColor: inactiveColor,
        drawerActiveTintColor: colors.accent,
        drawerLabelStyle: { color: labelColor },
        headerLeft: () => (
          <TouchableOpacity style={styles.menuButton} onPress={() => navigation.toggleDrawer()}>
            <Ionicons name="menu-outline" size={24} color={colors.text} />
          </TouchableOpacity>
        )
      })}
    >
      {drawerScreens.map(screen => (
        <Drawer.Screen
          key={screen.name}
          name={screen.name}
          component={screen.component}
          options={{ title: t(screen.labelKey ?? screen.name) }}
        />
      ))}
    </Drawer.Navigator>
  );
};

const CustomDrawerContent = (props: any) => {
  const { t } = useI18n();
  const screens = props.screens ?? baseDrawerScreens;
  return (
    <DrawerContentScrollView {...props} contentContainerStyle={styles.drawerContent}>
      <View style={styles.drawerHeader}>
        <Text style={styles.drawerTitle}>Dott Media</Text>
        <Text style={styles.drawerSubtitle}>{t('AI Control Center')}</Text>
      </View>
      {screens.map((screen: typeof baseDrawerScreens[number]) => (
        <DrawerItem
          key={screen.name}
          label={t(screen.labelKey ?? screen.name)}
          onPress={() => props.navigation.navigate(screen.name)}
          icon={({ color, size }) => (
            <Ionicons name={screen.icon as keyof typeof Ionicons.glyphMap} size={size} color={color} />
          )}
          labelStyle={styles.drawerLabel}
        />
      ))}
    </DrawerContentScrollView>
  );
};

export const AppNavigator: React.FC = () => {
  const { isAuthenticated, needsSubscription, needsOnboarding } = useAuth();

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navigationTheme}
      linking={linking}
    >
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {!isAuthenticated ? (
          <RootStack.Screen name="Auth" component={AuthStackNavigator} />
        ) : needsSubscription ? (
          <RootStack.Screen name="Subscription" component={SubscriptionScreen} />
        ) : needsOnboarding ? (
          <RootStack.Screen name="Setup" component={SetupFormScreen} />
        ) : (
          <RootStack.Screen name="Main" component={DrawerNavigator} />
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  menuButton: {
    marginLeft: 12,
    padding: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border
  },
  drawerContent: {
    flex: 1,
    paddingTop: 32
  },
  drawerHeader: {
    paddingHorizontal: 16,
    marginBottom: 24
  },
  drawerTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700'
  },
  drawerSubtitle: {
    color: colors.subtext,
    marginTop: 4
  },
  drawerLabel: {
    fontSize: 14,
    fontWeight: '600'
  }
});
