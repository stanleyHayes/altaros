import { colors, typography } from './theme';

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) => (
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

function blendOverWhite(hex: string, opacity: number): string {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  return `#${channels.map((channel) => (
    Math.round(channel * opacity + 255 * (1 - opacity)).toString(16).padStart(2, '0')
  )).join('')}`;
}

describe('mobile theme contrast', () => {
  const lightSurfaces = [
    colors.background,
    colors.surface,
    colors.surfaceMuted,
    colors.secondaryLight,
  ];

  it.each([
    ['text', colors.text],
    ['textSecondary', colors.textSecondary],
    ['muted', colors.muted],
    ['primaryDark', colors.primaryDark],
  ])('%s remains readable as normal-size text on every light surface', (_name, foreground) => {
    lightSurfaces.forEach((background) => {
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    });
  });

  it('keeps primary link text readable on the base page and card surfaces', () => {
    [colors.background, colors.surface].forEach((background) => {
      expect(contrastRatio(colors.primary, background)).toBeGreaterThanOrEqual(4.5);
    });
  });

  it.each([
    ['success', colors.success],
    ['warning', colors.warning],
    ['error', colors.error],
    ['info', colors.info],
  ])('%s status text remains readable on light surfaces and its badge tint', (_name, foreground) => {
    lightSurfaces.forEach((background) => {
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    });
    expect(contrastRatio(foreground, blendOverWhite(foreground, 0x18 / 255))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('mobile typography identity', () => {
  it('uses bundled Outfit faces for the complete product hierarchy', () => {
    expect(typography.families).toEqual({
      regular: 'Outfit_400Regular',
      medium: 'Outfit_500Medium',
      semibold: 'Outfit_600SemiBold',
      bold: 'Outfit_700Bold',
    });
  });
});
