import { PayloadTooLargeException, ServiceUnavailableException, UnsupportedMediaTypeException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { DocumentConversionUnavailableError } from '../conversion/document-conversion.port';
import { DocumentPreviewService, previewPlan, type PreviewSource } from './document-preview.service';

function service(overrides: Record<string, string> = {}, convertToPdf = vi.fn(async () => ({ buffer: Buffer.from('%PDF-1.7 convertido'), provider: 'prueba' }))) {
  const config = { get: (key: string) => overrides[key] };
  const conversion = { convertDocxToPdf: vi.fn(), convertToPdf };
  return { previews: new DocumentPreviewService(conversion as never, config as never), convertToPdf };
}

function source(partial: Partial<PreviewSource> = {}): PreviewSource {
  return {
    cacheKey: 'document:1:abc',
    mimeType: 'application/msword',
    fileName: 'Contrato de arrendamiento.doc',
    sizeBytes: 12,
    open: vi.fn(async () => Readable.from([Buffer.from('contenido')])),
    ...partial,
  };
}

describe('previewPlan', () => {
  it('muestra en el navegador PDF, imágenes y video', () => {
    expect(previewPlan('application/pdf', 'a.pdf')).toEqual({ mode: 'inline', contentType: 'application/pdf' });
    expect(previewPlan('image/jpeg', 'foto.jpg')).toEqual({ mode: 'inline', contentType: 'image/jpeg' });
    expect(previewPlan('video/mp4', 'video.mp4')).toEqual({ mode: 'inline', contentType: 'video/mp4' });
  });

  it('convierte formatos de oficina con la extensión que LibreOffice necesita', () => {
    expect(previewPlan('application/msword', 'a.doc')).toEqual({ mode: 'convert', extension: 'doc' });
    expect(previewPlan('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'a.xlsx')).toEqual({ mode: 'convert', extension: 'xlsx' });
  });

  it('trata XML y texto como texto plano', () => {
    expect(previewPlan('application/xml', 'factura.xml')).toEqual({ mode: 'text' });
    expect(previewPlan('text/plain; charset=utf-8', 'nota.txt')).toEqual({ mode: 'text' });
  });

  it('usa la extensión sólo cuando el tipo almacenado es genérico', () => {
    expect(previewPlan('application/octet-stream', 'escritura.PDF')).toEqual({ mode: 'inline', contentType: 'application/pdf' });
    expect(previewPlan('', 'anexo.docx')).toEqual({ mode: 'convert', extension: 'docx' });
    expect(previewPlan('application/zip', 'respaldo.pdf')).toEqual({ mode: 'none' });
  });

  it('nunca muestra formatos capaces de ejecutar scripts', () => {
    expect(previewPlan('text/html', 'pagina.html')).toEqual({ mode: 'none' });
    expect(previewPlan('image/svg+xml', 'logo.svg')).toEqual({ mode: 'none' });
    expect(previewPlan('application/octet-stream', 'pagina.html')).toEqual({ mode: 'none' });
  });
});

describe('DocumentPreviewService', () => {
  it('rechaza tipos sin vista previa sin abrir el archivo', async () => {
    const { previews } = service();
    const file = source({ mimeType: 'application/zip', fileName: 'respaldo.zip' });
    await expect(previews.render(file)).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    expect(file.open).not.toHaveBeenCalled();
  });

  it('entrega texto y XML como text/plain', async () => {
    const { previews } = service();
    const content = await previews.render(source({ mimeType: 'application/xml', fileName: 'factura.xml' }));
    expect(content.contentType).toBe('text/plain; charset=utf-8');
  });

  it('convierte Word a PDF y reutiliza la conversión para el mismo contenido', async () => {
    const { previews, convertToPdf } = service();
    const first = await previews.render(source());
    const second = await previews.render(source());
    expect(first).toMatchObject({ contentType: 'application/pdf', fileName: 'Contrato de arrendamiento.pdf' });
    expect(second.body).toBe(first.body);
    expect(convertToPdf).toHaveBeenCalledTimes(1);
    expect(convertToPdf).toHaveBeenCalledWith(expect.objectContaining({ extension: 'doc' }));
  });

  it('comparte una sola conversión entre solicitudes simultáneas', async () => {
    const { previews, convertToPdf } = service();
    await Promise.all([previews.render(source()), previews.render(source()), previews.render(source())]);
    expect(convertToPdf).toHaveBeenCalledTimes(1);
  });

  it('limita archivos demasiado grandes para convertir', async () => {
    const { previews, convertToPdf } = service({ PREVIEW_MAX_CONVERT_MB: '1' });
    await expect(previews.render(source({ sizeBytes: 2 * 1024 * 1024 }))).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(convertToPdf).not.toHaveBeenCalled();
  });

  it('informa cuando LibreOffice no está disponible y no guarda el fallo', async () => {
    const failing = vi.fn(async () => { throw new DocumentConversionUnavailableError('Sin LibreOffice'); });
    const { previews } = service({}, failing as never);
    await expect(previews.render(source())).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(previews.render(source())).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(failing).toHaveBeenCalledTimes(2);
  });
});
