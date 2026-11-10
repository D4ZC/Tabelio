import { describe, expect, it } from 'vitest';
import { canRetainBudgetAfterConnectorFailure, connectorBudgetFailureMessage, connectorBudgetIssue } from './ibm-budget-connector-ui';

describe('estado del conector IBM en la interfaz', () => {
  it('distingue extensión ausente y extensión instalada pendiente de conectar', () => {
    expect(connectorBudgetIssue(new Error(), { available: false, connected: false })).toBe('connector');
    expect(connectorBudgetIssue(new Error(), { available: true, connected: false })).toBe('approval');
    expect(connectorBudgetFailureMessage('approval')).toContain('Conectar esta demo');
  });

  it('solicita sesión IBM sólo cuando el conector informa un fallo de autenticación', () => {
    expect(connectorBudgetIssue({ code: 'SESSION_REQUIRED' }, { available: true, connected: true })).toBe('session');
    expect(connectorBudgetFailureMessage('session')).toContain('este mismo perfil de Chrome');
    expect(connectorBudgetIssue({ code: 'TIMEOUT' }, { available: true, connected: true })).toBeUndefined();
    expect(connectorBudgetIssue({ code: 'REQUEST_FAILED' }, { available: true, connected: true })).toBeUndefined();
  });

  it('permite recuperar una extensión desconectada sin mostrar importes inventados', () => {
    expect(connectorBudgetIssue({ code: 'CONNECTOR_UNAVAILABLE' })).toBe('connector');
    expect(connectorBudgetFailureMessage(undefined)).toContain('volver a intentarlo');
    expect(connectorBudgetFailureMessage('connector')).toContain('recarga esta página');
  });

  it('borra el saldo visible al revocar conexión aunque existiera un saldo anterior', () => {
    expect(connectorBudgetIssue({ code: 'CONNECTOR_UNAVAILABLE' }, { available: true, connected: true })).toBe('approval');
    expect(canRetainBudgetAfterConnectorFailure('approval')).toBe(false);
    expect(canRetainBudgetAfterConnectorFailure('connector')).toBe(false);
    expect(canRetainBudgetAfterConnectorFailure(undefined)).toBe(true);
  });
});
