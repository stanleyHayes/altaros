export const FONT_LOAD_WAIT_MS = 2_500;

/**
 * Bundled fonts normally resolve before the branded launch completes. Native
 * bridge work is still an availability boundary, so neither rejection nor an
 * indefinitely pending read may keep the member app behind splash forever.
 */
export function shouldHoldLaunchForFonts(
  loaded: boolean,
  failed: boolean,
  waitExpired: boolean,
): boolean {
  return !loaded && !failed && !waitExpired;
}
