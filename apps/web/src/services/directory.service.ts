import { get } from "./api";

export interface DirectoryChurch {
  id: string;
  name: string;
  slug: string;
  city?: string;
  country?: string;
  website?: string;
}

/**
 * Guards validate the API response before rendering. An entry without a name
 * is dropped rather than rendered as "undefined" to a visitor.
 */
function isChurch(v: unknown): v is DirectoryChurch {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Partial<DirectoryChurch>;
  return typeof c.name === "string" && c.name.length > 0 && typeof c.id === "string";
}

async function getChurches(): Promise<DirectoryChurch[]> {
  // GET /directory/churches wraps response as { data: { churches: [...] } }
  // api.get() unwraps it to just { churches: [...] }
  const response = await get<{ churches: unknown[] }>("/directory/churches");
  const list = response?.churches;
  return Array.isArray(list) ? list.filter(isChurch) : [];
}

export const directoryService = {
  churches: getChurches,
};

export default directoryService;
