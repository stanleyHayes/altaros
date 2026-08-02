import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet, Animated, Easing, AccessibilityInfo, Platform } from 'react-native';
import { colors, typography, spacing } from '../../theme';
import { resolveReducedMotion } from './splash-motion';
import appIcon from '../../../assets/icon.png';

interface SplashScreenProps {
  /** Called once the splash animation has finished. */
  onComplete: () => void;
  /** How long the splash stays on screen, in ms. */
  duration?: number;
}

export function SplashScreen({ onComplete, duration = 1600 }: SplashScreenProps) {
  const fade = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.88)).current;
  const [motion, setMotion] = useState({ ready: false, reduced: false });

  useEffect(() => {
    let mounted = true;
    void resolveReducedMotion(() => AccessibilityInfo.isReduceMotionEnabled()).then((reduced) => {
      if (mounted) setMotion({ ready: true, reduced });
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (reduced) => {
      setMotion({ ready: true, reduced });
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!motion.ready) return;
    const animation = Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: motion.reduced ? 0 : 360,
        easing: Easing.out(Easing.quad),
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: motion.reduced ? 0 : 440,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]);
    animation.start();

    const timer = setTimeout(() => onComplete(), duration);
    return () => {
      animation.stop();
      clearTimeout(timer);
    };
  }, [fade, scale, onComplete, duration, motion]);

  return (
    <View style={styles.container}>
      <Animated.View
        style={[styles.markWrap, { opacity: fade, transform: [{ scale }] }]}
        accessible
        accessibilityLabel="ALTAR OS. Your church community."
      >
        <Image
          source={appIcon}
          style={styles.mark}
          resizeMode="contain"
          accessible={false}
          importantForAccessibility="no"
        />
        <Text style={styles.title}>ALTAR OS</Text>
        <Text style={styles.subtitle}>Your church community</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markWrap: {
    alignItems: 'center',
  },
  mark: {
    width: 96,
    height: 96,
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: typography.sizes['2xl'],
    fontFamily: typography.families.bold,
    color: colors.surface,
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: typography.sizes.md,
    color: 'rgba(255,255,255,0.75)',
    marginTop: spacing.xs,
  },
});
