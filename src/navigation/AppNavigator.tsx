import React, { useMemo } from 'react';
import * as Linking from 'expo-linking';
import { NavigationContainer, DefaultTheme, Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createDrawerNavigator, DrawerContentScrollView, DrawerItem, useDrawerStatus } from '@react-navigation/drawer';
import { Ionicons } from '@expo/vector-icons';
import { Platform, TouchableOpacity, View, Text, StyleSheet, ActivityIndicator, useWindowDimensions } from 'react-native';
import { colors } from '@constants/colors';
import { useAuth } from '@context/AuthContext';
import { useI18n } from '@context/I18nContext';
import { useAssistant } from '@context/AssistantContext';
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
import { AdsManagerScreen } from '@screens/AdsManagerScreen';
import { TrendingNewsScreen } from '@screens/TrendingNewsScreen';
import { navigationRef } from '@navigation/navigationRef';
import { ProfileScreen } from '@screens/ProfileScreen';
import { EmailVerificationScreen } from '@screens/EmailVerificationScreen';
import { AdminDashboardScreen } from '@screens/admin/AdminDashboardScreen';
import { WebScreenFrame } from '@components/WebScreenFrame';
import { WebChatScreen } from '@screens/WebChatScreen';

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
          DottiChat: '',
          Dashboard: 'dashboard',
          Profile: 'profile',
          AccountBilling: 'account-billing',
          CreateContent: 'create',
          SchedulePost: 'schedule',
          PostingHistory: 'history',
          AccountIntegrations: 'integrations',
          AdsManager: 'ads',
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

const FramedSubscriptionScreen: React.FC = () => (
  <WebScreenFrame><SubscriptionScreen /></WebScreenFrame>
);

const FramedSetupScreen: React.FC = () => (
  <WebScreenFrame><SetupFormScreen /></WebScreenFrame>
);

const baseDrawerScreens = [
  { name: 'Dashboard', labelKey: 'Dashboard', component: DashboardScreen, icon: 'stats-chart-outline' },
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
  { name: 'AdsManager', labelKey: 'Ads Manager', component: AdsManagerScreen, icon: 'megaphone-outline' },
  { name: 'Profile', labelKey: 'Profile', component: ProfileScreen, icon: 'person-circle-outline' },
  { name: 'AccountBilling', labelKey: 'Account & Billing', component: SubscriptionScreen, icon: 'card-outline' },
  { name: 'Support', labelKey: 'Support', component: SupportScreen, icon: 'chatbubbles-outline' }
];

const webChatDrawerScreen = {
  name: 'DottiChat',
  labelKey: 'Chat with Dotti',
  component: WebChatScreen,
  icon: 'chatbubble-ellipses-outline'
};

const adminDrawerScreen = {
  name: 'Admin',
  labelKey: 'Admin',
  component: AdminDashboardScreen,
  icon: 'shield-checkmark-outline'
};

const normalizeLower = (value: unknown) => String(value ?? '').toLowerCase();

const DrawerRouteFrame: React.FC<{ children: React.ReactNode; bounded?: boolean }> = ({ children, bounded = true }) => {
  const drawerStatus = useDrawerStatus();
  const { width } = useWindowDimensions();
  const usesDesktopCanvas = Platform.OS === 'web' && width >= 768;
  const sharesDesktopSpace = Platform.OS === 'web' && width >= 1100 && drawerStatus === 'open';
  if (Platform.OS !== 'web') return <>{children}</>;
  if (!usesDesktopCanvas) return <>{children}</>;
  return (
    <View
      style={[
        styles.drawerRouteFrame,
        sharesDesktopSpace && styles.drawerRouteFrameWithSidebar,
      ]}
    >
      {bounded ? <WebScreenFrame>{children}</WebScreenFrame> : children}
    </View>
  );
};

