import api from './api';
import givingService, {
  canonicalGiftAmount,
  formatMoney,
  safeCheckoutUrl,
  normalizeCheckoutResult,
  normalizePaymentReference,
  validateLevyQuote,
  normalizeGivingRecord,
  normalizeGiveRequest,
  normalizeGivingHistoryParams,
  sumConfirmedGivingMinor,
  type GivingRecord,
} from './giving.service';

jest.mock('./api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

const mockedApi = api as jest.Mocked<typeof api>;

const validRecord = {
  id: 'gift-1', churchId: 'church-1', type: 'offering', channel: 'mobile_money',
  grossMinor: 1000, levyMinor: 0, netMinor: 970, currency: 'GHS', status: 'pending',
  idempotencyKey: 'gift-ref-1', occurredAt: '2026-08-01T10:00:00Z',
  createdAt: '2026-08-01T10:00:00Z',
} satisfies GivingRecord;
const validReference = 'alt_abcdefghijklmnopqrstuvwxyz234567';

describe('giving money formatting', () => {
  it.each([
    ['10', '10.00'],
    ['10.9', '10.90'],
    ['10.99', '10.99'],
    ['00010.5', '10.50'],
    ['0.01', '0.01'],
  ])('canonicalizes %s without floating-point rounding', (input, expected) => {
    expect(canonicalGiftAmount(input)).toBe(expected);
  });

  it.each(['10.999', '1e3', '1.2.3', '0', '0.00', '-10', '', '10.'])('rejects malformed or non-positive amount %s', (input) => {
    expect(canonicalGiftAmount(input)).toBeNull();
  });

  it('rejects a gift whose minor units exceed JavaScript exact-integer safety', () => {
    expect(canonicalGiftAmount('90071992547409.92')).toBeNull();
  });

  it('formats integer minor units without losing pesewas', () => {
    expect(formatMoney(162575)).toContain('1,625.75');
  });

  it('formats zero in Ghana cedis', () => {
    expect(formatMoney(0)).toContain('0.00');
  });

  it('sums confirmed giving exactly and excludes unresolved records', () => {
    expect(sumConfirmedGivingMinor([
      { ...validRecord, status: 'success', grossMinor: 125 },
      { ...validRecord, id: 'gift-2', status: 'pending', grossMinor: Number.MAX_SAFE_INTEGER },
      { ...validRecord, id: 'gift-3', status: 'success', grossMinor: 375 },
    ])).toBe(500);
  });

  it('rejects a confirmed history total that cannot be displayed exactly', () => {
    expect(() => sumConfirmedGivingMinor([
      { ...validRecord, status: 'success', grossMinor: Number.MAX_SAFE_INTEGER },
      { ...validRecord, id: 'gift-2', status: 'success', grossMinor: 1 },
    ])).toThrow('too large to display exactly');
  });

  it.each([
    'javascript:alert(1)',
    'altaros://profile',
    'http://checkout.paystack.com/unsafe',
    'https://user:secret@checkout.paystack.com/session',
    'https://evil.example/paystack/session',
    'https://checkout.paystack.com:444/session',
    '/relative-checkout',
    '',
  ])('rejects an unsafe checkout URL %s', (value) => {
    expect(safeCheckoutUrl(value)).toBeNull();
  });

  it('accepts an absolute HTTPS checkout URL', () => {
    expect(safeCheckoutUrl(' https://checkout.paystack.com/session-1 '))
      .toBe('https://checkout.paystack.com/session-1');
  });

  it('quotes without creating a transaction', async () => {
    const quote = {
      levy: { minor: 50, currency: 'GHS' },
      total: { minor: 15050, currency: 'GHS' },
      exempt: false,
      reason: 'Daily allowance exceeded',
    };
    mockedApi.post.mockResolvedValueOnce({ data: { success: true, data: quote } } as never);

    await expect(givingService.quote({
      amount: '150.00', currency: 'GHS', channel: 'mobile_money', anonymous: false,
    })).resolves.toEqual(quote);
    expect(mockedApi.post).toHaveBeenCalledWith('/finance/give/quote', {
      amount: '150.00', currency: 'GHS', channel: 'mobile_money', anonymous: false,
    });
  });

  it('canonicalizes checkout intent before transport', () => {
    expect(normalizeGiveRequest({
      amount: '0010.5', currency: 'GHS', type: 'offering', channel: 'mobile_money',
      email: ' MEMBER@EXAMPLE.COM ', note: ' Sunday offering ', anonymous: false,
      callbackUrl: 'altaros://giving/complete', acceptedTotalMinor: 1050,
    })).toEqual({
      amount: '10.50', currency: 'GHS', type: 'offering', channel: 'mobile_money',
      email: 'member@example.com', note: 'Sunday offering', anonymous: false,
      callbackUrl: 'altaros://giving/complete', acceptedTotalMinor: 1050,
    });
  });

  it.each([
    { type: 'expense' },
    { channel: 'cash' },
    { currency: 'USD' },
    { email: 'not-an-email' },
    { note: 'x'.repeat(241) },
    { note: 'offering\u0000memo' },
    { callbackUrl: 'https://evil.example/complete' },
    { acceptedTotalMinor: 0 },
    { acceptedTotalMinor: 999 },
    { acceptedTotalMinor: 10.5 },
  ])('rejects malformed checkout intent before transport: %p', async (override) => {
    const callsBefore = mockedApi.post.mock.calls.length;
    await expect(givingService.give({
      amount: '10.00', currency: 'GHS', type: 'offering', channel: 'mobile_money',
      email: 'member@example.com', note: 'Offering', anonymous: false,
      callbackUrl: 'altaros://giving/complete', acceptedTotalMinor: 1000,
      ...override,
    } as never, 'church-1', 'member-1')).rejects.toThrow('gift details are not valid');
    expect(mockedApi.post).toHaveBeenCalledTimes(callsBefore);
  });

  it('rejects malformed quote intent before transport', async () => {
    const callsBefore = mockedApi.post.mock.calls.length;
    await expect(givingService.quote({
      amount: '10.00', currency: 'GHS', channel: 'cash', anonymous: false,
    } as never)).rejects.toThrow('gift details are not valid');
    expect(mockedApi.post).toHaveBeenCalledTimes(callsBefore);
  });

  it.each([
    { levy: { minor: -1, currency: 'GHS' }, total: { minor: 999, currency: 'GHS' }, exempt: false, reason: 'bad' },
    { levy: { minor: 0.5, currency: 'GHS' }, total: { minor: 1000.5, currency: 'GHS' }, exempt: false, reason: 'bad' },
    { levy: { minor: 0, currency: 'USD' }, total: { minor: 1000, currency: 'USD' }, exempt: true, reason: 'bad' },
    { levy: { minor: 20, currency: 'GHS' }, total: { minor: 1000, currency: 'GHS' }, exempt: false, reason: 'inconsistent' },
    { levy: { minor: 0, currency: 'GHS' }, total: { minor: 1000, currency: 'GHS' }, exempt: true, reason: '' },
    { levy: { minor: 0, currency: 'GHS' }, total: { minor: 1000, currency: 'GHS' }, exempt: true, reason: 'x'.repeat(501) },
    { levy: { minor: 0, currency: 'GHS' }, total: { minor: 1000, currency: 'GHS' }, exempt: true, reason: 'bad\u0000reason' },
  ])('rejects a payment quote the member cannot safely consent to', (quote) => {
    expect(() => validateLevyQuote(quote, '10.00'))
      .toThrow('The server returned an invalid payment quote.');
  });

  it('rejects a malformed quote returned alongside checkout creation', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: {
      transaction: validRecord,
      authorizationUrl: 'https://checkout.paystack.com/session-1',
      levy: {
        levy: { minor: 10, currency: 'GHS' },
        total: { minor: 1000, currency: 'GHS' },
        exempt: false,
        reason: 'inconsistent total',
      },
    } } as never);

    await expect(givingService.give({
      amount: '10.00', currency: 'GHS', type: 'offering', channel: 'mobile_money',
      acceptedTotalMinor: 1010,
    }, 'church-1', 'member-1')).rejects.toThrow('The server returned an invalid payment quote.');
  });

  it('accepts only a pending checkout tied to the confirmed member gift', () => {
    const payload = {
      amount: '10.00', currency: 'GHS' as const, type: 'offering' as const,
      channel: 'mobile_money' as const, acceptedTotalMinor: 1000,
    };
    const checkout = {
      transaction: { ...validRecord, idempotencyKey: validReference, memberId: 'member-1' },
      authorizationUrl: 'https://checkout.paystack.com/session-1',
      accessCode: 'access-1',
      levy: {
        levy: { minor: 0, currency: 'GHS' },
        total: { minor: 1000, currency: 'GHS' },
        exempt: true,
        reason: 'Below the daily threshold',
      },
    };
    expect(normalizeCheckoutResult(checkout, payload, 'church-1', 'member-1'))
      .toMatchObject({ authorizationUrl: 'https://checkout.paystack.com/session-1' });
    expect(() => normalizeCheckoutResult({
      ...checkout, transaction: { ...checkout.transaction, churchId: 'another-church' },
    }, payload, 'church-1', 'member-1')).toThrow('invalid checkout');
    expect(() => normalizeCheckoutResult({
      ...checkout, transaction: { ...checkout.transaction, status: 'success' },
    }, payload, 'church-1', 'member-1')).toThrow('invalid checkout');
    expect(() => normalizeCheckoutResult({
      ...checkout, authorizationUrl: 'https://evil.example/session',
    }, payload, 'church-1', 'member-1')).toThrow('invalid checkout');
  });

  it.each([
    { transaction: { ...validRecord, idempotencyKey: validReference, memberId: 'member-1', levyMinor: 1 } },
    { transaction: { ...validRecord, idempotencyKey: 'gift-ref-1', memberId: 'member-1' } },
    { transaction: { ...validRecord, idempotencyKey: validReference, memberId: 'member-1', providerRef: 'psk_1' } },
    { transaction: { ...validRecord, idempotencyKey: validReference, memberId: 'member-1', note: 'changed' } },
    { accessCode: 'x'.repeat(513) },
    { accessCode: 'access\u0000code' },
  ])('rejects checkout response integrity mismatch: %p', (override) => {
    const payload = {
      amount: '10.00', currency: 'GHS' as const, type: 'offering' as const,
      channel: 'mobile_money' as const, acceptedTotalMinor: 1000,
    };
    const checkout = {
      transaction: { ...validRecord, idempotencyKey: validReference, memberId: 'member-1' },
      authorizationUrl: 'https://checkout.paystack.com/session-1', accessCode: 'access-1',
      levy: {
        levy: { minor: 0, currency: 'GHS' }, total: { minor: 1000, currency: 'GHS' },
        exempt: true, reason: 'Below threshold',
      },
    };
    expect(() => normalizeCheckoutResult({ ...checkout, ...override }, payload, 'church-1', 'member-1'))
      .toThrow('invalid checkout');
  });

  it('requires anonymous checkout records to omit the public member owner', () => {
    const payload = {
      amount: '10.00', currency: 'GHS' as const, type: 'offering' as const,
      channel: 'mobile_money' as const, acceptedTotalMinor: 1000, anonymous: true,
    };
    const checkout = {
      transaction: { ...validRecord, idempotencyKey: validReference, memberId: 'member-1' },
      authorizationUrl: 'https://checkout.paystack.com/session-1', accessCode: 'access-1',
      levy: {
        levy: { minor: 0, currency: 'GHS' }, total: { minor: 1000, currency: 'GHS' },
        exempt: true, reason: 'Below threshold',
      },
    };
    expect(() => normalizeCheckoutResult(checkout, payload, 'church-1', 'member-1'))
      .toThrow('invalid checkout');
    const anonymousCheckout = normalizeCheckoutResult({
      ...checkout, transaction: { ...checkout.transaction, memberId: undefined },
    }, payload, 'church-1', 'member-1');
    expect(anonymousCheckout.transaction).not.toHaveProperty('memberId');
  });

  it('accepts a valid cash record in member history without allowing cash checkout', () => {
    expect(normalizeGivingRecord({ ...validRecord, channel: 'cash', status: 'success' }))
      .toMatchObject({ channel: 'cash', status: 'success' });
  });

  it('keeps internal finance ownership and reconciliation fields out of member state', () => {
    expect(normalizeGivingRecord({
      ...validRecord,
      initiatedBy: 'private-member-owner',
      providerPayload: { customer: 'private-provider-data' },
      internalReconciliationNote: 'staff only',
    })).toEqual(validRecord);
  });

  it.each([
    { ...validRecord, status: 'complete' },
    { ...validRecord, grossMinor: Number.NaN },
    { ...validRecord, levyMinor: -1 },
    { ...validRecord, currency: 'USD' },
    { ...validRecord, occurredAt: 'not-a-date' },
    { ...validRecord, type: 'expense' },
  ])('rejects a transaction that could misstate the member ledger', (record) => {
    expect(() => normalizeGivingRecord(record))
      .toThrow('The server returned an invalid giving record.');
  });

  it('accepts only finance-service payment references', () => {
    expect(normalizePaymentReference(` ${validReference.toUpperCase()} `)).toBe(validReference);
    expect(normalizePaymentReference('altar/unsafe ref')).toBeNull();
    expect(normalizePaymentReference('alt_abcdefghijklmnopqrstuvwxyz234568')).toBeNull();
  });

  it('verifies the owned provider reference through the settlement route', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { success: true, data: { ...validRecord, idempotencyKey: validReference, memberId: 'member-1', status: 'success' } },
    } as never);
    await expect(givingService.settle(validReference, 'church-1', 'member-1')).resolves.toMatchObject({ status: 'success' });
    expect(mockedApi.post).toHaveBeenCalledWith(`/finance/transactions/${validReference}/settle`);
  });

  it('refuses a callback transaction with mismatched ownership or reference', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: {
      ...validRecord, idempotencyKey: validReference, memberId: 'another-member', status: 'success',
    } } as never);
    await expect(givingService.settle(validReference, 'church-1', 'member-1'))
      .rejects.toThrow('invalid giving record');

    mockedApi.get.mockResolvedValueOnce({ data: {
      ...validRecord, churchId: 'another-church', idempotencyKey: validReference,
    } } as never);
    await expect(givingService.getTransaction(validReference, 'church-1', 'member-1'))
      .rejects.toThrow('invalid giving record');
  });

  it('rejects malformed references before making a request', async () => {
    const callsBefore = mockedApi.post.mock.calls.length;
    await expect(givingService.settle('altar/unsafe ref', 'church-1', 'member-1'))
      .rejects.toThrow('payment reference is not valid');
    expect(mockedApi.post).toHaveBeenCalledTimes(callsBefore);
  });

  it.each([
    ['checkout church', () => givingService.give({
      amount: '10.00', currency: 'GHS', type: 'offering', channel: 'mobile_money',
      acceptedTotalMinor: 1000,
    }, 'church/unsafe', 'member-1')],
    ['checkout member', () => givingService.give({
      amount: '10.00', currency: 'GHS', type: 'offering', channel: 'mobile_money',
      acceptedTotalMinor: 1000,
    }, 'church-1', 'member unsafe')],
    ['lookup church', () => givingService.getTransaction(validReference, 'church/unsafe', 'member-1')],
    ['lookup member', () => givingService.getTransaction(validReference, 'church-1', 'member unsafe')],
    ['settlement church', () => givingService.settle(validReference, 'church/unsafe', 'member-1')],
    ['settlement member', () => givingService.settle(validReference, 'church-1', 'member unsafe')],
  ])('rejects an unsafe %s identity before finance transport', async (_label, action) => {
    const getCalls = mockedApi.get.mock.calls.length;
    const postCalls = mockedApi.post.mock.calls.length;
    await expect(action()).rejects.toThrow('member identity is incomplete');
    expect(mockedApi.get).toHaveBeenCalledTimes(getCalls);
    expect(mockedApi.post).toHaveBeenCalledTimes(postCalls);
  });

  it('reads the member transaction list from the self-history route', async () => {
    const history = [{ ...validRecord, status: 'success' as const, grossMinor: 5000 }];
    mockedApi.get.mockResolvedValueOnce({ data: { success: true, data: history } } as never);

    await expect(givingService.getHistory('church-1', 'member-1')).resolves.toEqual(history);

    expect(mockedApi.get).toHaveBeenCalledWith('/finance/me/giving', { params: undefined });
  });

  it('accepts only gateway-supported ordered history dates', () => {
    expect(normalizeGivingHistoryParams({
      from: '2026-01-01', to: '2026-08-01T23:59:59+00:00',
    })).toEqual({ from: '2026-01-01', to: '2026-08-01T23:59:59+00:00' });
    expect(normalizeGivingHistoryParams({ from: '', to: '' })).toEqual({});
    expect(normalizeGivingHistoryParams()).toBeUndefined();
  });

  it.each([
    { from: 'not-a-date' },
    { from: '2026-02-30' },
    { from: '2026-02-30T12:00:00Z' },
    { from: '2026-08-02', to: '2026-08-01' },
    { from: '08/01/2026' },
    { to: '2026-08-01T12:00:00' },
  ])('rejects a history range that the gateway would silently widen: %p', async (params) => {
    const callsBefore = mockedApi.get.mock.calls.length;
    await expect(givingService.getHistory('church-1', 'member-1', params))
      .rejects.toThrow('date range is not valid');
    expect(mockedApi.get).toHaveBeenCalledTimes(callsBefore);
  });

  it('rejects a non-array history envelope instead of rendering false emptiness', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { data: [validRecord] } } as never);
    await expect(givingService.getHistory('church-1', 'member-1')).rejects.toThrow('invalid giving history');
  });

  it('rejects duplicate, cross-church, or another member history rows', async () => {
    mockedApi.get
      .mockResolvedValueOnce({ data: [validRecord, validRecord] } as never)
      .mockResolvedValueOnce({ data: [{ ...validRecord, churchId: 'other-church' }] } as never)
      .mockResolvedValueOnce({ data: [{ ...validRecord, memberId: 'other-member' }] } as never);

    await expect(givingService.getHistory('church-1', 'member-1')).rejects.toThrow('invalid giving history');
    await expect(givingService.getHistory('church-1', 'member-1')).rejects.toThrow('invalid giving history');
    await expect(givingService.getHistory('church-1', 'member-1')).rejects.toThrow('invalid giving history');
  });

  it('rejects a history response beyond the gateway ceiling', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: Array.from({ length: 501 }, (_, index) => ({ ...validRecord, id: `gift-${index}` })),
    } as never);
    await expect(givingService.getHistory('church-1', 'member-1'))
      .rejects.toThrow('invalid giving history');
  });

  it.each([
    { id: 'gift/unsafe' },
    { churchId: 'church/unsafe' },
    { memberId: 'member/unsafe' },
    { idempotencyKey: 'ref/unsafe' },
    { providerRef: 'provider/unsafe' },
    { note: 'x'.repeat(241) },
    { note: 'offering\u0000memo' },
    { occurredAt: '2'.repeat(65) },
    { netMinor: 1001 },
  ])('rejects a bounded-ledger violation: %p', (override) => {
    expect(() => normalizeGivingRecord({ ...validRecord, ...override }))
      .toThrow('invalid giving record');
  });
});
