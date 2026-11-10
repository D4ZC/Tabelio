import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DOCUMENT_EXTRACTION } from './extraction/document-extraction.port';
import { ManualDocumentExtractionService } from './extraction/manual-document-extraction.service';
import { ObjectStorageService } from './object-storage.service';
import { DocxTemplateService } from './docx-template.service';
import { ManualSignatureProviderService } from './signature/manual-signature-provider.service';
import { SIGNATURE_PROVIDER } from './signature/signature-provider.port';
import { DOCUMENT_CONVERSION } from './conversion/document-conversion.port';
import { LibreOfficeDocumentConversionService } from './conversion/libreoffice-document-conversion.service';
import { TasksModule } from '../tasks/tasks.module';
import { AssistantProviderService } from '../assistant/assistant-provider.service';
import { AiDocumentExtractionService } from './extraction/ai-document-extraction.service';
import { LocalDocumentReaderService } from './extraction/local-document-reader.service';
import { DocumentReadingService } from './extraction/document-reading.service';

@Module({
  imports: [TasksModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    ObjectStorageService,
    DocxTemplateService,
    ManualDocumentExtractionService,
    AssistantProviderService,
    AiDocumentExtractionService,
    LocalDocumentReaderService,
    DocumentReadingService,
    ManualSignatureProviderService,
    LibreOfficeDocumentConversionService,
    { provide: DOCUMENT_EXTRACTION, useExisting: DocumentReadingService },
    { provide: SIGNATURE_PROVIDER, useExisting: ManualSignatureProviderService },
    { provide: DOCUMENT_CONVERSION, useExisting: LibreOfficeDocumentConversionService },
  ],
  exports: [ObjectStorageService, DocumentsService, LocalDocumentReaderService],
})
export class DocumentsModule {}
