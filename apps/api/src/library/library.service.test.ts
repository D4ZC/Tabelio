import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DocumentType, MatterStatus, MembershipRole } from '@despacho/database';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.types';
import { REQUIRED_PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { AttachLibraryDocumentDto } from './dto/attach-library-document.dto';
import { LibraryQueryDto } from './dto/library-query.dto';
import { LibraryController } from './library.controller';
import { LibraryService } from './library.service';

const user: AuthenticatedUser = {
  userId: 'usuario-1', email: 'prueba@example.test', displayName: 'Usuario de prueba',
  organizationId: 'organizacion-1', organizationName: 'Organización de prueba',
  membershipId: 'miembro-1', role: MembershipRole.ADMIN,
};
const contents = Buffer.from('Documento jurídico ficticio para pruebas de biblioteca');
const checksum = createHash('sha256').update(contents).digest('hex');

function libraryDocument(changes: Record<string, unknown> = {}) {
  return {
    id: 'biblioteca-1', organizationId: user.organizationId, collectionId: 'coleccion-1',
    externalId: 'saul-ficticio-1', title: 'Convenio de arrendamiento', source: 'Saul',
    originalPath: 'Saul/Modelo/Convenio.doc', documentType: 'convenio_arrendamiento',
    documentTypeLabel: 'Convenio de arrendamiento', legalFamily: 'arrendamiento',
    variant: 'fisicas_con_obligado', usage: 'plantilla_base', packageId: 'paquete-1',
    packageLabel: 'Personas físicas con obligado', sha256: checksum,
    sizeBytes: contents.length, mimeType: 'application/msword',
    objectKey: 'organizacion-1/biblioteca/archivo.doc', bucket: 'expedientes',
    text: 'Texto extraído ficticio de un convenio.', duplicateOf: null, textEquivalentTo: null,
    review: { notes: ['Modelo de referencia'], blockers: ['Falta parametrizar'], fields: ['partes'], subdocuments: ['convenio'], confidence: 'alta' },
    importedById: user.userId, createdAt: new Date(), updatedAt: new Date(), ...changes,
  };
}

function fixture(records = [libraryDocument()]) {
  const attached: Array<{ id: string; organizationId: string; matterId: string; checksum: string; invalidatedAt?: Date | null }> = [];
  const links = new Map<string, { organizationId: string; libraryDocumentId: string; documentId: string }>();
  const matches = (row: Record<string, unknown>, where: Record<string, any> = {}): boolean => Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some((condition: Record<string, any>) => Object.entries(condition).every(([field, filter]) => (
      String(row[field] ?? '').toLocaleLowerCase().includes(String(filter.contains).toLocaleLowerCase())
    )));
    if (value && typeof value === 'object' && 'not' in value) return row[key] !== value.not;
    return row[key] === value;
  });
  const project = (row: Record<string, unknown>, select?: Record<string, boolean>) => select
    ? Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key]])) : row;
  const tx = { libraryDocumentLink: { upsert: vi.fn(async ({ create }: { create: { organizationId: string; libraryDocumentId: string; documentId: string } }) => {
    links.set(`${create.libraryDocumentId}:${create.documentId}`, create);
    return create;
  }) } };
  const prisma = {
    libraryDocument: {
      findFirst: vi.fn(async ({ where, select }) => {
        const found = records.find((record) => matches(record, where));
        return found ? project(found, select) : null;
      }),
      findMany: vi.fn(async ({ where, select, skip = 0, take }) => records.filter((record) => matches(record, where))
        .slice(skip, take === undefined ? undefined : skip + take).map((record) => project(record, select))),
      count: vi.fn(async ({ where }) => records.filter((record) => matches(record, where)).length),
    },
    matter: { findFirst: vi.fn(async ({ where }) => where.organizationId === user.organizationId && where.id === 'expediente-1'
      ? { id: where.id, status: MatterStatus.INTEGRATION } : null) },
    document: { findFirst: vi.fn(async ({ where }) => attached.find((document) => matches(document, where)) ?? null) },
    $transaction: vi.fn(async (operation: (transaction: typeof tx) => unknown) => operation(tx)),
  };
  const storage = { open: vi.fn(async () => Readable.from([contents])) };
  const audit = { record: vi.fn().mockResolvedValue({ id: 'evento-1' }) };
  const documents = { upload: vi.fn(async (actor: AuthenticatedUser, matterId: string, _dto, file: Express.Multer.File) => {
    const result = { id: `documento-${attached.length + 1}`, organizationId: actor.organizationId, matterId, checksum: createHash('sha256').update(file.buffer).digest('hex') };
    attached.push(result);
    return result;
  }) };
  const service = new LibraryService(prisma as never, storage as never, documents as never, audit as never);
  return { service, prisma, storage, documents, audit, attached, links, tx, records };
}

