import { signalUrl } from './live-connection';

/**
 * The signalling URL.
 *
 * Two things have to be right or live streaming does not work at all, and both
 * fail silently: the scheme has to become ws/wss, and the grant has to survive
 * being put in a query string.
 */

describe('signalUrl', () => {
  /**
   * React Native's URL has a READ-ONLY protocol. Assigning to it does nothing
   * and throws no error, so the socket would be opened over http and simply
   * fail to upgrade — with nothing anywhere to explain why.
   */
  it('upgrades the scheme to a websocket one', () => {
    expect(signalUrl('https://api.altaros.com', 'tok')).toMatch(/^wss:/);
    expect(signalUrl('http://localhost:8080', 'tok')).toMatch(/^ws:/);
  });

  it('keeps the host and port', () => {
    expect(signalUrl('http://localhost:8080', 'tok')).toContain('localhost:8080');
  });

  it('points at the signalling endpoint', () => {
    expect(signalUrl('https://api.altaros.com', 'tok')).toContain('/api/v1/live/signal');
  });

  /**
   * A grant is base64url with a dot separator, and it is signed — a single
   * character mangled in transit makes it verify as a forgery, which surfaces
   * as "please rejoin" on a credential that was perfectly good.
   */
  it('carries the grant intact', () => {
    const grant = 'eyJyb29tIjoiYWJjIn0.c2lnbmF0dXJlLXdpdGgtXy1hbmQtLQ';
    const url = signalUrl('https://api.altaros.com', grant);
    expect(new URL(url.replace(/^wss:/, 'https:')).searchParams.get('grant')).toBe(grant);
  });

  it('escapes a grant containing url-significant characters', () => {
    const grant = 'a+b/c=d&e';
    const url = signalUrl('https://api.altaros.com', grant);
    expect(url).not.toContain('&e=');
    expect(new URL(url.replace(/^wss:/, 'https:')).searchParams.get('grant')).toBe(grant);
  });

  /** The base already carrying a path must not swallow the endpoint. */
  it('ignores a path on the base url', () => {
    expect(signalUrl('https://api.altaros.com/api/v1', 'tok')).toContain('/api/v1/live/signal');
  });
});
