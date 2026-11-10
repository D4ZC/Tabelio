import { describe, expect, it, vi } from 'vitest';
import { DocumentComparisonService } from './document-comparison.service';

function fixture(count = 2) {
  const comparison = { currentDocument: { id: 'doc-2', version: 2, originalName: 'v2.docx' }, previousDocument: { id: 'doc-1', version: 1, originalName: 'v1.docx' }, changes: Array.from({ length: count }, (_, i) => ({ paragraph: i + 1, before: i ? '' : 'Antes', after: 'Después' })) };
  const documents = { comparePrevious: vi.fn().mockResolvedValue(comparison) };
  const ai = { generate: vi.fn().mockResolvedValue({ title: 'Explicación', summary: 'Dos cambios.', items: [] }) };
  return { service: new DocumentComparisonService(documents as never, ai as never), comparison, documents, ai };
}

describe('comparación local y explicación con IA', () => {
  it('conserva comparación exacta autorizada sin llamar a IA por defecto', async () => {
    const { service, documents, ai } = fixture();
    const user = { organizationId: 'org' } as never;
    const result = await service.analyze(user, 'doc-2');
    expect(documents.comparePrevious).toHaveBeenCalledWith(user, 'doc-2');
    expect(result.facts?.changedParagraphs).toBe(2);
    expect(result.items[0].detail).toContain('Antes: Antes');
    expect(result.items[1].title).toContain('incorporado');
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it('describe una comparación sin cambios sin inventar diferencias', async () => {
    const { service } = fixture(0);
    const result = await service.analyze({} as never, 'doc-2');
    expect(result.summary).toContain('No se detectaron diferencias');
    expect(result.items).toEqual([]);
    expect(result.sources).toHaveLength(1);
  });

  it('limita fuentes y texto incluso con numerosos párrafos y conserva el total real', async () => {
    const { service, comparison, ai } = fixture(100);
    for (const change of comparison.changes) change.after = '\u0001\\"'.repeat(10_000);
    const result = await service.analyze({} as never, 'doc-2', { mode: 'ai' });
    const options = ai.generate.mock.calls[0][1] as unknown as { sources: Array<{ text: string }>; localResult: unknown };
    expect(options.sources.length).toBeLessThanOrEqual(20);
    expect(options.sources.reduce((sum, source) => sum + source.text.length, 0)).toBeLessThanOrEqual(40_000);
    expect(JSON.stringify(options.localResult).length).toBeLessThanOrEqual(40_000);
    expect(result.facts?.changedParagraphs).toBe(100);
    expect(result.limitations.some((note) => note.includes('primeros 19 de 100'))).toBe(true);
  });

  it('respeta restricciones de versiones y no ofrece un resultado alterno al fallar IA', async () => {
    const { service, documents, ai } = fixture();
    documents.comparePrevious.mockRejectedValueOnce(new Error('Documento no encontrado'));
    await expect(service.analyze({} as never, 'foreign', { mode: 'ai' })).rejects.toThrow('Documento no encontrado');
    expect(ai.generate).not.toHaveBeenCalled();
    ai.generate.mockRejectedValueOnce(new Error('IA falló'));
    await expect(service.analyze({} as never, 'doc-2', { mode: 'ai' })).rejects.toThrow('IA falló');
  });
});