describe('biblioteca jurídica por organización', () => {
  it('mantiene resumen y facetas globales del tenant al filtrar y paginar los resultados', async () => {
    const records = [
      libraryDocument(),
      libraryDocument({ id: 'biblioteca-2', externalId: 'alex-ficticio-2', source: 'Alex', packageId: 'paquete-2', packageLabel: 'Promesa', legalFamily: 'promesa_compraventa', documentType: 'contrato_promesa_compraventa', documentTypeLabel: 'Contrato de promesa de compraventa', usage: 'modelo_personalizado', variant: 'fisica_moral', duplicateOf: 'saul-ficticio-1' }),
      libraryDocument({ id: 'biblioteca-ajena', organizationId: 'otra-organizacion', source: 'Externo', sha256: 'otro-sha' }),
    ];
    const { service, prisma } = fixture(records);
    const result = await service.list(user, { source: 'Alex', legalFamily: 'promesa_compraventa', variant: 'fisica_moral', page: 1, pageSize: 1 });
    expect(result.summary).toEqual({ total: 2, uniqueFiles: 1, packages: 2, bySource: { Saul: 1, Alex: 1 } });
    expect(result.pagination).toEqual({ page: 1, pageSize: 1, total: 1, totalPages: 1 });
    expect(result.documents.map((document) => document.id)).toEqual(['biblioteca-2']);
    expect(result.documents[0].readyForGeneration).toBe(false);
    expect(result.facets.legalFamilies).toContainEqual({ value: 'promesa_compraventa', label: 'Promesa de compraventa', count: 1 });
    expect(result.facets.usages).toContainEqual({ value: 'modelo_personalizado', label: 'Modelo personalizado', count: 1 });
    expect(result.facets.variants).toContainEqual({ value: 'fisica_moral', label: 'Fisica moral', count: 1 });
    expect(prisma.libraryDocument.count).toHaveBeenCalledWith({ where: expect.objectContaining({ organizationId: user.organizationId, source: 'Alex', variant: 'fisica_moral' }) });
    expect(JSON.stringify(result)).not.toMatch(/objectKey|bucket|Texto extraído|organizacion-1\/biblioteca/);
  });

  it('aplica todos los filtros y búsqueda a la misma organización, sin tratar q como una ruta', async () => {
    const { service, prisma } = fixture();
    await service.list(user, { q: '  Convenio  ', source: 'Saul', documentType: 'convenio_arrendamiento', legalFamily: 'arrendamiento', usage: 'plantilla_base', variant: 'fisicas_con_obligado', packageId: 'paquete-1', page: 2, pageSize: 10 });
    expect(prisma.libraryDocument.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: user.organizationId, source: 'Saul', documentType: 'convenio_arrendamiento', legalFamily: 'arrendamiento', usage: 'plantilla_base', variant: 'fisicas_con_obligado', packageId: 'paquete-1',
        OR: expect.arrayContaining([{ text: { contains: 'Convenio', mode: 'insensitive' } }]),
      }), skip: 10, take: 10,
    }));
  });

  it('obtiene texto y revisión normalizada; relacionados nunca cruzan colección ni organización', async () => {
    const records = [
      libraryDocument({ review: { notes: ['nota', 7], fields: null, subdocuments: ['convenio'], confidence: 5, unknown: 'no exponer' } }),
      libraryDocument({ id: 'relacionado', externalId: 'saul-2' }),
      libraryDocument({ id: 'otra-coleccion', collectionId: 'coleccion-2' }),
      libraryDocument({ id: 'otra-organizacion', organizationId: 'org-2' }),
    ];
    const { service, prisma } = fixture(records);
    const result = await service.detail(user, 'biblioteca-1');
    expect(result.text).toContain('Texto extraído');
    expect(result.review).toEqual({ notes: ['nota'], blockers: [], fields: [], subdocuments: ['convenio'], confidence: 'por_revisar' });
    expect(result.relatedDocuments.map((document) => document.id)).toEqual(['relacionado']);
    expect(prisma.libraryDocument.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'biblioteca-1', organizationId: user.organizationId } }));
    expect(JSON.stringify(result)).not.toMatch(/objectKey|bucket|unknown|importedById/);
  });

  it.each(['detail', 'download'] as const)('no resuelve un identificador de otra organización en %s', async (method) => {
    const { service, storage } = fixture([libraryDocument({ organizationId: 'org-ajena' })]);
    await expect(service[method](user, 'biblioteca-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.open).not.toHaveBeenCalled();
  });

  it('descarga el objeto por canal autenticado y audita sin exponer llaves internas', async () => {
    const { service, storage, audit } = fixture();
    const result = await service.download(user, 'biblioteca-1');
    const chunks: Buffer[] = [];
    for await (const chunk of result.stream) chunks.push(chunk);
    expect(Buffer.concat(chunks)).toEqual(contents);
    expect(result.fileName).toBe('Convenio.doc');
    expect(storage.open).toHaveBeenCalledWith('organizacion-1/biblioteca/archivo.doc');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ organizationId: user.organizationId, actorUserId: user.userId, action: 'LIBRARY_DOCUMENT_DOWNLOADED' }));
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('objectKey');
    expect(result).not.toHaveProperty('document');
  });
});

