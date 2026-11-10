import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { LocalDocumentReaderService } from '../documents/extraction/local-document-reader.service';
import { localDocumentFields } from '../documents/extraction/local-document-fields';
import { ObjectStorageService } from '../documents/object-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { InsightAiService } from './insight-ai.service';
import type { InsightOptions, InsightResult } from './insight.types';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_LOCAL_TEXT = 30_000;
const MAX_SOURCE_TEXT = 6_000;
const ID_TYPES = new Set(['LANDLORD_ID', 'TENANT_ID', 'GUARANTOR_ID']);
const SUPPORTED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const TYPE_LABELS: Record<string, string> = {
  LANDLORD_ID: 'Identificación del arrendador', TENANT_ID: 'Identificación del arrendatario', GUARANTOR_ID: 'Identificación del fiador',
  TAX_ID: 'Identificación fiscal', PROOF_OF_ADDRESS: 'Comprobante de domicilio', PROPERTY_TITLE: 'Título del inmueble',
  GUARANTEE_PROPERTY_TITLE: 'Título del inmueble en garantía', LEASE_ANNEX: 'Anexo del arrendamiento',
  DRAFT_CONTRACT: 'Contrato en borrador', DRAFT_CONTRACT_PDF: 'Contrato en borrador (PDF)', SIGNED_CONTRACT: 'Contrato firmado',
  TERMINATION_EVIDENCE: 'Evidencia de terminación', OTHER: 'Otro',
};
type Source = Parameters<InsightAiService['generate']>[1]['sources'][number];
type Suggestion = NonNullable<InsightResult['suggestion']>;

