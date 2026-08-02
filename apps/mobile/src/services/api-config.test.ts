import { PRODUCTION_API_URL, resolveApiBaseUrl } from './api-config';
import easConfig from '../../eas.json';

describe('mobile gateway configuration', () => {
  it('uses the canonical altaros.com origins by environment', () => {
    expect(resolveApiBaseUrl(undefined, false)).toBe(PRODUCTION_API_URL);
    expect(PRODUCTION_API_URL).toBe('https://api.altaros.com/api/v1');
    expect(resolveApiBaseUrl(undefined, true)).toBe('http://localhost:8080/api/v1');
  });

  it('pins every installable EAS profile to the canonical TLS gateway', () => {
    expect(easConfig.build.preview.env.EXPO_PUBLIC_API_URL).toBe(PRODUCTION_API_URL);
    expect(easConfig.build.production.env.EXPO_PUBLIC_API_URL).toBe(PRODUCTION_API_URL);
    expect(easConfig.build['preview-simulator'].extends).toBe('preview');
  });

  it('canonicalizes a valid explicit gateway URL', () => {
    expect(resolveApiBaseUrl(' https://staging.altaros.com/api/v1/ ', false))
      .toBe('https://staging.altaros.com/api/v1');
    expect(resolveApiBaseUrl('http://192.168.1.20:8080/api/v1', true))
      .toBe('http://192.168.1.20:8080/api/v1');
  });

  it.each([
    'http://api.altaros.com/api/v1',
    'https://user:secret@api.altaros.com/api/v1',
    'https://api.altaros.com',
    'https://api.altaros.com/api/v2',
    'https://api.altaros.com/api/v1?tenant=other',
    'https://api.altaros.com/api/v1#fragment',
    'not-a-url',
  ])('rejects an unsafe or misrouted production gateway %s', (value) => {
    expect(() => resolveApiBaseUrl(value, false)).toThrow('not a valid gateway URL');
  });
});
