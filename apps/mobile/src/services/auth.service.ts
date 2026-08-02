import api, { clearTokens, sessionBoundRequest } from './api';
import { session } from './session';
import { normalizeSessionTokenPair, type SessionTokenPair } from './session-token';
import { MemberSessionIdentityError } from './api-error';

export interface LoginRequest {
  email?: string;
  phone?: string;
  password?: string;
  method?: 'PHONE' | 'PASSWORD';
}

export interface RegisterRequest {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  churchCode?: string;
  /** Opaque id from the member-visible confirmation step; never sent as authority without re-resolution. */
  confirmedChurchId?: string;
}

export interface RegistrationChurch {
  id: string;
  name: string;
  slug: string;
}

export interface OtpRequest {
  phone: string;
  otp: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface RegistrationResponse {
  user: User;
  message?: string;
}

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  avatar?: string;
  churchId: string;
  churchName?: string;
  role: string;
}

export const MAX_AUTH_NAME_LENGTH = 120;
export const MAX_AUTH_EMAIL_LENGTH = 254;
export const MAX_AUTH_PHONE_INPUT_LENGTH = 32;
export const MAX_AUTH_PASSWORD_LENGTH = 72;
export const MAX_CHURCH_CODE_LENGTH = 80;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function canonicalEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length > 0 && email.length <= MAX_AUTH_EMAIL_LENGTH
    && !/[\u0000-\u001F\u007F]/.test(email) && EMAIL_PATTERN.test(email)
    ? email
    : null;
}

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) as number;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

export function validAuthPassword(value: unknown, minimumLength: number): value is string {
  return typeof value === 'string'
    && value.length >= minimumLength
    && utf8ByteLength(value) <= MAX_AUTH_PASSWORD_LENGTH
    && !/[\u0000-\u001F\u007F]/.test(value);
}

export function validRegistrationName(firstName: string, lastName: string): boolean {
  const name = `${firstName.trim()} ${lastName.trim()}`.trim();
  return name.length >= 2
    && utf8ByteLength(name) <= MAX_AUTH_NAME_LENGTH
    && !/[\u0000-\u001F\u007F]/.test(name);
}

export function canonicalPhone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_AUTH_PHONE_INPUT_LENGTH || /[^\d\s()+.\-]/.test(trimmed)) return null;

  const international = trimmed.startsWith('+') || trimmed.startsWith('00');
  const digits = trimmed.replace(/\D/g, '');
  if (international) {
    const internationalDigits = trimmed.startsWith('00') ? digits.slice(2) : digits;
    return /^[1-9]\d{7,14}$/.test(internationalDigits) ? `+${internationalDigits}` : null;
  }

  if (/^233\d{9}$/.test(digits)) return `+${digits}`;
  if (/^0\d{9}$/.test(digits)) return `+233${digits.slice(1)}`;
  if (/^\d{9}$/.test(digits)) return `+233${digits}`;
  return null;
}

export function normalizePhone(value: string): string {
  return canonicalPhone(value) ?? value.trim().replace(/[\s().-]/g, '');
}

interface WireUser {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  avatar?: string;
  avatarUrl?: string;
  churchId?: string;
  churchName?: string;
  role?: string;
}

interface WireAuthResponse {
  user: WireUser;
  tokens?: { accessToken: string; refreshToken: string };
  accessToken?: string;
  refreshToken?: string;
}

interface ApiEnvelope<T> {
  data: T;
  success?: boolean;
}

interface WireChurch {
  id: string;
  name?: string;
  slug?: string;
  isActive?: boolean;
}

const USER_ROLES = new Set(['SUPER_ADMIN', 'ORG_ADMIN', 'CHURCH_ADMIN', 'DEPARTMENT_LEADER', 'MEMBER']);
const ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

function boundedIdentityString(
  value: string | undefined,
  maxLength: number,
  required = false,
): string {
  const normalized = value?.trim() ?? '';
  if ((required && !normalized)
    || normalized.length > maxLength
    || /[\u0000-\u001F\u007F]/.test(normalized)) {
    throw new Error('The server returned an invalid member identity.');
  }
  return normalized;
}

function boundedIdentityId(value: string | undefined): string {
  const normalized = boundedIdentityString(value, 128, true);
  if (!ID_PATTERN.test(normalized)) {
    throw new Error('The server returned an invalid member identity.');
  }
  return normalized;
}

function safeIdentityAvatar(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  if (!candidate || candidate.length > 2_048 || /[\u0000-\u001F\u007F]/.test(candidate)) {
    return undefined;
  }
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' && parsed.hostname
      && !parsed.username && !parsed.password
      ? candidate
      : undefined;
  } catch {
    return undefined;
  }
}

