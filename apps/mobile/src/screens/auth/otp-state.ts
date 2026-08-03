import { apiErrorMessage, isAmbiguousMutationFailure } from '../../services/api-error';
import { OtpDeliveryUnknownError } from '../../services/auth.service';

export const OTP_RESEND_DELAY_MS = 60_000;

export function otpCodeInputState(
  hasRequestedCode: boolean,
  verifying: boolean,
  resending: boolean,
): { editable: boolean; accessibilityState: { disabled: boolean; busy: boolean } } {
  const busy = verifying || resending;
  const editable = hasRequestedCode && !busy;
  return {
    editable,
    accessibilityState: { disabled: !editable, busy },
  };
}

export function otpResendActionState(
  validRoute: boolean,
  offline: boolean,
  resending: boolean,
  verifying: boolean,
): { label: string; hint: string | undefined; disabled: boolean; busy: boolean } {
  const busy = resending || verifying;
  const disabled = !validRoute || offline || busy;
  return {
    label: resending
      ? 'Sending another code…'
      : offline ? 'Reconnect to request a code' : 'Send another code',
    hint: !validRoute
      ? 'Return to sign in and enter a valid mobile number.'
      : offline ? 'Reconnect to request another code.'
        : verifying ? 'Wait while this code is being verified.' : undefined,
    disabled,
    busy,
  };
}

export function otpVerifyActionState(
  validRoute: boolean,
  offline: boolean,
  hasRequestedCode: boolean,
  outcomeUnknown: boolean,
  codeComplete: boolean,
  resending: boolean,
  verifying: boolean,
) {
  return {
    label: verifying
      ? 'Verifying your code…'
      : offline ? 'Reconnect to verify this code'
        : outcomeUnknown ? 'Request a new code to continue'
          : !hasRequestedCode ? 'Request a code to continue'
            : !codeComplete ? 'Enter all 6 digits' : 'Verify and continue',
    disabled: !validRoute || offline || !hasRequestedCode || outcomeUnknown
      || !codeComplete || resending || verifying,
    hint: !validRoute
      ? 'Return to sign in and request a new code.'
      : offline ? 'Reconnect to verify this code.'
        : outcomeUnknown ? 'Request a new code because the previous verification result is unknown.'
          : !hasRequestedCode ? 'Request a code before verification.'
            : !codeComplete ? 'Enter all 6 digits from the message.'
              : resending ? 'Wait while a new code is being requested.' : undefined,
  } as const;
}

export function otpVerificationFailure(error: unknown): { outcomeUnknown: boolean; message: string } {
  return (error instanceof OtpDeliveryUnknownError || isAmbiguousMutationFailure(error))
    ? {
      outcomeUnknown: true,
      message: 'We could not confirm whether that code was accepted. It may already be used. Request a new code before trying again.',
    }
    : {
      outcomeUnknown: false,
      message: apiErrorMessage(error, 'We could not verify that code. Try again.'),
    };
}

export function otpResendFailure(error: unknown): { deliveryUnknown: boolean; message: string } {
  return isAmbiguousMutationFailure(error)
    ? {
      deliveryUnknown: true,
      message: 'We could not confirm delivery. A new code may already be on its way; wait before requesting another one.',
    }
    : {
      deliveryUnknown: false,
      message: apiErrorMessage(error, 'We could not resend the code. Try again.'),
    };
}

export function otpJourneyKey(
  phone: string | null,
  workspace: string | null,
  codeRequested: boolean,
  deliveryUnconfirmed: boolean,
): string {
  const phonePart = phone ?? '';
  const workspacePart = workspace ?? '';
  return `${phonePart.length}:${phonePart}:${workspacePart.length}:${workspacePart}:${codeRequested ? 1 : 0}:${deliveryUnconfirmed ? 1 : 0}`;
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
