import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  DocumentReviewDecision,
  DocumentType,
  ExtractionReviewDecision,
  ExtractionStatus,
  MatterKind,
  MatterStatus,
  PersonType,
  Prisma,
  SignatureStatus,
  TerminationStatus,
  type Person,
} from '@despacho/database';
import { currentDocuments, hasPermission } from '@despacho/domain';
import { createHash, randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import { PrismaService } from '../prisma/prisma.service';
import type { UploadDocumentDto } from './dto/upload-document.dto';
import type { GenerateAgreementDraftDto } from './dto/generate-agreement-draft.dto';
import type { GenerateLeaseDraftDto } from './dto/generate-lease-draft.dto';
import { DocxTemplateService } from './docx-template.service';
import {
  DOCUMENT_EXTRACTION,
  type DocumentExtractionPort,
  type ExtractionResult,
  type DocumentExtractionMode,
} from './extraction/document-extraction.port';
import { ObjectStorageService } from './object-storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { numberWithWords, spanishDateParts, spanishTime } from './spanish-format';
import { appendAdditionalClauses, extractDocxParagraphs } from './docx-template';
import type { CompleteSignatureDto } from './dto/signature.dto';
import type { CompleteTerminationDto } from './dto/termination.dto';
import type {
  DocumentValidityQueryDto,
  DocumentValidityStatus,
  UpdateDocumentValidityDto,
} from './dto/document-validity.dto';
import type { UpdateDocumentClassificationDto } from './dto/document-classification.dto';
import {
  SIGNATURE_PROVIDER,
  type SignatureProviderPort,
} from './signature/signature-provider.port';
import {
  DOCUMENT_CONVERSION,
  DocumentConversionFailedError,
  DocumentConversionUnavailableError,
  type DocumentConversionPort,
} from './conversion/document-conversion.port';
import { TasksService } from '../tasks/tasks.service';
import type { ExtractionQueueQueryDto, ReviewExtractionDto } from './dto/extraction-review.dto';
import { IDENTITY_DOCUMENT_TYPES, identityPersonChanges } from './extraction/identity-fields';
import type { DeleteDocumentDto } from './dto/delete-document.dto';

const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/heic',
]);

const ALLOWED_SIGNED_CONTRACT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const CONTROLLED_DOCUMENT_TYPES = new Set<DocumentType>([
  DocumentType.DRAFT_CONTRACT,
  DocumentType.DRAFT_CONTRACT_PDF,
  DocumentType.SIGNED_CONTRACT,
  DocumentType.TERMINATION_EVIDENCE,
]);