function unwrap<T>(data: T | ApiEnvelope<T>): T {
  if (typeof data === 'object' && data !== null && 'data' in data) {
    const envelope = data as ApiEnvelope<T>;
    if (envelope.success !== undefined && envelope.success !== true) {
      throw new Error('The server did not confirm that request.');
    }
    return envelope.data;
  }
  return data;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error('The server returned an invalid member identity.');
  return value;
}

export function normalizeUser(value: unknown): User {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The server returned an invalid member identity.');
  }
  const record = value as Record<string, unknown>;
  const id = boundedIdentityId(optionalString(record, 'id'));
  const churchId = boundedIdentityId(optionalString(record, 'churchId'));
  const role = boundedIdentityString(optionalString(record, 'role') ?? 'MEMBER', 32, true);
  if (!USER_ROLES.has(role)) throw new Error('The server returned an invalid member identity.');
  const emailValue = boundedIdentityString(optionalString(record, 'email'), MAX_AUTH_EMAIL_LENGTH);
  const email = emailValue ? canonicalEmail(emailValue) : '';
  const phoneValue = boundedIdentityString(optionalString(record, 'phone'), MAX_AUTH_PHONE_INPUT_LENGTH);
  const phone = phoneValue ? canonicalPhone(phoneValue) : '';
  if (emailValue && !email) throw new Error('The server returned an invalid member identity.');
  if (phoneValue && !phone) throw new Error('The server returned an invalid member identity.');

  const user: WireUser = {
    id,
    name: boundedIdentityString(optionalString(record, 'name'), 120) || undefined,
    firstName: boundedIdentityString(optionalString(record, 'firstName'), 120) || undefined,
    lastName: boundedIdentityString(optionalString(record, 'lastName'), 120) || undefined,
    email: email || undefined,
    phone: phone || undefined,
    avatar: safeIdentityAvatar(optionalString(record, 'avatar')),
    avatarUrl: safeIdentityAvatar(optionalString(record, 'avatarUrl')),
    churchId,
    churchName: boundedIdentityString(optionalString(record, 'churchName'), 160) || undefined,
    role,
  };
  const nameParts = (user.name ?? '').trim().split(/\s+/).filter(Boolean);
  const firstName = (user.firstName ?? nameParts[0] ?? 'Member').trim();
  const lastName = (user.lastName ?? nameParts.slice(1).join(' ')).trim();
  return {
    id: user.id,
    firstName: firstName || 'Member',
    lastName,
    email: user.email ?? '',
    phone: user.phone ?? '',
    avatar: user.avatar ?? user.avatarUrl,
    churchId,
    churchName: user.churchName?.trim() || undefined,
    role,
  };
}

export function normalizeCurrentChurch(value: unknown, churchId: string): string {
  const unwrapped = unwrap(value as unknown | ApiEnvelope<unknown>);
  if (typeof unwrapped !== 'object' || unwrapped === null || Array.isArray(unwrapped)) {
    throw new Error('The server returned invalid church details.');
  }
  const record = unwrapped as Record<string, unknown>;
  if (boundedIdentityId(optionalString(record, 'id')) !== churchId) {
    throw new Error('The server returned church details for another account.');
  }
  const name = boundedIdentityString(optionalString(record, 'name'), 160, true);
  if (!name || (record.isActive !== undefined && record.isActive !== true)) {
    throw new Error('The server returned invalid church details.');
  }
  return name;
}

export function normalizeRegistrationChurch(value: unknown, expectedSlug: string): RegistrationChurch {
  const unwrapped = unwrap(value as unknown | ApiEnvelope<unknown>);
  if (typeof unwrapped !== 'object' || unwrapped === null || Array.isArray(unwrapped)) {
    throw new Error('That church code returned invalid details. Ask your church for a new code.');
  }
  const record = unwrapped as Record<string, unknown>;
  const id = boundedIdentityId(optionalString(record, 'id'));
  const name = boundedIdentityString(optionalString(record, 'name'), 160, true);
  const slug = boundedIdentityString(optionalString(record, 'slug'), MAX_CHURCH_CODE_LENGTH, true).toLowerCase();
  if (!name || slug !== expectedSlug
    || (record.isActive !== undefined && record.isActive !== true)) {
    throw new Error('That church code returned invalid details. Ask your church for a new code.');
  }
  return { id, name, slug };
}

export async function resolveChurchCode(value: string): Promise<RegistrationChurch> {
  const slug = value.trim().toLowerCase();
  if (slug.length < 3 || slug.length > MAX_CHURCH_CODE_LENGTH || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error('Enter the church code exactly as your church shared it.');
  }
  const { data } = await api.get<WireChurch | ApiEnvelope<WireChurch>>(
    `/churches/slug/${encodeURIComponent(slug)}`,
  );
  return normalizeRegistrationChurch(data, slug);
}

