import { MembershipRole } from '@despacho/database';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.types';
import { DocumentsService } from './documents.service';

const user: AuthenticatedUser = {
  userId: 'usuario-1', email: 'prueba@example.test', displayName: 'Usuario de prueba',
  organizationId: 'organizacion-1', organizationName: 'Organización de prueba',
  membershipId: 'miembro-1', role: MembershipRole.ADMIN,
};

function fixture() {
  const document = {
    id: 'documento-1', organizationId: user.organizationId,
    originalName: 'Contrato de arrendamiento.docx', invalidatedAt: null as Date | null,
    objectKey: 'almacenamiento/privado/contrato.docx',
  };
  const prisma = {
    document: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; organizationId: string } }) => (
        where.id === document.id && where.organizationId === document.organizationId
          ? { id: document.id, originalName: document.originalName }
          : null
      )),
    },
  };
  const storage = { open: vi.fn() };
  const audit = { record: vi.fn() };
  const service = new DocumentsService(
    prisma as never, storage as never, audit as never, {} as never, {} as never,
    {} as never, {} as never, {} as never, {} as never,
  );
  return { service, document, prisma, storage, audit };
}

describe('enlace autenticado de descarga documental', () => {
  it('devuelve sólo metadatos y la ruta de descarga sin leer archivos ni registrar una descarga', async () => {
    const { service, document, prisma, storage, audit } = fixture();
    document.id = 'documento con espacio';

    await expect(service.downloadLink(user, document.id)).resolves.toEqual({
      documentId: document.id,
      fileName: document.originalName,
      downloadPath: '/documents/documento%20con%20espacio/download',
    });
    expect(prisma.document.findFirst).toHaveBeenCalledWith({
      where: { id: document.id, organizationId: user.organizationId },
      select: { id: true, originalName: true },
    });
    expect(storage.open).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('no revela documentos de otra organización', async () => {
    const { service, document, storage, audit } = fixture();
    await expect(service.downloadLink({ ...user, organizationId: 'otra-organizacion' }, document.id))
      .rejects.toMatchObject({ status: 404, message: 'Documento no encontrado' });
    expect(storage.open).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('conserva la descarga histórica de documentos invalidados', async () => {
    const { service, document } = fixture();
    document.invalidatedAt = new Date('2026-11-02T18:00:00.000Z');
    await expect(service.downloadLink(user, document.id)).resolves.toMatchObject({
      documentId: document.id,
    });
  });

  it('responde no encontrado si el documento fue eliminado', async () => {
    const { service, prisma } = fixture();
    prisma.document.findFirst.mockResolvedValueOnce(null);
    await expect(service.downloadLink(user, 'documento-eliminado'))
      .rejects.toMatchObject({ status: 404, message: 'Documento no encontrado' });
  });
});