const ALLOWED_TERMINATION_EVIDENCE_MIME_TYPES = new Set([
  ...ALLOWED_SIGNED_CONTRACT_MIME_TYPES,
  'image/jpeg',
  'image/png',
  'image/heic',
]);

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly audit: AuditService,
    private readonly templates: DocxTemplateService,
    @Inject(DOCUMENT_EXTRACTION) private readonly extraction: DocumentExtractionPort,
    @Inject(SIGNATURE_PROVIDER) private readonly signatureProvider: SignatureProviderPort,
    @Inject(DOCUMENT_CONVERSION) private readonly conversion: DocumentConversionPort,
    private readonly notifications: NotificationsService,
    private readonly tasks: TasksService,
    @Optional() private readonly usage?: AiUsageService,
  ) {}

  async upload(
    user: AuthenticatedUser,
    matterId: string,
    dto: UploadDocumentDto,
    file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Selecciona un archivo');
    if (CONTROLLED_DOCUMENT_TYPES.has(dto.type)) {
      throw new BadRequestException('Este tipo documental se carga desde su flujo controlado');
    }
    if (!ALLOWED_DOCUMENT_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Formato no permitido. Usa PDF, Word, JPG, PNG o HEIC');
    }
    const matter = await this.prisma.matter.findFirst({
      where: { id: matterId, organizationId: user.organizationId },
    });
    if (!matter) throw new NotFoundException('Expediente no encontrado');
    if (matter.status === MatterStatus.CLOSED || matter.status === MatterStatus.CANCELLED) {
      throw new BadRequestException('No se pueden cargar documentos en un expediente concluido');
    }

    if (dto.personId) {
      const person = await this.prisma.person.findFirst({
        where: { id: dto.personId, organizationId: user.organizationId },
      });
      if (!person) throw new NotFoundException('Persona no encontrada');
    }
    if (dto.propertyId) {
      const property = await this.prisma.property.findFirst({
        where: { id: dto.propertyId, organizationId: user.organizationId },
      });
      if (!property) throw new NotFoundException('Inmueble no encontrado');
    }

    const issuedAt = dto.issuedAt ? this.documentDate(dto.issuedAt, 'start') : undefined;
    const expiresAt = dto.expiresAt ? this.documentDate(dto.expiresAt, 'end') : undefined;
    this.assertValidityRange(issuedAt, expiresAt);
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    await this.assertDocumentNotDuplicate(user.organizationId, matterId, checksum);
    const safeExtension = extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10);
    const key = `${user.organizationId}/${matterId}/${randomUUID()}${safeExtension}`;
    await this.storage.put(key, file);

    const latestVersion = await this.prisma.document.findFirst({
      where: {
        organizationId: user.organizationId,
        matterId,
        type: dto.type,
      },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const document = await this.prisma.document.create({
      data: {
        organizationId: user.organizationId,
        matterId,
        personId: dto.personId,
        propertyId: dto.propertyId,
        type: dto.type,
        originalName: file.originalname,
        objectKey: key,
        bucket: this.storage.bucket,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        checksum,
        version: (latestVersion?.version ?? 0) + 1,
        issuedAt,
        expiresAt,
        uploadedById: user.userId,
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId,
      actorUserId: user.userId,
      action: 'DOCUMENT_UPLOADED',
      entityType: 'Document',
      entityId: document.id,
      payload: {
        type: dto.type,
        originalName: file.originalname,
        version: document.version,
        personId: dto.personId,
        propertyId: dto.propertyId,
        issuedAt: issuedAt?.toISOString(),
        expiresAt: expiresAt?.toISOString(),
      },
    });
    await this.syncDocumentValidityTasks(user, matterId);
    return document;
  }

  async uploadBatch(
    user: AuthenticatedUser,
    matterId: string,
    serializedMetadata: string,
    files?: Express.Multer.File[],
  ) {
    if (!files?.length) throw new BadRequestException('Selecciona al menos un archivo');

    const matter = await this.prisma.matter.findFirst({
      where: { id: matterId, organizationId: user.organizationId },
      select: { id: true, status: true },
    });
    if (!matter) throw new NotFoundException('Expediente no encontrado');
    if (matter.status === MatterStatus.CLOSED || matter.status === MatterStatus.CANCELLED) {
      throw new BadRequestException('No se pueden cargar documentos en un expediente concluido');
    }

    let rawMetadata: unknown;
    try {
      rawMetadata = JSON.parse(serializedMetadata);
    } catch {
      throw new BadRequestException('La clasificación del lote no es JSON válido');
    }
    if (!Array.isArray(rawMetadata) || rawMetadata.length !== files.length) {
      throw new BadRequestException('Cada archivo debe tener una clasificación correspondiente');
    }

    const results: Array<Record<string, unknown>> = [];
    for (const [index, file] of files.entries()) {
      const rawItem = rawMetadata[index];
      try {
        const item = this.batchUploadItem(rawItem);
        const document = await this.upload(user, matterId, item, file);
        results.push({
          index,
          originalName: file.originalname,
          type: item.type,
          status: 'SUCCESS',
          document: {
            id: document.id,
            type: document.type,
            originalName: document.originalName,
            version: document.version,
            personId: document.personId,
            propertyId: document.propertyId,
            issuedAt: document.issuedAt,
            expiresAt: document.expiresAt,
          },
        });
      } catch (cause) {
        results.push({
          index,
          originalName: file.originalname,
          type: this.batchItemType(rawItem),
          status: 'FAILED',
          error: this.batchErrorMessage(cause),
        });
      }
    }

    const succeeded = results.filter((result) => result.status === 'SUCCESS').length;
    return {
      total: files.length,
      succeeded,
      failed: files.length - succeeded,
      results,
    };
  }

  async listValidity(user: AuthenticatedUser, query: DocumentValidityQueryDto) {
    const asOf = this.asOfDay(query.asOf);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const text = query.q?.trim().toLocaleLowerCase('es-MX');
    const allActiveDocuments = await this.prisma.document.findMany({
      where: { organizationId: user.organizationId, invalidatedAt: null },
      select: {
        id: true,
        matterId: true,
        type: true,
        originalName: true,
        mimeType: true,
        version: true,
        personId: true,
        propertyId: true,
        issuedAt: true,
        expiresAt: true,
        createdAt: true,
        invalidatedAt: true,
        matter: { select: { id: true, reference: true, title: true, status: true } },
        person: { select: { id: true, legalName: true } },
        property: { select: { id: true, displayName: true } },
        uploadedBy: { select: { id: true, displayName: true } },
        libraryLinks: {
          where: { organizationId: user.organizationId },
          select: { libraryDocument: { select: { id: true, source: true, documentTypeLabel: true, packageLabel: true } } },
        },
      },
    });
    const operationalDocuments = currentDocuments(allActiveDocuments).map((document) => ({
      ...document,
      ...this.validityFor(document.expiresAt, asOf),
    }));
    const matchesText = (document: (typeof operationalDocuments)[number]) => !text || [
      document.originalName,
      document.matter?.reference,
      document.matter?.title,
      document.person?.legalName,
      document.property?.displayName,
      ...(document.libraryLinks ?? []).flatMap((link) => [
        link.libraryDocument.source,
        link.libraryDocument.documentTypeLabel,
        link.libraryDocument.packageLabel,
      ]),
    ].some((value) => value?.toLocaleLowerCase('es-MX').includes(text));
    const filtered = operationalDocuments
      .filter((document) => matchesText(document) && (!query.status || document.validityStatus === query.status))
      .sort((left, right) => {
        if (!left.expiresAt && right.expiresAt) return 1;
        if (left.expiresAt && !right.expiresAt) return -1;
        const expiryDifference = (left.expiresAt?.getTime() ?? 0) - (right.expiresAt?.getTime() ?? 0);
        return expiryDifference || right.createdAt.getTime() - left.createdAt.getTime();
      });
    const total = filtered.length;
    const summary = {
      all: operationalDocuments.length,
      expired: operationalDocuments.filter(({ validityStatus }) => validityStatus === 'EXPIRED').length,
      due15: operationalDocuments.filter(({ validityStatus }) => validityStatus === 'DUE_15').length,
      due30: operationalDocuments.filter(({ validityStatus }) => validityStatus === 'DUE_30').length,
      due90: operationalDocuments.filter(({ validityStatus }) => validityStatus === 'DUE_90').length,
      current: operationalDocuments.filter(({ validityStatus }) => validityStatus === 'CURRENT').length,
      undated: operationalDocuments.filter(({ validityStatus }) => validityStatus === 'UNDATED').length,
    };
    const documents = filtered.slice((page - 1) * pageSize, page * pageSize);
    return {
      asOf: asOf.toISOString(),
      summary,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      documents,
    };
  }

  async updateClassification(
    user: AuthenticatedUser,
    documentId: string,
    dto: UpdateDocumentClassificationDto,
  ) {
    if (dto.type === undefined && dto.personId === undefined && dto.propertyId === undefined) {
      throw new BadRequestException('Indica al menos un dato de clasificación para corregir');
    }
    const current = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId: user.organizationId },
    });
    if (!current) throw new NotFoundException('Documento no encontrado');
    if (current.invalidatedAt) {
      throw new BadRequestException('Restaura el documento antes de corregir su clasificación');
    }
    const targetType = dto.type ?? current.type;
    if (CONTROLLED_DOCUMENT_TYPES.has(current.type) || CONTROLLED_DOCUMENT_TYPES.has(targetType)) {
      throw new BadRequestException('La clasificación de este documento pertenece a un flujo controlado');
    }
    if (dto.personId) {
      const person = await this.prisma.person.findFirst({
        where: { id: dto.personId, organizationId: user.organizationId },
        select: { id: true },
      });
      if (!person) throw new NotFoundException('Persona no encontrada');
    }
    if (dto.propertyId) {
      const property = await this.prisma.property.findFirst({
        where: { id: dto.propertyId, organizationId: user.organizationId },
        select: { id: true },
      });
      if (!property) throw new NotFoundException('Inmueble no encontrado');
    }

    let version = current.version;
    if (targetType !== current.type) {
      const latestTarget = await this.prisma.document.findFirst({
        where: {
          organizationId: user.organizationId,
          matterId: current.matterId,
          type: targetType,
          id: { not: current.id },
        },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      version = (latestTarget?.version ?? 0) + 1;
    }

    const document = await this.prisma.document.update({
      where: { id: current.id },
      data: {
        type: targetType,
        version,
        personId: dto.personId === undefined ? undefined : dto.personId,
        propertyId: dto.propertyId === undefined ? undefined : dto.propertyId,
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId: current.matterId ?? undefined,
      actorUserId: user.userId,
      action: 'DOCUMENT_CLASSIFICATION_UPDATED',
      entityType: 'Document',
      entityId: current.id,
      payload: {
        from: {
          type: current.type,
          version: current.version,
          personId: current.personId,
          propertyId: current.propertyId,
        },
        to: {
          type: document.type,
          version: document.version,
          personId: document.personId,
          propertyId: document.propertyId,
        },
      },
    });
    await this.syncDocumentValidityTasks(user, current.matterId);
    return document;
  }

  async updateValidity(
    user: AuthenticatedUser,
    documentId: string,
    dto: UpdateDocumentValidityDto,
  ) {
    if (dto.issuedAt === undefined && dto.expiresAt === undefined) {
      throw new BadRequestException('Indica una fecha de emisión o vencimiento');
    }
    const current = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId: user.organizationId },
    });
    if (!current) throw new NotFoundException('Documento no encontrado');
    if (current.invalidatedAt) {
      throw new BadRequestException('Restaura el documento antes de modificar su vigencia');
    }
    const issuedAt = dto.issuedAt === undefined
      ? current.issuedAt
      : dto.issuedAt === null ? null : this.documentDate(dto.issuedAt, 'start');
    const expiresAt = dto.expiresAt === undefined
      ? current.expiresAt
      : dto.expiresAt === null ? null : this.documentDate(dto.expiresAt, 'end');
    this.assertValidityRange(issuedAt ?? undefined, expiresAt ?? undefined);
    const document = await this.prisma.document.update({
      where: { id: current.id },
      data: { issuedAt, expiresAt },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId: current.matterId ?? undefined,
      actorUserId: user.userId,
      action: 'DOCUMENT_VALIDITY_UPDATED',
      entityType: 'Document',
      entityId: current.id,
      payload: {
        issuedAt: issuedAt?.toISOString() ?? null,
        expiresAt: expiresAt?.toISOString() ?? null,
      },
    });
    await this.syncDocumentValidityTasks(user, current.matterId);
    return { ...document, ...this.validityFor(document.expiresAt, this.asOfDay()) };
  }

  async invalidate(user: AuthenticatedUser, documentId: string, rawReason: string) {
    const reason = rawReason.trim();
    if (reason.length < 10) {
      throw new BadRequestException('El motivo debe tener al menos 10 caracteres');
    }
    const current = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId: user.organizationId },
    });
    if (!current) throw new NotFoundException('Documento no encontrado');
    if (current.invalidatedAt) throw new BadRequestException('El documento ya está invalidado');
    if (CONTROLLED_DOCUMENT_TYPES.has(current.type)) {
      throw new BadRequestException('Este documento pertenece a un flujo jurídico controlado y no puede invalidarse');
    }

    const invalidatedAt = new Date();
    const document = await this.prisma.document.update({
      where: { id: current.id },
      data: {
        invalidatedAt,
        invalidationReason: reason,
        invalidatedById: user.userId,
      },
      include: { invalidatedBy: { select: { id: true, displayName: true } } },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId: current.matterId ?? undefined,
      actorUserId: user.userId,
      action: 'DOCUMENT_INVALIDATED',
      entityType: 'Document',
      entityId: current.id,
      payload: {
        type: current.type,
        version: current.version,
        reason,
        invalidatedAt: invalidatedAt.toISOString(),
      },
    });
    await this.syncDocumentValidityTasks(user, current.matterId);
    return document;
  }

  async restore(user: AuthenticatedUser, documentId: string) {
    const current = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId: user.organizationId },
      include: { invalidatedBy: { select: { id: true, displayName: true } } },
    });
    if (!current) throw new NotFoundException('Documento no encontrado');
    if (!current.invalidatedAt) throw new BadRequestException('El documento ya está activo');

    const invalidation = {
      invalidatedAt: current.invalidatedAt.toISOString(),
      reason: current.invalidationReason,
      invalidatedById: current.invalidatedById,
    };
    const document = await this.prisma.document.update({
      where: { id: current.id },
      data: {
        invalidatedAt: null,
        invalidationReason: null,
        invalidatedById: null,
      },
      include: { invalidatedBy: { select: { id: true, displayName: true } } },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId: current.matterId ?? undefined,
      actorUserId: user.userId,
      action: 'DOCUMENT_RESTORED',
      entityType: 'Document',
      entityId: current.id,
      payload: invalidation,
    });
    await this.syncDocumentValidityTasks(user, current.matterId);
    return document;
  }

  async remove(user: AuthenticatedUser, documentId: string, dto: DeleteDocumentDto) {
    if (!hasPermission(user.role, 'DOCUMENT_WRITE')) {
      throw new ForbiddenException('No tienes permiso para eliminar documentos.');
    }
    const reason = dto.reason?.trim() ?? '';
    if (reason.length < 10 || reason.length > 1000) {
      throw new BadRequestException('El motivo de eliminación debe tener entre 10 y 1000 caracteres.');
    }
    if (dto.confirmation !== 'ELIMINAR') {
      throw new BadRequestException('Escribe ELIMINAR para confirmar el borrado definitivo.');
    }
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId: user.organizationId },
      include: {
        matter: { select: { status: true } },
        portalUpload: { select: { id: true } },
        terminationEvidenceFor: { select: { id: true } },
        _count: { select: {
          derivedDocuments: true, clauseSnapshots: true, reviews: true,
          signatureSources: true, signatureResults: true, taskEvidenceLinks: true,
          extractionRuns: true,
        } },
      },
    });
    if (!document) throw new NotFoundException('Documento no encontrado');
    if (CONTROLLED_DOCUMENT_TYPES.has(document.type) || document.sourceDocumentId
      || document._count.derivedDocuments || document._count.clauseSnapshots || document._count.reviews
      || document._count.signatureSources || document._count.signatureResults
      || document.terminationEvidenceFor || document.portalUpload) {
      throw new BadRequestException('Este archivo forma parte de un flujo jurídico o del portal y debe conservarse. No puede eliminarse.');
    }
    if (document._count.taskEvidenceLinks) {
      throw new BadRequestException('El archivo está vinculado como evidencia de una tarea. Retira ese vínculo antes de eliminarlo o utiliza Invalidar.');
    }
    if (document.matter?.status === MatterStatus.CLOSED || document.matter?.status === MatterStatus.CANCELLED) {
      throw new BadRequestException('No se pueden eliminar archivos de un expediente concluido.');
    }
    if (document.extractionStatus === ExtractionStatus.PROCESSING) {
      throw new ConflictException('Espera a que termine la extracción antes de eliminar este archivo.');
    }

    let backup: Buffer | undefined;
    try {
      const stream = await this.storage.open(document.objectKey);
      const chunks: Buffer[] = [];
      let length = 0;
      try {
        for await (const chunk of stream) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          length += buffer.length;
          if (length > 20 * 1024 * 1024) throw new Error('size');
          chunks.push(buffer);
        }
        backup = Buffer.concat(chunks);
      } finally {
        stream.destroy();
      }
    } catch (error) {
      const failure = error as { code?: string; name?: string; $metadata?: { httpStatusCode?: number } };
      if (failure?.code !== 'ENOENT' && failure?.name !== 'NoSuchKey' && failure?.name !== 'NotFound'
        && failure?.$metadata?.httpStatusCode !== 404) {
        throw new ServiceUnavailableException('No se pudo preparar el archivo para su eliminación. No se modificó el documento.');
      }
    }

    let removalAttempted = false;
    try {
      await this.prisma.$transaction(async (tx) => {
        const removed = await tx.document.deleteMany({
          where: {
            id: document.id, organizationId: user.organizationId,
            type: document.type, version: document.version,
            personId: document.personId, propertyId: document.propertyId,
            sourceDocumentId: null, extractionStatus: document.extractionStatus,
            derivedDocuments: { none: {} }, clauseSnapshots: { none: {} }, reviews: { none: {} },
            signatureSources: { none: {} }, signatureResults: { none: {} }, taskEvidenceLinks: { none: {} },
            portalUpload: { is: null }, terminationEvidenceFor: { is: null },
            extractionRuns: { none: { status: ExtractionStatus.PROCESSING } },
            OR: [
              { matterId: null },
              { matter: { is: { status: { notIn: [MatterStatus.CLOSED, MatterStatus.CANCELLED] } } } },
            ],
          },
        });
        if (removed.count !== 1) {
          throw new ConflictException('El documento cambió o se vinculó a otro proceso. Actualiza la página antes de eliminarlo.');
        }
        await this.audit.record({
          organizationId: user.organizationId, matterId: document.matterId ?? undefined,
          actorUserId: user.userId, action: 'DOCUMENT_DELETED', entityType: 'Document', entityId: document.id,
          payload: {
            reason, originalName: document.originalName, type: document.type, version: document.version,
            personId: document.personId, propertyId: document.propertyId,
            removedExtractionRuns: document._count.extractionRuns,
          },
        }, tx);
        if (backup !== undefined) {
          removalAttempted = true;
          await this.storage.delete(document.objectKey);
        }
      }, { timeout: 30_000 });
    } catch (error) {
      if (removalAttempted && backup !== undefined) {
        try {
          await this.storage.putBuffer(document.objectKey, backup, document.mimeType, document.originalName);
        } catch (restoreError) {
          if ((restoreError as NodeJS.ErrnoException)?.code !== 'EEXIST') {
            this.logger.error(`No se pudo recuperar el archivo del documento ${document.id} después de cancelar su eliminación.`);
            throw new InternalServerErrorException('La eliminación no se completó y el archivo requiere recuperación. Contacta al administrador.');
          }
        }
      }
      if (error instanceof HttpException) throw error;
      if ((error as { code?: string })?.code === 'P2003') {
        throw new ConflictException('El archivo se vinculó a otro proceso y no puede eliminarse. Actualiza la página.');
      }
      throw new ServiceUnavailableException('No se pudo completar la eliminación. Actualiza la página antes de reintentar.');
    }
    await this.syncDocumentValidityTasks(user, document.matterId);
    return { id: document.id, deleted: true };
  }

  async generateLeaseDraft(
    user: AuthenticatedUser,
    matterId: string,
    dto: GenerateLeaseDraftDto,
  ) {
    const matter = await this.prisma.matter.findFirst({
      where: { id: matterId, organizationId: user.organizationId },
      include: {
        property: true,
        guaranteeProperty: true,
        parties: { include: { person: true }, orderBy: { createdAt: 'asc' } },
        leaseTerms: true,
        checklistItems: true,
      },
    });
    if (!matter) throw new NotFoundException('Expediente no encontrado');
    if (matter.kind !== MatterKind.LEASE) {
      throw new BadRequestException('La plantilla v1 sólo genera contratos de arrendamiento');
    }
    const draftableStatuses: MatterStatus[] = [
      MatterStatus.READY_TO_DRAFT,
      MatterStatus.DRAFTING,
    ];
    if (!draftableStatuses.includes(matter.status)) {
      throw new BadRequestException('El expediente debe estar listo para elaborar antes de generar');
    }
    const blockingPending = matter.checklistItems.filter((item) => item.blocking && item.status === 'PENDING');
    if (blockingPending.length) {
      throw new BadRequestException(`Existen ${blockingPending.length} requisito(s) bloqueante(s) pendiente(s)`);
    }

    const landlord = matter.parties.find((party) => party.role === 'LANDLORD')?.person;
    const tenant = matter.parties.find((party) => party.role === 'TENANT')?.person;
    const guarantor = matter.parties.find((party) => party.role === 'GUARANTOR')?.person;
    const property = matter.property;
    const guarantee = matter.guaranteeProperty;
    const terms = matter.leaseTerms;
    const issues: string[] = [];

    if (!landlord) issues.push('arrendador');
    if (!tenant) issues.push('arrendatario');
    if (!guarantor) issues.push('obligado solidario');
    if (!property) issues.push('inmueble arrendado');
    if (!guarantee) issues.push('inmueble en garantía requerido por la plantilla v1');
    if (!terms) issues.push('condiciones de arrendamiento');
    if (guarantee && !guarantee.ownershipEvidence?.trim()) issues.push('acreditación textual del inmueble en garantía');
    if (terms && !terms.paymentMethod?.trim()) issues.push('forma o cuenta de pago');

    if (terms) {
      if (terms.currency !== 'MXN') issues.push('la plantilla v1 sólo admite moneda MXN');
      if (terms.dueDay !== 5) issues.push('la plantilla v1 fija el pago al día 5');
      if (!terms.maintenanceIncluded) issues.push('la plantilla v1 requiere mantenimiento incluido');
      if (terms.durationMonths !== 12) issues.push('la plantilla v1 fija una duración de 12 meses');
      if (terms.noticeDays !== 30) issues.push('la plantilla v1 fija un aviso de 30 días');
      if (Number(terms.lateFeePercent) !== 5) issues.push('la plantilla v1 fija mora de 5 %');
      if (Number(terms.holdoverSurchargePercent) !== 50) issues.push('la plantilla v1 fija sobreprecio de 50 %');
      if (terms.earlyTerminationPenaltyMonths !== 2) issues.push('la plantilla v1 fija penalidad de dos meses');
      if (terms.prepaidRentAmount === null || Number(terms.prepaidRentAmount) <= 0) {
        issues.push('renta adelantada mayor a cero');
      }
      if (terms.depositAmount === null) issues.push('depósito');
    }

    const landlordGrammar = landlord ? this.personGrammar(landlord.type, landlord.gender, 'LANDLORD', issues) : undefined;
    const tenantGrammar = tenant ? this.personGrammar(tenant.type, tenant.gender, 'TENANT', issues) : undefined;
    const guarantorGrammar = guarantor ? this.personGrammar(guarantor.type, guarantor.gender, 'GUARANTOR', issues) : undefined;
    if (issues.length) throw new BadRequestException(`No se puede generar el contrato: ${issues.join('; ')}`);

    const deposit = Number(terms!.depositAmount);
    const prepaid = Number(terms!.prepaidRentAmount);
    const total = terms!.totalInitialPayment === null
      ? deposit + prepaid
      : Number(terms!.totalInitialPayment);
    const values: Record<string, string> = {
      LANDLORD_NAME: landlord!.legalName,
      TENANT_NAME: tenant!.legalName,
      GUARANTOR_NAME: guarantor!.legalName,
      PROPERTY_ADDRESS: this.propertyAddress(property!),
      RENT_AMOUNT: this.money(terms!.rentAmount),
      PAYMENT_METHOD: terms!.paymentMethod!.trim(),
      START_DATE: this.date(terms!.startDate),
      END_DATE: this.date(terms!.endDate),
      TOTAL_INITIAL_PAYMENT: this.money(total),
      PREPAID_RENT_AMOUNT: this.money(prepaid),
      DEPOSIT_AMOUNT: this.money(deposit),
      GUARANTEE_PROPERTY_ADDRESS: this.propertyAddress(guarantee!),
      GUARANTEE_OWNERSHIP_EVIDENCE: guarantee!.ownershipEvidence!.trim(),
      EXECUTION_DATE: this.date(new Date(dto.executionDate)),
      PROPERTY_USE: this.lowerFirst(property!.useType.trim()),
      LANDLORD_HONORIFIC: landlordGrammar!.honorific,
      LANDLORD_RELATIVE_ARTICLE: landlordGrammar!.relativeArticle,
      LANDLORD_ROLE: landlordGrammar!.role,
      LANDLORD_ROLE_WITH_COLON: `${landlordGrammar!.role}:`,
      LANDLORD_OWNER_ADJECTIVE: landlordGrammar!.ownerAdjective,
      TENANT_HONORIFIC: tenantGrammar!.honorific,
      TENANT_RELATIVE_ARTICLE: tenantGrammar!.relativeArticle,
      TENANT_ROLE: tenantGrammar!.role,
      TENANT_ROLE_WITH_COLON: `${tenantGrammar!.role}:`,
      TENANT_ONLY_ADJECTIVE_UPPER: tenantGrammar!.onlyAdjective.toLocaleUpperCase('es-MX'),
      TENANT_CITED_ADJECTIVE: tenantGrammar!.citedAdjective,
      TENANT_REQUIRED_ADJECTIVE: tenantGrammar!.requiredAdjective,
      TENANT_AWARE_ADJECTIVE: tenantGrammar!.awareAdjective,
      GUARANTOR_HONORIFIC: guarantorGrammar!.honorific,
      GUARANTOR_ROLE: guarantorGrammar!.role,
      GUARANTOR_ROLE_NO_ARTICLE: guarantorGrammar!.roleNoArticle,
      GUARANTOR_ROLE_WITH_COLON: `${guarantorGrammar!.role}:`,
    };

    const clauseSelections = await this.selectedClauses(user.organizationId, matterId);
    const rendered = await this.templates.renderLeaseV1(values);
    const buffer = appendAdditionalClauses(rendered, clauseSelections.map((selection) => ({
      title: selection.clause.title,
      body: selection.clauseVersion.body,
    })));
    const key = `${user.organizationId}/${matterId}/${randomUUID()}.docx`;
    const latestVersion = await this.prisma.document.findFirst({
      where: { organizationId: user.organizationId, matterId, type: DocumentType.DRAFT_CONTRACT },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (latestVersion?.version ?? 0) + 1;
    const originalName = `Contrato ${matter.reference} v${version}.docx`;
    const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    await this.storage.putBuffer(key, buffer, mimeType, originalName);

    const document = await this.prisma.document.create({
      data: {
        organizationId: user.organizationId,
        matterId,
        propertyId: property!.id,
        type: DocumentType.DRAFT_CONTRACT,
        originalName,
        objectKey: key,
        bucket: this.storage.bucket,
        mimeType,
        sizeBytes: buffer.length,
        checksum: createHash('sha256').update(buffer).digest('hex'),
        version,
        uploadedById: user.userId,
        clauseSnapshots: {
          create: clauseSelections.map((selection) => ({
            organizationId: user.organizationId,
            clauseVersionId: selection.clauseVersionId,
            code: selection.clause.code,
            title: selection.clause.title,
            body: selection.clauseVersion.body,
            clauseVersionNumber: selection.clauseVersion.version,
            sortOrder: selection.sortOrder,
          })),
        },
      },
      include: { clauseSnapshots: { orderBy: { sortOrder: 'asc' } } },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId,
      actorUserId: user.userId,
      action: 'LEASE_DRAFT_GENERATED',
      entityType: 'Document',
      entityId: document.id,
      payload: {
        template: 'lease-v1',
        version,
        executionDate: dto.executionDate,
        clauses: clauseSelections.map((selection) => ({
          code: selection.clause.code,
          version: selection.clauseVersion.version,
        })),
      },
    });
    return document;
  }

  async generateAgreementDraft(
    user: AuthenticatedUser,
    matterId: string,
    dto: GenerateAgreementDraftDto,
  ) {
    const matter = await this.prisma.matter.findFirst({
      where: { id: matterId, organizationId: user.organizationId },
      include: {
        parties: { include: { person: true }, orderBy: { createdAt: 'asc' } },
        mediationTerms: true,
        checklistItems: true,
        linkedMatter: {
          include: {
            property: true,
            guaranteeProperty: true,
            parties: { include: { person: true }, orderBy: { createdAt: 'asc' } },
            leaseTerms: true,
          },
        },
      },
    });
    if (!matter) throw new NotFoundException('Expediente no encontrado');
    if (matter.kind !== MatterKind.MEDIATION_AGREEMENT) {
      throw new BadRequestException('La plantilla v1 sólo genera convenios de mediación');
    }
    const draftableStatuses: MatterStatus[] = [
      MatterStatus.READY_TO_DRAFT,
      MatterStatus.DRAFTING,
    ];
    if (!draftableStatuses.includes(matter.status)) {
      throw new BadRequestException('El expediente debe estar listo para elaborar antes de generar');
    }
    const blockingPending = matter.checklistItems.filter((item) => item.blocking && item.status === 'PENDING');
    if (blockingPending.length) {
      throw new BadRequestException(`Existen ${blockingPending.length} requisito(s) bloqueante(s) pendiente(s)`);
    }

    const linked = matter.linkedMatter;
    const issues: string[] = [];
    if (!linked || linked.organizationId !== user.organizationId || linked.kind !== MatterKind.LEASE) {
      issues.push('arrendamiento vinculado válido');
    }
    const agreementPerson = (roles: string[], fallbackRole: string) => {
      const direct = roles
        .map((role) => matter.parties.find((party) => party.role === role))
        .find(Boolean);
      const fallback = linked?.parties.find((party) => party.role === fallbackRole);
      return direct?.person ?? fallback?.person;
    };
    const requesting = agreementPerson(['REQUESTING_PARTY', 'LANDLORD'], 'LANDLORD');
    const complementary = agreementPerson(['COMPLEMENTARY_PARTY', 'TENANT'], 'TENANT');
    const guarantor = agreementPerson(['GUARANTOR'], 'GUARANTOR');
    const property = linked?.property;
    const guarantee = linked?.guaranteeProperty;
    const terms = linked?.leaseTerms;
    const mediation = matter.mediationTerms;

    if (!requesting) issues.push('parte solicitante');
    if (!complementary) issues.push('parte complementaria');
    if (!guarantor) issues.push('parte complementaria A u obligado solidario');
    if (!property) issues.push('inmueble del arrendamiento vinculado');
    if (!guarantee) issues.push('inmueble en garantía del arrendamiento vinculado');
    if (!terms) issues.push('condiciones del arrendamiento vinculado');
    if (!mediation) issues.push('datos de mediación');
    if (matter.propertyId && linked?.propertyId && matter.propertyId !== linked.propertyId) {
      issues.push('el inmueble del convenio no coincide con el arrendamiento vinculado');
    }

    if (requesting) this.validateAgreementPerson('parte solicitante', requesting, issues);
    if (complementary) this.validateAgreementPerson('parte complementaria', complementary, issues);
    if (guarantor) this.validateAgreementPerson('obligado solidario', guarantor, issues);
    if (property && !property.ownershipEvidence?.trim()) {
      issues.push('acreditación textual de propiedad del inmueble arrendado');
    }
    if (guarantee && !guarantee.ownershipEvidence?.trim()) {
      issues.push('acreditación textual del inmueble en garantía');
    }
    if (terms) {
      if (terms.currency !== 'MXN') issues.push('la plantilla v1 sólo admite moneda MXN');
      if (!terms.paymentMethod?.trim()) issues.push('forma o cuenta de pago');
      if ((terms.paymentMethod?.trim().length ?? 0) > 90) issues.push('forma de pago de máximo 90 caracteres');
      if (!terms.maintenanceIncluded) issues.push('la plantilla v1 requiere mantenimiento incluido');
      if (terms.noticeDays !== 30) issues.push('la plantilla v1 fija un aviso de 30 días');
      if (Number(terms.holdoverSurchargePercent) !== 50) issues.push('la plantilla v1 fija sobreprecio de 50 %');
      if (terms.earlyTerminationPenaltyMonths !== 2) issues.push('la plantilla v1 fija penalidad de dos meses');
    }
    if (mediation) {
      if (!mediation.agreementNumber?.trim()) issues.push('número de convenio');
      if (!mediation.caseFileNumber?.trim()) issues.push('número de expediente de mediación');
      if (!mediation.hearingAt) issues.push('fecha y hora de audiencia');
      if (!mediation.centerName?.trim()) issues.push('nombre del centro');
      if (!mediation.centerAccreditationNumber?.trim()) issues.push('acreditación del centro');
      if (!mediation.facilitatorName?.trim()) issues.push('persona facilitadora');
      if (!mediation.facilitatorCertification?.trim()) issues.push('certificación de la persona facilitadora');
      if (mediation.certifiedCopies < 1) issues.push('número de copias certificadas');
    }

    const requestingGrammar = requesting
      ? this.personGrammar(requesting.type, requesting.gender, 'LANDLORD', issues)
      : undefined;
    const complementaryGrammar = complementary
      ? this.personGrammar(complementary.type, complementary.gender, 'TENANT', issues)
      : undefined;
    const guarantorGrammar = guarantor
      ? this.personGrammar(guarantor.type, guarantor.gender, 'GUARANTOR', issues)
      : undefined;
    if (issues.length) throw new BadRequestException(`No se puede generar el convenio: ${issues.join('; ')}`);

    const hearing = spanishDateParts(mediation!.hearingAt!);
    const leaseExecution = spanishDateParts(new Date(dto.leaseExecutionDate));
    const leaseStart = spanishDateParts(terms!.startDate);
    const leaseEnd = spanishDateParts(terms!.endDate);
    const values: Record<string, string> = {
      AGREEMENT_NUMBER: mediation!.agreementNumber!.trim(),
      CASE_FILE_NUMBER: mediation!.caseFileNumber!.trim(),
      CENTER_NAME: mediation!.centerName!.trim(),
      CENTER_ACCREDITATION_DISPLAY: numberWithWords(mediation!.centerAccreditationNumber!),
      FACILITATOR_NAME: mediation!.facilitatorName!.trim(),
      FACILITATOR_CERTIFICATION_DISPLAY: numberWithWords(mediation!.facilitatorCertification!),
      CERTIFIED_COPIES_DISPLAY: numberWithWords(mediation!.certifiedCopies),
      HEARING_TIME: spanishTime(mediation!.hearingAt!),
      HEARING_DAY: hearing.day,
      HEARING_MONTH: hearing.month,
      HEARING_YEAR_DISPLAY: hearing.year,
      LEASE_EXECUTION_DAY_MONTH: `${leaseExecution.day} de ${leaseExecution.month}`,
      LEASE_EXECUTION_YEAR_DISPLAY: leaseExecution.year,
      PROPERTY_ADDRESS: this.propertyAddress(property!),
      LEASE_DURATION: `${numberWithWords(terms!.durationMonths)} meses`,
      LEASE_START_DATE: leaseStart.full,
      LEASE_END_DATE: leaseEnd.full,
      RENT_AMOUNT: this.money(terms!.rentAmount),
      PAYMENT_METHOD: terms!.paymentMethod!.trim(),
      PROPERTY_OWNERSHIP_EVIDENCE: property!.ownershipEvidence!.trim(),
      GUARANTEE_PROPERTY_ADDRESS: this.propertyAddress(guarantee!),
      GUARANTEE_OWNERSHIP_EVIDENCE: guarantee!.ownershipEvidence!.trim(),
      ...this.agreementPersonValues('REQUESTING', requesting!, requestingGrammar!),
      ...this.agreementPersonValues('COMPLEMENTARY', complementary!, complementaryGrammar!),
      ...this.agreementPersonValues('GUARANTOR', guarantor!, guarantorGrammar!),
    };

    const clauseSelections = await this.selectedClauses(user.organizationId, matterId);
    const rendered = await this.templates.renderAgreementV1(values);
    const buffer = appendAdditionalClauses(rendered, clauseSelections.map((selection) => ({
      title: selection.clause.title,
      body: selection.clauseVersion.body,
    })));
    const key = `${user.organizationId}/${matterId}/${randomUUID()}.docx`;
    const latestVersion = await this.prisma.document.findFirst({
      where: { organizationId: user.organizationId, matterId, type: DocumentType.DRAFT_CONTRACT },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (latestVersion?.version ?? 0) + 1;
    const originalName = `Convenio ${matter.reference} v${version}.docx`;
    const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    await this.storage.putBuffer(key, buffer, mimeType, originalName);

    const document = await this.prisma.document.create({
      data: {
        organizationId: user.organizationId,
        matterId,
        propertyId: property!.id,
        type: DocumentType.DRAFT_CONTRACT,
        originalName,
        objectKey: key,
        bucket: this.storage.bucket,
        mimeType,
        sizeBytes: buffer.length,
        checksum: createHash('sha256').update(buffer).digest('hex'),
        version,
        uploadedById: user.userId,
        clauseSnapshots: {
          create: clauseSelections.map((selection) => ({
            organizationId: user.organizationId,
            clauseVersionId: selection.clauseVersionId,
            code: selection.clause.code,
            title: selection.clause.title,
            body: selection.clauseVersion.body,
            clauseVersionNumber: selection.clauseVersion.version,
            sortOrder: selection.sortOrder,
          })),
        },
      },
      include: { clauseSnapshots: { orderBy: { sortOrder: 'asc' } } },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId,
      actorUserId: user.userId,
      action: 'AGREEMENT_DRAFT_GENERATED',
      entityType: 'Document',
      entityId: document.id,
      payload: {
        template: 'agreement-v1',
        version,
        linkedMatterId: linked!.id,
        leaseExecutionDate: dto.leaseExecutionDate,
        clauses: clauseSelections.map((selection) => ({
          code: selection.clause.code,
          version: selection.clauseVersion.version,
        })),
      },
    });
    return document;
  }

  private selectedClauses(organizationId: string, matterId: string) {
    return this.prisma.matterClauseSelection.findMany({
      where: { organizationId, matterId },
      include: { clause: true, clauseVersion: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async generatePdfPreview(user: AuthenticatedUser, sourceDocumentId: string) {
    const source = await this.prisma.document.findFirst({
      where: { id: sourceDocumentId, organizationId: user.organizationId },
      include: { clauseSnapshots: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!source) throw new NotFoundException('Documento no encontrado');
    if (
      source.type !== DocumentType.DRAFT_CONTRACT
      || source.mimeType !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      || !source.matterId
    ) {
      throw new BadRequestException('Sólo se convierten borradores contractuales DOCX');
    }

    const existing = await this.prisma.document.findFirst({
      where: {
        organizationId: user.organizationId,
        sourceDocumentId: source.id,
        type: DocumentType.DRAFT_CONTRACT_PDF,
      },
      include: {
        clauseSnapshots: { orderBy: { sortOrder: 'asc' } },
        sourceDocument: { select: { id: true, originalName: true, version: true, checksum: true } },
      },
    });
    if (existing) return existing;

    let converted;
    try {
      converted = await this.conversion.convertDocxToPdf({
        documentId: source.id,
        buffer: await this.readObject(source.objectKey),
      });
    } catch (error) {
      if (error instanceof DocumentConversionUnavailableError) {
        throw new ServiceUnavailableException(error.message);
      }
      if (error instanceof DocumentConversionFailedError) {
        throw new InternalServerErrorException(`No fue posible generar el PDF: ${error.message}`);
      }
      throw error;
    }

    const key = `${user.organizationId}/${source.matterId}/${randomUUID()}.pdf`;
    const originalName = source.originalName.replace(/\.docx$/i, '.pdf');
    const mimeType = 'application/pdf';
    await this.storage.putBuffer(key, converted.buffer, mimeType, originalName);
    const document = await this.prisma.document.create({
      data: {
        organizationId: user.organizationId,
        matterId: source.matterId,
        personId: source.personId,
        propertyId: source.propertyId,
        sourceDocumentId: source.id,
        type: DocumentType.DRAFT_CONTRACT_PDF,
        originalName,
        objectKey: key,
        bucket: this.storage.bucket,
        mimeType,
        sizeBytes: converted.buffer.length,
        checksum: createHash('sha256').update(converted.buffer).digest('hex'),
        version: source.version,
        uploadedById: user.userId,
        clauseSnapshots: {
          create: source.clauseSnapshots.map((snapshot) => ({
            organizationId: user.organizationId,
            clauseVersionId: snapshot.clauseVersionId,
            code: snapshot.code,
            title: snapshot.title,
            body: snapshot.body,
            clauseVersionNumber: snapshot.clauseVersionNumber,
            sortOrder: snapshot.sortOrder,
          })),
        },
      },
      include: {
        clauseSnapshots: { orderBy: { sortOrder: 'asc' } },
        sourceDocument: { select: { id: true, originalName: true, version: true, checksum: true } },
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId: source.matterId,
      actorUserId: user.userId,
      action: 'DOCUMENT_PDF_GENERATED',
      entityType: 'Document',
      entityId: document.id,
      payload: {
        provider: converted.provider,
        sourceDocumentId: source.id,
        sourceChecksum: source.checksum,
        version: source.version,
        checksum: document.checksum,
      },
    });
    return document;
  }

  async downloadLink(user: AuthenticatedUser, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId: user.organizationId },
      select: { id: true, originalName: true },
    });
    if (!document) throw new NotFoundException('Documento no encontrado');

    return {
      documentId: document.id,
      fileName: document.originalName,
      downloadPath: `/documents/${encodeURIComponent(document.id)}/download`,
    };
  }

  async download(user: AuthenticatedUser, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId: user.organizationId },
    });
    if (!document) throw new NotFoundException('Documento no encontrado');

    const stream = await this.storage.open(document.objectKey);
    await this.audit.record({
      organizationId: user.organizationId,
      matterId: document.matterId ?? undefined,
      actorUserId: user.userId,
      action: 'DOCUMENT_DOWNLOADED',
      entityType: 'Document',
      entityId: document.id,
    });
    return { document, stream };
  }

  async preview(user: AuthenticatedUser, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId: user.organizationId },
    });
    if (!document) throw new NotFoundException('Documento no encontrado');
    if (document.mimeType !== 'application/pdf') {
      throw new BadRequestException('La vista previa sólo está disponible para archivos PDF');
    }
    const stream = await this.storage.open(document.objectKey);
    await this.audit.record({
      organizationId: user.organizationId,
      matterId: document.matterId ?? undefined,
      actorUserId: user.userId,
      action: 'DOCUMENT_PREVIEWED',
      entityType: 'Document',
      entityId: document.id,
    });
    return { document, stream };
  }

  extractionSettings() {
    return this.extraction.settings?.() ?? { enabled: false, provider: 'manual', supportedMimeTypes: [] };
  }

  async requestExtraction(user: AuthenticatedUser, documentId: string, mode: DocumentExtractionMode = 'local') {
    if (!['local', 'ai', 'manual'].includes(mode)) throw new BadRequestException('Selecciona lectura local, con IA o captura manual.');
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId: user.organizationId },
    });
    if (!document) throw new NotFoundException('Documento no encontrado');
    if (document.invalidatedAt) {
      throw new BadRequestException('Restaura el documento antes de solicitar una extracción');
    }

    const pendingRun = await this.prisma.documentExtractionRun.findFirst({
      where: {
        organizationId: user.organizationId,
        documentId: document.id,
        provider: mode === 'ai' ? 'vision' : mode === 'manual' ? 'manual' : { in: ['local-pdf-text', 'local-ocr', 'local-mixed'] },
        status: { in: [ExtractionStatus.MANUAL_REVIEW, ExtractionStatus.PROCESSING] },
        review: { is: null },
      },
      include: {
        requestedBy: { select: { id: true, displayName: true } },
        review: true,
      },
      orderBy: { requestedAt: 'desc' },
    });
    if (pendingRun) {
      return {
        document,
        extraction: {
          runId: pendingRun.id,
          status: pendingRun.status,
          provider: pendingRun.provider,
          data: pendingRun.rawData,
          fields: pendingRun.fieldCandidates,
          message: pendingRun.message,
        },
        run: pendingRun,
      };
    }

    const extract = () => this.extraction.requestExtraction({
      documentId: document.id,
      objectKey: document.objectKey,
      mimeType: document.mimeType,
      documentType: document.type,
      mode,
    });
    const context = this.usage?.currentContext();
    const conversationId = context?.organizationId === user.organizationId
      && context.userId === user.userId ? context.conversationId ?? undefined : undefined;
    const result = this.usage && mode === 'ai'
      ? await this.usage.runOperation(user, {
        conversationId,
        documentId: document.id,
        kind: 'DOCUMENT_EXTRACTION',
        label: 'Lectura de documento del expediente',
      }, extract)
      : await extract();
    return this.recordExtraction(user, document, result);
  }

  async recordExtraction(
    user: AuthenticatedUser,
    document: { id: string; organizationId: string; matterId: string | null },
    result: ExtractionResult,
  ) {
    if (document.organizationId !== user.organizationId) throw new NotFoundException('Documento no encontrado');
    const documentStatus = result.status === 'PROCESSING'
      ? ExtractionStatus.PROCESSING
      : result.status === 'FAILED' ? ExtractionStatus.FAILED : ExtractionStatus.MANUAL_REVIEW;
    const { updated, run } = await this.prisma.$transaction(async (tx) => {
      const createdRun = await tx.documentExtractionRun.create({
        data: {
          organizationId: user.organizationId,
          documentId: document.id,
          provider: result.provider,
          status: ExtractionStatus[result.status],
          rawData: result.data ? result.data as Prisma.InputJsonValue : undefined,
          fieldCandidates: result.fields ? result.fields as unknown as Prisma.InputJsonValue : undefined,
          message: result.message,
          requestedById: user.userId,
          completedAt: result.status === 'PROCESSING' ? undefined : new Date(),
        },
        include: {
          requestedBy: { select: { id: true, displayName: true } },
          review: true,
        },
      });
      const updatedDocument = await tx.document.update({
        where: { id: document.id },
        data: { extractionStatus: documentStatus },
      });
      return { updated: updatedDocument, run: createdRun };
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId: document.matterId ?? undefined,
      actorUserId: user.userId,
      action: 'DOCUMENT_EXTRACTION_REQUESTED',
      entityType: 'Document',
      entityId: document.id,
      payload: { runId: run.id, provider: result.provider, status: result.status },
    });
    return { document: updated, extraction: { ...result, runId: run.id }, run };
  }

  async extractionQueue(user: AuthenticatedUser, query: ExtractionQueueQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const q = query.q?.trim();
    const state = query.state ?? 'PENDING_REVIEW';
    const where: Prisma.DocumentExtractionRunWhereInput = {
      organizationId: user.organizationId,
      ...(query.documentId ? { documentId: query.documentId } : {}),
      ...(state === 'PENDING_REVIEW' ? { review: { is: null } } : {}),
      ...(state === 'REVIEWED' ? { review: { isNot: null } } : {}),
      ...(q ? {
        OR: [
          { document: { originalName: { contains: q, mode: 'insensitive' } } },
          { document: { matter: { reference: { contains: q, mode: 'insensitive' } } } },
          { document: { matter: { title: { contains: q, mode: 'insensitive' } } } },
        ],
      } : {}),
    };
    const [total, runs] = await this.prisma.$transaction([
      this.prisma.documentExtractionRun.count({ where }),
      this.prisma.documentExtractionRun.findMany({
        where,
        include: {
          document: {
            select: {
              id: true,
              type: true,
              originalName: true,
              mimeType: true,
              extractionStatus: true,
              invalidatedAt: true,
              matter: { select: { id: true, reference: true, title: true, status: true } },
              person: true,
              property: { select: { id: true, displayName: true } },
            },
          },
          requestedBy: { select: { id: true, displayName: true } },
          review: {
            include: { reviewedBy: { select: { id: true, displayName: true } } },
          },
        },
        orderBy: { requestedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      state,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      runs,
    };
  }

  async reviewExtraction(
    user: AuthenticatedUser,
    documentId: string,
    runId: string,
    dto: ReviewExtractionDto,
  ) {
    const run = await this.prisma.documentExtractionRun.findFirst({
      where: { id: runId, documentId, organizationId: user.organizationId },
      include: { document: true, review: true },
    });
    if (!run) throw new NotFoundException('Ejecución de extracción no encontrada');
    if (run.document.invalidatedAt) {
      throw new BadRequestException('Restaura el documento antes de revisar la extracción');
    }
    if (run.review) throw new ConflictException('Esta extracción ya cuenta con una revisión inmutable');
    if (run.status === ExtractionStatus.PROCESSING) {
      throw new BadRequestException('La extracción todavía se encuentra en proceso');
    }
    if (dto.decision === ExtractionReviewDecision.CORRECTED && !dto.data) {
      throw new BadRequestException('Una corrección requiere los datos confirmados por el revisor');
    }
    const providerData = run.rawData && typeof run.rawData === 'object' && !Array.isArray(run.rawData)
      ? run.rawData as Record<string, unknown>
      : undefined;
    const confirmedData = dto.decision === ExtractionReviewDecision.REJECTED
      ? undefined
      : dto.data ?? providerData;
    if (
      dto.decision !== ExtractionReviewDecision.REJECTED
      && (!confirmedData || Object.keys(confirmedData).length === 0)
    ) {
      throw new BadRequestException('Captura al menos un dato antes de confirmar la extracción');
    }
    const reviewed = await this.prisma.$transaction(async (tx) => {
      let appliedPersonId: string | undefined;
      let appliedPersonFields: string[] = [];
      if (dto.decision !== ExtractionReviewDecision.REJECTED && dto.personFields?.length) {
        if (!hasPermission(user.role, 'DIRECTORY_WRITE')) {
          throw new ForbiddenException('No tienes permiso para actualizar el Directorio.');
        }
        if (!IDENTITY_DOCUMENT_TYPES.has(run.document.type)) {
          throw new BadRequestException('Sólo puedes aplicar datos personales desde una identificación.');
        }
        const personId = dto.personId ?? run.document.personId;
        if (!personId) throw new BadRequestException('Selecciona la persona cuya ficha deseas actualizar.');
        if (run.document.personId && personId !== run.document.personId) {
          throw new ConflictException('El documento está vinculado a otra persona. Corrige su clasificación antes de aplicar datos.');
        }
        const person = await tx.person.findFirst({ where: { id: personId, organizationId: user.organizationId } });
        if (!person || person.type !== PersonType.INDIVIDUAL) {
          throw new BadRequestException('Selecciona una persona física de tu organización.');
        }
        const changes = identityPersonChanges({
          data: confirmedData!, fields: dto.personFields,
          overwriteFields: dto.overwritePersonFields, expectedValues: dto.expectedPersonValues,
          person: person as unknown as Record<string, unknown>,
        });
        appliedPersonFields = Object.keys(changes);
        if (appliedPersonFields.length) {
          const updated = await tx.person.updateMany({
            where: { id: person.id, organizationId: user.organizationId, updatedAt: person.updatedAt },
            data: changes as Prisma.PersonUpdateManyMutationInput,
          });
          if (updated.count !== 1) {
            throw new ConflictException('La ficha cambió durante la revisión. Actualiza la página antes de guardar.');
          }
        }
        appliedPersonId = person.id;
      }
      await tx.documentExtractionReview.create({
        data: {
          organizationId: user.organizationId,
          extractionRunId: run.id,
          decision: dto.decision,
          confirmedData: confirmedData ? confirmedData as Prisma.InputJsonValue : undefined,
          comment: dto.comment.trim(),
          reviewedById: user.userId,
        },
      });
      const updatedDocument = await tx.document.updateMany({
        where: {
          id: run.documentId,
          organizationId: user.organizationId,
          type: run.document.type,
          personId: run.document.personId,
          propertyId: run.document.propertyId,
          version: run.document.version,
          extractionStatus: run.document.extractionStatus,
          invalidatedAt: null,
        },
        data: {
          extractionStatus: dto.decision === ExtractionReviewDecision.REJECTED
            ? ExtractionStatus.FAILED
            : ExtractionStatus.COMPLETE,
          extractedData: confirmedData
            ? confirmedData as Prisma.InputJsonValue
            : Prisma.JsonNull,
          ...(appliedPersonId ? { personId: appliedPersonId } : {}),
        },
      });
      if (updatedDocument.count !== 1) {
        throw new ConflictException('El documento cambió durante la revisión. Actualiza la página antes de guardar.');
      }
      const result = await tx.documentExtractionRun.findUniqueOrThrow({
        where: { id: run.id },
        include: {
          document: {
            select: { id: true, originalName: true, type: true, extractionStatus: true, extractedData: true },
          },
          requestedBy: { select: { id: true, displayName: true } },
          review: { include: { reviewedBy: { select: { id: true, displayName: true } } } },
        },
      });
      return { ...result, appliedPersonId, appliedPersonFields };
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId: run.document.matterId ?? undefined,
      actorUserId: user.userId,
      action: 'DOCUMENT_EXTRACTION_REVIEWED',
      entityType: 'Document',
      entityId: run.documentId,
      payload: { runId: run.id, decision: dto.decision, personId: reviewed.appliedPersonId, fields: reviewed.appliedPersonFields },
    });
    if (reviewed.appliedPersonId && reviewed.appliedPersonFields.length) {
      await this.audit.record({
        organizationId: user.organizationId, matterId: run.document.matterId ?? undefined,
        actorUserId: user.userId, action: 'PERSON_UPDATED_FROM_IDENTITY',
        entityType: 'Person', entityId: reviewed.appliedPersonId,
        payload: { runId: run.id, documentId, fields: reviewed.appliedPersonFields },
      });
    }
    return reviewed;
  }

  legalApprove(user: AuthenticatedUser, documentId: string, comment: string) {
    return this.reviewDraft(
      user,
      documentId,
      comment,
      DocumentReviewDecision.LEGAL_APPROVED,
      MatterStatus.REVIEW,
      MatterStatus.APPROVAL,
      'DOCUMENT_LEGAL_APPROVED',
    );
  }

  requestLegalChanges(user: AuthenticatedUser, documentId: string, comment: string) {
    return this.reviewDraft(
      user,
      documentId,
      comment,
      DocumentReviewDecision.CHANGES_REQUESTED,
      MatterStatus.REVIEW,
      MatterStatus.DRAFTING,
      'DOCUMENT_LEGAL_CHANGES_REQUESTED',
    );
  }

  finalApprove(user: AuthenticatedUser, documentId: string, comment: string) {
    return this.reviewDraft(
      user,
      documentId,
      comment,
      DocumentReviewDecision.FINAL_APPROVED,
      MatterStatus.APPROVAL,
      MatterStatus.SIGNATURE,
      'DOCUMENT_FINAL_APPROVED',
    );
  }

  requestApprovalChanges(user: AuthenticatedUser, documentId: string, comment: string) {
    return this.reviewDraft(
      user,
      documentId,
      comment,
      DocumentReviewDecision.CHANGES_REQUESTED,
      MatterStatus.APPROVAL,
      MatterStatus.DRAFTING,
      'DOCUMENT_APPROVAL_CHANGES_REQUESTED',
    );
  }

  async comparePrevious(user: AuthenticatedUser, documentId: string) {
    const current = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId: user.organizationId },
    });
    if (!current) throw new NotFoundException('Documento no encontrado');
    if (current.type !== DocumentType.DRAFT_CONTRACT || !current.matterId) {
      throw new BadRequestException('Sólo se comparan versiones de borradores contractuales');
    }

    const previous = await this.prisma.document.findFirst({
      where: {
        organizationId: user.organizationId,
        matterId: current.matterId,
        type: DocumentType.DRAFT_CONTRACT,
        version: { lt: current.version },
      },
      orderBy: { version: 'desc' },
    });
    if (!previous) throw new BadRequestException('El documento no tiene una versión anterior');

    const [currentBuffer, previousBuffer] = await Promise.all([
      this.readObject(current.objectKey),
      this.readObject(previous.objectKey),
    ]);
    let currentParagraphs: string[];
    let previousParagraphs: string[];
    try {
      currentParagraphs = extractDocxParagraphs(currentBuffer);
      previousParagraphs = extractDocxParagraphs(previousBuffer);
    } catch {
      throw new BadRequestException('Las versiones deben ser archivos DOCX válidos para compararlas');
    }

    const changes = Array.from(
      { length: Math.max(currentParagraphs.length, previousParagraphs.length) },
      (_, index) => ({
        paragraph: index + 1,
        before: previousParagraphs[index] ?? '',
        after: currentParagraphs[index] ?? '',
      }),
    ).filter((change) => change.before !== change.after);

    await this.audit.record({
      organizationId: user.organizationId,
      matterId: current.matterId,
      actorUserId: user.userId,
      action: 'DOCUMENT_VERSIONS_COMPARED',
      entityType: 'Document',
      entityId: current.id,
      payload: { currentVersion: current.version, previousVersion: previous.version, changes: changes.length },
    });
    return {
      currentDocument: { id: current.id, originalName: current.originalName, version: current.version },
      previousDocument: { id: previous.id, originalName: previous.originalName, version: previous.version },
      changes,
    };
  }

  async startSignature(user: AuthenticatedUser, matterId: string, notes?: string) {
    const matter = await this.prisma.matter.findFirst({
      where: { id: matterId, organizationId: user.organizationId },
      include: {
        parties: {
          include: { person: { select: { id: true, legalName: true, email: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!matter) throw new NotFoundException('Expediente no encontrado');
    if (matter.status !== MatterStatus.SIGNATURE) {
      throw new BadRequestException('El expediente debe estar en firma');
    }
    const approvedDraft = await this.prisma.document.findFirst({
      where: {
        organizationId: user.organizationId,
        matterId,
        type: DocumentType.DRAFT_CONTRACT,
      },
      include: {
        reviews: {
          where: { decision: DocumentReviewDecision.FINAL_APPROVED },
          take: 1,
        },
        derivedDocuments: {
          where: { type: DocumentType.DRAFT_CONTRACT_PDF },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { version: 'desc' },
    });
    if (!approvedDraft?.reviews.length) {
      throw new BadRequestException('La última versión no cuenta con aprobación final');
    }
    const sourceDocument = approvedDraft.derivedDocuments[0];
    if (!sourceDocument) {
      throw new BadRequestException('La versión aprobada no cuenta con un PDF verificable para firma');
    }
    const pending = await this.prisma.signatureRequest.findFirst({
      where: {
        organizationId: user.organizationId,
        matterId,
        status: SignatureStatus.PENDING,
      },
    });
    if (pending) throw new BadRequestException('Ya existe una solicitud de firma pendiente');

    const signerMap = new Map(
      matter.parties.map((party) => [
        party.person.id,
        { name: party.person.legalName, ...(party.person.email ? { email: party.person.email } : {}) },
      ]),
    );
    const providerRequest = await this.signatureProvider.createRequest({
      matterId,
      sourceDocumentId: sourceDocument.id,
      objectKey: sourceDocument.objectKey,
      signers: [...signerMap.values()],
    });
    const signatureRequest = await this.prisma.signatureRequest.create({
      data: {
        organizationId: user.organizationId,
        matterId,
        sourceDocumentId: sourceDocument.id,
        requestedById: user.userId,
        provider: providerRequest.provider,
        externalReference: providerRequest.externalReference,
        notes: notes?.trim() || undefined,
      },
      include: {
        sourceDocument: { select: { id: true, originalName: true, version: true } },
        requestedBy: { select: { id: true, displayName: true } },
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId,
      actorUserId: user.userId,
      action: 'SIGNATURE_REQUESTED',
      entityType: 'SignatureRequest',
      entityId: signatureRequest.id,
      payload: {
        provider: signatureRequest.provider,
        sourceDocumentId: sourceDocument.id,
        version: sourceDocument.version,
        approvedDraftDocumentId: approvedDraft.id,
        signers: signerMap.size,
      },
    });
    return signatureRequest;
  }

  async completeSignature(
    user: AuthenticatedUser,
    matterId: string,
    signatureId: string,
    dto: CompleteSignatureDto,
    file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Selecciona el contrato firmado');
    if (!ALLOWED_SIGNED_CONTRACT_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('El contrato firmado debe estar en PDF o Word');
    }
    const signatureRequest = await this.prisma.signatureRequest.findFirst({
      where: {
        id: signatureId,
        matterId,
        organizationId: user.organizationId,
      },
      include: { matter: { select: { status: true } } },
    });
    if (!signatureRequest) throw new NotFoundException('Solicitud de firma no encontrada');
    if (signatureRequest.status !== SignatureStatus.PENDING) {
      throw new BadRequestException('La solicitud de firma ya no está pendiente');
    }
    if (signatureRequest.matter.status !== MatterStatus.SIGNATURE) {
      throw new BadRequestException('El expediente ya no se encuentra en firma');
    }

    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    await this.assertDocumentNotDuplicate(user.organizationId, matterId, checksum);

    const signedAt = new Date(dto.signedAt);
    const now = new Date();
    const latestVersion = await this.prisma.document.findFirst({
      where: {
        organizationId: user.organizationId,
        matterId,
        type: DocumentType.SIGNED_CONTRACT,
      },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (latestVersion?.version ?? 0) + 1;
    const safeExtension = extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10);
    const key = `${user.organizationId}/${matterId}/${randomUUID()}${safeExtension}`;
    await this.storage.put(key, file);

    const result = await this.prisma.$transaction(async (tx) => {
      const document = await tx.document.create({
        data: {
          organizationId: user.organizationId,
          matterId,
          type: DocumentType.SIGNED_CONTRACT,
          originalName: file.originalname,
          objectKey: key,
          bucket: this.storage.bucket,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          checksum,
          version,
          uploadedById: user.userId,
        },
      });
      const completed = await tx.signatureRequest.updateMany({
        where: { id: signatureId, status: SignatureStatus.PENDING },
        data: {
          status: SignatureStatus.COMPLETED,
          signedDocumentId: document.id,
          completedById: user.userId,
          completedAt: now,
          signedAt,
          notes: dto.notes?.trim() || signatureRequest.notes,
        },
      });
      const activated = await tx.matter.updateMany({
        where: { id: matterId, organizationId: user.organizationId, status: MatterStatus.SIGNATURE },
        data: { status: MatterStatus.ACTIVE, activatedAt: now },
      });
      if (completed.count !== 1 || activated.count !== 1) {
        throw new BadRequestException('El flujo de firma cambió; actualiza la pantalla e intenta nuevamente');
      }
      const completedRequest = await tx.signatureRequest.findUniqueOrThrow({
        where: { id: signatureId },
        include: {
          sourceDocument: { select: { id: true, originalName: true, version: true } },
          signedDocument: { select: { id: true, originalName: true, version: true } },
          requestedBy: { select: { id: true, displayName: true } },
          completedBy: { select: { id: true, displayName: true } },
        },
      });
      return { document, signatureRequest: completedRequest };
    });

    await this.audit.record({
      organizationId: user.organizationId,
      matterId,
      actorUserId: user.userId,
      action: 'SIGNATURE_COMPLETED_AND_MATTER_ACTIVATED',
      entityType: 'SignatureRequest',
      entityId: signatureId,
      payload: {
        provider: signatureRequest.provider,
        signedDocumentId: result.document.id,
        signedAt: signedAt.toISOString(),
        from: MatterStatus.SIGNATURE,
        to: MatterStatus.ACTIVE,
      },
    });
    await this.notifications.scheduleMatterReminders(user.organizationId, matterId).catch(() => []);
    return {
      ...result,
      matter: { id: matterId, status: MatterStatus.ACTIVE, activatedAt: now },
    };
  }

  async cancelSignature(
    user: AuthenticatedUser,
    matterId: string,
    signatureId: string,
    rawComment: string,
  ) {
    const comment = rawComment.trim();
    if (comment.length < 10) {
      throw new BadRequestException('El motivo de cancelación debe tener al menos 10 caracteres');
    }
    const signatureRequest = await this.prisma.signatureRequest.findFirst({
      where: { id: signatureId, matterId, organizationId: user.organizationId },
    });
    if (!signatureRequest) throw new NotFoundException('Solicitud de firma no encontrada');
    if (signatureRequest.status !== SignatureStatus.PENDING) {
      throw new BadRequestException('Sólo se puede cancelar una solicitud pendiente');
    }
    const cancelled = await this.prisma.signatureRequest.update({
      where: { id: signatureId },
      data: {
        status: SignatureStatus.CANCELLED,
        cancelledById: user.userId,
        cancelledAt: new Date(),
        notes: comment,
      },
      include: {
        sourceDocument: { select: { id: true, originalName: true, version: true } },
        requestedBy: { select: { id: true, displayName: true } },
        cancelledBy: { select: { id: true, displayName: true } },
      },
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId,
      actorUserId: user.userId,
      action: 'SIGNATURE_REQUEST_CANCELLED',
      entityType: 'SignatureRequest',
      entityId: signatureId,
      payload: { comment },
    });
    return cancelled;
  }

  async startTermination(
    user: AuthenticatedUser,
    matterId: string,
    rawReason: string,
    effectiveDate?: string,
  ) {
    const reason = rawReason.trim();
    if (reason.length < 10) {
      throw new BadRequestException('El motivo de terminación debe tener al menos 10 caracteres');
    }
    const matter = await this.prisma.matter.findFirst({
      where: { id: matterId, organizationId: user.organizationId },
      include: {
        relatedMatters: {
          where: {
            kind: MatterKind.LEASE,
            status: { notIn: [MatterStatus.CLOSED, MatterStatus.CANCELLED] },
          },
          select: { reference: true },
          take: 1,
        },
      },
    });
    if (!matter) throw new NotFoundException('Expediente no encontrado');
    if (matter.status !== MatterStatus.ACTIVE && matter.status !== MatterStatus.RENEWAL_DUE) {
      throw new BadRequestException('Sólo se puede terminar un expediente activo o por renovar');
    }
    if (matter.relatedMatters.length > 0) {
      throw new BadRequestException(
        `Cancela o concluye primero la renovación abierta ${matter.relatedMatters[0].reference}`,
      );
    }
    const openProcess = await this.prisma.terminationProcess.findFirst({
      where: { organizationId: user.organizationId, matterId, status: TerminationStatus.OPEN },
    });
    if (openProcess) throw new BadRequestException('Ya existe una terminación abierta');

    const termination = await this.prisma.$transaction(async (tx) => {
      const created = await tx.terminationProcess.create({
        data: {
          organizationId: user.organizationId,
          matterId,
          previousMatterStatus: matter.status,
          reason,
          effectiveDate: effectiveDate ? new Date(effectiveDate) : undefined,
          startedById: user.userId,
        },
        include: { startedBy: { select: { id: true, displayName: true } } },
      });
      const transitioned = await tx.matter.updateMany({
        where: {
          id: matterId,
          organizationId: user.organizationId,
          status: matter.status,
        },
        data: { status: MatterStatus.TERMINATION },
      });
      if (transitioned.count !== 1) {
        throw new BadRequestException('El expediente cambió de estado; actualiza e intenta nuevamente');
      }
      return created;
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId,
      actorUserId: user.userId,
      action: 'TERMINATION_STARTED',
      entityType: 'TerminationProcess',
      entityId: termination.id,
      payload: { reason, effectiveDate, from: matter.status, to: MatterStatus.TERMINATION },
    });
    return termination;
  }

  async cancelTermination(
    user: AuthenticatedUser,
    matterId: string,
    terminationId: string,
    rawReason: string,
  ) {
    const reason = rawReason.trim();
    if (reason.length < 10) {
      throw new BadRequestException('El motivo de cancelación debe tener al menos 10 caracteres');
    }
    const termination = await this.prisma.terminationProcess.findFirst({
      where: { id: terminationId, matterId, organizationId: user.organizationId },
      include: { matter: { select: { status: true } } },
    });
    if (!termination) throw new NotFoundException('Proceso de terminación no encontrado');
    if (termination.status !== TerminationStatus.OPEN || termination.matter.status !== MatterStatus.TERMINATION) {
      throw new BadRequestException('La terminación ya no se encuentra abierta');
    }
    const cancelledAt = new Date();
    const cancelled = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.terminationProcess.update({
        where: { id: terminationId },
        data: {
          status: TerminationStatus.CANCELLED,
          cancelledById: user.userId,
          cancellationReason: reason,
          cancelledAt,
        },
        include: {
          startedBy: { select: { id: true, displayName: true } },
          cancelledBy: { select: { id: true, displayName: true } },
        },
      });
      await tx.matter.update({
        where: { id: matterId },
        data: { status: termination.previousMatterStatus },
      });
      return updated;
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId,
      actorUserId: user.userId,
      action: 'TERMINATION_CANCELLED',
      entityType: 'TerminationProcess',
      entityId: terminationId,
      payload: { reason, from: MatterStatus.TERMINATION, to: termination.previousMatterStatus },
    });
    return cancelled;
  }

  async completeTermination(
    user: AuthenticatedUser,
    matterId: string,
    terminationId: string,
    dto: CompleteTerminationDto,
    file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Selecciona la evidencia de terminación');
    if (!ALLOWED_TERMINATION_EVIDENCE_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('La evidencia debe estar en PDF, Word, JPG, PNG o HEIC');
    }
    const comment = dto.comment.trim();
    if (comment.length < 10) {
      throw new BadRequestException('El cierre debe incluir un comentario de al menos 10 caracteres');
    }
    const termination = await this.prisma.terminationProcess.findFirst({
      where: { id: terminationId, matterId, organizationId: user.organizationId },
      include: { matter: { select: { status: true } } },
    });
    if (!termination) throw new NotFoundException('Proceso de terminación no encontrado');
    if (termination.status !== TerminationStatus.OPEN || termination.matter.status !== MatterStatus.TERMINATION) {
      throw new BadRequestException('La terminación ya no se encuentra abierta');
    }

    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    await this.assertDocumentNotDuplicate(user.organizationId, matterId, checksum);

    const closedAt = new Date(dto.closedAt);
    const latestVersion = await this.prisma.document.findFirst({
      where: {
        organizationId: user.organizationId,
        matterId,
        type: DocumentType.TERMINATION_EVIDENCE,
      },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (latestVersion?.version ?? 0) + 1;
    const safeExtension = extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10);
    const key = `${user.organizationId}/${matterId}/${randomUUID()}${safeExtension}`;
    await this.storage.put(key, file);

    const result = await this.prisma.$transaction(async (tx) => {
      const document = await tx.document.create({
        data: {
          organizationId: user.organizationId,
          matterId,
          type: DocumentType.TERMINATION_EVIDENCE,
          originalName: file.originalname,
          objectKey: key,
          bucket: this.storage.bucket,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          checksum,
          version,
          uploadedById: user.userId,
        },
      });
      const completed = await tx.terminationProcess.updateMany({
        where: { id: terminationId, status: TerminationStatus.OPEN },
        data: {
          status: TerminationStatus.COMPLETED,
          closedById: user.userId,
          closureReason: comment,
          evidenceDocumentId: document.id,
          closedAt,
        },
      });
      const transitioned = await tx.matter.updateMany({
        where: { id: matterId, organizationId: user.organizationId, status: MatterStatus.TERMINATION },
        data: { status: MatterStatus.CLOSED },
      });
      if (completed.count !== 1 || transitioned.count !== 1) {
        throw new BadRequestException('El flujo de terminación cambió; actualiza e intenta nuevamente');
      }
      const completedProcess = await tx.terminationProcess.findUniqueOrThrow({
        where: { id: terminationId },
        include: {
          evidenceDocument: { select: { id: true, originalName: true, version: true } },
          startedBy: { select: { id: true, displayName: true } },
          closedBy: { select: { id: true, displayName: true } },
        },
      });
      return { document, termination: completedProcess };
    });
    await this.audit.record({
      organizationId: user.organizationId,
      matterId,
      actorUserId: user.userId,
      action: 'TERMINATION_COMPLETED_AND_MATTER_CLOSED',
      entityType: 'TerminationProcess',
      entityId: terminationId,
      payload: {
        comment,
        evidenceDocumentId: result.document.id,
        closedAt: closedAt.toISOString(),
        from: MatterStatus.TERMINATION,
        to: MatterStatus.CLOSED,
      },
    });
    await this.notifications.cancelMatterNotifications(user.organizationId, matterId).catch(() => undefined);
    return { ...result, matter: { id: matterId, status: MatterStatus.CLOSED } };
  }

  private async reviewDraft(
    user: AuthenticatedUser,
    documentId: string,
    rawComment: string,
    decision: DocumentReviewDecision,
    requiredStatus: MatterStatus,
    nextStatus: MatterStatus,
    auditAction: string,
  ) {
    const comment = rawComment.trim();
    if (comment.length < 10) {
      throw new BadRequestException('El comentario debe tener al menos 10 caracteres');
    }
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId: user.organizationId },
      include: {
        matter: { select: { id: true, status: true } },
        derivedDocuments: {
          where: { type: DocumentType.DRAFT_CONTRACT_PDF },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!document) throw new NotFoundException('Documento no encontrado');
    if (document.type !== DocumentType.DRAFT_CONTRACT || !document.matterId || !document.matter) {
      throw new BadRequestException('La revisión sólo aplica a borradores contractuales de un expediente');
    }
    const latest = await this.prisma.document.findFirst({
      where: {
        organizationId: user.organizationId,
        matterId: document.matterId,
        type: DocumentType.DRAFT_CONTRACT,
      },
      orderBy: { version: 'desc' },
      select: { id: true, version: true },
    });
    if (latest?.id !== document.id) {
      throw new BadRequestException(`Sólo se puede revisar la versión más reciente (v${latest?.version ?? 0})`);
    }
    if (!document.derivedDocuments.length) {
      throw new BadRequestException('Genera y verifica la vista previa PDF antes de registrar una decisión');
    }
    if (document.matter.status !== requiredStatus) {
      throw new BadRequestException(
        `El expediente debe estar en ${requiredStatus} para registrar esta decisión`,
      );
    }

    const review = await this.prisma.$transaction(async (tx) => {
      const transition = await tx.matter.updateMany({
        where: {
          id: document.matterId!,
          organizationId: user.organizationId,
          status: requiredStatus,
        },
        data: { status: nextStatus },
      });
      if (transition.count !== 1) {
        throw new BadRequestException('El expediente cambió de etapa; actualiza la pantalla e intenta de nuevo');
      }
      return tx.documentReview.create({
        data: {
          organizationId: user.organizationId,
          matterId: document.matterId!,
          documentId: document.id,
          reviewerUserId: user.userId,
          decision,
          comment,
        },
        include: { reviewer: { select: { id: true, displayName: true } } },
      });
    });

    await this.audit.record({
      organizationId: user.organizationId,
      matterId: document.matterId,
      actorUserId: user.userId,
      action: auditAction,
      entityType: 'DocumentReview',
      entityId: review.id,
      payload: {
        documentId: document.id,
        version: document.version,
        decision,
        comment,
        from: requiredStatus,
        to: nextStatus,
      },
    });
    return { review, matter: { id: document.matterId, status: nextStatus } };
  }

  private async readObject(objectKey: string): Promise<Buffer> {
    const stream = await this.storage.open(objectKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  private async assertDocumentNotDuplicate(
    organizationId: string,
    matterId: string,
    checksum: string,
  ) {
    const duplicate = await this.prisma.document.findFirst({
      where: { organizationId, matterId, checksum },
      select: {
        originalName: true,
        type: true,
        version: true,
        invalidatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!duplicate) return;
    const guidance = duplicate.invalidatedAt
      ? 'El registro está invalidado; restáuralo o conserva la invalidación en lugar de volver a cargarlo.'
      : 'Usa el archivo existente o corrige su clasificación si es necesario.';
    throw new ConflictException(
      `El archivo ya existe como ${duplicate.originalName} (${duplicate.type} v${duplicate.version}). ${guidance}`,
    );
  }

  private validityFor(expiresAt: Date | null, asOf: Date) {
    if (!expiresAt) return { validityStatus: 'UNDATED' as const, daysRemaining: null };
    const expiryDay = Date.UTC(expiresAt.getUTCFullYear(), expiresAt.getUTCMonth(), expiresAt.getUTCDate());
    const asOfDay = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
    const daysRemaining = Math.round((expiryDay - asOfDay) / 86_400_000);
    const validityStatus: DocumentValidityStatus = daysRemaining < 0
      ? 'EXPIRED'
      : daysRemaining <= 15 ? 'DUE_15'
        : daysRemaining <= 30 ? 'DUE_30'
          : daysRemaining <= 90 ? 'DUE_90' : 'CURRENT';
    return { validityStatus, daysRemaining };
  }

  private asOfDay(value?: string) {
    const date = value ? new Date(value) : new Date();
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  private documentDate(value: string, boundary: 'start' | 'end') {
    const date = new Date(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      date.setUTCHours(boundary === 'start' ? 0 : 23, boundary === 'start' ? 0 : 59, boundary === 'start' ? 0 : 59, boundary === 'start' ? 0 : 999);
    }
    return date;
  }

  private async syncDocumentValidityTasks(user: AuthenticatedUser, matterId?: string | null) {
    if (!matterId) return;
    await this.tasks.syncDocumentValidityTasksForOrganization(
      user.organizationId,
      new Date(),
      user.userId,
      matterId,
    ).catch(() => undefined);
  }

  private batchUploadItem(value: unknown): UploadDocumentDto {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('La clasificación del archivo es inválida');
    }
    const item = value as Record<string, unknown>;
    if (
      typeof item.type !== 'string'
      || !Object.values(DocumentType).includes(item.type as DocumentType)
    ) {
      throw new BadRequestException('Selecciona un tipo documental válido');
    }
    const optionalString = (field: 'personId' | 'propertyId' | 'issuedAt' | 'expiresAt') => {
      const fieldValue = item[field];
      if (fieldValue === undefined || fieldValue === null || fieldValue === '') return undefined;
      if (typeof fieldValue !== 'string') {
        throw new BadRequestException(`El campo ${field} es inválido`);
      }
      return fieldValue;
    };
    const issuedAt = optionalString('issuedAt');
    const expiresAt = optionalString('expiresAt');
    for (const dateValue of [issuedAt, expiresAt]) {
      if (dateValue && Number.isNaN(new Date(dateValue).getTime())) {
        throw new BadRequestException('Usa fechas documentales válidas');
      }
    }
    return {
      type: item.type as DocumentType,
      personId: optionalString('personId'),
      propertyId: optionalString('propertyId'),
      issuedAt,
      expiresAt,
    };
  }

  private batchItemType(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const type = (value as Record<string, unknown>).type;
    return typeof type === 'string' ? type : undefined;
  }

  private batchErrorMessage(cause: unknown) {
    if (!(cause instanceof HttpException)) return 'No fue posible guardar el archivo';
    const response = cause.getResponse();
    if (typeof response === 'string') return response;
    const message = (response as { message?: string | string[] }).message;
    return Array.isArray(message) ? message.join(', ') : message ?? cause.message;
  }

  private assertValidityRange(issuedAt?: Date, expiresAt?: Date) {
    if (issuedAt && expiresAt && issuedAt > expiresAt) {
      throw new BadRequestException('La fecha de vencimiento no puede ser anterior a la emisión');
    }
  }

  private personGrammar(
    type: PersonType,
    gender: string | null,
    role: 'LANDLORD' | 'TENANT' | 'GUARANTOR',
    issues: string[],
  ) {
    const normalized = gender?.trim().toLocaleLowerCase('es-MX').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const feminine = type === PersonType.COMPANY
      ? true
      : ['f', 'femenino', 'mujer', 'senora'].includes(normalized ?? '')
        ? true
        : ['m', 'masculino', 'hombre', 'senor'].includes(normalized ?? '')
          ? false
          : undefined;
    if (feminine === undefined) issues.push(`género gramatical de la parte ${role.toLocaleLowerCase('es-MX')}`);
    const isFeminine = feminine ?? false;
    const roles = {
      LANDLORD: isFeminine ? 'La Arrendadora' : 'El Arrendador',
      TENANT: isFeminine ? 'La Arrendataria' : 'El Arrendatario',
      GUARANTOR: isFeminine ? 'La Obligada Solidaria' : 'El Obligado Solidario',
    };
    return {
      honorific: type === PersonType.COMPANY ? 'la sociedad' : isFeminine ? 'la señora' : 'el señor',
      honorificNoArticle: type === PersonType.COMPANY ? 'sociedad' : isFeminine ? 'señora' : 'señor',
      relativeArticle: isFeminine ? 'a la' : 'al',
      role: roles[role],
      ownerAdjective: isFeminine ? 'propietaria' : 'propietario',
      onlyAdjective: isFeminine ? 'la única' : 'el único',
      citedAdjective: isFeminine ? 'citada' : 'citado',
      requiredAdjective: isFeminine ? 'requerida' : 'requerido',
      awareAdjective: isFeminine ? 'enterada' : 'enterado',
      capableAdjective: isFeminine ? 'capacitada' : 'capacitado',
      originAdjective: isFeminine ? 'originaria' : 'originario',
      pronoun: isFeminine ? 'Misma' : 'Mismo',
      roleNoArticle: role === 'GUARANTOR'
        ? isFeminine ? 'Obligada Solidaria' : 'Obligado Solidario'
        : roles[role],
    };
  }

  private validateAgreementPerson(label: string, person: Person, issues: string[]) {
    if (person.type !== PersonType.INDIVIDUAL) issues.push(`${label} debe ser persona física en la plantilla v1`);
    const nationality = this.normalized(person.nationality);
    if (!['mexicana', 'mexicano', 'mexico'].includes(nationality)) {
      issues.push(`nacionalidad mexicana de ${label}`);
    }
    const required: Array<[unknown, string]> = [
      [person.birthPlaceCity, 'ciudad de origen'],
      [person.birthPlaceState, 'estado de origen'],
      [person.maritalStatus, 'estado civil'],
      [person.occupation, 'ocupación'],
      [person.addressLine1, 'domicilio'],
      [person.city, 'ciudad del domicilio'],
      [person.state, 'estado del domicilio'],
      [person.taxId, 'RFC'],
      [person.identificationType, 'tipo de identificación'],
      [person.identificationNumber, 'número de identificación'],
    ];
    for (const [value, field] of required) {
      if (typeof value !== 'string' || !value.trim()) issues.push(`${field} de ${label}`);
    }
  }

  private agreementPersonValues(
    prefix: 'REQUESTING' | 'COMPLEMENTARY' | 'GUARANTOR',
    person: Person,
    grammar: ReturnType<DocumentsService['personGrammar']>,
  ): Record<string, string> {
    return {
      [`${prefix}_NAME`]: person.legalName,
      [`${prefix}_HONORIFIC`]: grammar.honorific,
      [`${prefix}_HONORIFIC_NO_ARTICLE`]: grammar.honorificNoArticle,
      [`${prefix}_CAPABLE_ADJECTIVE`]: grammar.capableAdjective,
      [`${prefix}_ORIGIN_ADJECTIVE`]: grammar.originAdjective,
      [`${prefix}_PRONOUN`]: grammar.pronoun,
      [`${prefix}_OWNER_ADJECTIVE`]: grammar.ownerAdjective,
      [`${prefix}_BIRTH_CITY`]: person.birthPlaceCity!.trim(),
      [`${prefix}_BIRTH_STATE`]: this.birthState(person.birthPlaceState!),
      [`${prefix}_MARITAL_STATUS`]: person.maritalStatus!.trim(),
      [`${prefix}_OCCUPATION`]: person.occupation!.trim(),
      [`${prefix}_ADDRESS`]: this.personAddress(person),
      [`${prefix}_TAX_ID`]: person.taxId!.trim(),
      [`${prefix}_IDENTIFICATION`]: `${person.identificationType!.trim()} número ${person.identificationNumber!.trim()}`,
    };
  }

  private personAddress(person: Person) {
    return [
      person.addressLine1,
      person.addressLine2,
      person.postalCode ? `C.P. ${person.postalCode}` : undefined,
      person.city,
      person.state,
      person.country,
    ].filter(Boolean).join(', ');
  }

  private birthState(value: string) {
    const trimmed = value.trim();
    return this.normalized(trimmed).startsWith('estado de') ? trimmed : `estado de ${trimmed}`;
  }

  private normalized(value: string | null | undefined) {
    return value?.trim().toLocaleLowerCase('es-MX').normalize('NFD').replace(/[\u0300-\u036f]/g, '') ?? '';
  }

  private propertyAddress(property: {
    addressLine1: string;
    addressLine2: string | null;
    neighborhood: string | null;
    city: string;
    state: string;
    postalCode: string | null;
    country: string;
  }) {
    return [
      property.addressLine1,
      property.addressLine2,
      property.neighborhood ? `colonia ${property.neighborhood}` : undefined,
      property.postalCode ? `C.P. ${property.postalCode}` : undefined,
      property.city,
      property.state,
      property.country,
    ].filter(Boolean).join(', ');
  }

  private money(value: Prisma.Decimal | number) {
    return new Intl.NumberFormat('es-MX', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value));
  }

  private date(value: Date) {
    return new Intl.DateTimeFormat('es-MX', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(value);
  }

  private lowerFirst(value: string) {
    return value ? `${value[0].toLocaleLowerCase('es-MX')}${value.slice(1)}` : value;
  }
}
