import api from './api';
import { unwrapApiData } from './api-envelope';

/**
 * One-tap giving.
 *
 * A gift during a service is a decision measured in seconds. The ordinary flow
 * — amount, channel, provider redirect, PIN, return — is fine for a considered
 * gift at home and far too long for a moment of response mid-sermon. This is
 * one tap against an instrument the member already agreed to keep.
 *
 * It is a DONATION, so Apple's in-app purchase rules do not apply (Guideline
 * 3.1.1 covers digital goods and subscriptions; donations to a non-profit are
 * explicitly exempt). The church's subscription is a different matter and is
 * deliberately absent from this app.
 */

export interface SavedPaymentMethod {
  id: string;
  /** No card number: we never receive one and do not store what we cannot see. */
  last4?: string;
  brand?: string;
  bank?: string;
  channel?: string;
  expiryMonth?: string;
  expiryYear?: string;
  consentedAt: string;
  lastUsedAt?: string;
}

export interface QuickGiveOptions {
  paymentMethod: SavedPaymentMethod | null;
  /** Preset amounts in minor units, from the server so a client cannot invent one. */
  presetAmounts: number[];
  /** Above this, a gift must be confirmed the ordinary way. */
  tapLimit: number;
}

export interface TapRequest {
  amountMinor: number;
  currency: 'GHS';
  sessionId?: string;
  campaignId?: string;
  /**
   * Generated per TAP and repeated on retry.
   *
   * This is what makes a flaky connection safe: the phone retries the same tap,
   * the server recognises it, and the member is charged once. Without it, "it
   * did not seem to work so I pressed again" becomes two gifts — and a member
   * who is charged twice during a service does not use the feature again.
   */
  tapId: string;
}

/** How a tap failed, so the app can say something useful rather than "error". */
export type TapFailure =
  | 'no-method'
  | 'above-limit'
  | 'duplicate'
  | 'not-reusable'
  | 'declined'
  | 'unavailable'
  | 'unknown';

export class TapError extends Error {
  readonly reason: TapFailure;

  constructor(reason: TapFailure, message: string) {
    super(message);
    this.name = 'TapError';
    this.reason = reason;
  }
}

/**
 * Map the server's status to something the app can act on.
 *
 * Each of these is a different instruction to the person holding the phone, and
 * collapsing them into "that did not work" turns a recoverable moment during a
 * service into a member giving up.
 */
export function tapFailureFor(status: number | undefined): TapFailure {
  switch (status) {
    case 428:
      return 'no-method';
    case 422:
      return 'above-limit';
    case 429:
      return 'duplicate';
    case 412:
      return 'not-reusable';
    case 402:
      return 'declined';
    case 503:
      return 'unavailable';
    default:
      return 'unknown';
  }
}

/** What to tell the member. */
export function tapMessageFor(reason: TapFailure): string {
  switch (reason) {
    case 'no-method':
      return 'Give once the usual way first, and choose to save your details for next time.';
    case 'above-limit':
      return 'That amount is above the one-tap limit. Please confirm it the usual way.';
    case 'duplicate':
      // NOT an error the giver caused: they pressed twice, and the second
      // press was absorbed. Saying so is what stops a third press.
      return 'We already have that gift — it was only counted once.';
    case 'not-reusable':
      return 'Your saved details cannot be used for one-tap giving. Please give the usual way.';
    case 'declined':
      return 'Your bank did not approve that payment. Nothing has been charged.';
    case 'unavailable':
      return 'One-tap giving is not available right now. Please give the usual way.';
    default:
      return 'We could not complete that gift. Nothing has been charged.';
  }
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const response = (error as { response?: { status?: unknown } }).response;
  return typeof response?.status === 'number' ? response.status : undefined;
}

const quickGiveService = {
  /** The saved instrument and what may be given with it. */
  async options(): Promise<QuickGiveOptions> {
    const { data } = await api.get<unknown>('/finance/me/payment-method');
    const payload = unwrapApiData(data, 'Could not load your giving options.') as {
      paymentMethod?: SavedPaymentMethod | null;
      presetAmounts?: unknown;
      tapLimit?: unknown;
    };
    return {
      paymentMethod: payload?.paymentMethod ?? null,
      presetAmounts: Array.isArray(payload?.presetAmounts)
        ? payload.presetAmounts.filter((a): a is number => typeof a === 'number')
        : [],
      tapLimit: typeof payload?.tapLimit === 'number' ? payload.tapLimit : 0,
    };
  },

  /** Give, in one tap. */
  async tap(request: TapRequest): Promise<void> {
    try {
      await api.post('/finance/me/tap', request);
    } catch (error) {
      const reason = tapFailureFor(statusOf(error));
      throw new TapError(reason, tapMessageFor(reason));
    }
  },

  /**
   * Forget the saved instrument.
   *
   * A real delete on the server, not a flag. A member who asks us to forget
   * their card and is told we have is owed that being true — Act 843 s.33 is
   * the law, and the flag-instead-of-delete pattern is how a product ends up
   * holding credentials it told someone it had erased.
   */
  async forget(): Promise<void> {
    await api.delete('/finance/me/payment-method');
  },
};

export default quickGiveService;
