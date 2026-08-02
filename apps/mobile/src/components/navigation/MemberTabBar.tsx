import React from 'react';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { borderRadius, colors, shadows, spacing, typography } from '../../theme';
import type { TabParamList } from './BottomTabs';

type TabName = keyof TabParamList;

const tabMeta: Record<TabName, {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  activeIcon: React.ComponentProps<typeof Ionicons>['name'];
}> = {
  Home: { label: 'Home', icon: 'home-outline', activeIcon: 'home' },
  Give: { label: 'Give', icon: 'heart-outline', activeIcon: 'heart' },
  Community: { label: 'Social', icon: 'people-outline', activeIcon: 'people' },
  Events: { label: 'Events', icon: 'calendar-outline', activeIcon: 'calendar' },
  Profile: { label: 'Profile', icon: 'person-outline', activeIcon: 'person' },
};

export function memberTabPresentation(name: string, focused: boolean) {
  const meta = tabMeta[name as TabName] ?? tabMeta.Home;
  return {
    label: meta.label,
    icon: focused ? meta.activeIcon : meta.icon,
  };
}

export function memberTabLayout(width: number, fontScale: number) {
  const compact = width < 360;
  const largeText = fontScale > 1.15;
  return {
    compact,
    dockPaddingHorizontal: compact ? spacing.sm : spacing.md,
    railMinHeight: largeText ? 80 : 72,
    tabMinHeight: largeText ? 66 : 58,
    iconWellWidth: compact ? 34 : 38,
    labelMarginTop: largeText ? spacing.xs : 3,
  };
}

export function MemberTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const layout = memberTabLayout(width, fontScale);

  return (
    <View style={[styles.dock, {
      paddingBottom: Math.max(insets.bottom, spacing.sm),
      paddingHorizontal: layout.dockPaddingHorizontal,
    }]}> 
      <View style={[styles.rail, { minHeight: layout.railMinHeight }]}> 
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const option = descriptors[route.key].options;
          const presentation = memberTabPresentation(route.name, focused);

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
              accessibilityRole="button"
              accessibilityLabel={`${option.tabBarAccessibilityLabel ?? presentation.label}, tab ${index + 1} of ${state.routes.length}`}
              accessibilityState={{ selected: focused }}
              testID={option.tabBarButtonTestID}
              style={({ pressed }) => [
                styles.tab,
                { minHeight: layout.tabMinHeight },
                pressed && styles.tabPressed,
              ]}
            >
              <View style={[
                styles.iconWell,
                { width: layout.iconWellWidth },
                focused && styles.iconWellActive,
              ]}>
                <Ionicons
                  name={presentation.icon}
                  size={focused ? 21 : 20}
                  color={focused ? colors.text : 'rgba(255,255,255,.62)'}
                  accessible={false}
                />
                {focused ? <View style={styles.activeDot} accessible={false} /> : null}
              </View>
              <Text
                style={[styles.label, { marginTop: layout.labelMarginTop }, focused && styles.labelActive]}
                numberOfLines={1}
                maxFontSizeMultiplier={1.4}
              >
                {presentation.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    backgroundColor: colors.background,
    paddingTop: spacing.sm,
  },
  rail: {
    backgroundColor: colors.text,
    borderRadius: borderRadius['2xl'],
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
    paddingVertical: 7,
    ...shadows.lg,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.xl,
    transform: [{ scale: 1 }],
  },
  tabPressed: { opacity: 0.72, transform: [{ scale: 0.96 }] },
  iconWell: {
    width: 38,
    height: 32,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  iconWellActive: { backgroundColor: colors.primaryLight },
  activeDot: {
    position: 'absolute',
    bottom: -3,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.primaryDark,
  },
  label: {
    color: 'rgba(255,255,255,.58)',
    fontFamily: typography.families.medium,
    fontSize: typography.sizes.xs,
  },
  labelActive: { color: colors.surface, fontFamily: typography.families.semibold },
});