describe('adjuntar modelos de biblioteca como documentos de referencia', () => {
  it('rechaza escritura de un lector antes de consultar archivos o expedientes', async () => {
    const { service, prisma, storage, documents } = fixture();
    await expect(service.attach({ ...user, role: MembershipRole.VIEWER }, 'biblioteca-1', { matterId: 'expediente-1' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.libraryDocument.findFirst).not.toHaveBeenCalled();
    expect(storage.open).not.toHaveBeenCalled();
    expect(documents.upload).not.toHaveBeenCalled();
  });

  it.each([MatterStatus.CLOSED, MatterStatus.CANCELLED])('rechaza un expediente %s incluso si ya tiene el SHA', async (status) => {
    const { service, prisma, attached, documents, links } = fixture();
    attached.push({ id: 'ya-existe', organizationId: user.organizationId, matterId: 'expediente-1', checksum });
    prisma.matter.findFirst.mockResolvedValue({ id: 'expediente-1', status });
    await expect(service.attach(user, 'biblioteca-1', { matterId: 'expediente-1' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.document.findFirst).not.toHaveBeenCalled();
    expect(documents.upload).not.toHaveBeenCalled();
    expect(links.size).toBe(0);
  });

  it('no permite adjuntar a expedientes de otra organización', async () => {
    const { service, prisma, documents } = fixture();
    await expect(service.attach(user, 'biblioteca-1', { matterId: 'expediente-ajeno' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.matter.findFirst).toHaveBeenCalledWith({ where: { id: 'expediente-ajeno', organizationId: user.organizationId }, select: { id: true, status: true } });
    expect(documents.upload).not.toHaveBeenCalled();
  });

  it('pasa los bytes originales por DocumentsService.upload como OTHER, con vínculo y auditoría', async () => {
    const { service, prisma, documents, audit, tx } = fixture();
    const result = await service.attach(user, 'biblioteca-1', { matterId: 'expediente-1' });
    expect(result).toEqual({ matterId: 'expediente-1', results: [{ id: 'biblioteca-1', sourceDocumentId: 'saul-ficticio-1', fileName: 'Convenio.doc', status: 'attached', documentId: 'documento-1' }] });
    expect(documents.upload).toHaveBeenCalledWith(user, 'expediente-1', { type: DocumentType.OTHER }, expect.objectContaining({ originalname: 'Convenio.doc', buffer: contents, mimetype: 'application/msword', size: contents.length }));
    expect(tx.libraryDocumentLink.upsert).toHaveBeenCalledWith({
      where: { libraryDocumentId_documentId: { libraryDocumentId: 'biblioteca-1', documentId: 'documento-1' } },
      create: { organizationId: user.organizationId, libraryDocumentId: 'biblioteca-1', documentId: 'documento-1' }, update: {},
    });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ matterId: 'expediente-1', action: 'LIBRARY_DOCUMENT_ATTACHED', payload: expect.objectContaining({ documentId: 'documento-1', status: 'attached' }) }), tx);
  });

  it('conserva vínculo de cada alias SHA y reintenta el paquete sin duplicar cargas', async () => {
    const records = [libraryDocument(), libraryDocument({ id: 'alias-2', externalId: 'alex-alias-2', source: 'Alex', duplicateOf: 'saul-ficticio-1' })];
    const { service, documents, storage, links } = fixture(records);
    const first = await service.attach(user, 'biblioteca-1', { matterId: 'expediente-1', includePackage: true });
    expect(first.results.map((result) => result.status)).toEqual(['attached', 'existing']);
    expect(first.results.map((result) => result.documentId)).toEqual(['documento-1', 'documento-1']);
    expect(links.size).toBe(2);
    const second = await service.attach(user, 'biblioteca-1', { matterId: 'expediente-1', includePackage: true });
    expect(second.results.map((result) => result.status)).toEqual(['existing', 'existing']);
    expect(documents.upload).toHaveBeenCalledOnce();
    expect(storage.open).toHaveBeenCalledOnce();
    expect(links.size).toBe(2);
  });

  it('limita el paquete a su colección y organización y permite resultados parciales', async () => {
    const records = [
      libraryDocument(),
      libraryDocument({ id: 'roto', externalId: 'saul-roto', sha256: 'checksum-distinto', objectKey: 'objeto-inaccesible' }),
      libraryDocument({ id: 'coleccion-ajena', collectionId: 'coleccion-2' }),
      libraryDocument({ id: 'tenant-ajeno', organizationId: 'org-2' }),
      libraryDocument({ id: 'paquete-ajeno', packageId: 'paquete-2' }),
    ];
    const { service, storage, prisma, documents } = fixture(records);
    storage.open.mockImplementation(async (key) => {
      if (key === 'objeto-inaccesible') throw new Error('/ruta/privada/con-secreto');
      return Readable.from([contents]);
    });
    const result = await service.attach(user, 'biblioteca-1', { matterId: 'expediente-1', includePackage: true });
    expect(result.results.map((row) => row.status)).toEqual(['attached', 'failed']);
    expect(result.results[1].error).not.toContain('privada');
    expect(prisma.libraryDocument.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: user.organizationId, collectionId: 'coleccion-1', packageId: 'paquete-1', id: { not: 'biblioteca-1' } } }));
    expect(documents.upload).toHaveBeenCalledOnce();
  });

  it.each([
    { sha256: '0'.repeat(64) },
    { sizeBytes: contents.length + 1 },
  ])('rechaza bytes que no corresponden con el manifiesto: %j', async (changes) => {
    const { service, documents, links } = fixture([libraryDocument(changes)]);
    const result = await service.attach(user, 'biblioteca-1', { matterId: 'expediente-1' });
    expect(result.results).toEqual([expect.objectContaining({ status: 'failed', error: expect.stringContaining('integridad') })]);
    expect(documents.upload).not.toHaveBeenCalled();
    expect(links.size).toBe(0);
  });

  it('no reutiliza un SHA de otro expediente o tenant', async () => {
    const { service, attached, documents, prisma } = fixture();
    attached.push({ id: 'otro-expediente', organizationId: user.organizationId, matterId: 'expediente-2', checksum });
    attached.push({ id: 'otro-tenant', organizationId: 'org-2', matterId: 'expediente-1', checksum });
    const result = await service.attach(user, 'biblioteca-1', { matterId: 'expediente-1' });
    expect(result.results[0].status).toBe('attached');
    expect(documents.upload).toHaveBeenCalledOnce();
    expect(prisma.document.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: user.organizationId, matterId: 'expediente-1', checksum } }));
  });

  it('conserva la invalidación de un SHA existente y exige resolverla antes de adjuntar', async () => {
    const { service, attached, documents, storage, links } = fixture();
    attached.push({ id: 'invalidado', organizationId: user.organizationId, matterId: 'expediente-1', checksum, invalidatedAt: new Date() });
    const result = await service.attach(user, 'biblioteca-1', { matterId: 'expediente-1' });
    expect(result.results[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('invalidado') });
    expect(documents.upload).not.toHaveBeenCalled();
    expect(storage.open).not.toHaveBeenCalled();
    expect(links.size).toBe(0);
  });

  it('resuelve un conflicto concurrente sólo si encuentra el mismo SHA en el expediente', async () => {
    const { service, attached, documents, links } = fixture();
    documents.upload.mockImplementationOnce(async () => {
      attached.push({ id: 'carga-concurrente', organizationId: user.organizationId, matterId: 'expediente-1', checksum });
      throw new ConflictException('El archivo ya existe');
    });
    const result = await service.attach(user, 'biblioteca-1', { matterId: 'expediente-1' });
    expect(result.results[0]).toMatchObject({ status: 'existing', documentId: 'carga-concurrente' });
    expect(links.size).toBe(1);
  });

  it('verifica de nuevo el estado al reutilizar un conflicto concurrente', async () => {
    const { service, attached, documents, prisma, links } = fixture();
    documents.upload.mockImplementationOnce(async () => {
      attached.push({ id: 'carga-concurrente', organizationId: user.organizationId, matterId: 'expediente-1', checksum });
      prisma.matter.findFirst.mockResolvedValue({ id: 'expediente-1', status: MatterStatus.CLOSED });
      throw new ConflictException('El archivo ya existe');
    });
    const result = await service.attach(user, 'biblioteca-1', { matterId: 'expediente-1' });
    expect(result.results[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('concluido') });
    expect(links.size).toBe(0);
  });
});

