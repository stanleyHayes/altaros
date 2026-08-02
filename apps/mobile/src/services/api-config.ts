export const PRODUCTION_API_URL = 'https://api.altaros.com/api/v1';
const DEVELOPMENT_API_URL = 'http://localhost:8080/api/v1';

export function resolveApiBaseUrl(value: string | undefined, development: boolean): string {
  const candidate = value?.trim() || (development ? DEVELOPMENT_API_URL : PRODUCTION_API_URL);
  if (candidate.length > 2_048 || /[\u0000-\u001F\u007F]/.test(candidate)) {
    throw new Error('EXPO_PUBLIC_API_URL is not a valid gateway URL.');
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('EXPO_PUBLIC_API_URL is not a valid gateway URL.');
  }

  const path = url.pathname.replace(/\/+$/, '');
  const valid = (url.protocol === 'https:' || (development && url.protocol === 'http:'))
    && Boolean(url.hostname)
    && !url.username
    && !url.password
    && !url.search
    && !url.hash
    && path === '/api/v1';
  if (!valid) throw new Error('EXPO_PUBLIC_API_URL is not a valid gateway URL.');

  return `${url.origin}${path}`;
}
