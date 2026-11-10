import { Injectable } from '@nestjs/common';
import type { DocumentExtractionPort, ExtractionResult } from './document-extraction.port';

@Injectable()
export class ManualDocumentExtractionService implements DocumentExtractionPort {
  async requestExtraction(): Promise<ExtractionResult> {
    return {
      status: 'MANUAL_REVIEW',
      provider: 'manual',
      data: null,
      message: 'Este documento requiere captura y validación manual. No se extrajeron datos automáticamente.',
    };
  }
}
