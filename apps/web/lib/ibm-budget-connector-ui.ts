import type { AssistantBudgetView } from './ai-usage';

export interface ConnectorAvailability {
  available: boolean;
  connected: boolean;
}

type ConnectionIssue = AssistantBudgetView['connectionIssue'];

export function connectorBudgetIssue(error: unknown, status?: ConnectorAvailability): ConnectionIssue {
  if (status && !status.available) return 'connector';
  if (status && !status.connected) return 'approval';
  const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === 'SESSION_REQUIRED') return 'session';
  if (code === 'CONNECTOR_UNAVAILABLE') return status?.available ? 'approval' : 'connector';
  return undefined;
}

export function connectorBudgetFailureMessage(issue: ConnectionIssue): string {
  switch (issue) {
    case 'connector': return 'Instala el conector de Chrome, recarga esta página y pulsa Actualizar para consultar tu presupuesto.';
    case 'approval': return 'Abre el conector en la barra de Chrome y pulsa «Conectar esta demo». Después vuelve aquí y pulsa Actualizar.';
    case 'session': return 'Inicia sesión en Services Essentials desde este mismo perfil de Chrome, mantén abierta la página Uso (Usage) y pulsa Actualizar.';
    case 'browser': return 'El navegador no pudo consultar IBM. Comprueba que el conector está conectado a esta demo y pulsa Actualizar.';
    default: return 'El conector no pudo actualizar IBM en este momento. Pulsa Actualizar para volver a intentarlo.';
  }
}

export function canRetainBudgetAfterConnectorFailure(issue: ConnectionIssue): boolean {
  return issue !== 'connector' && issue !== 'approval';
}
