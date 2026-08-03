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
  providerFeeMinor: number;
  chargedMinor: number;
  feeBearer: 'giver' | 'church';
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
  campaignId?: string;
  pledgeId?: string;
  callbackUrl?: string;
  acceptedTotalMinor?: number;
}

export interface GivingCampaignOption {
  id: string;
  title: string;
  description?: string;
  targetAmount: number;
  currentAmount: number;
  currency: 'GHS';
  progress: number;
  endDate: string;
}

export interface GivingPledgeOption {
  id: string;
  campaignId?: string;
  totalMinor: number;
  paidMinor: number;
  remainingMinor: number;
  currency: 'GHS';
  percent: number;
  note?: string;
}

export interface GivingOptions {
  campaigns: GivingCampaignOption[];
  pledges: GivingPledgeOption[];
}

interface MoneyAmount { minor: number; currency: string }
export interface ProviderFeeQuote {
  gift: MoneyAmount;
  providerFee: MoneyAmount;
  charged: MoneyAmount;
  bearer: 'giver' | 'church';
  explanation: string;
  estimated: boolean;
}
export interface LevyQuote {
  levy: MoneyAmount;
  total: MoneyAmount;
  exempt: boolean;
  reason: string;
  fee: ProviderFeeQuote;
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
  const fee = quote.fee as Partial<ProviderFeeQuote> | undefined;
  const giftMinor = canonicalAmountMinor(giftAmount);
  const validFee = fee !== undefined
    && isMoneyAmount(fee.gift)
    && fee.gift.minor === giftMinor
    && isMoneyAmount(fee.providerFee)
    && isMoneyAmount(fee.charged)
    && (fee.bearer === 'giver' || fee.bearer === 'church')
    && typeof fee.estimated === 'boolean'
    && typeof fee.explanation === 'string'
    && fee.explanation.trim().length > 0
    && fee.explanation.length <= MAX_QUOTE_REASON_LENGTH
    && !/[\u0000-\u001F\u007F]/.test(fee.explanation)
    && BigInt(fee.charged.minor) === BigInt(giftMinor)
      + (fee.bearer === 'giver' ? BigInt(fee.providerFee.minor) : 0n);
  const valid = isMoneyAmount(quote.levy)
    && isMoneyAmount(quote.total)
    && typeof quote.exempt === 'boolean'
    && typeof quote.reason === 'string'
    && quote.reason.trim().length > 0
    && quote.reason.length <= MAX_QUOTE_REASON_LENGTH
    && !/[\u0000-\u001F\u007F]/.test(quote.reason)
    && validFee
    && BigInt(quote.total.minor) === BigInt((fee as ProviderFeeQuote).charged.minor) + BigInt(quote.levy.minor);
  if (!valid) throw new Error('The server returned an invalid payment quote.');
  return {
    levy: quote.levy as MoneyAmount,
    total: quote.total as MoneyAmount,
    exempt: quote.exempt as boolean,
    reason: quote.reason as string,
    fee: fee as ProviderFeeQuote,
  };
}

