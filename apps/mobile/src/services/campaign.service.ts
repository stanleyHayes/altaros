import api from './api';
import { unwrapApiData } from './api-envelope';

/**
 * Fundraising appeals a church has published to its members.
 *
 * A different endpoint from the staff campaign list, and deliberately so. This
 * one returns only what the church chose to show the congregation, narrowed in
 * the database rather than filtered here — a client that fetched everything and
 * hid the drafts would be one refactor away from showing a church its own
 * unannounced appeal.
 */

export interface PublishedCampaign {
  id: string;
  title: string;
  description?: string;
  coverImageUrl?: string;
  targetAmount: number;
  currency: string;
  startDate: string;
  endDate: string;
  publishedAt?: string;
  /**
   * Absent when the church keeps its thermometer off.
   *
   * Absent, not zero. "GHS 48,000 of GHS 50,000" recruits the last few givers;
   * "GHS 0 of GHS 50,000" tells a congregation its church is failing, and a
   * client that defaulted the missing figure to zero would print exactly that
   * for every church that chose privacy.
   */
  currentAmount?: number;
  progress?: number;
}

function isCampaign(value: unknown): value is PublishedCampaign {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Partial<PublishedCampaign>;
  return (
    typeof c.id === 'string' &&
    c.id.length > 0 &&
    typeof c.title === 'string' &&
    c.title.length > 0 &&
    typeof c.targetAmount === 'number'
  );
}

/** Whether this campaign's progress may be shown. */
export function showsProgress(campaign: PublishedCampaign): boolean {
  return typeof campaign.currentAmount === 'number' && typeof campaign.progress === 'number';
}

const campaignService = {
  /** The appeals this church has published to its members. */
  async myCampaigns(): Promise<PublishedCampaign[]> {
    const { data } = await api.get<unknown>('/finance/me/campaigns');
    const payload = unwrapApiData(data, 'Could not load the appeals.') as {
      campaigns?: unknown;
    };
    if (!Array.isArray(payload?.campaigns)) return [];
    return payload.campaigns.filter(isCampaign);
  },
};

export default campaignService;
