export interface ExtractedFieldCandidate {
  field: string;
  value: unknown;
  confidence: number | null;
  source?: string;
}

export interface ExtractionResult {
  status: 'MANUAL_REVIEW' | 'PROCESSING' | 'COMPLETE' | 'FAILED';
  provider: string;
  data: Record<string, unknown> | null;
  fields?: ExtractedFieldCandidate[];
  message?: string;
}

export type DocumentExtractionMode = 'local' | 'ai' | 'manual';

export interface DocumentExtractionPort {
  settings?(): {
    enabled: boolean; provider: string; supportedMimeTypes: string[];
    local?: { enabled: boolean; provider: string; supportedMimeTypes: string[] };
  };
  requestExtraction(input: {
    documentId: string;
    objectKey: string;
    mimeType: string;
    documentType?: string;
    mode?: DocumentExtractionMode;
  }): Promise<ExtractionResult>;
}

export const DOCUMENT_EXTRACTION = Symbol('DOCUMENT_EXTRACTION');
