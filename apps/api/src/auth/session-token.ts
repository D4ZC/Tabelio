import type { Request } from 'express';

export const SESSION_COOKIE_NAME = 'despacho_session';
export const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

export function extractSessionToken(request: Pick<Request, 'headers'>): string | undefined {
  const bearerToken = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearerToken) return bearerToken;

  const cookie = request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!cookie) return undefined;

  const value = cookie.slice(cookie.indexOf('=') + 1);
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}
