export const colors = {
  primary: '#157F73',
  primaryLight: '#6DD5C4',
  primaryDark: '#0E5B53',
  secondary: '#A7C4A0',
  secondaryLight: '#DFF6F0',
  secondaryDark: '#607D64',
  background: '#F7FBF8',
  surface: '#FFFFFF',
  surfaceMuted: '#EFF6F2',
  text: '#102A27',
  textSecondary: '#58706C',
  muted: '#5B716C',
  border: '#DCE8E3',
  divider: '#EAF1ED',
  success: '#287A55',
  warning: '#965F10',
  error: '#A84545',
  info: '#2F6F80',
} as const;

export const typography = {
  sizes: {
    xs: 10,
    sm: 12,
    md: 14,
    base: 16,
    lg: 18,
    xl: 20,
    '2xl': 24,
    '3xl': 30,
    '4xl': 36,
  },
  weights: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
  families: {
    regular: 'Outfit_400Regular',
    medium: 'Outfit_500Medium',
    semibold: 'Outfit_600SemiBold',
    bold: 'Outfit_700Bold',
  },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
  '3xl': 40,
  '4xl': 48,
  xxl: 64,
} as const;

export const borderRadius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 18,
  '2xl': 26,
  full: 9999,
} as const;

export const shadows = {
  sm: {
    shadowColor: '#153D37',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#153D37',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  lg: {
    shadowColor: '#153D37',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.11,
    shadowRadius: 16,
    elevation: 4,
  },
} as const;

const theme = {
  colors,
  typography,
  spacing,
  borderRadius,
  shadows,
} as const;

export type Theme = typeof theme;
export default theme;
