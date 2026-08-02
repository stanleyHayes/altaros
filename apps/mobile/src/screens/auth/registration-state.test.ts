import {
  firstInvalidRegistrationStep,
  ownsRegistrationLookup,
  registrationChurchMatchesCode,
  registrationErrorsForStep,
  registrationRemovalDecision,
  type RegistrationFormValues,
} from './registration-state';

describe('registration church confirmation lifecycle', () => {
  const church = { id: 'church-1', name: 'Grace Chapel', slug: 'grace-chapel-accra' };

  it('accepts a confirmed church only while its canonical code still matches', () => {
    expect(registrationChurchMatchesCode(church, ' Grace-Chapel-Accra ')).toBe(true);
    expect(registrationChurchMatchesCode(church, 'another-church')).toBe(false);
    expect(registrationChurchMatchesCode(null, 'grace-chapel-accra')).toBe(false);
  });

  it('rejects lookup completion after either form revision or code changes', () => {
    expect(ownsRegistrationLookup(2, 2, 'Grace-Chapel', ' grace-chapel ')).toBe(true);
    expect(ownsRegistrationLookup(3, 2, 'grace-chapel', 'grace-chapel')).toBe(false);
    expect(ownsRegistrationLookup(2, 2, 'another-church', 'grace-chapel')).toBe(false);
  });
});

describe('stepwise registration validation', () => {
  const validForm: RegistrationFormValues = {
    firstName: 'Ama', lastName: 'Mensah', email: 'ama@example.com',
    phone: '0241234567', password: 'password123', confirmPassword: 'password123',
    churchCode: 'grace-chapel-accra',
  };
  const church = { id: 'church-1', name: 'Grace Chapel', slug: 'grace-chapel-accra' };

  it('validates only the fields visible on the active step', () => {
    expect(registrationErrorsForStep(0, { ...validForm, firstName: '' }, null))
      .toEqual({ firstName: 'First name is required' });
    expect(registrationErrorsForStep(1, { ...validForm, email: 'bad', phone: '123' }, null))
      .toEqual(expect.objectContaining({ email: 'Enter a valid email address', phone: expect.any(String) }));
    expect(registrationErrorsForStep(2, { ...validForm, password: 'short', confirmPassword: 'other' }, null))
      .toEqual(expect.objectContaining({ password: expect.any(String), confirmPassword: 'Passwords do not match' }));
    expect(registrationErrorsForStep(3, validForm, null))
      .toEqual({ churchCode: 'Find and confirm your church before creating your account' });
  });

  it('routes a full submit to the earliest invalid step', () => {
    expect(firstInvalidRegistrationStep({ ...validForm, email: '' }, church)?.step).toBe(1);
    expect(firstInvalidRegistrationStep({ ...validForm, password: 'short' }, church)?.step).toBe(2);
    expect(firstInvalidRegistrationStep(validForm, church)).toBeNull();
  });

  it('matches the registration transport boundaries before advancing', () => {
    expect(registrationErrorsForStep(0, {
      ...validForm, firstName: 'Ama\nAdmin',
    }, church)).toHaveProperty('firstName');
    expect(registrationErrorsForStep(0, {
      ...validForm, firstName: 'é'.repeat(60), lastName: 'é',
    }, church)).toHaveProperty('firstName');
    expect(registrationErrorsForStep(1, {
      ...validForm, email: `${'a'.repeat(243)}@example.com`,
    }, church)).toHaveProperty('email');
    expect(registrationErrorsForStep(2, {
      ...validForm, password: 'é'.repeat(37), confirmPassword: 'é'.repeat(37),
    }, church)).toHaveProperty('password');
    expect(registrationErrorsForStep(2, {
      ...validForm, password: 'password\n123', confirmPassword: 'password\n123',
    }, church)).toHaveProperty('password');
  });

  it('maps native back to the previous step without interrupting an active commit', () => {
    expect(registrationRemovalDecision(3, false, false)).toEqual({ kind: 'step', step: 2 });
    expect(registrationRemovalDecision(1, true, false)).toEqual({ kind: 'block' });
    expect(registrationRemovalDecision(0, false, false)).toEqual({ kind: 'allow' });
    expect(registrationRemovalDecision(3, true, true)).toEqual({ kind: 'allow' });
  });
});
