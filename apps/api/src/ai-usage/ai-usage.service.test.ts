import { ConfigService } from '@nestjs/config';
import { Prisma } from '@despacho/database';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { PrismaService } from '../prisma/prisma.service';
import { AiUsageService } from './ai-usage.service';

const user: AuthenticatedUser = {
  userId: 'user-1', organizationId: 'org-1', membershipId: 'member-1',
  email: 'test@example.test', displayName: 'Test', organizationName: 'Test Org', role: 'ADMIN',
};

function setup(config: Record<string, unknown> = {}) {
  let operationCount = 0;
  const prisma = {
    aiConversation: { create: vi.fn(), findFirst: vi.fn().mockResolvedValue({ id: 'chat-1' }) },
    aiOperation: {
      create: vi.fn().mockImplementation(() => Promise.resolve({ id: `op-${++operationCount}` })),
      update: vi.fn().mockResolvedValue({}), findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]),
    },
    aiUsageAttempt: {
      create: vi.fn().mockResolvedValue({ id: 'attempt-1' }), updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirst: vi.fn().mockResolvedValue({ model: 'test-model', createdAt: new Date('2026-11-02T12:00:00Z') }),
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]), aggregate: vi.fn().mockResolvedValue({ _min: { createdAt: null } }),
    },
  };
  const service = new AiUsageService(prisma as unknown as PrismaService, new ConfigService(config));
  return { service, prisma };
}

