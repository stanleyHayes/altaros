import { AxiosError, AxiosHeaders } from 'axios';
import {
  apiErrorMessage,
  isAmbiguousMutationFailure,
  httpStatus,
  isAuthenticationRejection,
  isTerminalMemberSessionError,
  safeClientErrorCopy,
} from './api-error';

const responseError = (status: number) => new AxiosError(
  'Request failed',
  'ERR_BAD_RESPONSE',
  undefined,
  undefined,
  { status, statusText: '', headers: {}, config: { headers: new AxiosHeaders() }, data: {} },
);

describe('API error classification', () => {
  it('clears sessions only for authoritative authentication rejections', () => {
    expect(isAuthenticationRejection(responseError(401))).toBe(true);
    expect(isAuthenticationRejection(responseError(403))).toBe(true);
    expect(isAuthenticationRejection(responseError(500))).toBe(false);
    expect(isAuthenticationRejection(new AxiosError('Network Error', 'ERR_NETWORK'))).toBe(false);
  });

  it('does not invent a status for non-Axios failures', () => {
    expect(httpStatus(new Error('offline'))).toBeUndefined();
  });

  it('classifies only response-less Axios mutations as outcome-unknown', () => {
    expect(isAmbiguousMutationFailure(new AxiosError('timeout', 'ECONNABORTED'))).toBe(true);
    expect(isAmbiguousMutationFailure(new AxiosError('Network Error', 'ERR_NETWORK'))).toBe(true);
    expect(isAmbiguousMutationFailure(responseError(500))).toBe(false);
    expect(isAmbiguousMutationFailure(new Error('offline'))).toBe(false);
  });

  it('ends a cached member session only for an authoritative rejection or missing member', () => {
    expect(isTerminalMemberSessionError(responseError(401))).toBe(true);
    expect(isTerminalMemberSessionError(responseError(403))).toBe(true);
    expect(isTerminalMemberSessionError(responseError(404))).toBe(true);
    expect(isTerminalMemberSessionError(responseError(500))).toBe(false);
    expect(isTerminalMemberSessionError(new AxiosError('Network Error', 'ERR_NETWORK'))).toBe(false);
  });

  it('uses server-safe copy and falls back for transport failures', () => {
    const rejected = responseError(401);
    rejected.response!.data = { error: 'Invalid credentials' };
    expect(apiErrorMessage(rejected, 'Try again')).toBe('Invalid credentials');
    expect(apiErrorMessage(new AxiosError('Network Error', 'ERR_NETWORK'), 'Check your connection'))
      .toBe('Check your connection');
  });

  it('rejects control-bearing, oversized, empty, and non-string client copy', () => {
    expect(safeClientErrorCopy(' Try again ')).toBe('Try again');
    expect(safeClientErrorCopy('unsafe\nannouncement')).toBeNull();
    expect(safeClientErrorCopy('x'.repeat(501))).toBeNull();
    expect(safeClientErrorCopy('   ')).toBeNull();
    expect(safeClientErrorCopy({ message: 'not a string' })).toBeNull();

    const rejected = responseError(400);
    rejected.response!.data = { error: 'x'.repeat(501), message: 'fallback\ncontrol' };
    expect(apiErrorMessage(rejected, 'Safe fallback')).toBe('Safe fallback');
    expect(apiErrorMessage(new Error('unsafe\tcopy'), 'Safe fallback')).toBe('Safe fallback');
  });
});
