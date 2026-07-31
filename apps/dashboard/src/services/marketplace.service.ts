import { get, post } from "./api";
import type {
  ChurchListing,
  MarketplaceItem,
  CollaborationRequest,
  ChurchDiscoveryFilter,
} from "@altar-os/shared-types";

export interface CreateListingPayload {
  title: string;
  description: string;
  category: MarketplaceItem["category"];
  price: number;
  currency: string;
}

export interface SendCollaborationPayload {
  toChurchId: string;
  type: CollaborationRequest["type"];
  title: string;
  description: string;
}

const MarketplaceService = {
  async discoverChurches(
    filters?: ChurchDiscoveryFilter,
  ): Promise<ChurchListing[]> {
    const params = new URLSearchParams();
    if (filters?.city) params.set("city", filters.city);
    if (filters?.country) params.set("country", filters.country);
    if (filters?.denomination) params.set("denomination", filters.denomination);
    if (filters?.search) params.set("search", filters.search);
    if (filters?.page) params.set("page", String(filters.page));
    if (filters?.limit) params.set("limit", String(filters.limit));
    const query = params.toString();
    return get<ChurchListing[]>(
      `/marketplace/churches${query ? `?${query}` : ""}`,
    );
  },

  async getMarketplaceItems(
    category?: MarketplaceItem["category"],
  ): Promise<MarketplaceItem[]> {
    const query = category ? `?category=${category}` : "";
    return get<MarketplaceItem[]>(`/marketplace/items${query}`);
  },

  async createListing(
    payload: CreateListingPayload,
  ): Promise<MarketplaceItem> {
    return post<MarketplaceItem>("/marketplace/items", payload);
  },

  async getCollaborationRequests(): Promise<CollaborationRequest[]> {
    return get<CollaborationRequest[]>("/marketplace/collaborations");
  },

  async sendCollaborationRequest(
    payload: SendCollaborationPayload,
  ): Promise<CollaborationRequest> {
    return post<CollaborationRequest>(
      "/marketplace/collaborations",
      payload,
    );
  },
};

export default MarketplaceService;