const DrawerNavigator = () => {
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === 'web' && width >= 1100;
  const isDarkTheme = normalizeLower(colors.background) === '#05040f';
  const inactiveColor = isDarkTheme ? colors.subtext : colors.text;
  const labelColor = isDarkTheme ? colors.subtext : colors.text;
  const { t } = useI18n();
  const { state } = useAuth();
  const isAdminUser = useMemo(() => {
    const email = normalizeLower(state.user?.email);
    return email === 'brasioxirin@gmail.com' || Boolean((state.user as any)?.isAdmin);
  }, [state.user]);
  const drawerScreens = useMemo(
    () => {
      const accountScreens = isAdminUser
        ? [...baseDrawerScreens.slice(0, -3), adminDrawerScreen, ...baseDrawerScreens.slice(-3)]
        : baseDrawerScreens;
      return [webChatDrawerScreen, ...accountScreens];
    },
    [isAdminUser, isDesktopWeb]
  );
  return (
    <Drawer.Navigator
      initialRouteName="DottiChat"
      defaultStatus="closed"
      backBehavior="history"
      detachInactiveScreens={false}
      drawerContent={(props: any) => <CustomDrawerContent {...props} screens={drawerScreens} />}
      screenOptions={({ navigation }: any) => ({
        freezeOnBlur: true,
        drawerType: isDesktopWeb ? 'slide' : 'front',
        overlayColor: isDesktopWeb ? 'transparent' : undefined,
        headerStyle: { backgroundColor: colors.backgroundAlt },
        headerShadowVisible: false,
        headerTintColor: colors.text,
        headerTitleStyle: { fontSize: isDesktopWeb ? 20 : 17, fontWeight: '800' },
        headerTitleAlign: 'left',
        sceneContainerStyle: { backgroundColor: colors.background },
        drawerStyle: {
          backgroundColor: colors.backgroundAlt,
          width: isDesktopWeb ? 286 : 260,
          borderRightWidth: 1,
          borderRightColor: colors.border,
          zIndex: 10000,
          elevation: 10000,
        },
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
          children={(screenProps: any) => {
            const ScreenComponent = screen.component as React.ComponentType<any>;
            if (screen.name === 'DottiChat') {
              return <DrawerRouteFrame bounded={false}><ScreenComponent {...screenProps} /></DrawerRouteFrame>;
            }
            return (
              <DrawerRouteFrame>
                <ScreenComponent {...screenProps} />
              </DrawerRouteFrame>
            );
          }}
          options={{ title: t(screen.labelKey ?? screen.name), headerShown: screen.name !== 'DottiChat' }}
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
        <View style={styles.brandRow}>
          <View style={styles.brandMark}><Text style={styles.brandLetter}>D</Text></View>
          <View>
            <Text style={styles.drawerTitle}>Dotti</Text>
            <Text style={styles.drawerSubtitle}>{t('AI Control Center')}</Text>
          </View>
        </View>
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
  const { isAuthenticated, needsSubscription, needsOnboarding, state } = useAuth();
  const { trackScreen } = useAssistant();

  if (!state.hydrated) {
    return (
      <View style={styles.bootLoader}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navigationTheme}
      linking={linking as any}
      onReady={() => {
        const routeName = navigationRef.getCurrentRoute()?.name;
        if (routeName) trackScreen(routeName);
      }}
      onStateChange={() => {
        const routeName = navigationRef.getCurrentRoute()?.name;
        if (routeName) trackScreen(routeName);
      }}
    >
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {!isAuthenticated ? (
          <RootStack.Screen name="Auth" component={AuthStackNavigator} />
        ) : state.user?.emailVerified === false ? (
          <RootStack.Screen name="EmailVerification" component={EmailVerificationScreen} />
        ) : needsSubscription ? (
          <RootStack.Screen name="Subscription" component={FramedSubscriptionScreen} />
        ) : needsOnboarding ? (
          <RootStack.Screen name="Setup" component={FramedSetupScreen} />
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
    paddingTop: 20,
    paddingHorizontal: 10,
  },
  drawerHeader: {
    paddingHorizontal: 12,
    paddingVertical: 18,
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandMark: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  brandLetter: { color: '#FFFFFF', fontSize: 21, fontWeight: '900' },
  drawerTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '800'
  },
  drawerSubtitle: {
    color: colors.subtext,
    marginTop: 4
  },
  drawerLabel: {
    fontSize: 14,
    fontWeight: '700',
    marginLeft: -8,
  },
  bootLoader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  drawerRouteFrame: {
    flex: 1,
    width: '100%',
    minWidth: 0,
    alignSelf: 'flex-start',
  },
  drawerRouteFrameWithSidebar: {
    paddingRight: 286,
  },
});