async function enrichChurchName(user: User, accessToken?: string): Promise<User> {
  if (user.churchName) return user;
  try {
    const response = accessToken
      ? await api.get<WireChurch | ApiEnvelope<WireChurch>>('/churches/current', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      : await api.get<WireChurch | ApiEnvelope<WireChurch>>('/churches/current');
    const { data } = response;
    return { ...user, churchName: normalizeCurrentChurch(data, user.churchId) };
  } catch {
    // Church display data must not turn a valid authentication result into a
    // failed sign-in. Tenant ownership is already mandatory on the user; the
    // home/profile fallback remains honest until a later reconciliation.
    return user;
  }
}

export function normalizeAuthResponse(value: unknown): AuthResponse {
  const unwrapped = unwrap(value as unknown | ApiEnvelope<unknown>);
  if (typeof unwrapped !== 'object' || unwrapped === null || Array.isArray(unwrapped)) {
    throw new Error('The server returned an invalid session. Please try again.');
  }
  const data = unwrapped as Partial<WireAuthResponse>;
  if (!data.user) {
    throw new Error('The server returned an invalid session. Please try again.');
  }
  let tokens: SessionTokenPair;
  try {
    tokens = normalizeSessionTokenPair(
      data.tokens?.accessToken ?? data.accessToken,
      data.tokens?.refreshToken ?? data.refreshToken,
    );
  } catch {
    throw new Error('The server returned an invalid session. Please try again.');
  }
  return { ...tokens, user: normalizeUser(data.user) };
}

export function normalizeRegistrationResponse(
  value: unknown,
  churchId: string,
  phone: string,
  email: string,
  name: string,
): RegistrationResponse {
  const unwrapped = unwrap(value as unknown | ApiEnvelope<unknown>);
  if (typeof unwrapped !== 'object' || unwrapped === null || Array.isArray(unwrapped)) {
    throw new Error('The server returned an invalid registration result.');
  }
  const record = unwrapped as Record<string, unknown>;
  const user = normalizeUser(record.user);
  const message = optionalString(record, 'message')?.trim();
  const returnedName = `${user.firstName} ${user.lastName}`.trim().replace(/\s+/g, ' ');
  const expectedName = name.trim().replace(/\s+/g, ' ');
  if (user.churchId !== churchId || user.phone !== phone || user.email !== email
    || returnedName !== expectedName || user.role !== 'MEMBER') {
    throw new Error('The server returned an invalid registration result.');
  }
  return { user, message: message || undefined };
}

export function normalizeOtpDispatch(value: unknown): { message: string } {
  const unwrapped = unwrap(value as unknown | ApiEnvelope<unknown>);
  if (typeof unwrapped !== 'object' || unwrapped === null || Array.isArray(unwrapped)) {
    throw new Error('The server did not confirm that a code was requested.');
  }
  const message = optionalString(unwrapped as Record<string, unknown>, 'message')?.trim();
  if (!message) throw new Error('The server did not confirm that a code was requested.');
  return { message };
}

async function storeAuthData(data: AuthResponse, canCommit: () => boolean): Promise<void> {
  const committed = await session.commitAuthenticatedSessionIf(
    data.accessToken,
    data.refreshToken,
    data.user,
    canCommit,
  );
  if (!committed) throw new Error('The sign-in attempt is no longer active.');
}

async function endSession(path: '/auth/logout' | '/auth/logout-all'): Promise<void> {
  const accessToken = await session.getAccessToken().catch(() => null);
  // Capture the bearer token in the request config before local cleanup starts.
  // Axios begins the request chain immediately; local fail-closed cleanup runs
  // concurrently and never waits on a slow or unreachable gateway.
  const remoteRevocation = accessToken
    ? api.post(path, undefined, sessionBoundRequest(accessToken))
    : Promise.resolve();
  const [remoteResult, localResult] = await Promise.allSettled([
    remoteRevocation,
    clearTokens(),
  ]);
  if (localResult.status === 'rejected') throw localResult.reason;
  if (remoteResult.status === 'rejected') throw remoteResult.reason;
}

async function endAllSessions(): Promise<boolean> {
  const accessToken = await session.getAccessToken().catch(() => null);
  if (!accessToken) {
    await Promise.resolve(clearTokens()).catch(() => undefined);
    return true;
  }

  // Global logout must not claim success until the gateway confirms family
  // revocation. Keep this session available for retry when the request fails.
  await api.post('/auth/logout-all', undefined, {
    ...sessionBoundRequest(accessToken),
  });

  // A token can be replaced while revocation is in flight (for example after
  // expiry followed by a fresh OTP login). Never clear that newer session.
  const currentToken = await session.getAccessToken().catch(() => null);
  if (currentToken !== accessToken) return false;

  // session.clear records a fail-closed tombstone before deletion. Even if a
  // platform keychain deletion reports an error, the revoked session must no
  // longer remain visible or recoverable on this device.
  await Promise.resolve(clearTokens()).catch(() => undefined);
  return true;
}

const authService = {
  resolveChurchCode,

  async login(credentials: LoginRequest, canCommit: () => boolean = () => true): Promise<AuthResponse> {
    const email = canonicalEmail(credentials.email);
    if ((credentials.method !== undefined && credentials.method !== 'PASSWORD')
      || !email || !validAuthPassword(credentials.password, 1)) {
      throw new Error('Enter a valid email and password to continue.');
    }
    const { data } = await api.post<WireAuthResponse>('/auth/login', {
      email,
      password: credentials.password,
      method: 'PASSWORD',
    });
    const normalized = normalizeAuthResponse(data);
    if (normalized.user.email !== email) {
      throw new Error('The server returned a session for another member. Please try again.');
    }
    const response = {
      ...normalized,
      user: await enrichChurchName(normalized.user, normalized.accessToken),
    };
    await storeAuthData(response, canCommit);
    return response;
  },

  async register(details: RegisterRequest): Promise<RegistrationResponse> {
    if (!details.churchCode) {
      throw new Error('Enter the church code provided by your church.');
    }
    const phone = canonicalPhone(details.phone);
    if (!phone) throw new Error('Enter a valid mobile number, including the country code.');
    const name = `${details.firstName.trim()} ${details.lastName.trim()}`.trim();
    const email = canonicalEmail(details.email);
    if (!validRegistrationName(details.firstName, details.lastName)
      || !email || !validAuthPassword(details.password, 8)) {
      throw new Error('Enter valid registration details and a password of 8–72 UTF-8 bytes. Some symbols use more than one byte.');
    }
    const church = await resolveChurchCode(details.churchCode);
    if (details.confirmedChurchId && church.id !== details.confirmedChurchId) {
      throw new Error('That church code has changed. Confirm your church again before joining.');
    }
    const { data } = await api.post<unknown>('/auth/register', {
      name,
      email,
      phone,
      password: details.password,
      churchId: church.id,
    });
    // Registration is account creation, not proof that the member controls
    // the supplied phone number. No session is accepted here; VerifyOTP is the
    // only step that establishes a mobile session.
    return normalizeRegistrationResponse(data, church.id, phone, email, name);
  },

  async verifyOtp(otpData: OtpRequest, canCommit: () => boolean = () => true): Promise<AuthResponse> {
    const phone = canonicalPhone(otpData.phone);
    if (!phone) throw new Error('Enter a valid mobile number, including the country code.');
    if (!/^\d{6}$/.test(otpData.otp)) throw new Error('Enter the full 6-digit code.');
    const { data } = await api.post<WireAuthResponse>('/auth/verify-otp', { otp: otpData.otp, phone });
    const normalized = normalizeAuthResponse(data);
    if (normalized.user.phone !== phone) {
      throw new Error('The server returned a session for another member. Please try again.');
    }
    const response = {
      ...normalized,
      user: await enrichChurchName(normalized.user, normalized.accessToken),
    };
    await storeAuthData(response, canCommit);
    return response;
  },

  async requestOtp(phone: string): Promise<{ message: string }> {
    const canonical = canonicalPhone(phone);
    if (!canonical) throw new Error('Enter a valid mobile number, including the country code.');
    const { data } = await api.post<{ message: string } | ApiEnvelope<{ message: string }>>(
      '/auth/request-otp',
      { phone: canonical },
    );
    return normalizeOtpDispatch(data);
  },

  async getCurrentUser(expected?: Pick<User, 'id' | 'churchId'>): Promise<User> {
    const { data } = await api.get<WireUser | ApiEnvelope<WireUser>>('/auth/me');
    const user = await enrichChurchName(normalizeUser(unwrap(data)));
    if (expected && (user.id !== expected.id || user.churchId !== expected.churchId)) {
      throw new MemberSessionIdentityError();
    }
    // AuthContext owns the session-revision guard. Persisting here would let a
    // slow response from a signed-out account overwrite a newer login's cache
    // before React rejects the stale result.
    return user;
  },

  async logout(): Promise<void> {
    await endSession('/auth/logout');
  },

  async logoutEverywhere(): Promise<boolean> {
    return endAllSessions();
  },

  async getStoredUser(): Promise<User | null> {
    const stored = await session.getUser<unknown>();
    return stored === null ? null : normalizeUser(stored);
  },
  async isAuthenticated(): Promise<boolean> {
    return Boolean(await session.getAccessToken());
  },
};

export default authService;
