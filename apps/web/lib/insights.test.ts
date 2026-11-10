import { describe, expect, it, vi } from 'vitest';
import {
  InsightRequestCoordinator, insightCitationLabels, insightEndpoint, insightRecordState,
  insightScope, parseInsightResult, requestInsight, type InsightRequest, type InsightResult,
} from './insights';

const localRequest: InsightRequest = { kind: 'summary', entityId: 'matter-1', mode: 'local', revision: 'v1' };
const result: InsightResult = {
  kind: 'summary', mode: 'local', generatedAt: '2026-11-02T15:00:00.000Z',
  title: 'Resumen', summary: 'Expediente en integración.',
  items: [{ title: 'Falta identificación', detail: 'Revisar el checklist.', severity: 'warning', sourceIds: ['checklist-1'] }],
  sources: [{ id: 'checklist-1', label: 'Checklist del expediente' }],
  limitations: ['Resultado informativo; requiere revisión humana.'],
};

describe('contrato de análisis y elección de modo', () => {
  it('usa las rutas de lectura de cada entidad y codifica su identificador', () => {
    expect(insightEndpoint(localRequest)).toBe('/insights/matters/matter-1/summary');
    expect(insightEndpoint({ kind: 'consistency', entityId: 'matter-1' })).toBe('/insights/matters/matter-1/consistency');
    expect(insightEndpoint({ kind: 'comparison', entityId: 'doc/1' })).toBe('/insights/documents/doc%2F1/comparison');
    expect(insightEndpoint({ kind: 'classification', entityId: 'doc-1' })).toBe('/insights/documents/doc-1/classification');
  });

  it('permite análisis local con IA deshabilitada y no emite consumo IA', async () => {
    const transport = vi.fn().mockResolvedValue(result);
    const usage = vi.fn();
    expect(await requestInsight(localRequest, { aiEnabled: false, provider: 'disabled' }, transport, usage)).toEqual(result);
    expect(transport).toHaveBeenCalledExactlyOnceWith('/insights/matters/matter-1/summary', {
      method: 'POST', body: '{"mode":"local"}',
    });
    expect(usage).not.toHaveBeenCalled();
  });

  it('no permite enviar a IA mientras no se confirme disponibilidad del proveedor', async () => {
    const transport = vi.fn();
    const usage = vi.fn();
    await expect(requestInsight({ ...localRequest, mode: 'ai' }, undefined, transport, usage)).rejects.toThrow('no está disponible');
    await expect(requestInsight({ ...localRequest, mode: 'ai' }, { aiEnabled: false, provider: '' }, transport, usage)).rejects.toThrow('no está disponible');
    expect(transport).not.toHaveBeenCalled();
    expect(usage).not.toHaveBeenCalled();
  });

  it('envía sólo el modo elegido y refresca consumo al terminar una petición IA explícita', async () => {
    const transport = vi.fn().mockResolvedValue({ ...result, mode: 'ai' });
    const usage = vi.fn();
    await requestInsight({ ...localRequest, mode: 'ai' }, { aiEnabled: true, provider: 'IBM' }, transport, usage);
    expect(transport).toHaveBeenCalledExactlyOnceWith('/insights/matters/matter-1/summary', {
      method: 'POST', body: '{"mode":"ai"}',
    });
    expect(usage).toHaveBeenCalledTimes(1);
  });

  it('propaga fallos sin reintentar ni cambiar de modo automáticamente', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('Proveedor no disponible'));
    const usage = vi.fn();
    await expect(requestInsight({ ...localRequest, mode: 'ai' }, { aiEnabled: true, provider: 'IBM' }, transport, usage)).rejects.toThrow('Proveedor no disponible');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(usage).toHaveBeenCalledTimes(1);
    transport.mockClear();
    await expect(requestInsight(localRequest, undefined, transport, usage)).rejects.toThrow('Proveedor no disponible');
    expect(transport).toHaveBeenCalledExactlyOnceWith('/insights/matters/matter-1/summary', { method: 'POST', body: '{"mode":"local"}' });
    expect(usage).toHaveBeenCalledTimes(1);
  });

  it('rechaza respuestas de otro modo, tipo o contrato incompleto', () => {
    expect(() => parseInsightResult({ ...result, mode: 'ai' }, localRequest)).toThrow('no corresponde');
    expect(() => parseInsightResult({ ...result, kind: 'classification' }, localRequest)).toThrow('no corresponde');
    expect(() => parseInsightResult({ ...result, generatedAt: 'sin fecha' }, localRequest)).toThrow('incompleta');
    expect(() => parseInsightResult({ ...result, sources: [{ id: 'x' }] }, localRequest)).toThrow('incompleta');
    expect(() => parseInsightResult({ ...result, suggestion: { documentType: 'SIGNED_CONTRACT' } }, localRequest)).toThrow('incompleta');
  });
});

describe('fuentes, vigencia y respuestas tardías', () => {
  it('muestra etiquetas legibles, deduplica citas y señala fuentes ausentes sin exponer IDs', () => {
    const citations = insightCitationLabels(['checklist-1', 'private-raw-id', 'checklist-1'], result.sources);
    expect(citations).toEqual({ labels: ['Checklist del expediente'], missing: true });
    expect(JSON.stringify(citations)).not.toContain('private-raw-id');
  });

  it('marca el resultado anterior al cambiar modo o datos y bloquea su sugerencia', () => {
    const classification: InsightRequest = { ...localRequest, kind: 'classification', entityId: 'doc-1' };
    const record = { entityId: 'doc-1', scope: insightScope(classification), result: { ...result, kind: 'classification' as const, suggestion: { documentType: 'OTHER' as const } } };
    expect(insightRecordState(record, classification)).toEqual({ visible: true, stale: false, canUseSuggestion: true });
    expect(insightRecordState(record, { ...classification, mode: 'ai' })).toEqual({ visible: true, stale: true, canUseSuggestion: false });
    expect(insightRecordState(record, { ...classification, revision: 'v2' })).toEqual({ visible: true, stale: true, canUseSuggestion: false });
    expect(insightRecordState(record, { ...classification, entityId: 'doc-2' })).toEqual({ visible: false, stale: false, canUseSuggestion: false });
  });

  it('ignora una respuesta pendiente si cambia la entidad o el modo', async () => {
    const coordinator = new InsightRequestCoordinator();
    let complete!: (value: InsightResult) => void;
    const response = new Promise<InsightResult>((resolve) => { complete = resolve; });
    const original = coordinator.begin(insightScope(localRequest));
    const accepted: InsightResult[] = [];
    const pending = response.then((value) => { if (coordinator.isCurrent(original)) accepted.push(value); });
    coordinator.setScope(insightScope({ ...localRequest, entityId: 'matter-2', mode: 'ai' }));
    complete(result);
    await pending;
    expect(accepted).toEqual([]);
  });

  it('mantiene sólo la petición más reciente incluso al volver al mismo modo y entidad', () => {
    const coordinator = new InsightRequestCoordinator();
    const scope = insightScope(localRequest);
    const first = coordinator.begin(scope);
    coordinator.setScope(insightScope({ ...localRequest, mode: 'ai' }));
    const latest = coordinator.begin(scope);
    expect(coordinator.isCurrent(first)).toBe(false);
    expect(coordinator.isCurrent(latest)).toBe(true);
    coordinator.invalidate();
    expect(coordinator.isCurrent(latest)).toBe(false);
  });
});
