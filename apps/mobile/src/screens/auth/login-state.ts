import {
  canonicalEmail,
  canonicalPhone,
  validAuthPassword,
} from '../../services/auth.service';

export type LoginMethod = 'phone' | 'password';

export interface LoginFormValues {
  phone: string;
  email: string;
  password: string;
}

export function loginErrors(
  method: LoginMethod,
  values: LoginFormValues,
): Partial<Record<keyof LoginFormValues, string>> {
  if (method === 'phone') {
    return canonicalPhone(values.phone)
      ? {}
      : { phone: 'Enter a valid mobile number, including the country code' };
  }

  const errors: Partial<Record<keyof LoginFormValues, string>> = {};
  if (!canonicalEmail(values.email)) errors.email = 'Enter a valid email address';
  if (!validAuthPassword(values.password, 1)) {
    errors.password = 'Enter a valid password of 72 UTF-8 bytes or fewer';
  }
  return errors;
}
