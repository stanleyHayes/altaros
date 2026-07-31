export interface ChurchListing {
  id: string;
  churchId: string;
  churchName: string;
  city: string;
  country: string;
  denomination: string;
  memberCount: number;
  logoUrl?: string;
  description: string;
  services: { day: string; time: string; name: string }[];
  isVerified: boolean;
  rating: number;
  reviewCount: number;
}

export interface MarketplaceItem {
  id: string;
  churchId: string;
  churchName: string;
  title: string;
  description: string;
  category: "resource" | "service" | "training" | "media" | "equipment";
  price: number;
  currency: string;
  imageUrl?: string;
  isActive: boolean;
  createdAt: string;
}

export interface MarketplaceReview {
  id: string;
  itemId: string;
  reviewerId: string;
  reviewerName: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface ChurchDiscoveryFilter {
  city?: string;
  country?: string;
  denomination?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface CollaborationRequest {
  id: string;
  fromChurchId: string;
  fromChurchName: string;
  toChurchId: string;
  toChurchName: string;
  type:
    | "event_collab"
    | "resource_share"
    | "pulpit_exchange"
    | "joint_outreach";
  title: string;
  description: string;
  status: "pending" | "accepted" | "declined";
  createdAt: string;
}
