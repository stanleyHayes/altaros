import api from './api';
import { unwrapApiData } from './api-envelope';

export type GivingType = 'tithe' | 'offering' | 'donation' | 'campaign' | 'pledge_payment';
export type PaymentChannel = 'mobile_money' | 'card' | 'bank_transfer' | 'ussd';
export type GivingChannel = PaymentChannel | 'cash';
export type PaymentStatus = 'pending' | 'success' | 'failed' | 'reversed';

export interface GivingRecord {
  id: string;
  churchId: string;
  memberId?: string;
  type: GivingType;
  channel: GivingChannel;
  grossMinor: number;
  levyMinor: number;
  netMinor: number;
  currency: string;
  status: PaymentStatus;
  providerRef?: string;
  idempotencyKey: string;
  note?: string;
  occurredAt: string;
  createdAt: string;
}

export interface GiveRequest {
  amount: string;
  currency: 'GHS';
  type: GivingType;
  channel: PaymentChannel;
  email?: string;
  note?: string;
  anonymous?: boolean;
  callbackUrl?: string;
  acceptedTotalMinor?: number;
}

interface MoneyAmount { minor: number; currency: string }
export interface LevyQuote {
  levy: MoneyAmount;
  total: MoneyAmount;
  exempt: boolean;
  reason: string;
}

export interface GiveResult {
  transaction: GivingRecord;
  authorizationUrl?: string;
  accessCode?: string;
  levy: LevyQuote;
}

const MAX_QUOTE_REASON_LENGTH = 500;
const MAX_ACCESS_CODE_LENGTH = 512;

/**
 * Converts a user-entered major-unit amount into the exact decimal format the
 * finance API accepts. This deliberately avoids Number/toFixed so an amount is
 * never rounded into a different gift.
 */
export function canonicalGiftAmount(value: string): string | null {
  const candidate = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(candidate)) return null;

  const [rawWhole, rawFraction = ''] = candidate.split('.');
  const whole = rawWhole.replace(/^0+(?=\d)/, '');
  if (!/[1-9]/.test(`${whole}${rawFraction}`)) return null;

  const fraction = rawFraction.padEnd(2, '0');
  // The Go service uses int64, but JSON numbers cross JavaScript first. Refuse
  // values whose pesewas cannot be represented exactly on the device.
  const minor = BigInt(whole) * 100n + BigInt(fraction);
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;

  return `${whole}.${fraction}`;
}

function canonicalAmountMinor(value: string): number {
  const canonical = canonicalGiftAmount(value);
  if (!canonical) throw new Error('The gift amount is not valid.');
  const [whole, fraction] = canonical.split('.');
  return Number(BigInt(whole) * 100n + BigInt(fraction));
}

function isMoneyAmount(value: unknown): value is MoneyAmount {
  if (typeof value !== 'object' || value === null) return false;
  const amount = value as Partial<MoneyAmount>;
  return Number.isSafeInteger(amount.minor)
    && Number(amount.minor) >= 0
    && amount.currency === 'GHS';
}

/** Validate every value the member is asked to accept as a debit. */
export function validateLevyQuote(value: unknown, giftAmount: string): LevyQuote {
  if (typeof value !== 'object' || value === null) {
    throw new Error('The server returned an invalid payment quote.');
  }
  const quote = value as Partial<LevyQuote>;
  const giftMinor = canonicalAmountMinor(giftAmount);
  const valid = isMoneyAmount(quote.levy)
    && isMoneyAmount(quote.total)
    && typeof quote.exempt === 'boolean'
    && typeof quote.reason === 'string'
    && quote.reason.trim().length > 0
    && quote.reason.length <= MAX_QUOTE_REASON_LENGTH
    && !/[\u0000-\u001F\u007F]/.test(quote.reason)
    && BigInt(quote.total.minor) === BigInt(giftMinor) + BigInt(quote.levy.minor);
  if (!valid) throw new Error('The server returned an invalid payment quote.');
  return quote as LevyQuote;
}

