import { DocumentType, ExtractionReviewDecision, ExtractionStatus, MembershipRole, PersonType, Prisma } from '@despacho/database';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.types';
import { DocumentsService } from './documents.service';
import type { ReviewExtractionDto } from './dto/extraction-review.dto';

const user: AuthenticatedUser = {
  userId: 'usuario-1', email: 'prueba@example.test', displayName: 'Usuario de prueba',
  organizationId: 'organizacion-1', organizationName: 'Organización de prueba',
  membershipId: 'miembro-1', role: MembershipRole.ADMIN,
};
const reviewedAt = new Date('2026-10-29T18:00:00.000Z');

function fixture(usage?: unknown) {
  const document = {
    id: 'documento-1', organizationId: user.organizationId, matterId: 'expediente-1',
    type: DocumentType.TENANT_ID as DocumentType, personId: 'persona-1' as string | null,
    objectKey: 'organizacion/expediente/ine.png', mimeType: 'image/png',
    invalidatedAt: null as Date | null, propertyId: null, version: 1,
    extractionStatus: ExtractionStatus.MANUAL_REVIEW,
  };
  const run = {
    id: 'ejecucion-1', documentId: document.id, organizationId: user.organizationId,
    document, rawData: { givenName: 'Persona de prueba', curp: 'DEMO900101HDFXXX09' },
    status: ExtractionStatus.MANUAL_REVIEW as ExtractionStatus, provider: 'vision',
    review: null as Record<string, unknown> | null,
  };
  const person = {
    id: 'persona-1', organizationId: user.organizationId, type: PersonType.INDIVIDUAL as PersonType,
    legalName: 'Nombre registrado', givenName: null as string | null, curp: null, updatedAt: reviewedAt,
  };
  const tx = {
    person: {
      findFirst: vi.fn().mockResolvedValue(person),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    document: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({ ...document, extractionStatus: ExtractionStatus.MANUAL_REVIEW }),
    },
    documentExtractionReview: { create: vi.fn().mockResolvedValue({ id: 'revision-1' }) },
    documentExtractionRun: {
      create: vi.fn().mockResolvedValue({ ...run }),
      findUniqueOrThrow: vi.fn().mockImplementation(async () => ({ ...run, review: { id: 'revision-1' } })),
    },
  };
  const prisma = {
    document: { findFirst: vi.fn().mockResolvedValue(document) },
    documentExtractionRun: {
      findFirst: vi.fn().mockResolvedValue(run),
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([run]),
    },
    $transaction: vi.fn(async (operation: ((transaction: typeof tx) => unknown) | Promise<unknown>[]) => (
      typeof operation === 'function' ? operation(tx) : Promise.all(operation)
    )),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const extraction = {
    settings: vi.fn().mockReturnValue({ enabled: true, provider: 'provider.example', supportedMimeTypes: ['image/png'] }),
    requestExtraction: vi.fn().mockResolvedValue({ status: 'MANUAL_REVIEW', provider: 'vision', data: run.rawData }),
  };
  const service = new DocumentsService(
    prisma as never, {} as never, audit as never, {} as never, extraction as never,
    {} as never, {} as never, {} as never, {} as never, usage as never,
  );
  const dto: ReviewExtractionDto = {
    decision: ExtractionReviewDecision.CONFIRMED, comment: 'Verificado contra la imagen de prueba.',
    personFields: ['givenName'], expectedPersonValues: { givenName: '' },
  };
  const review = (changes: Partial<ReviewExtractionDto> = {}, actor = user) => (
    service.reviewExtraction(actor, document.id, run.id, { ...dto, ...changes })
  );
  return { service, prisma, tx, audit, extraction, document, run, person, review };
}

describe('solicitud y bandeja de extracción documental', () => {
  it('la lectura local predeterminada no abre una operación de IA y sólo reutiliza resultados locales', async () => {
    const usage = { currentContext: vi.fn(), runOperation: vi.fn() };
    const { service, document, prisma, extraction } = fixture(usage);
    prisma.documentExtractionRun.findFirst.mockResolvedValueOnce(null);
    await service.requestExtraction(user, document.id);
    expect(extraction.requestExtraction).toHaveBeenCalledWith(expect.objectContaining({ mode: 'local' }));
    expect(usage.runOperation).not.toHaveBeenCalled();
    expect(prisma.documentExtractionRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ provider: { in: ['local-pdf-text', 'local-ocr', 'local-mixed'] } }),
    }));
  });

  it('rechaza modos desconocidos antes de leer documentos o registrar consumo', async () => {
    const { service, prisma, extraction } = fixture();
    await expect(service.requestExtraction(user, 'documento-1', 'desconocido' as never)).rejects.toThrow('Selecciona lectura');
    expect(prisma.document.findFirst).not.toHaveBeenCalled();
    expect(extraction.requestExtraction).not.toHaveBeenCalled();
  });

  it('asocia la lectura al chat sólo cuando el contexto corresponde a la identidad que solicita', async () => {
    const usage = {
      currentContext: vi.fn().mockReturnValue({ organizationId: user.organizationId, userId: user.userId, conversationId: 'chat-1' }),
      runOperation: vi.fn(async (_user, _operation, callback: () => Promise<unknown>) => callback()),
    };
    const { service, document, prisma } = fixture(usage);
    prisma.documentExtractionRun.findFirst.mockResolvedValue(null);
    await service.requestExtraction(user, document.id, 'ai');
    expect(usage.runOperation).toHaveBeenLastCalledWith(user, {
      conversationId: 'chat-1', documentId: document.id,
      kind: 'DOCUMENT_EXTRACTION', label: 'Lectura de documento del expediente',
    }, expect.any(Function));
    usage.currentContext.mockReturnValue({ organizationId: user.organizationId, userId: 'otra-persona', conversationId: 'chat-ajeno' });
    await service.requestExtraction(user, document.id, 'ai');
    expect(usage.runOperation).toHaveBeenLastCalledWith(user, expect.objectContaining({ conversationId: undefined }), expect.any(Function));
  });

  it('reutilizar una lectura existente no crea otra operación de IA', async () => {
    const usage = { runOperation: vi.fn(), currentContext: vi.fn() };
    const { service, document } = fixture(usage);
    await service.requestExtraction(user, document.id);
    expect(usage.runOperation).not.toHaveBeenCalled();
  });

  it('expone la configuración pública del adaptador', () => {
    const { service } = fixture();
    expect(service.extractionSettings()).toEqual({ enabled: true, provider: 'provider.example', supportedMimeTypes: ['image/png'] });
  });

  it('guarda una ejecución pendiente sin modificar la ficha de la persona', async () => {
    const { service, prisma, extraction, document, tx } = fixture();
    prisma.documentExtractionRun.findFirst.mockResolvedValueOnce(null);
    await service.requestExtraction(user, document.id);
    expect(extraction.requestExtraction).toHaveBeenCalledWith({
      documentId: document.id, documentType: DocumentType.TENANT_ID,
      objectKey: document.objectKey, mimeType: 'image/png',
      mode: 'local',
    });
    expect(tx.documentExtractionRun.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      organizationId: user.organizationId, documentId: document.id, status: ExtractionStatus.MANUAL_REVIEW,
      provider: 'vision', requestedById: user.userId,
    }) }));
    expect(tx.person.updateMany).not.toHaveBeenCalled();
    expect(tx.documentExtractionReview.create).not.toHaveBeenCalled();
  });

  it('reutiliza una ejecución pendiente sin reenviar la imagen', async () => {
    const { service, document, run, extraction, tx } = fixture();
    const result = await service.requestExtraction(user, document.id);
    expect(result.extraction.runId).toBe(run.id);
    expect(extraction.requestExtraction).not.toHaveBeenCalled();
    expect(tx.documentExtractionRun.create).not.toHaveBeenCalled();
  });

  it('no procesa documentos invalidados', async () => {
    const { service, document, extraction } = fixture();
    document.invalidatedAt = reviewedAt;
    await expect(service.requestExtraction(user, document.id)).rejects.toThrow('Restaura el documento');
    expect(extraction.requestExtraction).not.toHaveBeenCalled();
  });

  it('limita la bandeja al documento y a la organización actual', async () => {
    const { service, document, prisma } = fixture();
    await service.extractionQueue(user, { documentId: document.id });
    expect(prisma.documentExtractionRun.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: user.organizationId, documentId: document.id, review: { is: null } },
      include: expect.objectContaining({ document: expect.objectContaining({ select: expect.objectContaining({ person: true }) }) }),
    }));
  });
});

