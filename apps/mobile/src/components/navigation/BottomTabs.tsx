import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
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

function TabIcon({ name, color, focused }: { name: string; color: string; focused: boolean }) {
  const iconMap = {
    Home: focused ? 'home' : 'home-outline',
    Give: focused ? 'heart' : 'heart-outline',
    Community: focused ? 'people' : 'people-outline',
    Events: focused ? 'calendar' : 'calendar-outline',
    Profile: focused ? 'person' : 'person-outline',
  };
  return <Ionicons name={iconMap[name as keyof typeof iconMap] as never} size={21} color={color} />;
}

export function BottomTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        headerTintColor: colors.text,
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
          paddingBottom: 7,
          paddingTop: 7,
          height: 66,
          elevation: 0,
        },
        tabBarLabelStyle: {
          fontSize: typography.sizes.xs,
          fontWeight: typography.weights.medium,
        },
        tabBarIcon: ({ color, focused }: { color: string; focused: boolean }) => (
          <TabIcon name={route.name} color={color} focused={focused} />
        ),
      })}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ title: 'Home', headerShown: false }}
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
