import 'reflect-metadata';
import { validate } from 'class-validator';
import { describe, expect, it, vi } from 'vitest';
import { REQUIRED_PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { InsightRequestDto } from './insight.dto';
import { InsightsController } from './insights.controller';

describe('contrato HTTP de análisis', () => {
  it('valida modalidades y referencias de conversación', async () => {
    for (const mode of [undefined, 'local', 'ai']) expect(await validate(Object.assign(new InsightRequestDto(), { mode }))).toEqual([]);
    expect(await validate(Object.assign(new InsightRequestDto(), { mode: 'auto' }))).not.toEqual([]);
    expect(await validate(Object.assign(new InsightRequestDto(), { conversationId: 'foreign-not-uuid' }))).not.toEqual([]);
  });

  it('exige permiso de lectura del recurso en cada función', () => {
    for (const method of ['settings', 'summary', 'consistency'] as const) expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, InsightsController.prototype[method])).toEqual(['MATTER_READ']);
    for (const method of ['compare', 'classify'] as const) expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, InsightsController.prototype[method])).toEqual(['DOCUMENT_READ']);
  });

  it('registra sólo metadatos de análisis en auditoría, sin contenido de las fuentes', async () => {
    const result = { kind: 'summary', mode: 'local', summary: 'dato sensible de fixture', sources: [{ id: 'matter:1', label: 'Fuente privada' }] };
    const matters = { analyze: vi.fn().mockResolvedValue(result) };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const controller = new InsightsController(matters as never, {} as never, {} as never, {} as never, audit as never);
    expect(await controller.summary({ organizationId: 'org', userId: 'owner' } as never, 'matter-1', {})).toEqual(result);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'INSIGHT_GENERATED', payload: { kind: 'summary', mode: 'local', sourceCount: 1 } }));
    expect(JSON.stringify(audit.record.mock.calls)).not.toMatch(/dato sensible|Fuente privada/);
  });
});
