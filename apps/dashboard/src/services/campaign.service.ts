import { get, post, put } from './api';

/**
 * Giving campaigns, on the contract the server actually serves.
 *
 * The older type in finance.service.ts asks for `name`, `goalAmount` and
 * `status`. The API has never served those — it serves `title`, `targetAmount`
 * and `isActive`, which are also the field names stored in MongoDB and declared
 * in @altar-os/shared-types. That mismatch is why this page showed nothing even
 * when the API was up and returning campaigns: every field came back undefined
 * and rendered as blank.
 *
 * Serving the stored contract rather than inventing a third one is the only
 * option that leaves a single truth.
 */

/** Who may see a campaign. */
export type Visibility = 'draft' | 'members' | 'public';

export interface Campaign {
  id: string;
  churchId: string;
  title: string;
  description?: string;
  /** Minor units, like every other amount in this product. */
  targetAmount: number;
  currency: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  /**
   * Not the same question as isActive.
   *
   * isActive says the appeal is running. Visibility says who has been shown it.
   * A church drafts a building-fund appeal weeks before announcing it, and the
   * empty string — draft — is the default so an appeal cannot be published by
   * an older client that knows nothing about the field.
   */
  visibility: Visibility | '';
  /** Opts this appeal into ALTAR OS's own marketing site. A separate consent. */
  listedInDirectory: boolean;
  /** Whether the raised figure is shown alongside the target. */
  showProgress: boolean;
  coverImageUrl?: string;
  publishedAt?: string;
  /** Summed from completed giving on every read, never stored. */
  currentAmount: number;
  progress: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCampaignPayload {
  title: string;
  description?: string;
  /** Minor units. */
  targetAmount: number;
  currency?: string;
  startDate: string;
  endDate: string;
  isActive?: boolean;
  coverImageUrl?: string;
}

export interface PublishPayload {
  visibility: Visibility;
  listedInDirectory: boolean;
  showProgress: boolean;
}

/** How a visibility reads to the person choosing it. */
export function visibilityLabel(visibility: Visibility | ''): string {
  switch (visibility) {
    case 'public':
      return 'Public';
    case 'members':
      return 'Members only';
    default:
      return 'Draft';
  }
}

/** What choosing it actually means, in one sentence. */
export function visibilityMeaning(visibility: Visibility | ''): string {
  switch (visibility) {
    case 'public':
      return 'Anyone who visits your church website can see this appeal.';
    case 'members':
      return 'Members see this in the app. It is not on your public website.';
    default:
      return 'Only your staff can see this. Nobody has been shown it.';
  }
}

export const campaignService = {
  async list(): Promise<Campaign[]> {
    // The endpoint returns { campaigns: [...] }, not a bare array. Asking for
    // an array got an object, Array.isArray said no, and the page showed "no
    // appeals yet" to a church that had one — a silent empty state is the
    // worst shape this bug can take, because nothing looks broken.
    const result = await get<{ campaigns?: Campaign[] }>('/finance/campaigns');
    return Array.isArray(result?.campaigns) ? result.campaigns : [];
  },

  async create(payload: CreateCampaignPayload): Promise<Campaign> {
    return post<Campaign>('/finance/campaigns', payload);
  },

  async byId(id: string): Promise<Campaign> {
    return get<Campaign>(`/finance/campaigns/${id}`);
  },

  async update(id: string, payload: Partial<CreateCampaignPayload>): Promise<Campaign> {
    return put<Campaign>(`/finance/campaigns/${id}`, payload);
  },

  /**
   * Set who may see an appeal.
   *
   * All three fields are sent every time, not merged server-side. The screen a
   * person confirmed IS the state that gets stored — carrying an old directory
   * opt-in through a re-publish would mean a church that unticked it still
   * appears on our marketing site.
   */
  async publish(id: string, payload: PublishPayload): Promise<Campaign> {
    return post<Campaign>(`/finance/campaigns/${id}/publish`, payload);
  },

  /** Withdraw an appeal from everywhere. */
  async unpublish(id: string): Promise<Campaign> {
    return post<Campaign>(`/finance/campaigns/${id}/publish`, {
      visibility: 'draft',
      // Always cleared with the withdrawal: a draft must never remain on the
      // marketing site.
      listedInDirectory: false,
      showProgress: false,
    });
  },

  async close(id: string): Promise<Campaign> {
    return post<Campaign>(`/finance/campaigns/${id}/close`, {});
  },
};

export default campaignService;
