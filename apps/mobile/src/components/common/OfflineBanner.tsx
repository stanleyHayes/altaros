import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';
import { colors, spacing, typography } from '../../theme';

export function OfflineBanner() {
  const { isConnected, isInternetReachable } = useNetInfo();
  const offline = isConnected === false || isInternetReachable === false;
  if (!offline) return null;

  return (
    <View style={styles.banner} accessibilityRole="alert">
      <View style={styles.dot} />
      <Text style={styles.text}>You&apos;re offline. New updates and actions need a connection.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: '#FFF3D8', borderBottomWidth: 1, borderBottomColor: '#E9D49F', paddingHorizontal: spacing.base, paddingVertical: spacing.sm },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.warning },
  text: { flexShrink: 1, color: '#6F501D', fontSize: typography.sizes.sm, textAlign: 'center' },
});
