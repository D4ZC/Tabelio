import type { AssistantBudgetView, BrowserBudgetConnection } from './ai-usage';
import { browserBudgetUrl, parseBrowserBudget } from './ibm-browser-budget';

const DEMO_ORIGIN = 'http://localhost:3000';
const CLIENT_SOURCE = 'despacho-ibm-budget-client-v1';
const CONNECTOR_SOURCE = 'despacho-ibm-budget-connector-v1';
type ConnectorErrorCode = 'CONNECTOR_UNAVAILABLE' | 'SESSION_REQUIRED' | 'REQUEST_FAILED' | 'TIMEOUT';

export class IbmBudgetConnectorError extends Error {
  constructor(readonly code: ConnectorErrorCode) {
    super(code);
    this.name = 'IbmBudgetConnectorError';
  }
}

export async function getIbmBudgetConnectorStatus(): Promise<{ available: boolean; connected: boolean }> {
  try {
    const result = await connectorRequest('STATUS', undefined, undefined, 1_000);
    return { available: result.available === true, connected: result.connected === true };
  } catch { return { available: false, connected: false }; }
}

export async function fetchIbmBudgetThroughConnector(connection: BrowserBudgetConnection, signal?: AbortSignal): Promise<AssistantBudgetView> {
  browserBudgetUrl(connection);
  const result = await connectorRequest('BUDGET', connection.teamId, signal, 7_000);
  const updatedAt = result.updatedAt;
  if (typeof updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(updatedAt)
    || !Number.isFinite(Date.parse(updatedAt))) throw new IbmBudgetConnectorError('REQUEST_FAILED');
  // Validate identity and units again at the app boundary. No browser-session data reaches the API.
  return parseBrowserBudget(result.payload, connection, updatedAt);
}

function connectorRequest(type: 'STATUS' | 'BUDGET', teamId: string | undefined, signal: AbortSignal | undefined, timeout: number): Promise<Record<string, unknown>> {
  if (typeof window === 'undefined' || window.location.origin !== DEMO_ORIGIN || window.top !== window) {
    return Promise.reject(new IbmBudgetConnectorError('CONNECTOR_UNAVAILABLE'));
  }
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const finish = (result?: Record<string, unknown>, error?: Error) => {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(result!);
    };
    const onAbort = () => finish(undefined, new DOMException('Aborted', 'AbortError'));
    const onMessage = (event: MessageEvent) => {
      const data = record(event.data);
      if (event.source !== window || event.origin !== DEMO_ORIGIN
        || data.source !== CONNECTOR_SOURCE || data.requestId !== requestId) return;
      const response = record(data.response);
      if (response.ok !== true) {
        const code = response.code;
        finish(undefined, new IbmBudgetConnectorError(
          code === 'SESSION_REQUIRED' || code === 'CONNECTOR_UNAVAILABLE' || code === 'TIMEOUT' ? code : 'REQUEST_FAILED',
        ));
      } else finish(response);
    };
    const timer = window.setTimeout(() => finish(undefined, new IbmBudgetConnectorError('TIMEOUT')), timeout);
    window.addEventListener('message', onMessage);
    signal?.addEventListener('abort', onAbort, { once: true });
    window.postMessage({ source: CLIENT_SOURCE, requestId, type, ...(teamId ? { teamId } : {}) }, DEMO_ORIGIN);
  });
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
