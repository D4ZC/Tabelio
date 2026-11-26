export const DOCUMENT_CONVERSION = Symbol('DOCUMENT_CONVERSION');

export interface DocumentConversionResult {
  buffer: Buffer;
  provider: string;
}

export interface DocumentConversionPort {
  convertDocxToPdf(input: {
    documentId: string;
    buffer: Buffer;
  }): Promise<DocumentConversionResult>;
  /**
   * Convierte cualquier formato de oficina admitido por el proveedor (doc, docx,
   * xls, xlsx, ppt, rtf, odt…). `extension` indica el formato de entrada sin punto.
   */
  convertToPdf(input: {
    documentId: string;
    buffer: Buffer;
    extension: string;
  }): Promise<DocumentConversionResult>;
}

export class DocumentConversionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentConversionUnavailableError';
  }
}

export class DocumentConversionFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentConversionFailedError';
  }
}
