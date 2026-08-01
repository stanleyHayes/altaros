import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import type { NavigatorScreenParams } from '@react-navigation/native';
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
import { EventDetailScreen } from '../../screens/events/EventDetailScreen';
import { CreatePostScreen } from '../../screens/social/CreatePostScreen';
import { WelfareScreen } from '../../screens/welfare/WelfareScreen';
import { NotificationsScreen } from '../../screens/notifications/NotificationsScreen';
import { colors } from '../../theme';
import type { TabParamList } from './BottomTabs';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  Otp: { phone: string };
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<TabParamList> | undefined;
  Devotional: undefined;
  Sermons: undefined;
  Prayer: undefined;
  GivingHistory: undefined;
  EventDetail: { eventId: string };
  CreatePost: undefined;
  Welfare: undefined;
  Notifications: undefined;
};

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const RootStack = createNativeStackNavigator<RootStackParamList>();

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
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <RootStack.Screen
        name="MainTabs"
        component={BottomTabs}
        options={{ headerShown: false }}
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
        name="Welfare"
        component={WelfareScreen}
        options={{ title: 'Welfare & Support' }}
      />
      <RootStack.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{ title: 'Notifications' }}
      />
    </RootStack.Navigator>
  );
}

export function AppNavigator() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <NavigationContainer>
      {isAuthenticated ? <MainNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
}
