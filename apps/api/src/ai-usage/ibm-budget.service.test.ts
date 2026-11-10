import { ConfigService } from '@nestjs/config';
import { Prisma } from '@despacho/database';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { PrismaService } from '../prisma/prisma.service';
import { IbmBudgetService } from './ibm-budget.service';

const user: AuthenticatedUser = {
  userId: 'budget-user', organizationId: 'budget-org', membershipId: 'budget-member',
  email: 'owner@example.test', displayName: 'Owner', organizationName: 'Test', role: 'ADMIN',
};

const verifiedConfig = {
  ICA_BUDGET_URL: 'https://api.servicesessentials.ibm.com/verified-fixture-budget',
  ICA_BUDGET_OWNER_EMAIL: 'owner@example.test', ICA_BUDGET_SCOPE: 'individual',
  ICA_BUDGET_AUTH_MODE: 'api_key',
  ASSISTANT_API_KEY: 'fixture-credential', ICA_BUDGET_CURRENCY_PATH: 'budget.unit',
  ICA_BUDGET_LIMIT_PATH: 'budget.limit', ICA_BUDGET_SPENT_PATH: 'budget.spent',
  ICA_BUDGET_CACHE_SECONDS: '60',
};

function setup(overrides: Record<string, unknown> = {}, previous: Record<string, unknown> | null = null) {
  const prisma = {
    aiBudgetSnapshot: {
      findFirst: vi.fn().mockResolvedValue(previous),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
  const config = new ConfigService({ ...verifiedConfig, ...overrides });
  const service = new IbmBudgetService(prisma as unknown as PrismaService, config);
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ budget: { unit: 'USD', limit: '20', spent: '3' } }));
  vi.stubGlobal('fetch', fetchMock);
  return { service, prisma, config, fetchMock };
}

