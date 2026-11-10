import { AsyncLocalStorage } from 'node:async_hooks';
import { MembershipRole } from '@despacho/database';
import { ConfigService } from '@nestjs/config';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { defer, lastValueFrom, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.types';
import { UsageCorrelationService, USAGE_CONTEXT_HEADER } from './usage-correlation.service';
import { UsageCorrelationInterceptor } from './usage-correlation.interceptor';
import { AiUsageController } from './ai-usage.controller';
import { buildMcpOperationCatalog } from '../mcp/operation-catalog';

const user: AuthenticatedUser = {
  userId: 'person-1', organizationId: 'org-1', membershipId: 'member-1', role: MembershipRole.ADMIN,
  email: 'test@example.test', displayName: 'Persona de prueba', organizationName: 'Organización de prueba',
};
const origin = { operationId: 'operation-1', organizationId: 'org-1', userId: 'person-1', conversationId: 'conversation-1' };

function signer(context: typeof origin | undefined = origin) {
  const usage = { currentContext: vi.fn(() => context) };
  const correlation = new UsageCorrelationService(usage as never, new ConfigService({
    JWT_SECRET: 'test-signing-secret-only-abcdefghijklmnopqrstuvwxyz',
  }));
  return { correlation, usage };
}

function execution(header: string | string[] | undefined, address = '127.0.0.1', actor: AuthenticatedUser | undefined = user) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: { [USAGE_CONTEXT_HEADER]: header }, socket: { remoteAddress: address }, user: actor }) }),
  } as unknown as ExecutionContext;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('firma y alcance del contexto de consumo', () => {
  it('mantiene presupuesto y creación de conversaciones fuera del catálogo de herramientas del modelo', () => {
    expect(buildMcpOperationCatalog([{ metatype: AiUsageController }])).toEqual([]);
  });

  it('transporta sólo el identificador del registro y liga su firma a la identidad autenticada', () => {
    const { correlation } = signer();
    const header = correlation.headerForCurrentContext()!;
    expect(correlation.verifyHeader(header, user)).toBe(origin.operationId);
    const payload = JSON.parse(Buffer.from(header.split('.')[0], 'base64url').toString());
    expect(payload).toMatchObject({ operationId: origin.operationId, organizationId: user.organizationId, userId: user.userId });
    expect(payload).not.toHaveProperty('conversationId');
    expect(payload).not.toHaveProperty('email');
    for (const identity of [{ ...user, userId: 'another-person' }, { ...user, organizationId: 'another-org' }]) {
      expect(() => correlation.verifyHeader(header, identity)).toThrow('no es válido');
    }
  });

  it('rechaza la manipulación de operación o firma', () => {
    const { correlation } = signer();
    const header = correlation.headerForCurrentContext()!;
    const [payload, signature] = header.split('.');
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const tampered = Buffer.from(JSON.stringify({ ...value, operationId: 'another-operation' })).toString('base64url');
    expect(() => correlation.verifyHeader(`${tampered}.${signature}`, user)).toThrow('no es válido');
    expect(() => correlation.verifyHeader(`${payload}.AAAA`, user)).toThrow('no es válido');
  });

  it('rechaza firmas vencidas y emitidas en el futuro', () => {
    vi.useFakeTimers();
    const now = new Date('2026-11-02T13:00:00Z');
    vi.setSystemTime(now);
    const { correlation } = signer();
    const header = correlation.headerForCurrentContext()!;
    vi.setSystemTime(now.getTime() + 5 * 60_000 + 1);
    expect(() => correlation.verifyHeader(header, user)).toThrow('no es válido');
    const future = correlation.headerForCurrentContext()!;
    vi.setSystemTime(now);
    expect(() => correlation.verifyHeader(future, user)).toThrow('no es válido');
  });

  it.each([
    ['vacío', ''], ['sin datos', '.'], ['segmento adicional', 'a.b.c'],
    ['firma inválida', 'a.b'], ['demasiado largo', 'a'.repeat(2049)],
  ])('rechaza el formato inválido sin revelar detalles: %s', (_name, header) => {
    const { correlation } = signer();
    expect(() => correlation.verifyHeader(header, user)).toThrow('no es válido');
  });

  it('no emite un encabezado cuando la petición no está dentro de una operación', () => {
    const usage = { currentContext: vi.fn().mockReturnValue(undefined) };
    const withoutContext = new UsageCorrelationService(usage as never, new ConfigService({}));
    expect(withoutContext.headerForCurrentContext()).toBeUndefined();
  });
});