describe('revisión humana de la identificación', () => {
  it('aplica sólo campos seleccionados, en la misma transacción y con auditoría sin valores personales', async () => {
    const { review, tx, person, document, audit } = fixture();
    const result = await review();
    expect(tx.person.findFirst).toHaveBeenCalledWith({ where: { id: person.id, organizationId: user.organizationId } });
    expect(tx.person.updateMany).toHaveBeenCalledWith({
      where: { id: person.id, organizationId: user.organizationId, updatedAt: person.updatedAt },
      data: { givenName: 'Persona de prueba' },
    });
    expect(tx.document.updateMany).toHaveBeenCalledWith({
      where: {
        id: document.id, organizationId: user.organizationId, type: document.type,
        personId: person.id, propertyId: null, version: 1,
        extractionStatus: ExtractionStatus.MANUAL_REVIEW, invalidatedAt: null,
      },
      data: expect.objectContaining({ extractionStatus: ExtractionStatus.COMPLETE, personId: person.id }),
    });
    expect(tx.documentExtractionReview.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      decision: ExtractionReviewDecision.CONFIRMED, reviewedById: user.userId,
    }) }));
    expect(result.appliedPersonFields).toEqual(['givenName']);
    expect(result.appliedPersonId).toBe(person.id);
    expect(audit.record).toHaveBeenCalledTimes(2);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'PERSON_UPDATED_FROM_IDENTITY', entityId: person.id,
      payload: { runId: 'ejecucion-1', documentId: document.id, fields: ['givenName'] },
    }));
    expect(JSON.stringify(audit.record.mock.calls)).not.toMatch(/Persona de prueba|DEMO900101/);
  });

  it('permite corregir y confirmar únicamente datos legibles seleccionados', async () => {
    const { review, tx } = fixture();
    await review({
      decision: ExtractionReviewDecision.CORRECTED,
      data: { givenName: 'Corrección humana', curp: 'demo900101hdfxxx09', city: 'Ciudad visible' },
      personFields: ['givenName', 'curp'], expectedPersonValues: { givenName: '', curp: '' },
    });
    expect(tx.person.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: {
      givenName: 'Corrección humana', curp: 'DEMO900101HDFXXX09',
    } }));
  });

  it('permite guardar la revisión sólo en el documento sin cambios al Directorio', async () => {
    const { review, tx } = fixture();
    const result = await review({ personFields: [] });
    expect(tx.person.findFirst).not.toHaveBeenCalled();
    expect(tx.person.updateMany).not.toHaveBeenCalled();
    expect(result.appliedPersonFields).toEqual([]);
    expect(tx.document.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ extractionStatus: ExtractionStatus.COMPLETE }),
    }));
  });

  it('rechazar una extracción nunca aplica datos ni vincula personas', async () => {
    const { review, tx } = fixture();
    const result = await review({ decision: ExtractionReviewDecision.REJECTED, personId: 'otra-persona', data: { givenName: 'No aplicar' } });
    expect(tx.person.updateMany).not.toHaveBeenCalled();
    expect(tx.person.findFirst).not.toHaveBeenCalled();
    expect(result.appliedPersonFields).toEqual([]);
    expect(tx.document.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: {
      extractionStatus: ExtractionStatus.FAILED, extractedData: Prisma.JsonNull,
    } }));
  });

  it('rechaza aplicar datos sin permisos de escritura en Directorio', async () => {
    const { review, tx } = fixture();
    await expect(review({}, { ...user, role: MembershipRole.VIEWER })).rejects.toThrow('No tienes permiso');
    expect(tx.person.updateMany).not.toHaveBeenCalled();
    expect(tx.documentExtractionReview.create).not.toHaveBeenCalled();
  });

  it('rechaza aplicar datos de documentos que no sean identificaciones', async () => {
    const { review, document, tx } = fixture();
    document.type = DocumentType.SIGNED_CONTRACT;
    await expect(review()).rejects.toThrow('desde una identificación');
    expect(tx.person.updateMany).not.toHaveBeenCalled();
  });

  it('rechaza aplicar datos a una persona diferente de la vinculada', async () => {
    const { review, tx } = fixture();
    await expect(review({ personId: 'otra-persona' })).rejects.toThrow('vinculado a otra persona');
    expect(tx.person.findFirst).not.toHaveBeenCalled();
    expect(tx.person.updateMany).not.toHaveBeenCalled();
  });

  it('permite vincular una persona física existente de la misma organización', async () => {
    const { review, document, person, tx } = fixture();
    document.personId = null;
    await review({ personId: person.id });
    expect(tx.person.findFirst).toHaveBeenCalledWith({ where: { id: person.id, organizationId: user.organizationId } });
    expect(tx.document.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ personId: person.id }) }));
  });

  it('exige seleccionar una persona antes de aplicar campos', async () => {
    const { review, document, tx } = fixture();
    document.personId = null;
    await expect(review()).rejects.toThrow('Selecciona la persona');
    expect(tx.person.updateMany).not.toHaveBeenCalled();
  });

  it('no permite aplicar datos a personas de otra organización ni a personas morales', async () => {
    const { review, tx, person } = fixture();
    tx.person.findFirst.mockResolvedValueOnce(null);
    await expect(review()).rejects.toThrow('persona física de tu organización');
    person.type = PersonType.COMPANY;
    await expect(review()).rejects.toThrow('persona física de tu organización');
    expect(tx.person.updateMany).not.toHaveBeenCalled();
  });

  it('no reemplaza información previa sin una autorización adicional', async () => {
    const { review, person, tx } = fixture();
    person.givenName = 'Dato registrado';
    await expect(review({ expectedPersonValues: { givenName: 'Dato registrado' } })).rejects.toThrow('Confirma expresamente');
    expect(tx.person.updateMany).not.toHaveBeenCalled();
    await review({ overwritePersonFields: ['givenName'], expectedPersonValues: { givenName: 'Dato registrado' } });
    expect(tx.person.updateMany).toHaveBeenCalledOnce();
  });

  it('rechaza campos arbitrarios aunque se omita la validación del controlador', async () => {
    const { review, tx } = fixture();
    await expect(review({ data: { organizationId: 'otra-organizacion' }, personFields: ['organizationId'] })).rejects.toThrow('únicamente campos de identificación');
    expect(tx.person.updateMany).not.toHaveBeenCalled();
  });

  it('detecta modificaciones simultáneas a la ficha', async () => {
    const { review, tx, audit } = fixture();
    tx.person.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(review()).rejects.toThrow('La ficha cambió durante la revisión');
    expect(tx.documentExtractionReview.create).not.toHaveBeenCalled();
    expect(tx.document.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('no confirma si el documento cambió o se invalidó durante la transacción', async () => {
    const { review, tx, audit } = fixture();
    tx.document.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(review()).rejects.toThrow('El documento cambió durante la revisión');
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('una revisión existente es inmutable', async () => {
    const { review, run, prisma } = fixture();
    run.review = { id: 'revision-previa' };
    await expect(review()).rejects.toThrow('revisión inmutable');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('no revisa documentos invalidados ni ejecuciones todavía en proceso', async () => {
    const { review, document, run, prisma } = fixture();
    document.invalidatedAt = reviewedAt;
    await expect(review()).rejects.toThrow('Restaura el documento');
    document.invalidatedAt = null;
    run.status = ExtractionStatus.PROCESSING;
    await expect(review()).rejects.toThrow('todavía se encuentra en proceso');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('no confirma datos vacíos ni corrige sin datos explícitos', async () => {
    const { review, prisma } = fixture();
    await expect(review({ data: {} })).rejects.toThrow('Captura al menos un dato');
    await expect(review({ decision: ExtractionReviewDecision.CORRECTED })).rejects.toThrow('requiere los datos confirmados');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('limita la consulta de revisión al expediente documental de la organización', async () => {
    const { review, prisma } = fixture();
    prisma.documentExtractionRun.findFirst.mockResolvedValueOnce(null);
    await expect(review()).rejects.toThrow('no encontrada');
    expect(prisma.documentExtractionRun.findFirst).toHaveBeenCalledWith({
      where: { id: 'ejecucion-1', documentId: 'documento-1', organizationId: user.organizationId },
      include: { document: true, review: true },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