const GIVING_TYPES = new Set<GivingType>([
  'tithe', 'offering', 'donation', 'campaign', 'pledge_payment',
]);
const GIVING_CHANNELS = new Set<GivingChannel>([
  'mobile_money', 'card', 'bank_transfer', 'ussd', 'cash',
]);
const PAYMENT_STATUSES = new Set<PaymentStatus>([
  'pending', 'success', 'failed', 'reversed',
]);
const PAYMENT_CHANNELS = new Set<PaymentChannel>([
  'mobile_money', 'card', 'bank_transfer', 'ussd',
]);
const GIFT_NOTE_MAX_LENGTH = 240;
const PAYMENT_CALLBACK_URL = 'altaros://giving/complete';
const GIVING_HISTORY_MAX_RECORDS = 500;
const MAX_ID_LENGTH = 128;
const MAX_DATE_LENGTH = 64;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validDateString(value: unknown): value is string {
  return nonEmptyString(value)
    && value.length <= MAX_DATE_LENGTH
    && Number.isFinite(Date.parse(value));
}

function safeNonNegativeMinor(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= MAX_ID_LENGTH
    && SAFE_ID.test(value);
}

function boundedOptionalText(value: unknown, maxLength: number): boolean {
  return value === undefined || (typeof value === 'string'
    && value.length <= maxLength
    && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value));
}

function validCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validHistoryDate(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_DATE_LENGTH) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return validCalendarDate(value);
  const rfc3339 = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  return rfc3339 !== null
    && validCalendarDate(rfc3339[1])
    && Number.isFinite(Date.parse(value));
}

export function normalizeGivingHistoryParams(
  value?: { from?: string; to?: string },
): { from?: string; to?: string } | undefined {
  if (value === undefined) return undefined;
  const from = value.from === undefined || value.from === '' ? undefined : value.from;
  const to = value.to === undefined || value.to === '' ? undefined : value.to;
  if ((from !== undefined && !validHistoryDate(from))
    || (to !== undefined && !validHistoryDate(to))
    || (from !== undefined && to !== undefined && Date.parse(from) > Date.parse(to))) {
    throw new Error('The giving history date range is not valid.');
  }
  return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

function normalizeOptionalEmail(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('The gift details are not valid.');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('The gift details are not valid.');
  }
  return email;
}

function normalizeOptionalNote(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('The gift details are not valid.');
  const note = value.trim();
  if (!note) return undefined;
  if (note.length > GIFT_NOTE_MAX_LENGTH || /[\u0000-\u001F\u007F]/.test(note)) {
    throw new Error('The gift details are not valid.');
  }
  return note;
}

function normalizeQuoteRequest(
  value: Pick<GiveRequest, 'amount' | 'currency' | 'channel' | 'anonymous'>,
): Pick<GiveRequest, 'amount' | 'currency' | 'channel' | 'anonymous'> {
  if (typeof value !== 'object' || value === null) throw new Error('The gift details are not valid.');
  const amount = typeof value.amount === 'string' ? canonicalGiftAmount(value.amount) : null;
  if (!amount
    || value.currency !== 'GHS'
    || !PAYMENT_CHANNELS.has(value.channel)
    || (value.anonymous !== undefined && typeof value.anonymous !== 'boolean')) {
    throw new Error('The gift details are not valid.');
  }
  return { amount, currency: 'GHS', channel: value.channel, anonymous: value.anonymous ?? false };
}

/** Canonicalize member intent before it can create a transaction or charge. */
export function normalizeGiveRequest(value: GiveRequest): GiveRequest {
  const quote = normalizeQuoteRequest(value);
  if (!GIVING_TYPES.has(value.type)
    || !safeNonNegativeMinor(value.acceptedTotalMinor)
    || value.acceptedTotalMinor < canonicalAmountMinor(quote.amount)
    || (value.callbackUrl !== undefined && value.callbackUrl !== PAYMENT_CALLBACK_URL)) {
    throw new Error('The gift details are not valid.');
  }
  return {
    ...quote,
    type: value.type,
    email: normalizeOptionalEmail(value.email),
    note: normalizeOptionalNote(value.note),
    callbackUrl: value.callbackUrl,
    acceptedTotalMinor: value.acceptedTotalMinor,
  };
}

