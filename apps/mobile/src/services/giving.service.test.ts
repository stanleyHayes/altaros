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
  memberPaymentUpliftMinor,
  MOBILE_PAYMENT_CALLBACK_URL,
  pendingGivingRecoveryReference,
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
  grossMinor: 1000, levyMinor: 0, providerFeeMinor: 0, chargedMinor: 1000,
  feeBearer: 'church', netMinor: 970, currency: 'GHS', status: 'pending',
  idempotencyKey: 'gift-ref-1', occurredAt: '2026-08-01T10:00:00Z',
  createdAt: '2026-08-01T10:00:00Z',
} satisfies GivingRecord;
const validReference = 'alt_abcdefghijklmnopqrstuvwxyz234567';
const money = (minor: number) => ({ minor, currency: 'GHS' });
const fullPricing = (
  giftMinor: number,
  providerFeeMinor = 0,
  levyMinor = 0,
  bearer: 'giver' | 'church' = 'giver',
) => {
  const chargedMinor = giftMinor + (bearer === 'giver' ? providerFeeMinor : 0);
  return {
    gift: money(giftMinor),
    fee: {
      gift: money(giftMinor),
      providerFee: money(providerFeeMinor),
      charged: money(chargedMinor),
      bearer,
      explanation: providerFeeMinor > 0
        ? 'This estimate includes the disclosed payment-provider fee.'
        : 'No payment-provider fee applies.',
      estimated: true,
    },
    levy: {
      levy: money(levyMinor),
      total: money(chargedMinor + levyMinor),
      exempt: levyMinor === 0,
      reason: levyMinor === 0 ? 'Below the daily threshold' : 'Daily allowance exceeded',
    },
    total: money(chargedMinor + levyMinor),
  };
};
const flattenedPricing = (pricing: ReturnType<typeof fullPricing>) => ({
  fee: pricing.fee,
  levy: pricing.levy.levy,
  total: pricing.total,
  exempt: pricing.levy.exempt,
  reason: pricing.levy.reason,
});

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
    const quote = flattenedPricing(fullPricing(15000, 293, 50));
    mockedApi.post.mockResolvedValueOnce({ data: { success: true, data: quote } } as never);

    await expect(givingService.quote({
      amount: '150.00', currency: 'GHS', channel: 'mobile_money', anonymous: false,
    })).resolves.toEqual(quote);
    expect(mockedApi.post).toHaveBeenCalledWith('/finance/give/quote', {
      amount: '150.00', currency: 'GHS', channel: 'mobile_money', anonymous: false,
    });
  });

  it('includes a giver-borne provider fee in the exact consent total', () => {
    const quote = validateLevyQuote(flattenedPricing(fullPricing(10000, 195)), '100.00');
    expect(quote.fee.charged.minor).toBe(10195);
    expect(quote.total.minor).toBe(10195);
  });

  it('reports the member payment uplift instead of the provider settlement cost', () => {
    expect(memberPaymentUpliftMinor({ grossMinor: 10000, chargedMinor: 10195 })).toBe(195);
    expect(memberPaymentUpliftMinor({ grossMinor: 10000, chargedMinor: 10000 })).toBe(0);
  });

  it('rejects a quote whose total omits the giver-borne provider fee', () => {
    const quote = flattenedPricing(fullPricing(10000, 195));
    expect(() => validateLevyQuote({ ...quote, total: money(10000) }, '100.00'))
      .toThrow('The server returned an invalid payment quote.');
  });

  it('canonicalizes checkout intent before transport', () => {
    expect(normalizeGiveRequest({
      amount: '0010.5', currency: 'GHS', type: 'offering', channel: 'mobile_money',
      email: ' MEMBER@EXAMPLE.COM ', note: ' Sunday offering ', anonymous: false,
      callbackUrl: MOBILE_PAYMENT_CALLBACK_URL, acceptedTotalMinor: 1050,
    })).toEqual({
      amount: '10.50', currency: 'GHS', type: 'offering', channel: 'mobile_money',
      email: 'member@example.com', note: 'Sunday offering', anonymous: false,
      callbackUrl: MOBILE_PAYMENT_CALLBACK_URL, acceptedTotalMinor: 1050,
    });
  });

  it('requires an attributable live purpose for campaign and pledge payments', () => {
    const campaignId = '64f000000000000000000001';
    const pledgeId = '64f000000000000000000002';
    expect(normalizeGiveRequest({
      amount: '10.00', currency: 'GHS', type: 'campaign', channel: 'mobile_money',
      campaignId: campaignId.toUpperCase(), acceptedTotalMinor: 1000,
    })).toMatchObject({ campaignId, type: 'campaign' });
    expect(normalizeGiveRequest({
      amount: '10.00', currency: 'GHS', type: 'pledge_payment', channel: 'mobile_money',
      campaignId, pledgeId: pledgeId.toUpperCase(), acceptedTotalMinor: 1000,
    })).toMatchObject({ campaignId, pledgeId, type: 'pledge_payment' });
    expect(() => normalizeGiveRequest({
      amount: '10.00', currency: 'GHS', type: 'campaign', channel: 'mobile_money',
      acceptedTotalMinor: 1000,
    })).toThrow('gift details are not valid');
    expect(() => normalizeGiveRequest({
      amount: '10.00', currency: 'GHS', type: 'offering', channel: 'mobile_money',
      campaignId, acceptedTotalMinor: 1000,
    })).toThrow('gift details are not valid');
  });

  it.each([
    { type: 'expense' },
    { channel: 'cash' },
    { currency: 'USD' },
    { email: 'not-an-email' },
    { note: 'x'.repeat(241) },
    { note: 'offering\u0000memo' },
    { callbackUrl: 'altaros://giving/complete' },
    { callbackUrl: 'https://evil.example/complete' },
    { acceptedTotalMinor: 0 },
    { acceptedTotalMinor: 999 },
    { acceptedTotalMinor: 10.5 },
  ])('rejects malformed checkout intent before transport: %p', async (override) => {
    const callsBefore = mockedApi.post.mock.calls.length;
    await expect(givingService.give({
      amount: '10.00', currency: 'GHS', type: 'offering', channel: 'mobile_money',
      email: 'member@example.com', note: 'Offering', anonymous: false,
      callbackUrl: MOBILE_PAYMENT_CALLBACK_URL, acceptedTotalMinor: 1000,
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
    const malformedPricing = fullPricing(1000, 0, 10);
    malformedPricing.total = money(1000);
    mockedApi.post.mockResolvedValueOnce({ data: {
      transaction: validRecord,
      authorizationUrl: 'https://checkout.paystack.com/session-1',
      quote: malformedPricing,
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
      quote: fullPricing(1000),
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
      quote: fullPricing(1000),
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
      quote: fullPricing(1000),
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

  it('resumes only a pending digital checkout with a canonical reference', () => {
    expect(pendingGivingRecoveryReference({
      status: 'pending', channel: 'mobile_money', idempotencyKey: validReference.toUpperCase(),
    })).toBe(validReference);
    expect(pendingGivingRecoveryReference({
      status: 'success', channel: 'mobile_money', idempotencyKey: validReference,
    })).toBeNull();
    expect(pendingGivingRecoveryReference({
      status: 'pending', channel: 'cash', idempotencyKey: validReference,
    })).toBeNull();
    expect(pendingGivingRecoveryReference({
      status: 'pending', channel: 'card', idempotencyKey: 'unsafe/reference',
    })).toBeNull();
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
    const history = [{
      ...validRecord, status: 'success' as const, grossMinor: 5000, chargedMinor: 5000,
    }];
    mockedApi.get.mockResolvedValueOnce({ data: { success: true, data: history } } as never);

    await expect(givingService.getHistory('church-1', 'member-1')).resolves.toEqual(history);

    expect(mockedApi.get).toHaveBeenCalledWith('/finance/me/giving', { params: undefined });
  });

  it('loads member-owned campaigns and active pledges for attributable giving', async () => {
    const campaignId = '64f000000000000000000001';
    const pledgeId = '64f000000000000000000002';
    mockedApi.get.mockResolvedValueOnce({ data: { success: true, data: {
      campaigns: [{
        id: campaignId, churchId: 'church-1', title: 'New sanctuary',
        targetAmount: 1000000, currentAmount: 250000, currency: 'GHS', progress: 25,
        startDate: '2026-07-01T00:00:00Z', endDate: '2026-12-31T23:59:59Z', isActive: true,
      }],
      pledges: [{
        pledge: {
          id: pledgeId, churchId: 'church-1', memberId: 'member-1', campaignId,
          totalMinor: 100000, currency: 'GHS', frequency: 'monthly', instalments: 10,
          startDate: '2026-07-01T00:00:00Z', note: 'Building promise',
        },
        paidMinor: 25000, dueMinor: 20000, arrearsMinor: 0, aheadMinor: 5000,
        remainingMinor: 75000, percent: 25, behind: false, complete: false, currency: 'GHS',
      }],
    } } } as never);

    await expect(givingService.getGivingOptions('church-1', 'member-1')).resolves.toEqual({
      campaigns: [{
        id: campaignId, title: 'New sanctuary', targetAmount: 1000000,
        currentAmount: 250000, currency: 'GHS', progress: 25,
        endDate: '2026-12-31T23:59:59Z',
      }],
      pledges: [{
        id: pledgeId, campaignId, totalMinor: 100000, paidMinor: 25000,
        remainingMinor: 75000, currency: 'GHS', percent: 25, note: 'Building promise',
      }],
    });
    expect(mockedApi.get).toHaveBeenCalledWith('/finance/me/giving-options');
  });

  it('rejects cross-member or malformed giving options', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { success: true, data: {
      campaigns: [],
      pledges: [{
        pledge: {
          id: '64f000000000000000000002', churchId: 'church-1', memberId: 'member-2',
          totalMinor: 1000, currency: 'GHS', note: 'Private promise',
        },
        paidMinor: 0, remainingMinor: 1000, percent: 0, currency: 'GHS',
      }],
    } } } as never);
    await expect(givingService.getGivingOptions('church-1', 'member-1'))
      .rejects.toThrow('invalid giving options');
  });

  it('reads a bounded giving-history page with its authoritative total', async () => {
    const history = [{ ...validRecord, status: 'success' as const }];
    mockedApi.get.mockResolvedValueOnce({
      data: { success: true, data: { data: history, total: 51 } },
    } as never);

    await expect(givingService.getHistoryPage('church-1', 'member-1', 2, 50))
      .resolves.toEqual({ records: history, total: 51 });
    expect(mockedApi.get).toHaveBeenCalledWith('/finance/me/giving', {
      params: { page: 2, limit: 50 },
    });
  });

  it.each([
    { data: [validRecord], total: -1 },
    { data: [validRecord], total: 0 },
    { data: 'not-a-list', total: 1 },
    { data: [validRecord], total: 1.5 },
  ])('rejects an invalid paged giving history response: %p', async (payload) => {
    mockedApi.get.mockResolvedValueOnce({ data: { success: true, data: payload } } as never);
    await expect(givingService.getHistoryPage('church-1', 'member-1', 1))
      .rejects.toThrow('invalid giving history');
  });

  it.each([[0, 50], [1.5, 50], [1, 0], [1, 101]])(
    'rejects an unsafe giving history page before transport: %s/%s',
    async (page, limit) => {
      const callsBefore = mockedApi.get.mock.calls.length;
      await expect(givingService.getHistoryPage('church-1', 'member-1', page, limit))
        .rejects.toThrow('page is not valid');
      expect(mockedApi.get).toHaveBeenCalledTimes(callsBefore);
    },
  );

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
