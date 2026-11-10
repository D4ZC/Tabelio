import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchIbmBudgetThroughConnector, getIbmBudgetConnectorStatus } from './ibm-budget-connector';
import type { BrowserBudgetConnection } from './ai-usage';

const origin = 'http://localhost:3000';
const source = 'despacho-ibm-budget-connector-v1';
const connection: BrowserBudgetConnection = {
  mode: 'w3', teamId: 'team-1',
  url: 'https://servicesessentials.ibm.com/services/integrations/team/team-1/budget',
  loginUrl: 'https://servicesessentials.ibm.com/settings/usage',
};
let frame: EventTarget & {
  location: { origin: string }; top: unknown;
  setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout;
  postMessage: ReturnType<typeof vi.fn>;
};

function reply(requestId: string, response: unknown, messageOrigin = origin, requestSource = source, messageWindow: unknown = frame) {
  const event = new Event('message');
  Object.defineProperties(event, {
    data: { value: { source: requestSource, requestId, response } },
    origin: { value: messageOrigin }, source: { value: messageWindow },
  });
  frame.dispatchEvent(event);
}

beforeEach(() => {
  vi.useFakeTimers();
  frame = Object.assign(new EventTarget(), {
    location: { origin }, top: null as unknown, setTimeout, clearTimeout, postMessage: vi.fn(),
  });
  frame.top = frame;
  vi.stubGlobal('window', frame);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('conector de presupuesto Chrome', () => {
  it('detecta instalación y aprobación sin consultar IBM', async () => {
    const status = getIbmBudgetConnectorStatus();
    const [message, destination] = frame.postMessage.mock.calls[0];
    expect(message).toMatchObject({ type: 'STATUS', source: 'despacho-ibm-budget-client-v1' });
    expect(destination).toBe(origin);
    reply(message.requestId, { ok: true, available: true, connected: false });
    await expect(status).resolves.toEqual({ available: true, connected: false });
  });

  it('considera ausente el conector si no responde; no hace fetch alternativo', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const status = getIbmBudgetConnectorStatus();
    await vi.advanceTimersByTimeAsync(1_001);
    await expect(status).resolves.toEqual({ available: false, connected: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rechaza orígenes, ventanas e identificadores de respuesta ajenos', async () => {
    const status = getIbmBudgetConnectorStatus();
    const [{ requestId }] = frame.postMessage.mock.calls[0];
    reply(requestId, { ok: true, available: true, connected: true }, 'https://example.com');
    reply(requestId, { ok: true, available: true, connected: true }, origin, source, {});
    reply('another-id', { ok: true, available: true, connected: true });
    reply(requestId, { ok: true, available: true, connected: false });
    await expect(status).resolves.toEqual({ available: true, connected: false });
  });

  it('envía sólo el equipo y valida créditos individuales en la respuesta', async () => {
    const pending = fetchIbmBudgetThroughConnector(connection);
    const [message] = frame.postMessage.mock.calls[0];
    expect(Object.keys(message).sort()).toEqual(['requestId', 'source', 'teamId', 'type']);
    const updatedAt = '2026-11-02T12:00:00.000Z';
    reply(message.requestId, { ok: true, updatedAt, payload: {
      teamId: 'team-1', advantageCredits: '3', maxAdvantageCredits: '10',
      userAdvantageCredits: '0.1', userMaxAdvantageCredits: '1.2',
    } });
    await expect(pending).resolves.toMatchObject({ scope: 'individual', spent: '0.1', remaining: '1.1', currency: 'Advantage Credits', updatedAt });
  });

  it('conserva errores de sesión sin filtrar mensajes de IBM', async () => {
    const pending = fetchIbmBudgetThroughConnector(connection);
    const [{ requestId }] = frame.postMessage.mock.calls[0];
    reply(requestId, { ok: false, code: 'SESSION_REQUIRED', message: 'private details' });
    await expect(pending).rejects.toMatchObject({ code: 'SESSION_REQUIRED', message: 'SESSION_REQUIRED' });
  });

  it('aborta consultas y rechaza equipos distintos o URLs que no sean IBM', async () => {
    const controller = new AbortController();
    const pending = fetchIbmBudgetThroughConnector(connection, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    const wrong = fetchIbmBudgetThroughConnector(connection);
    const [{ requestId }] = frame.postMessage.mock.calls[1];
    reply(requestId, { ok: true, updatedAt: '2026-11-02T12:00:00.000Z', payload: { teamId: 'other', advantageCredits: '1', maxAdvantageCredits: '2' } });
    await expect(wrong).rejects.toThrow('otro equipo');
    await expect(fetchIbmBudgetThroughConnector({ ...connection, url: 'https://example.com' })).rejects.toThrow();
    expect(frame.postMessage).toHaveBeenCalledTimes(2);
  });

  it('no inicia un puente desde puertos ajenos ni iframes', async () => {
    frame.location.origin = 'http://localhost:3001';
    await expect(getIbmBudgetConnectorStatus()).resolves.toEqual({ available: false, connected: false });
    frame.location.origin = origin;
    frame.top = {};
    await expect(getIbmBudgetConnectorStatus()).resolves.toEqual({ available: false, connected: false });
    expect(frame.postMessage).not.toHaveBeenCalled();
  });
});
