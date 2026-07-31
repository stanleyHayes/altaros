import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { HomeScreen } from '../../screens/home/HomeScreen';
import { GivingScreen } from '../../screens/giving/GivingScreen';
import { FeedScreen } from '../../screens/social/FeedScreen';
import { EventsScreen } from '../../screens/events/EventsScreen';
import { ProfileScreen } from '../../screens/profile/ProfileScreen';
import { colors, typography } from '../../theme';

export type TabParamList = {
  Home: undefined;
  Give: undefined;
  Community: undefined;
  Events: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

// Simple text-based icons since we cannot guarantee vector icons are installed
function TabIcon({ name, color }: { name: string; color: string }) {
  const iconMap: Record<string, string> = {
    Home: '\u2302',
    Give: '\u2665',
    Community: '\u263A',
    Events: '\u2605',
    Profile: '\u263B',
  };
  const React_ = require('react');
  const { Text } = require('react-native');
  return React_.createElement(Text, {
    style: { fontSize: 22, color, marginBottom: -2 },
  }, iconMap[name] || '\u25CF');
}

export function BottomTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: {
          backgroundColor: colors.primary,
          elevation: 0,
          shadowOpacity: 0,
        },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: {
          fontWeight: typography.weights.semibold,
          fontSize: typography.sizes.lg,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          paddingBottom: 4,
          paddingTop: 4,
          height: 56,
        },
        tabBarLabelStyle: {
          fontSize: typography.sizes.xs,
          fontWeight: typography.weights.medium,
        },
        tabBarIcon: ({ color }: { color: string }) => (
          <TabIcon name={route.name} color={color} />
        ),
      })}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ title: 'ALTAR OS' }}
      />
      <Tab.Screen
        name="Give"
        component={GivingScreen}
        options={{ title: 'Give' }}
      />
      <Tab.Screen
        name="Community"
        component={FeedScreen}
        options={{ title: 'Community' }}
      />
      <Tab.Screen
        name="Events"
        component={EventsScreen}
        options={{ title: 'Events' }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: 'Profile' }}
      />
    </Tab.Navigator>
  );
}