function checkoutPricing(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const quote = value as {
    fee?: unknown;
    levy?: { levy?: unknown; exempt?: unknown; reason?: unknown };
    total?: unknown;
  };
  return {
    fee: quote.fee,
    levy: quote.levy?.levy,
    total: quote.total,
    exempt: quote.levy?.exempt,
    reason: quote.levy?.reason,
  };
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
export const MOBILE_PAYMENT_CALLBACK_URL = 'https://altaros.com/giving/complete';
const GIVING_HISTORY_MAX_RECORDS = 500;
export const GIVING_HISTORY_PAGE_SIZE = 50;
const MAX_ID_LENGTH = 128;
const MAX_DATE_LENGTH = 64;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const MONGO_ID = /^[a-f0-9]{24}$/i;

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

export interface GivingHistoryPage {
  records: GivingRecord[];
  total: number;
}

function normalizeGivingHistoryPageParams(page: number, limit: number): { page: number; limit: number } {
  if (!Number.isSafeInteger(page) || page < 1
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('The giving history page is not valid.');
  }
  return { page, limit };
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
  const campaignId = value.campaignId === undefined ? undefined : value.campaignId.trim();
  const pledgeId = value.pledgeId === undefined ? undefined : value.pledgeId.trim();
  const validPurpose = value.type === 'campaign'
    ? campaignId !== undefined && MONGO_ID.test(campaignId) && pledgeId === undefined
    : value.type === 'pledge_payment'
      ? pledgeId !== undefined && MONGO_ID.test(pledgeId)
        && (campaignId === undefined || MONGO_ID.test(campaignId))
      : campaignId === undefined && pledgeId === undefined;
  if (!GIVING_TYPES.has(value.type)
    || !validPurpose
    || !safeNonNegativeMinor(value.acceptedTotalMinor)
    || value.acceptedTotalMinor < canonicalAmountMinor(quote.amount)
    || (value.callbackUrl !== undefined && value.callbackUrl !== MOBILE_PAYMENT_CALLBACK_URL)) {
    throw new Error('The gift details are not valid.');
  }
  return {
    ...quote,
    type: value.type,
    email: normalizeOptionalEmail(value.email),
    note: normalizeOptionalNote(value.note),
    callbackUrl: value.callbackUrl,
    acceptedTotalMinor: value.acceptedTotalMinor,
    ...(campaignId ? { campaignId: campaignId.toLowerCase() } : {}),
    ...(pledgeId ? { pledgeId: pledgeId.toLowerCase() } : {}),
  };
}

function normalizeGivingOptions(value: unknown, churchId: string, memberId: string): GivingOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The server returned invalid giving options.');
  }
  const candidate = value as { campaigns?: unknown; pledges?: unknown };
  if (!Array.isArray(candidate.campaigns) || candidate.campaigns.length > 200
    || !Array.isArray(candidate.pledges) || candidate.pledges.length > 500) {
    throw new Error('The server returned invalid giving options.');
  }
  const campaigns = candidate.campaigns.map((raw): GivingCampaignOption => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error('The server returned invalid giving options.');
    }
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== 'string' || !MONGO_ID.test(item.id)
      || item.churchId !== churchId || !nonEmptyString(item.title) || item.title.length > 160
      || !safeNonNegativeMinor(item.targetAmount) || Number(item.targetAmount) <= 0
      || !safeNonNegativeMinor(item.currentAmount) || item.currency !== 'GHS'
      || !Number.isInteger(item.progress) || Number(item.progress) < 0 || Number(item.progress) > 100
      || !validDateString(item.endDate)
      || !boundedOptionalText(item.description, 1_000)) {
      throw new Error('The server returned invalid giving options.');
    }
    return {
      id: item.id.toLowerCase(), title: item.title.trim(),
      ...(nonEmptyString(item.description) ? { description: item.description.trim() } : {}),
      targetAmount: Number(item.targetAmount), currentAmount: Number(item.currentAmount),
      currency: 'GHS', progress: Number(item.progress), endDate: item.endDate,
    };
  });
  const pledges = candidate.pledges.map((raw): GivingPledgeOption => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error('The server returned invalid giving options.');
    }
    const item = raw as { pledge?: unknown; paidMinor?: unknown; remainingMinor?: unknown; percent?: unknown; currency?: unknown };
    if (typeof item.pledge !== 'object' || item.pledge === null || Array.isArray(item.pledge)) {
      throw new Error('The server returned invalid giving options.');
    }
    const pledge = item.pledge as Record<string, unknown>;
    const campaignId = pledge.campaignId === undefined || pledge.campaignId === ''
      ? undefined : pledge.campaignId;
    if (typeof pledge.id !== 'string' || !MONGO_ID.test(pledge.id)
      || pledge.churchId !== churchId || pledge.memberId !== memberId
      || (campaignId !== undefined && (typeof campaignId !== 'string' || !MONGO_ID.test(campaignId)))
      || !safeNonNegativeMinor(pledge.totalMinor) || Number(pledge.totalMinor) <= 0
      || !safeNonNegativeMinor(item.paidMinor) || !safeNonNegativeMinor(item.remainingMinor)
      || Number(item.remainingMinor) > Number(pledge.totalMinor) || item.currency !== 'GHS'
      || !Number.isInteger(item.percent) || Number(item.percent) < 0 || Number(item.percent) > 100
      || !boundedOptionalText(pledge.note, GIFT_NOTE_MAX_LENGTH)) {
      throw new Error('The server returned invalid giving options.');
    }
    return {
      id: pledge.id.toLowerCase(),
      ...(typeof campaignId === 'string' ? { campaignId: campaignId.toLowerCase() } : {}),
      totalMinor: Number(pledge.totalMinor), paidMinor: Number(item.paidMinor),
      remainingMinor: Number(item.remainingMinor), currency: 'GHS', percent: Number(item.percent),
      ...(nonEmptyString(pledge.note) ? { note: pledge.note.trim() } : {}),
    };
  });
  if (new Set(campaigns.map(({ id }) => id)).size !== campaigns.length
    || new Set(pledges.map(({ id }) => id)).size !== pledges.length) {
    throw new Error('The server returned invalid giving options.');
  }
  return { campaigns, pledges };
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

