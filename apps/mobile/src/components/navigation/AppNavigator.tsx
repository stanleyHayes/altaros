import React, { useEffect, useRef } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import type { LinkingOptions, NavigatorScreenParams } from '@react-navigation/native';
import { AppState, Linking, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as Notifications from '../../services/notification-platform';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../../hooks/useAuth';
import { LoadingScreen } from '../common/LoadingScreen';
import { BottomTabs } from './BottomTabs';
import { LoginScreen } from '../../screens/auth/LoginScreen';
import { RegisterScreen } from '../../screens/auth/RegisterScreen';
import { OtpScreen } from '../../screens/auth/OtpScreen';
import { DevotionalScreen } from '../../screens/spiritual/DevotionalScreen';
import { SermonsScreen } from '../../screens/spiritual/SermonsScreen';
import { PrayerScreen } from '../../screens/spiritual/PrayerScreen';
import { GivingHistoryScreen } from '../../screens/giving/GivingHistoryScreen';
import { CampaignsScreen } from '../../screens/giving/CampaignsScreen';
import { LiveScreen } from '../../screens/live/LiveScreen';
import { LiveSessionScreen } from '../../screens/live/LiveSessionScreen';
import { EventDetailScreen } from '../../screens/events/EventDetailScreen';
import { CreatePostScreen } from '../../screens/social/CreatePostScreen';
import { WelfareScreen } from '../../screens/welfare/WelfareScreen';
import { NotificationsScreen } from '../../screens/notifications/NotificationsScreen';
import PrivacyScreen from '../../screens/profile/PrivacyScreen';
import { GivingCompleteScreen } from '../../screens/giving/GivingCompleteScreen';
import { PostCommentsScreen } from '../../screens/social/PostCommentsScreen';
import { colors, typography } from '../../theme';
import type { TabParamList } from './BottomTabs';
import {
  consumeDeferredUrl,
  createInitialUrlGate,
  notificationUrlFromData,
  rememberDeferredUrl,
  resolveInitialMemberUrl,
  safeNotificationUrl,
} from '../../services/notification-linking';
import notificationService, { supportsNativePush } from '../../services/notification.service';
import { navigationIdentityForUser, navigationSessionKey } from './navigation-session';
import { createPushRegistrationSyncGate } from '../../services/push-registration-sync';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  Otp: { phone: string; workspace: string; codeRequested?: boolean; deliveryUnconfirmed?: boolean };
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<TabParamList> | undefined;
  Devotional: undefined;
  Sermons: undefined;
  Prayer: undefined;
  GivingHistory: undefined;
  GivingComplete: { reference?: string; trxref?: string } | undefined;
  EventDetail: { eventId: string };
  CreatePost: undefined;
  PostComments: { postId: string; postTitle?: string };
  Welfare: undefined;
  Notifications: undefined;
  // Data subject rights. Apple 5.1.1(v) requires the deletion path to be
  // reachable inside the app, not only from a website.
  Privacy: undefined;
  // Fundraising appeals the church published to its members.
  Campaigns: undefined;
  // Live services, and the one-tap giving that happens inside them.
  Live: undefined;
  LiveSession: { sessionId: string; title: string; campaignId?: string };
};

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const RootStack = createNativeStackNavigator<RootStackParamList>();
const initialUrlGate = createInitialUrlGate();
const initialNotificationGate = createInitialUrlGate();

async function consumeLastNotificationUrl(): Promise<string | null> {
  if (!supportsNativePush(Platform.OS)) return null;
  return initialNotificationGate.take(async () => {
    const response = await Notifications.getLastNotificationResponseAsync();
    const url = notificationUrlFromData(response?.notification.request.content.data);
    if (response) {
      await Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    }
    return url;
  });
}

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['altaros://'],
  config: {
    screens: {
      MainTabs: {
        screens: {
          Home: '',
          Give: 'give',
          Events: 'events',
          Community: 'community',
          Profile: 'profile',
        },
      },
      Devotional: 'devotional',
      Sermons: 'sermons',
      Prayer: 'prayer',
      GivingHistory: 'giving/history',
      GivingComplete: 'giving/complete',
      EventDetail: 'events/:eventId',
      CreatePost: 'community/new',
      PostComments: 'community/posts/:postId',
      Welfare: 'welfare',
      Notifications: 'notifications',
    },
  },
  async getInitialURL() {
    const deferred = consumeDeferredUrl();
    if (deferred) return deferred;
    return resolveInitialMemberUrl(
      () => initialUrlGate.take(() => Linking.getInitialURL()),
      consumeLastNotificationUrl,
    );
  },
  subscribe(listener) {
    const linkSubscription = Linking.addEventListener('url', ({ url }) => {
      const safeUrl = safeNotificationUrl(url);
      if (safeUrl) listener(safeUrl);
    });
    const notificationSubscription = supportsNativePush(Platform.OS)
      ? Notifications.addNotificationResponseReceivedListener((response) => {
        const url = notificationUrlFromData(response.notification.request.content.data);
        if (url) listener(url);
        void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
      })
      : null;
    return () => {
      linkSubscription.remove();
      notificationSubscription?.remove();
    };
  },
};

function AuthNavigator() {
  return (
    <AuthStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
      <AuthStack.Screen name="Otp" component={OtpScreen} />
    </AuthStack.Navigator>
  );
}

