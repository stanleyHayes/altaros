import api from './api';
import { unwrapApiData } from './api-envelope';

export type WelfareCategory = 'financial' | 'medical' | 'food' | 'housing' | 'counseling' | 'other';
export type WelfareUrgency = 'low' | 'medium' | 'high' | 'critical';
export type WelfareStatus = 'pending' | 'under_review' | 'approved' | 'fulfilled' | 'declined';

export interface WelfareRequest {
  id: string;
  churchId: string;
  memberId: string;
  category: WelfareCategory;
  description: string;
  urgency: WelfareUrgency;
  isAnonymous: boolean;
  status: WelfareStatus;
  createdAt: string;
}

export interface CreateWelfareRequest {
  category: WelfareCategory;
  description: string;
  urgency: WelfareUrgency;
  isAnonymous: boolean;
}

export interface EmergencyAlertAcknowledgement {
  id: string;
  churchId: string;
  memberId: string;
  title: string;
  description: string;
  latitude?: number;
  longitude?: number;
  isActive: true;
  createdAt: string;
}

const CATEGORIES = new Set<WelfareCategory>([
  'financial', 'medical', 'food', 'housing', 'counseling', 'other',
]);
const URGENCIES = new Set<WelfareUrgency>(['low', 'medium', 'high', 'critical']);
const STATUSES = new Set<WelfareStatus>([
  'pending', 'under_review', 'approved', 'fulfilled', 'declined',
]);
export const MAX_WELFARE_DESCRIPTION_LENGTH = 2_000;
const MAX_WELFARE_HISTORY_ITEMS = 100;
const MAX_ID_LENGTH = 128;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= MAX_ID_LENGTH
    && SAFE_ID.test(value);
}

function validDescription(value: unknown): value is string {
  return nonEmptyString(value)
    && value.length <= MAX_WELFARE_DESCRIPTION_LENGTH
    && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
}

function validDate(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 64
    && Number.isFinite(Date.parse(value));
}

function validCoordinatePair(latitude: unknown, longitude: unknown): boolean {
  if (latitude === undefined && longitude === undefined) return true;
  return typeof latitude === 'number' && Number.isFinite(latitude)
    && latitude >= -90 && latitude <= 90
    && typeof longitude === 'number' && Number.isFinite(longitude)
    && longitude >= -180 && longitude <= 180;
}

export function normalizeEmergencyAcknowledgement(
  value: unknown,
  churchId: string,
  memberId: string,
  expectedDescription?: string,
): EmergencyAlertAcknowledgement {
  const payload = unwrapApiData(value, 'The pastoral team did not acknowledge this alert.');
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('The pastoral team did not acknowledge this alert.');
  }
  const alert = payload as Partial<EmergencyAlertAcknowledgement>;
  const valid = validId(churchId)
    && validId(memberId)
    && validId(alert.id)
    && alert.churchId === churchId
    && alert.memberId === memberId
    && validDescription(alert.title)
    && validDescription(alert.description)
    && (expectedDescription === undefined || alert.description === expectedDescription)
    && alert.isActive === true
    && validDate(alert.createdAt)
    && validCoordinatePair(alert.latitude, alert.longitude);
  if (!valid) throw new Error('The pastoral team did not acknowledge this alert.');
  return {
    id: alert.id as string,
    churchId,
    memberId,
    title: alert.title as string,
    description: alert.description as string,
    ...(alert.latitude !== undefined ? { latitude: alert.latitude } : {}),
    ...(alert.longitude !== undefined ? { longitude: alert.longitude } : {}),
    isActive: true,
    createdAt: alert.createdAt as string,
  };
}

export function normalizeWelfareRequest(
  value: unknown,
  churchId: string,
  memberId: string,
): WelfareRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The server returned an invalid welfare request.');
  }
  const request = value as Partial<WelfareRequest>;
  const valid = validId(churchId)
    && validId(memberId)
    && validId(request.id)
    && request.churchId === churchId
    && request.memberId === memberId
    && CATEGORIES.has(request.category as WelfareCategory)
    && validDescription(request.description)
    && URGENCIES.has(request.urgency as WelfareUrgency)
    && typeof request.isAnonymous === 'boolean'
    && STATUSES.has(request.status as WelfareStatus)
    && validDate(request.createdAt);
  if (!valid) throw new Error('The server returned an invalid welfare request.');
  return {
    id: request.id,
    churchId: request.churchId,
    memberId: request.memberId,
    category: request.category,
    description: request.description,
    urgency: request.urgency,
    isAnonymous: request.isAnonymous,
    status: request.status,
    createdAt: request.createdAt,
  } as WelfareRequest;
}

const welfareService = {
  async listMine(churchId: string, memberId: string): Promise<WelfareRequest[]> {
    if (!validId(churchId) || !validId(memberId)) {
      throw new Error('The member identity is invalid.');
    }
    const { data } = await api.get<unknown>('/welfare/my-requests');
    const history = unwrapApiData(data, 'The server returned invalid welfare history.');
    if (!Array.isArray(history)) throw new Error('The server returned invalid welfare history.');
    if (history.length > MAX_WELFARE_HISTORY_ITEMS) {
      throw new Error('The server returned too many welfare requests.');
    }
    const requests = history.map((request) => normalizeWelfareRequest(request, churchId, memberId));
    if (new Set(requests.map((request) => request.id)).size !== requests.length) {
      throw new Error('The server returned duplicate welfare requests.');
    }
    return requests;
  },
  async create(payload: CreateWelfareRequest, churchId: string, memberId: string): Promise<WelfareRequest> {
    if (!validId(churchId) || !validId(memberId)) {
      throw new Error('The member identity is invalid.');
    }
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new Error('The welfare request is invalid.');
    }
    const description = typeof payload.description === 'string' ? payload.description.trim() : '';
    if (!CATEGORIES.has(payload.category) || !validDescription(description)
      || !URGENCIES.has(payload.urgency) || typeof payload.isAnonymous !== 'boolean') {
      throw new Error('The welfare request is invalid.');
    }
    const request: CreateWelfareRequest = {
      category: payload.category,
      description,
      urgency: payload.urgency,
      isAnonymous: payload.isAnonymous,
    };
    const { data } = await api.post<unknown>('/welfare/requests', request);
    const created = normalizeWelfareRequest(
      unwrapApiData(data, 'The server returned an invalid welfare request.'),
      churchId,
      memberId,
    );
    if (created.category !== request.category
      || created.description !== request.description
      || created.urgency !== request.urgency
      || created.isAnonymous !== request.isAnonymous
      || created.status !== 'pending') {
      throw new Error('The server returned a welfare request that did not match your submission.');
    }
    return created;
  },
  async emergency(
    message: string | undefined,
    churchId: string,
    memberId: string,
  ): Promise<EmergencyAlertAcknowledgement> {
    if (!validId(churchId) || !validId(memberId)) {
      throw new Error('The member identity is invalid.');
    }
    const normalizedMessage = message?.trim() || undefined;
    if (normalizedMessage !== undefined && !validDescription(normalizedMessage)) {
      throw new Error('The emergency context is invalid.');
    }
    const { data } = await api.post<unknown>('/welfare/emergency-alert', { message: normalizedMessage });
    return normalizeEmergencyAcknowledgement(data, churchId, memberId, normalizedMessage);
  },
};

export default welfareService;