/**
 * The extra amount the member accepted above their gift, excluding E-Levy.
 * This deliberately does not use providerFeeMinor: that field is the
 * provider's eventual settlement cost and may differ by a few pesewas from
 * the estimated uplift used when checkout was initialized.
 */
export function memberPaymentUpliftMinor(
  record: Pick<GivingRecord, 'grossMinor' | 'chargedMinor'>,
): number {
  if (!safeNonNegativeMinor(record.grossMinor)
    || !safeNonNegativeMinor(record.chargedMinor)
    || record.chargedMinor < record.grossMinor) {
    throw new Error('The server returned an invalid giving record.');
  }
  return record.chargedMinor - record.grossMinor;
}

/** Refuse transaction data that could crash or misstate the member's ledger. */
export function normalizeGivingRecord(value: unknown): GivingRecord {
  if (typeof value !== 'object' || value === null) {
    throw new Error('The server returned an invalid giving record.');
  }
  const record = value as Partial<GivingRecord>;
  const providerFeeMinor = record.providerFeeMinor ?? 0;
  const chargedMinor = record.chargedMinor || record.grossMinor;
  const feeBearer = record.feeBearer || (chargedMinor === record.grossMinor ? 'church' : 'giver');
  const valid = validId(record.id)
    && validId(record.churchId)
    && (record.memberId === undefined || validId(record.memberId))
    && GIVING_TYPES.has(record.type as GivingType)
    && GIVING_CHANNELS.has(record.channel as GivingChannel)
    && safeNonNegativeMinor(record.grossMinor)
    && record.grossMinor > 0
    && safeNonNegativeMinor(record.levyMinor)
    && safeNonNegativeMinor(providerFeeMinor)
    && safeNonNegativeMinor(chargedMinor)
    && chargedMinor >= record.grossMinor
    && (feeBearer === 'giver' || feeBearer === 'church')
    && (feeBearer !== 'church' || chargedMinor === record.grossMinor)
    && (feeBearer !== 'giver' || providerFeeMinor === 0 || chargedMinor > record.grossMinor)
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
    providerFeeMinor,
    chargedMinor,
    feeBearer,
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

/** Return the existing checkout reference only when history can safely resume it. */
export function pendingGivingRecoveryReference(
  record: Pick<GivingRecord, 'status' | 'channel' | 'idempotencyKey'>,
): string | null {
  if (record.status !== 'pending' || record.channel === 'cash') return null;
  return normalizePaymentReference(record.idempotencyKey);
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
  const checkout = value as Partial<GiveResult> & { quote?: unknown };
  const levy = validateLevyQuote(checkoutPricing(checkout.quote), payload.amount);
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
  async getGivingOptions(churchId: string, memberId: string): Promise<GivingOptions> {
    if (!validId(churchId) || !validId(memberId)) {
      throw new Error('The member identity is incomplete.');
    }
    const { data } = await api.get<unknown>('/finance/me/giving-options');
    return normalizeGivingOptions(
      unwrapApiData(data, 'The server returned invalid giving options.'),
      churchId,
      memberId,
    );
  },

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

  async getHistoryPage(
    churchId: string,
    memberId: string,
    page: number,
    limit = GIVING_HISTORY_PAGE_SIZE,
  ): Promise<GivingHistoryPage> {
    if (!validId(churchId) || !validId(memberId)) {
      throw new Error('The member identity is incomplete.');
    }
    const params = normalizeGivingHistoryPageParams(page, limit);
    const { data } = await api.get<unknown>('/finance/me/giving', { params });
    const payload = unwrapApiData(data, 'The server returned invalid giving history.');
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new Error('The server returned invalid giving history.');
    }
    const candidate = payload as { data?: unknown; total?: unknown };
    if (!Array.isArray(candidate.data) || candidate.data.length > limit
      || !Number.isSafeInteger(candidate.total) || Number(candidate.total) < candidate.data.length) {
      throw new Error('The server returned invalid giving history.');
    }
    const records = candidate.data.map(normalizeGivingRecord);
    const validOwnership = records.every((record) => record.churchId === churchId
      && (record.memberId === undefined || record.memberId === memberId));
    if (!validOwnership || new Set(records.map((record) => record.id)).size !== records.length) {
      throw new Error('The server returned invalid giving history.');
    }
    sumConfirmedGivingMinor(records);
    return { records, total: Number(candidate.total) };
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
