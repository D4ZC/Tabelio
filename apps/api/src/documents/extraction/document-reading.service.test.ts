import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { DocumentReadingService } from './document-reading.service';
import { RequestExtractionDto } from '../dto/request-extraction.dto';
import { validate } from 'class-validator';

const input = { documentId: 'fixture', objectKey: 'private/fixture.png', mimeType: 'image/png', documentType: 'TENANT_ID' };

function fixture() {
  const local = {
    settings: vi.fn().mockReturnValue({ enabled: true, provider: 'local', supportedMimeTypes: ['image/png'] }),
    read: vi.fn().mockResolvedValue({ text: 'NOMBRE: PERSONA DE PRUEBA', data: { legalName: 'PERSONA DE PRUEBA' }, method: 'ocr', message: 'Lectura local sin IA.' }),
  };
  const ai = { settings: vi.fn().mockReturnValue({ enabled: true, provider: 'fixture', supportedMimeTypes: ['image/png'] }), requestExtraction: vi.fn().mockResolvedValue({ provider: 'vision', status: 'MANUAL_REVIEW', data: { legalName: 'IA explícita' } }) };
  const manual = { requestExtraction: vi.fn().mockResolvedValue({ provider: 'manual', status: 'MANUAL_REVIEW', data: null }) };
  const stream = Readable.from([Buffer.from('fixture')]);
  const storage = { open: vi.fn().mockResolvedValue(stream) };
  return { service: new DocumentReadingService(local as never, ai as never, manual as never, storage as never), local, ai, manual, stream, storage };
}

describe('selección explícita de lectura documental', () => {
  it('usa lectura local por defecto, conserva texto para revisión y no llama a IA', async () => {
    const { service, local, ai, stream } = fixture();
    expect(await service.requestExtraction(input)).toMatchObject({
      provider: 'local-ocr', status: 'MANUAL_REVIEW', data: { legalName: 'PERSONA DE PRUEBA', extractedText: 'NOMBRE: PERSONA DE PRUEBA' },
    });
    expect(local.read).toHaveBeenCalledWith(Buffer.from('fixture'), 'image/png');
    expect(ai.requestExtraction).not.toHaveBeenCalled();
    expect(stream.destroyed).toBe(true);
  });

  it('no recurre a IA cuando falla el OCR local y cierra el original', async () => {
    const { service, local, ai, stream } = fixture();
    local.read.mockRejectedValueOnce(new Error('Motor local no disponible'));
    await expect(service.requestExtraction(input)).rejects.toThrow('Motor local no disponible');
    expect(ai.requestExtraction).not.toHaveBeenCalled();
    expect(stream.destroyed).toBe(true);
  });

  it('permite revisión del texto local aunque no haya campos identificados', async () => {
    const { service, local } = fixture();
    local.read.mockResolvedValueOnce({ text: 'Texto libre del documento', data: {}, method: 'pdf-text', message: 'Revise el texto.' });
    expect(await service.requestExtraction(input)).toMatchObject({ provider: 'local-pdf-text', status: 'MANUAL_REVIEW', data: { extractedText: 'Texto libre del documento' }, fields: [] });
  });

  it('envía al proveedor únicamente si se elige ai', async () => {
    const { service, ai, local, storage } = fixture();
    await service.requestExtraction({ ...input, mode: 'ai' });
    expect(ai.requestExtraction).toHaveBeenCalledOnce();
    expect(local.read).not.toHaveBeenCalled();
    expect(storage.open).not.toHaveBeenCalled();
  });

  it('captura manual no abre el archivo ni usa ningún motor', async () => {
    const { service, local, ai, manual, storage } = fixture();
    expect(await service.requestExtraction({ ...input, mode: 'manual' })).toMatchObject({ provider: 'manual' });
    expect(manual.requestExtraction).toHaveBeenCalledOnce();
    expect(local.read).not.toHaveBeenCalled();
    expect(ai.requestExtraction).not.toHaveBeenCalled();
    expect(storage.open).not.toHaveBeenCalled();
  });

  it('rechaza IA deshabilitada, archivos grandes y modos desconocidos sin cambiar de motor', async () => {
    const { service, ai, local, storage } = fixture();
    ai.settings.mockReturnValueOnce({ enabled: false, provider: 'fixture', supportedMimeTypes: [] });
    await expect(service.requestExtraction({ ...input, mode: 'ai' })).rejects.toThrow('no está habilitada');
    await expect(service.requestExtraction({ ...input, mode: 'otro' as never })).rejects.toThrow('Selecciona lectura');
    const oversized = Readable.from([Buffer.alloc(20 * 1024 * 1024 + 1)]);
    storage.open.mockResolvedValueOnce(oversized);
    await expect(service.requestExtraction(input)).rejects.toThrow('20 MB');
    expect(oversized.destroyed).toBe(true);
    expect(ai.requestExtraction).not.toHaveBeenCalled();
    expect(local.read).not.toHaveBeenCalled();
  });

  it('valida la opción recibida por HTTP', async () => {
    for (const mode of [undefined, 'local', 'ai', 'manual']) {
      expect(await validate(Object.assign(new RequestExtractionDto(), { mode }))).toEqual([]);
    }
    expect(await validate(Object.assign(new RequestExtractionDto(), { mode: 'otro' }))).not.toEqual([]);
  });
});