describe('contrato HTTP de biblioteca', () => {
  it.each(['list', 'detail', 'download', 'attach'] as const)('exige permiso y autenticación en %s', (method) => {
    const handler = LibraryController.prototype[method];
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler)).toEqual([method === 'attach' ? 'DOCUMENT_WRITE' : 'DOCUMENT_READ']);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).not.toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, LibraryController)).not.toBe(true);
  });

  it('descarga con nombre codificado y sin rutas del servidor', async () => {
    const library = { download: vi.fn().mockResolvedValue({ fileName: 'Convenio á (1).doc', mimeType: 'application/msword', sizeBytes: contents.length, stream: Readable.from([contents]) }) };
    const controller = new LibraryController(library as never);
    const file = await controller.download(user, 'biblioteca-1');
    expect(file.getHeaders()).toEqual({ type: 'application/msword', disposition: "attachment; filename*=UTF-8''Convenio%20%C3%A1%20%281%29.doc", length: contents.length });
    expect(library.download).toHaveBeenCalledWith(user, 'biblioteca-1');
  });

  it('valida límites de paginación y acepta filtros de variante', async () => {
    expect(await validate(plainToInstance(LibraryQueryDto, { page: '1', pageSize: '25', variant: 'fisicas_con_obligado' }))).toHaveLength(0);
    for (const invalid of [{ page: '0' }, { page: '1.5' }, { pageSize: '101' }, { q: 'x'.repeat(201) }]) {
      expect((await validate(plainToInstance(LibraryQueryDto, invalid))).length).toBeGreaterThan(0);
    }
  });

  it('exige matterId y un booleano real para includePackage', async () => {
    expect(await validate(plainToInstance(AttachLibraryDocumentDto, { matterId: 'expediente-1', includePackage: false }))).toHaveLength(0);
    for (const invalid of [{}, { matterId: '' }, { matterId: 'expediente-1', includePackage: 'false' }]) {
      expect((await validate(plainToInstance(AttachLibraryDocumentDto, invalid))).length).toBeGreaterThan(0);
    }
  });
});
