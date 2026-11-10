import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentType, ExtractionStatus, MatterStatus, MembershipRole } from '@despacho/database';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { DocumentsService } from './documents.service';
import type { DeleteDocumentDto } from './dto/delete-document.dto';
import { ObjectStorageService } from './object-storage.service';

const user: AuthenticatedUser = {
  userId: 'usuario-1', email: 'prueba@example.test', displayName: 'Usuario de prueba',
  organizationId: 'organizacion-1', organizationName: 'Organización de prueba',
  membershipId: 'miembro-1', role: MembershipRole.ADMIN,
};
const contents = Buffer.from('identificacion ficticia para prueba de eliminacion');

afterEach(() => { vi.restoreAllMocks(); });

function fixture(physicalStorage?: ObjectStorageService) {
  const document = {
    id: 'documento-1', organizationId: user.organizationId, matterId: 'expediente-1' as string | null,
    type: DocumentType.TENANT_ID as DocumentType, version: 1,
    personId: 'persona-1' as string | null, propertyId: null, sourceDocumentId: null as string | null,
    objectKey: 'organizacion/expediente/ine-ficticia.png', originalName: 'ine-ficticia.png', mimeType: 'image/png',
    extractionStatus: ExtractionStatus.MANUAL_REVIEW as ExtractionStatus,
    invalidatedAt: null as Date | null,
    matter: { status: MatterStatus.INTEGRATION as MatterStatus } as { status: MatterStatus } | null,
    portalUpload: null as { id: string } | null,
    terminationEvidenceFor: null as { id: string } | null,
    _count: {
      derivedDocuments: 0, clauseSnapshots: 0, reviews: 0, signatureSources: 0,
      signatureResults: 0, taskEvidenceLinks: 0, extractionRuns: 1,
    },
  };
  const tx = {
    document: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    auditEvent: { create: vi.fn().mockResolvedValue({ id: 'evento-1' }) },
  };
  const prisma = {
    document: { findFirst: vi.fn().mockResolvedValue(document) },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn(async (operation: (transaction: typeof tx) => unknown) => operation(tx)),
  };
  const storage = {
    open: vi.fn().mockImplementation(async () => Readable.from([contents])),
    delete: vi.fn().mockResolvedValue(undefined),
    putBuffer: vi.fn().mockResolvedValue(undefined),
  };
  const tasks = { syncDocumentValidityTasksForOrganization: vi.fn().mockResolvedValue(undefined) };
  const audit = new AuditService(prisma as never);
  const record = vi.spyOn(audit, 'record');
  const service = new DocumentsService(
    prisma as never, (physicalStorage ?? storage) as never, audit, {} as never, {} as never,
    {} as never, {} as never, {} as never, tasks as never,
  );
  const dto: DeleteDocumentDto = { reason: '  Archivo cargado por error durante la prueba.  ', confirmation: 'ELIMINAR' };
  const remove = (changes: Partial<DeleteDocumentDto> = {}, actor = user) => (
    service.remove(actor, document.id, { ...dto, ...changes })
  );
  return { service, remove, document, dto, prisma, tx, storage, tasks, record };
}

