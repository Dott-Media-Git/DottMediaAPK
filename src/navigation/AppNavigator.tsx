import React, { useRef } from 'react';
import {
  NavigationContainer,
  DefaultTheme,
  Theme,
  useNavigationContainerRef
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createDrawerNavigator, DrawerContentScrollView, DrawerItem } from '@react-navigation/drawer';
import { Ionicons } from '@expo/vector-icons';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { colors } from '@constants/colors';
import { useAuth } from '@context/AuthContext';
import { useAssistant } from '@context/AssistantContext';
import { ChatInterface } from '@components/ChatInterface';
import { LoginScreen, AuthStackParamList } from '@screens/LoginScreen';
import { SignupScreen } from '@screens/SignupScreen';
import { PasswordResetScreen } from '@screens/PasswordResetScreen';
import { SubscriptionScreen } from '@screens/SubscriptionScreen';
import { SetupFormScreen } from '@screens/SetupFormScreen';
import { DashboardScreen } from '@screens/DashboardScreen';
import { BotAnalyticsScreen } from '@screens/BotAnalyticsScreen';
import { InboundAnalyticsScreen } from '@screens/InboundAnalytics';
import { EngagementAnalyticsScreen } from '@screens/EngagementAnalytics';
import { FollowUpsAnalyticsScreen } from '@screens/FollowUpsAnalytics';
import { WebLeadsAnalyticsScreen } from '@screens/WebLeadsAnalytics';
import { AdminHomeScreen } from '@screens/admin/AdminHomeScreen';
import { OrgProfileScreen } from '@screens/admin/OrgProfileScreen';
import { UsersRolesScreen } from '@screens/admin/UsersRolesScreen';
import { ChannelsScreen } from '@screens/admin/ChannelsScreen';
import { FeaturesFlagsScreen } from '@screens/admin/FeaturesFlagsScreen';
import { BookingKBScreen } from '@screens/admin/BookingKBScreen';
import { PlansUsageScreen } from '@screens/admin/PlansUsageScreen';
import { OpsAuditScreen } from '@screens/admin/OpsAuditScreen';
import { ControlsScreen } from '@screens/ControlsScreen';
import { SupportScreen } from '@screens/SupportScreen';
import { CreateContentScreen } from '@screens/CreateContentScreen';
import { SchedulePostScreen } from '@screens/SchedulePostScreen';
import { PostingHistoryScreen } from '@screens/PostingHistoryScreen';
import { AccountIntegrationsScreen } from '@screens/AccountIntegrationsScreen';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const RootStack = createNativeStackNavigator();
const AdminStack = createNativeStackNavigator();
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

const AuthStackNavigator = () => (
  <AuthStack.Navigator screenOptions={{ headerShown: false }}>
    <AuthStack.Screen name="Login" component={LoginScreen} />
    <AuthStack.Screen name="Signup" component={SignupScreen} />
    <AuthStack.Screen name="PasswordReset" component={PasswordResetScreen} />
  </AuthStack.Navigator>
);

const AdminNavigator = () => (
  <AdminStack.Navigator screenOptions={{ headerShown: false }}>
    <AdminStack.Screen name="AdminHome" component={AdminHomeScreen} />
    <AdminStack.Screen name="OrgProfile" component={OrgProfileScreen} />
    <AdminStack.Screen name="UsersRoles" component={UsersRolesScreen} />
    <AdminStack.Screen name="Channels" component={ChannelsScreen} />
    <AdminStack.Screen name="FeaturesFlags" component={FeaturesFlagsScreen} />
    <AdminStack.Screen name="BookingKB" component={BookingKBScreen} />
    <AdminStack.Screen name="PlansUsage" component={PlansUsageScreen} />
    <AdminStack.Screen name="OpsAudit" component={OpsAuditScreen} />
  </AdminStack.Navigator>
);

import { OutreachScreen } from '@screens/OutreachScreen';

const drawerScreens = [
  { name: 'Dashboard', component: DashboardScreen, icon: 'stats-chart-outline' },
  { name: 'BotAnalytics', label: 'Bot Analytics', component: BotAnalyticsScreen, icon: 'pulse-outline' },
  { name: 'Outreach', label: 'Outreach Manager', component: OutreachScreen, icon: 'paper-plane-outline' },
  { name: 'Inbound', component: InboundAnalyticsScreen, icon: 'chatbubble-ellipses-outline' },
  { name: 'Engagement', component: EngagementAnalyticsScreen, icon: 'flash-outline' },
  { name: 'FollowUps', label: 'Follow-ups', component: FollowUpsAnalyticsScreen, icon: 'refresh-outline' },
  { name: 'WebLeads', label: 'Web Leads', component: WebLeadsAnalyticsScreen, icon: 'globe-outline' },
  { name: 'CreateContent', label: 'Create Content', component: CreateContentScreen, icon: 'color-palette-outline' },
  { name: 'SchedulePost', label: 'Schedule Posts', component: SchedulePostScreen, icon: 'calendar-outline' },
  { name: 'PostingHistory', label: 'Posting History', component: PostingHistoryScreen, icon: 'time-outline' },
  { name: 'AccountIntegrations', label: 'Social Integrations', component: AccountIntegrationsScreen, icon: 'link-outline' },
  { name: 'Controls', component: ControlsScreen, icon: 'settings-outline' },
  { name: 'Admin', component: AdminNavigator, icon: 'shield-checkmark-outline' },
  { name: 'Support', component: SupportScreen, icon: 'chatbubbles-outline' }
];

const DrawerNavigator = () => {
  const isDarkTheme = colors.background.toLowerCase() === '#05040f';
  const inactiveColor = isDarkTheme ? colors.subtext : colors.text;
  const labelColor = isDarkTheme ? colors.subtext : colors.text;
  return (
    <Drawer.Navigator
      drawerContent={props => <CustomDrawerContent {...props} />}
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
          options={{ title: screen.label ?? screen.name }}
        />
      ))}
    </Drawer.Navigator>
  );
};

const CustomDrawerContent = (props: any) => (
  <DrawerContentScrollView {...props} contentContainerStyle={styles.drawerContent}>
    <View style={styles.drawerHeader}>
      <Text style={styles.drawerTitle}>Dott Media</Text>
      <Text style={styles.drawerSubtitle}>AI Control Center</Text>
    </View>
    {drawerScreens.map(screen => (
      <DrawerItem
        key={screen.name}
        label={screen.label ?? screen.name}
        onPress={() => props.navigation.navigate(screen.name)}
        icon={({ color, size }) => (
          <Ionicons name={screen.icon as keyof typeof Ionicons.glyphMap} size={size} color={color} />
        )}
        labelStyle={styles.drawerLabel}
      />
    ))}
  </DrawerContentScrollView>
);

export const AppNavigator: React.FC = () => {
  const { isAuthenticated, needsSubscription, needsOnboarding } = useAuth();
  const { trackScreen } = useAssistant();
  const navigationRef = useNavigationContainerRef();
  const routeNameRef = useRef<string>();

  const handleRouteChange = () => {
    const currentRoute = navigationRef.getCurrentRoute();
    const nextName = currentRoute?.name;
    if (nextName && routeNameRef.current !== nextName) {
      routeNameRef.current = nextName;
      trackScreen(nextName);
    }
  };

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navigationTheme}
      onReady={handleRouteChange}
      onStateChange={handleRouteChange}
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
      {isAuthenticated && !needsSubscription && !needsOnboarding && <ChatInterface />}
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
