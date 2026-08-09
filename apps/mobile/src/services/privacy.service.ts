import api from './api';
import { unwrapApiData } from './api-envelope';

/**
 * Data subject rights.
 *
 * Apple Guideline 5.1.1(v) requires an app that creates accounts to offer
 * account deletion FROM INSIDE THE APP. Pointing at a website, or at a support
 * address, is a rejection — the path has to be here, in the app, and it has to
 * actually delete rather than deactivate.
 *
 * Google Play requires the same in-app path plus a publicly reachable URL, and
 * Ghana's Data Protection Act 2012 gives the same two rights independently:
 * s.32 to know what is held, s.33 to have it erased.
 */

export type Disposition = 'erased' | 'anonymised' | 'retained';

export interface Holding {
  label: string;
  disposition: Disposition;
  because: string;
}

export interface DeletionPreview {
  summary: string;
  whatWeHold: Holding[];
  confirmationText: string;
  irreversible: boolean;
}

export interface DeletionReceipt {
  reference: string;
  status: 'pending' | 'purged' | 'cancelled';
  purgeAfter: string;
  retained?: { label: string; because: string }[];
}

/** The word the person must type. The server rejects anything else. */
export const CONFIRMATION_WORD = 'DELETE';

function isHolding(value: unknown): value is Holding {
  if (typeof value !== 'object' || value === null) return false;
  const h = value as Partial<Holding>;
  return (
    typeof h.label === 'string' &&
    h.label.length > 0 &&
    typeof h.because === 'string' &&
    (h.disposition === 'erased' ||
      h.disposition === 'anonymised' ||
      h.disposition === 'retained')
  );
}

const privacyService = {
  /**
   * What deletion will and will not remove.
   *
   * Fetched rather than hard-coded in the app, because the authority is the
   * server's list — the same one the deletion actually walks. A screen that
   * described the policy from a local constant would keep saying whatever it
   * said on the day it shipped, while the behaviour moved underneath it.
   */
  async deletionPreview(): Promise<DeletionPreview> {
    const { data } = await api.get<unknown>('/privacy/deletion-preview');
    const payload = unwrapApiData(data, 'Could not load the deletion details.');
    if (typeof payload !== 'object' || payload === null) {
      throw new Error('Could not load the deletion details.');
    }
    const p = payload as Partial<DeletionPreview>;
    const whatWeHold = Array.isArray(p.whatWeHold) ? p.whatWeHold.filter(isHolding) : [];
    if (typeof p.summary !== 'string' || whatWeHold.length === 0) {
      // Refusing to render an empty list matters: a confirmation screen that
      // shows nothing implies nothing is kept, which is the one thing this
      // screen exists to be honest about.
      throw new Error('Could not load the deletion details.');
    }
    return {
      summary: p.summary,
      whatWeHold,
      confirmationText: p.confirmationText ?? CONFIRMATION_WORD,
      irreversible: p.irreversible !== false,
    };
  },

  /**
   * Everything held about the signed-in person (Act 843 s.32).
   *
   * Returned as text so the app can hand it to the share sheet — the point of
   * the right is that the person KEEPS the data, not that they look at it once
   * inside a screen they cannot export from.
   */
  async exportMyData(): Promise<string> {
    const { data } = await api.get<unknown>('/privacy/me/export');
    return JSON.stringify(unwrapApiData(data, 'Could not prepare your data.'), null, 2);
  },

  /**
   * Delete the account. The server locks it immediately and destroys the data
   * after a grace period, returning a reference that can restore it.
   */
  async deleteMyAccount(confirm: string): Promise<DeletionReceipt> {
    const { data } = await api.post<unknown>('/privacy/me/delete', { confirm });
    const payload = unwrapApiData(data, 'Could not delete your account.') as {
      receipt?: DeletionReceipt;
    };
    if (!payload?.receipt?.reference) {
      throw new Error('Could not delete your account.');
    }
    return payload.receipt;
  },
};

export default privacyService;
