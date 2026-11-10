import { describe, expect, it } from 'vitest';
import { extractSessionToken, SESSION_COOKIE_NAME } from './session-token';

describe('extractSessionToken', () => {
  it('prefiere un token Bearer para clientes de API', () => {
    expect(extractSessionToken({
      headers: {
        authorization: 'Bearer api-token',
        cookie: `${SESSION_COOKIE_NAME}=cookie-token`,
      },
    })).toBe('api-token');
  });

  it('acepta la cookie HttpOnly de la sesión web', () => {
    expect(extractSessionToken({
      headers: { cookie: `theme=light; ${SESSION_COOKIE_NAME}=cookie-token; locale=es` },
    })).toBe('cookie-token');
  });

  it('ignora cookies de sesión mal codificadas', () => {
    expect(extractSessionToken({
      headers: { cookie: `${SESSION_COOKIE_NAME}=%E0%A4%A` },
    })).toBeUndefined();
  });
});
