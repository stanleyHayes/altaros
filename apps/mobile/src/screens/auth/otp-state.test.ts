import {
  OTP_RESEND_DELAY_MS,
  otpJourneyKey,
  otpResendSeconds,
  ownsOtpJourney,
} from './otp-state';

describe('OTP resend cooldown', () => {
  it('uses elapsed wall-clock time instead of foreground timer ticks', () => {
    const startedAt = 1_000_000;
    const availableAt = startedAt + OTP_RESEND_DELAY_MS;
    expect(otpResendSeconds(availableAt, startedAt)).toBe(60);
    expect(otpResendSeconds(availableAt, startedAt + 30_001)).toBe(30);
    expect(otpResendSeconds(availableAt, startedAt + 60_000)).toBe(0);
    expect(otpResendSeconds(availableAt, startedAt + 120_000)).toBe(0);
  });

  it('fails open for invalid or expired internal deadlines', () => {
    expect(otpResendSeconds(Number.NaN, 1_000)).toBe(0);
    expect(otpResendSeconds(999, 1_000)).toBe(0);
  });
});

describe('OTP journey ownership', () => {
  it('binds state to phone and delivery context without key collisions', () => {
    const requested = otpJourneyKey('+233241234567', true, false);
    expect(ownsOtpJourney(requested, requested)).toBe(true);
    expect(ownsOtpJourney(otpJourneyKey('+233501234567', true, false), requested)).toBe(false);
    expect(ownsOtpJourney(otpJourneyKey('+233241234567', false, false), requested)).toBe(false);
    expect(ownsOtpJourney(otpJourneyKey('+233241234567', true, true), requested)).toBe(false);
    expect(otpJourneyKey('+23', true, false)).not.toBe(otpJourneyKey('+2', false, true));
  });
});
