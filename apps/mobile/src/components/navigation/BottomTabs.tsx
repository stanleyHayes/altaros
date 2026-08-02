import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { HomeScreen } from '../../screens/home/HomeScreen';
import { GivingScreen } from '../../screens/giving/GivingScreen';
import { FeedScreen } from '../../screens/social/FeedScreen';
import { EventsScreen } from '../../screens/events/EventsScreen';
import { ProfileScreen } from '../../screens/profile/ProfileScreen';
import { colors, typography } from '../../theme';
import { MemberTabBar } from './MemberTabBar';

export type TabParamList = {
  Home: undefined;
  Give: undefined;
  Community: undefined;
  Events: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

export function BottomTabs() {
  return (
    <Tab.Navigator
      tabBar={(props) => <MemberTabBar {...props} />}
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        headerTintColor: colors.text,
        headerTitleStyle: {
          fontFamily: typography.families.semibold,
          fontSize: typography.sizes.lg,
        },
        tabBarAccessibilityLabel: route.name === 'Community' ? 'Social' : route.name,
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
        options={{ title: 'Community', tabBarLabel: 'Social' }}
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