describe('registro de consumo de IA', () => {
  it('valida conversación por organización y usuario antes de crear una operación', async () => {
    const { service, prisma } = setup();
    prisma.aiConversation.findFirst.mockResolvedValue(null);
    const callback = vi.fn();
    await expect(service.runOperation(user, {
      conversationId: 'foreign-chat', kind: 'CHAT', label: 'Responder',
    }, callback)).rejects.toThrow('No se encontró la conversación.');
    expect(prisma.aiConversation.findFirst).toHaveBeenCalledWith({
      where: { id: 'foreign-chat', organizationId: 'org-1', userId: 'user-1' }, select: { id: true },
    });
    expect(prisma.aiOperation.create).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
  });

  it('una extracción anidada hereda el chat sin perder su costo directo separado', async () => {
    const { service, prisma } = setup();
    const result = await service.runOperation(user, { conversationId: 'chat-1', kind: 'CHAT', label: 'Responder' }, async () => (
      service.runOperation(user, { kind: 'EXTRACTION', label: 'Leer documento' }, async () => {
        expect(service.currentContext()).toMatchObject({ conversationId: 'chat-1', operationId: 'op-2' });
        return service.startAttempt('requested-model');
      })
    ));
    expect(result).toBe('attempt-1');
    expect(prisma.aiOperation.create.mock.calls[1][0].data).toMatchObject({ parentId: 'op-1', conversationId: 'chat-1' });
    expect(prisma.aiUsageAttempt.create).toHaveBeenCalledWith({
      data: { organizationId: 'org-1', userId: 'user-1', operationId: 'op-2', model: 'requested-model' }, select: { id: true },
    });
    expect(service.currentContext()).toBeUndefined();
  });

  it('rehidrata contexto entre fronteras HTTP sólo para el mismo principal', async () => {
    const { service, prisma } = setup();
    prisma.aiOperation.findFirst.mockResolvedValue({ id: 'op-original', conversationId: 'chat-original' });
    await service.resumeContext(user, 'op-original', async () => {
      expect(service.currentContext()).toMatchObject({ operationId: 'op-original', conversationId: 'chat-original' });
    });
    expect(prisma.aiOperation.findFirst.mock.calls[0][0].where).toEqual({
      id: 'op-original', organizationId: 'org-1', userId: 'user-1',
    });
    prisma.aiOperation.findFirst.mockResolvedValue(null);
    await expect(service.resumeContext(user, 'foreign', vi.fn())).rejects.toThrow('No se encontró la operación de IA.');
  });

  it('no inicia llamadas facturables sin un registro durable', async () => {
    const { service, prisma } = setup();
    prisma.aiUsageAttempt.create.mockRejectedValue(new Error('database unavailable'));
    await expect(service.runOperation(user, { kind: 'CHAT', label: 'Responder' }, async () => {
      await service.startAttempt('model');
    })).rejects.toThrow('No fue posible registrar el consumo de IA.');
    expect(prisma.aiOperation.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }));
    expect(service.currentContext()).toBeUndefined();
    await expect(service.startAttempt('outside-context')).rejects.toThrow('No hay un contexto autorizado');
  });

  it('mantiene separado el consumo de usuarios que trabajan concurrentemente', async () => {
    const { service, prisma } = setup();
    const otherUser = { ...user, userId: 'user-2', organizationId: 'org-2' };
    await Promise.all([user, otherUser].map((principal) => (
      service.runOperation(principal, { kind: 'CHAT', label: 'Responder' }, async () => {
        await Promise.resolve();
        expect(service.currentContext()?.userId).toBe(principal.userId);
        await service.startAttempt('model');
      })
    )));
    expect(prisma.aiUsageAttempt.create.mock.calls.map(([options]) => options.data)).toEqual([
      expect.objectContaining({ organizationId: 'org-1', userId: 'user-1' }),
      expect.objectContaining({ organizationId: 'org-2', userId: 'user-2' }),
    ]);
  });

  it('captura usage antes de validar la salida, pero no inventa moneda o costo', async () => {
    const { service, prisma } = setup();
    await service.finishAttempt('attempt-1', {
      payload: { id: 'resp-1', model: 'effective-model', cost: 12, usage: { input_tokens: 42, output_tokens: 6 } },
      responseHeaders: new Headers({ 'x-request-id': 'req-1', 'x-response-cost': '12' }), httpStatus: 200,
    });
    expect(prisma.aiUsageAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: 'attempt-1', state: 'STARTED' },
      data: expect.objectContaining({ inputTokens: 42, outputTokens: 6, model: 'effective-model', state: 'PENDING', providerRequestId: 'req-1' }),
    });
    expect(prisma.aiUsageAttempt.updateMany.mock.calls[0][0].data).not.toHaveProperty('confirmedCost');
  });

  it('acepta sólo costos explícitos con moneda verificada y no reemplaza un intento finalizado', async () => {
    const { service, prisma } = setup({ AI_USAGE_PROVIDER_COST_CURRENCY: 'USD', AI_USAGE_PROVIDER_COST_HEADER: 'x-response-cost' });
    await service.finishAttempt('attempt-1', {
      payload: {}, responseHeaders: new Headers({ 'x-response-cost': '0.0000001' }),
    });
    const update = prisma.aiUsageAttempt.updateMany.mock.calls[0][0];
    expect(update.where).toEqual({ id: 'attempt-1', state: 'STARTED' });
    expect(update.data.confirmedCost.toFixed()).toBe('0.0000001');
    expect(update.data).toMatchObject({ currency: 'USD', state: 'CONFIRMED' });
    await service.failAttempt('attempt-1');
    expect(prisma.aiUsageAttempt.updateMany.mock.calls[1][0].where).toEqual({ id: 'attempt-1', state: 'STARTED' });
  });

  it('consulta agregados personales con filtros de identidad y limita detalle a100 operaciones', async () => {
    const { service, prisma } = setup();
    const summary = await service.summary(user, 'chat-1');
    expect(prisma.aiUsageAttempt.groupBy.mock.calls[0][0]).toMatchObject({ where: { organizationId: 'org-1', userId: 'user-1' } });
    expect(prisma.aiUsageAttempt.groupBy.mock.calls[1][0].where).toEqual({
      organizationId: 'org-1', userId: 'user-1', operation: { conversationId: 'chat-1' },
    });
    expect(prisma.aiOperation.findMany.mock.calls[0][0]).toMatchObject({ take: 100, where: { conversationId: 'chat-1', userId: 'user-1', organizationId: 'org-1' } });
    expect(summary.budget.status).toBe('unavailable');
    expect(summary.latestOperation).toBeNull();
  });

  it('devuelve la última operación personal sin conversación aunque se consulte el historial de otro chat', async () => {
    const { service, prisma } = setup();
    const inChat = { id: 'op-chat', kind: 'CHAT', label: 'Responder', status: 'COMPLETED', createdAt: new Date('2026-11-02T12:00:00Z'), parentId: null };
    const standalone = { id: 'op-insight', kind: 'INSIGHT_SUMMARY', label: 'Resumen de expediente con IA', status: 'COMPLETED', createdAt: new Date('2026-11-02T12:01:00Z'), parentId: null };
    prisma.aiOperation.findMany.mockResolvedValue([inChat]);
    prisma.aiOperation.findFirst.mockResolvedValue(standalone);
    const cost = (amount: string, inputTokens: number, outputTokens: number) => ({
      confirmedCost: new Prisma.Decimal(amount), estimatedCost: null, inputTokens, outputTokens,
    });
    prisma.aiUsageAttempt.groupBy.mockImplementation(async ({ by, where }) => by.includes('operationId') ? [
      { operationId: inChat.id, state: 'CONFIRMED', currency: 'USD', _count: 1, _sum: cost('0.001', 100, 20) },
      { operationId: standalone.id, state: 'CONFIRMED', currency: 'USD', _count: 1, _sum: cost('0.002', 200, 40) },
    ] : [{ state: 'CONFIRMED', currency: 'USD', _count: where.operation ? 1 : 2,
      _sum: where.operation ? cost('0.001', 100, 20) : cost('0.003', 300, 60) }]);
    const result = await service.summary(user, 'chat-1');
    expect(prisma.aiOperation.findFirst).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', userId: 'user-1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, kind: true, label: true, status: true, createdAt: true, parentId: true },
    });
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toMatchObject({ id: inChat.id, total: { amount: '0.001', inputTokens: 100, outputTokens: 20 } });
    expect(result.latestOperation).toMatchObject({
      id: standalone.id, kind: 'INSIGHT_SUMMARY', createdAt: '2026-11-02T12:01:00.000Z',
      total: { amount: '0.002', currency: 'USD', requestCount: 1, inputTokens: 200, outputTokens: 40 },
    });
    expect(result.conversation).toMatchObject({ requestCount: 1, amount: '0.001', inputTokens: 100, outputTokens: 20 });
    expect(result.personal).toMatchObject({ requestCount: 2, amount: '0.003', inputTokens: 300, outputTokens: 60 });
    expect(prisma.aiUsageAttempt.groupBy.mock.calls[2][0].where).toEqual({
      organizationId: 'org-1', userId: 'user-1', operationId: { in: [inChat.id, standalone.id] },
    });
  });

  it('agrega una sola vez el id cuando la última operación también pertenece al historial del chat', async () => {
    const { service, prisma } = setup();
    const operation = { id: 'op-shared', kind: 'CHAT', label: 'Responder', status: 'COMPLETED', createdAt: new Date('2026-11-02T12:00:00Z'), parentId: null };
    prisma.aiOperation.findMany.mockResolvedValue([operation]);
    prisma.aiOperation.findFirst.mockResolvedValue(operation);
    prisma.aiUsageAttempt.groupBy.mockImplementation(async ({ by }) => by.includes('operationId') ? [{
      operationId: operation.id, state: 'PENDING', currency: null, _count: 1,
      _sum: { confirmedCost: null, estimatedCost: null, inputTokens: 30, outputTokens: 10 },
    }] : []);
    const result = await service.summary(user, 'chat-1');
    expect(prisma.aiUsageAttempt.groupBy.mock.calls[2][0].where.operationId.in).toEqual([operation.id]);
    expect(result.latestOperation).toEqual(result.operations[0]);
    expect(result.latestOperation?.total).toMatchObject({ requestCount: 1, pendingCount: 1, amount: null });
  });

  it('ofrece latestOperation sin abrir un chat y mantiene filtros personales en todas las consultas', async () => {
    const { service, prisma } = setup();
    const latest = { id: 'own-operation', kind: 'INSIGHT_COMPARISON', label: 'Comparación explicada con IA', status: 'FAILED', createdAt: new Date('2026-11-02T12:00:00Z'), parentId: null };
    prisma.aiOperation.findFirst.mockImplementation(async ({ where }) => (
      where.organizationId === user.organizationId && where.userId === user.userId ? latest : null
    ));
    const own = await service.summary(user);
    expect(own.latestOperation?.id).toBe(latest.id);
    expect(own.operations).toEqual([]);
    expect(own.conversation).toMatchObject({ requestCount: 0, amount: '0' });
    expect(prisma.aiOperation.findMany).not.toHaveBeenCalled();
    expect(prisma.aiConversation.findFirst).not.toHaveBeenCalled();
    const otherUser = await service.summary({ ...user, userId: 'user-2' });
    const otherOrganization = await service.summary({ ...user, organizationId: 'org-2' });
    expect(otherUser.latestOperation).toBeNull();
    expect(otherOrganization.latestOperation).toBeNull();
    expect(prisma.aiOperation.findFirst.mock.calls.map(([query]) => query.where)).toEqual([
      { organizationId: 'org-1', userId: 'user-1' }, { organizationId: 'org-1', userId: 'user-2' }, { organizationId: 'org-2', userId: 'user-1' },
    ]);
    expect(prisma.aiUsageAttempt.groupBy.mock.calls.filter(([query]) => query.by.includes('operationId')).map(([query]) => query.where)).toEqual([
      { organizationId: 'org-1', userId: 'user-1', operationId: { in: [latest.id] } },
    ]);
  });
});

