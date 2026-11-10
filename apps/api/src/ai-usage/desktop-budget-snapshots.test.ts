import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { PrismaService } from '../prisma/prisma.service';
import { AiUsageService } from './ai-usage.service';
import { unavailableBudget, type BudgetView } from './ai-usage.types';
import { DesktopBudgetSnapshotDto } from './budget-snapshot.dto';
import { DesktopBudgetSnapshots } from './desktop-budget-snapshots';

const user: AuthenticatedUser = {
  userId: 'snapshot-user', organizationId: 'snapshot-org', membershipId: 'snapshot-member',
  email: 'owner@example.test', displayName: 'Owner', organizationName: 'Test', role: 'ADMIN',
};
const currentTime = '2026-11-02T12:00:00.000Z';

function configured(teamId = 'verified-team'): BudgetView {
  return {
    ...unavailableBudget(),
    connection: {
      mode: 'w3', teamId, url: `https://servicesessentials.ibm.com/services/integrations/team/${teamId}/budget`,
      loginUrl: 'https://servicesessentials.ibm.com/settings/usage',
      currency: 'Advantage Credits', limitPath: '', spentPath: '', remainingPath: '', currencyPath: '',
    },
  };
}

function input(overrides: Partial<DesktopBudgetSnapshotDto> = {}): DesktopBudgetSnapshotDto {
  return {
    teamId: 'verified-team', scope: 'individual', currency: 'Advantage Credits',
    limit: '20.000000000003', spent: '2.000000000001', updatedAt: currentTime,
    team: { label: 'Equipo', limit: '100', spent: '9', resetAt: null },
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(currentTime));
});
afterEach(() => vi.useRealTimers());

