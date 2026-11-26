import { describe, expect, it } from 'vitest';
import { canPreview, decodeText, previewKind } from './file-preview';

describe('canPreview', () => {
  it('ofrece vista previa para PDF, imágenes, Word, Excel y texto', () => {
    expect(canPreview('application/pdf')).toBe(true);
    expect(canPreview('image/jpeg')).toBe(true);
    expect(canPreview('application/msword')).toBe(true);
    expect(canPreview('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(true);
    expect(canPreview('application/xml')).toBe(true);
  });

  it('no la ofrece para comprimidos ni formatos que pueden ejecutar scripts', () => {
    expect(canPreview('application/zip', 'respaldo.zip')).toBe(false);
    expect(canPreview('text/html', 'pagina.html')).toBe(false);
    expect(canPreview('image/svg+xml', 'logo.svg')).toBe(false);
  });

  it('usa la extensión sólo si el tipo es genérico', () => {
    expect(canPreview('application/octet-stream', 'anexo.DOCX')).toBe(true);
    expect(canPreview('application/octet-stream', 'datos.bin')).toBe(false);
    expect(canPreview('application/zip', 'respaldo.pdf')).toBe(false);
  });
});

describe('previewKind', () => {
  it('clasifica la respuesta de la API', () => {
    expect(previewKind('application/pdf')).toBe('pdf');
    expect(previewKind('image/png')).toBe('image');
    expect(previewKind('text/plain; charset=utf-8')).toBe('text');
    expect(previewKind('image/svg+xml')).toBe('unsupported');
    expect(previewKind('text/html')).toBe('unsupported');
  });
});

describe('decodeText', () => {
  it('respeta UTF-8 y recurre a Windows-1252 para archivos antiguos', () => {
    expect(decodeText(new TextEncoder().encode('Señora García').buffer as ArrayBuffer)).toBe('Señora García');
    expect(decodeText(new Uint8Array([0x53, 0x65, 0xf1, 0x6f, 0x72, 0x61]).buffer)).toBe('Señora');
  });
});
