/**
 * The public church directory.
 *
 * Read from the API rather than built at deploy time, because a church that
 * opts out has to disappear from this page without waiting for the next
 * marketing release. Consent is revocable or it is not consent.
 *
 * Every church here asked to be listed twice — once for the church, once for
 * the campaign — and the API returns nothing that was not explicitly published.
 */

const API_URL = (import.meta.env.VITE_API_URL || "/api/v1").replace(/\/$/, "");

export interface DirectoryChurch {
  id: string;
  name: string;
  slug: string;
  city?: string;
  country?: string;
  website?: string;
}

export interface DirectoryCampaign {
  id: string;
  title: string;
  description?: string;
  coverImageUrl?: string;
  targetAmount: number;
  currency: string;
  endDate: string;
  churchName: string;
  churchSlug?: string;
  currentAmount?: number;
  progress?: number;
}

/**
 * Guards, because this page renders whatever the API hands back.
 *
 * A card missing a name is a card that reads "undefined" to every visitor and
 * every crawler, so an entry that cannot be displayed honestly is dropped
 * rather than rendered half-empty.
 */
function isChurch(v: unknown): v is DirectoryChurch {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Partial<DirectoryChurch>;
  return typeof c.name === "string" && c.name.length > 0 && typeof c.id === "string";
}

function isCampaign(v: unknown): v is DirectoryCampaign {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Partial<DirectoryCampaign>;
  return (
    typeof c.title === "string" &&
    c.title.length > 0 &&
    typeof c.churchName === "string" &&
    typeof c.targetAmount === "number"
  );
}

async function get<T>(path: string, key: string, guard: (v: unknown) => v is T): Promise<T[]> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`directory: ${res.status}`);
  const body = (await res.json()) as { data?: Record<string, unknown> };
  const list = body?.data?.[key];
  return Array.isArray(list) ? list.filter(guard) : [];
}

export const directoryService = {
  churches: () => get("/directory/churches", "churches", isChurch),
  campaigns: () => get("/directory/campaigns", "campaigns", isCampaign),
};

export default directoryService;