function MainNavigator() {
  return (
    <RootStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        headerBackTitle: 'Back',
        headerTitleStyle: { fontFamily: typography.families.semibold },
      }}
    >
      <RootStack.Screen
        name="MainTabs"
        component={BottomTabs}
        options={{ headerShown: false }}
      />
      <RootStack.Screen
        name="Campaigns"
        component={CampaignsScreen}
        options={{ title: 'Appeals' }}
      />
      <RootStack.Screen
        name="Live"
        component={LiveScreen}
        options={{ title: 'Live services' }}
      />
      <RootStack.Screen
        name="LiveSession"
        component={LiveSessionScreen}
        options={{
          // Full screen: a sermon behind a navigation bar is a smaller sermon,
          // and the screen carries its own titled bar with a way out.
          headerShown: false,
        }}
      />
      <RootStack.Screen
        name="Devotional"
        component={DevotionalScreen}
        options={{ title: 'Daily Devotional' }}
      />
      <RootStack.Screen
        name="Sermons"
        component={SermonsScreen}
        options={{ title: 'Sermons' }}
      />
      <RootStack.Screen
        name="Prayer"
        component={PrayerScreen}
        options={{ title: 'Prayer Requests' }}
      />
      <RootStack.Screen
        name="GivingHistory"
        component={GivingHistoryScreen}
        options={{ title: 'Giving History' }}
      />
      <RootStack.Screen
        name="GivingComplete"
        component={GivingCompleteScreen}
        options={{ title: 'Payment status', headerBackVisible: false }}
      />
      <RootStack.Screen
        name="EventDetail"
        component={EventDetailScreen}
        options={{ title: 'Event Details' }}
      />
      <RootStack.Screen
        name="CreatePost"
        component={CreatePostScreen}
        options={{ title: 'New Post' }}
      />
      <RootStack.Screen
        name="PostComments"
        component={PostCommentsScreen}
        options={{ title: 'Comments' }}
      />
      <RootStack.Screen
        name="Welfare"
        component={WelfareScreen}
        options={{ title: 'Welfare & Support' }}
      />
      <RootStack.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{ title: 'Notifications' }}
      />
      <RootStack.Screen
        name="Privacy"
        component={PrivacyScreen}
        options={{ title: 'Your data' }}
      />
    </RootStack.Navigator>
  );
}

export function AppNavigator() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const activeIdentityRef = useRef(navigationIdentityForUser(user));
  activeIdentityRef.current = navigationIdentityForUser(user);

  useEffect(() => {
    const startedChurchId = user?.churchId;
    const startedMemberId = user?.memberId;
    if (!isAuthenticated || !startedChurchId || !startedMemberId) return;
    let active = true;
    const stillOwnsSession = () => active
      && activeIdentityRef.current.churchId === startedChurchId
      && activeIdentityRef.current.memberId === startedMemberId;
    // Never prompt on app launch. If the member has already granted access,
    // refresh the Expo token registration so reinstalls and backend cleanup do
    // not silently stop delivery. The Notifications screen owns first consent.
    const syncGate = createPushRegistrationSyncGate(
      () => notificationService.syncPushRegistration(Platform.OS, stillOwnsSession),
      stillOwnsSession,
    );
    void syncGate.request().catch(() => undefined);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncGate.request().catch(() => undefined);
    });
    const connectivitySubscription = NetInfo.addEventListener((state) => {
      if (state.isConnected !== false && state.isInternetReachable !== false) {
        void syncGate.request().catch(() => undefined);
      }
    });
    const tokenSubscription = supportsNativePush(Platform.OS)
      ? Notifications.addPushTokenListener((token) => {
        // APNs and FCM may rotate their native token while the process remains
        // alive. Persist that replacement immediately under this exact member
        // session instead of waiting for another login or cold launch.
        void notificationService.registerRotatedDevice(token, Platform.OS, stillOwnsSession)
          .catch(() => undefined);
      })
      : null;
    return () => {
      active = false;
      syncGate.deactivate();
      appStateSubscription.remove();
      connectivitySubscription();
      tokenSubscription?.remove();
    };
  }, [isAuthenticated, user?.churchId, user?.memberId]);

  useEffect(() => {
    if (isAuthenticated) return;
    let active = true;

    // The auth stack has no member routes. Preserve a valid destination until
    // authentication completes instead of handing it to the wrong navigator
    // and losing a payment callback or notification tap.
    void (async () => {
      // An OS link that launched the app is newer and more intentional than a
      // previously handled notification response, so it gets first refusal.
      const initialUrl = await initialUrlGate.take(() => Linking.getInitialURL());
      if (!active) return;
      if (initialUrl && rememberDeferredUrl(initialUrl)) return;
      const notificationUrl = await consumeLastNotificationUrl();
      if (active) rememberDeferredUrl(notificationUrl);
    })().catch(() => undefined);

    const linkSubscription = Linking.addEventListener('url', ({ url }) => {
      rememberDeferredUrl(url);
    });
    const notificationSubscription = supportsNativePush(Platform.OS)
      ? Notifications.addNotificationResponseReceivedListener(
        (response) => {
          rememberDeferredUrl(
            notificationUrlFromData(response.notification.request.content.data),
          );
          void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
        },
      )
      : null;
    return () => {
      active = false;
      linkSubscription.remove();
      notificationSubscription?.remove();
    };
  }, [isAuthenticated]);

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <NavigationContainer
      key={navigationSessionKey(isAuthenticated, navigationIdentityForUser(user))}
      linking={isAuthenticated ? linking : undefined}
    >
      {isAuthenticated ? <MainNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
}