@Injectable()
export class DocumentClassificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly reader: LocalDocumentReaderService,
    private readonly ai: InsightAiService,
  ) {}

  async analyze(user: AuthenticatedUser, documentId: string, options: InsightOptions = {}): Promise<InsightResult> {
    const mode = options.mode ?? 'local';
    if (mode !== 'local' && mode !== 'ai') throw new BadRequestException('Selecciona análisis local o con IA.');
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId: user.organizationId },
      select: {
        id: true, organizationId: true, matterId: true, type: true, originalName: true,
        objectKey: true, mimeType: true, sizeBytes: true, invalidatedAt: true,
        extractedData: true, extractionStatus: true,
      },
    });
    if (!document) throw new NotFoundException('Documento no encontrado.');
    if (document.invalidatedAt) throw new BadRequestException('Restaura el documento antes de analizar su clasificación.');
    const matter = document.matterId ? await this.prisma.matter.findFirst({
      where: { id: document.matterId, organizationId: user.organizationId },
      select: { id: true, reference: true, title: true },
    }) : null;
    if (document.matterId && !matter) throw new NotFoundException('Expediente del documento no encontrado.');

    const limitations = [
      'La propuesta no modifica el documento. Revisa la clasificación y guárdala expresamente para aplicarla.',
      'No se infieren personas, inmuebles ni papeles de arrendador, arrendatario o fiador a partir del nombre o domicilio.',
      'Este análisis no verifica la autenticidad del documento.',
    ];
    const approved = await this.prisma.documentExtractionRun.findFirst({
      where: {
        documentId: document.id, organizationId: user.organizationId,
        status: { in: ['COMPLETE', 'MANUAL_REVIEW'] },
        review: { is: { organizationId: user.organizationId, decision: { in: ['CONFIRMED', 'CORRECTED'] } } },
      },
      orderBy: [{ review: { reviewedAt: 'desc' } }, { requestedAt: 'desc' }, { id: 'desc' }],
      select: { rawData: true, review: { select: { confirmedData: true } } },
    });
    let text = storedText(approved?.review?.confirmedData) || storedText(approved?.rawData);
    if (!text && document.extractionStatus === 'COMPLETE') text = storedText(document.extractedData);
    if (!text) {
      const pending = await this.prisma.documentExtractionRun.findFirst({
        where: {
          documentId: document.id, organizationId: user.organizationId,
          status: { in: ['COMPLETE', 'MANUAL_REVIEW'] }, review: { is: null },
        },
        orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }], select: { rawData: true },
      });
      text = storedText(pending?.rawData);
      if (text) limitations.push('El texto procede de una extracción guardada que todavía no tiene revisión humana.');
    }
    let detectedKind: ReturnType<typeof localDocumentFields>['documentKind'];
    if (text) {
      if (text.length > MAX_LOCAL_TEXT) {
        text = text.slice(0, MAX_LOCAL_TEXT);
        limitations.push(`El texto guardado se limitó a ${MAX_LOCAL_TEXT} caracteres para este análisis.`);
      }
      detectedKind = localDocumentFields(text).documentKind;
    } else if (SUPPORTED_MIME_TYPES.has(document.mimeType)) {
      if (document.sizeBytes > MAX_FILE_BYTES) throw new BadRequestException('La clasificación con lectura local admite archivos de hasta 20 MB.');
      const stream = await this.storage.open(document.objectKey);
      try {
        const chunks: Buffer[] = [];
        let length = 0;
        for await (const chunk of stream) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          length += buffer.length;
          if (length > MAX_FILE_BYTES) throw new BadRequestException('La clasificación con lectura local admite archivos de hasta 20 MB.');
          chunks.push(buffer);
        }
        const read = await this.reader.read(Buffer.concat(chunks), document.mimeType);
        text = read.text;
        detectedKind = read.documentKind;
        limitations.push('Se leyó el original localmente para este análisis; su texto y clasificación requieren revisión humana.');
        if (/truncad/i.test(read.message)) limitations.push(`El lector local limitó el texto a ${MAX_LOCAL_TEXT} caracteres.`);
      } finally {
        stream.destroy();
      }
    } else {
      detectedKind = 'UNREADABLE';
      limitations.push('No hay texto guardado y la lectura local sólo admite PDF, JPG o PNG.');
    }
    if (mode === 'ai' && !text.trim()) {
      throw new BadRequestException('No hay texto suficiente para clasificar con IA. Realiza una lectura local legible o revisa el original y clasifícalo manualmente.');
    }
    if (!text.trim()) limitations.push('Sin texto legible, Otro es sólo una opción provisional y requiere clasificación manual.');

    const documentSourceId = `document:${document.id}`;
    const header = `Documento: ${document.originalName.slice(0, 240)}\nClasificación registrada: ${document.type}\nTexto disponible para análisis:\n`;
    const available = MAX_SOURCE_TEXT - header.length;
    if (mode === 'ai' && text.length > available) limitations.push(`La evidencia textual compartida con IA se limita a los primeros ${available} caracteres; puede omitir partes del documento.`);
    const sources: Source[] = [{
      id: documentSourceId, label: document.originalName.slice(0, 200) || 'Documento',
      text: `${header}${text.slice(0, available) || '(No se obtuvo texto legible.)'}`.slice(0, MAX_SOURCE_TEXT),
    }];
    if (matter) sources.push({
      id: `matter:${matter.id}`, label: `Expediente ${matter.reference}`.slice(0, 200),
      text: `Expediente ${matter.reference}: ${matter.title}. El documento ${document.id} pertenece a este expediente.`.slice(0, MAX_SOURCE_TEXT),
    });

    const identification = detectedKind === 'INE';
    const registeredIdentification = identification && ID_TYPES.has(document.type);
    let suggestion: Suggestion = { documentType: detectedKind === 'PROOF_OF_ADDRESS' ? 'PROOF_OF_ADDRESS'
      : registeredIdentification ? document.type as Suggestion['documentType'] : 'OTHER' };
    const localResult = {
      title: `Clasificación actual: ${TYPE_LABELS[document.type] ?? document.type}`,
      summary: !text.trim()
        ? 'No se obtuvo texto legible suficiente para proponer una clasificación fiable. Revisa el original y selecciona el tipo manualmente.'
        : identification
          ? registeredIdentification
            ? 'El texto contiene señales de una identificación. Se conserva el tipo ya registrado; el texto no comprueba el papel de la persona en el expediente.'
            : 'El texto contiene señales de una identificación. Se propone Otro de forma provisional porque el documento no demuestra el papel de la persona en el expediente.'
          : detectedKind === 'PROOF_OF_ADDRESS'
            ? 'El texto contiene señales de un comprobante de domicilio. Revisa el original antes de usar la sugerencia.'
            : 'Las reglas locales no identificaron un tipo específico entre las categorías admitidas. Se propone Otro para revisión manual.',
      items: [{
        title: !text.trim() ? 'Clasificación sin evidencia textual' : identification ? 'Identificación sin papel comprobado' : `Sugerencia: ${TYPE_LABELS[suggestion.documentType]}`,
        detail: !text.trim()
          ? 'Otro es una opción provisional; no se determinó el contenido del archivo a partir de su nombre o clasificación actual.'
          : identification
            ? 'Una INE o IFE por sí sola no permite elegir identificación del arrendador, arrendatario o fiador. Selecciona el papel y la persona manualmente.'
            : 'La sugerencia usa indicios del texto disponible. No asigna automáticamente titular, persona ni inmueble.',
        severity: (!text.trim() || identification ? 'warning' : 'info') as 'warning' | 'info', sourceIds: [documentSourceId],
      }],
    };
    let analysis: { title: string; summary: string; items: InsightResult['items'] } = localResult;
    if (mode === 'ai') {
      const generated = await this.ai.generate(user, {
        kind: 'classification', sources, localResult, documentId: document.id,
        ...(options.conversationId ? { conversationId: options.conversationId } : {}),
      });
      analysis = { title: generated.title, summary: generated.summary, items: generated.items };
      if (generated.suggestedDocumentKind === 'IDENTIFICATION') {
        suggestion = { documentType: ID_TYPES.has(document.type) ? document.type as Suggestion['documentType'] : 'OTHER' };
        limitations.push(ID_TYPES.has(document.type)
          ? 'La IA detectó una identificación y conservó el tipo de identificación ya registrado; no verificó el papel ni la persona asociados.'
          : 'La IA detectó una identificación, pero debes elegir manualmente el papel de la persona; la sugerencia provisional es Otro.');
      } else suggestion = { documentType: generated.suggestedDocumentKind === 'PROOF_OF_ADDRESS' ? 'PROOF_OF_ADDRESS' : 'OTHER' };
    } else {
      limitations.push('El análisis local usa reglas de texto y no realiza llamadas al proveedor de IA.');
    }
    return {
      kind: 'classification', mode, generatedAt: new Date().toISOString(), ...analysis,
      sources: sources.map(({ id, label }) => ({ id, label })), suggestion, limitations,
    };
  }
}

function storedText(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const data = value as Record<string, unknown>;
  const text = typeof data.extractedText === 'string' ? data.extractedText : data.text;
  return typeof text === 'string' ? text.trim() : '';
}
