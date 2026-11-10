import { describe, expect, it } from 'vitest';
import { ManualDocumentExtractionService } from './manual-document-extraction.service';

describe('ManualDocumentExtractionService', () => {
  it('mantiene la revisión humana y no inventa datos extraídos', async () => {
    const service = new ManualDocumentExtractionService();

    const result = await service.requestExtraction({
      documentId: 'document-1',
      objectKey: 'organization/matter/document.pdf',
      mimeType: 'application/pdf',
    });

    expect(result.status).toBe('MANUAL_REVIEW');
    expect(result.provider).toBe('manual');
    expect(result.data).toBeNull();
  });
});

