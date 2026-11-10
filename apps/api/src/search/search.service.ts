import { BadRequestException, Injectable } from '@nestjs/common';
import { DocumentType } from '@despacho/database';
import { currentDocuments } from '@despacho/domain';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(user: AuthenticatedUser, rawQuery: string, limit = 8) {
    const query = rawQuery.trim();
    if (query.length < 2) throw new BadRequestException('Escribe al menos dos caracteres para buscar');
    const contains = { contains: query, mode: 'insensitive' as const };
    const normalizedType = query.trim().toUpperCase().replace(/[\s-]+/g, '_');
    const documentType = Object.values(DocumentType).includes(normalizedType as DocumentType)
      ? normalizedType as DocumentType
      : undefined;

    const [mattersFound, peopleFound, propertiesFound, documentsFound] = await Promise.all([
      this.prisma.matter.findMany({
        where: {
          organizationId: user.organizationId,
          OR: [{ reference: contains }, { title: contains }, { notes: contains }],
        },
        select: {
          id: true,
          reference: true,
          title: true,
          kind: true,
          status: true,
          updatedAt: true,
          property: { select: { id: true, displayName: true, city: true, state: true } },
          responsible: { select: { user: { select: { id: true, displayName: true } } } },
        },
        orderBy: { updatedAt: 'desc' },
        take: limit + 1,
      }),
      this.prisma.person.findMany({
        where: {
          organizationId: user.organizationId,
          OR: [
            { legalName: contains },
            { givenName: contains },
            { familyName: contains },
            { taxId: contains },
            { email: contains },
            { phone: contains },
            { identificationNumber: contains },
          ],
        },
        select: {
          id: true,
          type: true,
          legalName: true,
          taxId: true,
          email: true,
          phone: true,
          matterParties: {
            select: {
              role: true,
              matter: { select: { id: true, reference: true, title: true, status: true, updatedAt: true } },
            },
            orderBy: { matter: { updatedAt: 'desc' } },
            take: 3,
          },
        },
        orderBy: { legalName: 'asc' },
        take: limit + 1,
      }),
      this.prisma.property.findMany({
        where: {
          organizationId: user.organizationId,
          OR: [
            { displayName: contains },
            { addressLine1: contains },
            { neighborhood: contains },
            { city: contains },
            { state: contains },
            { postalCode: contains },
            { cadastralReference: contains },
            { registryReference: contains },
          ],
        },
        select: {
          id: true,
          displayName: true,
          useType: true,
          addressLine1: true,
          city: true,
          state: true,
          owner: { select: { id: true, legalName: true } },
          matters: {
            select: { id: true, reference: true, title: true, status: true, updatedAt: true },
            orderBy: { updatedAt: 'desc' },
            take: 3,
          },
          guaranteeFor: {
            select: { id: true, reference: true, title: true, status: true, updatedAt: true },
            orderBy: { updatedAt: 'desc' },
            take: 3,
          },
        },
        orderBy: { displayName: 'asc' },
        take: limit + 1,
      }),
      this.prisma.document.findMany({
        where: {
          organizationId: user.organizationId,
          invalidatedAt: null,
        },
        select: {
          id: true,
          matterId: true,
          originalName: true,
          type: true,
          version: true,
          personId: true,
          propertyId: true,
          invalidatedAt: true,
          mimeType: true,
          createdAt: true,
          matter: { select: { id: true, reference: true, title: true, status: true } },
          person: { select: { id: true, legalName: true } },
          property: { select: { id: true, displayName: true } },
        },
      }),
    ]);

    const documentsCurrent = currentDocuments(documentsFound)
      .filter((document) => (
        document.originalName.toLocaleLowerCase('es-MX').includes(query.toLocaleLowerCase('es-MX'))
        || document.type === documentType
      ))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, limit + 1);

    const result = <T>(items: T[]) => ({ items: items.slice(0, limit), hasMore: items.length > limit });
    const matters = result(mattersFound);
    const people = result(peopleFound);
    const properties = result(propertiesFound);
    const documents = result(documentsCurrent);

    return {
      query,
      resultCount: matters.items.length + people.items.length + properties.items.length + documents.items.length,
      matters,
      people,
      properties,
      documents,
    };
  }
}
