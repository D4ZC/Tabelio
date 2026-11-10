import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DocumentType, MatterStatus, Prisma } from '@despacho/database';
import { hasPermission, type Permission } from '@despacho/domain';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { Readable } from 'node:stream';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { DocumentsService } from '../documents/documents.service';
import { ObjectStorageService } from '../documents/object-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AttachLibraryDocumentDto } from './dto/attach-library-document.dto';
import type { LibraryQueryDto } from './dto/library-query.dto';

const librarySummarySelect = {
  id: true,
  externalId: true,
  title: true,
  source: true,
  originalPath: true,
  documentType: true,
  documentTypeLabel: true,
  legalFamily: true,
  variant: true,
  usage: true,
  packageId: true,
  packageLabel: true,
  sha256: true,
  sizeBytes: true,
  mimeType: true,
  duplicateOf: true,
  textEquivalentTo: true,
  review: true,
} satisfies Prisma.LibraryDocumentSelect;

const libraryInternalSelect = {
  ...librarySummarySelect,
  collectionId: true,
  objectKey: true,
} satisfies Prisma.LibraryDocumentSelect;

type LibrarySummaryRow = Prisma.LibraryDocumentGetPayload<{ select: typeof librarySummarySelect }>;
type LibraryInternalRow = Prisma.LibraryDocumentGetPayload<{ select: typeof libraryInternalSelect }>;

interface LibraryReview {
  notes: string[];
  blockers: string[];
  fields: string[];
  subdocuments: string[];
  confidence: string;
}

interface AttachmentResult {
  id: string;
  sourceDocumentId: string;
  fileName: string;
  status: 'attached' | 'existing' | 'failed';
  documentId?: string;
  error?: string;
}

const FAMILY_LABELS: Record<string, string> = {
  arrendamiento: 'Arrendamiento',
  promesa_compraventa: 'Promesa de compraventa',
  divorcio: 'Divorcio',
  franquicia: 'Franquicia',
  reconocimiento_adeudo_credito: 'Reconocimiento de adeudo y crédito',
  administrativo: 'Administrativo',
  materia_por_revisar: 'Materia por revisar',
};

const USAGE_LABELS: Record<string, string> = {
  plantilla_base: 'Plantilla base',
  modelo_personalizado: 'Modelo personalizado',
  caso_referencia: 'Caso de referencia',
  recurso_institucional: 'Recurso institucional',
};

const VARIANT_LABELS: Record<string, string> = {
  acreedora_bancaria_acreditada_moral_obligados: 'Crédito bancario con acreditada moral y obligados',
  administradora_moral_con_obligado: 'Administradora moral con obligado solidario',
  arrendadora_moral_representada_sin_obligado: 'Arrendadora moral representada sin obligado',
  aviso_integral_con_firmas: 'Aviso de privacidad integral con firmas',
  barbacos_sociedad_por_apoderado: 'Barbacos con apoderado',
  cancelacion_por_solicitud_no_formalizada: 'Cancelación por solicitud sin formalizar',
  cancelacion_solicitud_no_formalizada: 'Cancelación por solicitud sin formalizar',
  caviace_persona_moral_solicitante_y_fisica_complementaria: 'Caviace con solicitante moral y complementaria física',
  credito_moral_fisica_con_obligada_borrador_2023: 'Crédito de moral a física con obligada y revisión pendiente',
  divorcio_con_hijos_custodia_convivencia_alimentos: 'Divorcio con hijos, custodia, convivencia y alimentos',
  divorcio_con_hijos_y_alimentos: 'Divorcio con hijos y alimentos',
  dos_personas_fisicas_con_materia_prestamo_arrendamiento_inconsistente: 'Dos personas físicas con materia por revisar',
  fisica_con_moral_sin_fiador: 'Física con moral sin fiador',
  fisica_con_moral_y_fiador_fisico: 'Física con moral y fiador físico',
  fisica_moral_con_obligado_fisico: 'Física con moral y obligado físico',
  fisica_moral_sin_obligado: 'Física con moral sin obligado',
  fisicas_con_fiador: 'Personas físicas con fiador',
  fisicas_con_fiador__escobar: 'Personas físicas con fiador de Escobar',
  fisicas_con_fiador__peri_esperanza: 'Personas físicas con fiador de Peri Esperanza',
  fisicas_con_obligado: 'Personas físicas con obligado solidario',
  fisicas_con_obligado__variante_julio_rios: 'Personas físicas con obligado de Julio Ríos',
  fisicas_sin_fiador: 'Personas físicas sin fiador',
  fisicas_sin_fiador__escobar: 'Personas físicas sin fiador de Escobar',
  fisicas_sin_fiador__peri_esperanza: 'Personas físicas sin fiador de Peri Esperanza',
  fisicas_sin_obligado: 'Personas físicas sin obligado',
  fisicas_sin_obligado__variante_julio_rios: 'Personas físicas sin obligado de Julio Ríos',
  pollo_bronco_sociedad_por_apoderado: 'Pollo Bronco con apoderado',
  pollo_bronco_sociedad_por_presidente: 'Pollo Bronco con presidente',
  pollo_pepe_sociedad_por_apoderado: 'Pollo Pepe con apoderado',
  pollo_pepe_sociedad_por_presidente: 'Pollo Pepe con presidente',
  presentacion_ija_promesa_compraventa: 'Presentación al IJA de promesa de compraventa',
  promesa_compraventa_con_residuo_arrendamiento: 'Promesa de compraventa con redacción por revisar',
  promesa_compraventa_personas_fisicas: 'Promesa de compraventa entre personas físicas',
  promesa_entre_personas_fisicas: 'Promesa entre personas físicas',
  solicitud_y_acuerdos_promesa_compraventa: 'Solicitud y acuerdos de promesa de compraventa',
};

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

