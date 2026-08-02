export const OTP_RESEND_DELAY_MS = 60_000;

export function otpJourneyKey(
  phone: string | null,
  codeRequested: boolean,
  deliveryUnconfirmed: boolean,
): string {
  const phonePart = phone ?? '';
  return `${phonePart.length}:${phonePart}:${codeRequested ? 1 : 0}:${deliveryUnconfirmed ? 1 : 0}`;
}

export function ownsOtpJourney(activeJourney: string, startedJourney: string): boolean {
  return activeJourney === startedJourney;
}

export function otpResendSeconds(availableAt: number, now = Date.now()): number {
  if (!Number.isFinite(availableAt) || !Number.isFinite(now) || availableAt <= now) return 0;
  return Math.min(
    OTP_RESEND_DELAY_MS / 1_000,
    Math.ceil((availableAt - now) / 1_000),
  );
}
