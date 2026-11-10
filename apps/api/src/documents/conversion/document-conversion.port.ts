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