function humanLabel(value: string) {
  const text = value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text[0].toLocaleUpperCase('es-MX') + text.slice(1) : 'Sin especificar';
}

function reviewValue(value: Prisma.JsonValue): LibraryReview {
  const object = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const strings = (candidate: unknown): string[] => Array.isArray(candidate)
    ? candidate.filter((item): item is string => typeof item === 'string') : [];
  return {
    notes: strings(object.notes),
    blockers: strings(object.blockers),
    fields: strings(object.fields),
    subdocuments: strings(object.subdocuments),
    confidence: typeof object.confidence === 'string' ? object.confidence : 'por_revisar',
  };
}

@Injectable()
export class LibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthenticatedUser, query: LibraryQueryDto) {
    this.requirePermission(user, 'DOCUMENT_READ');
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const where = this.where(user.organizationId, query);
    const [all, total, documents] = await Promise.all([
      this.prisma.libraryDocument.findMany({
        where: { organizationId: user.organizationId },
        select: {
          collectionId: true, sha256: true, source: true,
          documentType: true, documentTypeLabel: true, legalFamily: true,
          usage: true, variant: true, packageId: true, packageLabel: true,
        },
      }),
      this.prisma.libraryDocument.count({ where }),
      this.prisma.libraryDocument.findMany({
        where,
        select: librarySummarySelect,
        orderBy: [{ source: 'asc' }, { packageLabel: 'asc' }, { documentTypeLabel: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    type Facet = { value: string; label: string; count: number };
    const facets = {
      sources: new Map<string, Facet>(),
      documentTypes: new Map<string, Facet>(),
      legalFamilies: new Map<string, Facet>(),
      usages: new Map<string, Facet>(),
      variants: new Map<string, Facet>(),
      packages: new Map<string, Facet>(),
    };
    const increment = (map: Map<string, Facet>, value: string, label: string) => {
      const entry = map.get(value);
      if (entry) entry.count += 1;
      else map.set(value, { value, label, count: 1 });
    };
    const bySource: Record<string, number> = {};
    const packages = new Set<string>();
    for (const document of all) {
      bySource[document.source] = (bySource[document.source] ?? 0) + 1;
      packages.add(JSON.stringify([document.collectionId, document.packageId]));
      increment(facets.sources, document.source, document.source);
      increment(facets.documentTypes, document.documentType, document.documentTypeLabel);
      increment(facets.legalFamilies, document.legalFamily, FAMILY_LABELS[document.legalFamily] ?? humanLabel(document.legalFamily));
      increment(facets.usages, document.usage, USAGE_LABELS[document.usage] ?? humanLabel(document.usage));
      increment(facets.variants, document.variant, VARIANT_LABELS[document.variant] ?? humanLabel(document.variant));
      increment(facets.packages, document.packageId, document.packageLabel);
    }
    const sorted = (values: Map<string, Facet>) => [...values.values()].sort((left, right) => (
      left.label.localeCompare(right.label, 'es-MX') || left.value.localeCompare(right.value)
    ));
    return {
      summary: {
        total: all.length,
        uniqueFiles: new Set(all.map((document) => document.sha256)).size,
        packages: packages.size,
        bySource,
      },
      facets: {
        sources: sorted(facets.sources), documentTypes: sorted(facets.documentTypes),
        legalFamilies: sorted(facets.legalFamilies), usages: sorted(facets.usages),
        variants: sorted(facets.variants), packages: sorted(facets.packages),
      },
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      documents: documents.map((document) => this.summary(document)),
    };
  }

  async detail(user: AuthenticatedUser, id: string) {
    this.requirePermission(user, 'DOCUMENT_READ');
    const document = await this.prisma.libraryDocument.findFirst({
      where: { id, organizationId: user.organizationId },
      select: { ...librarySummarySelect, collectionId: true, text: true },
    });
    if (!document) throw new NotFoundException('Documento de biblioteca no encontrado');
    const relatedDocuments = await this.prisma.libraryDocument.findMany({
      where: {
        organizationId: user.organizationId,
        collectionId: document.collectionId,
        packageId: document.packageId,
        id: { not: document.id },
      },
      select: librarySummarySelect,
      orderBy: [{ documentTypeLabel: 'asc' }, { id: 'asc' }],
    });
    return { ...this.summary(document), text: document.text, relatedDocuments: relatedDocuments.map((row) => this.summary(row)) };
  }

  async download(user: AuthenticatedUser, id: string) {
    this.requirePermission(user, 'DOCUMENT_READ');
    const document = await this.findInternal(user.organizationId, id);
    const stream = await this.storage.open(document.objectKey);
    await this.audit.record({
      organizationId: user.organizationId,
      actorUserId: user.userId,
      action: 'LIBRARY_DOCUMENT_DOWNLOADED',
      entityType: 'LibraryDocument',
      entityId: document.id,
      payload: { collectionId: document.collectionId, externalId: document.externalId },
    });
    return { fileName: this.fileName(document), mimeType: document.mimeType, sizeBytes: document.sizeBytes, stream };
  }

  async attach(user: AuthenticatedUser, id: string, dto: AttachLibraryDocumentDto) {
    this.requirePermission(user, 'DOCUMENT_WRITE');
    const document = await this.findInternal(user.organizationId, id);
    await this.requireOpenMatter(user, dto.matterId);
    const packageDocuments = dto.includePackage
      ? await this.prisma.libraryDocument.findMany({
        where: {
          organizationId: user.organizationId,
          collectionId: document.collectionId,
          packageId: document.packageId,
          id: { not: document.id },
        },
        select: libraryInternalSelect,
        orderBy: [{ documentTypeLabel: 'asc' }, { id: 'asc' }],
      }) : [];
    const results: AttachmentResult[] = [];
    for (const source of [document, ...packageDocuments]) {
      const fileName = this.fileName(source);
      const result = { id: source.id, sourceDocumentId: source.externalId, fileName };
      try {
        // Re-check before reuse as well as upload: a duplicate never bypasses the
        // same tenant/closed-matter policy as a new document.
        await this.requireOpenMatter(user, dto.matterId);
        let target = await this.existingDocument(user.organizationId, dto.matterId, source.sha256);
        let status: 'attached' | 'existing' = target ? 'existing' : 'attached';
        if (!target) {
          const buffer = await this.readAttachment(source);
          const file: Express.Multer.File = {
            fieldname: 'file', originalname: fileName, encoding: '7bit', mimetype: source.mimeType,
            size: buffer.length, buffer, stream: Readable.from([buffer]), destination: '', filename: fileName, path: '',
          };
          try {
            target = await this.documents.upload(user, dto.matterId, { type: DocumentType.OTHER }, file);
          } catch (cause) {
            if (!(cause instanceof ConflictException)) throw cause;
            // A concurrent attachment can win the checksum check in upload.
            // Reuse it only after checking the matter again and finding its SHA.
            await this.requireOpenMatter(user, dto.matterId);
            target = await this.existingDocument(user.organizationId, dto.matterId, source.sha256);
            if (!target) throw cause;
            status = 'existing';
          }
        }
        if (target.invalidatedAt) {
          throw new ConflictException('El archivo existente está invalidado; restáuralo o conserva la invalidación antes de adjuntarlo');
        }
        await this.linkAndAudit(user, dto.matterId, source, target.id, status);
        results.push({ ...result, status, documentId: target.id });
      } catch (cause) {
        results.push({ ...result, status: 'failed', error: this.attachmentError(cause) });
      }
    }
    return { matterId: dto.matterId, results };
  }

  private summary(document: LibrarySummaryRow) {
    // Explicit projection prevents storage keys, buckets and extracted text from
    // leaking into list/package payloads when the caller passes an internal row.
    const {
      id, externalId, title, source, originalPath, documentType, documentTypeLabel,
      legalFamily, variant, usage, packageId, packageLabel, sha256, sizeBytes,
      mimeType, duplicateOf, textEquivalentTo,
    } = document;
    return {
      id, externalId, title, source, originalPath, documentType, documentTypeLabel,
      legalFamily, variant, usage, packageId, packageLabel, sha256, sizeBytes,
      mimeType, duplicateOf, textEquivalentTo,
      review: reviewValue(document.review), readyForGeneration: false as const,
    };
  }

  private where(organizationId: string, query: LibraryQueryDto): Prisma.LibraryDocumentWhereInput {
    const q = query.q?.trim();
    return {
      organizationId,
      ...(query.source ? { source: query.source } : {}),
      ...(query.documentType ? { documentType: query.documentType } : {}),
      ...(query.legalFamily ? { legalFamily: query.legalFamily } : {}),
      ...(query.usage ? { usage: query.usage } : {}),
      ...(query.variant ? { variant: query.variant } : {}),
      ...(query.packageId ? { packageId: query.packageId } : {}),
      ...(q ? {
        OR: ['title', 'originalPath', 'documentTypeLabel', 'packageLabel', 'text'].map((field) => ({
          [field]: { contains: q, mode: 'insensitive' },
        })),
      } : {}),
    };
  }

  private async findInternal(organizationId: string, id: string) {
    const document = await this.prisma.libraryDocument.findFirst({
      where: { id, organizationId }, select: libraryInternalSelect,
    });
    if (!document) throw new NotFoundException('Documento de biblioteca no encontrado');
    return document;
  }

  private requirePermission(user: AuthenticatedUser, permission: Permission) {
    if (!hasPermission(user.role, permission)) throw new ForbiddenException('No tienes permiso para realizar esta acción');
  }

  private async requireOpenMatter(user: AuthenticatedUser, matterId: string) {
    const matter = await this.prisma.matter.findFirst({
      where: { id: matterId, organizationId: user.organizationId }, select: { id: true, status: true },
    });
    if (!matter) throw new NotFoundException('Expediente no encontrado');
    if (matter.status === MatterStatus.CLOSED || matter.status === MatterStatus.CANCELLED) {
      throw new BadRequestException('No se pueden cargar documentos en un expediente concluido');
    }
  }

  private existingDocument(organizationId: string, matterId: string, checksum: string) {
    return this.prisma.document.findFirst({
      where: { organizationId, matterId, checksum }, select: { id: true, invalidatedAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  private fileName(document: Pick<LibrarySummaryRow, 'originalPath' | 'title'>) {
    return basename(document.originalPath.replaceAll('\\', '/')).replace(/[\u0000-\u001f\u007f]/g, '') || `${document.title}.doc`;
  }

  private async readAttachment(document: LibraryInternalRow) {
    const stream = await this.storage.open(document.objectKey);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_ATTACHMENT_BYTES) {
        stream.destroy();
        throw new BadRequestException('El archivo supera el límite de 20 MB');
      }
      chunks.push(buffer);
    }
    const buffer = Buffer.concat(chunks);
    if (buffer.length !== document.sizeBytes || createHash('sha256').update(buffer).digest('hex') !== document.sha256) {
      throw new ConflictException('No se pudo verificar la integridad del archivo de biblioteca');
    }
    return buffer;
  }

  private async linkAndAudit(
    user: AuthenticatedUser,
    matterId: string,
    source: LibraryInternalRow,
    documentId: string,
    status: 'attached' | 'existing',
  ) {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.libraryDocumentLink.upsert({
        where: { libraryDocumentId_documentId: { libraryDocumentId: source.id, documentId } },
        create: { organizationId: user.organizationId, libraryDocumentId: source.id, documentId },
        update: {},
      });
      await this.audit.record({
        organizationId: user.organizationId,
        actorUserId: user.userId,
        matterId,
        action: 'LIBRARY_DOCUMENT_ATTACHED',
        entityType: 'LibraryDocument',
        entityId: source.id,
        payload: { documentId, externalId: source.externalId, collectionId: source.collectionId, packageId: source.packageId, status },
      }, transaction);
    });
  }

  private attachmentError(cause: unknown) {
    if (cause instanceof HttpException && cause.getStatus() < 500) return cause.message;
    return 'No se pudo adjuntar el documento; vuelve a intentarlo';
  }
}