export function sumConfirmedGivingMinor(records: GivingRecord[]): number {
  let total = 0n;
  for (const record of records) {
    if (record.status !== 'success') continue;
    if (!safeNonNegativeMinor(record.grossMinor)) {
      throw new Error('The server returned invalid giving history.');
    }
    total += BigInt(record.grossMinor);
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('The giving history total is too large to display exactly.');
    }
  }
  return Number(total);
}

/** Refuse transaction data that could crash or misstate the member's ledger. */
export function normalizeGivingRecord(value: unknown): GivingRecord {
  if (typeof value !== 'object' || value === null) {
    throw new Error('The server returned an invalid giving record.');
  }
  const record = value as Partial<GivingRecord>;
  const valid = validId(record.id)
    && validId(record.churchId)
    && (record.memberId === undefined || validId(record.memberId))
    && GIVING_TYPES.has(record.type as GivingType)
    && GIVING_CHANNELS.has(record.channel as GivingChannel)
    && safeNonNegativeMinor(record.grossMinor)
    && record.grossMinor > 0
    && safeNonNegativeMinor(record.levyMinor)
    && safeNonNegativeMinor(record.netMinor)
    && record.netMinor <= record.grossMinor
    && record.currency === 'GHS'
    && PAYMENT_STATUSES.has(record.status as PaymentStatus)
    && validId(record.idempotencyKey)
    && (record.providerRef === undefined || validId(record.providerRef))
    && boundedOptionalText(record.note, GIFT_NOTE_MAX_LENGTH)
    && validDateString(record.occurredAt)
    && validDateString(record.createdAt);
  if (!valid) throw new Error('The server returned an invalid giving record.');
  return {
    id: record.id,
    churchId: record.churchId,
    ...(record.memberId === undefined ? {} : { memberId: record.memberId }),
    type: record.type,
    channel: record.channel,
    grossMinor: record.grossMinor,
    levyMinor: record.levyMinor,
    netMinor: record.netMinor,
    currency: record.currency,
    status: record.status,
    ...(record.providerRef === undefined ? {} : { providerRef: record.providerRef }),
    idempotencyKey: record.idempotencyKey,
    ...(record.note === undefined ? {} : { note: record.note }),
    occurredAt: record.occurredAt,
    createdAt: record.createdAt,
  } as GivingRecord;
}

/** Only accept references generated by the finance service. */
export function normalizePaymentReference(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const reference = value.trim();
  return /^alt_[a-z2-7]{32}$/i.test(reference) ? reference.toLowerCase() : null;
}

function normalizeOwnedTransaction(
  value: unknown,
  reference: string,
  churchId: string,
  memberId: string,
): GivingRecord {
  const normalizedReference = normalizePaymentReference(reference);
  if (!normalizedReference || !validId(churchId) || !validId(memberId)) {
    throw new Error('The payment reference is not valid.');
  }
  const record = normalizeGivingRecord(value);
  const validOwner = record.memberId === undefined || record.memberId === memberId;
  if (record.idempotencyKey.toLowerCase() !== normalizedReference
    || record.churchId !== churchId
    || !validOwner) {
    throw new Error('The server returned an invalid giving record.');
  }
  return record;
}

export function safeCheckoutUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2_048 || /[\u0000-\u001F\u007F]/.test(value)) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:'
      || url.hostname.toLowerCase() !== 'checkout.paystack.com'
      || url.port
      || url.username
      || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function validAccessCode(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_ACCESS_CODE_LENGTH
    && !/[\u0000-\u001F\u007F]/.test(value);
}

