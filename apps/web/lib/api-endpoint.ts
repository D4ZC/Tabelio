const DEFAULT_API_TARGET = 'http://127.0.0.1:4000/api';

/** Keep local API traffic on the page origin, including LAN and HTTPS sessions. */
export function browserApiEndpoint(configured?: string) {
  if (!configured || configured.startsWith('/')) return configured?.replace(/\/$/, '') || '/api';
  try {
    const target = new URL(configured);
    if (['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) return '/api';
    return configured.replace(/\/$/, '');
  } catch {
    return '/api';
  }
}

/** Server-only destination for the same-origin API proxy. Never sent to the phone. */
export function apiProxyTarget(configured?: string) {
  try {
    const target = new URL(configured || DEFAULT_API_TARGET);
    if (!['http:', 'https:'].includes(target.protocol)) return DEFAULT_API_TARGET;
    return target.toString().replace(/\/$/, '');
  } catch {
    return DEFAULT_API_TARGET;
  }
}
