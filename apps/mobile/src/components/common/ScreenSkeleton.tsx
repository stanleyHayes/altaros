import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Platform, StyleSheet, View } from 'react-native';
import { borderRadius, colors, spacing } from '../../theme';

interface ScreenSkeletonProps {
  cards?: number;
  showHero?: boolean;
}

export function ScreenSkeleton({ cards = 3, showHero = false }: ScreenSkeletonProps) {
  const opacity = useRef(new Animated.Value(0.48)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      opacity.stopAnimation();
      opacity.setValue(0.62);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.82, duration: 650, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(opacity, { toValue: 0.42, duration: 650, useNativeDriver: Platform.OS !== 'web' }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity, reduceMotion]);

  return (
    <View
      style={styles.container}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading content"
    >
      {showHero ? <Animated.View style={[styles.hero, { opacity }]} /> : null}
      {Array.from({ length: cards }, (_, index) => (
        <View key={index} style={styles.card} importantForAccessibility="no-hide-descendants">
          <Animated.View style={[styles.icon, { opacity }]} />
          <View style={styles.lines}>
            <Animated.View style={[styles.line, styles.title, { opacity }]} />
            <Animated.View style={[styles.line, styles.body, { opacity }]} />
            <Animated.View style={[styles.line, styles.short, { opacity }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    backgroundColor: colors.background,
    padding: spacing.base,
  },
  hero: {
    height: 118,
    borderRadius: borderRadius['2xl'],
    backgroundColor: colors.border,
    marginBottom: spacing.base,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: borderRadius.xl,
    padding: spacing.base,
    marginBottom: spacing.md,
  },
  icon: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.border,
    marginRight: spacing.md,
  },
  lines: { flex: 1, paddingTop: 2 },
  line: { height: 11, borderRadius: 6, backgroundColor: colors.border, marginBottom: spacing.sm },
  title: { width: '72%' },
  body: { width: '94%' },
  short: { width: '45%', marginBottom: 0 },
});
