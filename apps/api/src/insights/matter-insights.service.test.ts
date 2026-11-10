import { describe, expect, it, vi } from 'vitest';
import { MatterInsightsService } from './matter-insights.service';

const user = { userId: 'owner', organizationId: 'org' } as never;

function fixture() {
  const matter = {
    id: 'matter-1', reference: 'DEMO-1', title: 'Expediente de prueba', kind: 'LEASE', status: 'INTEGRATION',
    responsible: null, property: null, leaseTerms: null, mediationTerms: null, notes: 'Nota de prueba sin instrucciones.',
    parties: [{ personId: 'person-1', role: 'TENANT', person: { legalName: 'Persona Sintética', curp: 'AAAA900101HDFXXX00', postalCode: '01000' } }],
    documents: [{ id: 'doc-1', originalName: 'identificacion.png', type: 'TENANT_ID', isCurrentVersion: true, invalidatedAt: null, personId: 'person-1', extractedData: { legalName: 'Otro Nombre', curp: 'BBBB900101HDFXXX00', postalCode: '01000' } }],
    checklistItems: [{ label: 'Identificación', status: 'PENDING', blocking: true }],
    tasks: [{ title: 'Terminada', status: 'DONE' }, { title: 'Cancelada', status: 'CANCELLED' }, { title: 'Pendiente', status: 'TODO' }, { title: 'Bloqueada', status: 'BLOCKED' }],
    consistency: { total: 1, high: 1, medium: 0, low: 0, warnings: [{ title: 'Vigencia pendiente', detail: 'Revisar la fecha.', recommendation: 'Capturar vigencia.', severity: 'HIGH' }] },
    readiness: { level: 'BLOCKED', summary: 'Falta una identificación.' },
  };
  const matters = { get: vi.fn().mockResolvedValue(matter) };
  const ai = { generate: vi.fn().mockResolvedValue({ title: 'Explicación', summary: 'Revisión propuesta', items: [] }) };
  return { service: new MatterInsightsService(matters as never, ai as never), matter, matters, ai };
}

describe('resumen y consistencia por modalidad', () => {
  it('calcula resumen local sin IA y cuenta sólo tareas abiertas', async () => {
    const { service, ai, matters } = fixture();
    const result = await service.analyze(user, 'matter-1', 'summary');
    expect(matters.get).toHaveBeenCalledWith(user, 'matter-1');
    expect(result.mode).toBe('local');
    expect(result.summary).toContain('2 tareas pendientes');
    expect(result.items.find((item) => item.title === 'Trabajo pendiente')?.detail).toBe('2 tareas abiertas; 1 bloqueadas.');
    expect(ai.generate).not.toHaveBeenCalled();
    const sourceIds = new Set(result.sources.map((source) => source.id));
    expect(result.items.every((item) => item.sourceIds.every((source) => sourceIds.has(source)))).toBe(true);
  });

  it('añade diferencias de campos confirmados sin emitir decisiones ni modificar fichas', async () => {
    const { service, ai } = fixture();
    const result = await service.analyze(user, 'matter-1', 'consistency');
    expect(result.items.map((item) => item.title)).toEqual(['Vigencia pendiente', 'Nombre diferente entre documento y ficha', 'CURP diferente entre documento y ficha']);
    expect(result.items[2].severity).toBe('high');
    expect(result.items[1].sourceIds).toEqual(['document:doc-1', 'parties:matter-1']);
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it('excluye documentos históricos e invalidados al comparar campos', async () => {
    const { service, matter } = fixture();
    matter.documents[0].isCurrentVersion = false;
    expect((await service.analyze(user, 'matter-1', 'consistency')).items).toHaveLength(1);
    matter.documents[0].isCurrentVersion = true;
    matter.documents[0].invalidatedAt = new Date() as never;
    expect((await service.analyze(user, 'matter-1', 'consistency')).items).toHaveLength(1);
  });

  it('la IA recibe sólo fuentes limitadas y los hechos permanecen separados de su explicación', async () => {
    const { service, ai, matter } = fixture();
    matter.notes = 'x'.repeat(20_000);
    const result = await service.analyze(user, 'matter-1', 'summary', { mode: 'ai', conversationId: 'chat-1' });
    expect(result.title).toBe('Explicación');
    expect(result.facts?.consistency).toEqual(matter.consistency);
    const options = ai.generate.mock.calls[0][1] as unknown as { sources: Array<{ text: string }>; conversationId: string };
    expect(options.conversationId).toBe('chat-1');
    expect(options.sources.length).toBeLessThanOrEqual(20);
    expect(options.sources.every((source) => source.text.length <= 6000)).toBe(true);
    expect(options.sources.reduce((sum, source) => sum + source.text.length, 0)).toBeLessThanOrEqual(40_000);
    expect(JSON.stringify(options.sources)).not.toContain('AAAA900101HDFXXX00');
    expect(result.limitations.some((note) => note.includes('limitado'))).toBe(true);
  });

  it('un error con IA no se presenta como análisis local exitoso', async () => {
    const { service, ai } = fixture();
    ai.generate.mockRejectedValueOnce(new Error('Proveedor no disponible'));
    await expect(service.analyze(user, 'matter-1', 'summary', { mode: 'ai' })).rejects.toThrow('Proveedor no disponible');
  });

  it('no analiza entidades inaccesibles ni acepta modos desconocidos', async () => {
    const { service, matters, ai } = fixture();
    await expect(service.analyze(user, 'matter-1', 'summary', { mode: 'otro' as never })).rejects.toThrow('Selecciona análisis');
    expect(matters.get).not.toHaveBeenCalled();
    matters.get.mockRejectedValueOnce(new Error('Expediente no encontrado'));
    await expect(service.analyze(user, 'foreign', 'summary', { mode: 'ai' })).rejects.toThrow('Expediente no encontrado');
    expect(ai.generate).not.toHaveBeenCalled();
  });
});
