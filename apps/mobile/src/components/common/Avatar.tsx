import React from 'react';
import { View, Text, Image, StyleSheet, ViewStyle } from 'react-native';
import { colors, typography } from '../../theme';

type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

interface AvatarProps {
  uri?: string;
  name: string;
  size?: AvatarSize;
  style?: ViewStyle;
}

const sizeMap: Record<AvatarSize, number> = {
  sm: 32,
  md: 44,
  lg: 64,
  xl: 96,
};

const fontSizeMap: Record<AvatarSize, number> = {
  sm: 12,
  md: 16,
  lg: 24,
  xl: 36,
};

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function Avatar({ uri, name, size = 'md', style }: AvatarProps) {
  const dimension = sizeMap[size];
  const fontSize = fontSizeMap[size];

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[
          styles.image,
          { width: dimension, height: dimension, borderRadius: dimension / 2 },
          style,
        ]}
      />
    );
  }

  return (
    <View
      style={[
        styles.fallback,
        { width: dimension, height: dimension, borderRadius: dimension / 2 },
        style,
      ]}
    >
      <Text style={[styles.initials, { fontSize }]}>{getInitials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    resizeMode: 'cover',
  },
  fallback: {
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: '#FFFFFF',
    fontWeight: typography.weights.bold,
  },
});
