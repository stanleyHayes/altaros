import { loginErrors, loginPrimaryActionState, type LoginFormValues } from './login-state';

describe('login primary action recovery', () => {
  it('makes offline and busy states visible for both sign-in methods', () => {
    expect(loginPrimaryActionState('phone', true, false)).toEqual({
      label: 'Reconnect to request a code',
      disabled: true,
      hint: 'Reconnect to request a sign-in code.',
    });
    expect(loginPrimaryActionState('password', true, false)).toEqual({
      label: 'Reconnect to sign in',
      disabled: true,
      hint: 'Reconnect to sign in.',
    });
    expect(loginPrimaryActionState('phone', false, true).label).toBe('Sending your code…');
    expect(loginPrimaryActionState('password', false, true).label).toBe('Signing you in…');
  });
});

describe('login form validation', () => {
  const valid: LoginFormValues = {
    phone: '024 123 4567',
    email: 'ama@example.com',
    password: 'secret',
    workspace: 'grace-chapel-accra',
  };

  it('validates only the active sign-in method', () => {
    expect(loginErrors('phone', { ...valid, email: 'bad', password: '' })).toEqual({});
    expect(loginErrors('password', { ...valid, phone: 'bad' })).toEqual({});
    expect(loginErrors('phone', { ...valid, phone: '123' })).toHaveProperty('phone');
  });

  it('requires the church workspace for both sign-in methods', () => {
    expect(loginErrors('phone', { ...valid, workspace: '' })).toHaveProperty('workspace');
    expect(loginErrors('password', { ...valid, workspace: '' })).toHaveProperty('workspace');
  });

  it('matches the transport email and UTF-8 password boundaries', () => {
    expect(loginErrors('password', { ...valid, email: `${'a'.repeat(243)}@example.com` }))
      .toHaveProperty('email');
    expect(loginErrors('password', { ...valid, password: 'é'.repeat(37) }))
      .toHaveProperty('password');
    expect(loginErrors('password', { ...valid, password: 'secret\n' }))
      .toHaveProperty('password');
    expect(loginErrors('password', valid)).toEqual({});
  });
});
