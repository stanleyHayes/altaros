import { FONT_LOAD_WAIT_MS, shouldHoldLaunchForFonts } from './font-readiness';

describe('mobile font startup readiness', () => {
  it('waits only while the bundled font request is genuinely pending', () => {
    expect(shouldHoldLaunchForFonts(false, false, false)).toBe(true);
    expect(shouldHoldLaunchForFonts(true, false, false)).toBe(false);
    expect(shouldHoldLaunchForFonts(false, true, false)).toBe(false);
    expect(shouldHoldLaunchForFonts(false, false, true)).toBe(false);
  });

  it('uses a short bounded wait instead of creating a second launch screen', () => {
    expect(FONT_LOAD_WAIT_MS).toBeGreaterThanOrEqual(1_000);
    expect(FONT_LOAD_WAIT_MS).toBeLessThanOrEqual(3_000);
  });
});
