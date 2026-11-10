import { describe, expect, it } from 'vitest';
import { assistantDownloadDocumentId, assistantDownloads } from './assistant-downloads';

describe('descargas del asistente', () => {
  it('reconoce sólo rutas locales exactas de descarga documental', () => {
    expect(assistantDownloadDocumentId('/api/documents/cmv1-test/download')).toBe('cmv1-test');
    expect(assistantDownloadDocumentId('/documents/document_1/download')).toBe('document_1');
    for (const href of [
      undefined, '//example.com/api/documents/id/download',
      'https://example.com/api/documents/id/download', '/api/documents/../download',
      '/api/documents/%2Fetc/download', '/api/documents/id/download?path=/etc/passwd',
      '/api/documents/id/download#preview', '/api/documents/id/preview',
    ]) expect(assistantDownloadDocumentId(href)).toBeUndefined();
  });

  it('conserva metadatos utilizables y elimina duplicados y entradas inválidas', () => {
    expect(assistantDownloads([
      { documentId: 'doc-1', fileName: 'Contrato v2.docx', outputPath: '/servidor/archivo' },
      { documentId: 'doc-1', fileName: 'Duplicado.docx' },
      { documentId: '../doc-2', fileName: 'Otro.docx' },
      { documentId: 'doc-3', fileName: '' },
      { documentId: 'doc-4', fileName: 'Contrato\nincorrecto.docx' },
      null,
      { documentId: 'doc-5', fileName: 'Convenio.pdf' },
    ])).toEqual([
      { documentId: 'doc-1', fileName: 'Contrato v2.docx' },
      { documentId: 'doc-5', fileName: 'Convenio.pdf' },
    ]);
    expect(assistantDownloads({ documentId: 'doc-1' })).toEqual([]);
    expect(assistantDownloads(Array.from({ length: 20 }, (_, i) => ({ documentId: `doc-${i}`, fileName: 'Archivo.docx' })))).toHaveLength(10);
  });
});
