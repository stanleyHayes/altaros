import {
  canonicalEmail,
  canonicalPhone,
  validAuthPassword,
  canonicalWorkspace,
} from '../../services/auth.service';

export type LoginMethod = 'phone' | 'password';

export interface LoginFormValues {
  phone: string;
  email: string;
  password: string;
  workspace: string;
}

export function loginPrimaryActionState(
  method: LoginMethod,
  offline: boolean,
  loading: boolean,
) {
  const requestingCode = method === 'phone';
  return {
    label: loading
      ? requestingCode ? 'Sending your code…' : 'Signing you in…'
      : offline
        ? requestingCode ? 'Reconnect to request a code' : 'Reconnect to sign in'
        : requestingCode ? 'Send my code' : 'Sign in',
    disabled: offline,
    hint: offline
      ? requestingCode ? 'Reconnect to request a sign-in code.' : 'Reconnect to sign in.'
      : undefined,
  } as const;
}

export function loginErrors(
  method: LoginMethod,
  values: LoginFormValues,
): Partial<Record<keyof LoginFormValues, string>> {
  const workspaceError = canonicalWorkspace(values.workspace)
    ? {}
    : { workspace: 'Enter the church workspace provided by your church' };
  if (method === 'phone') {
    return {
      ...workspaceError,
      ...(canonicalPhone(values.phone) ? {} : { phone: 'Enter a valid mobile number, including the country code' }),
    };
  }

  const errors: Partial<Record<keyof LoginFormValues, string>> = workspaceError;
  if (!canonicalEmail(values.email)) errors.email = 'Enter a valid email address';
  if (!validAuthPassword(values.password, 1)) {
    errors.password = 'Enter a valid password of 72 UTF-8 bytes or fewer';
  }
  return errors;
}
