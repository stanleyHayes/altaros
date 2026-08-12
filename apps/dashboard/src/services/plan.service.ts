import { get, post } from './api';

/**
 * The church's subscription to ALTAR OS.
 *
 * This is the second money flow and it is not the one finance handles. Giving
 * is a member paying their church, where we take a percentage and never hold
 * the funds. A subscription is the church paying US, where we are the merchant
 * and the church is our customer. The two are never netted against each other:
 * settling our invoice out of a congregation's tithes would be both the custody
 * the Payment Systems Act is about and a church's giving quietly paying a
 * software bill.
 *
 * Sold on the WEB only. Apple's Guideline 3.1.1 requires a digital subscription
 * sold inside an iOS app to go through Apple's in-app purchase, and 3.1.3
 * forbids the app even pointing at this price — so the mobile app has no tier
 * screen at all, and the API refuses a tier change that arrives from it.
 * Donations are exempt from all of that, which is why giving stays in the app.
 */

export type Tier = 'free' | 'starter' | 'growth' | 'ministry';
export type SubscriptionStatus = 'active' | 'past_due' | 'suspended' | 'cancelled';

export interface TierDetails {
  tier: Tier;
  name: string;
  /** Minor units, monthly. */
  monthlyMinor: number;
  currency: string;
  streaming: boolean;
  maxConcurrentViewers: number;
  /** Our cut of giving. 150 = 1.5%. */
  commissionBasisPoints: number;
}

export interface Subscription {
  id: string;
  tier: Tier;
  status: SubscriptionStatus;
  commissionOverrideBasisPoints?: number;
  currentPeriodEnd?: string;
  pastDueSince?: string;
}

export interface PlanState {
  subscription: Subscription;
  /**
   * What the church may do RIGHT NOW.
   *
   * Returned separately from the tier because the two disagree on purpose when
   * a subscription is suspended: the tier still says Growth and the entitlement
   * says streaming is off. A screen computing features from the tier name would
   * show a Go Live button the server refuses.
   */
  entitlement: TierDetails;
  /** What the tier would grant if it were paid, so the gap can be explained. */
  tierGrants: TierDetails;
}

/** Commission as a percentage, for display. */
export function commissionPercent(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(basisPoints % 100 === 0 ? 1 : 2)}%`;
}

/** A monthly price as major units. */
export function monthlyPrice(tier: TierDetails): string {
  if (tier.monthlyMinor === 0) return 'Free';
  return `${tier.currency} ${(tier.monthlyMinor / 100).toLocaleString()}`;
}

/** Whether the entitlement has been cut back from what the tier says. */
export function isWithdrawn(state: PlanState): boolean {
  return (
    state.entitlement.streaming !== state.tierGrants.streaming ||
    state.entitlement.maxConcurrentViewers !== state.tierGrants.maxConcurrentViewers
  );
}

export const planService = {
  async current(): Promise<PlanState> {
    return get<PlanState>('/plan');
  },

  async tiers(): Promise<TierDetails[]> {
    const result = await get<{ tiers?: TierDetails[] }>('/plan/tiers');
    return Array.isArray(result?.tiers) ? result.tiers : [];
  },

  async setTier(tier: Tier): Promise<PlanState> {
    return post<PlanState>('/plan', { tier });
  },
};

export default planService;
