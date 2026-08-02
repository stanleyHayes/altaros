import React, { forwardRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TextInputProps,
  ViewStyle,
  type AccessibilityState,
} from 'react-native';
import { colors, typography, spacing, borderRadius } from '../../theme';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  containerStyle?: ViewStyle;
}

export function mergeInputAccessibility(
  state: AccessibilityState | undefined,
  editable: boolean | undefined,
  hint: string | undefined,
  error: string | undefined,
): { state: AccessibilityState; hint: string | undefined } {
  return {
    state: { ...state, disabled: editable === false || state?.disabled === true },
    hint: error
      ? [hint, `Error: ${error}`].filter(Boolean).join('. ')
      : hint,
  };
}

export const Input = forwardRef<TextInput, InputProps>(function Input({
  label,
  error,
  containerStyle,
  style,
  ...props
}: InputProps, ref) {
  const [isFocused, setIsFocused] = useState(false);
  const accessibility = mergeInputAccessibility(
    props.accessibilityState,
    props.editable,
    props.accessibilityHint,
    error,
  );

  return (
    <View style={[styles.container, containerStyle]}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        ref={ref}
        {...props}
        style={[
          styles.input,
          isFocused && styles.inputFocused,
          error && styles.inputError,
          style,
        ]}
        placeholderTextColor={colors.muted}
        accessibilityLabel={props.accessibilityLabel ?? label ?? props.placeholder}
        accessibilityHint={accessibility.hint}
        accessibilityState={accessibility.state}
        aria-invalid={Boolean(error)}
        onFocus={(e) => {
          setIsFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setIsFocused(false);
          props.onBlur?.(e);
        }}
      />
      {error && (
        <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.base,
  },
  label: {
    fontSize: typography.sizes.md,
    fontFamily: typography.families.medium,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.base,
    minHeight: 52,
    paddingVertical: spacing.md,
    fontSize: typography.sizes.base,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  inputFocused: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  inputError: {
    borderColor: colors.error,
  },
  error: {
    fontSize: typography.sizes.sm,
    color: colors.error,
    marginTop: spacing.xs,
  },
});
