import {
  canonicalEmail,
  canonicalPhone,
  validAuthPassword,
  validRegistrationName,
  type RegistrationChurch,
} from '../../services/auth.service';

export type RegistrationStep = 0 | 1 | 2 | 3;

export interface RegistrationFormValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  churchCode: string;
}

export const REGISTRATION_STEPS = [
  { title: 'Your name', subtitle: 'Tell us what your church community should call you.' },
  { title: 'Contact details', subtitle: 'We’ll use your mobile number to verify this account.' },
  { title: 'Secure your account', subtitle: 'Choose a private password you do not use elsewhere.' },
  { title: 'Find your church', subtitle: 'Enter the code shared by your church office.' },
] as const;

export type RegistrationRemovalDecision =
  | { kind: 'allow' }
  | { kind: 'block' }
  | { kind: 'step'; step: RegistrationStep };

export function registrationRemovalDecision(
  step: RegistrationStep,
  isCommitting: boolean,
  explicitExit: boolean,
): RegistrationRemovalDecision {
  if (explicitExit) return { kind: 'allow' };
  if (isCommitting) return { kind: 'block' };
  if (step > 0) return { kind: 'step', step: (step - 1) as RegistrationStep };
  return { kind: 'allow' };
}

export function registrationErrorsForStep(
  step: RegistrationStep,
  form: RegistrationFormValues,
  church: RegistrationChurch | null,
): Partial<Record<keyof RegistrationFormValues, string>> {
  const errors: Partial<Record<keyof RegistrationFormValues, string>> = {};
  if (step === 0) {
    if (!form.firstName.trim()) errors.firstName = 'First name is required';
    if (!form.lastName.trim()) errors.lastName = 'Last name is required';
    if (!errors.firstName && !errors.lastName
      && !validRegistrationName(form.firstName, form.lastName)) {
      errors.firstName = 'Enter a valid name using 120 UTF-8 bytes or fewer';
    }
  }
  if (step === 1) {
    if (!form.email.trim()) errors.email = 'Email is required';
    else if (!canonicalEmail(form.email)) {
      errors.email = 'Enter a valid email address';
    }
    if (!form.phone.trim()) errors.phone = 'Phone is required';
    else if (!canonicalPhone(form.phone)) {
      errors.phone = 'Enter a valid mobile number, including the country code';
    }
  }
  if (step === 2) {
    if (!validAuthPassword(form.password, 8)) {
      errors.password = 'Use 8–72 UTF-8 bytes without control characters';
    }
    if (form.password !== form.confirmPassword) errors.confirmPassword = 'Passwords do not match';
  }
  if (step === 3) {
    if (!form.churchCode.trim()) errors.churchCode = 'Church code is required';
    else if (!registrationChurchMatchesCode(church, form.churchCode)) {
      errors.churchCode = 'Find and confirm your church before creating your account';
    }
  }
  return errors;
}

export function firstInvalidRegistrationStep(
  form: RegistrationFormValues,
  church: RegistrationChurch | null,
): { step: RegistrationStep; errors: Partial<Record<keyof RegistrationFormValues, string>> } | null {
  for (const step of [0, 1, 2, 3] as const) {
    const errors = registrationErrorsForStep(step, form, church);
    if (Object.keys(errors).length > 0) return { step, errors };
  }
  return null;
}

export function canonicalChurchCodeInput(value: string): string {
  return value.trim().toLowerCase();
}

export function registrationChurchMatchesCode(
  church: RegistrationChurch | null,
  input: string,
): boolean {
  return church !== null && church.slug === canonicalChurchCodeInput(input);
}

export function ownsRegistrationLookup(
  activeRevision: number,
  startedRevision: number,
  activeCode: string,
  startedCode: string,
): boolean {
  return activeRevision === startedRevision
    && canonicalChurchCodeInput(activeCode) === canonicalChurchCodeInput(startedCode);
}