export function normalizeCheckoutResult(
  value: unknown,
  payload: GiveRequest,
  churchId: string,
  memberId: string,
): GiveResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The server returned an invalid checkout.');
  }
  const checkout = value as Partial<GiveResult>;
  const levy = validateLevyQuote(checkout.levy, payload.amount);
  const transaction = normalizeGivingRecord(checkout.transaction);
  const authorizationUrl = safeCheckoutUrl(checkout.authorizationUrl);
  const paymentReference = normalizePaymentReference(transaction.idempotencyKey);
  const validOwner = payload.anonymous
    ? transaction.memberId === undefined
    : transaction.memberId === memberId;
  const valid = transaction.churchId === churchId
    && validOwner
    && transaction.type === payload.type
    && transaction.channel === payload.channel
    && transaction.currency === payload.currency
    && transaction.grossMinor === canonicalAmountMinor(payload.amount)
    && transaction.levyMinor === levy.levy.minor
    && transaction.status === 'pending'
    && transaction.providerRef === undefined
    && transaction.note === payload.note
    && paymentReference !== null
    && payload.acceptedTotalMinor === levy.total.minor
    && authorizationUrl !== null
    && validAccessCode(checkout.accessCode);
  if (!valid) throw new Error('The server returned an invalid checkout.');
  return {
    transaction,
    levy,
    authorizationUrl,
    accessCode: checkout.accessCode,
  };
}

const givingService = {
  async quote(payload: Pick<GiveRequest, 'amount' | 'currency' | 'channel' | 'anonymous'>): Promise<LevyQuote> {
    const request = normalizeQuoteRequest(payload);
    const { data } = await api.post<unknown>('/finance/give/quote', request);
    return validateLevyQuote(unwrapApiData(data, 'The server returned an invalid payment quote.'), request.amount);
  },

  async give(payload: GiveRequest, churchId: string, memberId: string): Promise<GiveResult> {
    const request = normalizeGiveRequest(payload);
    if (!validId(churchId) || !validId(memberId)) {
      throw new Error('The member identity is incomplete.');
    }
    const { data } = await api.post<unknown>('/finance/give', request);
    const result = unwrapApiData(data, 'The server returned an invalid checkout.');
    return normalizeCheckoutResult(result, request, churchId, memberId);
  },

  async getHistory(
    churchId: string,
    memberId: string,
    params?: { from?: string; to?: string },
  ): Promise<GivingRecord[]> {
    if (!validId(churchId) || !validId(memberId)) {
      throw new Error('The member identity is incomplete.');
    }
    const requestParams = normalizeGivingHistoryParams(params);
    const { data } = await api.get<unknown>('/finance/me/giving', { params: requestParams });
    const history = unwrapApiData(data, 'The server returned invalid giving history.');
    if (!Array.isArray(history) || history.length > GIVING_HISTORY_MAX_RECORDS) {
      throw new Error('The server returned invalid giving history.');
    }
    const records = history.map(normalizeGivingRecord);
    const validOwnership = records.every((record) => record.churchId === churchId
      && (record.memberId === undefined || record.memberId === memberId));
    if (!validOwnership || new Set(records.map((record) => record.id)).size !== records.length) {
      throw new Error('The server returned invalid giving history.');
    }
    sumConfirmedGivingMinor(records);
    return records;
  },

  async getTransaction(reference: string, churchId: string, memberId: string): Promise<GivingRecord> {
    const normalizedReference = normalizePaymentReference(reference);
    if (!normalizedReference) throw new Error('The payment reference is not valid.');
    if (!validId(churchId) || !validId(memberId)) {
      throw new Error('The member identity is incomplete.');
    }
    const { data } = await api.get<unknown>(
      `/finance/transactions/${encodeURIComponent(normalizedReference)}`,
    );
    return normalizeOwnedTransaction(
      unwrapApiData(data, 'The server returned an invalid giving record.'),
      normalizedReference,
      churchId,
      memberId,
    );
  },

  async settle(reference: string, churchId: string, memberId: string): Promise<GivingRecord> {
    const normalizedReference = normalizePaymentReference(reference);
    if (!normalizedReference) throw new Error('The payment reference is not valid.');
    if (!validId(churchId) || !validId(memberId)) {
      throw new Error('The member identity is incomplete.');
    }
    const { data } = await api.post<unknown>(
      `/finance/transactions/${encodeURIComponent(normalizedReference)}/settle`,
    );
    return normalizeOwnedTransaction(
      unwrapApiData(data, 'The server returned an invalid giving record.'),
      normalizedReference,
      churchId,
      memberId,
    );
  },
};

export function formatMoney(minor: number, currency = 'GHS'): string {
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency }).format(minor / 100);
}

export default givingService;
