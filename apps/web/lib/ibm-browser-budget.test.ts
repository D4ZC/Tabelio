import { describe, expect, it } from 'vitest';
import { browserBudgetConnectionIssue, browserBudgetFailureMessage, browserBudgetUrl, IBM_CREDIT_UNIT, parseBrowserBudget, subtractBudgetDecimals } from './ibm-browser-budget';
import type { BrowserBudgetConnection } from './ai-usage';

const connection: BrowserBudgetConnection = {
  mode: 'w3', teamId: 'team-1',
  url: 'https://servicesessentials.ibm.com/services/integrations/team/team-1/budget',
  loginUrl: 'https://servicesessentials.ibm.com/settings/usage',
};
const timestamp = '2026-11-02T12:00:00.000Z';
const payload = {
  teamId: 'team-1', teamAlias: 'Equipo de prueba',
  advantageCredits: '2.7', maxAdvantageCredits: '10',
  userAdvantageCredits: '0.1', userMaxAdvantageCredits: '1.2',
  // Deliberately different units: these fields must not drive a credit-denominated balance.
  spendUsd: '999', maxBudgetUsd: '1000', userSpendUsd: '500', userMaxBudgetUsd: '600',
  creditsPerUsd: 20, budgetResetAtEpochSeconds: 1793620800,
};

describe('presupuesto IBM con sesión del navegador', () => {
  it('distingue sesión requerida de consulta bloqueada y de un timeout transitorio', () => {
    expect(browserBudgetConnectionIssue(new Error('Unauthorized'), 401)).toBe('session');
    expect(browserBudgetConnectionIssue(new Error('Forbidden'), 403)).toBe('session');
    expect(browserBudgetConnectionIssue(new TypeError('Failed to fetch'), null)).toBe('browser');
    const timeout = new Error('The operation was aborted');
    timeout.name = 'AbortError';
    expect(browserBudgetConnectionIssue(timeout, null)).toBeUndefined();
    expect(browserBudgetFailureMessage(browserBudgetConnectionIssue(timeout, null))).toContain('volver a intentarlo');
    expect(browserBudgetConnectionIssue(new Error('Service unavailable'), 503)).toBeUndefined();
  });
  it('distingue presupuesto individual global del presupuesto compartido del equipo sin convertir USD', () => {
    const budget = parseBrowserBudget(payload, connection, timestamp);
    expect(budget).toMatchObject({
      scope: 'individual', currency: IBM_CREDIT_UNIT, limit: '1.2', spent: '0.1', remaining: '1.1', updatedAt: timestamp,
      team: { teamId: 'team-1', limit: '10', spent: '2.7', remaining: '7.3' },
    });
  });

  it('usa el presupuesto compartido sólo cuando faltan los importes individuales', () => {
    const { userAdvantageCredits: _spent, userMaxAdvantageCredits: _limit, ...teamOnly } = payload;
    expect(parseBrowserBudget(teamOnly, connection, timestamp)).toMatchObject({
      scope: 'shared', currency: IBM_CREDIT_UNIT, limit: '10', spent: '2.7', remaining: '7.3',
    });
  });

  it('no inventa créditos cuando el proveedor sólo devolvió importes USD o un equipo diferente', () => {
    expect(() => parseBrowserBudget({ teamId: 'team-1', spendUsd: '1', maxBudgetUsd: '10' }, connection, timestamp)).toThrow();
    expect(() => parseBrowserBudget({ ...payload, teamId: 'another-team' }, connection, timestamp)).toThrow();
  });

  it('distingue límite cero de ausencia de límite y permite mostrar sobregiro', () => {
    expect(parseBrowserBudget({ ...payload, userAdvantageCredits: '0.1', userMaxAdvantageCredits: '0' }, connection, timestamp))
      .toMatchObject({ limit: '0', remaining: '-0.1' });
    expect(parseBrowserBudget({ ...payload, userMaxAdvantageCredits: null }, connection, timestamp))
      .toMatchObject({ limit: null, remaining: null, spent: '0.1' });
  });

  it('calcula saldos decimales sin errores de punto flotante', () => {
    expect(subtractBudgetDecimals('0.3', '0.1')).toBe('0.2');
    expect(subtractBudgetDecimals('10000000000000000.00000001', '10000000000000000')).toBe('0.00000001');
    expect(subtractBudgetDecimals('1e-8', '3e-9')).toBe('0.000000007');
    expect(subtractBudgetDecimals('1.000', '1')).toBe('0');
  });

  it('limita la consulta autenticada al endpoint de presupuesto IBM documentado', () => {
    expect(browserBudgetUrl(connection)).toBe(connection.url);
    for (const url of [
      'https://example.com/services/integrations/team/team-1/budget',
      'https://servicesessentials.ibm.com/services/integrations/team/other/budget',
      `${connection.url}?token=secret`,
      'http://servicesessentials.ibm.com/services/integrations/team/team-1/budget',
    ]) expect(() => browserBudgetUrl({ ...connection, url })).toThrow();
  });
});
