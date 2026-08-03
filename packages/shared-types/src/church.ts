export type ChurchPlan = "free" | "basic" | "pro" | "enterprise";

export interface Church {
  id: string;
  name: string;
  slug: string;
  address: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  website?: string;
  logoUrl?: string;
  bannerUrl?: string;
  timezone: string;
  currency: string;
  plan: ChurchPlan;
  requestedPlan?: ChurchPlan;
  denomination?: string;
  averageWeeklyAttendance?: number;
  ministryPriorities?: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChurchSettings {
  id: string;
  churchId: string;
  allowPublicRegistration: boolean;
  defaultLanguage: string;
  fiscalYearStart: number;
}
