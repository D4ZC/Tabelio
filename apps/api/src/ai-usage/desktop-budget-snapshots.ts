import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@despacho/database';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { BudgetView } from './ai-usage.types';
import { SNAPSHOT_DECIMAL, type DesktopBudgetSnapshotDto } from './budget-snapshot.dto';

const ACCEPT_MAX_AGE_MS = 5 * 60_000;
const MAX_FUTURE_MS = 60_000;
const RETENTION_MS = 8 * 60 * 60_000;
const MAX_RECORDS = 1_000;

interface DesktopRecord {
  teamId: string;
  expiresAt: number;
  budget: BudgetView;
}

/** Temporary display cache for the local demo; never authorizes spending or changes usage accounting. */
export class DesktopBudgetSnapshots {
  private readonly records = new Map<string, DesktopRecord>();

  put(user: AuthenticatedUser, input: DesktopBudgetSnapshotDto, configured: BudgetView): BudgetView {
    const connection = configured.connection;
    if (connection?.mode !== 'w3' || connection.teamId !== input.teamId) {
      throw new BadRequestException('El saldo no corresponde a la conexión IBM configurada para tu cuenta.');
    }
    if (input.currency !== 'Advantage Credits' || !['individual', 'shared'].includes(input.scope)) {
      throw new BadRequestException('El alcance o la unidad del saldo no es válido.');
    }
    const now = Date.now();
    const updated = Date.parse(input.updatedAt);
    if (!Number.isFinite(updated) || updated < now - ACCEPT_MAX_AGE_MS || updated > now + MAX_FUTURE_MS) {
      throw new BadRequestException('Actualiza el saldo en el escritorio antes de compartirlo con tu teléfono.');
    }
    const amounts = numericBudget(input.limit, input.spent);
    let team: BudgetView['team'];
    if (input.team) {
      if (typeof input.team.label !== 'string' || input.team.label.length > 160
        || (input.team.resetAt !== null && !Number.isFinite(Date.parse(input.team.resetAt)))) {
        throw new BadRequestException('Los datos del equipo IBM no son válidos.');
      }
      team = {
        teamId: connection.teamId,
        label: input.team.label,
        ...numericBudget(input.team.limit, input.team.spent),
        resetAt: input.team.resetAt === null ? null : new Date(input.team.resetAt).toISOString(),
      };
    }
    this.prune(now);
    const key = this.key(user);
    const previous = this.records.get(key);
    if (previous?.teamId === input.teamId && Date.parse(previous.budget.updatedAt!) > updated) {
      return structuredClone(previous.budget);
    }
    const expiresAt = updated + RETENTION_MS;
    const budget: BudgetView = {
      status: 'stale', source: 'desktop_snapshot', scope: input.scope, currency: input.currency,
      ...amounts, updatedAt: new Date(updated).toISOString(),
      snapshotReceivedAt: new Date(now).toISOString(), snapshotExpiresAt: new Date(expiresAt).toISOString(),
      message: 'Último saldo compartido desde tu navegador de escritorio; no es una consulta en vivo a IBM. Se conserva hasta 8 horas y se pierde al reiniciar el servidor local.',
      ...(team ? { team } : {}),
    };
    this.records.delete(key);
    if (this.records.size >= MAX_RECORDS) this.records.delete(this.records.keys().next().value!);
    this.records.set(key, { teamId: input.teamId, expiresAt, budget });
    return structuredClone(budget);
  }

  overlay(user: AuthenticatedUser, configured: BudgetView): BudgetView {
    this.prune(Date.now());
    // Server-authorized API-key balances and unrelated/unconfigured connections retain priority.
    if (configured.status !== 'unavailable' || configured.connection?.mode !== 'w3') return configured;
    const record = this.records.get(this.key(user));
    if (!record || record.teamId !== configured.connection.teamId) return configured;
    return { ...structuredClone(record.budget), connection: configured.connection };
  }

  private key(user: AuthenticatedUser): string {
    return JSON.stringify([user.organizationId, user.userId]);
  }

  private prune(now: number) {
    for (const [key, record] of this.records) if (record.expiresAt <= now) this.records.delete(key);
  }
}

function numericBudget(limit: string | null, spent: string) {
  if (typeof spent !== 'string' || !SNAPSHOT_DECIMAL.test(spent)
    || (limit !== null && (typeof limit !== 'string' || !SNAPSHOT_DECIMAL.test(limit)))) {
    throw new BadRequestException('Los importes del saldo IBM no son válidos.');
  }
  const spentValue = new Prisma.Decimal(spent);
  const limitValue = limit === null ? null : new Prisma.Decimal(limit);
  return {
    limit: limitValue?.toFixed() ?? null,
    spent: spentValue.toFixed(),
    remaining: limitValue?.minus(spentValue).toFixed() ?? null,
  };
}
