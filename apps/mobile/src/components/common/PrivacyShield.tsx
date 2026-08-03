import React, { useEffect, useState } from 'react';
import {
  AppState,
  StyleSheet,
  Text,
  View,
  type AppStateStatus,
} from 'react-native';
import { colors, spacing, typography } from '../../theme';

/** Keep private member content out of app-switcher and background snapshots. */
export function shouldShowPrivacyShield(state: AppStateStatus): boolean {
  return state !== 'active';
}

export function PrivacyShield() {
  const [covered, setCovered] = useState(
    shouldShowPrivacyShield(AppState.currentState),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setCovered(shouldShowPrivacyShield(nextState));
    });
    return () => subscription.remove();
  }, []);

  if (!covered) return null;

  return (
    <View
      accessibilityViewIsModal
      importantForAccessibility="yes"
      style={styles.cover}
    >
      <View style={styles.orb} />
      <View style={styles.brandRow}>
        <View style={styles.mark}>
          <View style={styles.markInset} />
        </View>
        <Text style={styles.brand}>ALTAR OS</Text>
      </View>
      <Text accessibilityRole="header" style={styles.title}>
        Your space is private
      </Text>
      <Text style={styles.copy}>Return to Altar OS to continue.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.text,
    elevation: 1000,
    padding: spacing.xl,
    zIndex: 1000,
  },
  orb: {
    position: 'absolute',
    top: -120,
    right: -90,
    width: 290,
    height: 290,
    borderRadius: 145,
    backgroundColor: '#174C45',
  },
  brandRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing['2xl'],
  },
  mark: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: colors.primaryLight,
  },
  markInset: {
    width: 16,
    height: 22,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    backgroundColor: colors.text,
  },
  brand: {
    color: colors.surface,
    fontFamily: typography.families.bold,
    fontSize: typography.sizes.lg,
    letterSpacing: 1.4,
  },
  title: {
    color: colors.surface,
    fontFamily: typography.families.semibold,
    fontSize: typography.sizes['2xl'],
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  copy: {
    color: '#ABC1BC',
    fontFamily: typography.families.regular,
    fontSize: typography.sizes.base,
    textAlign: 'center',
  },
});
