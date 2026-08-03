import React, { forwardRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  TextInputProps,
  ViewStyle,
  type AccessibilityState,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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

export function passwordVisibilityState(
  isPasswordInput: boolean,
  passwordVisible: boolean,
): {
  secureTextEntry: boolean | undefined;
  label: 'Show password' | 'Hide password';
  hint: string;
} {
  return {
    secureTextEntry: isPasswordInput ? !passwordVisible : undefined,
    label: passwordVisible ? 'Hide password' : 'Show password',
    hint: passwordVisible
      ? 'Masks the password in this field.'
      : 'Reveals the password in this field.',
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
  const [passwordVisible, setPasswordVisible] = useState(false);
  const isPasswordInput = props.secureTextEntry === true;
  const passwordVisibility = passwordVisibilityState(isPasswordInput, passwordVisible);
  const accessibility = mergeInputAccessibility(
    props.accessibilityState,
    props.editable,
    props.accessibilityHint,
    error,
  );

  return (
    <View style={[styles.container, containerStyle]}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.inputShell}>
        <TextInput
          ref={ref}
          {...props}
          secureTextEntry={passwordVisibility.secureTextEntry}
          style={[
            styles.input,
            isPasswordInput && styles.passwordInput,
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
        {isPasswordInput ? (
          <TouchableOpacity
            style={styles.passwordToggle}
            onPress={() => setPasswordVisible((visible) => !visible)}
            disabled={props.editable === false}
            accessibilityRole="button"
            accessibilityLabel={passwordVisibility.label}
            accessibilityHint={passwordVisibility.hint}
            accessibilityState={{ disabled: props.editable === false }}
          >
            <Ionicons
              name={passwordVisible ? 'eye-off-outline' : 'eye-outline'}
              size={21}
              color={props.editable === false ? colors.border : colors.muted}
              importantForAccessibility="no-hide-descendants"
            />
          </TouchableOpacity>
        ) : null}
      </View>
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
  inputShell: {
    position: 'relative',
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
  passwordInput: {
    paddingRight: 60,
  },
  passwordToggle: {
    position: 'absolute',
    right: 4,
    top: 4,
    width: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.md,
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