function snapshot(age = 90_000) {
  return {
    scope: 'individual', currency: 'USD', limit: new Prisma.Decimal('20'),
    spent: new Prisma.Decimal('3'), remaining: new Prisma.Decimal('17'), updatedAt: new Date(Date.now() - age),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('presupuesto IBM mediante contrato configurado', () => {
  it('no adivina endpoint, alcance o identidad personal a partir de una clave compartida', async () => {
    for (const override of [
      { ICA_BUDGET_URL: '' }, { ICA_BUDGET_OWNER_EMAIL: '' },
      { ICA_BUDGET_OWNER_EMAIL: 'different@example.test' }, { ICA_BUDGET_SCOPE: '' },
      { ICA_BUDGET_SCOPE: 'organization' },
      { ICA_BUDGET_LIMIT_PATH: '', ICA_BUDGET_SPENT_PATH: '' },
    ]) {
      const { service, prisma, fetchMock } = setup(override);
      expect((await service.getBudget(user)).status).toBe('unavailable');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(prisma.aiBudgetSnapshot.findFirst).not.toHaveBeenCalled();
    }
  });

  it.each([
    'http://api.servicesessentials.ibm.com/budget',
    'https://unrelated.example.test/budget',
    'https://api.servicesessentials.ibm.com.evil.example.test/budget',
    'https://username:password@api.servicesessentials.ibm.com/budget',
    'https://api.servicesessentials.ibm.com:8443/budget',
    'https://api.servicesessentials.ibm.com/budget#fragment',
  ])('rechaza una URL fuera de HTTPS y dominios permitidos sin transmitir credenciales: %s', async (url) => {
    const { service, fetchMock } = setup({ ICA_BUDGET_URL: url });
    expect((await service.getBudget(user)).status).toBe('unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('conserva precisión decimal, calcula saldo y persiste únicamente los datos permitidos', async () => {
    const { service, prisma, fetchMock } = setup({ ICA_BUDGET_OWNER_EMAIL: ' OWNER@EXAMPLE.TEST ' });
    fetchMock.mockResolvedValue(Response.json({
      budget: { unit: 'USD', limit: '10.000000000001', spent: '0.000000000002' },
      privateExtra: 'must-not-persist',
    }));
    const result = await service.getBudget(user);
    expect(result).toMatchObject({
      status: 'available', scope: 'individual', currency: 'USD',
      limit: '10.000000000001', spent: '0.000000000002', remaining: '9.999999999999',
    });
    expect(fetchMock).toHaveBeenCalledWith(verifiedConfig.ICA_BUDGET_URL, expect.objectContaining({
      method: 'GET', redirect: 'error', signal: expect.any(AbortSignal),
    }));
    const persisted = prisma.aiBudgetSnapshot.upsert.mock.calls[0][0];
    expect(persisted.create).toMatchObject({ organizationId: user.organizationId, userId: user.userId });
    expect(persisted.create.limit.toFixed()).toBe('10.000000000001');
    expect(persisted.create.spent.toFixed()).toBe('0.000000000002');
    expect(persisted.create.remaining.toFixed()).toBe('9.999999999999');
    expect(JSON.stringify(persisted)).not.toContain('fixture-credential');
    expect(JSON.stringify(persisted)).not.toContain('must-not-persist');
    expect(JSON.stringify(result)).not.toContain('fixture-credential');
    expect(JSON.stringify(result)).not.toContain(verifiedConfig.ICA_BUDGET_URL);
  });

  it('declara el saldo compartido y permite saldo negativo informado sin inventar moneda', async () => {
    const { service, fetchMock } = setup({ ICA_BUDGET_SCOPE: 'shared', ICA_BUDGET_REMAINING_PATH: 'budget.remaining' });
    fetchMock.mockResolvedValue(Response.json({ budget: { unit: 'CREDITS', limit: '5', spent: '7', remaining: '-2' } }));
    expect(await service.getBudget(user)).toMatchObject({
      scope: 'shared', currency: 'CREDITS', remaining: '-2', message: 'Saldo de la cuenta compartida de IBM.',
    });
  });

  it('reutiliza un snapshot reciente con filtro de usuario, organización y configuración', async () => {
    const { service, prisma, fetchMock } = setup({}, snapshot(1_000));
    expect((await service.getBudget(user)).status).toBe('available');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.aiBudgetSnapshot.findFirst.mock.calls[0][0].where).toMatchObject({
      organizationId: user.organizationId, userId: user.userId,
      id: expect.stringMatching(/^[a-f0-9]{64}$/), providerConfigHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('agrupa lecturas concurrentes para no multiplicar consultas a IBM', async () => {
    const { service, prisma, fetchMock } = setup();
    const results = await Promise.all([service.getBudget(user), service.getBudget(user), service.getBudget(user)]);
    expect(results.every((result) => result.status === 'available')).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(prisma.aiBudgetSnapshot.findFirst).toHaveBeenCalledOnce();
    expect(prisma.aiBudgetSnapshot.upsert).toHaveBeenCalledOnce();
  });

  it('conserva snapshot anterior ante rechazo y aplica espera antes de reintentar', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
    const { service, fetchMock } = setup({}, snapshot());
    fetchMock.mockResolvedValue(new Response('restricted upstream detail', { status: 403 }));
    const first = await service.getBudget(user);
    expect(first).toMatchObject({ status: 'stale', remaining: '17' });
    expect(JSON.stringify(first)).not.toContain('restricted upstream detail');
    await service.getBudget(user);
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.setSystemTime(new Date('2026-11-02T12:01:01Z'));
    await service.getBudget(user);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sin snapshot informa indisponibilidad y no divulga errores del proveedor', async () => {
    const { service, fetchMock, prisma } = setup();
    fetchMock.mockRejectedValue(new Error('upstream sensitive error fixture-credential'));
    const result = await service.getBudget(user);
    expect(result.status).toBe('unavailable');
    expect(JSON.stringify(result)).not.toContain('fixture-credential');
    expect(prisma.aiBudgetSnapshot.upsert).not.toHaveBeenCalled();
    await service.getBudget(user);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    { budget: { limit: '5', spent: '2' } },
    { budget: { unit: 'USD', limit: 'invalid', spent: '2' } },
    { budget: { unit: 'USD', limit: '5', spent: '-2' } },
    { budget: { unit: 'USD', limit: '1000000000000', spent: '2' } },
    { budget: { unit: 'USD' } },
  ])('rechaza un presupuesto incompleto o inválido y conserva el saldo conocido', async (body) => {
    const { service, fetchMock, prisma } = setup({}, snapshot());
    fetchMock.mockResolvedValue(Response.json(body));
    expect((await service.getBudget(user)).status).toBe('stale');
    expect(prisma.aiBudgetSnapshot.upsert).not.toHaveBeenCalled();
  });

  it('el hash cambia al cambiar contrato o credencial para no reutilizar otra cuenta', async () => {
    const { service, config, prisma } = setup();
    await service.getBudget(user);
    config.set('ICA_BUDGET_URL', 'https://servicesessentials.ibm.com/another-verified-fixture');
    config.set('ASSISTANT_API_KEY', 'different-fixture-credential');
    await service.getBudget(user);
    const first = prisma.aiBudgetSnapshot.findFirst.mock.calls[0][0].where;
    const second = prisma.aiBudgetSnapshot.findFirst.mock.calls[1][0].where;
    expect(second.providerConfigHash).not.toBe(first.providerConfigHash);
    expect(second.id).not.toBe(first.id);
  });

  it('construye la ruta de presupuesto del equipo con alcance compartido por defecto', async () => {
    const { service, fetchMock, prisma } = setup({
      ICA_BUDGET_URL: '', ICA_BUDGET_TEAM_ID: 'team_123.ab-42', ICA_BUDGET_SCOPE: '', ICA_BUDGET_AUTH_MODE: '',
      ASSISTANT_API_KEY: '', ICA_BUDGET_CURRENCY_PATH: '', ICA_BUDGET_LIMIT_PATH: '', ICA_BUDGET_SPENT_PATH: '',
    });
    expect(await service.getBudget(user)).toMatchObject({
      status: 'unavailable', scope: 'shared',
      connection: {
        mode: 'w3', teamId: 'team_123.ab-42',
        url: 'https://servicesessentials.ibm.com/services/integrations/team/team_123.ab-42/budget',
        loginUrl: 'https://servicesessentials.ibm.com/settings/usage',
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.aiBudgetSnapshot.findFirst).not.toHaveBeenCalled();
  });

  it('no etiqueta como individual el presupuesto de equipo construido o configurado por URL', async () => {
    for (const overrides of [
      { ICA_BUDGET_URL: '', ICA_BUDGET_TEAM_ID: 'team-test' },
      { ICA_BUDGET_URL: 'https://servicesessentials.ibm.com/services/integrations/team/team-test/budget' },
    ]) {
      const { service, fetchMock } = setup({ ...overrides, ICA_BUDGET_SCOPE: 'individual' });
      expect((await service.getBudget(user)).status).toBe('unavailable');
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it('rechaza identificadores de equipo inválidos sin llamar a IBM', async () => {
    for (const teamId of ['team/name', 'team?query=1', 'team#fragment', '%2F', '.', '..', 'x'.repeat(129)]) {
      const { service, fetchMock } = setup({
        ICA_BUDGET_URL: '', ICA_BUDGET_TEAM_ID: teamId, ICA_BUDGET_SCOPE: 'shared', ICA_BUDGET_AUTH_MODE: 'w3',
      });
      expect((await service.getBudget(user)).status).toBe('unavailable');
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it('sin teamId ni URL explícita mantiene presupuesto indisponible y no inventa el equipo', async () => {
    const { service, fetchMock } = setup({ ICA_BUDGET_URL: '', ICA_BUDGET_TEAM_ID: '', ICA_BUDGET_SCOPE: 'shared' });
    expect((await service.getBudget(user)).status).toBe('unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('nunca envía la clave de inferencia al presupuesto de equipo aunque se configure api_key', async () => {
    const { service, fetchMock } = setup({
      ICA_BUDGET_URL: '', ICA_BUDGET_TEAM_ID: 'verified-team', ICA_BUDGET_SCOPE: 'shared', ICA_BUDGET_AUTH_MODE: 'api_key',
    });
    const result = await service.getBudget(user);
    expect(result.status).toBe('unavailable');
    expect(result).not.toHaveProperty('connection');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('expone conexión W3 únicamente al propietario local y sin claves, cookies o importes supuestos', async () => {
    const { service, fetchMock } = setup({
      ICA_BUDGET_URL: '', ICA_BUDGET_TEAM_ID: 'verified-team', ICA_BUDGET_SCOPE: 'shared', ICA_BUDGET_AUTH_MODE: 'w3',
    });
    const ownerView = await service.getBudget(user);
    expect(ownerView.connection?.mode).toBe('w3');
    expect(ownerView).toMatchObject({ limit: null, spent: null, remaining: null, currency: null });
    expect(JSON.stringify(ownerView)).not.toContain('fixture-credential');
    expect(ownerView.connection).not.toHaveProperty('headers');
    expect(ownerView.connection).not.toHaveProperty('cookies');
    const otherView = await service.getBudget({ ...user, email: 'other@example.test' });
    expect(otherView).not.toHaveProperty('connection');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requiere opt-in explícito para modo api_key genérico y no expone query privada en conexión W3', async () => {
    const generic = setup({ ICA_BUDGET_AUTH_MODE: '' });
    expect((await generic.service.getBudget(user)).status).toBe('unavailable');
    expect(generic.fetchMock).not.toHaveBeenCalled();
    const team = setup({
      ICA_BUDGET_AUTH_MODE: 'w3', ICA_BUDGET_SCOPE: 'shared',
      ICA_BUDGET_URL: 'https://servicesessentials.ibm.com/services/integrations/team/team-test/budget?private=value',
    });
    expect(await team.service.getBudget(user)).not.toHaveProperty('connection');
    expect(team.fetchMock).not.toHaveBeenCalled();
  });
});
