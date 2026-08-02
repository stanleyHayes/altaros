const PAGE_PADDING = 48;
const MAX_CONTENT_WIDTH = 520;
const DIGIT_COUNT = 6;

export function otpDigitLayout(viewportWidth: number): { width: number; height: number; gap: number } {
  const safeViewport = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 320;
  const contentWidth = Math.max(216, Math.min(safeViewport, MAX_CONTENT_WIDTH) - PAGE_PADDING);
  const gap = safeViewport < 380 ? 4 : 8;
  const width = Math.max(32, Math.min(48, Math.floor((contentWidth - gap * (DIGIT_COUNT - 1)) / DIGIT_COUNT)));
  return { width, height: Math.max(50, Math.min(56, width + 8)), gap };
}
