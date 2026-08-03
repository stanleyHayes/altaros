import api from './api';
import { unwrapApiData } from './api-envelope';
import { httpStatus } from './api-error';

export interface Devotional {
  id: string;
  churchId: string;
  title: string;
  scripture: string;
  scriptureReference: string;
  content: string;
  author: string;
  date: string;
  imageUrl?: string;
}

interface WireDevotional extends Omit<Devotional, 'scriptureReference'> {
  scriptureReference?: string;
  scriptureText?: string;
}

export interface Sermon {
  id: string;
  churchId: string;
  title: string;
  speaker: string;
  date: string;
  duration: string;
  audioUrl?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  series?: string;
  description?: string;
}

export interface SermonPlaybackAction {
  url: string | null;
  kind: 'audio' | 'video' | null;
  disabled: boolean;
  busy: boolean;
  label: string;
  hint?: string;
}

type WireSermon = Sermon;

export interface PrayerRequest {
  id: string;
  churchId: string;
  memberId?: string;
  title: string;
  description: string;
  isAnonymous: boolean;
  prayerCount: number;
  createdAt: string;
  authorName?: string;
}

export interface CreatePrayerRequest {
  title: string;
  description: string;
  isAnonymous: boolean;
}

type WirePrayerRequest = Omit<PrayerRequest, 'prayerCount'> & { prayerCount?: number };

const MAX_SPIRITUAL_PAGE_SIZE = 50;
const DEFAULT_SPIRITUAL_PAGE_SIZE = 20;
export const SERMON_PAGE_SIZE = 25;
export const PRAYER_PAGE_SIZE = 25;
const MAX_ID_LENGTH = 128;
const MAX_TITLE_LENGTH = 200;
export const MAX_PRAYER_DESCRIPTION_LENGTH = 2_000;
const MAX_LONG_FORM_LENGTH = 50_000;
const MAX_DESCRIPTION_LENGTH = 5_000;
const MAX_SHORT_TEXT_LENGTH = 500;
const MAX_NAME_LENGTH = 120;
const MAX_MEDIA_URL_LENGTH = 2_048;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function boundedText(value: unknown, maxLength: number, allowLineBreaks = false): value is string {
  if (typeof value !== 'string' || value.length > maxLength) return false;
  const unsafeControls = allowLineBreaks
    ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
    : /[\u0000-\u001F\u007F]/;
  return !unsafeControls.test(value);
}

function requiredText(value: unknown, maxLength: number, allowLineBreaks = false): value is string {
  return nonEmptyString(value) && boundedText(value, maxLength, allowLineBreaks);
}

function optionalText(value: unknown, maxLength: number, allowLineBreaks = false): value is string | undefined {
  return value === undefined || boundedText(value, maxLength, allowLineBreaks);
}

function validId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= MAX_ID_LENGTH
    && SAFE_ID.test(value);
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function validCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validPageTotal(value: unknown, length: number): value is number {
  return validCount(value) && Number(value) >= length;
}

function requestedPageSize(params?: { page?: number; limit?: number }): number {
  if (params?.page !== undefined && (!Number.isSafeInteger(params.page) || params.page < 1)) {
    throw new Error('The requested spiritual page is invalid.');
  }
  if (params?.limit !== undefined
    && (!Number.isSafeInteger(params.limit) || params.limit < 1 || params.limit > MAX_SPIRITUAL_PAGE_SIZE)) {
    throw new Error('The requested spiritual page size is invalid.');
  }
  return params?.limit ?? DEFAULT_SPIRITUAL_PAGE_SIZE;
}

export function normalizeDevotional(value: unknown, churchId: string): Devotional {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The server returned an invalid devotional.');
  }
  const item = value as Partial<WireDevotional>;
  const passage = item.scriptureText ?? item.scripture;
  const reference = item.scriptureReference ?? (item.scriptureText ? item.scripture : undefined);
  const imageUrl = item.imageUrl === undefined ? undefined : safeSpiritualMediaUrl(item.imageUrl);
  const valid = validId(item.id)
    && item.churchId === churchId
    && requiredText(item.title, MAX_TITLE_LENGTH)
    && requiredText(passage, MAX_LONG_FORM_LENGTH, true)
    && requiredText(reference, MAX_SHORT_TEXT_LENGTH)
    && requiredText(item.content, MAX_LONG_FORM_LENGTH, true)
    && requiredText(item.author, MAX_NAME_LENGTH)
    && validDate(item.date)
    && (item.imageUrl === undefined || imageUrl !== null);
  if (!valid) throw new Error('The server returned an invalid devotional.');
  const wire = item as WireDevotional;
  return {
    id: wire.id,
    churchId,
    title: wire.title,
    scripture: passage as string,
    scriptureReference: reference as string,
    content: wire.content,
    author: wire.author,
    date: wire.date,
    ...(imageUrl ? { imageUrl } : {}),
  };
}

