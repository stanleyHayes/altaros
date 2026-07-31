import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { colors, typography, spacing } from '../../theme';

interface SplashScreenProps {
  /** Called once the splash animation has finished. */
  onComplete: () => void;
  /** How long the splash stays on screen, in ms. */
  duration?: number;
}

export function SplashScreen({ onComplete, duration = 1600 }: SplashScreenProps) {
  const fade = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.88)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 450,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        friction: 6,
        tension: 60,
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(() => onComplete(), duration);
    return () => clearTimeout(timer);
  }, [fade, scale, onComplete, duration]);

  return (
    <View style={styles.container}>
      <Animated.View
        style={[styles.markWrap, { opacity: fade, transform: [{ scale }] }]}
      >
        <View style={styles.mark}>
          <Text style={styles.markLetter}>A</Text>
        </View>
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
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  markLetter: {
    fontSize: typography.sizes['4xl'],
    fontWeight: typography.weights.bold,
    color: colors.primary,
  },
  title: {
    fontSize: typography.sizes['2xl'],
    fontWeight: typography.weights.bold,
    color: colors.surface,
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: typography.sizes.md,
    color: 'rgba(255,255,255,0.75)',
    marginTop: spacing.xs,
  },
});