describe('propagación del contexto a la suscripción Nest/RxJS', () => {
  it('suscribe dentro de AsyncLocalStorage y limpia el contexto al terminar', async () => {
    const local = new AsyncLocalStorage<typeof origin>();
    const { correlation } = signer();
    const header = correlation.headerForCurrentContext()!;
    const usage = {
      resumeContext: vi.fn(async (_user: AuthenticatedUser, _id: string, callback: () => Promise<unknown>) => {
        await Promise.resolve();
        return local.run(origin, callback);
      }),
    };
    const observed: unknown[] = [];
    const next: CallHandler = {
      handle: vi.fn(() => defer(() => {
        observed.push(local.getStore());
        return of({ result: 'attributed' });
      })),
    };
    const interceptor = new UsageCorrelationInterceptor(usage as never, correlation);
    const result = interceptor.intercept(execution(header), next);
    expect(usage.resumeContext).not.toHaveBeenCalled();
    expect(local.getStore()).toBeUndefined();
    await expect(lastValueFrom(result)).resolves.toEqual({ result: 'attributed' });
    expect(usage.resumeContext).toHaveBeenCalledWith(user, origin.operationId, expect.any(Function));
    expect(observed).toEqual([origin]);
    expect(local.getStore()).toBeUndefined();
  });

  it('propaga errores del controlador conservando el alcance del contexto', async () => {
    const local = new AsyncLocalStorage<typeof origin>();
    const { correlation } = signer();
    const usage = { resumeContext: vi.fn(async (_user, _id, callback: () => Promise<unknown>) => local.run(origin, callback)) };
    const interceptor = new UsageCorrelationInterceptor(usage as never, correlation);
    let seen: unknown;
    const next = { handle: () => defer(() => {
      seen = local.getStore();
      return throwError(() => new Error('operación rechazada'));
    }) };
    await expect(lastValueFrom(interceptor.intercept(execution(correlation.headerForCurrentContext()), next)))
      .rejects.toThrow('operación rechazada');
    expect(seen).toEqual(origin);
    expect(local.getStore()).toBeUndefined();
  });

  it.each(['203.0.113.10', '::ffff:203.0.113.10', ''])('rechaza atribución desde una conexión externa %s', (address) => {
    const { correlation } = signer();
    const verify = vi.spyOn(correlation, 'verifyHeader');
    const usage = { resumeContext: vi.fn() };
    const next = { handle: vi.fn() };
    const interceptor = new UsageCorrelationInterceptor(usage as never, correlation);
    expect(() => interceptor.intercept(execution(correlation.headerForCurrentContext(), address), next)).toThrow('internas autenticadas');
    expect(next.handle).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
    expect(usage.resumeContext).not.toHaveBeenCalled();
  });

  it('rechaza encabezados duplicados y solicitudes sin identidad', () => {
    const { correlation } = signer();
    const header = correlation.headerForCurrentContext()!;
    const interceptor = new UsageCorrelationInterceptor({} as never, correlation);
    expect(() => interceptor.intercept(execution([header, header]), { handle: vi.fn() })).toThrow('internas autenticadas');
    const unauthenticated = {
      switchToHttp: () => ({ getRequest: () => ({ headers: { [USAGE_CONTEXT_HEADER]: header }, socket: { remoteAddress: '::1' } }) }),
    } as unknown as ExecutionContext;
    expect(() => interceptor.intercept(unauthenticated, { handle: vi.fn() })).toThrow('internas autenticadas');
  });

  it('una petición sin encabezado mantiene el flujo normal sin reanudar una operación', async () => {
    const { correlation } = signer();
    const usage = { resumeContext: vi.fn() };
    const source = of({ ok: true });
    const next = { handle: vi.fn(() => source) };
    const interceptor = new UsageCorrelationInterceptor(usage as never, correlation);
    expect(interceptor.intercept(execution(undefined), next)).toBe(source);
    expect(usage.resumeContext).not.toHaveBeenCalled();
    await expect(lastValueFrom(source)).resolves.toEqual({ ok: true });
  });
});
