import { get, post } from "./api";

/** Campaign represents both messages and announcements — distinguished by channel. */
export interface Campaign {
  id: string;
  churchId: string;
  name: string;
  channel: "push" | "sms" | "email" | "announcement";
  subject?: string;
  body: string;
  filter: Record<string, unknown>;
  state: "draft" | "scheduled" | "sending" | "sent" | "cancelled" | "failed";
  scheduledFor?: string;
  approvedCostMinor?: number;
  approvedCurrency?: string;
  recipients: number;
  sent: number;
  suppressed: number;
  failed: number;
  actualCostMinor?: number;
  lastError?: string;
  createdBy?: string;
  sentAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** Payload for creating a campaign (message or announcement). */
export interface CreateCampaignPayload {
  name: string;
  channel: "push" | "sms" | "email" | "announcement";
  subject?: string;
  body: string;
  filter?: Record<string, unknown>;
  scheduledFor?: string;
}

/** Response envelope from campaigns list endpoint. */
interface CampaignsResponse {
  campaigns: Campaign[];
}

const CommunicationService = {
  /** List all campaigns. */
  async getCampaigns(): Promise<Campaign[]> {
    const response = await get<CampaignsResponse>("/communication/campaigns");
    return response.campaigns;
  },

  /** Get a single campaign by ID. */
  async getCampaign(id: string): Promise<Campaign> {
    return get<Campaign>(`/communication/campaigns/${id}`);
  },

  /** Create a new campaign (message or announcement). */
  async createCampaign(payload: CreateCampaignPayload): Promise<Campaign> {
    return post<Campaign>("/communication/campaigns", payload);
  },

  /** Send a campaign to its audience. */
  async sendCampaign(id: string): Promise<Campaign> {
    return post<Campaign>(`/communication/campaigns/${id}/send`);
  },

  /**
   * Cancel a campaign. There is no delete, and the UI must not offer one.
   *
   * DELETE /communication/campaigns/{id} does not exist. A campaign that has
   * gone out has reached real phones, so there is nothing to take back and no
   * honest way to erase the record of having sent it; one that has not gone
   * out is cancelled so it never does.
   */
  async cancelCampaign(id: string): Promise<Campaign> {
    return post<Campaign>(`/communication/campaigns/${id}/cancel`);
  },
};

export default CommunicationService;
