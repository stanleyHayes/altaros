import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { borderRadius, colors, shadows, spacing, typography } from '../../theme';

type StatePanelTone = 'quiet' | 'error' | 'offline';

interface StatePanelProps {
  title: string;
  message: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tone?: StatePanelTone;
  actionLabel?: string;
  actionHint?: string;
  actionDisabled?: boolean;
  onAction?: () => void;
}

const toneColors: Record<StatePanelTone, { accent: string; wash: string }> = {
  quiet: { accent: colors.primary, wash: colors.secondaryLight },
  error: { accent: colors.error, wash: '#FFF2EF' },
  offline: { accent: colors.warning, wash: '#FFF7E8' },
};

/** Branded, accessible empty/recovery state shared by member list surfaces. */
export function StatePanel({
  title,
  message,
  icon,
  tone = 'quiet',
  actionLabel,
  actionHint,
  actionDisabled = false,
  onAction,
}: StatePanelProps) {
  const palette = toneColors[tone];
  const actionable = Boolean(actionLabel && onAction);

  return (
    <View style={styles.wrap}>
      <View style={[styles.panel, { borderColor: `${palette.accent}22` }]}>
        <View
          style={[styles.iconWell, { backgroundColor: palette.wash }]}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        >
          <Ionicons name={icon} size={28} color={palette.accent} />
        </View>
        <Text style={styles.eyebrow}>{tone === 'quiet' ? 'ALL CLEAR' : 'LET’S GET YOU BACK'}</Text>
        <Text style={styles.title} accessibilityRole="header">{title}</Text>
        <Text
          style={styles.message}
          accessibilityRole={tone === 'quiet' ? undefined : 'alert'}
          accessibilityLiveRegion={tone === 'quiet' ? undefined : 'polite'}
        >
          {message}
        </Text>
        {actionable ? (
          <TouchableOpacity
            style={[styles.action, { backgroundColor: palette.accent }, actionDisabled && styles.actionDisabled]}
            onPress={onAction}
            disabled={actionDisabled}
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
            accessibilityHint={actionHint}
            accessibilityState={{ disabled: actionDisabled }}
          >
            <Text style={styles.actionText}>{actionLabel}</Text>
            <Ionicons name="arrow-forward" size={17} color={colors.surface} accessible={false} />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexGrow: 1,
    justifyContent: 'center',
    width: '100%',
    paddingVertical: spacing['3xl'],
  },
  panel: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderRadius: borderRadius['2xl'],
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing['2xl'],
    ...shadows.md,
  },
  iconWell: {
    width: 62,
    height: 62,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.full,
    marginBottom: spacing.lg,
  },
  eyebrow: {
    color: colors.primary,
    fontFamily: typography.families.bold,
    fontSize: typography.sizes.xs,
    letterSpacing: 1.4,
    marginBottom: spacing.sm,
  },
  title: {
    color: colors.text,
    fontFamily: typography.families.bold,
    fontSize: typography.sizes.xl,
    lineHeight: 28,
    textAlign: 'center',
  },
  message: {
    color: colors.textSecondary,
    fontFamily: typography.families.regular,
    fontSize: typography.sizes.md,
    lineHeight: 21,
    marginTop: spacing.sm,
    maxWidth: 300,
    textAlign: 'center',
  },
  action: {
    minHeight: 48,
    minWidth: 156,
    borderRadius: borderRadius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  actionDisabled: { opacity: 0.48 },
  actionText: {
    color: colors.surface,
    fontFamily: typography.families.semibold,
    fontSize: typography.sizes.md,
  },
});