export function normalizeSermon(value: unknown, churchId: string): Sermon {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The server returned an invalid sermon.');
  }
  const item = value as Partial<WireSermon>;
  const audioUrl = item.audioUrl === undefined ? undefined : safeSpiritualMediaUrl(item.audioUrl);
  const videoUrl = item.videoUrl === undefined ? undefined : safeSpiritualMediaUrl(item.videoUrl);
  const thumbnailUrl = item.thumbnailUrl === undefined ? undefined : safeSpiritualMediaUrl(item.thumbnailUrl);
  const valid = validId(item.id)
    && item.churchId === churchId
    && requiredText(item.title, MAX_TITLE_LENGTH)
    && requiredText(item.speaker, MAX_NAME_LENGTH)
    && validDate(item.date)
    && requiredText(item.duration, 64)
    && (item.audioUrl === undefined || audioUrl !== null)
    && (item.videoUrl === undefined || videoUrl !== null)
    && (item.thumbnailUrl === undefined || thumbnailUrl !== null)
    && optionalText(item.series, MAX_TITLE_LENGTH)
    && optionalText(item.description, MAX_DESCRIPTION_LENGTH, true);
  if (!valid) throw new Error('The server returned an invalid sermon.');
  return {
    id: item.id as string,
    churchId,
    title: item.title as string,
    speaker: item.speaker as string,
    date: item.date as string,
    duration: item.duration as string,
    ...(audioUrl ? { audioUrl } : {}),
    ...(videoUrl ? { videoUrl } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(item.series !== undefined ? { series: item.series } : {}),
    ...(item.description !== undefined ? { description: item.description } : {}),
  };
}

export function normalizePrayerRequest(
  value: unknown,
  churchId: string,
  expectedMemberId?: string,
): PrayerRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The server returned an invalid prayer request.');
  }
  const item = value as Partial<WirePrayerRequest>;
  const prayerCount = item.prayerCount ?? 0;
  const validMember = expectedMemberId
    ? item.memberId === expectedMemberId && validId(item.memberId)
    : item.memberId === undefined || validId(item.memberId);
  const valid = validId(item.id)
    && item.churchId === churchId
    && validMember
    && requiredText(item.title, MAX_TITLE_LENGTH)
    && requiredText(item.description, MAX_PRAYER_DESCRIPTION_LENGTH, true)
    && typeof item.isAnonymous === 'boolean'
    && validCount(prayerCount)
    && validDate(item.createdAt)
    && optionalText(item.authorName, MAX_NAME_LENGTH);
  if (!valid) throw new Error('The server returned an invalid prayer request.');
  return {
    id: item.id as string,
    churchId,
    ...(expectedMemberId ? { memberId: item.memberId as string } : {}),
    title: item.title as string,
    description: item.description as string,
    isAnonymous: item.isAnonymous as boolean,
    prayerCount,
    createdAt: item.createdAt as string,
    ...(!item.isAnonymous && item.authorName ? { authorName: item.authorName } : {}),
  };
}

export function safeSpiritualMediaUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_MEDIA_URL_LENGTH
    || /[\u0000-\u001F\u007F]/.test(value)) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function sermonPlaybackAction(
  sermon: Pick<Sermon, 'id' | 'title' | 'audioUrl' | 'videoUrl'>,
  offline: boolean,
  openingId: string | null,
): SermonPlaybackAction {
  const audioUrl = safeSpiritualMediaUrl(sermon.audioUrl);
  const videoUrl = audioUrl ? null : safeSpiritualMediaUrl(sermon.videoUrl);
  const url = audioUrl ?? videoUrl;
  const kind = audioUrl ? 'audio' : videoUrl ? 'video' : null;
  const busy = openingId === sermon.id;
  const anotherOpening = openingId !== null && !busy;
  const disabled = !url || offline || openingId !== null;
  const label = kind === 'audio' ? `Listen to ${sermon.title}`
    : kind === 'video' ? `Watch ${sermon.title}` : `${sermon.title} has no playback link`;
  const hint = !url ? 'This sermon has no secure playback link.'
    : offline ? 'Reconnect to open this sermon.'
      : busy ? 'Opening this sermon on your device.'
        : anotherOpening ? 'Wait for the current sermon to open.' : undefined;
  return { url, kind, disabled, busy, label, ...(hint ? { hint } : {}) };
}