describe('eliminación confirmada de archivos cargados', () => {
  it('retira realmente del disco una carga de prueba', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'despacho-delete-test-'));
    try {
      const physicalStorage = new ObjectStorageService(new ConfigService({ STORAGE_DRIVER: 'local', LOCAL_STORAGE_PATH: directory }));
      const { service, document, dto } = fixture(physicalStorage);
      await physicalStorage.putBuffer(document.objectKey, contents, document.mimeType, document.originalName);
      await service.remove(user, document.id, dto);
      await expect(access(resolve(directory, document.objectKey))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('restaura en disco el original cuando la transacción no se confirma', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'despacho-delete-rollback-test-'));
    try {
      const physicalStorage = new ObjectStorageService(new ConfigService({ STORAGE_DRIVER: 'local', LOCAL_STORAGE_PATH: directory }));
      const { service, document, dto, prisma, tx } = fixture(physicalStorage);
      await physicalStorage.putBuffer(document.objectKey, contents, document.mimeType, document.originalName);
      prisma.$transaction.mockImplementationOnce(async (operation) => {
        await operation(tx);
        throw new Error('confirmación rechazada');
      });
      await expect(service.remove(user, document.id, dto)).rejects.toThrow('No se pudo completar la eliminación');
      expect(await readFile(resolve(directory, document.objectKey))).toEqual(contents);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([MembershipRole.ADMIN, MembershipRole.LAWYER, MembershipRole.OPERATOR])('permite borrar una carga con permiso documental: %s', async (role) => {
    const { remove, document, storage, tx, prisma, record, tasks } = fixture();
    expect(await remove({}, { ...user, role })).toEqual({ id: document.id, deleted: true });
    expect(prisma.document.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: document.id, organizationId: user.organizationId },
    }));
    expect(storage.open).toHaveBeenCalledWith(document.objectKey);
    expect(tx.document.deleteMany).toHaveBeenCalledWith({ where: expect.objectContaining({
      id: document.id, organizationId: user.organizationId, type: document.type, version: 1,
      personId: document.personId, sourceDocumentId: null, extractionStatus: document.extractionStatus,
      taskEvidenceLinks: { none: {} }, reviews: { none: {} },
      portalUpload: { is: null }, terminationEvidenceFor: { is: null },
      extractionRuns: { none: { status: ExtractionStatus.PROCESSING } },
    }) });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: user.organizationId, actorUserId: user.userId,
      action: 'DOCUMENT_DELETED', entityType: 'Document', entityId: document.id,
      payload: expect.objectContaining({ reason: 'Archivo cargado por error durante la prueba.', removedExtractionRuns: 1 }),
    }), tx);
    expect(tx.auditEvent.create).toHaveBeenCalledOnce();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
    expect(storage.delete).toHaveBeenCalledWith(document.objectKey);
    expect(storage.putBuffer).not.toHaveBeenCalled();
    expect(tasks.syncDocumentValidityTasksForOrganization).toHaveBeenCalledWith(
      user.organizationId, expect.any(Date), user.userId, document.matterId,
    );
    expect(JSON.stringify(tx.auditEvent.create.mock.calls)).not.toContain(document.objectKey);
  });

  it('no permite borrar archivos con rol de consulta', async () => {
    const { remove, prisma, storage } = fixture();
    await expect(remove({}, { ...user, role: MembershipRole.VIEWER })).rejects.toThrow('No tienes permiso');
    expect(prisma.document.findFirst).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it.each([
    { reason: 'corto' },
    { reason: ' '.repeat(20) },
    { reason: 'x'.repeat(1001) },
    { confirmation: '' },
    { confirmation: 'SI' },
    { confirmation: 'eliminar' },
  ])('requiere un motivo válido y la confirmación exacta: %j', async (changes) => {
    const { remove, storage, prisma } = fixture();
    await expect(remove(changes)).rejects.toThrow();
    expect(prisma.document.findFirst).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('no encuentra ni borra documentos de otra organización', async () => {
    const { remove, prisma, storage } = fixture();
    prisma.document.findFirst.mockResolvedValueOnce(null);
    await expect(remove()).rejects.toThrow('Documento no encontrado');
    expect(storage.open).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    DocumentType.DRAFT_CONTRACT, DocumentType.DRAFT_CONTRACT_PDF,
    DocumentType.SIGNED_CONTRACT, DocumentType.TERMINATION_EVIDENCE,
  ])('protege el documento jurídico controlado %s', async (type) => {
    const { remove, document, storage } = fixture();
    document.type = type;
    await expect(remove()).rejects.toThrow('debe conservarse');
    expect(storage.open).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it.each(['derivedDocuments', 'clauseSnapshots', 'reviews', 'signatureSources', 'signatureResults'] as const)(
    'conserva archivos referenciados por %s', async (relation) => {
      const { remove, document, storage } = fixture();
      document._count[relation] = 1;
      await expect(remove()).rejects.toThrow('debe conservarse');
      expect(storage.delete).not.toHaveBeenCalled();
    },
  );

  it('protege archivos derivados aunque tengan una clasificación distinta', async () => {
    const { remove, document, storage } = fixture();
    document.sourceDocumentId = 'documento-origen';
    await expect(remove()).rejects.toThrow('debe conservarse');
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it.each(['portalUpload', 'terminationEvidenceFor'] as const)('conserva archivos vinculados a %s', async (relation) => {
    const { remove, document, storage } = fixture();
    document[relation] = { id: 'referencia-1' };
    await expect(remove()).rejects.toThrow('debe conservarse');
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('impide borrar evidencias de tareas sin retirar el vínculo', async () => {
    const { remove, document, storage } = fixture();
    document._count.taskEvidenceLinks = 1;
    await expect(remove()).rejects.toThrow('evidencia de una tarea');
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it.each([MatterStatus.CLOSED, MatterStatus.CANCELLED])('conserva archivos de expedientes concluidos: %s', async (status) => {
    const { remove, document, storage } = fixture();
    document.matter!.status = status;
    await expect(remove()).rejects.toThrow('expediente concluido');
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('espera a que finalice una extracción en proceso', async () => {
    const { remove, document, storage } = fixture();
    document.extractionStatus = ExtractionStatus.PROCESSING;
    await expect(remove()).rejects.toThrow('termine la extracción');
    expect(storage.open).not.toHaveBeenCalled();
  });

  it('permite eliminar identificaciones invalidadas o ya revisadas sin modificar personas', async () => {
    const { remove, document, tx, storage } = fixture();
    document.extractionStatus = ExtractionStatus.COMPLETE;
    document.invalidatedAt = new Date('2026-10-29T18:00:00Z');
    document._count.extractionRuns = 2;
    await expect(remove()).resolves.toEqual({ id: document.id, deleted: true });
    expect(storage.delete).toHaveBeenCalledOnce();
    expect(tx.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      payload: expect.objectContaining({ removedExtractionRuns: 2 }),
    }) });
    expect(tx).not.toHaveProperty('person');
  });

  it('permite retirar una carga general sin expediente', async () => {
    const { remove, document, tasks } = fixture();
    document.matterId = null;
    document.matter = null;
    await expect(remove()).resolves.toMatchObject({ deleted: true });
    expect(tasks.syncDocumentValidityTasksForOrganization).not.toHaveBeenCalled();
  });

  it.each([
    Object.assign(new Error('ausente'), { code: 'ENOENT' }),
    Object.assign(new Error('ausente'), { name: 'NoSuchKey' }),
    Object.assign(new Error('ausente'), { name: 'NotFound' }),
    { $metadata: { httpStatusCode: 404 } },
  ])('permite limpiar el registro de un archivo ya ausente: %j', async (failure) => {
    const { remove, storage, tx } = fixture();
    storage.open.mockRejectedValueOnce(failure);
    await expect(remove()).resolves.toMatchObject({ deleted: true });
    expect(tx.document.deleteMany).toHaveBeenCalledOnce();
    expect(storage.delete).not.toHaveBeenCalled();
    expect(storage.putBuffer).not.toHaveBeenCalled();
  });

  it('no inicia el borrado si falla la lectura de recuperación', async () => {
    const { remove, storage, prisma } = fixture();
    storage.open.mockRejectedValueOnce(new Error('credencial o ruta privada del proveedor'));
    await expect(remove()).rejects.toThrow('No se modificó el documento');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('limita la copia de recuperación a 20 MB y cierra el stream', async () => {
    const { remove, storage, prisma } = fixture();
    const stream = Readable.from([Buffer.alloc(20 * 1024 * 1024 + 1)]);
    storage.open.mockResolvedValueOnce(stream);
    await expect(remove()).rejects.toThrow('No se modificó el documento');
    expect(stream.destroyed).toBe(true);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('no elimina el archivo si cambia o adquiere referencias durante la operación', async () => {
    const { remove, tx, storage } = fixture();
    tx.document.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(remove()).rejects.toThrow('El documento cambió');
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('respeta las restricciones de integridad de la base sin borrar el archivo', async () => {
    const { remove, tx, storage } = fixture();
    tx.document.deleteMany.mockRejectedValueOnce({ code: 'P2003' });
    await expect(remove()).rejects.toThrow('se vinculó a otro proceso');
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('no borra el archivo si no se puede guardar la auditoría en la transacción', async () => {
    const { remove, tx, storage } = fixture();
    tx.auditEvent.create.mockRejectedValueOnce(new Error('fallo de auditoria'));
    await expect(remove()).rejects.toThrow('No se pudo completar la eliminación');
    expect(storage.delete).not.toHaveBeenCalled();
    expect(storage.putBuffer).not.toHaveBeenCalled();
  });

  it('restaura el archivo si falla el borrado del proveedor y no filtra sus errores', async () => {
    const { remove, storage, document, tasks } = fixture();
    storage.delete.mockRejectedValueOnce(new Error('ruta privada y credencial del proveedor'));
    await expect(remove()).rejects.toThrow('No se pudo completar la eliminación');
    expect(storage.putBuffer).toHaveBeenCalledWith(document.objectKey, contents, 'image/png', document.originalName);
    expect(tasks.syncDocumentValidityTasksForOrganization).not.toHaveBeenCalled();
  });

  it('recupera los bytes originales si falla la confirmación de la transacción', async () => {
    const { remove, storage, document, prisma, tx } = fixture();
    prisma.$transaction.mockImplementationOnce(async (operation) => {
      await operation(tx);
      throw new Error('fallo al confirmar');
    });
    await expect(remove()).rejects.toThrow('No se pudo completar la eliminación');
    expect(storage.delete).toHaveBeenCalledOnce();
    expect(storage.putBuffer).toHaveBeenCalledWith(document.objectKey, contents, 'image/png', document.originalName);
  });

  it('no confunde un archivo local que sigue existiendo con una recuperación fallida', async () => {
    const { remove, storage } = fixture();
    storage.delete.mockRejectedValueOnce(new Error('borrado rechazado'));
    storage.putBuffer.mockRejectedValueOnce(Object.assign(new Error('ya existe'), { code: 'EEXIST' }));
    await expect(remove()).rejects.toThrow('No se pudo completar la eliminación');
  });

  it('informa cuando un fallo de recuperación exige intervención administrativa', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { remove, storage } = fixture();
    storage.delete.mockRejectedValueOnce(new Error('borrado rechazado'));
    storage.putBuffer.mockRejectedValueOnce(new Error('restauración rechazada'));
    await expect(remove()).rejects.toThrow('requiere recuperación');
  });
});
