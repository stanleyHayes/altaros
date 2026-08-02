import { loginErrors, type LoginFormValues } from './login-state';

describe('login form validation', () => {
  const valid: LoginFormValues = {
    phone: '024 123 4567',
    email: 'ama@example.com',
    password: 'secret',
  };

  it('validates only the active sign-in method', () => {
    expect(loginErrors('phone', { ...valid, email: 'bad', password: '' })).toEqual({});
    expect(loginErrors('password', { ...valid, phone: 'bad' })).toEqual({});
    expect(loginErrors('phone', { ...valid, phone: '123' })).toHaveProperty('phone');
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
