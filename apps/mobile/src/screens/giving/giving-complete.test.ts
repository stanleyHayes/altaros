import {
  SETTLEMENT_MAX_ATTEMPTS,
  SETTLEMENT_POLL_INTERVAL_MS,
  canLeaveSettlement,
  normalizePaymentCallbackReference,
  settlementContextMatches,
  settlementPreflightError,
  shouldPollSettlement,
} from './GivingCompleteScreen';

describe('giving settlement polling', () => {
  it('renders settlement state only for the exact payment, church, and member owner', () => {
    const owner = { reference: `alt_${'a'.repeat(32)}`, churchId: 'church-1', memberId: 'member-1' };
    expect(settlementContextMatches(owner, { ...owner })).toBe(true);
    expect(settlementContextMatches(owner, { ...owner, reference: `alt_${'b'.repeat(32)}` })).toBe(false);
    expect(settlementContextMatches(owner, { ...owner, churchId: 'church-2' })).toBe(false);
    expect(settlementContextMatches(owner, { ...owner, memberId: 'member-2' })).toBe(false);
    expect(settlementContextMatches(owner, null)).toBe(false);
    expect(settlementContextMatches(null, owner)).toBe(false);
  });

  it('accepts one callback alias or two aliases only when they identify the same transaction', () => {
    const reference = `alt_${'a'.repeat(32)}`;
    expect(normalizePaymentCallbackReference(reference, undefined)).toBe(reference);
    expect(normalizePaymentCallbackReference(undefined, reference.toUpperCase())).toBe(reference);
    expect(normalizePaymentCallbackReference(reference, reference.toUpperCase())).toBe(reference);
    expect(normalizePaymentCallbackReference(reference, `alt_${'b'.repeat(32)}`)).toBeNull();
  });

  it('rejects a malformed callback alias even when the other alias is valid', () => {
    const reference = `alt_${'a'.repeat(32)}`;
    expect(normalizePaymentCallbackReference(reference, 'unsafe')).toBeNull();
    expect(normalizePaymentCallbackReference('unsafe', reference)).toBeNull();
  });

  it('defers payment settlement while offline without misclassifying provider status', () => {
    expect(settlementPreflightError('paystack-reference', true, true))
      .toContain('Reconnect to verify this payment safely');
    expect(settlementPreflightError('paystack-reference', true, false)).toBeNull();
  });

  it('prioritizes an invalid callback and incomplete member session over connectivity', () => {
    expect(settlementPreflightError(null, true, true)).toContain('without a valid transaction reference');
    expect(settlementPreflightError('paystack-reference', false, true)).toContain('member session is missing');
  });

  it('uses a bounded retry window suitable for a payment-return screen', () => {
    expect(SETTLEMENT_POLL_INTERVAL_MS).toBe(4_000);
    expect(SETTLEMENT_MAX_ATTEMPTS).toBe(4);
  });

  it('keeps payment status terminal until the member explicitly opens giving history', () => {
    expect(canLeaveSettlement(false)).toBe(false);
    expect(canLeaveSettlement(true)).toBe(true);
  });

  it.each([1, 2, 3])('continues polling a pending gift after attempt %s', (attempt) => {
    expect(shouldPollSettlement('pending', attempt)).toBe(true);
  });

  it.each([
    ['pending', 0],
    ['pending', 4],
    ['pending', 5],
    ['success', 1],
    ['failed', 1],
    ['reversed', 1],
    [undefined, 1],
  ] as const)('does not poll status %s after attempt %s', (status, attempt) => {
    expect(shouldPollSettlement(status, attempt)).toBe(false);
  });
});
