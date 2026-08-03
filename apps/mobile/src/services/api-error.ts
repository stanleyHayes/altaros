import axios from 'axios';

export class MemberSessionIdentityError extends Error {
  constructor() {
    super('The server returned a profile for another member. Please sign in again.');
    this.name = 'MemberSessionIdentityError';
  }
}

export function httpStatus(error: unknown): number | undefined {
  return axios.isAxiosError(error) ? error.response?.status : undefined;
}

/** Only the server can end a session. Network failures and 5xx responses do not. */
export function isAuthenticationRejection(error: unknown): boolean {
  const status = httpStatus(error);
  return status === 401 || status === 403;
}

/** A cached member session ends only when the gateway rejects it or confirms the member no longer exists. */
export function isTerminalMemberSessionError(error: unknown): boolean {
  return error instanceof MemberSessionIdentityError
    || isAuthenticationRejection(error)
    || httpStatus(error) === 404;
}

interface ErrorPayload {
  error?: string;
  message?: string;
}

export const MAX_CLIENT_ERROR_LENGTH = 500;

export function safeClientErrorCopy(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const copy = value.trim();
  return copy.length > 0
    && copy.length <= MAX_CLIENT_ERROR_LENGTH
    && !/[\u0000-\u001F\u007F]/.test(copy)
    ? copy
    : null;
}

/** Extracts bounded API copy without leaking transport wording or unsafe controls. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (!axios.isAxiosError<ErrorPayload>(error)) {
    return error instanceof Error ? safeClientErrorCopy(error.message) ?? fallback : fallback;
  }
  return safeClientErrorCopy(error.response?.data?.error)
    ?? safeClientErrorCopy(error.response?.data?.message)
    ?? fallback;
}

/** A mutation may have reached the gateway when Axios received no response. */
export function isAmbiguousMutationFailure(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response === undefined;
}