const spiritualService = {
  async getTodayDevotional(churchId: string): Promise<Devotional | null> {
    if (!validId(churchId)) throw new Error('The member identity is incomplete.');
    try {
      const { data } = await api.get<unknown>('/spiritual/devotional/today');
      return normalizeDevotional(unwrapApiData(data, 'The server returned an invalid devotional.'), churchId);
    } catch (error) {
      // The singular "today" resource uses 404 to represent a valid empty
      // editorial state. Other failures must remain distinguishable from
      // "your church has not published yet" in both Home and the reader.
      if (httpStatus(error) === 404) return null;
      throw error;
    }
  },

  async getDevotionals(churchId: string, params?: {
    page?: number;
    limit?: number;
  }): Promise<{ devotionals: Devotional[]; total: number }> {
    if (!validId(churchId)) throw new Error('The member identity is incomplete.');
    const pageSize = requestedPageSize(params);
    const { data } = await api.get<unknown>('/spiritual/devotionals', { params });
    const payload = unwrapApiData(data, 'The server returned invalid devotionals.');
    const devotionals = Array.isArray(payload) ? payload : typeof payload === 'object' && payload !== null
      ? (payload as { devotionals?: WireDevotional[]; data?: WireDevotional[] }).devotionals
        ?? (payload as { data?: WireDevotional[] }).data
      : undefined;
    if (!Array.isArray(devotionals)) throw new Error('The server returned invalid devotionals.');
    if (devotionals.length > pageSize) throw new Error('The server returned too many devotionals.');
    const normalized = devotionals.map((item) => normalizeDevotional(item, churchId));
    if (new Set(normalized.map((item) => item.id)).size !== normalized.length) throw new Error('The server returned duplicate devotionals.');
    const reportedTotal = Array.isArray(payload) ? undefined : (payload as { total?: number }).total;
    if (params?.page !== undefined && reportedTotal === undefined) throw new Error('The server returned an invalid devotional total.');
    const total = reportedTotal ?? normalized.length;
    if (!validPageTotal(total, normalized.length)) throw new Error('The server returned an invalid devotional total.');
    return {
      devotionals: normalized,
      total,
    };
  },

  async getSermons(churchId: string, params?: {
    page?: number;
    limit?: number;
    series?: string;
  }): Promise<{ sermons: Sermon[]; total: number }> {
    if (!validId(churchId)) throw new Error('The member identity is incomplete.');
    const pageSize = requestedPageSize(params);
    if (params?.series !== undefined && !requiredText(params.series, MAX_TITLE_LENGTH)) {
      throw new Error('The requested sermon series is invalid.');
    }
    const { data } = await api.get<unknown>('/spiritual/sermons', { params });
    const payload = unwrapApiData(data, 'The server returned invalid sermons.');
    const sermons = Array.isArray(payload) ? payload : typeof payload === 'object' && payload !== null
      ? (payload as { sermons?: WireSermon[]; data?: WireSermon[] }).sermons
        ?? (payload as { data?: WireSermon[] }).data
      : undefined;
    if (!Array.isArray(sermons)) throw new Error('The server returned invalid sermons.');
    if (sermons.length > pageSize) throw new Error('The server returned too many sermons.');
    const normalized = sermons.map((item) => normalizeSermon(item, churchId));
    if (new Set(normalized.map((item) => item.id)).size !== normalized.length) throw new Error('The server returned duplicate sermons.');
    const reportedTotal = Array.isArray(payload) ? undefined : (payload as { total?: number }).total;
    if (params?.page !== undefined && reportedTotal === undefined) throw new Error('The server returned an invalid sermon total.');
    const total = reportedTotal ?? normalized.length;
    if (!validPageTotal(total, normalized.length)) throw new Error('The server returned an invalid sermon total.');
    return {
      sermons: normalized,
      total,
    };
  },

  async getSermon(id: string, churchId: string): Promise<Sermon> {
    if (!validId(id)) throw new Error('The requested sermon is invalid.');
    if (!validId(churchId)) throw new Error('The member identity is incomplete.');
    const { data } = await api.get<unknown>(`/spiritual/sermons/${encodeURIComponent(id)}`);
    const sermon = normalizeSermon(unwrapApiData(data, 'The server returned an invalid sermon.'), churchId);
    if (sermon.id !== id) throw new Error('The server returned the wrong sermon.');
    return sermon;
  },

  async getPrayerRequests(churchId: string, params?: {
    page?: number;
    limit?: number;
  }): Promise<{ requests: PrayerRequest[]; total: number }> {
    if (!validId(churchId)) throw new Error('The member identity is incomplete.');
    const pageSize = requestedPageSize(params);
    const { data } = await api.get<unknown>('/spiritual/prayer-requests', { params });
    const payload = unwrapApiData(data, 'The server returned invalid prayer requests.');
    const requests = Array.isArray(payload) ? payload : typeof payload === 'object' && payload !== null
      ? (payload as { requests?: WirePrayerRequest[]; data?: WirePrayerRequest[] }).requests
        ?? (payload as { data?: WirePrayerRequest[] }).data
      : undefined;
    if (!Array.isArray(requests)) throw new Error('The server returned invalid prayer requests.');
    if (requests.length > pageSize) throw new Error('The server returned too many prayer requests.');
    const normalized = requests.map((item) => normalizePrayerRequest(item, churchId));
    if (new Set(normalized.map((item) => item.id)).size !== normalized.length) throw new Error('The server returned duplicate prayer requests.');
    const reportedTotal = Array.isArray(payload) ? undefined : (payload as { total?: number }).total;
    if (params?.page !== undefined && reportedTotal === undefined) throw new Error('The server returned an invalid prayer total.');
    const total = reportedTotal ?? normalized.length;
    if (!validPageTotal(total, normalized.length)) throw new Error('The server returned an invalid prayer total.');
    return {
      requests: normalized,
      total,
    };
  },

  async createPrayerRequest(
    request: CreatePrayerRequest,
    churchId: string,
    memberId: string,
  ): Promise<PrayerRequest> {
    if (!validId(churchId) || !validId(memberId)) throw new Error('The member identity is incomplete.');
    if (typeof request !== 'object' || request === null) throw new Error('The prayer request is invalid.');
    const title = typeof request.title === 'string' ? request.title.trim() : '';
    const description = typeof request.description === 'string' ? request.description.trim() : '';
    if (!requiredText(title, MAX_TITLE_LENGTH)
      || !requiredText(description, MAX_PRAYER_DESCRIPTION_LENGTH, true)
      || typeof request.isAnonymous !== 'boolean') {
      throw new Error('The prayer request is invalid.');
    }
    const canonicalRequest: CreatePrayerRequest = {
      title,
      description,
      isAnonymous: request.isAnonymous,
    };
    const { data } = await api.post<unknown>(
      '/spiritual/prayer-requests',
      canonicalRequest,
    );
    const created = normalizePrayerRequest(
      unwrapApiData(data, 'The server returned an invalid prayer request.'),
      churchId,
      memberId,
    );
    if (created.title !== title
      || created.description !== description
      || created.isAnonymous !== request.isAnonymous) {
      throw new Error('The server returned an invalid prayer request.');
    }
    return created;
  },

  async prayForRequest(requestId: string): Promise<{ prayerCount?: number }> {
    if (!validId(requestId)) throw new Error('The requested prayer is invalid.');
    const { data } = await api.post<unknown>(
      `/spiritual/prayer-requests/${encodeURIComponent(requestId)}/pray`,
    );
    const payload = unwrapApiData(data, 'The server returned an invalid prayer count.');
    if (payload === undefined || payload === null) return {};
    if (typeof payload !== 'object' || Array.isArray(payload)) throw new Error('The server returned an invalid prayer count.');
    const acknowledgement = payload as {
      requestId?: unknown;
      prayerRequestId?: unknown;
      prayerCount?: unknown;
    };
    const acknowledgedId = acknowledgement.requestId ?? acknowledgement.prayerRequestId;
    if (acknowledgedId !== undefined && acknowledgedId !== requestId) {
      throw new Error('The server returned an invalid prayer count.');
    }
    const count = acknowledgement.prayerCount;
    if (count === undefined) return {};
    if (!validCount(count)) throw new Error('The server returned an invalid prayer count.');
    return { prayerCount: count };
  },
};

export default spiritualService;
