import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ObjectStorageService } from '../object-storage.service';
import { AiDocumentExtractionService } from './ai-document-extraction.service';
import type { DocumentExtractionPort, ExtractionResult } from './document-extraction.port';
import { LocalDocumentReaderService } from './local-document-reader.service';
import { ManualDocumentExtractionService } from './manual-document-extraction.service';

@Injectable()
export class DocumentReadingService implements DocumentExtractionPort {
  constructor(
    private readonly local: LocalDocumentReaderService,
    private readonly ai: AiDocumentExtractionService,
    private readonly manual: ManualDocumentExtractionService,
    private readonly storage: ObjectStorageService,
  ) {}

  settings() {
    return { ...this.ai.settings(), local: this.local.settings() };
  }

  async requestExtraction(input: Parameters<DocumentExtractionPort['requestExtraction']>[0]): Promise<ExtractionResult> {
    const mode = input.mode ?? 'local';
    if (!['local', 'ai', 'manual'].includes(mode)) throw new BadRequestException('Selecciona lectura local, con IA o captura manual.');
    if (mode === 'manual') return this.manual.requestExtraction();
    if (mode === 'ai') {
      if (!this.ai.settings().enabled) throw new ServiceUnavailableException('La lectura con IA no está habilitada. Puedes usar lectura local o captura manual.');
      return this.ai.requestExtraction(input);
    }
    if (!this.local.settings().enabled) throw new ServiceUnavailableException('La lectura local está desactivada. Puedes capturar los datos manualmente.');
    const stream = await this.storage.open(input.objectKey);
    try {
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        length += buffer.length;
        if (length > 20 * 1024 * 1024) throw new BadRequestException('La lectura local admite archivos de hasta 20 MB.');
        chunks.push(buffer);
      }
      const result = await this.local.read(Buffer.concat(chunks), input.mimeType);
      return {
        status: result.text.trim() ? 'MANUAL_REVIEW' : 'FAILED',
        provider: `local-${result.method}`,
        data: { ...result.data, extractedText: result.text },
        fields: Object.entries(result.data).map(([field, value]) => ({ field, value, confidence: null, source: 'Lectura local sin IA; pendiente de revisión humana' })),
        message: result.message,
      };
    } finally {
      stream.destroy();
    }
  }
}