describe('estimación integrada con el registro de consumo', () => {
  // These are deliberately synthetic and must never be used as provider prices.
  const tariff = {
    version: 'synthetic-reference-v1', currency: 'USD', inputPerMillion: '2', outputPerMillion: '8',
    sourceUrl: 'https://pricing.example.test/fixture',
  };
  const config = (overrides: Record<string, unknown> = {}) => ({
    ASSISTANT_MODEL: 'test-model', AI_USAGE_PRICING_JSON: JSON.stringify({ 'test-model': { ...tariff, ...overrides } }),
  });
  const usage = { input_tokens: 715, output_tokens: 397, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 255 } };
  const historical = {
    id: 'pending-1', model: 'test-model', createdAt: new Date('2026-11-02T12:00:00Z'),
    inputTokens: 715, outputTokens: 397, cachedInputTokens: 0, reasoningTokens: 255,
  };

  it('registra estimación y snapshot versionado cuando el proveedor no da costo', async () => {
    const { service, prisma } = setup(config());
    await service.finishAttempt('attempt-1', { payload: { model: 'test-model', usage } });
    const update = prisma.aiUsageAttempt.updateMany.mock.calls[0][0];
    expect(update.data).toMatchObject({ state: 'ESTIMATED', currency: 'USD', costSource: 'tariff:synthetic-reference-v1' });
    expect(update.data.estimatedCost.toFixed()).toBe('0.004606');
    expect(update.data.confirmedCost).toBeNull();
    expect(update.data.pricingSnapshotJson).toMatchObject({ inputPerMillion: '2', outputPerMillion: '8', reasoningIncludedInOutput: true });
  });

  it('prioriza el costo informado por proveedor incluso en Advantage Credits', async () => {
    const { service, prisma } = setup({ ...config(), AI_USAGE_PROVIDER_COST_CURRENCY: 'Advantage Credits', AI_USAGE_PROVIDER_COST_HEADER: 'x-cost' });
    await service.finishAttempt('attempt-1', { payload: { model: 'test-model', usage }, responseHeaders: new Headers({ 'x-cost': '0.123' }) });
    const update = prisma.aiUsageAttempt.updateMany.mock.calls[0][0].data;
    expect(update).toMatchObject({ state: 'CONFIRMED', currency: 'Advantage Credits' });
    expect(update.confirmedCost.toFixed()).toBe('0.123');
    expect(update).not.toHaveProperty('pricingSnapshotJson');
    expect(prisma.aiUsageAttempt.findFirst).not.toHaveBeenCalled();
  });

  it('conserva pendiente un modelo efectivo distinto, usage incompleto o precio bajo la escala DB', async () => {
    const { service, prisma } = setup(config());
    await service.finishAttempt('attempt-1', { payload: { model: 'unknown-model', usage } });
    await service.finishAttempt('attempt-2', { payload: { model: 'test-model', usage: { input_tokens: 100 } } });
    await service.finishAttempt('attempt-3', { payload: {}, cost: { amount: '1e-100', currency: 'USD', source: 'provider' } });
    for (const [update] of prisma.aiUsageAttempt.updateMany.mock.calls) expect(update.data.state).toBe('PENDING');
  });

  it('summary distingue configuración ausente y referencia orientativa sin exponer tasas', async () => {
    const noPricing = await setup().service.summary(user);
    expect(noPricing.pricing.status).toBe('unconfigured');
    const reference = await setup(config()).service.summary(user);
    expect(reference.pricing.status).toBe('configured');
    expect(reference.pricing.message).toContain('Tarifa de referencia por 1M tokens');
    expect(reference.pricing.message).toContain('USD');
    expect(reference.pricing.message).toContain('no representan el cargo definitivo de IBM');
    expect(reference.pricing).not.toHaveProperty('inputPerMillion');
    const header = await setup({ AI_USAGE_PROVIDER_COST_CURRENCY: 'USD', AI_USAGE_PROVIDER_COST_HEADER: 'x-cost' }).service.summary(user);
    expect(header.pricing.status).toBe('configured');
  });

  it('no altera históricos sin una fecha inicial de vigencia explícita', async () => {
    const { service, prisma } = setup(config());
    prisma.aiUsageAttempt.findMany.mockResolvedValue([historical]);
    expect(await service.estimatePending(user)).toMatchObject({ examined: 1, updated: 0, skipped: 1 });
    expect(prisma.aiUsageAttempt.updateMany).not.toHaveBeenCalled();
  });

  it('permite revisar y después valorar históricos con scope e idempotencia sin repetir IA', async () => {
    const { service, prisma } = setup(config({ effectiveFrom: '2026-11-02', effectiveTo: '2026-11-03' }));
    prisma.aiUsageAttempt.findMany.mockResolvedValue([historical]);
    const preview = await service.estimatePending(user, { dryRun: true });
    expect(preview.estimates[0]).toMatchObject({ amount: '0.004606', applied: false });
    expect(prisma.aiUsageAttempt.updateMany).not.toHaveBeenCalled();
    await service.estimatePending(user);
    expect(prisma.aiUsageAttempt.findMany.mock.calls[0][0].where).toMatchObject({ userId: 'user-1', organizationId: 'org-1', state: 'PENDING' });
    expect(prisma.aiUsageAttempt.updateMany.mock.calls[0][0].where).toEqual({
      id: 'pending-1', userId: 'user-1', organizationId: 'org-1', state: 'PENDING', confirmedCost: null, estimatedCost: null,
    });
    prisma.aiUsageAttempt.updateMany.mockResolvedValue({ count: 0 });
    expect((await service.estimatePending(user)).updated).toBe(0);
  });

  it('expone cursor para avanzar aunque una página contenga consumos sin tarifa', async () => {
    const { service, prisma } = setup(config({ effectiveFrom: '2026-11-02' }));
    prisma.aiUsageAttempt.findMany.mockResolvedValue([{ ...historical, model: 'unknown-model' }]);
    const skipped = await service.estimatePending(user, { limit: 1 });
    expect(skipped.nextCursor).toBe('pending-1');
    prisma.aiUsageAttempt.findFirst.mockResolvedValue({ id: historical.id, createdAt: historical.createdAt });
    prisma.aiUsageAttempt.findMany.mockResolvedValue([]);
    await service.estimatePending(user, { afterId: skipped.nextCursor! });
    expect(prisma.aiUsageAttempt.findMany.mock.calls[1][0].where.OR).toEqual([
      { createdAt: { gt: historical.createdAt } }, { createdAt: historical.createdAt, id: { gt: historical.id } },
    ]);
  });
});
