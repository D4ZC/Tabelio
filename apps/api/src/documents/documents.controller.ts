import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { DocumentsService } from './documents.service';
import { GenerateAgreementDraftDto } from './dto/generate-agreement-draft.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { GenerateLeaseDraftDto } from './dto/generate-lease-draft.dto';
import { DocumentReviewDto } from './dto/document-review.dto';
import { CancelSignatureDto, CompleteSignatureDto, StartSignatureDto } from './dto/signature.dto';
import {
  CancelTerminationDto,
  CompleteTerminationDto,
  StartTerminationDto,
} from './dto/termination.dto';
import { DocumentValidityQueryDto, UpdateDocumentValidityDto } from './dto/document-validity.dto';
import { UploadDocumentsBatchDto } from './dto/upload-documents-batch.dto';
import { UpdateDocumentClassificationDto } from './dto/document-classification.dto';
import { InvalidateDocumentDto } from './dto/document-invalidation.dto';
import { ExtractionQueueQueryDto, ReviewExtractionDto } from './dto/extraction-review.dto';
import { DeleteDocumentDto } from './dto/delete-document.dto';
import { RequestExtractionDto } from './dto/request-extraction.dto';

@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('documents')
  @RequirePermissions('DOCUMENT_READ')
  listValidity(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DocumentValidityQueryDto,
  ) {
    return this.documents.listValidity(user, query);
  }

  @Get('extractions')
  @RequirePermissions('DOCUMENT_WRITE')
  extractionQueue(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ExtractionQueueQueryDto,
  ) {
    return this.documents.extractionQueue(user, query);
  }

  @Patch('documents/:id/validity')
  @RequirePermissions('DOCUMENT_WRITE')
  updateValidity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateDocumentValidityDto,
  ) {
    return this.documents.updateValidity(user, id, dto);
  }

  @Patch('documents/:id/classification')
  @RequirePermissions('DOCUMENT_WRITE')
  updateClassification(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateDocumentClassificationDto,
  ) {
    return this.documents.updateClassification(user, id, dto);
  }

  @Post('documents/:id/invalidate')
  @RequirePermissions('DOCUMENT_WRITE')
  invalidate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: InvalidateDocumentDto,
  ) {
    return this.documents.invalidate(user, id, dto.reason);
  }

  @Post('documents/:id/restore')
  @RequirePermissions('DOCUMENT_WRITE')
  restore(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.documents.restore(user, id);
  }

  @Delete('documents/:id')
  @RequirePermissions('DOCUMENT_WRITE')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DeleteDocumentDto,
  ) {
    return this.documents.remove(user, id, dto);
  }

  @Post('matters/:matterId/documents')
  @RequirePermissions('DOCUMENT_WRITE')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matterId') matterId: string,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.documents.upload(user, matterId, dto, file);
  }

  @Post('matters/:matterId/documents/batch')
  @RequirePermissions('DOCUMENT_WRITE')
  @UseInterceptors(FilesInterceptor('files', 10, { limits: { fileSize: 20 * 1024 * 1024 } }))
  uploadBatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matterId') matterId: string,
    @Body() dto: UploadDocumentsBatchDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.documents.uploadBatch(user, matterId, dto.metadata, files);
  }

  @Post('matters/:matterId/documents/generate-lease')
  @RequirePermissions('CONTRACT_GENERATE')
  generateLeaseDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matterId') matterId: string,
    @Body() dto: GenerateLeaseDraftDto,
  ) {
    return this.documents.generateLeaseDraft(user, matterId, dto);
  }

  @Post('matters/:matterId/documents/generate-agreement')
  @RequirePermissions('CONTRACT_GENERATE')
  generateAgreementDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matterId') matterId: string,
    @Body() dto: GenerateAgreementDraftDto,
  ) {
    return this.documents.generateAgreementDraft(user, matterId, dto);
  }

  @Post('documents/:id/pdf-preview')
  @RequirePermissions('CONTRACT_GENERATE')
  generatePdfPreview(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.documents.generatePdfPreview(user, id);
  }

  @Get('documents/extraction-settings')
  @RequirePermissions('DOCUMENT_READ')
  extractionSettings() {
    return this.documents.extractionSettings();
  }

  @Post('documents/:id/extraction')
  @RequirePermissions('DOCUMENT_WRITE')
  extract(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: RequestExtractionDto) {
    return this.documents.requestExtraction(user, id, dto.mode);
  }

  @Post('documents/:documentId/extractions/:runId/review')
  @RequirePermissions('DOCUMENT_WRITE')
  reviewExtraction(
    @CurrentUser() user: AuthenticatedUser,
    @Param('documentId') documentId: string,
    @Param('runId') runId: string,
    @Body() dto: ReviewExtractionDto,
  ) {
    return this.documents.reviewExtraction(user, documentId, runId, dto);
  }

  @Post('matters/:matterId/signatures')
  @RequirePermissions('SIGNATURE_MANAGE')
  startSignature(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matterId') matterId: string,
    @Body() dto: StartSignatureDto,
  ) {
    return this.documents.startSignature(user, matterId, dto.notes);
  }

  @Post('matters/:matterId/signatures/:signatureId/complete')
  @RequirePermissions('SIGNATURE_MANAGE')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  completeSignature(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matterId') matterId: string,
    @Param('signatureId') signatureId: string,
    @Body() dto: CompleteSignatureDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.documents.completeSignature(user, matterId, signatureId, dto, file);
  }

  @Post('matters/:matterId/signatures/:signatureId/cancel')
  @RequirePermissions('SIGNATURE_MANAGE')
  cancelSignature(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matterId') matterId: string,
    @Param('signatureId') signatureId: string,
    @Body() dto: CancelSignatureDto,
  ) {
    return this.documents.cancelSignature(user, matterId, signatureId, dto.comment);
  }

  @Post('matters/:matterId/terminations')
  @RequirePermissions('LIFECYCLE_MANAGE')
  startTermination(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matterId') matterId: string,
    @Body() dto: StartTerminationDto,
  ) {
    return this.documents.startTermination(user, matterId, dto.reason, dto.effectiveDate);
  }

  @Post('matters/:matterId/terminations/:terminationId/cancel')
  @RequirePermissions('LIFECYCLE_MANAGE')
  cancelTermination(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matterId') matterId: string,
    @Param('terminationId') terminationId: string,
    @Body() dto: CancelTerminationDto,
  ) {
    return this.documents.cancelTermination(user, matterId, terminationId, dto.reason);
  }

  @Post('matters/:matterId/terminations/:terminationId/complete')
  @RequirePermissions('LIFECYCLE_MANAGE')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  completeTermination(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matterId') matterId: string,
    @Param('terminationId') terminationId: string,
    @Body() dto: CompleteTerminationDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.documents.completeTermination(user, matterId, terminationId, dto, file);
  }

  @Post('documents/:id/reviews/legal-approve')
  @RequirePermissions('CONTRACT_REVIEW')
  legalApprove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DocumentReviewDto,
  ) {
    return this.documents.legalApprove(user, id, dto.comment);
  }

  @Post('documents/:id/reviews/legal-changes')
  @RequirePermissions('CONTRACT_REVIEW')
  legalChanges(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DocumentReviewDto,
  ) {
    return this.documents.requestLegalChanges(user, id, dto.comment);
  }

  @Post('documents/:id/reviews/final-approve')
  @RequirePermissions('CONTRACT_APPROVE')
  finalApprove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DocumentReviewDto,
  ) {
    return this.documents.finalApprove(user, id, dto.comment);
  }

  @Post('documents/:id/reviews/approval-changes')
  @RequirePermissions('CONTRACT_APPROVE')
  approvalChanges(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DocumentReviewDto,
  ) {
    return this.documents.requestApprovalChanges(user, id, dto.comment);
  }

  @Get('documents/:id/compare-previous')
  @RequirePermissions('DOCUMENT_READ')
  comparePrevious(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.documents.comparePrevious(user, id);
  }

  @Get('documents/:id/download-link')
  @RequirePermissions('DOCUMENT_READ')
  downloadLink(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.documents.downloadLink(user, id);
  }

  @Get('documents/:id/download')
  @RequirePermissions('DOCUMENT_READ')
  async download(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const { document, stream } = await this.documents.download(user, id);
    return new StreamableFile(stream, {
      type: document.mimeType,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(document.originalName)}`,
      length: document.sizeBytes,
    });
  }

  @Get('documents/:id/preview')
  @RequirePermissions('DOCUMENT_READ')
  async preview(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const { document, stream } = await this.documents.preview(user, id);
    return new StreamableFile(stream, {
      type: document.mimeType,
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(document.originalName)}`,
      length: document.sizeBytes,
    });
  }
}
