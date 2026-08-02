import { otpDigitLayout } from './otp-layout';

describe('OTP digit layout', () => {
  it.each([320, 360, 375])('fits six code fields inside a %d point compact viewport', (viewport) => {
    const layout = otpDigitLayout(viewport);
    expect(layout.width * 6 + layout.gap * 5 + 48).toBeLessThanOrEqual(viewport);
  });

  it('caps fields at a comfortable size on wide screens', () => {
    expect(otpDigitLayout(1024)).toEqual({ width: 48, height: 56, gap: 8 });
  });

  it('falls back safely when dimensions are unavailable', () => {
    expect(otpDigitLayout(Number.NaN).width).toBeGreaterThanOrEqual(32);
  });
});
