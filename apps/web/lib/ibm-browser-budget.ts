import type { AssistantBudgetView, BrowserBudgetConnection, TeamCreditBudget } from './ai-usage';

export const IBM_USAGE_URL = 'https://servicesessentials.ibm.com/settings/usage';
export const IBM_CREDIT_UNIT = 'Advantage Credits';

export function browserBudgetConnectionIssue(error: unknown, status: number | null): 'session' | 'browser' | undefined {
  if (status === 401 || status === 403) return 'session';
  if (status === null && error instanceof Error && error.name === 'TypeError') return 'browser';
  return undefined;
}

export function browserBudgetFailureMessage(issue: 'session' | 'browser' | undefined): string {
  if (issue === 'session') return 'Inicia sesión en Services Essentials y pulsa Actualizar para consultar el presupuesto de IBM.';
  if (issue === 'browser') return 'IBM no permite consultar la sesión desde esta aplicación. Puedes revisar tu presupuesto en Services Essentials.';
  return 'La consulta de IBM no está disponible en este momento. Pulsa Actualizar para volver a intentarlo.';
}

// This endpoint uses the browser's IBM session. Never attach the application's API key.
export function browserBudgetUrl(connection: BrowserBudgetConnection): string {
  const { teamId } = connection;
  if (connection.mode !== 'w3' || !/^[A-Za-z0-9._-]{1,128}$/.test(teamId) || teamId === '.' || teamId === '..') {
    throw new Error('La conexión con IBM no es válida.');
  }
  const url = new URL(connection.url);
  if (url.origin !== 'https://servicesessentials.ibm.com'
    || url.pathname !== `/services/integrations/team/${encodeURIComponent(teamId)}/budget`
    || url.search || url.hash || url.username || url.password) {
    throw new Error('La conexión con IBM no es válida.');
  }
  return url.toString();
}

export function parseBrowserBudget(
  payload: unknown,
  connection: BrowserBudgetConnection,
  updatedAt: string,
): AssistantBudgetView {
  const body = record(payload);
  if (body.teamId !== connection.teamId) throw new Error('IBM devolvió un presupuesto de otro equipo.');
  const teamSpent = nonnegativeDecimal(body.advantageCredits);
  const teamLimit = body.maxAdvantageCredits === null ? null : nonnegativeDecimal(body.maxAdvantageCredits);
  let team: TeamCreditBudget | undefined;
  if (teamSpent !== null && (teamLimit !== null || body.maxAdvantageCredits === null)) {
    team = {
      teamId: connection.teamId,
      label: typeof body.teamAlias === 'string' && body.teamAlias.length <= 160 ? body.teamAlias : connection.teamId,
      limit: teamLimit,
      spent: teamSpent,
      remaining: teamLimit === null ? null : subtractBudgetDecimals(teamLimit, teamSpent),
      resetAt: epochDate(body.budgetResetAtEpochSeconds),
    };
  }

  const personalSpent = nonnegativeDecimal(body.userAdvantageCredits);
  const personalLimit = body.userMaxAdvantageCredits === null ? null : nonnegativeDecimal(body.userMaxAdvantageCredits);
  const hasPersonal = personalSpent !== null && (personalLimit !== null || body.userMaxAdvantageCredits === null);
  if (!hasPersonal && !team) throw new Error('IBM no devolvió un presupuesto en Advantage Credits.');

  return {
    status: 'available',
    scope: hasPersonal ? 'individual' : 'shared',
    currency: IBM_CREDIT_UNIT,
    limit: hasPersonal ? personalLimit : team!.limit,
    spent: hasPersonal ? personalSpent : team!.spent,
    remaining: hasPersonal
      ? personalLimit === null ? null : subtractBudgetDecimals(personalLimit, personalSpent!)
      : team!.remaining,
    updatedAt,
    message: hasPersonal
      ? 'Presupuesto individual de IBM en Advantage Credits, acumulado en todos tus equipos.'
      : 'IBM sólo devolvió el presupuesto compartido de este equipo; el presupuesto individual no está disponible.',
    connection,
    team,
  };
}

export function subtractBudgetDecimals(left: string, right: string): string {
  const first = decimalParts(left);
  const second = decimalParts(right);
  if (!first || !second) throw new Error('Importe de presupuesto no válido.');
  const scale = Math.max(first.scale, second.scale);
  const value = first.value * 10n ** BigInt(scale - first.scale) - second.value * 10n ** BigInt(scale - second.scale);
  return decimalText(value, scale);
}

function nonnegativeDecimal(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  const parts = decimalParts(String(value));
  return parts && parts.value >= 0n ? decimalText(parts.value, parts.scale) : null;
}

function decimalParts(value: string): { value: bigint; scale: number } | null {
  if (value.length > 128) return null;
  const match = value.match(/^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
  if (!match) return null;
  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 50) return null;
  const scale = (match[3]?.length ?? 0) - exponent;
  const digits = BigInt(`${match[1]}${match[2]}${match[3] ?? ''}`);
  return scale < 0 ? { value: digits * 10n ** BigInt(-scale), scale: 0 } : { value: digits, scale };
}

function decimalText(value: bigint, scale: number): string {
  const negative = value < 0n;
  const magnitude = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const text = scale > 0 ? `${magnitude.slice(0, -scale)}.${magnitude.slice(-scale)}`.replace(/\.?0+$/, '') : magnitude;
  return `${negative ? '-' : ''}${text}`;
}

function epochDate(value: unknown): string | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 946684800 || numeric > 7258118400) return null;
  return new Date(numeric * 1000).toISOString();
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
