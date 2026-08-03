import { AxiosError, AxiosHeaders } from 'axios';
import {
  OTP_RESEND_DELAY_MS,
  otpCodeInputState,
  otpJourneyKey,
  otpResendSeconds,
  otpResendFailure,
  otpResendActionState,
  otpVerifyActionState,
  otpVerificationFailure,
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

describe('OTP interaction accessibility', () => {
  it('announces locked code fields and visible offline resend recovery', () => {
    expect(otpCodeInputState(true, false, false)).toEqual({
      editable: true,
      accessibilityState: { disabled: false, busy: false },
    });
    expect(otpCodeInputState(false, false, false)).toEqual({
      editable: false,
      accessibilityState: { disabled: true, busy: false },
    });
    expect(otpCodeInputState(true, true, false)).toEqual({
      editable: false,
      accessibilityState: { disabled: true, busy: true },
    });
    expect(otpResendActionState(true, true, false, false)).toEqual({
      label: 'Reconnect to request a code',
      hint: 'Reconnect to request another code.',
      disabled: true,
      busy: false,
    });
    expect(otpResendActionState(true, false, true, false)).toEqual({
      label: 'Sending another code…',
      hint: undefined,
      disabled: true,
      busy: true,
    });
  });

  it('makes every unavailable verification state explain its recovery', () => {
    expect(otpVerifyActionState(true, true, true, false, true, false, false)).toEqual({
      label: 'Reconnect to verify this code',
      disabled: true,
      hint: 'Reconnect to verify this code.',
    });
    expect(otpVerifyActionState(true, false, true, true, true, false, false).label)
      .toBe('Request a new code to continue');
    expect(otpVerifyActionState(true, false, false, false, false, false, false).label)
      .toBe('Request a code to continue');
    expect(otpVerifyActionState(true, false, true, false, false, false, false).label)
      .toBe('Enter all 6 digits');
    expect(otpVerifyActionState(true, false, true, false, true, false, true).label)
      .toBe('Verifying your code…');
    expect(otpVerifyActionState(true, false, true, false, true, false, false)).toEqual({
      label: 'Verify and continue',
      disabled: false,
      hint: undefined,
    });
  });
});

describe('OTP journey ownership', () => {
  it('binds state to phone and delivery context without key collisions', () => {
    const requested = otpJourneyKey('+233241234567', 'grace-chapel', true, false);
    expect(ownsOtpJourney(requested, requested)).toBe(true);
    expect(ownsOtpJourney(otpJourneyKey('+233501234567', 'grace-chapel', true, false), requested)).toBe(false);
    expect(ownsOtpJourney(otpJourneyKey('+233241234567', 'another-church', true, false), requested)).toBe(false);
    expect(ownsOtpJourney(otpJourneyKey('+233241234567', 'grace-chapel', false, false), requested)).toBe(false);
    expect(ownsOtpJourney(otpJourneyKey('+233241234567', 'grace-chapel', true, true), requested)).toBe(false);
    expect(otpJourneyKey('+23', 'a', true, false)).not.toBe(otpJourneyKey('+2', '3a', false, true));
  });
});

describe('OTP response-loss recovery', () => {
  const timeout = new AxiosError('timeout', 'ECONNABORTED');
  const rejected = new AxiosError(
    'Request failed',
    'ERR_BAD_REQUEST',
    { headers: new AxiosHeaders() },
    undefined,
    { data: { error: 'That code is invalid.' }, status: 400, statusText: 'Bad Request', headers: {}, config: { headers: new AxiosHeaders() } },
  );

  it('requires a new code when single-use verification may have succeeded', () => {
    expect(otpVerificationFailure(timeout)).toEqual({
      outcomeUnknown: true,
      message: 'We could not confirm whether that code was accepted. It may already be used. Request a new code before trying again.',
    });
    expect(otpVerificationFailure(rejected)).toEqual({
      outcomeUnknown: false,
      message: 'That code is invalid.',
    });
  });

  it('starts a cooldown when resend delivery may already be in flight', () => {
    expect(otpResendFailure(timeout)).toEqual({
      deliveryUnknown: true,
      message: 'We could not confirm delivery. A new code may already be on its way; wait before requesting another one.',
    });
    expect(otpResendFailure(rejected)).toEqual({
      deliveryUnknown: false,
      message: 'That code is invalid.',
    });
  });
});