describe('saldo temporal compartido desde el escritorio', () => {
  it('calcula los saldos exactamente y conserva procedencia y vencimiento sin credenciales', () => {
    const snapshots = new DesktopBudgetSnapshots();
    snapshots.put(user, input(), configured());
    const result = snapshots.overlay(user, configured());
    expect(result).toMatchObject({
      status: 'stale', source: 'desktop_snapshot', currency: 'Advantage Credits',
      remaining: '18.000000000002', updatedAt: currentTime,
      snapshotReceivedAt: currentTime, snapshotExpiresAt: '2026-11-02T20:00:00.000Z',
      team: { teamId: 'verified-team', remaining: '91' },
    });
    expect(result.message).toContain('no es una consulta en vivo');
    expect(snapshots.put(user, input(), configured())).not.toHaveProperty('connection');
    result.remaining = 'wrong';
    expect(snapshots.overlay(user, configured()).remaining).toBe('18.000000000002');
  });

  it('aísla el saldo por usuario y organización, aunque la conexión IBM tenga el mismo equipo', () => {
    const snapshots = new DesktopBudgetSnapshots();
    snapshots.put(user, input(), configured());
    expect(snapshots.overlay({ ...user, userId: 'other' }, configured()).status).toBe('unavailable');
    expect(snapshots.overlay({ ...user, organizationId: 'other' }, configured()).status).toBe('unavailable');
  });

  it('no reemplaza saldos del servidor ni reutiliza snapshots sin la misma conexión W3', () => {
    const snapshots = new DesktopBudgetSnapshots();
    snapshots.put(user, input(), configured());
    const serverBudget: BudgetView = { ...unavailableBudget(), status: 'available', remaining: '30' };
    const serverStale: BudgetView = { ...serverBudget, status: 'stale' };
    expect(snapshots.overlay(user, serverBudget)).toBe(serverBudget);
    expect(snapshots.overlay(user, serverStale)).toBe(serverStale);
    expect(snapshots.overlay(user, unavailableBudget()).status).toBe('unavailable');
    expect(snapshots.overlay(user, configured('other-team')).status).toBe('unavailable');
    expect(() => snapshots.put(user, input(), unavailableBudget())).toThrow('conexión IBM');
    expect(() => snapshots.put(user, input(), configured('other-team'))).toThrow('conexión IBM');
  });

  it('vence a las 8 horas y no persiste al crear una instancia nueva del servidor', () => {
    const snapshots = new DesktopBudgetSnapshots();
    snapshots.put(user, input(), configured());
    expect(new DesktopBudgetSnapshots().overlay(user, configured()).status).toBe('unavailable');
    vi.setSystemTime(new Date('2026-11-02T19:59:59.999Z'));
    expect(snapshots.overlay(user, configured()).source).toBe('desktop_snapshot');
    vi.setSystemTime(new Date('2026-11-02T20:00:00.000Z'));
    expect(snapshots.overlay(user, configured()).status).toBe('unavailable');
  });

  it.each([
    { updatedAt: '2026-11-02T11:54:59.999Z' }, { updatedAt: '2026-11-02T12:01:00.001Z' },
    { updatedAt: 'invalid' }, { spent: '-1' }, { limit: '1e2' }, { spent: '9999999999999' },
    { currency: 'USD' }, { scope: 'other' },
  ])('rechaza datos inválidos sin contaminar el saldo previamente registrado: %j', (changes) => {
    const snapshots = new DesktopBudgetSnapshots();
    snapshots.put(user, input(), configured());
    expect(() => snapshots.put(user, input(changes as Partial<DesktopBudgetSnapshotDto>), configured())).toThrow();
    expect(snapshots.overlay(user, configured()).remaining).toBe('18.000000000002');
  });

  it('calcula saldo negativo y mantiene sin límite como null sin inventar importes', () => {
    const snapshots = new DesktopBudgetSnapshots();
    expect(snapshots.put(user, input({ limit: '2', spent: '3', team: undefined }), configured()).remaining).toBe('-1');
    expect(snapshots.put(user, input({ limit: null, spent: '3', team: undefined }), configured())).toMatchObject({
      limit: null, remaining: null, spent: '3',
    });
  });

  it('una respuesta antigua que llega tarde no sustituye el saldo más reciente', () => {
    const snapshots = new DesktopBudgetSnapshots();
    snapshots.put(user, input(), configured());
    snapshots.put(user, input({ updatedAt: '2026-11-02T11:59:59.000Z', spent: '15' }), configured());
    expect(snapshots.overlay(user, configured()).remaining).toBe('18.000000000002');
  });

  it('acota la memoria a los últimos mil principales sin mezclar sus registros', () => {
    const snapshots = new DesktopBudgetSnapshots();
    for (let index = 0; index <= 1_000; index++) {
      snapshots.put({ ...user, userId: `user-${index}` }, input(), configured());
    }
    expect(snapshots.overlay({ ...user, userId: 'user-0' }, configured()).status).toBe('unavailable');
    expect(snapshots.overlay({ ...user, userId: 'user-1000' }, configured()).remaining).toBe('18.000000000002');
  });

  it('DTO rechaza IDs de otro principal, URLs y credenciales, incluso en datos anidados', async () => {
    const unknownFields = plainToInstance(DesktopBudgetSnapshotDto, {
      ...input(), userId: 'another-user', apiKey: 'secret', url: 'https://example.test',
      team: { ...input().team, organizationId: 'another-org' },
    });
    const errors = await validate(unknownFields, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining(['userId', 'apiKey', 'url', 'team']));
    expect(await validate(plainToInstance(DesktopBudgetSnapshotDto, input()), {
      whitelist: true, forbidNonWhitelisted: true,
    })).toEqual([]);
    for (const changes of [{ limit: undefined }, { spent: 2 }, { updatedAt: '2026-99-99' }, { team: [] }]) {
      expect((await validate(plainToInstance(DesktopBudgetSnapshotDto, { ...input(), ...changes }))).length).toBeGreaterThan(0);
    }
  });

  it('integra POST y resumen sin alterar agregados de consumo ni requerir una conversación', async () => {
    const prisma = {
      aiUsageAttempt: {
        groupBy: vi.fn().mockResolvedValue([]), aggregate: vi.fn().mockResolvedValue({ _min: { createdAt: null } }),
      },
      aiOperation: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const provider = { getBudget: vi.fn().mockResolvedValue(configured()) };
    const service = new AiUsageService(prisma as unknown as PrismaService, new ConfigService(), provider);
    expect(await service.saveBudgetSnapshot(user, input())).toEqual({
      saved: true, updatedAt: currentTime, expiresAt: '2026-11-02T20:00:00.000Z',
    });
    const own = await service.summary(user);
    expect(own.budget.source).toBe('desktop_snapshot');
    expect(own.personal.requestCount).toBe(0);
    expect((await service.summary({ ...user, userId: 'other' })).budget.status).toBe('unavailable');
    expect(provider.getBudget).toHaveBeenCalledWith(user);
  });
});
