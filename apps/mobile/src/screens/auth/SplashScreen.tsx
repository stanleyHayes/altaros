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
      <View style={styles.orbitLarge} accessible={false} importantForAccessibility="no" />
      <View style={styles.orbitSmall} accessible={false} importantForAccessibility="no" />
      <Animated.View
        style={[styles.markWrap, { opacity: fade, transform: [{ scale }] }]}
        accessible
        accessibilityLabel="ALTAR OS. Your church community."
      >
        <View style={styles.markSurface}>
          <Image source={appIcon} style={styles.mark} resizeMode="contain" accessible={false} importantForAccessibility="no" />
        </View>
        <Text style={styles.eyebrow}>MEMBER SPACE</Text>
        <Text style={styles.title}>A quiet place{`\n`}to begin.</Text>
        <Text style={styles.subtitle}>Your church stays close through the week.</Text>
      </Animated.View>
      <View style={styles.footer} accessible={false} importantForAccessibility="no">
        <View style={styles.progressTrack}><View style={styles.progressFill} /></View>
        <Text style={styles.wordmark}>ALTAR <Text style={styles.wordmarkAccent}>OS</Text></Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing['3xl'],
    paddingBottom: spacing.xl,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  markWrap: {
    marginTop: 'auto',
    marginBottom: 'auto',
    alignItems: 'flex-start',
    width: '100%',
  },
  markSurface: {
    width: 82,
    height: 82,
    borderRadius: 26,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing['2xl'],
  },
  mark: {
    width: 68,
    height: 68,
    borderRadius: 20,
  },
  eyebrow: {
    fontFamily: typography.families.semibold,
    fontSize: typography.sizes.sm,
    letterSpacing: 2.8,
    color: colors.primaryLight,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 52,
    lineHeight: 53,
    fontFamily: typography.families.bold,
    color: colors.surface,
    letterSpacing: -2.4,
  },
  subtitle: {
    fontFamily: typography.families.regular,
    fontSize: typography.sizes.lg,
    lineHeight: 27,
    color: 'rgba(255,255,255,0.62)',
    marginTop: spacing.lg,
    maxWidth: 330,
  },
  footer: { width: '100%' },
  progressTrack: { height: 2, width: '100%', backgroundColor: 'rgba(255,255,255,.12)', marginBottom: spacing.lg },
  progressFill: { height: 2, width: '68%', backgroundColor: colors.primaryLight },
  wordmark: { fontFamily: typography.families.bold, color: colors.surface, fontSize: typography.sizes.lg, letterSpacing: -.5 },
  wordmarkAccent: { color: colors.primaryLight },
  orbitLarge: {
    position: 'absolute', width: 360, height: 360, borderRadius: 180,
    borderWidth: 1, borderColor: 'rgba(109,213,196,.1)', right: -190, top: -130,
  },
  orbitSmall: {
    position: 'absolute', width: 210, height: 210, borderRadius: 105,
    borderWidth: 1, borderColor: 'rgba(109,213,196,.08)', right: -82, top: -56,
  },
});
