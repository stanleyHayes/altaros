import { get } from "./api";
import type {
  ChurchListing,
  ChurchDiscoveryFilter,
} from "@altar-os/shared-types";

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
};

export default MarketplaceService;
