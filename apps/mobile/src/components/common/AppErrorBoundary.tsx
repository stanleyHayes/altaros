import React, { Component, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from './Button';
import { borderRadius, colors, spacing, typography } from '../../theme';

interface Props { children: ReactNode }
interface State { hasError: boolean; recoveryKey: number }

export function AppErrorFallback({ onRecover }: { onRecover: () => void }) {
  return (
    <View style={styles.screen}>
      <View style={styles.mark} importantForAccessibility="no-hide-descendants"><Text style={styles.markText}>A</Text></View>
      <Text style={styles.eyebrow}>ALTAR OS</Text>
      <Text
        style={styles.title}
        accessibilityRole="header"
        accessibilityLiveRegion="assertive"
      >
        Something interrupted the app.
      </Text>
      <Text style={styles.body}>
        Your account and payment details are still safe. Restart this view to continue.
      </Text>
      <Button title="Restart app view" onPress={onRecover} fullWidth size="lg" />
    </View>
  );
}

/** Last-resort recovery for unexpected React render failures. */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, recoveryKey: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  private recover = (): void => {
    this.setState(({ recoveryKey }) => ({ hasError: false, recoveryKey: recoveryKey + 1 }));
  };

  render() {
    if (this.state.hasError) {
      return <AppErrorFallback onRecover={this.recover} />;
    }

    return <React.Fragment key={this.state.recoveryKey}>{this.props.children}</React.Fragment>;
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: spacing.xl },
  mark: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', borderRadius: borderRadius.full, backgroundColor: colors.primary, marginBottom: spacing.lg },
  markText: { color: colors.surface, fontSize: typography.sizes['2xl'], fontFamily: typography.families.bold },
  eyebrow: { color: colors.primary, fontSize: typography.sizes.xs, fontFamily: typography.families.bold, letterSpacing: 1.4 },
  title: { color: colors.text, fontSize: typography.sizes['2xl'], fontFamily: typography.families.bold, textAlign: 'center', marginTop: spacing.md },
  body: { color: colors.textSecondary, fontSize: typography.sizes.base, lineHeight: 24, textAlign: 'center', maxWidth: 420, marginVertical: spacing.base },
});
